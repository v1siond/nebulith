/**
 * Per-cell GROUND/FLOOR dims — "the settings are available FOR EVERY TILE not just decorations".
 *
 * A bare floor cell (no prop) carries the SAME Width/Height/Depth/Zoom a prop carries (the AssetDims
 * scaleX/scaleY/scaleZ/scale fields) PLUS a per-cell pose, applied to that ONE floor cell's render in
 * both the 2D (overhead) and iso ground draws. Every field is optional; an all-unset cell resolves to
 * identity so the default render stays byte-identical to before this system existed.
 *
 * Height (scaleY) has NO axis on a flat floor tile (looking down/along it) — the cell's vertical extent
 * is the terrain "Grid height" tool, not a sprite stretch — so the size factors ignore it. It is still
 * carried (and counts as an override) so a value the user sets round-trips through save/load.
 */
import type { TilePose } from './tileset/pose'

export interface GroundCellDims {
  /** Width (x) — horizontal stretch (overhead x / iso ground x). */
  scaleX?: number
  /** Height (up) — no axis on a flat floor; carried for parity with props (see file header). */
  scaleY?: number
  /** Depth (into-screen ground axis) — overhead vertical / iso ground y. */
  scaleZ?: number
  /** Zoom — uniform multiplier over every axis. */
  scale?: number
  /** Per-cell position/rotation of the floor tile within its own cell (NOT the shared tile-kind pose). */
  pose?: TilePose
}

/**
 * Horizontal (Width × Zoom) and ground (Depth × Zoom) size factors for the flat floor tile — the ONE
 * geometry contract read by both the overhead and iso ground renderers. Default/unset → { fx: 1, fy: 1 }
 * so the tile fills its cell exactly as before.
 */
export function groundSizeFactors(d?: GroundCellDims | null): { fx: number; fy: number } {
  const zoom = d?.scale ?? 1
  return { fx: (d?.scaleX ?? 1) * zoom, fy: (d?.scaleZ ?? 1) * zoom }
}

/** True when the dims would change the render — any non-identity size axis (incl. Height, so a set value
 *  persists) or a non-identity pose. False keeps the cell on the fast, byte-identical default path. */
export function groundDimsActive(d?: GroundCellDims | null): boolean {
  if (!d) return false
  if (d.scaleX != null && d.scaleX !== 1) return true
  if (d.scaleY != null && d.scaleY !== 1) return true
  if (d.scaleZ != null && d.scaleZ !== 1) return true
  if (d.scale != null && d.scale !== 1) return true
  return poseActive(d.pose)
}

/** A pose is active when it emits a non-identity transform (offset / rotation / mirror / non-1 scale). */
function poseActive(p?: TilePose): boolean {
  if (!p) return false
  return !!(p.dx || p.dy || p.rot || p.flip || (p.scale != null && p.scale !== 1))
}
