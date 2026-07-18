/**
 * TILE HIT GEOMETRY — the transform-aware shape a placed tile actually occupies ON SCREEN.
 *
 * The editor selector is INVERTED (Alexander): instead of "cursor → cell → topmost tile in the cell", we
 * "cursor → topmost rendered TILE → its cell". To do that the picker needs the tile's REAL rendered
 * silhouette, honouring every render transform (scaleX/Y/Z, scale/zoom, pose x/y/rot/flip, heightLevel lift,
 * zOffset slide, directional depth, single-display, billboard sprites). This module is the ONE place that
 * turns a draw's local geometry + pose into screen-space polygons — reused by BOTH the hit-test and the
 * selection/hover HIGHLIGHT so the outline hugs exactly what was drawn (never the flat ground cell).
 *
 * It is deliberately pure and co-located with the primitives the renderer already uses (isoBlockFaces /
 * isoDepthBox via the caller). The renderer RECORDS these geoms at the draw site (see iso.ts drawIsoAssetAscii
 * → the isoTileHits list) so the pick can never drift from the draw: it IS the draw's geometry.
 */
import type { Pt } from './isoBlock'
import { isoDepthBox, type DepthDir } from './isoBlock'
import { resolvePose, type TilePose } from '@/engine/tileset/pose'

export type { Pt }

/** A stacked iso CUBE (or column of cubes): its BASE diamond + its TOP diamond, each as 4 screen points
 *  [left, back, right, front]. The silhouette is the convex hull of all 8; the wireframe is base ring + top
 *  ring + the 4 verticals. Pose/scale is already baked into the points. */
export interface CubeGeom {
  kind: 'cube'
  base: [Pt, Pt, Pt, Pt]
  top: [Pt, Pt, Pt, Pt]
}

/** Any other rendered tile shape as a screen-space polygon RING (a billboard rect, a ground diamond, or a
 *  directional-depth box hull). Hit-test + outline both use the ring directly. */
export interface PolyGeom {
  kind: 'poly'
  pts: Pt[]
}

export type TileGeom = CubeGeom | PolyGeom

/**
 * The screen mapping for a posed draw: the renderer does `translate(anchor) → applyPose → draw at origin`, so
 * a local point L maps to `anchor + Flip(Rot(scale·L + d))`, d = (dx,dy)·unit, Flip mirrors x when the pose
 * flips (facingDir is 1 for props). Order MIRRORS applyPose (scale innermost, then translate, rotate, flip).
 * No pose → the identity map `anchor + L` (the renderer draws the block AT the anchor with no transform).
 */
export function poseMapper(anchor: Pt, pose: TilePose | null | undefined, unit: number): (p: Pt) => Pt {
  if (!pose) return (p) => ({ x: anchor.x + p.x, y: anchor.y + p.y })
  const r = resolvePose(pose)
  const cos = Math.cos(r.rot)
  const sin = Math.sin(r.rot)
  return (p) => {
    // scale, then translate by the pose offset (in tile-units)
    let vx = r.scale * p.x + r.dx * unit
    let vy = r.scale * p.y + r.dy * unit
    // rotate
    if (r.rot !== 0) {
      const rx = vx * cos - vy * sin
      const ry = vx * sin + vy * cos
      vx = rx
      vy = ry
    }
    // flip (facingDir = 1 for a placed prop → mirror exactly when the pose flips)
    if (r.flip) vx = -vx
    return { x: anchor.x + vx, y: anchor.y + vy }
  }
}

/** The 4 corners of a flat iso diamond centred at (0,0): left, back(top), right, front(bottom). */
function diamondCorners(halfW: number, halfD: number, cy: number): [Pt, Pt, Pt, Pt] {
  return [
    { x: -halfW, y: cy },        // left
    { x: 0, y: cy - halfD },     // back (screen-up)
    { x: halfW, y: cy },         // right
    { x: 0, y: cy + halfD },     // front (screen-down)
  ]
}

/**
 * A stacked cube column's screen geometry. Matches isoBlockFaces EXACTLY: the base diamond sits centred at the
 * anchor (level 0) and the column extrudes UP `blocks · blockH` px to the top cap. `xf` maps local→screen
 * (poseMapper), so pose/scale is honoured. halfW/halfD are the (already scaled) diamond half-extents.
 */
export function cubeGeom(halfW: number, halfD: number, blockH: number, blocks: number, xf: (p: Pt) => Pt): CubeGeom {
  const n = Math.max(1, Math.floor(blocks))
  const topCy = -n * blockH
  const b = diamondCorners(halfW, halfD, 0)
  const t = diamondCorners(halfW, halfD, topCy)
  return {
    kind: 'cube',
    base: [xf(b[0]), xf(b[1]), xf(b[2]), xf(b[3])],
    top: [xf(t[0]), xf(t[1]), xf(t[2]), xf(t[3])],
  }
}

/** A billboard sprite (image/glyph): the rect centred at the local origin with the given draw width/height,
 *  mapped to screen by `xf`. Corners TL, TR, BR, BL. */
export function billboardGeom(w: number, h: number, xf: (p: Pt) => Pt): PolyGeom {
  const hw = w / 2
  const hh = h / 2
  return {
    kind: 'poly',
    pts: [xf({ x: -hw, y: -hh }), xf({ x: hw, y: -hh }), xf({ x: hw, y: hh }), xf({ x: -hw, y: hh })],
  }
}

/** A flat ground/decor diamond centred at the local origin (a floor tile / ground-decor overlay). */
export function diamondGeom(halfW: number, halfD: number, xf: (p: Pt) => Pt): PolyGeom {
  const c = diamondCorners(halfW, halfD, 0)
  return { kind: 'poly', pts: [xf(c[0]), xf(c[1]), xf(c[2]), xf(c[3])] }
}

/**
 * A directional-depth box's screen hull: gather every corner of isoDepthBox at the bottom (level 0) and top
 * (level n-1) levels — top parallelogram + long wall + end cap — map to screen, and take the convex hull. Uses
 * the SAME isoDepthBox the renderer draws with, so the silhouette matches the extruded long box exactly.
 */
export function depthBoxGeom(
  halfW: number,
  halfD: number,
  blockH: number,
  blocks: number,
  depth: number,
  dir: DepthDir,
  xf: (p: Pt) => Pt,
): PolyGeom {
  const n = Math.max(1, Math.floor(blocks))
  const origin: Pt = { x: 0, y: 0 }
  const pts: Pt[] = []
  const gather = (level: number): void => {
    const box = isoDepthBox(origin, halfW, halfD, blockH, depth, dir, level)
    for (const face of [box.top, box.long, box.cap]) {
      pts.push(xf(face.a), xf(face.b), xf(face.c), xf(face.d))
    }
  }
  gather(0)
  gather(n - 1)
  return { kind: 'poly', pts: convexHull(pts) }
}

/** Andrew's monotone-chain convex hull (screen space). Returns the hull ring CCW-ish; ≤2 points pass through. */
export function convexHull(points: readonly Pt[]): Pt[] {
  const pts = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x))
  if (pts.length <= 2) return pts
  const cross = (o: Pt, a: Pt, b: Pt): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: Pt[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: Pt[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

/** Standard ray-cast point-in-polygon (works for convex + concave rings). Edge-inclusive enough for picking. */
export function pointInPolygon(x: number, y: number, poly: readonly Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y
    const xj = poly[j].x, yj = poly[j].y
    const intersect = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

/** The tile's screen SILHOUETTE polygon (convex hull of all its corners) — what the hit-test tests against. */
export function tileGeomPolygon(g: TileGeom): Pt[] {
  if (g.kind === 'poly') return g.pts
  return convexHull([...g.base, ...g.top])
}

/** Is (x,y) inside the tile's rendered silhouette? */
export function pointInTileGeom(x: number, y: number, g: TileGeom): boolean {
  return pointInPolygon(x, y, tileGeomPolygon(g))
}

/** The line SEGMENTS to stroke for a highlight that HUGS the tile: a cube draws its base ring + top ring + the
 *  4 verticals (reads as a 3D block); any poly draws its ring. Each segment is a polyline of points. */
export function outlineSegments(g: TileGeom): Pt[][] {
  if (g.kind === 'poly') return [[...g.pts, g.pts[0]]]
  const [bl, bb, br, bf] = g.base
  const [tl, tb, tr, tf] = g.top
  return [
    [bl, bb, br, bf, bl], // base ring
    [tl, tb, tr, tf, tl], // top ring
    [bl, tl],
    [bb, tb],
    [br, tr],
    [bf, tf],
  ]
}
