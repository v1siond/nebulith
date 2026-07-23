/**
 * BLOCK-AWARE MARQUEE — the shift+drag box selects the tiles it VISUALLY covers. In iso a raised roof/wall
 * block's flat ground cell sits BEHIND the building (offset up-and-right), so a flat "screenToCell corner"
 * rectangle grabs the wrong ground cells and the yellow cage floats. The fix reads the render registry: every
 * drawn tile records its real on-screen silhouette, and the marquee keeps the tiles whose silhouette CENTROID
 * lands in the drag rect — keyed by the tile's OWN col,row,level (blockKeyForPick), never the flat cell.
 *
 * These prove the PURE seam: `tilesInScreenRect` (geoms + rect → covered tiles) composed with `blockKeyForPick`
 * (covered tiles → the selection keys the highlight strokes). Each covered tile is keyed by its own STACK INDEX
 * (its slot in the cell stack), never the flat cell, so two tiles at the same level stay distinct. The renderer
 * feeds its live per-frame registry.
 */
import { tilesInScreenRect, type TileGeom } from '@/engine/render/tileHit'
import { blockKeyForPick } from '@/game/editor/selection'

/** A tile silhouette (poly ring) centred on (cx,cy) — controls the centroid the marquee tests against. */
const polyAt = (cx: number, cy: number): TileGeom => ({
  kind: 'poly',
  pts: [{ x: cx - 4, y: cy - 4 }, { x: cx + 4, y: cy - 4 }, { x: cx + 4, y: cy + 4 }, { x: cx - 4, y: cy + 4 }],
})
const keysOf = (tiles: { col: number; row: number; stackIndex?: number; source?: string }[]) =>
  new Set(tiles.map((t) => blockKeyForPick(t)))

describe('tilesInScreenRect — block-aware marquee over the render registry', () => {
  test('a RAISED tile is selected by its ON-SCREEN silhouette — its own "col,row,stackIndex", not the flat cell', () => {
    // A roof tile at (col20,row20) sitting at stack slot 4, drawn HIGH on screen (centroid 100,100). Its flat
    // ground cell would project elsewhere; the box (50..150) covers the silhouette → the tile's own "20,20,4" key.
    const tiles = [{ col: 20, row: 20, stackIndex: 4, source: 'asset', geom: polyAt(100, 100) }]
    expect(keysOf(tilesInScreenRect(tiles, 50, 50, 150, 150))).toEqual(new Set(['20,20,4']))
  })

  test('a FLOOR tile (stack slot 0) keys as "col,row,0" — the floor is a normal tile in the stack', () => {
    const tiles = [{ col: 7, row: 7, stackIndex: 0, source: 'asset', geom: polyAt(80, 80) }]
    expect(keysOf(tilesInScreenRect(tiles, 0, 0, 200, 200))).toEqual(new Set(['7,7,0']))
  })

  test('two tiles at the SAME cell (floor slot 0 + wall slot 1) are BOTH kept, keyed APART', () => {
    const tiles = [
      { col: 6, row: 6, stackIndex: 0, source: 'asset', geom: polyAt(100, 100) }, // grass slab
      { col: 6, row: 6, stackIndex: 1, source: 'asset', geom: polyAt(101, 96) },  // wall block, same cell
    ]
    expect(keysOf(tilesInScreenRect(tiles, 50, 50, 150, 150))).toEqual(new Set(['6,6,0', '6,6,1']))
  })

  test('excludes tiles whose silhouette centroid is OUTSIDE the box', () => {
    const tiles = [
      { col: 1, row: 1, stackIndex: 1, source: 'asset', geom: polyAt(100, 100) }, // inside
      { col: 9, row: 9, stackIndex: 1, source: 'asset', geom: polyAt(400, 400) }, // outside
    ]
    expect(keysOf(tilesInScreenRect(tiles, 50, 50, 150, 150))).toEqual(new Set(['1,1,1']))
  })

  test('NO double-count: the SAME tile (same stack slot) recorded twice yields ONE tile / ONE key', () => {
    const tiles = [
      { col: 3, row: 3, stackIndex: 2, source: 'asset', geom: polyAt(100, 100) },
      { col: 3, row: 3, stackIndex: 2, source: 'asset', geom: polyAt(101, 99) }, // same cell+slot, re-drawn
    ]
    const hit = tilesInScreenRect(tiles, 50, 50, 150, 150)
    expect(hit).toHaveLength(1)
    expect(keysOf(hit)).toEqual(new Set(['3,3,2']))
  })

  test('corner order does not matter — the rect is normalised', () => {
    const tiles = [{ col: 2, row: 2, stackIndex: 1, source: 'asset', geom: polyAt(100, 100) }]
    expect(keysOf(tilesInScreenRect(tiles, 150, 150, 50, 50))).toEqual(new Set(['2,2,1']))
  })

  test('a MIXED box: raised tiles + a floor tile → per-tile stack-index keys, no ground offset', () => {
    const tiles = [
      { col: 20, row: 20, stackIndex: 4, source: 'asset', geom: polyAt(90, 90) },   // roof tile
      { col: 21, row: 20, stackIndex: 4, source: 'asset', geom: polyAt(110, 90) },  // roof tile
      { col: 5, row: 5, stackIndex: 0, source: 'asset', geom: polyAt(100, 130) },   // floor tile under the box
      { col: 40, row: 40, stackIndex: 1, source: 'asset', geom: polyAt(500, 500) }, // far away → excluded
    ]
    expect(keysOf(tilesInScreenRect(tiles, 50, 50, 150, 150))).toEqual(new Set(['20,20,4', '21,20,4', '5,5,0']))
  })
})
