import { generateStage } from '@/engine/stageGenerator'
import { isWalkable } from '@/engine/cellLabels'

describe('generateStage — lava/village vertical slice', () => {
  const stage = generateStage({ zone: 'lava', variant: 'village' })

  it('produces a lava village of the requested identity', () => {
    expect(stage.zone).toBe('lava')
    expect(stage.variant).toBe('village')
    expect(stage.cols).toBeGreaterThan(0)
    expect(stage.rows).toBeGreaterThan(0)
  })

  it('themes the ground with the lava zone palette', () => {
    const lavaGround = new Set(['ash', 'rock', 'basalt', 'lava'])
    const allLava = stage.ground.every(row => row.every(t => lavaGround.has(t)))
    expect(allLava).toBe(true)
  })

  it('places at least one legal building (>=8 long, >=4 tall, with a door)', () => {
    expect(stage.buildings.length).toBeGreaterThan(0)
    for (const b of stage.buildings) {
      expect(b.length).toBeGreaterThanOrEqual(8)
      expect(b.height).toBeGreaterThanOrEqual(4)
      expect(b.doorCells.length).toBeGreaterThan(0)
    }
  })

  it('blocks wall footprint cells but leaves doors walkable', () => {
    for (const b of stage.buildings) {
      for (const d of b.doorCells) {
        expect(stage.collision[d.row][d.col]).toBe(false)
      }
      const blocked = stage.collision[b.row].slice(b.col, b.col + b.length).filter(Boolean)
      expect(blocked.length).toBeGreaterThan(0)
    }
  })

  it('keeps building footprints disjoint and the spawn walkable', () => {
    const seen = new Set<string>()
    for (const b of stage.buildings) {
      for (let i = 0; i < b.length; i++) {
        const key = `${b.col + i},${b.row}`
        expect(seen.has(key)).toBe(false)
        seen.add(key)
      }
    }
    expect(stage.collision[stage.spawn.row][stage.spawn.col]).toBe(false)
  })
})

describe('generateStage — multi-cell labeled buildings (the keystone)', () => {
  // A building must occupy its FULL length×height block as labeled cells with
  // per-label collision, exactly like trees. The apex roof tile + doors are the
  // only walkable cells; walls, roof body, and windows all block.
  const collectBuildingCells = (stage: ReturnType<typeof generateStage>) =>
    stage.props.filter(p => p.type === 'building')

  it('emits a labeled building prop for the whole block (length×height worth of cells)', () => {
    const stage = generateStage({ zone: 'lava', variant: 'village' })
    const cells = collectBuildingCells(stage)
    expect(cells.length).toBeGreaterThan(0)
    expect(cells.every(c => typeof c.label === 'string' && c.label!.length > 0)).toBe(true)
    // a single building's facade is taller than one row → more than `length` cells
    for (const b of stage.buildings) {
      const own = cells.filter(
        c => c.col >= b.col && c.col < b.col + b.length && c.row <= b.row && c.row > b.row - b.height,
      )
      expect(own.length).toBeGreaterThan(b.length) // multi-row, not a single footprint row
    }
  })

  it('blocks every building cell EXCEPT the walkable roof_top + doors (collision matches isWalkable)', () => {
    const stage = generateStage({ zone: 'lava', variant: 'village' })
    for (const c of collectBuildingCells(stage)) {
      const walkable = isWalkable(c.label!)
      expect(c.blocking).toBe(!walkable)
      expect(stage.collision[c.row][c.col]).toBe(!walkable)
    }
  })

  it('gives each building exactly ONE walkable roof_top apex', () => {
    const stage = generateStage({ zone: 'lava', variant: 'village' })
    const cells = collectBuildingCells(stage)
    for (const b of stage.buildings) {
      const roofTops = cells.filter(
        c =>
          c.label === 'roof_top' &&
          c.col >= b.col &&
          c.col < b.col + b.length &&
          c.row <= b.row &&
          c.row > b.row - b.height,
      )
      expect(roofTops).toHaveLength(1)
      expect(roofTops[0].blocking).toBe(false)
      expect(stage.collision[roofTops[0].row][roofTops[0].col]).toBe(false)
    }
  })

  it('keeps doors walkable and walls blocking across the full facade', () => {
    const stage = generateStage({ zone: 'frozen', variant: 'temple', cols: 36, rows: 30 })
    const cells = collectBuildingCells(stage)
    const doors = cells.filter(c => c.label === 'door')
    const walls = cells.filter(c => c.label === 'wall')
    expect(doors.length).toBeGreaterThan(0)
    expect(walls.length).toBeGreaterThan(0)
    expect(doors.every(d => d.blocking === false && stage.collision[d.row][d.col] === false)).toBe(true)
    expect(walls.every(w => w.blocking === true && stage.collision[w.row][w.col] === true)).toBe(true)
  })
})

describe('generateStage — forest archetype (Viridian-Forest style)', () => {
  const stage = generateStage({ zone: 'verdant', variant: 'forest', cols: 30, rows: 24 })

  it('fills the forest with trees and walkable flowers', () => {
    const trees = stage.props.filter(p => p.type === 'tree')
    const flowers = stage.props.filter(p => p.type === 'flower')
    expect(trees.length).toBeGreaterThan(20)
    expect(flowers.length).toBeGreaterThan(0)
    expect(flowers.every(f => f.blocking === false)).toBe(true)
  })

  it('carves walkable paths through the trees and spawns on open ground', () => {
    expect(stage.collision[stage.spawn.row][stage.spawn.col]).toBe(false)
    const walkable = stage.collision.flat().filter(c => !c).length
    expect(walkable).toBeGreaterThan(stage.cols) // at least the carved corridors
  })
})

// 4-neighbour flood fill over walkable cells — proves the open floor is one region.
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

describe('generateStage — cave archetype (cellular automata)', () => {
  const stage = generateStage({ zone: 'lava', variant: 'cave', cols: 40, rows: 30 })

  it('carves rock walls as blocking props', () => {
    const rocks = stage.props.filter(p => p.type === 'rock')
    expect(rocks.length).toBeGreaterThan(0)
    expect(rocks.every(r => r.blocking === true)).toBe(true)
  })

  it('spawns on walkable ground inside one connected cavern', () => {
    expect(stage.collision[stage.spawn.row][stage.spawn.col]).toBe(false)
    const walkable = stage.collision.flat().filter(c => !c).length
    const reachable = reachableCount(stage.collision, stage.spawn)
    // every walkable cell is reachable from spawn → the floor is a single region
    expect(reachable).toBe(walkable)
  })
})

describe('generateStage — boss-stage archetype (arena)', () => {
  const stage = generateStage({ zone: 'frozen', variant: 'boss-stage', cols: 36, rows: 30 })

  it('opens a large connected arena reachable from spawn', () => {
    expect(stage.collision[stage.spawn.row][stage.spawn.col]).toBe(false)
    const reachable = reachableCount(stage.collision, stage.spawn)
    expect(reachable).toBeGreaterThan(100) // a large central room, not a tunnel
  })

  it('anchors exactly one boss prop at the far side of the arena', () => {
    const bosses = stage.props.filter(p => p.type === 'boss')
    expect(bosses).toHaveLength(1)
    expect(bosses[0].row).toBeLessThan(stage.rows / 2) // north / far side
  })
})

describe('generateStage — temple archetype', () => {
  const stage = generateStage({ zone: 'lava', variant: 'temple', cols: 36, rows: 30 })

  it('places one large temple building', () => {
    expect(stage.buildings).toHaveLength(1)
    expect(stage.buildings[0].type).toBe('temple')
    expect(stage.buildings[0].length).toBeGreaterThanOrEqual(14)
  })

  it('lines the approach with columns and keeps the spawn walkable', () => {
    expect(stage.props.some(p => p.type === 'column')).toBe(true)
    expect(stage.collision[stage.spawn.row][stage.spawn.col]).toBe(false)
  })
})

describe('generateStage — zone-tinted trees', () => {
  // Collect the distinct trunk vs canopy colors a zone's forest paints. Trunk =
  // the stem labels (tree_stem*), canopy = every other tree cell (leaves + the
  // autotiled mass), matching the generator's trunk/canopy split.
  const STEM_LABELS = new Set(['tree_stem', 'tree_stem_bottom'])
  const treePalette = (zone: 'verdant' | 'frozen' | 'lava') => {
    const stage = generateStage({ zone, variant: 'forest', cols: 30, rows: 24 })
    const trees = stage.props.filter(p => p.type === 'tree')
    const trunk = new Set(trees.filter(p => STEM_LABELS.has(p.label ?? '')).map(p => p.color))
    const canopy = new Set(trees.filter(p => !STEM_LABELS.has(p.label ?? '')).map(p => p.color))
    return { trunk, canopy }
  }

  const verdant = treePalette('verdant')
  const frozen = treePalette('frozen')
  const lava = treePalette('lava')

  const onlyColor = (set: Set<string>): string => {
    expect(set.size).toBe(1) // a zone paints exactly one trunk + one canopy color
    return [...set][0]
  }

  it('gives every zone a single, consistent trunk and canopy color', () => {
    for (const { trunk, canopy } of [verdant, frozen, lava]) {
      expect(trunk.size).toBe(1)
      expect(canopy.size).toBe(1)
    }
  })

  it('keeps trunk and canopy visually distinct WITHIN each zone', () => {
    for (const p of [verdant, frozen, lava]) {
      expect(onlyColor(p.trunk)).not.toBe(onlyColor(p.canopy))
    }
  })

  it('tints canopies per zone — frozen, lava, and verdant are all disjoint', () => {
    const canopies = [onlyColor(verdant.canopy), onlyColor(frozen.canopy), onlyColor(lava.canopy)]
    expect(new Set(canopies).size).toBe(3) // no two zones share a canopy color
  })

  it('tints trunks per zone — frozen, lava, and verdant are all disjoint', () => {
    const trunks = [onlyColor(verdant.trunk), onlyColor(frozen.trunk), onlyColor(lava.trunk)]
    expect(new Set(trunks).size).toBe(3) // no two zones share a trunk color
  })

  it('keeps the verdant forest the classic brown trunk + green canopy', () => {
    expect(onlyColor(verdant.trunk)).toBe('#6b4a2b')
    expect(onlyColor(verdant.canopy)).toBe('#2e8b2e')
  })
})

describe('generateStage — multi-cell labeled trees (the keystone)', () => {
  const stage = generateStage({ zone: 'verdant', variant: 'forest', cols: 30, rows: 24 })
  const treeProps = stage.props.filter(p => p.type === 'tree')

  it('labels every tree cell (no bare, label-less tree props)', () => {
    expect(treeProps.length).toBeGreaterThan(0)
    expect(treeProps.every(p => typeof p.label === 'string' && p.label.length > 0)).toBe(true)
  })

  it('blocks every tree cell EXCEPT the walkable canopy top (tree_leaf_top)', () => {
    for (const p of treeProps) {
      const walkable = isWalkable(p.label!)
      // prop.blocking and the live collision grid must agree with the label rule
      expect(p.blocking).toBe(!walkable)
      expect(stage.collision[p.row][p.col]).toBe(!walkable)
    }
  })

  it('stamps standalone glade trees as MULTI-CELL columns (>1 cell each)', () => {
    // Glade trees stand in open clearings: a tree_leaf_top sits directly above a
    // tree_leaf, which sits above trunk cells — proving >1 cell of vertical extent.
    const tops = treeProps.filter(p => p.label === 'tree_leaf_top')
    const gladeTops = tops.filter(top =>
      treeProps.some(p => p.label === 'tree_leaf' && p.col === top.col && p.row === top.row + 1),
    )
    expect(gladeTops.length).toBeGreaterThan(0)

    for (const top of gladeTops) {
      const column = treeProps.filter(p => p.col === top.col && p.row >= top.row && p.row <= top.row + 3)
      // exactly ONE walkable canopy top per glade tree; the cells under it block
      const walkableTops = column.filter(c => c.label === 'tree_leaf_top')
      expect(walkableTops).toHaveLength(1)
      expect(stage.collision[top.row][top.col]).toBe(false)
      const under = column.filter(c => c.row > top.row)
      expect(under.length).toBeGreaterThan(0)
      expect(under.every(c => c.blocking === true)).toBe(true)
    }
  })

  it('keeps the forest FLOOR connected (canopy tops are a separate walkable layer)', () => {
    // A tree_leaf_top is collision-free (you walk UNDER it) but it is a canopy
    // top, not floor — reachable by jumping, not on foot. Treat canopy tops as
    // non-floor: every GROUND cell must be reachable from spawn.
    const canopyTop = new Set(
      treeProps.filter(p => p.label === 'tree_leaf_top').map(p => `${p.col},${p.row}`),
    )
    const floorBlocked = stage.collision.map((rowArr, r) =>
      rowArr.map((blocked, c) => blocked || canopyTop.has(`${c},${r}`)),
    )
    const floor = floorBlocked.flat().filter(b => !b).length
    const reachable = reachableCount(floorBlocked, stage.spawn)
    expect(reachable).toBe(floor)
  })
})

// ── forest LAYOUT OPTIONS: the user steers the general layout, the generator
//    randomizes the rest. Both placeForest layouts are stochastic, so tree-count
//    comparisons average several runs to stay robust against a single unlucky map.
const FOREST_SIZE = { cols: 30, rows: 24 } as const

const countTrees = (opts: Parameters<typeof generateStage>[0]): number =>
  generateStage(opts).props.filter(p => p.type === 'tree').length

const averageTrees = (opts: Parameters<typeof generateStage>[0], runs = 20): number => {
  let total = 0
  for (let i = 0; i < runs; i++) total += countTrees(opts)
  return total / runs
}

describe('generateStage — forest layout: open vs passages', () => {
  it("'open' yields noticeably fewer trees than 'passages' at the same size", () => {
    const passages = averageTrees({ zone: 'verdant', variant: 'forest', layout: 'passages', ...FOREST_SIZE })
    const open = averageTrees({ zone: 'verdant', variant: 'forest', layout: 'open', ...FOREST_SIZE })
    expect(open).toBeGreaterThan(0) // still a forest — sparse clumps + glade trees
    expect(open).toBeLessThan(passages * 0.7) // ~0.5x in practice; 0.7 keeps margin vs RNG
  })

  it("'open' is easy to traverse — most of the map is reachable open floor", () => {
    const stage = generateStage({ zone: 'verdant', variant: 'forest', layout: 'open', ...FOREST_SIZE })
    expect(stage.collision[stage.spawn.row][stage.spawn.col]).toBe(false)
    const reachable = reachableCount(stage.collision, stage.spawn)
    // a wide-open glade: well over half the cells reachable on foot
    expect(reachable).toBeGreaterThan((stage.cols * stage.rows) / 2)
  })
})

describe('generateStage — forest layout: defaults to passages', () => {
  it('omitting layout reproduces the dense passages forest, not the open glade', () => {
    const defaulted = averageTrees({ zone: 'verdant', variant: 'forest', ...FOREST_SIZE })
    const passages = averageTrees({ zone: 'verdant', variant: 'forest', layout: 'passages', ...FOREST_SIZE })
    const open = averageTrees({ zone: 'verdant', variant: 'forest', layout: 'open', ...FOREST_SIZE })
    // the default sits in the dense (passages) band, well above the open glade
    expect(defaulted).toBeGreaterThan(open * 1.4)
    expect(Math.abs(defaulted - passages)).toBeLessThan(passages * 0.5)
  })
})

// 4-neighbour flood fill over a predicate grid — proves a labeled set of cells
// (e.g. the lake's hazard ground) forms ONE contiguous block.
function contiguousBlockSize(cells: { col: number; row: number }[]): number {
  if (cells.length === 0) return 0
  const inSet = new Set(cells.map(c => `${c.col},${c.row}`))
  const seen = new Set<string>()
  const start = cells[0]
  const stack = [start]
  seen.add(`${start.col},${start.row}`)
  while (stack.length > 0) {
    const { col, row } = stack.pop()!
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const key = `${col + dc},${row + dr}`
      if (!inSet.has(key) || seen.has(key)) continue
      seen.add(key)
      stack.push({ col: col + dc, row: row + dr })
    }
  }
  return seen.size
}

const hazardCells = (stage: ReturnType<typeof generateStage>, hazard: string) => {
  const cells: { col: number; row: number }[] = []
  stage.ground.forEach((rowArr, row) =>
    rowArr.forEach((type, col) => {
      if (type === hazard) cells.push({ col, row })
    }),
  )
  return cells
}

describe('generateStage — forest layout: central lake', () => {
  // zone → its hazard ground type + whether that hazard blocks movement.
  const LAKES = [
    { zone: 'verdant', hazard: 'water', blocks: true },
    { zone: 'lava', hazard: 'lava', blocks: true },
    { zone: 'frozen', hazard: 'ice_water', blocks: false },
  ] as const

  it.each(LAKES)('$zone: carves a single contiguous lake of $hazard ground', ({ zone, hazard }) => {
    const stage = generateStage({ zone, variant: 'forest', layout: 'lake', cols: 36, rows: 30 })
    const lake = hazardCells(stage, hazard)
    expect(lake.length).toBeGreaterThan(10) // a real body of terrain, not a few cells
    expect(contiguousBlockSize(lake)).toBe(lake.length) // ONE connected block
  })

  it.each(LAKES)('$zone: sets lake collision per the zone (water/lava block, ice walkable)', ({ zone, hazard, blocks }) => {
    const stage = generateStage({ zone, variant: 'forest', layout: 'lake', cols: 36, rows: 30 })
    const lake = hazardCells(stage, hazard)
    expect(lake.every(c => stage.collision[c.row][c.col] === blocks)).toBe(true)
  })

  it.each(LAKES)('$zone: keeps the floor around the lake connected, spawn walkable', ({ zone }) => {
    const stage = generateStage({ zone, variant: 'forest', layout: 'lake', cols: 36, rows: 30 })
    expect(stage.collision[stage.spawn.row][stage.spawn.col]).toBe(false)
    // canopy tops are a separate walkable layer — treat them as non-floor so the
    // test measures the GROUND floor (matching the passages connectivity test).
    const canopyTop = new Set(
      stage.props.filter(p => p.label === 'tree_leaf_top').map(p => `${p.col},${p.row}`),
    )
    const floorBlocked = stage.collision.map((rowArr, r) =>
      rowArr.map((blocked, c) => blocked || canopyTop.has(`${c},${r}`)),
    )
    const floor = floorBlocked.flat().filter(b => !b).length
    const reachable = reachableCount(floorBlocked, stage.spawn)
    expect(reachable).toBe(floor) // every ground-floor cell reachable from spawn
  })
})
