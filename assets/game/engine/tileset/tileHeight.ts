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
