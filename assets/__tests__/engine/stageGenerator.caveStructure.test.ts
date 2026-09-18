/**
 * A CAVE IS A SPIDER.
 *
 * So: a mouth where you come in, a chamber where the pathways meet, a chamber where each way ENDS, and galleries
 * between them that pinch and open. The old cave was one blob with a hole in its south edge, and a generator
 * that serves no pathways still gets exactly that, which the last case here pins.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { generateStage, type StageData } from '@/engine/stageGenerator'
import { makeRng } from '@/lib/math'

const COLS = 40
const ROWS = 30
const key = (c: { col: number; row: number }) => `${c.col},${c.row}`

function cave(pathways: Record<string, string> | undefined, seed = 7): StageData {
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage({ zone: 'summer', variant: 'cave', cols: COLS, rows: ROWS, options: pathways })
  } finally {
    Math.random = orig
  }
}

/** Every walkable cell reachable from the spawn. */
function reach(s: StageData): Set<string> {
  const seen = new Set<string>()
  const open = (c: number, r: number) => c >= 0 && r >= 0 && c < s.cols && r < s.rows && !s.collision[r][c]
  if (!open(s.spawn.col, s.spawn.row)) return seen
  const stack = [key(s.spawn)]
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

/** How many cells are open within `r` of a point: a chamber is a wide open space, a gallery is not. */
function openAround(s: StageData, at: { col: number; row: number }, r: number): number {
  let n = 0
  for (let row = at.row - r; row <= at.row + r; row++) {
    for (let col = at.col - r; col <= at.col + r; col++) {
      if (col < 0 || row < 0 || col >= s.cols || row >= s.rows) continue
      if (!s.collision[row][col]) n++
    }
  }
  return n
}

describe('a cave built from its pathways', () => {
  it('plans them, and every way is a place you can stand', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const s = cave({ exits: '1', pathways: '3' }, seed)
      expect(s.routes).toBeTruthy()
      expect(s.routes!.gates).toHaveLength(1)
      expect(s.routes!.deadEnds).toHaveLength(2)

      const walked = reach(s)
      expect(walked.has(key(s.routes!.hub))).toBe(true)
      for (const gate of s.routes!.gates) expect(walked.has(key(gate.inside))).toBe(true)
      for (const stop of s.routes!.deadEnds) expect(walked.has(key(stop))).toBe(true)
    }
  })

  it('opens a CHAMBER where the pathways meet and where each one ends', () => {
    const s = cave({ exits: '2', pathways: '4' })
    // a 3-wide gallery gives at most ~21 open cells in a 5x5 window; a chamber fills it
    expect(openAround(s, s.routes!.hub, 2)).toBeGreaterThan(21)
    for (const stop of s.routes!.deadEnds) expect(openAround(s, stop, 2)).toBeGreaterThan(18)
  })

  // A way out is a MOUTH, not a hole in the rock, and not the whole edge falling away either. This used to
  // assert the border was solid EVERYWHERE, which is exactly what stopped the `exits` option doing anything:
  // a cave had 0 of 156 border cells walkable, so there was no way out at all. The rule is solid everywhere
  // EXCEPT at the gates the pathways planned.
  it('keeps the border sealed except at its gates, which are mouths you can walk out of', () => {
    const s = cave({ exits: '4', pathways: '4' })
    const gateCells = new Set(s.routes!.gates.flatMap(g => g.cells.map(c => `${c.col},${c.row}`)))
    expect(gateCells.size).toBeGreaterThan(0)

    let openOffGate = 0
    const onBorder = (col: number, row: number) => col === 0 || row === 0 || col === s.cols - 1 || row === s.rows - 1
    for (let row = 0; row < s.rows; row++) {
      for (let col = 0; col < s.cols; col++) {
        if (!onBorder(col, row) || s.collision[row][col]) continue
        if (!gateCells.has(`${col},${row}`)) openOffGate++
      }
    }
    expect(openOffGate).toBe(0) // the rock holds everywhere the pathways did not ask for a mouth

    // every gate is open, and so is the cell just inside it, so the mouth is joined to the cave
    for (const gate of s.routes!.gates) {
      expect(s.collision[gate.inside.row][gate.inside.col]).toBe(false)
      for (const c of gate.cells) expect(s.collision[c.row][c.col]).toBe(false)
    }
  })

  it('pinches and opens along a gallery instead of running one even corridor', () => {
    const s = cave({ exits: '1', pathways: '2' })
    const widths = new Set<number>()
    for (const k of s.routes!.spine) {
      const [col, row] = k.split(',').map(Number)
      let w = 0
      for (const [dc, dr] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const c = col + dc
        const r = row + dr
        if (c >= 0 && r >= 0 && c < s.cols && r < s.rows && !s.collision[r][c]) w++
      }
      widths.add(w)
    }
    expect(widths.size).toBeGreaterThan(1) // not one uniform corridor
  })

  it('is still ONE place, whatever the pathways', () => {
    for (const pathways of [{ exits: '1', pathways: '1' }, { exits: '2', pathways: '3' }, { exits: '4', pathways: '4' }]) {
      for (let seed = 1; seed <= 4; seed++) {
        const s = cave(pathways, seed)
        const walkable = s.collision.flat().filter(c => !c).length
        expect(reach(s).size).toBe(walkable)
      }
    }
  })
})

describe('a cave that serves no pathways is the cave it always was', () => {
  it('still carves its cellular cavern, enclosed and connected', () => {
    const s = cave(undefined)
    expect(s.routes).toBeNull()
    const walkable = s.collision.flat().filter(c => !c).length
    expect(reach(s).size).toBe(walkable)
    expect(s.props.filter(p => p.type === 'rock').length).toBeGreaterThan(50)
  })
})
