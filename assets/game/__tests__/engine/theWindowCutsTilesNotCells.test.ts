/**
 * THE CAMERA WINDOW CUTS A TILE, NOT A CELL.
 *
 * *"sometimes maps would stop showing the floor, specially when zoomed in"* (Image #67), and on the range ring
 * in the same breath: *"my guess is that the range is cutting at the cell level only not at the tile level, and
 * some cell have tiles that spand multiple cells"* (Image #66). He was right, and it was TWO culls making the
 * same mistake in two places.
 *
 * A floor is not one asset per cell. The generator collapses a run into ONE asset carrying `depth`: measured on
 * a seeded 40x40 forest, 161 of 172 floors are runs and the longest covers 33 cells. `getVisibleAssets` tested
 * `asset.col`/`asset.row`, the ANCHOR, so a run anchored outside the window was dropped whole while most of it
 * was on screen. The hole had a straight edge because a run is a straight line of cells.
 *
 * It shows ZOOMED IN because the window is sized in cells off the zoomed tile size. Measured live, the same
 * map, one seed, zooming in: `halfSpan` falls 49 to 17, and floors surviving the prefilter went 52 before this
 * fix to 93 after, with floors actually DRAWN going 11 to 15. Zoomed out the two are identical, which is the
 * property that matters: this only bites when the window is tighter than the runs are long.
 */
import { IsometricGrid, type GridAsset } from '@/engine/IsometricGrid'
import { assetRectExtents } from '@/engine/render/isoBlock'

/** An EMPTY grid. The constructor lays one floor per cell (3,600 of them here), and a generated map then
 *  replaces those with `depth` runs, which is the whole subject. These cases place their own. */
const grid = (): IsometricGrid => {
  const g = new IsometricGrid({ cols: 60, rows: 60, cellSize: 32, isoScale: 1.4 })
  g.assets.length = 0
  return g
}

/** A bare asset at a cell, with whatever span fields the case is about. */
function put(g: IsometricGrid, at: Partial<GridAsset> & { col: number; row: number }): GridAsset {
  const a: GridAsset = {
    col: at.col, row: at.row, heightLevel: 0, type: at.type ?? 'floor', chars: [''],
    ...at,
  } as GridAsset
  g.assets.push(a)
  return a
}

describe('a tile that covers many cells is kept while ANY of them is in the window', () => {
  it('keeps a long run whose ANCHOR is outside the window', () => {
    const g = grid()
    // A 33-cell floor run, the longest measured on a real map, anchored well left of the window and reaching
    // right through it. Before the fix this vanished entirely and took 33 cells of floor with it.
    put(g, { col: 2, row: 30, depth: 33, depthDir: 'right-down' })
    const kept = g.getVisibleAssets(30, 30, 20, 20)
    expect(kept).toHaveLength(1)
  })

  it('drops a run that genuinely misses the window, so the cull still culls', () => {
    const g = grid()
    put(g, { col: 2, row: 2, depth: 4, depthDir: 'right-down' })
    expect(g.getVisibleAssets(45, 45, 10, 10)).toHaveLength(0)
  })

  it('keeps a run reaching the window from the far side too', () => {
    const g = grid()
    put(g, { col: 50, row: 30, depth: 30, depthDir: 'left-up' })
    expect(g.getVisibleAssets(30, 30, 20, 20)).toHaveLength(1)
  })

  it('treats a plain one-cell tile exactly as before', () => {
    const g = grid()
    put(g, { col: 30, row: 30 })
    put(g, { col: 2, row: 2 })
    const kept = g.getVisibleAssets(30, 30, 20, 20)
    expect(kept).toHaveLength(1)
    expect(kept[0].col).toBe(30)
  })

  it('counts the axes the old expansion ignored: depthBack, depthPerp, depthPerpBack', () => {
    const g = grid()
    // Each of these reaches the window ONLY along an axis the old `coveredCells` never looked at, which is the
    // range-ring half of the same bug.
    put(g, { col: 45, row: 30, depth: 1, depthBack: 14, depthDir: 'right-down', type: 'back' })
    put(g, { col: 30, row: 45, depth: 1, depthPerp: 0, depthPerpBack: 14, depthDir: 'right-down', type: 'perpBack' })
    const kept = g.getVisibleAssets(30, 30, 20, 20).map(a => a.type)
    expect(kept).toContain('back')
    expect(kept).toContain('perpBack')
  })
})

describe('the extent model itself, which both culls now share', () => {
  it('reports no reach for a tile with no depthDir', () => {
    expect(assetRectExtents({})).toEqual({ colMinus: 0, colPlus: 0, rowMinus: 0, rowPlus: 0 })
  })

  it('counts depth as INCLUDING the anchor, so a depth of 1 reaches nothing', () => {
    expect(assetRectExtents({ depth: 1, depthDir: 'right-down' })).toEqual({ colMinus: 0, colPlus: 0, rowMinus: 0, rowPlus: 0 })
  })

  it('reaches depth-1 cells forward', () => {
    const e = assetRectExtents({ depth: 33, depthDir: 'right-down' })
    expect(e.colPlus + e.rowPlus).toBe(32)
  })

  it('reaches BACKWARD as well, which is what a one-way expansion missed', () => {
    const e = assetRectExtents({ depth: 1, depthBack: 5, depthDir: 'right-down' })
    expect(e.colMinus + e.rowMinus).toBe(5)
  })

  it('reaches along the PERPENDICULAR axis, the other thing it missed', () => {
    const e = assetRectExtents({ depth: 1, depthPerp: 3, depthPerpBack: 2, depthDir: 'right-down' })
    expect(e.colMinus + e.colPlus + e.rowMinus + e.rowPlus).toBe(5)
  })
})
