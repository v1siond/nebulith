/**
 * TILE-BRUSH GRID MUTATIONS — the small, pure orchestration the editor's pick-first brush runs against a
 * grid. It ONLY reuses the existing IsometricGrid primitives (setGround / placeAsset / getAssetsAtCell /
 * setCollision), so there is one place — testable without React — that turns an armed catalog TileDef into
 * a placed thing:
 *
 *   - placeGroundTile → terrain: replace the cell's ground (one ground per cell).
 *   - stackAssetTile  → nature/buildings: STACK a cell asset on top of whatever is there (heightLevel one
 *                       above the tallest), pinning the exact tile via tileOverride; a blocking type makes
 *                       the cell collision.
 *   - removeTopAsset  → ⌥Alt: pop the top asset on a cell and re-derive collision from what remains.
 *
 * Entity (units) placement stays in the page — it needs the React entities state + factories — but its
 * routing (entityKindForUnitSlug) and the category decision (placementFor) live in tilePlacement.ts.
 */
import type { GridAsset, IsometricGrid } from '@/engine/IsometricGrid'
import type { TileDef } from '@/game/artStyle'
import { assetTypeForTile, tileIsBlocking, tileSlug } from './tilePlacement'

/** The char a tile draws as (glyph char, image's source glyph, or '?' for the ascii passthrough). */
function tileChar(tile: TileDef): string {
  const v = tile.visual
  if (v.kind === 'glyph') return v.char
  if (v.kind === 'image') return v.char ?? '?'
  return '?'
}

/** terrain → set (replace) the cell's ground to the tile's slug. groundKind classifies it at render. */
export function placeGroundTile(grid: IsometricGrid, col: number, row: number, tile: TileDef): void {
  grid.setGround(col, row, tileSlug(tile.id))
}

/** nature / buildings → stamp a cell ASSET stacked ON TOP of the cell's current assets. The new asset's
 *  heightLevel is one above the tallest already there (0 on an empty cell), tileOverride pins the exact
 *  tile, and blocking follows the asset type so a stacked wall/tree/rock makes the cell collision. */
export function stackAssetTile(
  grid: IsometricGrid,
  col: number,
  row: number,
  tile: TileDef,
  opts: { opacity?: number } = {},
): void {
  const type = assetTypeForTile(tile)
  const existing = grid.getAssetsAtCell(col, row)
  const nextLevel = existing.length ? Math.max(...existing.map(a => a.heightLevel ?? 0)) + 1 : 0
  const color = tile.visual.kind === 'ascii' ? undefined : tile.visual.color
  grid.placeAsset([tileChar(tile)], col, row, {
    type,
    blocking: tileIsBlocking(type),
    tileOverride: tile.id,
    heightLevel: nextLevel,
    color,
    opacity: opts.opacity,
  })
}

/** ⌥Alt → remove the TOP asset stacked on a cell (highest heightLevel), then re-derive the cell's
 *  collision from whatever remains (a cell blocks iff a blocking asset is still on it). Returns the
 *  removed asset, or null when the cell had none. */
export function removeTopAsset(grid: IsometricGrid, col: number, row: number): GridAsset | null {
  const stack = grid.getAssetsAtCell(col, row) // sorted ascending by heightLevel
  const top = stack[stack.length - 1]
  if (!top) return null
  grid.removeAssetsWhere(a => a === top)
  grid.setCollision(col, row, grid.getAssetsAtCell(col, row).some(a => a.blocking))
  return top
}
