/**
 * planComposition + compositionFootprintCells — the geometry the placement GHOST previews and the click stamps
 * share ONE source of truth, so the translucent shadow is exactly what lands. These tests pin the pure math:
 * where a composition anchors (clicked cell = footprint CENTRE), which cells it fills (deduped, rotation-aware),
 * how tall it stands, and when it's valid (in-bounds, unblocked, off-road for buildings vs. anywhere for props).
 */
import '@/__tests__/helpers/installTilesetSeed' // DB-equivalent compositions in ASCII_TILESET
import { IsometricGrid } from '@/engine/IsometricGrid'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'
import { resolveComposition } from '@/engine/tileset/tileset'
import type { Composition } from '@/engine/tileset/tileset'
import {
  planComposition,
  compositionFootprintCells,
  compositionFacesRoad,
  compositionHeight,
  canPlaceComposition,
} from '@/engine/buildingCatalog'

const mkGrid = () => new IsometricGrid({ cols: 40, rows: 40, cellSize: 16, isoScale: 1.4 })
const comp = (kind: string) => resolveComposition(ASCII_TILESET, kind)!

describe('compositionFacesRoad — the door signal that decides "rotate to a road" vs "drop as-is"', () => {
  test('a building (house) has a door → faces a road; a fountain / lamp post / tree does not', () => {
    expect(compositionFacesRoad(comp('house_4'))).toBe(true)
    expect(compositionFacesRoad(comp('store_5'))).toBe(true)
    expect(compositionFacesRoad(comp('fountain'))).toBe(false)
    expect(compositionFacesRoad(comp('lamp_post'))).toBe(false)
    expect(compositionFacesRoad(comp('tree'))).toBe(false)
  })
})

describe('compositionFootprintCells — deduped, rotation-aware occupied cells (pure geometry)', () => {
  // A synthetic 2×3 composition with a stacked column (two cells share dx,dy → must dedupe to one).
  const synthetic: Composition = {
    footprint: { w: 2, h: 3 },
    cells: [
      { dx: 0, dy: 0, level: 0, label: 'a' },
      { dx: 0, dy: 0, level: 1, label: 'a' }, // stacked above (0,0) — same cell
      { dx: 1, dy: 2, level: 0, label: 'b' },
    ],
  }

  test('rotation 0: the cells land at the anchor; the stacked column dedupes to one cell', () => {
    const cells = compositionFootprintCells(synthetic, 10, 10, 0)
    expect(cells).toEqual([{ col: 10, row: 10 }, { col: 11, row: 12 }])
  })

  test('rotation 1 (90° CW): each offset rotates in the w×h footprint, matching the stamp', () => {
    // rotateFootprintOffset(dx,dy,w=2,h=3,1): (0,0)→(h-1-0,0)=(2,0); (1,2)→(h-1-2,1)=(0,1)
    const cells = compositionFootprintCells(synthetic, 10, 10, 1)
    expect(cells).toEqual([{ col: 12, row: 10 }, { col: 10, row: 11 }])
  })

  test('a real fountain fills a 5×5 block of distinct cells (its own cell data, not a guess)', () => {
    const cells = compositionFootprintCells(comp('fountain'), 8, 8, 0)
    expect(cells.length).toBeGreaterThan(0)
    for (const { col, row } of cells) {
      expect(col).toBeGreaterThanOrEqual(8)
      expect(col).toBeLessThanOrEqual(12)
      expect(row).toBeGreaterThanOrEqual(8)
      expect(row).toBeLessThanOrEqual(12)
    }
    // deduped: no two entries share a cell
    expect(new Set(cells.map(c => `${c.col},${c.row}`)).size).toBe(cells.length)
  })
})

describe('compositionHeight — blocks tall (max level + 1) for the ghost extrusion', () => {
  test('a flat fountain is 1 tall; a synthetic 3-level stack is 4 tall', () => {
    expect(compositionHeight(comp('fountain'))).toBe(1)
    const tall: Composition = { footprint: { w: 1, h: 1 }, cells: [{ dx: 0, dy: 0, level: 0, label: 'a' }, { dx: 0, dy: 0, level: 3, label: 'a' }] }
    expect(compositionHeight(tall)).toBe(4)
  })
})

describe('planComposition — the clicked cell is the footprint CENTRE; props drop unrotated', () => {
  test('a fountain at (10,10): anchored so (10,10) is the centre, rotation 0, valid on empty ground', () => {
    const plan = planComposition(mkGrid(), 'fountain', 10, 10)!
    expect(plan).not.toBeNull()
    expect(plan.rotation).toBe(0)                 // no door → no road rotation
    expect(plan.footprint).toEqual({ w: 5, h: 5 })
    expect(plan.anchorCol).toBe(8)               // 10 - floor(5/2)
    expect(plan.anchorRow).toBe(8)
    expect(plan.valid).toBe(true)                // empty grid, no roads
    expect(plan.cells.length).toBeGreaterThan(0)
  })

  test('a lamp post is a single 1×1 cell at the clicked cell, 2 blocks tall (post + bulb)', () => {
    const plan = planComposition(mkGrid(), 'lamp_post', 5, 5)!
    expect(plan.footprint).toEqual({ w: 1, h: 1 })
    expect(plan.cells).toEqual([{ col: 5, row: 5 }])
    expect(plan.height).toBe(2)
    expect(plan.valid).toBe(true)
  })

  test('returns null when the composition is not in the loaded tileset (still loading)', () => {
    expect(planComposition(mkGrid(), 'no_such_kind', 5, 5)).toBeNull()
  })
})

describe('planComposition — validity: out of bounds, blocked cells, and roads (buildings only)', () => {
  test('off the grid edge → invalid (a footprint cell falls out of bounds)', () => {
    const plan = planComposition(mkGrid(), 'fountain', 1, 1)! // anchor (-1,-1) → cells out of bounds
    expect(plan.valid).toBe(false)
  })

  test('a blocked (collision) footprint cell → invalid', () => {
    const grid = mkGrid()
    grid.setCollision(10, 10, true) // right at the fountain centre
    expect(planComposition(grid, 'fountain', 10, 10)!.valid).toBe(false)
  })

  test('a BUILDING may not sit on a road; a PROP may — same cell, different rule', () => {
    const grid = mkGrid()
    // paint a patch of road under where the footprint centre lands
    for (let r = 6; r <= 14; r++) for (let c = 6; c <= 14; c++) grid.ground[r][c] = 'path_stone'
    expect(planComposition(grid, 'house_4', 10, 10)!.valid).toBe(false) // building blocked by the road
    expect(planComposition(grid, 'fountain', 10, 10)!.valid).toBe(true) // a prop is fine on the plaza/road
  })

  test('a building rotates to FACE the nearest road (footprint axes swap for east/west)', () => {
    const grid = mkGrid()
    grid.ground[10][20] = 'path_stone' // a road due EAST of a hover at (10,10)
    const plan = planComposition(grid, 'hospital_6', 10, 10)! // south footprint 6×4
    expect(plan.facing).toBe('east')
    expect(plan.rotation).toBe(3)               // FACING_ROTATION.east
    expect(plan.footprint).toEqual({ w: 4, h: 6 }) // axes swapped for an east/west facing
  })
})

describe('canPlaceComposition — the raw cell check the plan builds on', () => {
  test('true when every cell fits; false on the first out-of-bounds / blocked / road cell', () => {
    const grid = mkGrid()
    const cells = [{ col: 2, row: 2 }, { col: 3, row: 2 }]
    expect(canPlaceComposition(grid, cells, false)).toBe(true)
    expect(canPlaceComposition(grid, [{ col: -1, row: 2 }], false)).toBe(false)
    grid.setCollision(3, 2, true)
    expect(canPlaceComposition(grid, cells, false)).toBe(false)
    const roadGrid = mkGrid()
    roadGrid.ground[2][3] = 'path_stone'
    expect(canPlaceComposition(roadGrid, cells, true)).toBe(false)  // excludeRoads → blocked
    expect(canPlaceComposition(roadGrid, cells, false)).toBe(true)  // props ignore roads
  })
})
