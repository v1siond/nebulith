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
import { assetTypeForTile, tileIsBlocking, tileSlug } from './tilePlacement'

/** The char a tile draws as (glyph char, image's source glyph, or '?' for the ascii passthrough). */
function tileChar(tile: TileDef): string {
  const v = tile.visual
  if (v.kind === 'glyph') return v.char
  if (v.kind === 'image') return v.char ?? '?'
  return '?'
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
 *  wall/tree/rock makes the cell collision. w/d/h are intentionally omitted so the placed instance keeps
 *  the tile's catalog size/height — identical to the pre-adapter placeAsset call. */
export function stackAssetTile(
  grid: IsometricGrid,
  col: number,
  row: number,
  tile: TileDef,
  opts: { opacity?: number } = {},
): void {
  const type = assetTypeForTile(tile)
  const color = tile.visual.kind === 'ascii' ? undefined : tile.visual.color
  pushTile(grid, col, row, {
    source: 'asset',
    slug: tileSlug(tile.id),
    type,
    art: [tileChar(tile)],
    tileId: tile.id,
    color,
    opacity: opts.opacity,
    collision: tileIsBlocking(type),
  })
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
