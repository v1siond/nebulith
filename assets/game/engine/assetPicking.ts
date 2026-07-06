/**
 * Sprite-aware click hit-testing for placed grid ASSETS (props: trees, flowers, rocks, lamps…).
 *
 * The renderers draw a prop's sprite as a BILLBOARD that stands UP from its base cell (a tree is drawn
 * ~2–3 cells tall in iso/2d), so a click ON the sprite lands on a cell ABOVE the asset's base in screen
 * space. Selecting by the raw ground cell (`screenToCell`) therefore misses tall props — you could only
 * click compact, on-cell sprites (a lamp). This mirrors `entityAtClick` (which already does this for
 * units): check the exact cell, then walk screen-DOWN toward the base to find the prop whose sprite
 * covers where you clicked. Pure + view-aware.
 */

/** The minimal shape needed to hit-test a placed asset. `footprint` (a side length) makes it a
 *  top-left-anchored square; absent = a single cell. */
export interface PickableAsset {
  col: number
  row: number
  footprint?: number
}

/** Does the asset's (top-left-anchored, square) footprint cover (col,row)? */
export function assetCovers(asset: PickableAsset, col: number, row: number): boolean {
  const fp = asset.footprint ?? 1
  return col >= asset.col && col < asset.col + fp && row >= asset.row && row < asset.row + fp
}

/** The topmost (last-drawn) asset whose footprint covers (col,row), or null. Iterates last→first so
 *  the asset painted on top wins ties. */
export function assetAtFootprint<T extends PickableAsset>(assets: readonly T[], col: number, row: number): T | null {
  for (let i = assets.length - 1; i >= 0; i--) {
    if (assetCovers(assets[i], col, row)) return assets[i]
  }
  return null
}

/** Screen-up cells the sprite can reach above its base, per view (top = drawn on-cell → exact only). */
const SPRITE_SPAN: Record<'top' | '2d' | 'iso', number> = { top: 0, '2d': 2, iso: 3 }

/**
 * Hit-test a click (given as the ground cell under the cursor) to a placed asset, accounting for the
 * billboard. Exact cell first; then walk screen-DOWN toward the base — `+row` in 2d, `+col,+row` in iso
 * (screen-up is `-row` / `-col,-row`) — up to the view's sprite span, probing the centre + flanking
 * columns so clicking the sprite's edge still hits. Top view checks only the exact cell.
 */
export function assetAtClick<T extends PickableAsset>(
  assets: readonly T[],
  col: number,
  row: number,
  view: 'top' | '2d' | 'iso',
): T | null {
  const exact = assetAtFootprint(assets, col, row)
  if (exact || view === 'top') return exact
  const dc = view === 'iso' ? 1 : 0 // screen-down toward the base: iso = +col,+row; 2d = +row
  const span = SPRITE_SPAN[view]
  for (let k = 1; k <= span; k++) {
    for (const dCol of [0, -1, 1]) {
      const hit = assetAtFootprint(assets, col + dc * k + dCol, row + k)
      if (hit) return hit
    }
  }
  return null
}
