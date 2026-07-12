/**
 * The roof as STACKED TILES, not a special drawer. Instead of one flat roof lid per footprint cell, each
 * footprint COLUMN gets a STACK of roof blocks whose height forms a peaked gable — a flat ridge in the middle
 * sloping down to a single covering block at the eaves. Stacked through the generic per-block render path, those
 * same roof tiles project to a TRIANGLE (2D front), a 3D GABLE (iso), and the footprint RECTANGLE (top) — one
 * stacked-tile structure, three views (Alexander's 3-view house reference). Pure geometry, unit-tested.
 *
 * Convention (mirrors the retired drawIsoPeakedRoof): the ridge runs along the DEPTH (rows); the gable spans the
 * WIDTH (cols). `roofRows` = gable RISE in blocks above the eave layer; `ridgeFrac` = flat-ridge width / footprint width.
 */

/** How many roof blocks stack above the wall-top at column `col` of a `rect.w`-wide footprint starting at `rect.col`.
 *  Always ≥ 1 (the roof covers every footprint cell from above); peaks at `1 + roofRows` across the flat ridge. */
export function gableRoofLevels(col: number, rect: { col: number; w: number }, roofRows: number, ridgeFrac: number): number {
  const half = (rect.w - 1) / 2
  if (half <= 0) return 1 + roofRows // a 1-wide footprint is all ridge
  const center = rect.col + half
  const d = Math.abs(col - center)
  const ridgeHalf = (rect.w * ridgeFrac) / 2
  if (d <= ridgeHalf) return 1 + roofRows // flat ridge, full height
  const t = (half - d) / (half - ridgeHalf) // 1 at the ridge edge → 0 at the eave
  return 1 + Math.max(0, Math.round(roofRows * t))
}

/** Gable RISE in blocks above the eave layer. 1 → the roof is at MOST 2 blocks tall (eave = 1, ridge = 2). */
export const ROOF_ROWS = 1
/** Flat-ridge width as a fraction of the footprint width (a wider fraction = a flatter, more box-like top). */
export const ROOF_RIDGE_FRAC = 0.46
