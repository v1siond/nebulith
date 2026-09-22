/**
 * Per-element dimensions (#77/#78), resolve an element's sprite-scale multipliers into a
 * concrete draw size for a given view, plus how far to lift the draw center so the base stays
 * planted (Height grows UP, not centered).
 *
 * These are SPRITE SCALE, not footprint/collision, a plant with Height 3 is drawn ~3× tall from
 * its base; it does not occupy 3 cells. (Footprint is #51.)
 */

/** How an element's axes project onto a view. */
export type DimView =
  | 'billboard' // iso + 2D side views: horizontal = Width, vertical = Height (grows up). Depth = no axis.
  | 'overhead' //  top/overhead view: horizontal = Width, vertical = Depth. Height = no axis (looking down it).

/** Per-element sprite-scale multipliers carried on a GridAsset. Every axis defaults to 1 (current look). */
// THE THREE AXES, ALL THREE STATED. They were optional here, and every reader then decided for
// itself what an absent one meant, which is the defect phase 3 removes: the column has a default,
// /api/maps/schema serves it, and a placement carries it. There is no such thing as a tile with no
// width.
export interface AssetDims {
  /** WIDTH: how wide the tile draws, in every view. The column's own word. */
  width: number
  /** HEIGHT: how tall it draws, in BLOCKS, growing UP from the base; billboard views only. */
  height: number
  /** Depth, the into-screen ground axis. A SIZE in every view: on screen it is the vertical axis of
   *  the overhead view, and the into-screen axis of the iso box. */
  depth: number
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
  // NO ZOOM. Zoom was a fourth number that multiplied the three axes rather than replacing them, so
  // Width 2 with Zoom 2 drew at 4 and nothing in the panel said so. The axes are the primitive: they
  // can express a uniform size and Zoom could never express a non-uniform one.
  const w = base * dims.width
  // Which axis is VERTICAL on screen depends on where the camera is, and that is the only thing that
  // changes here. Looking down, the screen's vertical axis IS the into-screen ground axis, so Depth
  // draws it. From the side, Height does. Each control means one thing in both.
  const verticalAxis = view === 'overhead' ? dims.depth : dims.height
  const h = base * verticalAxis
  const baseLift = view === 'overhead' ? 0 : (h - base) / 2
  return { w, h, baseLift }
}
