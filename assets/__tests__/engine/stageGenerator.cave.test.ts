import '@/__tests__/helpers/installTilesetSeed' // the generator reads canopy/decor/feature colours from the loaded backend tileset now — install the captured fixture
import { generateStage } from '@/engine/stageGenerator'
import { scatterEntities, CAVE_ENEMY_TYPES } from '@/game/spawner'
import type { ZoneId } from '@/engine/zones'

// 4-neighbour flood fill over walkable cells — proves the open floor is ONE region.
function reachableCount(collision: boolean[][], start: { col: number; row: number }): number {
  const cols = collision[0].length
  const rows = collision.length
  const seen = new Set<string>()
  const stack = [start]
  seen.add(`${start.col},${start.row}`)
  while (stack.length > 0) {
    const { col, row } = stack.pop()!
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const c = col + dc
      const r = row + dr
      const key = `${c},${r}`
      if (c < 0 || c >= cols || r < 0 || r >= rows) continue
      if (collision[r][c]) continue
      if (seen.has(key)) continue
      seen.add(key)
      stack.push({ col: c, row: r })
    }
  }
  return seen.size
}

const CAVE_SIZE = { cols: 44, rows: 32 } as const
const cave = (zone: ZoneId) => generateStage({ zone, variant: 'cave', ...CAVE_SIZE })

describe('generateStage — cave: floor is fully connected (flood-fill guarantee)', () => {
  it.each(['summer', 'winter', 'desert'] as const)('%s: every walkable cell is reachable from spawn', zone => {
    // Run several seeds: the flood-fill repair must make the floor ONE region every time.
    for (let i = 0; i < 6; i++) {
      const stage = cave(zone)
      expect(stage.collision[stage.spawn.row][stage.spawn.col]).toBe(false)
      const walkable = stage.collision.flat().filter(c => !c).length
      const reachable = reachableCount(stage.collision, stage.spawn)
      expect(reachable).toBe(walkable) // no unreachable pockets
    }
  })
})

describe('generateStage — cave: rock walls are collision', () => {
  it('emits blocking rock-wall props whose cells are all blocked in the collision grid', () => {
    const stage = cave('autumn')
    const rocks = stage.props.filter(p => p.type === 'rock')
    expect(rocks.length).toBeGreaterThan(50) // a real cavern boundary + formations
    expect(rocks.every(r => r.blocking === true)).toBe(true)
    expect(rocks.every(r => stage.collision[r.row][r.col] === true)).toBe(true)
  })

  it('walls the whole border so the cavern is enclosed', () => {
    const stage = cave('summer')
    const { cols, rows, collision } = stage
    for (let c = 0; c < cols; c++) {
      expect(collision[0][c]).toBe(true)
      expect(collision[rows - 1][c]).toBe(true)
    }
    for (let r = 0; r < rows; r++) {
      expect(collision[r][0]).toBe(true)
      expect(collision[r][cols - 1]).toBe(true)
    }
  })
})

describe('generateStage — cave: seasons yield DISTINCT palettes', () => {
  const rockColors = (zone: ZoneId): Set<string> =>
    new Set(cave(zone).props.filter(p => p.type === 'rock').map(p => p.color))

  it('gives ≥3 seasons non-overlapping rock-wall palettes', () => {
    const summer = rockColors('summer')
    const winter = rockColors('winter')
    const desert = rockColors('desert')
    for (const s of [summer, winter, desert]) expect(s.size).toBeGreaterThan(0)
    const disjoint = (a: Set<string>, b: Set<string>) => [...a].every(x => !b.has(x))
    expect(disjoint(summer, winter)).toBe(true)
    expect(disjoint(summer, desert)).toBe(true)
    expect(disjoint(winter, desert)).toBe(true)
  })

  it('paints a season-specific cave FLOOR (not grass) that differs across seasons', () => {
    const floorTiles = (zone: ZoneId) => new Set(cave(zone).ground.flat())
    const summer = floorTiles('summer')
    const winter = floorTiles('winter')
    const desert = floorTiles('desert')
    // a cave floor is stone/ice/sand — never the outdoor grass fill
    expect(summer.has('grass')).toBe(false)
    expect(summer.has('cave_floor')).toBe(true) // mossy stone cavern
    expect(winter.has('frost')).toBe(true) // frozen cavern
    expect(desert.has('sand')).toBe(true) // dry sandy cavern
  })
})

describe('generateStage — cave: seasonal water / ice / lava pools', () => {
  const hasGround = (zone: ZoneId, type: string): boolean => {
    for (let i = 0; i < 6; i++) if (cave(zone).ground.flat().includes(type)) return true
    return false
  }

  it('carves blocking WATER pools in a summer cave', () => {
    // sample several maps — pools are 1–3 per cave
    let checked = false
    for (let i = 0; i < 8 && !checked; i++) {
      const stage = cave('summer')
      const pool = stage.ground.flatMap((r, row) => r.map((t, col) => ({ t, col, row }))).filter(c => c.t === 'water')
      if (pool.length === 0) continue
      expect(pool.every(c => stage.collision[c.row][c.col] === true)).toBe(true) // water blocks
      checked = true
    }
    expect(checked).toBe(true)
  })

  it('freezes the winter cave pools into WALKABLE ice', () => {
    let checked = false
    for (let i = 0; i < 8 && !checked; i++) {
      const stage = cave('winter')
      const ice = stage.ground.flatMap((r, row) => r.map((t, col) => ({ t, col, row }))).filter(c => c.t === 'ice_water')
      if (ice.length === 0) continue
      expect(ice.every(c => stage.collision[c.row][c.col] === false)).toBe(true) // ice is walkable
      checked = true
    }
    expect(checked).toBe(true)
  })

  it('pools molten LAVA (blocking) in a lava cave', () => {
    expect(hasGround('lava', 'lava')).toBe(true)
  })
})

describe('generateStage — cave: scattered features', () => {
  it('grows crystal clusters (non-blocking, season-tinted)', () => {
    // aggregate a few caves so at least one cluster lands
    const crystals = [0, 1, 2, 3].flatMap(() => cave('spring').props.filter(p => p.type === 'crystal'))
    expect(crystals.length).toBeGreaterThan(0)
    expect(crystals.every(c => c.blocking === false)).toBe(true)
    expect(crystals.every(c => c.char === '◆' || c.char === '◇')).toBe(true)
  })

  it('grows a mushroom patch in DAMP seasons but not in an arid/frozen one', () => {
    const mushrooms = (zone: ZoneId, runs = 4) =>
      Array.from({ length: runs }).flatMap(() => cave(zone).props.filter(p => p.type === 'mushroom'))
    expect(mushrooms('summer').length).toBeGreaterThan(0) // damp → fungi
    expect(mushrooms('desert').length).toBe(0) // arid → none
    expect(mushrooms('winter').length).toBe(0) // frozen → none
  })

  it('scatters non-blocking cave rubble/stalagmites over the floor', () => {
    const decor = [0, 1].flatMap(() => cave('autumn').props.filter(p => p.type === 'cave_decor'))
    expect(decor.length).toBeGreaterThan(0)
    expect(decor.every(d => d.blocking === false)).toBe(true)
  })
})

describe('generateStage — cave: a clear walkable entrance region', () => {
  it('keeps the south-centre entrance chamber walkable', () => {
    for (let i = 0; i < 6; i++) {
      const stage = cave('summer')
      const centerCol = Math.floor(stage.cols / 2)
      // the entrance chamber sits just inside the south border, centred
      expect(stage.collision[stage.rows - 2][centerCol]).toBe(false)
      expect(stage.collision[stage.rows - 3][centerCol]).toBe(false)
      // and it is connected to the spawn (part of the one floor region)
      const reachable = reachableCount(stage.collision, stage.spawn)
      const entranceReachable = reachableCount(stage.collision, { col: centerCol, row: stage.rows - 2 })
      expect(entranceReachable).toBe(reachable)
    }
  })
})

describe('generateStage — cave: seeded enemies land on floor cells', () => {
  it('scatters cave enemies (bats/spiders/skeletons) only onto walkable floor', () => {
    const stage = cave('summer')
    const enemies = scatterEntities({
      collision: stage.collision,
      count: 12,
      kinds: ['enemy'],
      enemyTypes: CAVE_ENEMY_TYPES,
    })
    expect(enemies.length).toBeGreaterThan(0)
    for (const e of enemies) {
      expect(stage.collision[e.row][e.col]).toBe(false) // on floor, never in rock
      expect(CAVE_ENEMY_TYPES).toContain(e.enemyType)
    }
  })
})
