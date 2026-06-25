import { generateStage, buildingCellColor } from '@/engine/stageGenerator'
import { isWalkable } from '@/engine/cellLabels'
import { TREE_CANOPY_SHADES } from '@/engine/cellTileset'

describe('generateStage — lava/village vertical slice', () => {
  const stage = generateStage({ zone: 'autumn', variant: 'village' })

  it('produces a lava village of the requested identity', () => {
    expect(stage.zone).toBe('autumn')
    expect(stage.variant).toBe('village')
    expect(stage.cols).toBeGreaterThan(0)
    expect(stage.rows).toBeGreaterThan(0)
  })

  it('themes the ground with the zone palette (village streets are path_stone)', () => {
    const allowed = new Set(['autumn_ground', 'autumn_leaves', 'path_stone']) // streets carve path_stone
    const allThemed = stage.ground.every(row => row.every(t => allowed.has(t)))
    expect(allThemed).toBe(true)
    // and there ARE streets — a real village, not bare ground
    expect(stage.ground.flat().filter(t => t === 'path_stone').length).toBeGreaterThan(0)
  })

  it('places at least one legal building (>=4 long, >=4 tall, with a door)', () => {
    expect(stage.buildings.length).toBeGreaterThan(0)
    for (const b of stage.buildings) {
      expect(b.length).toBeGreaterThanOrEqual(4)
      expect(b.height).toBeGreaterThanOrEqual(4)
      expect(b.doorCells.length).toBeGreaterThan(0)
    }
  })

  it('makes the building SOLID — doors block too, only the roof_top apex is walkable', () => {
    for (const b of stage.buildings) {
      for (const d of b.doorCells) {
        expect(stage.collision[d.row][d.col]).toBe(true) // doors block now (solid like a tree)
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
    const stage = generateStage({ zone: 'autumn', variant: 'village' })
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
    const stage = generateStage({ zone: 'autumn', variant: 'village' })
    for (const c of collectBuildingCells(stage)) {
      const walkable = isWalkable(c.label!)
      expect(c.blocking).toBe(!walkable)
      expect(stage.collision[c.row][c.col]).toBe(!walkable)
    }
  })

  it('gives each building exactly ONE walkable roof_top apex', () => {
    const stage = generateStage({ zone: 'autumn', variant: 'village' })
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

  it('blocks doors AND walls across the full facade (solid building)', () => {
    const stage = generateStage({ zone: 'winter', variant: 'temple', cols: 36, rows: 30 })
    const cells = collectBuildingCells(stage)
    const doors = cells.filter(c => c.label === 'door')
    const walls = cells.filter(c => c.label === 'wall')
    expect(doors.length).toBeGreaterThan(0)
    expect(walls.length).toBeGreaterThan(0)
    expect(doors.every(d => d.blocking === true && stage.collision[d.row][d.col] === true)).toBe(true)
    expect(walls.every(w => w.blocking === true && stage.collision[w.row][w.col] === true)).toBe(true)
  })
})

describe('generateStage — forest archetype (Viridian-Forest style)', () => {
  const stage = generateStage({ zone: 'summer', variant: 'forest', cols: 30, rows: 24 })

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
  const stage = generateStage({ zone: 'autumn', variant: 'cave', cols: 40, rows: 30 })

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
  const stage = generateStage({ zone: 'winter', variant: 'boss-stage', cols: 36, rows: 30 })

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
  const stage = generateStage({ zone: 'autumn', variant: 'temple', cols: 36, rows: 30 })

  it('places one large temple building', () => {
    expect(stage.buildings).toHaveLength(1)
    expect(stage.buildings[0].type).toBe('temple')
    expect(stage.buildings[0].length).toBeGreaterThanOrEqual(8) // temple is the widest type
  })

  it('builds a colonnaded hall (pillars + altar) and keeps the spawn walkable', () => {
    expect(stage.props.some(p => p.type === 'pillar')).toBe(true)
    expect(stage.props.some(p => p.type === 'altar')).toBe(true)
    expect(stage.collision[stage.spawn.row][stage.spawn.col]).toBe(false)
  })
})

describe('generateStage — zone-tinted trees (tonal variation + bare trees)', () => {
  // Trunk/dead-wood labels paint the single trunk color; every other tree cell
  // (leaves + autotiled mass) paints a canopy SHADE from the zone's palette.
  const STEM_LABELS = new Set(['tree_stem', 'tree_stem_bottom', 'tree_snag'])
  const treeColors = (zone: 'summer' | 'winter' | 'autumn') => {
    const stage = generateStage({ zone, variant: 'forest', cols: 40, rows: 30 })
    const trees = stage.props.filter(p => p.type === 'tree')
    const trunk = new Set(trees.filter(p => STEM_LABELS.has(p.label ?? '')).map(p => p.color))
    const canopy = new Set(trees.filter(p => !STEM_LABELS.has(p.label ?? '')).map(p => p.color))
    return { trunk, canopy }
  }

  const verdant = treeColors('summer')
  const frozen = treeColors('winter')
  const lava = treeColors('autumn')

  it('keeps ONE trunk color per zone, distinct across zones', () => {
    for (const { trunk } of [verdant, frozen, lava]) expect(trunk.size).toBe(1)
    const trunks = [...verdant.trunk, ...frozen.trunk, ...lava.trunk]
    expect(new Set(trunks).size).toBe(3)
  })

  it('varies canopy tone for contrast — each zone uses MULTIPLE shades (not one flat tone)', () => {
    for (const { canopy } of [verdant, frozen, lava]) {
      expect(canopy.size).toBeGreaterThanOrEqual(2)
    }
  })

  it('intensity-varies canopy tones beyond the flat zone palette (richer leaf variety)', () => {
    // varyIntensity shifts each tree's leaf tone (darker/lighter), so canopy colors are
    // DERIVED from the zone palette but no longer limited to its exact entries — a forest of
    // many leaf tones, not one flat shade per zone. Hue is preserved (still zone-appropriate).
    const zones = [['summer', verdant], ['winter', frozen], ['autumn', lava]] as const
    for (const [zone, { canopy }] of zones) {
      const shifted = [...canopy].some(c => !TREE_CANOPY_SHADES[zone].includes(c))
      expect(shifted).toBe(true)
    }
  })

  it('keeps EVERY zone canopy palette disjoint (no shared tone across all 7 zones)', () => {
    const all = [
      ...TREE_CANOPY_SHADES.spring,
      ...TREE_CANOPY_SHADES.summer,
      ...TREE_CANOPY_SHADES.autumn,
      ...TREE_CANOPY_SHADES.winter,
      ...TREE_CANOPY_SHADES.desert,
      ...TREE_CANOPY_SHADES.beach,
      ...TREE_CANOPY_SHADES.lava,
    ]
    expect(new Set(all).size).toBe(all.length) // every tone unique → biomes never blur together
  })

  it('keeps the verdant forest classic — brown trunk, green canopy from the palette', () => {
    expect([...verdant.trunk][0]).toBe('#6b4a2b')
    expect([...verdant.canopy].every(c => c !== '#6b4a2b')).toBe(true)
    expect(TREE_CANOPY_SHADES.summer).toContain('#2e8b2e')
  })
})

describe('generateStage — a single tree is ONE tone (no intra-tree visual mess)', () => {
  it('paints all canopy cells of a glade tree with the same shade', () => {
    const stage = generateStage({ zone: 'summer', variant: 'forest', layout: 'open', cols: 40, rows: 30 })
    const trees = stage.props.filter(p => p.type === 'tree')
    const tops = trees.filter(p => p.label === 'tree_crown') // solid crown caps a glade tree
    let checked = 0
    for (const top of tops) {
      const column = trees.filter(p => p.col === top.col && p.row >= top.row && p.row <= top.row + 3)
      const canopyCells = column.filter(c => c.label === 'tree_leaf' || c.label === 'tree_crown')
      if (canopyCells.length < 2) continue
      expect(new Set(canopyCells.map(c => c.color)).size).toBe(1) // one tree → one tone
      checked++
    }
    expect(checked).toBeGreaterThan(0)
  })
})

describe('generateStage — bare/dead trees (snags)', () => {
  it('scatters leafless snags in a lava forest (burnt stems), all blocking', () => {
    // dead trees are a random fraction — sample several maps until one appears
    let snags = 0
    for (let i = 0; i < 8 && snags === 0; i++) {
      const stage = generateStage({ zone: 'autumn', variant: 'forest', layout: 'open', cols: 40, rows: 30 })
      const dead = stage.props.filter(p => p.label === 'tree_snag')
      if (dead.length > 0) {
        snags += dead.length
        expect(dead.every(d => d.blocking === true)).toBe(true)
      }
    }
    expect(snags).toBeGreaterThan(0)
  })
})

describe('generateStage — multi-cell labeled trees (the keystone)', () => {
  const stage = generateStage({ zone: 'summer', variant: 'forest', cols: 30, rows: 24 })
  const treeProps = stage.props.filter(p => p.type === 'tree')

  it('labels every tree cell (no bare, label-less tree props)', () => {
    expect(treeProps.length).toBeGreaterThan(0)
    expect(treeProps.every(p => typeof p.label === 'string' && p.label.length > 0)).toBe(true)
  })

  it('blocks EVERY tree cell — trees are fully solid (no passable cell to step into)', () => {
    expect(treeProps.length).toBeGreaterThan(0)
    for (const p of treeProps) {
      expect(p.blocking).toBe(true)
      expect(stage.collision[p.row][p.col]).toBe(true)
    }
  })

  it('stamps standalone glade trees as MULTI-CELL solid columns (crown on top, all block)', () => {
    // A glade tree: a solid tree_crown caps a tree_leaf above trunk cells —
    // proving >1 cell of vertical extent, and the whole column blocks.
    const crowns = treeProps.filter(p => p.label === 'tree_crown')
    const gladeCrowns = crowns.filter(top =>
      treeProps.some(p => p.label === 'tree_leaf' && p.col === top.col && p.row === top.row + 1),
    )
    expect(gladeCrowns.length).toBeGreaterThan(0)

    for (const top of gladeCrowns) {
      const column = treeProps.filter(p => p.col === top.col && p.row >= top.row && p.row <= top.row + 3)
      expect(column.length).toBeGreaterThan(1) // multi-cell
      expect(column.every(c => c.blocking === true)).toBe(true) // every cell blocks
      expect(stage.collision[top.row][top.col]).toBe(true) // the crown blocks too
    }
  })

  it('keeps the forest FLOOR connected — every non-blocking cell reachable from spawn', () => {
    // Trees are fully solid now, so the floor is simply every non-blocking cell.
    const floor = stage.collision.flat().filter(b => !b).length
    const reachable = reachableCount(stage.collision, stage.spawn)
    expect(reachable).toBe(floor)
  })
})

// ── forest LAYOUT OPTIONS: the user steers the general layout, the generator
//    randomizes the rest. Both placeForest layouts are stochastic, so tree-count
//    comparisons average several runs to stay robust against a single unlucky map.
const FOREST_SIZE = { cols: 30, rows: 24 } as const

const countTrees = (opts: Parameters<typeof generateStage>[0]): number =>
  generateStage(opts).props.filter(p => p.type === 'tree').length

const averageTrees = (opts: Parameters<typeof generateStage>[0], runs = 40): number => {
  let total = 0
  for (let i = 0; i < runs; i++) total += countTrees(opts)
  return total / runs
}

describe('generateStage — forest layout: open vs passages', () => {
  it("'open' yields noticeably fewer trees than 'passages' at the same size", () => {
    const passages = averageTrees({ zone: 'summer', variant: 'forest', layout: 'passages', ...FOREST_SIZE })
    const open = averageTrees({ zone: 'summer', variant: 'forest', layout: 'open', ...FOREST_SIZE })
    expect(open).toBeGreaterThan(0) // still a forest — sparse clumps + glade trees
    expect(open).toBeLessThan(passages * 0.92) // open is still sparser, but passages
    //   was thinned ~30% so the gap is now small (~0.84x mean) — averaged over many
    //   runs to stay robust against RNG.
  })

  it("'open' is easy to traverse — most of the map is reachable open floor", () => {
    const stage = generateStage({ zone: 'summer', variant: 'forest', layout: 'open', ...FOREST_SIZE })
    expect(stage.collision[stage.spawn.row][stage.spawn.col]).toBe(false)
    const reachable = reachableCount(stage.collision, stage.spawn)
    // a wide-open glade: well over half the cells reachable on foot
    expect(reachable).toBeGreaterThan((stage.cols * stage.rows) / 2)
  })
})

describe('generateStage — forest layout: defaults to passages', () => {
  it('omitting layout reproduces the dense passages forest, not the open glade', () => {
    const defaulted = averageTrees({ zone: 'summer', variant: 'forest', ...FOREST_SIZE })
    const passages = averageTrees({ zone: 'summer', variant: 'forest', layout: 'passages', ...FOREST_SIZE })
    const open = averageTrees({ zone: 'summer', variant: 'forest', layout: 'open', ...FOREST_SIZE })
    // the default sits in the (thinned) passages band, still denser than the open glade
    expect(defaulted).toBeGreaterThan(open * 1.08)
    expect(Math.abs(defaulted - passages)).toBeLessThan(passages * 0.5)
  })
})

describe('generateStage — seasonal forest density (spring is airier than summer)', () => {
  it('grows a CLEARLY sparser forest in spring than in summer (distinct seasons)', () => {
    // spring = fresh, airy growth; summer = deep, dense canopy. Averaged over many
    // seeds so the ~22% gap is robust against a single unlucky map.
    const spring = averageTrees({ zone: 'spring', variant: 'forest', layout: 'passages', ...FOREST_SIZE })
    const summer = averageTrees({ zone: 'summer', variant: 'forest', layout: 'passages', ...FOREST_SIZE })
    expect(spring).toBeGreaterThan(0) // still a forest, just lighter
    expect(spring).toBeLessThan(summer * 0.9) // clearly fewer trees than summer
  })

  it('keeps an arid DESERT scrub the sparsest of all', () => {
    const desert = averageTrees({ zone: 'desert', variant: 'forest', layout: 'passages', ...FOREST_SIZE })
    const summer = averageTrees({ zone: 'summer', variant: 'forest', layout: 'passages', ...FOREST_SIZE })
    // (the gap widens further on bigger maps; on this small test grid erosion converges sooner)
    expect(desert).toBeLessThan(summer * 0.82)
  })
})

describe('generateStage — spring flower variety (a meadow in bloom)', () => {
  it('scatters MANY distinct walkable flower types across spring forests', () => {
    // sample a few maps so we see the full palette, not one unlucky draw
    const flowers = [0, 1, 2].flatMap(() =>
      generateStage({ zone: 'spring', variant: 'forest', layout: 'open', cols: 40, rows: 30 }).props.filter(
        p => p.type === 'flower',
      ),
    )
    expect(flowers.length).toBeGreaterThan(0)
    expect(flowers.every(f => f.blocking === false)).toBe(true) // flowers never block
    const distinctGlyphs = new Set(flowers.map(f => f.char))
    expect(distinctGlyphs.size).toBeGreaterThanOrEqual(4) // several flower shapes, not one '*'
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
    { zone: 'summer', hazard: 'water', blocks: true },
    { zone: 'autumn', hazard: 'water', blocks: true },
    { zone: 'winter', hazard: 'ice_water', blocks: false },
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

// ── lake BALANCE: a hazard lake forest must stay navigable — a healthy ratio of
//    walkable LAND around the hazard, not a solid wall of trees with a pond in it.
//    (Bug: the old lake layout started fully forested and only carved the lake +
//    two thin gates, leaving ~4% walkable. A lake forest should read like the
//    passages forest WITH a central hazard.) Blocking-hazard zones only — frozen
//    ice is itself walkable, so it can't expose a solid-forest surround.
describe('generateStage — forest layout: lake stays balanced (walkable land vs hazard)', () => {
  const BLOCKING_LAKES = [
    { zone: 'autumn', hazard: 'water' },
    { zone: 'summer', hazard: 'water' },
  ] as const

  const HAZARD_GROUND = new Set(['water', 'ice_water'])

  // Walkable LAND = interior cell that is collision-free, not hazard, not a canopy
  // top (canopy tops are a separate walk-under layer, not ground you traverse).
  const walkableLandFraction = (stage: ReturnType<typeof generateStage>): number => {
    const canopyTop = new Set(
      stage.props.filter(p => p.label === 'tree_leaf_top').map(p => `${p.col},${p.row}`),
    )
    let interior = 0
    let land = 0
    for (let r = 1; r < stage.rows - 1; r++) {
      for (let c = 1; c < stage.cols - 1; c++) {
        interior++
        if (stage.collision[r][c]) continue
        if (HAZARD_GROUND.has(stage.ground[r][c])) continue
        if (canopyTop.has(`${c},${r}`)) continue
        land++
      }
    }
    return land / interior
  }

  it.each(BLOCKING_LAKES)('$zone: leaves plenty of walkable land around the lake (not a solid forest)', ({ zone }) => {
    // A stochastic generator is tested on its DISTRIBUTION, not a brittle single
    // worst case: the forest must be navigable ON AVERAGE (mean) and must NEVER
    // collapse into a solid wall of trees (min). Bound a margin around the lake +
    // 4-way gates keep the worst case well clear of the old ~4% solid-forest bug.
    const runs = 10
    const fractions: number[] = []
    for (let i = 0; i < runs; i++) {
      fractions.push(walkableLandFraction(generateStage({ zone, variant: 'forest', layout: 'lake', cols: 40, rows: 30 })))
    }
    const mean = fractions.reduce((s, f) => s + f, 0) / runs
    expect(mean).toBeGreaterThan(0.4) // typically a wide, walkable forest
    expect(Math.min(...fractions)).toBeGreaterThan(0.2) // and NEVER a solid forest (the bug was ~0.04)
  })

  it.each(BLOCKING_LAKES)('$zone: the hazard lake stays a balanced size (present, not swallowing the map)', ({ zone, hazard }) => {
    const stage = generateStage({ zone, variant: 'forest', layout: 'lake', cols: 40, rows: 30 })
    const lakeFraction = hazardCells(stage, hazard).length / ((stage.cols - 2) * (stage.rows - 2))
    expect(lakeFraction).toBeGreaterThan(0.06) // a real hazard body
    expect(lakeFraction).toBeLessThan(0.3) // but it leaves the forest room to breathe
  })
})

// ── biome coherence: a hazard lake gets a signature FEATURE nearby — a volcano
//    by the lava, a waterfall/mountain by the water/ice — so the scene reads as a
//    place, not a random pond. Features are blocking terrain props.
describe('generateStage — biome features beside the lake', () => {
  const manhattanNear = (
    feats: { col: number; row: number }[],
    body: { col: number; row: number }[],
    within: number,
  ): boolean => feats.some(f => body.some(b => Math.abs(b.col - f.col) + Math.abs(b.row - f.row) <= within))

  it('raises a volcano/mountain massif right beside the lava lake (blocking)', () => {
    const stage = generateStage({ zone: 'autumn', variant: 'forest', layout: 'lake', cols: 44, rows: 34 })
    const massif = stage.props.filter(p => p.label === 'peak' || p.label === 'mountain')
    expect(massif.length).toBeGreaterThan(0)
    expect(massif.every(p => p.blocking)).toBe(true)
    expect(manhattanNear(massif, hazardCells(stage, 'water'), 4)).toBe(true) // close to the lava
  })

  it('exactly one glowing crater/peak crowns the massif', () => {
    const stage = generateStage({ zone: 'autumn', variant: 'forest', layout: 'lake', cols: 44, rows: 34 })
    expect(stage.props.filter(p => p.label === 'peak')).toHaveLength(1)
  })

  it('feeds the water lake with a waterfall spill (verdant)', () => {
    const stage = generateStage({ zone: 'summer', variant: 'forest', layout: 'lake', cols: 44, rows: 34 })
    const spill = stage.props.filter(p => p.label === 'spill')
    expect(spill.length).toBeGreaterThan(0)
    expect(manhattanNear(spill, hazardCells(stage, 'water'), 3)).toBe(true)
  })
})

// ── organic lake edges: the hazard body should read like a natural lake / lava
//    flow with an irregular outline, NOT a clean geometric disc. A perfect disc's
//    boundary cells all sit ~one radius from the centroid (tiny spread); an
//    organic outline's boundary radius varies by several cells.
describe('generateStage — forest layout: lake has organic (irregular) edges', () => {
  const ORTHO_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const

  const lakeBoundaryRadiusSpread = (stage: ReturnType<typeof generateStage>): number => {
    const lake = hazardCells(stage, 'water')
    const inLake = new Set(lake.map(c => `${c.col},${c.row}`))
    const cx = lake.reduce((s, c) => s + c.col, 0) / lake.length
    const cy = lake.reduce((s, c) => s + c.row, 0) / lake.length
    const isBoundary = (c: { col: number; row: number }): boolean =>
      ORTHO_DIRS.some(([dc, dr]) => !inLake.has(`${c.col + dc},${c.row + dr}`))
    const radii = lake.filter(isBoundary).map(c => Math.hypot(c.col - cx, c.row - cy))
    return Math.max(...radii) - Math.min(...radii)
  }

  it('the lake outline is irregular, not a clean geometric disc', () => {
    // Average several runs — a perfect disc gives a boundary-radius spread of ~1
    // cell; an organic, wobbling outline varies by much more.
    let total = 0
    const runs = 6
    for (let i = 0; i < runs; i++) {
      total += lakeBoundaryRadiusSpread(generateStage({ zone: 'summer', variant: 'forest', layout: 'lake', cols: 44, rows: 34 }))
    }
    expect(total / runs).toBeGreaterThan(3)
  })
})

describe('generateStage — tree cells cast ground shadows (no floating trees)', () => {
  const BASE_LABELS = new Set(['tree_stem_bottom', 'tree_bottom', 'tree_bottom_left', 'tree_bottom_right'])
  // glade-tree upper-column cells whose shadow would float at canopy height
  const NO_SHADOW = new Set(['tree_crown', 'tree_leaf', 'tree_leaf_top', 'tree_stem'])

  it('casts on thicket + base cells, but NOT glade upper-column cells (would float)', () => {
    const stage = generateStage({ zone: 'summer', variant: 'forest', layout: 'passages', cols: 40, rows: 30 })
    const trees = stage.props.filter(p => p.type === 'tree')
    // every tree cell EXCEPT the glade upper-column casts a ground shadow (each thicket
    // cell renders its own grounded tree, so each needs a shadow)
    const grounded = trees.filter(p => !NO_SHADOW.has(p.label ?? ''))
    expect(grounded.length).toBeGreaterThan(0)
    expect(grounded.every(p => p.baseShadow === true)).toBe(true)
    // glade crown / leaf / upper-trunk never cast — their shadow would float
    const floaty = trees.filter(p => NO_SHADOW.has(p.label ?? ''))
    expect(floaty.every(p => !p.baseShadow)).toBe(true)
  })

  it('grounds bases even when another tree sits directly below (the bug we fixed)', () => {
    const stage = generateStage({ zone: 'summer', variant: 'forest', layout: 'passages', cols: 40, rows: 30 })
    const trees = stage.props.filter(p => p.type === 'tree')
    const set = new Set(trees.map(p => `${p.col},${p.row}`))
    const stackedBases = trees.filter(p => BASE_LABELS.has(p.label ?? '') && set.has(`${p.col},${p.row + 1}`))
    // every stacked base still carries baseShadow (would have been shadowless under pure geometry)
    expect(stackedBases.every(p => p.baseShadow === true)).toBe(true)
  })
})

describe('buildingCellColor — distinct per-type roofs + visible ornaments', () => {
  it('gives each building type a distinct roof color', () => {
    expect(buildingCellColor('store', 'roof', 1)).toBe('#2f6fb8') // blue store
    expect(buildingCellColor('hospital', 'roof', 1)).toBe('#3fa86a') // green hospital
    expect(buildingCellColor('store', 'roof', 1)).not.toBe(buildingCellColor('hospital', 'roof', 1))
  })

  it('makes doors dark + windows glassy (distinct from walls)', () => {
    expect(buildingCellColor('house', 'door', 1)).toBe('#241810')
    expect(buildingCellColor('house', 'window', 1)).toBe('#8fc4e6')
    expect(buildingCellColor('house', 'window', 1)).not.toBe(buildingCellColor('house', 'wall', 1))
  })

  it('varies house roof tone (red/brown/gray) by anchor so a street is not monotone', () => {
    const roofs = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(s => buildingCellColor('house', 'roof', s)))
    expect(roofs.size).toBeGreaterThan(1)
  })
})

describe('generateStage — building cells carry their TYPE (apex signage)', () => {
  it('tags every building cell with buildingType; village apexes include store + hospital', () => {
    const stage = generateStage({ zone: 'summer', variant: 'village' })
    const buildingCells = stage.props.filter(p => p.type === 'building')
    expect(buildingCells.length).toBeGreaterThan(0)
    expect(buildingCells.every(c => typeof c.buildingType === 'string' && c.buildingType!.length > 0)).toBe(true)
    const apexTypes = new Set(buildingCells.filter(c => c.label === 'roof_top').map(c => c.buildingType))
    expect(apexTypes.has('store')).toBe(true) // village guarantees a store…
    expect(apexTypes.has('hospital')).toBe(true) // …and a hospital
  })
})

describe('generateStage — windows have "lights on"', () => {
  it('lights some windows warm yellow while others stay glassy', () => {
    let lit = 0, glass = 0
    for (let i = 0; i < 8; i++) {
      const stage = generateStage({ zone: 'summer', variant: 'village', cols: 50, rows: 40 })
      for (const w of stage.props.filter(p => p.type === 'building' && p.label === 'window')) {
        if (w.color === '#ffd34d') lit++
        else glass++
      }
    }
    expect(lit).toBeGreaterThan(0) // some windows are lit
    expect(glass).toBeGreaterThan(0) // some windows are dark
  })
})

describe('generateStage — town & city scale up from village', () => {
  it('generates legal buildings + streets for town and city', () => {
    for (const variant of ['town', 'city'] as const) {
      const stage = generateStage({ zone: 'summer', variant, cols: 50, rows: 44 })
      expect(stage.buildings.length).toBeGreaterThan(0)
      expect(stage.ground.flat().filter(t => t === 'path_stone').length).toBeGreaterThan(0)
      expect(stage.collision[stage.spawn.row][stage.spawn.col]).toBe(false)
    }
  })

  it('cities have more buildings + less nature than villages', () => {
    let vBuild = 0, cBuild = 0, vTrees = 0, cTrees = 0
    for (let i = 0; i < 5; i++) {
      const v = generateStage({ zone: 'summer', variant: 'village', cols: 50, rows: 44 })
      const c = generateStage({ zone: 'summer', variant: 'city', cols: 50, rows: 44 })
      vBuild += v.buildings.length; cBuild += c.buildings.length
      vTrees += v.props.filter(p => p.type === 'tree').length
      cTrees += c.props.filter(p => p.type === 'tree').length
    }
    expect(cBuild).toBeGreaterThan(vBuild) // cities have more buildings
    expect(vTrees).toBeGreaterThan(cTrees) // villages have more nature
  })
})
