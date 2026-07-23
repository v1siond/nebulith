import '@/__tests__/helpers/installTilesetSeed' // the generator reads ALL tile data (terrain/canopy/decor) + building compositions from the loaded backend tileset fixture
import { installSeedTileset } from '@/__tests__/helpers/tilesetSeed'
import { generateStage, stagePaint, footprintEdgeClass, footprintSide, footprintRing, edgeToSide, treeSubpart, labelForCell, pickLivingTree } from '@/engine/stageGenerator'
import { BUILDING_DEPTH, buildingDoorOffset } from '@/engine/buildingCatalog'
import { parseColor } from '@/engine/colors'
import { resolveGroundTile, canopyCount, resolveComposition } from '@/engine/tileset/tileset'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'

// The zone canopy shades now live on the loaded backend `leaf_center` tile (settings.colors[zone]) —
// the data-driven replacement for the deleted frontend TREE_CANOPY_SHADES table.
const canopyShades = (zone: string): string[] =>
  ((ASCII_TILESET.tiles['leaf_center'].settings as { colors: Record<string, string[]> }).colors[zone]) ?? []

// The small GROUND footprint cells of a placed building: cols [col, col+length) × rows
// [row-(height-1), row] (length = grid col-span, height = grid row-span — both small now).
const footprintCells = (b: { col: number; row: number; length: number; height: number }) => {
  const cells: { col: number; row: number }[] = []
  const top = b.row - (b.height - 1)
  for (let r = top; r <= b.row; r++) for (let c = b.col; c < b.col + b.length; c++) cells.push({ col: c, row: r })
  return cells
}

describe('generateStage — town vertical slice', () => {
  const stage = generateStage({ zone: 'autumn', variant: 'town' })

  it('produces a town of the requested identity', () => {
    expect(stage.zone).toBe('autumn')
    expect(stage.variant).toBe('town')
    expect(stage.cols).toBeGreaterThan(0)
    expect(stage.rows).toBeGreaterThan(0)
  })

  it('carves streets as dark-gray ROAD tiles (not brown path, not the broken cavefloor)', () => {
    const allowed = new Set(['autumn_ground', 'autumn_leaves', 'road', 'path_stone']) // roads = the dark-gray 'road' tile; plaza/driveway keep brown path_stone
    const allThemed = stage.ground.every(row => row.every(t => allowed.has(t)))
    expect(allThemed).toBe(true)
    // streets ARE carved, placed as the 'road' tile (not a hijacked ground string)
    expect(stage.ground.flat().filter(t => t === 'road').length).toBeGreaterThan(0)
    // the broken cavefloor hijack is gone
    expect(stage.ground.flat().includes('cavefloor')).toBe(false)
    // and the road tile RESOLVES dark-gray in ASCII — assert the COMPOSITION, not just the string
    const bg = parseColor(resolveGroundTile(ASCII_TILESET, 'road', 0, 0).bg)!
    expect(Math.max(bg.r, bg.g, bg.b) - Math.min(bg.r, bg.g, bg.b)).toBeLessThan(24) // neutral gray
    expect((bg.r + bg.g + bg.b) / 3).toBeLessThan(110) // dark
  })

  it('sits each building on a brown path_stone BASE (brown freed from roads → building bases, ticket 2b)', () => {
    expect(stage.buildings.length).toBeGreaterThan(0)
    for (const b of stage.buildings) {
      for (const cell of footprintCells(b)) {
        expect(stage.ground[cell.row]?.[cell.col]).toBe('path_stone')
      }
    }
  })

  it('never scatters nature onto road cells — nature belongs on grass, not streets (Image #12)', () => {
    const roadCells = new Set<string>()
    stage.ground.forEach((r, row) => r.forEach((t, col) => { if (t === 'road' || t === 'road_center' || t === 'road_edge') roadCells.add(`${col},${row}`) }))
    expect(roadCells.size).toBeGreaterThan(0) // there ARE roads in a town
    const nature = new Set(['ground_decor', 'flower', 'tree', 'bush'])
    const natureOnRoad = stage.props.filter(p => nature.has(p.type) && roadCells.has(`${p.col},${p.row}`))
    expect(natureOnRoad.map(p => `${p.type}@${p.col},${p.row}`)).toEqual([])
  })

  it('places at least one building — each names a backend composition + faces a road with a door', () => {
    expect(stage.buildings.length).toBeGreaterThan(0)
    for (const b of stage.buildings) {
      // A building is a COMPOSITION now: it names its kind (house_4 / store_5 / …) and its footprint DEPTH
      // matches the composition's baked depth (small ground, not a tall facade).
      expect(b.kind).toMatch(/^(house|big_house|store|hospital|temple|cathedral|castle)_\d+$/)
      expect(b.depth).toBe(BUILDING_DEPTH[b.type])
      // The opening matches the composition's OWN door span (G7) — an odd facade bakes 1 door column, an
      // even one a centred 2-wide doorway — so it is read, never assumed to be 1.
      expect(b.doorCells).toHaveLength(buildingDoorOffset(b.kind)?.width ?? 0)
    }
  })

  it('blocks the whole small footprint EXCEPT the walkable road-facing door cells', () => {
    for (const b of stage.buildings) {
      expect(b.doorCells).toHaveLength(buildingDoorOffset(b.kind)?.width ?? 0)
      for (const door of b.doorCells) expect(stage.collision[door.row][door.col]).toBe(false) // the way in

      const cells = footprintCells(b)
      let blocked = 0
      let walkable = 0
      for (const { col, row } of cells) {
        if (stage.collision[row][col]) blocked++
        else walkable++
      }
      expect(blocked).toBe(b.length * b.height - b.doorCells.length) // every footprint cell blocks…
      expect(walkable).toBe(b.doorCells.length) // …except the door cells
    }
  })

  it('keeps the SMALL width×depth footprints disjoint and the spawn walkable', () => {
    const seen = new Set<string>()
    for (const b of stage.buildings) {
      for (const { col, row } of footprintCells(b)) {
        const key = `${col},${row}`
        expect(seen.has(key)).toBe(false)
        seen.add(key)
      }
    }
    expect(stage.collision[stage.spawn.row][stage.spawn.col]).toBe(false)
  })
})

describe('generateStage — a building reserves a small width×depth footprint (the collision blueprint)', () => {
  // A building no longer bakes flat per-cell props; it reserves its small width×depth GROUND footprint
  // (blocked, minus the door) and is STAMPED as its composition's tiles at load. So there are no
  // `type:'building'` props — the footprint reads purely from stage.buildings + stage.collision.
  it('emits NO flat building props — the building is stamped from its composition at load', () => {
    const stage = generateStage({ zone: 'autumn', variant: 'town' })
    expect(stage.buildings.length).toBeGreaterThan(0)
    expect(stage.props.filter(p => p.type === 'building')).toHaveLength(0)
  })

  it('reserves each footprint as blocked collision, only the door walkable, DEPTH = the composition depth', () => {
    const stage = generateStage({ zone: 'autumn', variant: 'town' })
    for (const b of stage.buildings) {
      const doors = new Set(b.doorCells.map(d => `${d.col},${d.row}`))
      const horizontal = b.facing === 'south' || b.facing === 'north'
      expect(horizontal ? b.height : b.length).toBe(BUILDING_DEPTH[b.type]) // small ground depth
      for (const { col, row } of footprintCells(b)) {
        const walkable = doors.has(`${col},${row}`)
        expect(stage.collision[row][col]).toBe(!walkable)
      }
    }
  })

  it('generates the temple INTERIOR as a walled dungeon with a boss altar (not a building)', () => {
    // The `temple` variant is now the temple INTERIOR dungeon (rooms/corridors/altar), so it
    // has NO overworld buildings — the temple STRUCTURE is a settlement building type instead
    // (see stageGenerator.temple.test.ts). Here we just assert the dungeon's signature content.
    const stage = generateStage({ zone: 'winter', variant: 'temple', cols: 36, rows: 30 })
    expect(stage.buildings).toHaveLength(0)
    const walls = stage.props.filter(p => p.type === 'temple_wall')
    expect(walls.length).toBeGreaterThan(0)
    expect(walls.every(w => w.blocking === true && stage.collision[w.row][w.col] === true)).toBe(true)
    expect(stage.props.some(p => p.type === 'altar')).toBe(true) // the boss chamber
    expect(stage.collision[stage.spawn.row][stage.spawn.col]).toBe(false) // walkable spawn
  })
})

describe('generateStage — forest archetype (Viridian-Forest style)', () => {
  const stage = generateStage({ zone: 'summer', variant: 'forest', cols: 30, rows: 24 })

  it('fills the forest with trees and walkable flowers', () => {
    const flowers = stage.props.filter(p => p.type === 'flower')
    expect(stage.trees.length).toBeGreaterThan(20) // trees are recorded as anchors, stamped as compositions at load
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

describe('generateStage — temple archetype (INTERIOR dungeon)', () => {
  // The `temple` variant is a room-and-corridor DUNGEON now (see stageGenerator.temple.test.ts
  // for the full suite). It has no overworld buildings — the temple STRUCTURE is a settlement
  // building type. These two smoke tests live alongside the other archetype slices.
  const stage = generateStage({ zone: 'autumn', variant: 'temple', cols: 36, rows: 30 })

  it('is a walled dungeon (no overworld buildings)', () => {
    expect(stage.buildings).toHaveLength(0)
    expect(stage.props.some(p => p.type === 'temple_wall' && p.blocking)).toBe(true)
  })

  it('builds a pillared hall + a boss altar, and keeps the spawn walkable', () => {
    expect(stage.props.some(p => p.type === 'pillar')).toBe(true)
    expect(stage.props.some(p => p.type === 'altar')).toBe(true)
    expect(stage.collision[stage.spawn.row][stage.spawn.col]).toBe(false)
  })
})

describe('generateStage — zone-tinted trees (varied canopy tones per zone)', () => {
  // The generator records a per-tree canopy VARIANT (an index into the zone palette); a forest uses many
  // variants so it reads in multiple tones, and a single anchor carries ONE variant → one tone per tree. The
  // variant→colour RESOLUTION (trunk one tone, distinct canopy shades, glyph+colour loaded from the DB tile) is
  // covered against the real tileset by treeComposition.test.ts — colour no longer lives on the generated props.
  const variantsFor = (zone: 'summer' | 'winter' | 'autumn'): Set<number> =>
    new Set(generateStage({ zone, variant: 'forest', cols: 40, rows: 30 }).trees.map(t => t.variant))

  it('uses MULTIPLE canopy variants per zone (varied tones, not one flat shade)', () => {
    for (const zone of ['summer', 'winter', 'autumn'] as const) {
      expect(variantsFor(zone).size).toBeGreaterThanOrEqual(2)
    }
  })

  it('keeps every anchor variant in range of its zone canopy count (from the loaded tile)', () => {
    const zone = 'summer'
    for (const v of variantsFor(zone)) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(canopyCount(ASCII_TILESET, zone))
    }
  })

  it('keeps EVERY zone canopy palette disjoint (no shared tone across all 7 zones)', () => {
    const all = ['spring', 'summer', 'autumn', 'winter', 'desert', 'beach', 'lava'].flatMap(canopyShades)
    expect(all.length).toBeGreaterThan(0)
    expect(new Set(all).size).toBe(all.length) // every tone unique → biomes never blur together
  })

  it('keeps the verdant forest classic — a green canopy shade in the summer palette', () => {
    expect(canopyShades('summer')).toContain('#2e8b2e')
  })
})

describe('generateStage — bare/dead trees (snags)', () => {
  it('scatters dead-tree anchors in a harsh-zone forest (burnt/frost-killed stems), all blocking', () => {
    // dead trees are a random fraction — sample several maps until one appears
    let snags = 0
    for (let i = 0; i < 8 && snags === 0; i++) {
      const stage = generateStage({ zone: 'autumn', variant: 'forest', layout: 'open', cols: 40, rows: 30 })
      const dead = stage.trees.filter(t => t.kind === 'tree_dead')
      if (dead.length > 0) {
        snags += dead.length
        // a dead tree is solid — its trunk-base cell blocks, same as a living one
        expect(dead.every(d => stage.collision[d.row][d.col] === true)).toBe(true)
      }
    }
    expect(snags).toBeGreaterThan(0)
  })
})

describe('generateStage — trees are recorded as stacked-composition anchors (the keystone)', () => {
  // Trees are no longer baked as flat per-cell props; the generator RECORDS anchors and applyStageToGrid
  // stamps each as a composition (per-cell heightLevel-stacked DB tiles) — the same model buildings use, so
  // every tile is selectable. The stacked-block shape + glyph/colour are covered by treeComposition.test.ts.
  const stage = generateStage({ zone: 'summer', variant: 'forest', cols: 30, rows: 24 })

  const TREE_KINDS = new Set(['tree', 'tree_tall', 'tree_stub', 'tree_round', 'bush', 'bush_round', 'tree_dead'])

  it('records tree ANCHORS (not flat props) — each names a living-tree composition kind + canopy variant', () => {
    expect(stage.trees.length).toBeGreaterThan(0)
    expect(stage.props.filter(p => p.type === 'tree')).toHaveLength(0) // trees no longer bake flat props
    expect(stage.trees.every(t => TREE_KINDS.has(t.kind))).toBe(true)
    expect(stage.trees.every(t => Number.isInteger(t.variant) && t.variant >= 0)).toBe(true)
  })

  it('RANDOMIZES the tree shapes — a forest shows MULTIPLE variants, not one repeated shape', () => {
    const kinds = new Set(stage.trees.map(t => t.kind))
    expect(kinds.size).toBeGreaterThanOrEqual(3) // standard + several of tall/small/round/bush appear
  })

  it('blocks EVERY tree anchor cell — trees are fully solid (no passable cell to step into)', () => {
    expect(stage.trees.length).toBeGreaterThan(0)
    for (const t of stage.trees) expect(stage.collision[t.row][t.col]).toBe(true)
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
  generateStage(opts).trees.length

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

// Tree GROUNDING (a shadow under the trunk base so a tree never looks floaty) now lives on the stamped
// composition — the level-0 tile carries baseShadow — not on generated props. It is covered against the grid
// by treeComposition.test.ts ('the grounded trunk base casts a shadow').

describe('generateStage — buildings are backend COMPOSITIONS (store + hospital guaranteed, cells labeled)', () => {
  beforeAll(() => installSeedTileset()) // re-assert the fixture so resolveComposition is never seen empty (cross-file safety)

  it('a settlement guarantees a store + a hospital, and bakes NO flat building props', () => {
    const stage = generateStage({ zone: 'summer', variant: 'town' })
    expect(stage.buildings.some(b => b.type === 'store')).toBe(true) // the settlement guarantees a store…
    expect(stage.buildings.some(b => b.type === 'hospital')).toBe(true) // …and a hospital
    expect(stage.props.filter(p => p.type === 'building')).toHaveLength(0) // a building IS its composition
  })

  it("each building's composition (from the loaded tileset) carries wall + door + roof cells that stack", () => {
    const stage = generateStage({ zone: 'summer', variant: 'town', cols: 50, rows: 40 })
    expect(stage.buildings.length).toBeGreaterThan(0)
    for (const b of stage.buildings) {
      const comp = resolveComposition(ASCII_TILESET, b.kind)
      expect(comp).not.toBeNull()
      const cellLabels = comp!.cells.map(c => c.label)
      // Each building has wall + door cells + a ROOF CAP — matched by FAMILY since store/hospital/houses
      // use type-specific tiles (roof_store / wall_house_b …) while big_house/temple/… keep the base
      // labels. The cap is a gable `roof`/`roof_top` OR a flat `parapet`/`flat_roof` (store/office).
      for (const part of ['wall', 'door']) expect(cellLabels.some(l => l.startsWith(part))).toBe(true)
      const roofish = (l: string): boolean => l.startsWith('roof') || l.startsWith('parapet') || l.startsWith('flat_roof')
      expect(cellLabels.some(roofish)).toBe(true)
      // Walls rise MULTIPLE stack levels (the iso box is built from stacked wall blocks + a roof cap).
      expect(Math.max(...comp!.cells.map(c => c.level ?? 0))).toBeGreaterThan(0)
    }
  })

  it('a store composition has WINDOW cells (a glassy facade) and exactly ONE walkable door', () => {
    const comp = resolveComposition(ASCII_TILESET, 'store_5')
    expect(comp).not.toBeNull()
    expect(comp!.cells.some(c => c.label === 'window')).toBe(true)
    expect(comp!.cells.filter(c => (c.level ?? 0) === 0 && c.label === 'door')).toHaveLength(1)
  })
})

describe('generateStage — town & city both build legal stages', () => {
  it('generates legal buildings + streets for town and city', () => {
    for (const variant of ['town', 'city'] as const) {
      const stage = generateStage({ zone: 'summer', variant, cols: 50, rows: 44 })
      expect(stage.buildings.length).toBeGreaterThan(0)
      expect(stage.ground.flat().filter(t => t === 'path_stone').length).toBeGreaterThan(0)
      expect(stage.collision[stage.spawn.row][stage.spawn.col]).toBe(false)
    }
  })

  it('cities have more buildings + less nature than towns', () => {
    let tBuild = 0, cBuild = 0, tTrees = 0, cTrees = 0
    for (let i = 0; i < 5; i++) {
      const t = generateStage({ zone: 'summer', variant: 'town', cols: 50, rows: 44 })
      const c = generateStage({ zone: 'summer', variant: 'city', cols: 50, rows: 44 })
      tBuild += t.buildings.length; cBuild += c.buildings.length
      tTrees += t.trees.length
      cTrees += c.trees.length
    }
    expect(cBuild).toBeGreaterThan(tBuild) // cities have more buildings
    expect(tTrees).toBeGreaterThan(cTrees) // leafier towns have more nature
  })
})

// Door + its driveway sit one step toward the road (mirrors stageGenerator.FACING_STEP).
const FACING_STEP: Record<string, [number, number]> = {
  south: [0, 1],
  north: [0, -1],
  east: [1, 0],
  west: [-1, 0],
}

describe('generateStage — a settlement guarantees a store + a hospital', () => {
  it('places at least one store building and one hospital building', () => {
    const stage = generateStage({ zone: 'summer', variant: 'town' })
    expect(stage.buildings.some(b => b.type === 'store')).toBe(true)
    expect(stage.buildings.some(b => b.type === 'hospital')).toBe(true)
  })
})

describe('generateStage — a driveway crosses the setback from every door to its street', () => {
  it('paints ≥1 path_stone cell toward the road for every building', () => {
    const stage = generateStage({ zone: 'summer', variant: 'town' })
    const paved = new Set(
      stagePaint(stage).ground.filter(g => g.type === 'path_stone').map(g => `${g.col},${g.row}`),
    )
    expect(stage.buildings.length).toBeGreaterThan(0)
    for (const b of stage.buildings) {
      const door = b.doorCells[0]
      const [dc, dr] = FACING_STEP[b.facing]
      expect(paved.has(`${door.col + dc},${door.row + dr}`)).toBe(true) // driveway between door + street
    }
  })
})

describe('generateStage — lamps never block a door or its driveway', () => {
  it('places no lamp prop on a building door cell or its driveway cell', () => {
    for (let i = 0; i < 6; i++) {
      const stage = generateStage({ zone: 'summer', variant: 'town' })
      const lamps = new Set(stage.props.filter(p => p.type === 'lamp').map(p => `${p.col},${p.row}`))
      for (const b of stage.buildings) {
        const door = b.doorCells[0]
        const [dc, dr] = FACING_STEP[b.facing]
        expect(lamps.has(`${door.col},${door.row}`)).toBe(false) // never on the door
        expect(lamps.has(`${door.col + dc},${door.row + dr}`)).toBe(false) // never on the driveway
      }
    }
  })
})

describe('footprintEdgeClass — corner/edge/interior tileset classification (#41)', () => {
  // A 4-wide × 3-deep footprint rect at (10,5): cols 10..13, rows 5..7.
  const rect = { col: 10, row: 5, w: 4, h: 3 }

  it('classifies the four corners', () => {
    expect(footprintEdgeClass(10, 5, rect)).toBe('nw') // top-left
    expect(footprintEdgeClass(13, 5, rect)).toBe('ne') // top-right
    expect(footprintEdgeClass(10, 7, rect)).toBe('sw') // bottom-left
    expect(footprintEdgeClass(13, 7, rect)).toBe('se') // bottom-right
  })

  it('classifies the four edges (non-corner border cells)', () => {
    expect(footprintEdgeClass(11, 5, rect)).toBe('n') // top edge
    expect(footprintEdgeClass(12, 7, rect)).toBe('s') // bottom edge
    expect(footprintEdgeClass(10, 6, rect)).toBe('w') // left edge
    expect(footprintEdgeClass(13, 6, rect)).toBe('e') // right edge
  })

  it('classifies an interior cell', () => {
    expect(footprintEdgeClass(11, 6, rect)).toBe('interior')
    expect(footprintEdgeClass(12, 6, rect)).toBe('interior')
  })

  it('collapses degenerate footprints (thin strips and a single cell)', () => {
    const strip1xN = { col: 4, row: 4, w: 1, h: 3 } // 1-wide column → nw/w/sw
    expect(footprintEdgeClass(4, 4, strip1xN)).toBe('nw')
    expect(footprintEdgeClass(4, 5, strip1xN)).toBe('w')
    expect(footprintEdgeClass(4, 6, strip1xN)).toBe('sw')

    const stripNx1 = { col: 4, row: 4, w: 3, h: 1 } // 1-deep row → nw/n/ne
    expect(footprintEdgeClass(4, 4, stripNx1)).toBe('nw')
    expect(footprintEdgeClass(5, 4, stripNx1)).toBe('n')
    expect(footprintEdgeClass(6, 4, stripNx1)).toBe('ne')

    expect(footprintEdgeClass(0, 0, { col: 0, row: 0, w: 1, h: 1 })).toBe('nw') // 1×1 → nw
  })

})

describe('labelForCell — ONE consistent debug-label standard across every element', () => {
  // A 3×3 footprint at (10,5): cols 10..12, rows 5..7 — the canonical multi-cell element.
  const rect = { col: 10, row: 5, w: 3, h: 3 }

  it('footprintSide yields the 4 corners + 4 edges + INTERIOR centre of a 3×3', () => {
    // corners
    expect(footprintSide(10, 5, rect)).toBe('TOP-LEFT')
    expect(footprintSide(12, 5, rect)).toBe('TOP-RIGHT')
    expect(footprintSide(10, 7, rect)).toBe('BOTTOM-LEFT')
    expect(footprintSide(12, 7, rect)).toBe('BOTTOM-RIGHT')
    // edges
    expect(footprintSide(11, 5, rect)).toBe('TOP')
    expect(footprintSide(11, 7, rect)).toBe('BOTTOM')
    expect(footprintSide(10, 6, rect)).toBe('LEFT')
    expect(footprintSide(12, 6, rect)).toBe('RIGHT')
    // centre
    expect(footprintSide(11, 6, rect)).toBe('INTERIOR')
  })

  it('edgeToSide maps a BuildingEdge class to the shared TOP/BOTTOM/LEFT/RIGHT caption token', () => {
    expect(edgeToSide('nw')).toBe('TOP-LEFT')
    expect(edgeToSide('s')).toBe('BOTTOM')
    expect(edgeToSide('interior')).toBe('INTERIOR')
  })

  it('labels a building footprint cell as "<TYPE> <SIDE>" (the existing scheme, via the shared helper)', () => {
    expect(labelForCell('building', footprintSide(10, 5, rect))).toBe('BUILDING TOP-LEFT')
    expect(labelForCell('building', footprintSide(11, 5, rect))).toBe('BUILDING TOP')
    expect(labelForCell('building', footprintSide(11, 6, rect))).toBe('BUILDING INTERIOR')
  })

  it('labels a tree by TRUNK vs CANOPY-side (column stems + autotiled canopy + apex)', () => {
    // vertical column tree: stems are the trunk, the cap is the canopy top
    expect(treeSubpart('tree_stem_bottom')).toBe('TRUNK')
    expect(treeSubpart('tree_stem')).toBe('TRUNK')
    expect(treeSubpart('tree_snag')).toBe('TRUNK')
    expect(treeSubpart('tree_crown')).toBe('CANOPY TOP')
    expect(treeSubpart('tree_leaf_top')).toBe('CANOPY TOP')
    expect(treeSubpart('tree_leaf')).toBe('CANOPY')
    // autotiled forest mass: the canopy gets corner/edge sides, mirroring a building footprint
    expect(treeSubpart('tree_top_left')).toBe('CANOPY TOP-LEFT')
    expect(treeSubpart('tree_top')).toBe('CANOPY TOP')
    expect(treeSubpart('tree_edge_right')).toBe('CANOPY RIGHT')
    expect(treeSubpart('tree_interior')).toBe('CANOPY INTERIOR')
    expect(treeSubpart('tree_bottom_right')).toBe('CANOPY BOTTOM-RIGHT')
    // assembled captions read "TREE TRUNK" / "TREE CANOPY TOP-LEFT"
    expect(labelForCell('tree', treeSubpart('tree_stem'))).toBe('TREE TRUNK')
    expect(labelForCell('tree', treeSubpart('tree_top_left'))).toBe('TREE CANOPY TOP-LEFT')
  })

  it('labels a single-cell element as just its TYPE (no spurious position)', () => {
    expect(labelForCell('lamp')).toBe('LAMP')
    expect(labelForCell('lamp', treeSubpart(undefined))).toBe('LAMP') // unknown sub-part → bare type
    expect(labelForCell('flower')).toBe('FLOWER')
    expect(labelForCell('ground_decor')).toBe('GROUND_DECOR')
  })

  it('labels a fountain basin like a building footprint: rim sides + WATER ring + CENTER', () => {
    // 3×3 fountain → rim ring (corners/edges) + a single CENTER cell, no water ring.
    const f3 = { col: 0, row: 0, w: 3, h: 3 }
    const fountainPos = (col: number, row: number, r: typeof f3): string => {
      const side = footprintSide(col, row, r)
      if (side !== 'INTERIOR') return side
      const maxRing = Math.floor((Math.min(r.w, r.h) - 1) / 2)
      return footprintRing(col, row, r) >= maxRing ? 'CENTER' : 'WATER'
    }
    expect(labelForCell('fountain', fountainPos(0, 0, f3))).toBe('FOUNTAIN TOP-LEFT') // rim corner
    expect(labelForCell('fountain', fountainPos(1, 0, f3))).toBe('FOUNTAIN TOP')  // rim edge
    expect(labelForCell('fountain', fountainPos(1, 1, f3))).toBe('FOUNTAIN CENTER')
    // 5×5 fountain → rim, then a WATER ring, then the CENTER cell.
    const f5 = { col: 0, row: 0, w: 5, h: 5 }
    expect(labelForCell('fountain', fountainPos(0, 0, f5))).toBe('FOUNTAIN TOP-LEFT') // rim corner
    expect(labelForCell('fountain', fountainPos(1, 1, f5))).toBe('FOUNTAIN WATER') // inner ring
    expect(labelForCell('fountain', fountainPos(2, 2, f5))).toBe('FOUNTAIN CENTER')
    expect(footprintRing(0, 0, f5)).toBe(0) // rim
    expect(footprintRing(2, 2, f5)).toBe(2) // centre
  })

  it('produces the SAME caption string regardless of which view asks (no drift)', () => {
    // The label is a pure function of (type, resolved position) — identical inputs, identical output.
    const inputs: Array<[string, string]> = [
      ['building', footprintSide(12, 7, rect)],
      ['tree', treeSubpart('tree_top_right')],
      ['fountain', footprintSide(10, 5, { col: 10, row: 5, w: 3, h: 3 })],
      ['lamp', ''],
    ]
    for (const [type, pos] of inputs) {
      expect(labelForCell(type, pos)).toBe(labelForCell(type, pos)) // deterministic, view-agnostic
    }
    expect(labelForCell('building', 'TOP-RIGHT')).toBe('BUILDING TOP-RIGHT')
    expect(labelForCell('tree', 'CANOPY TOP-RIGHT')).toBe('TREE CANOPY TOP-RIGHT')
  })
})

describe('pickLivingTree — weighted random tree-shape variety', () => {
  it('spans the FULL variant set across the [0,1) roll range (no shape is unreachable)', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 1000; i++) seen.add(pickLivingTree(i / 1000))
    expect(seen).toEqual(new Set(['tree', 'tree_tall', 'tree_round', 'tree_stub', 'bush', 'bush_round']))
  })

  it('is deterministic for a given roll and stays in-bounds at the edges', () => {
    expect(pickLivingTree(0)).toBe('tree') // the dominant standard tree leads the table
    expect(pickLivingTree(0)).toBe(pickLivingTree(0)) // pure
    expect(pickLivingTree(0.9999)).toBe('bush_round') // last slice → the final variant, never out of range
  })
})
