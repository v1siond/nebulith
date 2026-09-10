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

/**
 * The iso block height of a placed tile: the PLACEMENT's own height if it pins one, else the TILE's height
 * from the backend, else one block.
 *
 * The tile's number is read again. It used to be thrown away (`void tile`) because the served data was
 * INCONSISTENT — `road` and `grass` said 0 while `meadow`, `water` and `path_stone` said 1, so a road sank
 * below the grass beside it and made a trench. Ignoring the data hid that, at the cost of making the setting
 * unusable: a floor could never be flat, and nothing about a tile's height could be saved.
 *
 * Alexander, 2026-09-10: *"floors should be generated with height 0, which mean, the height setting from the
 * floor tile is 0, which allow us to save it in the backend … floor are regular fucking tiles, nothing more
 * nothing less."* So the data is fixed instead of ignored, and this reads it.
 *
 * Order, and why: a PLACEMENT wins because that is a decision someone made about this specific block (the
 * editor's Z control, a composition's authored pier). The TILE's height is what the thing is by default.
 * Neither invents anything; absent everywhere means one block. Negative is nonsense and clamps.
 */
export function resolveTileHeight(tile: HasTileHeight | undefined, asset: HasAssetHeight | undefined): number {
  const h = asset?.height ?? tile?.height ?? 1
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
