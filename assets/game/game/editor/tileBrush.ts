/**
 * TILE-BRUSH GRID MUTATIONS — the small, pure orchestration the editor's pick-first brush runs against a
 * grid. Every grid-write speaks in "tile stack" terms: it goes through the cellStack adapter's stack ops
 * (pushTile / popTile + deriveCellCollision) rather than the low-level grid setters, so there is
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
import { FLOOR_TYPE, type GridAsset, type IsometricGrid } from '@/engine/IsometricGrid'
import type { TileDef } from '@/game/artStyle'
import { deriveCellCollision, getStack, popTile, pushTile, setTileCollision } from '@/engine/cellStack'
import { tileRenderBehavior } from '@/engine/tileset/tileset'
import { placementFor, tileSlug } from './tilePlacement'

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

/** terrain → set (replace) the cell's FLOOR to the tile's slug. setGround places/updates the cell's level-0
 *  floor ASSET, preserving its existing colour/dims (only the slug changes) — one uniform write, no branch. */
export function placeGroundTile(grid: IsometricGrid, col: number, row: number, tile: TileDef): void {
  grid.setGround(col, row, tileSlug(tile.id))
}

/** The default floor slug a freshly-initialised cell starts on (the IsometricGrid ctor fills the whole ground
 *  with it). A CLEARED cell has NO floor at all — this is only the paint/regen default, not the cleared state. */
export const DEFAULT_GROUND_SLUG = 'grass'

/** CLEAR a cell's FLOOR entirely → an EMPTY cell (NOT grass). The floor is a regular tile, so clearing it
 *  removes the floor asset just like popping any tile; a road/plaza/terrain floor all clear the SAME way, no
 *  branch on type/category/height. Pairs with removeTopAsset (which drops the stacked assets) so "Clear tiles"
 *  can EMPTY the whole cell. */
export function clearGroundTile(grid: IsometricGrid, col: number, row: number): void {
  grid.removeFloor(col, row)
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

/** REPLACE the tile at the SELECTED stack slot IN PLACE — the Inspector's "Replace tile" (Image #15). The user's
 *  expectation: picking a Library tile SWAPS the selected tile, it does NOT paint a new one on top (the bug was
 *  Replace running the same stacking path as the paint brush). `stackIndex` is the tile's slot in the cell's
 *  ordered stack (`getAssetsAtCell` order, 0 = the floor slab) — the SAME index the Inspector's `selectedTileLevel`
 *  and the pick key address, so the swap lands on the exact tile the user selected. The tiles above and below are
 *  untouched and the stack height is unchanged.
 *
 *  Two cases, by what sits at the slot — no tile-type branch beyond the floor/non-floor store split:
 *   - the FLOOR slab (`type === floor`): a floor is the cell's ground SLAB, swapped through the ground setter so
 *     the grid's floor index stays consistent. Only a GROUND/terrain tile belongs there, so a non-ground pick is
 *     REFUSED (return false) — the caller treats that as an "add" and stacks it instead.
 *   - any other stacked tile: rewrite the asset IN PLACE to the picked tile, mirroring stackAssetTile's field
 *     map (art / slug / tileOverride / colour / its OWN height DATA / authored settings), keeping its slot
 *     (heightLevel/col/row) and the cell's collision (a per-cell SETTING the user drives, MAP-MODEL §4).
 *  Returns true when it swapped, false when nothing sits at the slot or a floor swap was refused. */
export function replaceTileInPlace(grid: IsometricGrid, col: number, row: number, stackIndex: number, tile: TileDef): boolean {
  const target = grid.getAssetsAtCell(col, row)[stackIndex]
  if (!target) return false
  if (target.type === FLOOR_TYPE) {
    if (placementFor(tile) !== 'terrain') return false // a standing block can't BE the ground slab — caller stacks it
    grid.setGround(col, row, tileSlug(tile.id))
    return true
  }
  // Swap the asset's identity + art + own height in place — same slot, tiles above/below and collision untouched.
  target.art = [tileChar(tile)]
  target.type = tileSlug(tile.id)
  target.tileOverride = tile.id
  target.color = tile.visual.kind === 'ascii' ? undefined : tile.visual.color
  target.height = tile.height ?? 0 // the picked tile's OWN block height (DATA) — read uniformly, like stackAssetTile
  target.label = undefined         // no longer a composition part — it resolves by its own slug / tileOverride now
  target.settings = tileRenderBehavior(tile.settings) ?? undefined // the picked tile's authored render behaviour
  return true
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
