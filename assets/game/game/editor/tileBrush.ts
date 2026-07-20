/**
 * TILE-BRUSH GRID MUTATIONS — the small, pure orchestration the editor's pick-first brush runs against a
 * grid. Every grid-write speaks in "tile stack" terms: it goes through the cellStack adapter's stack ops
 * (setFloor / pushTile / popTile + deriveCellCollision) rather than the low-level grid setters, so there is
 * one place — testable without React — that turns an armed catalog TileDef into a placed thing:
 *
 *   - placeGroundTile → terrain: replace the cell's FLOOR tile slug, preserving its colour/dims.
 *   - stackAssetTile  → nature/buildings: PUSH a tile onto the cell's stack (one level above the tallest),
 *                       pinning the exact tile via tileOverride; it inserts at the tile's OWN height (DATA)
 *                       and its collision DERIVES from that height (above-ground blocks, ground walkable).
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

/** nature / buildings → PUSH a tile onto the cell's stack (pushTile lands it one level above the tallest,
 *  0 on an empty cell). tileOverride pins the exact tile.
 *
 *  PER-TILE HEIGHT, READ UNIFORMLY (MAP-MODEL / EDITOR-INTERACTION-SPEC — the user's model): a tile carries
 *  its OWN block height as DATA, and the brush reads it through ONE uniform path — NO type / category / art-
 *  style branch. The MECHANISM is identical for every tile ("all tiles behave the same"); the only difference
 *  is the DATA each tile carries:
 *   - a GROUND/FLAT tile (terrain, flower, fallen leaf, floor decor — DB height 0/min) inserts FLAT: it shows
 *     on the floor face only in iso and is WALKABLE.
 *   - a STANDING tile (tree, rock, building, prop, lamp, mushroom — DB height ≥1) inserts as an extruded BLOCK
 *     and BLOCKS movement.
 *  The exact same line reads every tile's height; a data drift on ONE tile can never reopen a per-category
 *  code split, because there is no category code here.
 *   - `h` = the tile's OWN DB height (0 = flat floor face, ≥1 = N blocks tall). Read, never forced.
 *   - `collision` is DERIVED from that height, uniformly: a tile occupying height > 0 (above ground) blocks
 *     by default; height 0 (on the ground/floor) is walkable. There is NO per-type blocking list. The user
 *     can override Blocked/Walkable per-tile afterwards (the inspector's cell-collision toggle) — that wins.
 *   - `type` is the tile's OWN slug (its identity), not a classified category — the visual is pinned via
 *     tileOverride and height/collision come from the height above, so `type` only labels the placed asset.
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
    collision: height > 0, // above-ground blocks, ground is walkable — derived from height, uniform + overridable
    h: height, // the tile's own height: 0 = flat (floor face only in iso), ≥1 = extruded block
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
