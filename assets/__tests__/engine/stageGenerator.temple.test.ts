import { generateStage } from '@/engine/stageGenerator'
import { scatterEntities, TEMPLE_ENEMY_TYPES } from '@/game/spawner'
import type { ZoneId } from '@/engine/zones'
import { useSeedTileset } from '@/__tests__/helpers/tilesetSeed'
import { resolveComposition } from '@/engine/tileset/tileset'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'

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

const TEMPLE_SIZE = { cols: 44, rows: 34 } as const
const temple = (zone: ZoneId) => generateStage({ zone, variant: 'temple', ...TEMPLE_SIZE })

describe('generateStage — temple interior: floor is fully connected (flood-fill guarantee)', () => {
  it.each(['summer', 'winter', 'desert'] as const)('%s: every walkable cell is reachable from spawn', zone => {
    // Run several seeds: the flood-fill repair must make the dungeon floor ONE region every time,
    // even after blocking hazard pools carve the halls.
    for (let i = 0; i < 6; i++) {
      const stage = temple(zone)
      expect(stage.collision[stage.spawn.row][stage.spawn.col]).toBe(false)
      const walkable = stage.collision.flat().filter(c => !c).length
      const reachable = reachableCount(stage.collision, stage.spawn)
      expect(reachable).toBe(walkable) // no unreachable pockets
    }
  })
})

describe('generateStage — temple interior: walls are collision + border enclosed', () => {
  it('emits blocking temple_wall props whose cells are all blocked in the collision grid', () => {
    const stage = temple('autumn')
    const walls = stage.props.filter(p => p.type === 'temple_wall')
    expect(walls.length).toBeGreaterThan(50) // a real dungeon boundary + inner walls
    expect(walls.every(w => w.blocking === true)).toBe(true)
    expect(walls.every(w => stage.collision[w.row][w.col] === true)).toBe(true)
  })

  it('walls the whole border so the dungeon is enclosed', () => {
    const stage = temple('summer')
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

describe('generateStage — temple interior: rooms + a boss/altar chamber + pillared halls', () => {
  it('builds a central altar chamber ringed with pillars (the boss set-piece)', () => {
    const stage = temple('summer')
    const altars = stage.props.filter(p => p.type === 'altar')
    const pillars = stage.props.filter(p => p.type === 'pillar')
    expect(altars.length).toBe(1) // one boss altar
    expect(pillars.length).toBeGreaterThan(4) // colonnades + the altar ring → pillared halls
    // the altar blocks and sits on a blocked cell; it lives in the NORTH (top) half — the boss chamber
    const altar = altars[0]
    expect(altar.blocking).toBe(true)
    expect(stage.collision[altar.row][altar.col]).toBe(true)
    expect(altar.row).toBeLessThan(stage.rows / 2)
  })

  it('opens multiple large walkable rooms (not one solid slab)', () => {
    const stage = temple('summer')
    const walkable = stage.collision.flat().filter(c => !c).length
    const total = stage.cols * stage.rows
    // a room-and-corridor dungeon leaves a meaningful — but far from full — open floor
    expect(walkable).toBeGreaterThan(total * 0.12)
    expect(walkable).toBeLessThan(total * 0.7)
  })
})

describe('generateStage — temple interior: seasons yield DISTINCT palettes', () => {
  const wallColors = (zone: ZoneId): Set<string> =>
    new Set(temple(zone).props.filter(p => p.type === 'temple_wall').map(p => p.color))

  it('gives ≥3 seasons non-overlapping wall palettes', () => {
    const summer = wallColors('summer')
    const winter = wallColors('winter')
    const desert = wallColors('desert')
    for (const s of [summer, winter, desert]) expect(s.size).toBeGreaterThan(0)
    const disjoint = (a: Set<string>, b: Set<string>) => [...a].every(x => !b.has(x))
    expect(disjoint(summer, winter)).toBe(true)
    expect(disjoint(summer, desert)).toBe(true)
    expect(disjoint(winter, desert)).toBe(true)
  })

  it('paints a season-specific temple FLOOR (never outdoor grass) that differs across seasons', () => {
    const floorTiles = (zone: ZoneId) => new Set(temple(zone).ground.flat())
    const summer = floorTiles('summer')
    const winter = floorTiles('winter')
    const desert = floorTiles('desert')
    expect(summer.has('grass')).toBe(false)
    expect(summer.has('ancient_stone')).toBe(true) // stone hall
    expect(winter.has('frost')).toBe(true) // frozen temple
    expect(desert.has('sandstone')).toBe(true) // sandstone temple
  })
})

describe('generateStage — temple interior: seasonal hazards + torches', () => {
  it('lights the halls with wall torches (non-blocking)', () => {
    const stage = temple('autumn')
    const torches = stage.props.filter(p => p.type === 'torch')
    expect(torches.length).toBeGreaterThan(0)
    expect(torches.every(t => t.blocking === false)).toBe(true) // sconces never pinch the floor
  })

  it('scatters non-blocking spike hazards across the halls', () => {
    const spikes = [0, 1, 2].flatMap(() => temple('summer').props.filter(p => p.type === 'hazard'))
    expect(spikes.length).toBeGreaterThan(0)
    expect(spikes.every(s => s.blocking === false)).toBe(true) // you can step on a trap (it never disconnects)
  })

  it('freezes the winter temple pools into WALKABLE ice, but molten lava BLOCKS', () => {
    const iceWalkable = (): boolean => {
      for (let i = 0; i < 8; i++) {
        const stage = temple('winter')
        const ice = stage.ground.flatMap((r, row) => r.map((t, col) => ({ t, col, row }))).filter(c => c.t === 'ice_water')
        if (ice.length === 0) continue
        return ice.every(c => stage.collision[c.row][c.col] === false)
      }
      return true // no pool this run → vacuously fine
    }
    const lavaBlocks = (): boolean => {
      for (let i = 0; i < 8; i++) {
        const stage = temple('lava')
        const lava = stage.ground.flatMap((r, row) => r.map((t, col) => ({ t, col, row }))).filter(c => c.t === 'lava')
        if (lava.length === 0) continue
        return lava.every(c => stage.collision[c.row][c.col] === true)
      }
      return true
    }
    expect(iceWalkable()).toBe(true)
    expect(lavaBlocks()).toBe(true)
  })
})

describe('generateStage — temple interior: a clear walkable entrance/spawn region', () => {
  it('keeps a walkable, reachable hall in the south (entrance) band', () => {
    for (let i = 0; i < 6; i++) {
      const stage = temple('summer')
      const reachable = reachableCount(stage.collision, stage.spawn)
      // find a walkable cell in the bottom quarter, centre 40% of the columns — the entrance hall
      const rowLo = Math.floor(stage.rows * 0.72)
      const colLo = Math.floor(stage.cols * 0.3)
      const colHi = Math.floor(stage.cols * 0.7)
      let found: { col: number; row: number } | null = null
      for (let row = rowLo; row < stage.rows - 1 && !found; row++) {
        for (let col = colLo; col <= colHi && !found; col++) {
          if (!stage.collision[row][col]) found = { col, row }
        }
      }
      expect(found).not.toBeNull()
      // the entrance region is part of the ONE connected floor (reachable from spawn)
      expect(reachableCount(stage.collision, found!)).toBe(reachable)
    }
  })
})

describe('generateStage — temple interior: seeded enemies land on floor cells', () => {
  it('scatters temple enemies (skeletons/guardians/wraiths) only onto walkable floor', () => {
    const stage = temple('summer')
    const enemies = scatterEntities({
      collision: stage.collision,
      count: 12,
      kinds: ['enemy'],
      enemyTypes: TEMPLE_ENEMY_TYPES,
    })
    expect(enemies.length).toBeGreaterThan(0)
    for (const e of enemies) {
      expect(stage.collision[e.row][e.col]).toBe(false) // on floor, never in a wall
      expect(TEMPLE_ENEMY_TYPES).toContain(e.enemyType)
    }
  })
})

describe('generateStage — temple STRUCTURE: a grand settlement building composition', () => {
  useSeedTileset() // the temple_8 composition comes from the loaded backend tileset for this describe

  // The overworld temple is a BUILDING TYPE placed in settlements (like store/hospital). Generate
  // a few cities (ample room for its bigger footprint) and grab a temple building to verify it.
  const findTempleBuilding = () => {
    for (let i = 0; i < 12; i++) {
      const stage = generateStage({ zone: 'summer', variant: 'city', cols: 60, rows: 48 })
      const t = stage.buildings.find(b => b.type === 'temple')
      if (t) return { stage, temple: t }
    }
    return null
  }

  it('stamps the temple footprint as collision, walkable only across its door cells', () => {
    const found = findTempleBuilding()
    expect(found).not.toBeNull()
    const { stage, temple: b } = found!
    expect(b.kind).toBe('temple_8')
    // footprint = cols [col, col+length) × rows [row-(height-1), row]
    const cells: { col: number; row: number }[] = []
    const top = b.row - (b.height - 1)
    for (let r = top; r <= b.row; r++) for (let c = b.col; c < b.col + b.length; c++) cells.push({ col: c, row: r })
    // temple_8's 8-wide facade bakes a CENTRED 2-wide doorway, so the walk-in opening is 2 cells (G7 — the
    // entrance always matches the door), not the one cell the hardcoded span used to open.
    expect(b.doorCells).toHaveLength(2)
    const doorSet = new Set(b.doorCells.map(d => `${d.col},${d.row}`))
    for (const d of b.doorCells) expect(stage.collision[d.row][d.col]).toBe(false) // the door is a way in
    // every OTHER footprint cell blocks
    for (const c of cells) {
      const isDoor = doorSet.has(`${c.col},${c.row}`)
      expect(stage.collision[c.row][c.col]).toBe(!isDoor)
    }
  })

  it('reads as a grander, colonnaded structure (bigger footprint + many window bays in its composition)', () => {
    const found = findTempleBuilding()
    expect(found).not.toBeNull()
    const { temple: b } = found!
    // the temple footprint's facade span is wide (8), far bigger than a house
    const facadeSpan = b.facing === 'south' || b.facing === 'north' ? b.length : b.height
    expect(facadeSpan).toBeGreaterThanOrEqual(8)
    // colonnade = MANY open 'window' bays in the baked composition (a grand pillared facade)
    const comp = resolveComposition(ASCII_TILESET, 'temple_8')
    expect(comp).not.toBeNull()
    expect(comp!.cells.filter(c => c.label === 'window').length).toBeGreaterThan(20)
  })
})
