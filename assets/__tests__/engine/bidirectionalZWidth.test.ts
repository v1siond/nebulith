/**
 * BIDIRECTIONAL z-width (Alexander #58): a tile z-widths `depth` cells ahead along `depthDir` AND `depthBack`
 * cells behind it, from ONE anchor — so a 4-cell roof becomes 1 tile. normalizeDepthSpan folds that into the
 * one-way "anchor is the start, depth runs along dir" span every existing depth fn understands, so nothing else
 * in the render/sort has to learn a second case. These lock the fold: same cells, anchor moved to the back.
 */
import { normalizeDepthSpan, depthCells, assetRectExtents } from '@/engine/render/isoBlock'
import { IsometricGrid } from '@/engine/IsometricGrid'
import { cellStackTop } from '@/engine/cellStack'

describe('normalizeDepthSpan — bidirectional span folds to a one-way span', () => {
  test('no backward extent → anchor + depth unchanged (byte-identical to today)', () => {
    expect(normalizeDepthSpan(5, 3, 4, 0, 'right-down')).toEqual({ col: 5, row: 3, depth: 4 })
    expect(normalizeDepthSpan(5, 3, 4, undefined, 'right-down')).toEqual({ col: 5, row: 3, depth: 4 })
  })

  test('backward extent moves the anchor BACK along −dir and grows depth to depthBack+depth', () => {
    // right-down grid step = (+1,0); depthBack 2 → col shifts back to 3; total depth 2+3 = 5.
    expect(normalizeDepthSpan(5, 3, 3, 2, 'right-down')).toEqual({ col: 3, row: 3, depth: 5 })
  })

  test('the folded span covers the SAME cells: depthBack behind, anchor, depth−1 ahead', () => {
    const n = normalizeDepthSpan(5, 3, 3, 2, 'right-down') // anchor col 5, 2 behind + (anchor + 2 ahead)
    expect(depthCells(n.col, n.row, n.depth, 'right-down').map(c => c.col)).toEqual([3, 4, 5, 6, 7])
  })

  test('works on the row axis (left-down) too', () => {
    const n = normalizeDepthSpan(2, 6, 2, 1, 'left-down') // step (0,+1): 1 behind + (anchor + 1 ahead)
    expect(n).toEqual({ col: 2, row: 5, depth: 3 })
    expect(depthCells(n.col, n.row, n.depth, 'left-down').map(c => c.row)).toEqual([5, 6, 7])
  })
})

describe('assetRectExtents — model → ±col/±row grid extents', () => {
  test('two perpendicular sides (right-down + left-down) → a rectangle both ways', () => {
    expect(assetRectExtents({ depthDir: 'right-down', depth: 4, depthPerp: 2 })).toEqual({ colMinus: 0, colPlus: 3, rowMinus: 0, rowPlus: 2 })
  })
  test('back extents land on the opposite sides', () => {
    expect(assetRectExtents({ depthDir: 'right-down', depth: 1, depthBack: 2, depthPerpBack: 1 })).toEqual({ colMinus: 2, colPlus: 0, rowMinus: 1, rowPlus: 0 })
  })
})

describe('a z-width RECTANGLE registers its covered cells for stacking (Alexander #63)', () => {
  test("a tile dropped on the rectangle's MIDDLE stacks ON the deck, not the ground", () => {
    const g = new IsometricGrid({ cols: 20, rows: 20, cellSize: 32, isoScale: 1.4 })
    // Mirror the real app path: place the tile, then set the z-width fields on the asset the way
    // setAssetDepth/applyToSelectedTiles do (placeAsset options don't carry depth/depthDir/depthPerp).
    const roof = g.placeAsset(['#'], 5, 5, { type: 'roof', height: 1 })
    roof.label = 'roof'
    roof.heightLevel = 3 // a raised deck
    roof.depth = 3
    roof.depthDir = 'right-down'
    roof.depthPerp = 2 // → a 3×3 rectangle: cols [5,7] × rows [5,7]
    g.assetLevelsChanged() // re-index the covered footprint (what applyToSelectedTiles now does on a z-width edit)
    const ground = cellStackTop(g, 10, 10) // an untouched cell — just the base ground layer
    const anchor = cellStackTop(g, 5, 5)
    expect(anchor).toBeGreaterThan(ground) // the raised deck sits above the ground
    expect(cellStackTop(g, 6, 6)).toBe(anchor) // MIDDLE cell — was `ground` before the covered-cells fix; now sees the deck
    expect(cellStackTop(g, 7, 7)).toBe(anchor) // far corner of the rectangle also sees the deck
    expect(cellStackTop(g, 8, 8)).toBe(ground) // just outside the rectangle → unaffected
  })
})
