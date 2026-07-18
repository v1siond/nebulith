/**
 * TILE RESIZE HANDLES — the small on-canvas grips that let you resize the SELECTED tile with the mouse
 * (the user's ask: "we also need to be able to control it's size with mouse"). This module is pure geometry
 * + a tiny draw helper; it is the ONE place that turns a tile's already-recorded SILHOUETTE polygon (from
 * tileHit.ts — the transform-aware shape the renderer actually drew) into handle screen points, and maps a
 * drag on a handle back to a dimension value. It invents NO parallel geometry: the caller passes the same
 * silhouette polygon the selection outline hugs, so a handle can never drift from what's on screen.
 *
 * Handle → dimension (matches the modal sliders one-for-one, so drag + slider share one source of truth):
 *   • width  (right-middle)  → scaleX  (DimRow "Width")
 *   • height (top-middle)    → scaleY  (DimRow "Height")
 *   • zwidth (bottom-middle) → depth   (ZWidthRow "Z Width"), ISO only — integer cells
 */
import type { Pt } from './tileHit'

export type HandleId = 'width' | 'height' | 'zwidth'

export interface TileHandle {
  id: HandleId
  /** canvas-internal pixel where the grip is drawn + hit-tested. */
  x: number
  y: number
}

export interface BBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
  cx: number
  cy: number
  width: number
  height: number
}

export interface Range {
  min: number
  max: number
}

/** How close (px) the pointer must be to a handle to grab it. */
export const HANDLE_HIT_RADIUS = 11
/** Half the drawn grip square (px). */
export const HANDLE_SIZE = 5

/** Axis-aligned bounding box + centre of a silhouette polygon. */
export function polyBBox(pts: readonly Pt[]): BBox {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, width: maxX - minX, height: maxY - minY }
}

/**
 * The handle grips for a tile, computed from its silhouette polygon. Width sits on the RIGHT edge, height on
 * the TOP edge, z-width on the BOTTOM edge — each on a different side of the AABB so they never overlap and
 * each reads clearly (right = wider, top = taller, bottom = deeper). z-width is ISO-only (`zWidth`).
 */
export function tileHandlePoints(poly: readonly Pt[], opts: { zWidth: boolean }): TileHandle[] {
  const b = polyBBox(poly)
  const handles: TileHandle[] = [
    { id: 'width', x: b.maxX, y: b.cy },
    { id: 'height', x: b.cx, y: b.minY },
  ]
  if (opts.zWidth) handles.push({ id: 'zwidth', x: b.cx, y: b.maxY })
  return handles
}

/** The handle within `radius` px of (x,y), nearest first, or null. */
export function handleAtPoint(handles: readonly TileHandle[], x: number, y: number, radius: number): TileHandle | null {
  let best: TileHandle | null = null
  let bestD = radius * radius
  for (const h of handles) {
    const dx = h.x - x
    const dy = h.y - y
    const d = dx * dx + dy * dy
    if (d <= bestD) {
      bestD = d
      best = h
    }
  }
  return best
}

/** Project a drag delta onto the handle's OUTWARD axis (away from the tile centre) — the signed px that grows
 *  the dimension: width grows right (+x), height grows up (−y, screen-up), z-width grows down (+y). */
export function dragOutwardPx(id: HandleId, dxPx: number, dyPx: number): number {
  if (id === 'width') return dxPx
  if (id === 'height') return -dyPx
  return dyPx // zwidth
}

const clamp = (v: number, r: Range): number => Math.max(r.min, Math.min(r.max, v))

/**
 * New scale for a width/height drag. `baseHalfPx` is the on-screen half-extent of ONE scale unit (the tile's
 * silhouette half-width/height divided by its current scale), so the dragged edge tracks the cursor: +baseHalfPx
 * of drag = +1.0 scale. Clamped to the slider's range so drag + slider stay interchangeable.
 */
export function scaleFromDrag(baseHalfPx: number, startScale: number, outwardPx: number, range: Range): number {
  const safe = Math.max(1e-6, baseHalfPx)
  return clamp(startScale + outwardPx / safe, range)
}

/**
 * New integer depth (z-width) for a drag. `pxPerCell` is how far you drag to add one cell of extrusion; the
 * result snaps to whole cells (depth is a cell count) and clamps to the Z-Width slider's range.
 */
export function depthFromDrag(pxPerCell: number, startDepth: number, outwardPx: number, range: Range): number {
  const safe = Math.max(1e-6, pxPerCell)
  return clamp(Math.round(startDepth + Math.round(outwardPx / safe)), range)
}

/** Draw the handle grips: a filled accent square with a light border at each point, legible over any tile. */
export function drawTileHandles(
  ctx: CanvasRenderingContext2D,
  handles: readonly TileHandle[],
  opts: { fill?: string; stroke?: string; size?: number } = {},
): void {
  const s = opts.size ?? HANDLE_SIZE
  ctx.save()
  ctx.lineWidth = 1.5
  ctx.fillStyle = opts.fill ?? '#22d3ee' // cyan-400, matches the settings-panel accent
  ctx.strokeStyle = opts.stroke ?? '#ffffff'
  for (const h of handles) {
    ctx.beginPath()
    ctx.rect(h.x - s, h.y - s, s * 2, s * 2)
    ctx.fill()
    ctx.stroke()
  }
  ctx.restore()
}
