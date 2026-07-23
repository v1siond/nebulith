/**
 * The 3D half of the 2D+3D tileset model: extrude a cell's flat diamond into an iso CUBE.
 *
 * A tile is a flat square in 2D/top; in iso a tile (or placed asset) with height ≥ 1 rises into
 * `height` stacked blocks. `isoBlockFaces` returns the geometry of ONE block at a given stacking
 * `level`: its TOP face plus the two CAMERA-VISIBLE side faces (the front-left L→B wall and the
 * front-right B→R wall — the same two edges the ground cube exposes). The two far walls and the
 * bottom are never seen, so they're never emitted.
 *
 * Conventions MIRROR the ground cube (drawIsoGroundLayer) and drawIsoBuilding: a cell centred at
 * (px, py) is a diamond with half-extents (tileW, tileH); one block is `blockH` px tall. Each face
 * is a quad [a, b, c, d] where `a` is the fillIsoFaceWithTile ORIGIN (bottom-left corner),
 * eA = b − a is the bottom edge and eB = d − a is the up/side edge — so a tile shears onto the face
 * at the iso angle exactly like a wall, and the top face reads as a flat diamond.
 *
 * Pure geometry, unit-tested. drawIsoTileBlock (impure canvas glue in iso.ts) stacks these and fills
 * each face via fillIsoFaceWithTile.
 */

export type Pt = { x: number; y: number }

/** A face as four corners in fillIsoFaceWithTile order: a = origin, b = a + bottom-edge, d = a + up-edge. */
export interface BlockFace {
  a: Pt
  b: Pt
  c: Pt
  d: Pt
}

export interface BlockFaces {
  top: BlockFace
  left: BlockFace
  right: BlockFace
}

/** The three visible faces of the block at stacking `level` (0 = the block sitting on the ground; 1 =
 *  the block stacked on top of it; …). `center` is the cell diamond centre at ground level (screen space,
 *  height-offset already applied). */
export function isoBlockFaces(center: Pt, tileW: number, tileH: number, blockH: number, level = 0): BlockFaces {
  const px = center.x
  const by = center.y - level * blockH // this block's BASE diamond centre-y (lower on screen)
  const ty = by - blockH // this block's TOP diamond centre-y (one block higher)

  return {
    // TOP: the diamond at `ty`, as a flat fillIsoFaceWithTile diamond (origin = left corner, eA → top, eB → bottom).
    top: {
      a: { x: px - tileW, y: ty }, // left
      b: { x: px, y: ty - tileH }, // top
      c: { x: px + tileW, y: ty }, // right
      d: { x: px, y: ty + tileH }, // bottom
    },
    // LEFT: the front-left L→B wall, rising from the base diamond (by) to the top diamond (ty).
    left: {
      a: { x: px - tileW, y: by }, // bottom-left  = L at base
      b: { x: px, y: by + tileH }, // bottom-right = B at base
      c: { x: px, y: ty + tileH }, // top-right    = B at top
      d: { x: px - tileW, y: ty }, // top-left     = L at top
    },
    // RIGHT: the front-right B→R wall.
    right: {
      a: { x: px, y: by + tileH }, // bottom-left  = B at base
      b: { x: px + tileW, y: by }, // bottom-right = R at base
      c: { x: px + tileW, y: ty }, // top-right    = R at top
      d: { x: px, y: ty + tileH }, // top-left     = B at top
    },
  }
}

/**
 * DIRECTIONAL DEPTH — a block extruded into a long iso box.
 *
 * A block with `depth = D` and one of the four diagonal `DepthDir`s renders as ONE long box spanning D
 * cells along that diagonal, anchored at its base cell — NOT D separate cubes and NOT a symmetric widening.
 * The direction is a screen-space step (in the SAME tileW/tileH units isoBlockFaces uses), derived from the
 * iso projection (Kx per unit of col−row, Ky per unit of col+row): +col = (+tileW,+tileH) = right-down,
 * +row = (−tileW,+tileH) = left-down, −col = (−tileW,−tileH) = left-up, −row = (+tileW,−tileH) = right-up.
 */
export type DepthDir = 'right-up' | 'left-up' | 'left-down' | 'right-down'

/** Screen-space per-cell step for each direction, in tileW/tileH units (see the mapping above). */
export const DEPTH_STEP: Record<DepthDir, { sx: number; sy: number }> = {
  'right-up': { sx: +1, sy: -1 }, // −row
  'left-up': { sx: -1, sy: -1 }, // −col
  'left-down': { sx: -1, sy: +1 }, // +row
  'right-down': { sx: +1, sy: +1 }, // +col
}

/** GRID per-cell step (which cells the box covers) for each direction — the collision + depth-sort axis. */
export const DEPTH_CELL_STEP: Record<DepthDir, { dc: number; dr: number }> = {
  'right-up': { dc: 0, dr: -1 },
  'left-up': { dc: -1, dr: 0 },
  'left-down': { dc: 0, dr: +1 },
  'right-down': { dc: +1, dr: 0 },
}

/**
 * Rotate a directional-depth `dir` by `rotation` CW quarter-turns (0–3; negatives/≥4 wrap) — the SAME grid
 * rotation `rotateFootprintOffset` applies to a composition cell's offset, so a span authored along the +row
 * (south, `left-down`) axis follows its building when it's rotated to face east/west/north (no sideways roof).
 * DERIVED from DEPTH_CELL_STEP: one CW quarter-turn sends a grid step (dc,dr) → (−dr,dc); apply it `k` times
 * and map the resulting unit vector back to its direction name (the four dirs are closed under the turn). Pure.
 */
export function rotateDepthDir(dir: DepthDir, rotation: number): DepthDir {
  const k = ((rotation % 4) + 4) % 4
  let { dc, dr } = DEPTH_CELL_STEP[dir]
  for (let i = 0; i < k; i++) [dc, dr] = [-dr, dc]
  return (Object.keys(DEPTH_CELL_STEP) as DepthDir[]).find(d => DEPTH_CELL_STEP[d].dc === dc && DEPTH_CELL_STEP[d].dr === dr)!
}

/**
 * Z-POSITION — slide a tile along an ISO DIAGONAL (NOT a vertical lift). `z` is the magnitude in cells;
 * `dir` picks one of the four iso diagonals (the SAME 4 dirs as directional depth / z-width). +z slides
 * the tile TOWARD `dir`, −z toward its opposite. Returns the screen-space offset in the caller's tileW/tileH
 * units (the iso half-diamond extents), so ±1 lands the tile on the neighbouring diamond exactly like the
 * z-width per-cell step: right-up = (+tileW,−tileH) up-right, right-down = (+tileW,+tileH) down-right, etc.
 * Pure — unit-tested.
 */
export function isoZOffset(z: number, dir: DepthDir, tileW: number, tileH: number): { dx: number; dy: number } {
  const s = DEPTH_STEP[dir]
  return { dx: z * s.sx * tileW, dy: z * s.sy * tileH }
}

/** The extruded long box: its top parallelogram + the two CAMERA-VISIBLE walls (one runs the full length,
 *  the other is a single-cell end cap), each tagged with which unit-cube shade it wears (leftShade for a
 *  +row/L→B face, rightShade for a +col/B→R face) so the draw path reuses the existing lighting untouched. */
export interface DepthBoxFaces {
  top: BlockFace
  long: BlockFace
  cap: BlockFace
  longShade: 'left' | 'right'
  capShade: 'left' | 'right'
}

/** The D grid cells a depth box covers: anchor (col,row) then D−1 steps along the direction's grid axis.
 *  Anchor stays the base cell. Pure — used for collision-adapt and depth-sort. depth≤1 → just the anchor. */
export function depthCells(col: number, row: number, depth: number, dir: DepthDir): { col: number; row: number }[] {
  const n = Math.max(1, Math.floor(depth))
  const { dc, dr } = DEPTH_CELL_STEP[dir]
  const out: { col: number; row: number }[] = []
  for (let k = 0; k < n; k++) out.push({ col: col + k * dc, row: row + k * dr })
  return out
}

/** How much a depth box reaches TOWARD the camera (in col+row units) past its anchor — the FRONTMOST covered
 *  cell's (col+row) minus the anchor's. Approaching dirs (+col/+row) reach (D−1) closer; receding dirs
 *  (−col/−row) reach 0 (the anchor stays the frontmost). Added to the iso depth-sort key so a box that
 *  extends toward the camera sorts in FRONT of what it overlaps, and receding boxes stay byte-identical. */
export function depthFrontExtent(depth: number, dir: DepthDir): number {
  const n = Math.max(1, Math.floor(depth))
  const { dc, dr } = DEPTH_CELL_STEP[dir]
  return dc + dr > 0 ? n - 1 : 0
}

/**
 * The extruded-hull faces of a depth-D box at stacking `level` — the outer hull only (no internal seams).
 * The unit block is swept `(D−1)` steps along `dir`: its TOP diamond becomes a long parallelogram (the two
 * LEADING corners pushed by the sweep vector, the two trailing corners anchored), one front wall runs the
 * full length, and the other front wall stays a single-cell end cap. Same conventions as isoBlockFaces so
 * fillIsoFaceWithTile shears a tile onto every face exactly like a unit cube. Pure, unit-tested.
 */
export function isoDepthBox(
  center: Pt,
  tileW: number,
  tileH: number,
  blockH: number,
  depth: number,
  dir: DepthDir,
  level = 0,
): DepthBoxFaces {
  const px = center.x
  const by = center.y - level * blockH // base diamond centre-y
  const ty = by - blockH // top diamond centre-y
  const n = Math.max(1, Math.floor(depth))
  const s = DEPTH_STEP[dir]
  const ox = (n - 1) * s.sx * tileW
  const oy = (n - 1) * s.sy * tileH
  const o = (p: Pt): Pt => ({ x: p.x + ox, y: p.y + oy }) // push a corner to the FAR end of the sweep

  // Unit-cube diamond corners: top-level (y = ty) and base-level (L/R at by, B at by+tileH).
  const L = { x: px - tileW, y: ty }
  const T = { x: px, y: ty - tileH }
  const R = { x: px + tileW, y: ty }
  const B = { x: px, y: ty + tileH }
  const Lb = { x: px - tileW, y: by }
  const Rb = { x: px + tileW, y: by }
  const Bb = { x: px, y: by + tileH }

  // Per-direction hull. The LONG wall + CAP are always the two front (+col/+row) walls of the unit cube; the
  // sweep turns one into a length-spanning parallelogram and translates/keeps the other as the visible cap.
  switch (dir) {
    case 'right-up': // −row: RIGHT wall runs long, LEFT wall is the NEAR cap (unmodified)
      return {
        top: { a: L, b: o(T), c: o(R), d: B },
        long: { a: Bb, b: o(Rb), c: o(R), d: B }, // B→R+off, +col face
        cap: { a: Lb, b: Bb, c: B, d: L }, // unit LEFT, +row face
        longShade: 'right',
        capShade: 'left',
      }
    case 'left-down': // +row: RIGHT wall runs long, LEFT wall is the FAR cap (translated)
      return {
        top: { a: T, b: R, c: o(B), d: o(L) },
        long: { a: Rb, b: o(Bb), c: o(B), d: R }, // R→B+off, +col face
        cap: { a: o(Lb), b: o(Bb), c: o(B), d: o(L) }, // unit LEFT + off, +row face
        longShade: 'right',
        capShade: 'left',
      }
    case 'left-up': // −col: LEFT wall runs long, RIGHT wall is the NEAR cap (unmodified)
      return {
        top: { a: R, b: B, c: o(L), d: o(T) },
        long: { a: o(Lb), b: Bb, c: B, d: o(L) }, // B→L+off, +row face
        cap: { a: Bb, b: Rb, c: R, d: B }, // unit RIGHT, +col face
        longShade: 'left',
        capShade: 'right',
      }
    case 'right-down': // +col: LEFT wall runs long, RIGHT wall is the FAR cap (translated)
      return {
        top: { a: L, b: T, c: o(R), d: o(B) },
        long: { a: Lb, b: o(Bb), c: o(B), d: L }, // L→B+off, +row face
        cap: { a: o(Bb), b: o(Rb), c: o(R), d: o(B) }, // unit RIGHT + off, +col face
        longShade: 'left',
        capShade: 'right',
      }
  }
}
