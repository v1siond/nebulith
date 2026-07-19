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
 *  0 on an empty cell). tileOverride pins the exact tile.
 *
 *  UNIFORM INSERTION — the user's hard rule: "all tiles behave and are inserted the same in the map,
 *  regardless of type or art style." EVERY painted tile — flower, tree, building, rock, animal — seeds the
 *  IDENTICAL default `h = 1` (a full, all-faces block one level tall). This is the SAME uniform height the
 *  GENERATOR forces on every composition cell (composition.ts stampRun: `asset.height = 1`), so a PAINTED
 *  tile is structurally identical to a GENERATED one. We deliberately do NOT read the tile's per-category DB
 *  `height` here: that read WAS the flat-vs-standing split (flowers/leaves/floor-items came in flat while
 *  trees/buildings stood up as blocks) the user was furious about. The ONLY source of a per-tile difference
 *  is the right-sidebar SETTINGS the user edits on an individual tile — never its type / category / label /
 *  art style.
 *   - `settings` = the tile's OWN generic render behaviour (fadeNear/cutawayRoof/display) via tileRenderBehavior
 *     — the SAME seam stampComposition uses — so an authored behaviour rides along; nothing is forced to a flat
 *     default and nothing is forced to display:single.
 *   - `collision` follows the asset type: a stacked wall/tree/rock blocks the cell. This is a GAMEPLAY flag,
 *     not the insertion geometry — the block/height every tile inserts with is identical; only whether it
 *     obstructs movement differs, and the user can override that per-tile via settings. */
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
    h: 1, // uniform block for EVERY tile — no per-tile/category height read (matches composition.ts stampRun)
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
