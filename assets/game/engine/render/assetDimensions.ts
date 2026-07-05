/**
 * Per-element dimensions (#77/#78) — resolve an element's sprite-scale multipliers into a
 * concrete draw size for a given view, plus how far to lift the draw center so the base stays
 * planted (Height grows UP, not centered).
 *
 * These are SPRITE SCALE, not footprint/collision — a plant with Height 3 is drawn ~3× tall from
 * its base; it does not occupy 3 cells. (Footprint is #51.)
 */

/** How an element's axes project onto a view. */
export type DimView =
  | 'billboard' // iso + 2D side views: horizontal = Width, vertical = Height (grows up). Depth = no axis.
  | 'overhead' //  top/overhead view: horizontal = Width, vertical = Depth. Height = no axis (looking down it).

/** Per-element sprite-scale multipliers carried on a GridAsset. Every axis defaults to 1 (current look). */
export interface AssetDims {
  /** Uniform Zoom — multiplies every axis at once. */
  scale?: number
  /** Width (x) — horizontal stretch, in every view. */
  scaleX?: number
  /** Height (up) — vertical stretch that grows UP from the base; billboard views only. */
  scaleY?: number
  /** Depth (into-screen ground axis) — renders as vertical stretch in the overhead view only. */
  scaleZ?: number
}

export interface DrawSize {
  /** Draw width in px. */
  w: number
  /** Draw height in px. */
  h: number
  /** Shift the draw CENTER up by this many px so the base stays fixed (billboard only; 0 for overhead). */
  baseLift: number
}

/**
 * Resolve dimensions into a draw size for one view.
 * @param base the renderer's existing fixed sprite size (the current look = all dims at 1).
 */
export function resolveAssetDrawSize(base: number, dims: AssetDims, view: DimView): DrawSize {
  const zoom = dims.scale ?? 1
  const w = base * (dims.scaleX ?? 1) * zoom
  const verticalAxis = view === 'overhead' ? dims.scaleZ ?? 1 : dims.scaleY ?? 1
  const h = base * verticalAxis * zoom
  const baseLift = view === 'overhead' ? 0 : (h - base) / 2
  return { w, h, baseLift }
}
