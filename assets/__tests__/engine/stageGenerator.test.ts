import { generateStage, buildingCellColor, stagePaint, footprintEdgeClass, footprintSide, footprintRing, edgeToSide, treeSubpart, labelForCell } from '@/engine/stageGenerator'
import { composeBuilding } from '@/engine/buildingComposer'
import { TREE_CANOPY_SHADES } from '@/engine/cellTileset'
import { parseColor } from '@/engine/colors'

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

  it('themes the ground with the zone palette (streets are dark-gray cavefloor)', () => {
    const allowed = new Set(['autumn_ground', 'autumn_leaves', 'cavefloor', 'path_stone']) // roads = dark-gray cavefloor; plaza/driveway keep brown path_stone
    const allThemed = stage.ground.every(row => row.every(t => allowed.has(t)))
    expect(allThemed).toBe(true)
    // and there ARE streets — a real settlement, not bare ground
    expect(stage.ground.flat().filter(t => t === 'cavefloor').length).toBeGreaterThan(0)
  })

  it('places at least one legal building (facade >=2 long, >=5 tall, with a door)', () => {
    expect(stage.buildings.length).toBeGreaterThan(0)
    for (const b of stage.buildings) {
      // Legality is a property of the FACADE; col/row/length/height now describe the oriented
      // footprint rect (length/height SWAP for east/west-facing buildings), so assert b.facade.
      expect(b.facade.length).toBeGreaterThanOrEqual(2) // houses scale down to 2-wide cottages
      expect(b.facade.height).toBeGreaterThanOrEqual(5) // 3 body + 2 roof minimum
      expect(b.doorCells.length).toBeGreaterThan(0)
    }
  })

  it('blocks the whole small footprint EXCEPT the walkable road-facing door (its full drawn width)', () => {
    for (const b of stage.buildings) {
      // The door opens its FULL drawn width: `door.width` cells on axis-aligned facades (2 on even
      // frontages, #49), 1 cell on rotated ones (the 2D facade collapses those to a single edge cell).
      const axis = b.facing === 'south' || b.facing === 'north'
      expect(b.doorCells).toHaveLength(axis ? b.facade.door.width : 1)
      for (const door of b.doorCells) expect(stage.collision[door.row][door.col]).toBe(false) // the way in

      const cells = footprintCells(b)
      let blocked = 0
      let walkable = 0
      for (const { col, row } of cells) {
        if (stage.collision[row][col]) blocked++
        else walkable++
      }
      expect(blocked).toBe(b.length * b.height - b.doorCells.length) // every footprint cell blocks…
      expect(walkable).toBe(b.doorCells.length) // …except the door cell(s)
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

describe('generateStage — small-footprint labeled buildings (the shared collision blueprint)', () => {
  // A building stamps only its small width×depth GROUND footprint as labeled cells — a roof from
  // above plus ONE walkable door. The facade's vertical elevation is render-only (b.facade), never
  // stamped flat on the ground (that was the old facade-as-footprint sprawl).
  const collectBuildingCells = (stage: ReturnType<typeof generateStage>) =>
    stage.props.filter(p => p.type === 'building')

  it('emits ONE labeled building prop per footprint cell (small width×depth, NOT facade-deep)', () => {
    const stage = generateStage({ zone: 'autumn', variant: 'town' })
    const cells = collectBuildingCells(stage)
    expect(cells.length).toBeGreaterThan(0)
    expect(cells.every(c => typeof c.label === 'string' && c.label!.length > 0)).toBe(true)
    for (const b of stage.buildings) {
      const own = cells.filter(
        c => c.col >= b.col && c.col < b.col + b.length && c.row <= b.row && c.row > b.row - b.height,
      )
      expect(own.length).toBe(b.length * b.height) // EXACTLY the footprint — no facade-deep overdraw
      // and the perpendicular extent is the composer's small DEPTH, decoupled from the facade height
      const depth = composeBuilding({ type: b.type, length: b.facade.length }).depth
      const horizontal = b.facing === 'south' || b.facing === 'north'
      expect(horizontal ? b.height : b.length).toBe(depth)
      expect(depth).toBeLessThan(b.facade.height)
    }
  })

  it('blocks every footprint cell EXCEPT the single walkable door', () => {
    const stage = generateStage({ zone: 'autumn', variant: 'town' })
    for (const c of collectBuildingCells(stage)) {
      const walkable = c.label === 'door'
      expect(c.blocking).toBe(!walkable)
      expect(stage.collision[c.row][c.col]).toBe(!walkable)
    }
  })

  it('opens the full drawn door width as walkable door cells in each footprint', () => {
    const stage = generateStage({ zone: 'autumn', variant: 'town' })
    const cells = collectBuildingCells(stage)
    for (const b of stage.buildings) {
      const doors = cells.filter(
        c =>
          c.label === 'door' &&
          c.col >= b.col &&
          c.col < b.col + b.length &&
          c.row <= b.row &&
          c.row > b.row - b.height,
      )
      // axis-aligned facades draw (and open) the door at its full width; rotated collapse to 1 cell.
      const axis = b.facing === 'south' || b.facing === 'north'
      expect(doors).toHaveLength(axis ? b.facade.door.width : 1)
      for (const d of doors) {
        expect(d.blocking).toBe(false)
        expect(stage.collision[d.row][d.col]).toBe(false)
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
    expect(buildingCellColor('store', 'roof', 1)).toBe('#235a96') // dark blue store
    expect(buildingCellColor('hospital', 'roof', 1)).toBe('#2f7e50') // dark green hospital
    expect(buildingCellColor('store', 'roof', 1)).not.toBe(buildingCellColor('hospital', 'roof', 1))
  })

  it('makes doors dark + windows glassy (distinct from walls)', () => {
    expect(buildingCellColor('store', 'door', 1)).toBe('#26414f') // store door stays its identity tone
    expect(buildingCellColor('house', 'window', 1)).toBe('#8fc4e6')
    expect(buildingCellColor('house', 'window', 1)).not.toBe(buildingCellColor('house', 'wall', 1))
  })

  it('varies house roof tone (red/brown/gray) by anchor so a street is not monotone', () => {
    const roofs = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(s => buildingCellColor('house', 'roof', s)))
    expect(roofs.size).toBeGreaterThan(1)
  })
})

describe('generateStage — building cells carry their TYPE (top-view signage)', () => {
  it('tags every footprint cell with buildingType; a settlement includes a store + hospital', () => {
    const stage = generateStage({ zone: 'summer', variant: 'town' })
    const buildingCells = stage.props.filter(p => p.type === 'building')
    expect(buildingCells.length).toBeGreaterThan(0)
    expect(buildingCells.every(c => typeof c.buildingType === 'string' && c.buildingType!.length > 0)).toBe(true)
    const types = new Set(buildingCells.map(c => c.buildingType))
    expect(types.has('store')).toBe(true) // the settlement guarantees a store…
    expect(types.has('hospital')).toBe(true) // …and a hospital
  })
})

describe('generateStage — windows live in the facade (render-only), not on the ground', () => {
  it('keeps windows in the building facade but NEVER stamps them as ground props', () => {
    const stage = generateStage({ zone: 'summer', variant: 'town', cols: 50, rows: 40 })
    expect(stage.buildings.length).toBeGreaterThan(0)
    // the facade (used by the 2D/iso renders) still carries windows…
    const hasFacadeWindows = stage.buildings.some(b => b.facade.cells.some(row => row.some(k => k === 'window')))
    expect(hasFacadeWindows).toBe(true)
    // …but the small ground footprint is the per-cell tile model — perimeter WALL + interior ROOF + the
    // single DOOR (windows stay in the facade, NEVER stamped as ground props).
    const windowProps = stage.props.filter(p => p.type === 'building' && p.label === 'window')
    expect(windowProps).toHaveLength(0)
    const groundLabels = new Set(stage.props.filter(p => p.type === 'building').map(p => p.label))
    expect([...groundLabels].sort()).toEqual(['door', 'roof', 'wall'])
  })
})

describe('generateStage — buildings stamp the 2D+3D tile model (perimeter WALL cells carry block height)', () => {
  it('stamps the perimeter as WALL cells that rise ≥1 iso block; door/roof stay flat', () => {
    const stage = generateStage({ zone: 'summer', variant: 'town', cols: 50, rows: 40 })
    const buildingProps = stage.props.filter(p => p.type === 'building')
    const walls = buildingProps.filter(p => p.label === 'wall')
    // Perimeter is WALL now (not a filled roof-rect) — the iso render extrudes these into the box.
    expect(walls.length).toBeGreaterThan(0)
    expect(walls.every(w => (w.height ?? 0) >= 1)).toBe(true) // each wall rises `floors` blocks
    // Flat cells (the interior roof cap + the door) stay height 0 — they don't extrude.
    const flat = buildingProps.filter(p => p.label !== 'wall')
    expect(flat.every(p => (p.height ?? 0) === 0)).toBe(true)
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
      tTrees += t.props.filter(p => p.type === 'tree').length
      cTrees += c.props.filter(p => p.type === 'tree').length
    }
    expect(cBuild).toBeGreaterThan(tBuild) // cities have more buildings
    expect(tTrees).toBeGreaterThan(cTrees) // leafier towns have more nature
  })
})

// Luminance of any renderer color (hex or rgb()/rgba()), via the shared parser.
const luminance = (color: string): number => {
  const c = parseColor(color)
  if (!c) throw new Error(`unparseable color: ${color}`)
  return c.r + c.g + c.b
}

// Door + its driveway sit one step toward the road (mirrors stageGenerator.FACING_STEP).
const FACING_STEP: Record<string, [number, number]> = {
  south: [0, 1],
  north: [0, -1],
  east: [1, 0],
  west: [-1, 0],
}

describe('buildingCellColor — randomized per-house colors (street isn\'t monotone)', () => {
  const SEEDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 13, 17, 19, 23, 29]

  it('varies the house WALL color across buildings (not all identical)', () => {
    const walls = new Set(SEEDS.map(s => buildingCellColor('house', 'wall', s)))
    expect(walls.size).toBeGreaterThan(1)
  })

  it('keeps every house DOOR strictly darker than + different from its wall', () => {
    for (const s of SEEDS) {
      const wall = buildingCellColor('house', 'wall', s)
      const door = buildingCellColor('house', 'door', s)
      expect(door).not.toBe(wall)
      expect(luminance(door)).toBeLessThan(luminance(wall))
    }
  })

  it('keeps store + hospital DETERMINISTIC (their identity must not wobble per building)', () => {
    for (const type of ['store', 'hospital'] as const) {
      for (const label of ['wall', 'door', 'roof'] as const) {
        const a = buildingCellColor(type, label, 1)
        const b = buildingCellColor(type, label, 42)
        const c = buildingCellColor(type, label, 137)
        expect(new Set([a, b, c]).size).toBe(1) // same color regardless of anchor
      }
    }
  })
})

describe('generateStage — a settlement guarantees a store + a hospital with distinct palettes', () => {
  it('places at least one store building and one hospital building', () => {
    const stage = generateStage({ zone: 'summer', variant: 'town' })
    expect(stage.buildings.some(b => b.type === 'store')).toBe(true)
    expect(stage.buildings.some(b => b.type === 'hospital')).toBe(true)
  })

  it('gives the store + hospital distinct identity palettes (blue store, green hospital)', () => {
    expect(buildingCellColor('store', 'roof', 1)).not.toBe(buildingCellColor('hospital', 'roof', 1))
    expect(buildingCellColor('store', 'wall', 1)).not.toBe(buildingCellColor('hospital', 'wall', 1))
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

describe('generateStage — the door reads as a DARK marker on the grid', () => {
  const brightness = (hex: string) => {
    const n = parseInt(hex.slice(1), 16)
    return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255)
  }
  it('paints the door footprint cell DARK so the entrance reads from above', () => {
    const stage = generateStage({ zone: 'summer', variant: 'town' })
    const doors = stage.props.filter(p => p.type === 'building' && p.label === 'door')
    expect(doors.length).toBeGreaterThan(0)
    expect(doors.every(d => brightness(d.color) < 240)).toBe(true) // dark entrance
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

  it('surfaces edge classes on generated building footprint cells (4 corners + interiors)', () => {
    const stage = generateStage({ zone: 'autumn', variant: 'town' })
    const buildingCells = stage.props.filter(p => p.type === 'building')
    expect(buildingCells.length).toBeGreaterThan(0)
    expect(buildingCells.every(c => c.edge !== undefined)).toBe(true)
    // Across a town there is at least one of each corner among the footprints.
    const edges = new Set(buildingCells.map(c => c.edge))
    for (const corner of ['nw', 'ne', 'sw', 'se']) expect(edges.has(corner as never)).toBe(true)
    // stagePaint carries the edge through to the render layer.
    const painted = stagePaint(stage).assets.filter(a => a.type === 'building')
    expect(painted.every(a => a.edge !== undefined)).toBe(true)
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
