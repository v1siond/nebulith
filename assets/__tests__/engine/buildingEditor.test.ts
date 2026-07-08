import {
  gridBuildingFacing,
  isoOrientation,
  buildingRect,
  buildingDoorCell,
  doorCellFor,
  buildingFootprintCells,
  footprintContains,
  isDoorCell,
  facadeLength,
  footprintCenter,
  canPlaceBuilding,
  buildingCellBlocked,
  ROAD_GROUND,
  isRoadGround,
  moveBuilding,
  rotateBuilding,
  resizeBuilding,
  orientBuilding,
  makeBuilding,
  FACING_CYCLE,
  type PlacementEnv,
} from '../../engine/buildingEditor'
import { composeBuilding } from '../../engine/buildingComposer'
import type { GridBuilding } from '../../engine/IsometricGrid'
import type { Facing } from '../../engine/villageLayout'

// A south-facing house: footprint length × depth (cols × rows), `row` is the BOTTOM row.
const house = (over: Partial<GridBuilding> = {}): GridBuilding => ({
  col: 10,
  row: 12, // bottom row
  length: 4,
  height: 3, // depth rows
  depth: 3,
  type: 'house',
  cells: composeBuilding({ type: 'house' }).cells,
  facing: 0,
  facadeOnBack: false,
  ...over,
})

describe('gridBuildingFacing — reconstruct the 4-way facing from iso fields', () => {
  test('maps all four (facing index, facadeOnBack) combos back to the road facing', () => {
    expect(gridBuildingFacing(house({ facing: 0, facadeOnBack: false }))).toBe('south')
    expect(gridBuildingFacing(house({ facing: 0, facadeOnBack: true }))).toBe('north')
    expect(gridBuildingFacing(house({ facing: 1, facadeOnBack: false }))).toBe('east')
    expect(gridBuildingFacing(house({ facing: 1, facadeOnBack: true }))).toBe('west')
  })

  test('is the exact inverse of isoOrientation for every facing', () => {
    const facings: Facing[] = ['south', 'north', 'east', 'west']
    for (const f of facings) {
      const iso = isoOrientation(f)
      expect(gridBuildingFacing(house({ facing: iso.facing, facadeOnBack: iso.facadeOnBack }))).toBe(f)
    }
  })
})

describe('buildingRect — derive the footprint rect (row is the bottom)', () => {
  test('top-left is (col, row-(height-1)); span is length × height', () => {
    expect(buildingRect(house())).toEqual({ col: 10, row: 10, w: 4, h: 3 })
  })
})

describe('doorCellFor / buildingDoorCell — door on the road-facing edge', () => {
  const rect = { col: 10, row: 10, w: 4, h: 3 }
  test('south = bottom edge centre', () => {
    expect(doorCellFor('south', rect)).toEqual({ col: 12, row: 12 })
  })
  test('north = top edge centre', () => {
    expect(doorCellFor('north', rect)).toEqual({ col: 12, row: 10 })
  })
  test('east = right edge centre', () => {
    expect(doorCellFor('east', rect)).toEqual({ col: 13, row: 11 })
  })
  test('west = left edge centre', () => {
    expect(doorCellFor('west', rect)).toEqual({ col: 10, row: 11 })
  })
  test('buildingDoorCell uses the reconstructed facing', () => {
    expect(buildingDoorCell(house())).toEqual({ col: 12, row: 12 }) // south
    expect(buildingDoorCell(house({ facing: 1, facadeOnBack: false }))).toEqual(
      doorCellFor('east', buildingRect(house({ facing: 1, facadeOnBack: false }))),
    )
  })
})

describe('buildingFootprintCells — the cells it occupies + the door', () => {
  test('covers the whole rect (length × height cells) and marks one door', () => {
    const { cells, door } = buildingFootprintCells(house())
    expect(cells).toHaveLength(4 * 3)
    expect(cells).toContainEqual({ col: 10, row: 10 })
    expect(cells).toContainEqual({ col: 13, row: 12 })
    expect(door).toEqual({ col: 12, row: 12 })
    // The door is one of the footprint cells (a walkable exception inside the rect).
    expect(cells).toContainEqual(door)
  })

  test('exactly one footprint cell is the door (the invariant: rest block)', () => {
    const b = house()
    const { cells } = buildingFootprintCells(b)
    const doorCount = cells.filter(c => isDoorCell(b, c.col, c.row)).length
    expect(doorCount).toBe(1)
  })
})

describe('footprintContains', () => {
  test('true inside the rect, false outside', () => {
    const b = house()
    expect(footprintContains(b, 10, 10)).toBe(true)
    expect(footprintContains(b, 13, 12)).toBe(true)
    expect(footprintContains(b, 9, 10)).toBe(false)
    expect(footprintContains(b, 14, 12)).toBe(false)
    expect(footprintContains(b, 10, 13)).toBe(false)
  })
})

describe('facadeLength / footprintCenter', () => {
  test('facadeLength is the road-parallel span regardless of orientation', () => {
    expect(facadeLength(house())).toBe(4) // horizontal → length
    expect(facadeLength(house({ facing: 1, length: 3, height: 4 }))).toBe(4) // vertical → height
  })
  test('footprintCenter is the rect centre cell', () => {
    expect(footprintCenter(house())).toEqual({ col: 12, row: 11 })
  })
})

describe('resizeBuilding — grow/shrink the facade length, re-extruded in place', () => {
  test('a south house grows its length, re-composing the facade, keeping the centre', () => {
    const before = house() // length 4, centre (12,11)
    const bigger = resizeBuilding(before, 6)
    expect(facadeLength(bigger)).toBe(6)
    expect(bigger.length).toBe(6) // south → grid col-span == facade length
    expect(footprintCenter(bigger)).toEqual(footprintCenter(before)) // centred in place
    expect(bigger.cells).toEqual(composeBuilding({ type: 'house', length: 6 }).cells) // real re-extrude
  })
  test('shrinking works too and the type/facing are preserved', () => {
    const smaller = resizeBuilding(house(), 3)
    expect(facadeLength(smaller)).toBe(3)
    expect(smaller.type).toBe('house')
    expect(gridBuildingFacing(smaller)).toBe('south')
  })
  test('a vertical (east/west) house grows along its height span, not its length', () => {
    const vert = house({ facing: 1, length: 3, height: 4, facadeOnBack: false })
    const bigger = resizeBuilding(vert, 6)
    expect(facadeLength(bigger)).toBe(6) // road-parallel span is the height for a vertical house
    expect(bigger.height).toBe(6)
  })
})

describe('canPlaceBuilding — in-bounds + clear of blockers', () => {
  const env = (blockedKeys: string[] = [], cols = 40, rows = 40): PlacementEnv => ({
    cols,
    rows,
    blocked: (c, r) => blockedKeys.includes(`${c},${r}`),
  })

  test('accepts a clear, in-bounds footprint', () => {
    expect(canPlaceBuilding(env(), house())).toBe(true)
  })

  test('rejects when any footprint cell is out of bounds', () => {
    expect(canPlaceBuilding(env([], 12, 40), house())).toBe(false) // col 13 >= 12
    expect(canPlaceBuilding(env(), house({ col: -1 }))).toBe(false)
    expect(canPlaceBuilding(env(), house({ row: 1 }))).toBe(false) // top row would be -1
  })

  test('rejects when a single footprint cell is blocked', () => {
    expect(canPlaceBuilding(env(['11,11']), house())).toBe(false)
  })

  test('a blocker outside the footprint does not matter', () => {
    expect(canPlaceBuilding(env(['9,9', '14,14']), house())).toBe(true)
  })
})

describe('buildingCellBlocked — the manual-placement policy (occupied / collision / road)', () => {
  test('a free walkable, non-road cell is placeable (bare grass / interior floor)', () => {
    expect(buildingCellBlocked({ occupied: false, collision: false, ground: 'grass' })).toBe(false)
    expect(buildingCellBlocked({ occupied: false, collision: false, ground: 'ash' })).toBe(false)
    expect(buildingCellBlocked({ occupied: false, collision: false, ground: 'rune_floor' })).toBe(false)
  })

  test('blocks a cell already owned by another building/asset footprint', () => {
    expect(buildingCellBlocked({ occupied: true, collision: false, ground: 'grass' })).toBe(true)
  })

  test('blocks collision (trees, water, lava, features, blocking assets)', () => {
    expect(buildingCellBlocked({ occupied: false, collision: true, ground: 'grass' })).toBe(true)
    // Impassable terrain is collision, so it's caught here regardless of its ground tag.
    expect(buildingCellBlocked({ occupied: false, collision: true, ground: 'water' })).toBe(true)
    expect(buildingCellBlocked({ occupied: false, collision: true, ground: 'lava' })).toBe(true)
  })

  test('blocks a road by ground tag', () => {
    expect(buildingCellBlocked({ occupied: false, collision: false, ground: ROAD_GROUND })).toBe(true)
    expect(ROAD_GROUND).toBe('path_stone')
  })

  // #B road-overlap: this module used to recognise ONLY 'path_stone', so canPlaceBuilding happily stamped a
  // building onto a generated 'road_center'/'road_edge'/'path_dirt' street — the "building still mixes with
  // the road" bug. Every road/path ground the game paints must block, matching the editor's own placement guard.
  test('blocks EVERY road/path ground type, not just path_stone', () => {
    for (const ground of ['road', 'road_center', 'road_edge', 'plaza', 'path_stone', 'path_dirt', 'bridge', 'snow_path', 'desert_road', 'wooden_planks', 'courtyard_stone']) {
      expect(buildingCellBlocked({ occupied: false, collision: false, ground })).toBe(true)
      expect(isRoadGround(ground)).toBe(true)
    }
    // …and non-road walkable grounds stay placeable.
    for (const ground of ['grass', 'ash', 'rune_floor', 'koi']) expect(isRoadGround(ground)).toBe(false)
    expect(isRoadGround(undefined)).toBe(false)
  })

  test('the loosening: a WALKABLE decorative water-like ground (collision-free, non-road) is placeable', () => {
    // A hand-painted koi/oasis/water tile leaves collision untouched; per the policy default
    // (any non-collision, non-road, non-asset cell) it is now build-able — it was not before.
    for (const ground of ['water', 'ice_water', 'oasis', 'koi', 'lava', 'magma']) {
      expect(buildingCellBlocked({ occupied: false, collision: false, ground })).toBe(false)
    }
  })
})

describe('placement over a live-grid model (policy + canPlaceBuilding end to end)', () => {
  // A 40×40 world: collision/ground grids + an occupied set, wired through buildingCellBlocked
  // exactly like buildingPlacementEnv does in templates.tsx.
  const makeGridEnv = (over: {
    collision?: Array<[number, number]>
    road?: Array<[number, number]>
    occupied?: Array<[number, number]>
    waterPaint?: Array<[number, number]>
  } = {}): PlacementEnv => {
    const coll = new Set((over.collision ?? []).map(([c, r]) => `${c},${r}`))
    const road = new Set((over.road ?? []).map(([c, r]) => `${c},${r}`))
    const water = new Set((over.waterPaint ?? []).map(([c, r]) => `${c},${r}`))
    const occ = new Set((over.occupied ?? []).map(([c, r]) => `${c},${r}`))
    return {
      cols: 40,
      rows: 40,
      blocked: (col, row) => {
        const key = `${col},${row}`
        return buildingCellBlocked({
          occupied: occ.has(key),
          collision: coll.has(key),
          ground: road.has(key) ? 'path_stone' : water.has(key) ? 'koi' : 'grass',
        })
      },
    }
  }

  test('places a house on an open grass/floor section', () => {
    expect(canPlaceBuilding(makeGridEnv(), house())).toBe(true)
  })

  test('rejects when the footprint clips collision (a tree at 11,11)', () => {
    expect(canPlaceBuilding(makeGridEnv({ collision: [[11, 11]] }), house())).toBe(false)
  })

  test('rejects when the footprint clips a road', () => {
    expect(canPlaceBuilding(makeGridEnv({ road: [[12, 12]] }), house())).toBe(false) // the door cell
  })

  test('rejects a footprint clipping a NON-path_stone street (road_center) — the road-overlap fix', () => {
    // A legacy-preset map paints streets as 'road_center'/'road_edge'; those must reject a footprint too.
    const env: PlacementEnv = {
      cols: 40, rows: 40,
      blocked: (col, row) => buildingCellBlocked({ occupied: false, collision: false, ground: (col === 11 && row === 11) ? 'road_center' : 'grass' }),
    }
    expect(canPlaceBuilding(env, house())).toBe(false) // (11,11) is inside the house footprint
  })

  test('rejects when the footprint overlaps an existing building footprint', () => {
    expect(canPlaceBuilding(makeGridEnv({ occupied: [[10, 10]] }), house())).toBe(false)
  })

  test('places ON a walkable, hand-painted koi pond (the loosening: was rejected before)', () => {
    // Every footprint cell painted koi but left walkable (no collision) → now build-able.
    const cells = buildingFootprintCells(house()).cells.map(c => [c.col, c.row] as [number, number])
    expect(canPlaceBuilding(makeGridEnv({ waterPaint: cells }), house())).toBe(true)
  })
})

describe('moveBuilding — shift the footprint, preserve the rest', () => {
  test('moves col/row by the delta and keeps dims/type/facing', () => {
    const b = house()
    const moved = moveBuilding(b, 2, -1)
    expect(moved.col).toBe(12)
    expect(moved.row).toBe(11)
    expect(moved.length).toBe(b.length)
    expect(moved.height).toBe(b.height)
    expect(moved.facing).toBe(b.facing)
    expect(b.col).toBe(10) // original untouched (pure)
  })

  test('the door tracks the moved footprint', () => {
    const moved = moveBuilding(house(), 5, 5)
    expect(buildingDoorCell(moved)).toEqual({ col: 17, row: 17 })
  })
})

describe('rotateBuilding — cycle facing, swap dims, keep centre', () => {
  test('cycles south→east→north→west→south', () => {
    let b = house()
    const seen: Facing[] = []
    for (let i = 0; i < 5; i++) {
      seen.push(gridBuildingFacing(b))
      b = rotateBuilding(b)
    }
    expect(seen).toEqual(['south', 'east', 'north', 'west', 'south'])
  })

  test('swaps the grid span (length↔height) and recomputes iso fields', () => {
    const b = house() // length 4, height 3 (depth 3)
    const east = rotateBuilding(b) // → east (vertical)
    expect(gridBuildingFacing(east)).toBe('east')
    expect(east.facing).toBe(1)
    expect(east.length).toBe(b.depth) // depth becomes the col span
    expect(east.height).toBe(facadeLength(b)) // facade length becomes the row span
  })

  test('preserves the facade length + depth across a full rotation', () => {
    const b = house()
    let r = b
    for (let i = 0; i < FACING_CYCLE.length; i++) r = rotateBuilding(r)
    expect(facadeLength(r)).toBe(facadeLength(b))
    expect(r.depth).toBe(b.depth)
    expect(footprintCenter(r)).toEqual(footprintCenter(b))
  })

  test('keeps the footprint centre roughly fixed', () => {
    const b = house()
    const east = rotateBuilding(b)
    expect(footprintCenter(east)).toEqual(footprintCenter(b))
  })
})

describe('orientBuilding — re-anchor at a facing around a centre', () => {
  test('horizontal facings span facadeLength × depth; vertical swaps them', () => {
    const b = house()
    const south = orientBuilding(b, 'south', { col: 20, row: 20 })
    expect(south.length).toBe(facadeLength(b))
    expect(south.height).toBe(b.depth)
    expect(footprintCenter(south)).toEqual({ col: 20, row: 20 })

    const west = orientBuilding(b, 'west', { col: 20, row: 20 })
    expect(west.length).toBe(b.depth)
    expect(west.height).toBe(facadeLength(b))
    expect(gridBuildingFacing(west)).toBe('west')
  })
})

describe('makeBuilding — author a fresh building of a type', () => {
  test('matches composeBuilding sizing for the type', () => {
    const facade = composeBuilding({ type: 'store' })
    const b = makeBuilding('store', 'south', 15, 15)
    expect(b.type).toBe('store')
    expect(b.cells).toEqual(facade.cells)
    expect(b.depth).toBe(facade.depth)
    expect(facadeLength(b)).toBe(facade.length)
    expect(footprintCenter(b)).toEqual({ col: 15, row: 15 })
    expect(gridBuildingFacing(b)).toBe('south')
  })

  test('east-facing building swaps to a vertical footprint', () => {
    const facade = composeBuilding({ type: 'hospital' })
    const b = makeBuilding('hospital', 'east', 15, 15)
    expect(gridBuildingFacing(b)).toBe('east')
    expect(b.length).toBe(facade.depth) // col span = depth
    expect(b.height).toBe(facade.length) // row span = facade length
  })

  test('the door sits on the road-facing edge of the fresh footprint', () => {
    const b = makeBuilding('house', 'south', 15, 15)
    const { cells, door } = buildingFootprintCells(b)
    expect(cells).toContainEqual(door)
    // South → the door is on the bottom (max-row) edge.
    const maxRow = Math.max(...cells.map(c => c.row))
    expect(door.row).toBe(maxRow)
  })
})
