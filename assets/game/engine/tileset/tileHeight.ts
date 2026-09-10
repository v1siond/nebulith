/**
 * Iso BLOCK height for a tile — the "3D" half of the 2D+3D tileset model. A tile is a flat square in
 * 2D/top; in iso it extrudes into `height` stacked blocks (0 = flat ground diamond, 1 = one cube, N = N
 * tall). Height is DATA: a per-tile default the editor overrides per placed instance (the colour-as-data
 * rule). Pure + unit-tested; the iso renderer reads this and extrudes via drawIsoTileBlock.
 */

/** A tileset tile's DEFAULT iso block height. */
export interface HasTileHeight {
  height?: number
}

/** A placed asset's per-instance height override (GridAsset.height — the block count). */
export interface HasAssetHeight {
  height?: number
}

/** Resolve the iso block height of a PLACED block. Height is a per-PLACEMENT value (the block the generator or
 *  editor created) — NOT a property of the art tile. The 2D/top views ignore this; a tile is a flat square there. */
export function resolveTileHeight(tile: HasTileHeight | undefined, asset: HasAssetHeight | undefined): number {
  // A tile is pure ART and carries NO height (Alexander 2026-07-27: "tiles only have data when they're assigned
  // to a cell … the generator should assign the value when creating something"). So we NEVER read the art tile's
  // height — that stray art `0` was what sank the road below the height-1 grass (the trench). Height comes from
  // the PLACED block: the generator/stamp/editor sets `asset.height`. `tile` is kept for call-site stability
  // but intentionally unused.
  void tile
  // ABSENT means one block — "all tiles/blocks are height 1, GLOBAL, no exceptions" still holds for anything
  // that does not say otherwise. But a DELIBERATE 0 is now honoured, which it was not: the old clamp read
  // `h > 0 ? h : 1` and made flat unreachable.
  //
  // Alexander, 2026-09-10: *"we can make the grid have height … that'll allow us to reduce the height of any
  // floor tile to 0 in the generators, for the backend it'll be just a layer of flat tiles."* The two jobs
  // that `height: 1` was doing — giving the map visible thickness, and making each floor a solid cube — are
  // being split. The GRID takes the thickness; the floor becomes a flat skin on it. A flat tile has no side
  // faces, so it cannot occlude, so its place in the draw order stops mattering — which is what unblocks
  // merging ground into runs at all (his Images #27/#28).
  //
  // Negative is still nonsense and still clamps to one block.
  const h = asset?.height ?? 1
  return h >= 0 ? h : 1
}

/** Render-geometry ONLY (no invented value): how MANY layers the iso renderer stacks for a tile of `blocks`
 *  height. Paired with `layerBlockScale` such that `blockLayers(b) * layerBlockScale(b) === b` exactly.
 *
 *  Blocks are a unit of MEASUREMENT, not a constraint to whole numbers — "we can increase from 0.001 block
 *  size, the blocks and cells are a control of position and measurement, doesn't necessarilly mean everything
 *  is handled by integer numbers" (Alexander). The old rule floored the count, so a 4.5-block tile drew 4
 *  blocks tall and the remainder vanished; now the extra layer carries it. A whole-number height (4 → 4 layers
 *  of 1) and a sub-block height (0.1 → 1 layer of 0.1) are unchanged. */
export function blockLayers(blocks: number): number {
  return Math.max(1, Math.ceil(blocks > 0 ? blocks : 0))
}

/** How tall ONE drawn layer is, as a fraction of a full block — `blocks / blockLayers(blocks)`. The layers are
 *  equal, so their total is the tile's exact height. Negative/zero clamps to 0 (nothing to draw). */
export function layerBlockScale(blocks: number): number {
  const h = blocks > 0 ? blocks : 0
  return h / blockLayers(h)
}
