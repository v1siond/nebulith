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

/** Resolve the iso block height: instance override ?? tile default ?? 0 (flat). An explicit `0` override
 *  forces flat; negatives clamp to flat. The 2D/top views ignore this — a tile is always a flat square there. */
export function resolveTileHeight(tile: HasTileHeight | undefined, asset: HasAssetHeight | undefined): number {
  const h = asset?.height ?? tile?.height ?? 0
  return h > 0 ? h : 0
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
