import { numericDefault } from '@/lib/tileDefaults'

/**
 * Iso BLOCK height for a tile, the "3D" half of the 2D+3D tileset model. A tile is a flat square in
 * 2D/top; in iso it extrudes into `height` stacked blocks (0 = flat ground diamond, 1 = one cube, N = N
 * tall). Height is DATA: a per-tile default the editor overrides per placed instance (the colour-as-data
 * rule). Pure + unit-tested; the iso renderer reads this and extrudes via drawIsoTileBlock.
 */

/** A placed asset's per-instance height override (GridAsset.height, the block count). */
export interface HasAssetHeight {
  height?: number
}

/**
 * THE ONE HEIGHT of a placed tile, in blocks.
 *
 * It reads the PLACEMENT and nothing else. There used to be a chain here, the placement, then the
 * tile, then a literal 1, and a chain like that is a hardcoded fallback for served data, which is a
 * defect and not a safety net (law 7). It also made a setting mean different things depending on which
 * link answered: a tile could never be flat, because 0 fell through to the tile's own number.
 *
 * A placement states its height. `payloadToTile` states it from the column, `placeAsset` states it from
 * the served default, and the column itself has a default, so there is nothing left to guess. The
 * argument to `numericDefault` is not a value this file chooses; it is what to answer in the one moment
 * before the schema has loaded, which the boot gate makes unreachable.
 */
export function resolveTileHeight(asset: HasAssetHeight | undefined): number {
  const stated = asset?.height

  return typeof stated === 'number' && stated >= 0 ? stated : numericDefault('height', 1)
}

/** Render-geometry ONLY (no invented value): how MANY layers the iso renderer stacks for a tile of `blocks`
 *  height. Paired with `layerBlockScale` such that `blockLayers(b) * layerBlockScale(b) === b` exactly.
 *
 *  Blocks are a unit of MEASUREMENT, not a constraint to whole numbers, "we can increase from 0.001 block
 *  size, the blocks and cells are a control of position and measurement, doesn't necessarilly mean everything
 * is handled by integer numbers". The old rule floored the count, so a 4.5-block tile drew 4 blocks tall and the
  * remainder vanished; now the extra layer carries it. A whole-number height (4 → 4 layers
 *  of 1) and a sub-block height (0.1 → 1 layer of 0.1) are unchanged. */
export function blockLayers(blocks: number): number {
  return Math.max(1, Math.ceil(blocks > 0 ? blocks : 0))
}

/** How tall ONE drawn layer is, as a fraction of a full block, `blocks / blockLayers(blocks)`. The layers are
 *  equal, so their total is the tile's exact height. Negative/zero clamps to 0 (nothing to draw). */
export function layerBlockScale(blocks: number): number {
  const h = blocks > 0 ? blocks : 0
  return h / blockLayers(h)
}

/** A tileset tile's own height, from the catalogue. */
export interface HasTileHeight {
  height?: number
}

/**
 * HOW TALL A TILE IS BY DEFAULT, which is a different question from how tall a placement is.
 *
 * The generator asks this when it is deciding what to WRITE onto a placement. The renderer never asks
 * it: by the time a tile is on a map its height is stated on the placement. One function answering
 * both questions is what produced the fallback chain this file used to have.
 */
export function tileCatalogHeight(tile: HasTileHeight | undefined): number {
  const stated = tile?.height

  return typeof stated === 'number' && stated >= 0 ? stated : numericDefault('height', 1)
}
