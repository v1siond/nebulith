/**
 * TILE-BRUSH GRID MUTATIONS — the small, pure orchestration the editor's pick-first brush runs against a
 * grid. Every grid-write speaks in "tile stack" terms: it goes through the cellStack adapter's stack ops
 * (setFloor / pushTile / popTile + deriveCellCollision) rather than the low-level grid setters, so there is
 * one place — testable without React — that turns an armed catalog TileDef into a placed thing:
 *
 *   - placeGroundTile → terrain: replace the cell's FLOOR tile slug, preserving its colour/dims.
 *   - stackAssetTile  → nature/buildings: PUSH a tile onto the cell's stack (one level above the tallest),
 *                       pinning the exact tile via tileOverride; a blocking type makes the cell collision.
 *   - removeTopAsset  → ⌥Alt: pop the top tile off the cell's stack and re-derive collision from what remains.
 *
 * This is BEHAVIOUR-IDENTICAL to the old direct-setter path — the adapter ops resolve to the same grid
 * writes. Entity (units) placement stays in the page — it needs the React entities state + factories — but
 * its routing (entityKindForUnitSlug) and the category decision (placementFor) live in tilePlacement.ts.
 */
import type { GridAsset, IsometricGrid } from '@/engine/IsometricGrid'
import type { TileDef } from '@/game/artStyle'
import { deriveCellCollision, getStack, popTile, pushTile, setFloor, setTileCollision } from '@/engine/cellStack'
import { tileRenderBehavior } from '@/engine/tileset/tileset'
import { assetTypeForTile, tileIsBlocking, tileSlug } from './tilePlacement'

/** The glyph a painted tile PINS as its art fallback — its own glyph (glyph tile) or the image's source glyph
 *  (image tile). NEVER a '?' dingbat: the tile is resolved by LABEL→IMAGE via its tileOverride, so an image
 *  tile with no source glyph, or the ascii passthrough, pins '' (draw nothing / resolve by image) rather than
 *  stamping a literal '?' into asset.art that would render on the user's machine. */
function tileChar(tile: TileDef): string {
  const v = tile.visual
  if (v.kind === 'glyph') return v.char
  if (v.kind === 'image') return v.char ?? ''
  return ''
}

/** terrain → set (replace) the cell's FLOOR to the tile's slug. Routed through the cellStack floor op: we
 *  read the current floor tile and patch ONLY its slug, so the cell's existing colour/dims round-trip
 *  untouched (setFloor rewrites them to the same values; a bare cell stays at the non-persisted defaults). */
export function placeGroundTile(grid: IsometricGrid, col: number, row: number, tile: TileDef): void {
  const [floor] = getStack(grid, col, row)
  setFloor(grid, col, row, { ...floor, slug: tileSlug(tile.id) })
}

/** nature / buildings → PUSH a tile onto the cell's stack (pushTile lands it one level above the tallest,
 *  0 on an empty cell). tileOverride pins the exact tile and blocking follows the asset type so a stacked
 *  wall/tree/rock makes the cell collision.
 *
 *  The placed asset is seeded from the DB tile so a PAINTED tile === a GENERATED one (same GridAsset shape):
 *   - `h` = the tile's DB BLOCK height, so a block tile (a boulder, a stone wall) paints as a real extruded
 *     block — not a flat single-face billboard. A flat tile (a flower) omits h and stays flat. This ALSO
 *     makes a block tile directly pickable (a raised block picks as its own tile, not the floor under it).
 *   - `settings` = the tile's OWN generic render behaviour (fadeNear/cutawayRoof/display) via tileRenderBehavior
 *     — the SAME seam stampComposition uses — so the tile fades/cutaways/single-displays like the stamped one
 *     and its settings are the tile's own, never a forced flat default. */
export function stackAssetTile(
  grid: IsometricGrid,
  col: number,
  row: number,
  tile: TileDef,
  opts: { opacity?: number } = {},
): void {
  const type = assetTypeForTile(tile)
  const color = tile.visual.kind === 'ascii' ? undefined : tile.visual.color
  const placed = pushTile(grid, col, row, {
    source: 'asset',
    slug: tileSlug(tile.id),
    type,
    art: [tileChar(tile)],
    tileId: tile.id,
    color,
    opacity: opts.opacity,
    collision: tileIsBlocking(type),
    h: tile.height && tile.height > 0 ? tile.height : undefined,
  })
  const behavior = tileRenderBehavior(tile.settings)
  if (behavior) placed.settings = behavior
}

/** ⌥Alt → pop the TOP tile off the cell's stack (highest heightLevel), then re-derive the cell's collision
 *  from whatever remains (a cell blocks iff a blocking tile is still on it). Returns the removed asset, or
 *  null when the cell had none. */
export function removeTopAsset(grid: IsometricGrid, col: number, row: number): GridAsset | null {
  const removed = popTile(grid, col, row)
  if (!removed) return null
  setTileCollision(grid, col, row, deriveCellCollision(getStack(grid, col, row)))
  return removed
}

/** ⌥Alt on a SPECIFIC block of a stack → remove the tile at that heightLevel (the block the pointer is on),
 *  not blindly the top, then re-derive the cell's collision from whatever remains. Returns the removed asset,
 *  or null when no asset sits at that level. */
export function removeAssetAtLevel(grid: IsometricGrid, col: number, row: number, level: number): GridAsset | null {
  const target = grid.getAssetsAtCell(col, row).find(a => (a.heightLevel ?? 0) === level)
  if (!target) return null
  grid.removeAssetsWhere(a => a === target)
  setTileCollision(grid, col, row, deriveCellCollision(getStack(grid, col, row)))
  return target
}
