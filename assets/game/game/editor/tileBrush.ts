/**
 * TILE-BRUSH GRID MUTATIONS — the small, pure orchestration the editor's pick-first brush runs against a
 * grid. Every grid-write speaks in "tile stack" terms: it goes through the cellStack adapter's stack ops
 * (setFloor / pushTile / popTile + deriveCellCollision) rather than the low-level grid setters, so there is
 * one place — testable without React — that turns an armed catalog TileDef into a placed thing:
 *
 *   - placeGroundTile → terrain: replace the cell's FLOOR tile slug, preserving its colour/dims.
 *   - stackAssetTile  → nature/buildings: PUSH a tile onto the cell's stack (one level above the tallest),
 *                       pinning the exact tile via tileOverride; it inserts at the tile's OWN height (DATA)
 *                       and paints with ONE uniform walkable collision default — collision is a per-cell
 *                       SETTING the user controls, NEVER derived from height (or type/category/style).
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
import { tileSlug } from './tilePlacement'

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

/** The BARE/default floor slug every freshly-initialised cell starts on (the IsometricGrid ctor fills the
 *  whole ground with it, and getStack falls back to it) — what a cleared cell returns to. */
export const DEFAULT_GROUND_SLUG = 'grass'

/** CLEAR a cell's FLOOR back to bare: the default ground slug, no colour override, no dims. A road, terrain
 *  or plaza is JUST a floor tile (all painted via placeGroundTile), so this clears ANY of them the SAME way —
 *  there is NO branch on the tile's type / category / height / style. Pairs with removeTopAsset (which drops
 *  the stacked assets) so "Clear tiles" can EMPTY the whole cell, not just the stack. */
export function clearGroundTile(grid: IsometricGrid, col: number, row: number): void {
  grid.setGround(col, row, DEFAULT_GROUND_SLUG)
  grid.setGroundColor(col, row, null)
  grid.clearGroundDims(col, row)
}

/** nature / buildings → PUSH a tile onto the cell's stack (pushTile lands it one level above the tallest,
 *  0 on an empty cell). tileOverride pins the exact tile.
 *
 *  PER-TILE HEIGHT, READ UNIFORMLY (MAP-MODEL / EDITOR-INTERACTION-SPEC — the user's model): a tile carries
 *  its OWN block height as DATA, and the brush reads it through ONE uniform path — NO type / category / art-
 *  style branch. The MECHANISM is identical for every tile ("all tiles behave the same"); the only difference
 *  is the DATA each tile carries:
 *   - a GROUND/FLAT tile (terrain, flower, fallen leaf, floor decor — DB height 0/min) inserts FLAT: it shows
 *     on the floor face only in iso.
 *   - a STANDING tile (tree, rock, building, prop, lamp, mushroom — DB height ≥1) inserts as an extruded BLOCK.
 *  The exact same line reads every tile's height; a data drift on ONE tile can never reopen a per-category
 *  code split, because there is no category code here.
 *   - `h` = the tile's OWN DB height (0 = flat floor face, ≥1 = N blocks tall). Read, never forced.
 *   - `collision` is INDEPENDENT of height (and of type/category/style): every painted tile lands with the
 *     SAME uniform walkable default — a 4-block projection paints walkable, a 2-block open door paints
 *     walkable, a flat flower paints walkable. Collision is a per-cell SETTING the user drives via the
 *     inspector's Blocked/Walkable toggle (grid.setCollision) — that is the source of truth. Height and
 *     collision are fully decoupled: any height can carry any collision. There is NO per-type blocking list
 *     and NO height→collision rule anywhere in this path.
 *   - `type` is the tile's OWN slug (its identity), not a classified category — the visual is pinned via
 *     tileOverride and the height above is per-tile DATA, so `type` only labels the placed asset.
 *   - `settings` = the tile's OWN generic render behaviour (fadeNear/cutawayRoof/display) via tileRenderBehavior
 *     — the SAME seam stampComposition uses — so an authored behaviour rides along, nothing is forced. */
export function stackAssetTile(
  grid: IsometricGrid,
  col: number,
  row: number,
  tile: TileDef,
  opts: { opacity?: number } = {},
): void {
  const height = tile.height ?? 0 // the tile's OWN block height (DATA) — one read for every tile, no type branch
  const slug = tileSlug(tile.id)
  const color = tile.visual.kind === 'ascii' ? undefined : tile.visual.color
  const placed = pushTile(grid, col, row, {
    source: 'asset',
    slug,
    type: slug, // the tile's own identity, not a classified category — no type/category branch
    art: [tileChar(tile)],
    tileId: tile.id,
    color,
    opacity: opts.opacity,
    collision: false, // UNIFORM walkable default for EVERY tile — collision is a per-cell SETTING the user drives
                      // via the inspector (grid.setCollision), NEVER derived from height/type/category/style
    h: height, // the tile's own height: 0 = flat (floor face only in iso), ≥1 = extruded block — decoupled from collision
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
