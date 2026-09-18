/**
 * A TEMPLE BUILT FROM ITS WAYS, and a lock with a key you can reach.
 *
 * The sanctum takes the plan's deepest place, the chapels take the other stops, the hall takes the way in, and
 * the halls between them are the planned pathways. The invariant that makes a lock-and-key dungeon solvable at all
 * is pinned here directly: the key must be reachable WITHOUT crossing the gate it opens.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { generateStage, type StageData } from '@/engine/stageGenerator'
import { makeRng } from '@/lib/math'

const COLS = 40
const ROWS = 30
const key = (c: { col: number; row: number }) => `${c.col},${c.row}`

function temple(pathways: Record<string, string> | undefined, seed = 7): StageData {
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage({ zone: 'summer', variant: 'temple', cols: COLS, rows: ROWS, options: pathways })
  } finally {
    Math.random = orig
  }
}

/** Every walkable cell reachable from `from`, with `blocked` treated as wall. */
function reach(s: StageData, from: { col: number; row: number }, blocked = new Set<string>()): Set<string> {
  const seen = new Set<string>()
  const open = (c: number, r: number) =>
    c >= 0 && r >= 0 && c < s.cols && r < s.rows && !s.collision[r][c] && !blocked.has(`${c},${r}`)
  if (!open(from.col, from.row)) return seen
  const stack = [key(from)]
  seen.add(stack[0])
  while (stack.length) {
    const [c, r] = stack.pop()!.split(',').map(Number)
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${c + dc},${r + dr}`
      if (open(c + dc, r + dr) && !seen.has(k)) { seen.add(k); stack.push(k) }
    }
  }
  return seen
}

describe('a temple built from its pathways', () => {
  it('puts the altar in the north half however the pathways fall', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const s = temple({ exits: '2', pathways: '4' }, seed)
      const altars = s.props.filter(p => p.type === 'altar')
      expect(altars).toHaveLength(1)
      expect(altars[0].row).toBeLessThan(s.rows / 2)
    }
  })

  it('reaches every stop and every way from the spawn, and stays one place', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const s = temple({ exits: '3', pathways: '4' }, seed)
      const walked = reach(s, s.spawn)
      expect(walked.size).toBe(s.collision.flat().filter(c => !c).length)
      for (const gate of s.routes!.gates) expect(walked.has(key(gate.inside))).toBe(true)

      // A stop is walkable UNLESS the sanctum was built on it, and then its centre holds the set piece: the
      // altar and its braziers. That is the point of the sanctum, and its own suite requires the altar to sit
      // on a blocked cell, so the honest test is that you can reach the place, not stand in the altar.
      const setPiece = new Set(
        s.props.filter(p => p.blocking && ['altar', 'brazier', 'pillar'].includes(p.type)).map(key),
      )
      for (const stop of s.routes!.deadEnds) {
        expect(walked.has(key(stop)) || setPiece.has(key(stop))).toBe(true)
      }

      // and the sanctum itself is reachable: the altar has a walkable neighbour you can stand on
      const altar = s.props.find(p => p.type === 'altar')!
      const beside = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => walked.has(`${altar.col + dc},${altar.row + dr}`))
      expect(beside).toBe(true)
    }
  })

  it('locks the sanctum and leaves its key reachable without crossing the gate', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const s = temple({ exits: '1', pathways: '4' }, seed)
      const gate = s.props.find(p => p.label === 'door')
      const keyProp = s.props.find(p => p.type === 'key')
      expect(gate).toBeTruthy()
      expect(keyProp).toBeTruthy()
      // THE INVARIANT: shut the gate and the key is still reachable, or the temple is unsolvable.
      const shut = new Set([key(gate!)])
      expect(reach(s, s.spawn, shut).has(key(keyProp!))).toBe(true)
    }
  })

  // The border is walled EXCEPT at the gates. It used to be asserted walled everywhere, which is what made
  // "seal the map border so the dungeon is fully enclosed" erase every exit the pathways had planned.
  it('keeps the border walled except at its gates, and the floor between an eighth and two thirds of the map', () => {
    const s = temple({ exits: '4', pathways: '4' })
    const gateCells = new Set(s.routes!.gates.flatMap(g => g.cells.map(c => `${c.col},${c.row}`)))
    expect(gateCells.size).toBeGreaterThan(0)
    for (let c = 0; c < s.cols; c++) {
      for (const r of [0, s.rows - 1]) {
        if (gateCells.has(`${c},${r}`)) { expect(s.collision[r][c]).toBe(false); continue }
        expect(s.collision[r][c]).toBe(true)
      }
    }
    const walkable = s.collision.flat().filter(c => !c).length
    expect(walkable).toBeGreaterThan(s.cols * s.rows * 0.12)
    expect(walkable).toBeLessThan(s.cols * s.rows * 0.7)
  })
})

describe('a temple that serves no pathways is the temple it always was', () => {
  it('still builds its fixed rooms, with the altar north and one connected floor', () => {
    const s = temple(undefined)
    expect(s.routes).toBeNull()
    expect(s.props.filter(p => p.type === 'altar')).toHaveLength(1)
    expect(reach(s, s.spawn).size).toBe(s.collision.flat().filter(c => !c).length)
  })
})
