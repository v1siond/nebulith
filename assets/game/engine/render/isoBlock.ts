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
/**
 * A cell's ground footprint as its FOUR corners, offset from the cell centre.
 *
 * The names are positional on screen — `l`eft, `t`op, `r`ight, `b`ottom — and the block builder walks them
 * in that cyclic order, so a THINNED footprint (a parallelogram) composes exactly like the full diamond.
 */
export interface GroundQuad {
  l: Pt
  t: Pt
  r: Pt
  b: Pt
}

/** The full cell: the unit diamond every block has drawn on since the beginning. */
export function unitGroundQuad(tileW: number, tileH: number): GroundQuad {
  return {
    l: { x: -tileW, y: 0 },
    t: { x: 0, y: -tileH },
    r: { x: tileW, y: 0 },
    b: { x: 0, y: tileH },
  }
}

/** THICKNESS as four independent REACHES — how far the block extends toward each world direction, as a
 *  fraction of the cell. 1 (the default) reaches all the way to that face; lowering it pulls that face in. */
export type ThicknessReach = Partial<Record<DepthDir, number>>

/** The opposite iso diagonal (180°). */
const OPPOSITE_DIR: Record<DepthDir, DepthDir> = {
  'left-up': 'right-down', 'right-down': 'left-up', 'right-up': 'left-down', 'left-down': 'right-up',
}

/** A reach, clamped to (0, 1]. Anything else (missing, NaN, negative, > 1) means "all the way". */
const reachOf = (reach: ThicknessReach, dir: DepthDir): number => {
  const raw = reach[dir]
  return typeof raw === 'number' && raw > 0 && raw < 1 ? raw : 1
}

/** Never let two opposing reaches close the block to nothing — it would silently vanish mid-drag. */
const MIN_SPAN = 0.05

/**
 * THICKNESS: the block's footprint INSIDE its own cell, from four independent per-direction reaches.
 *
 * This is the same question the Footprint asks — "how far does this tile reach toward ⟨direction⟩?" — only
 * the unit differs: Footprint counts whole CELLS (≥1), thickness measures WITHIN one cell (≤1). Alexander
 * asked for the two to work alike, so they share the vocabulary, the four diagonals and the control shape.
 *
 * The axes are WORLD axes, not screen ones: a cell's ground axes are the diamond's DIAGONALS
 * (`u = (+tileW,+tileH)` = +col, `v = (−tileW,+tileH)` = +row), so the old screen-extent squash thinned along
 * no world direction at all — which is why a door read thin from one side of the house and solid from the
 * other. Along each axis the block spans from `1 − reach(back)` to `reach(forward)`, so a door with reach 1
 * toward its wall and 0.3 the other way is a 0.3-thick panel FLUSH with that wall.
 */
export function reachGroundQuad(tileW: number, tileH: number, reach: ThicknessReach): GroundQuad {
  const full = unitGroundQuad(tileW, tileH)

  // Parameters along the two world axes, each in [0,1] across the cell. `+col` runs t→r, `+row` runs t→l.
  const span = (forward: DepthDir): [number, number] => {
    const hi = reachOf(reach, forward)
    const lo = 1 - reachOf(reach, OPPOSITE_DIR[forward])
    if (hi - lo >= MIN_SPAN) return [lo, hi]
    const mid = (lo + hi) / 2 // both sides pulled past each other → keep a visible sliver where they met
    return [mid - MIN_SPAN / 2, mid + MIN_SPAN / 2]
  }
  const [c0, c1] = span('right-down') // +col
  const [r0, r1] = span('left-down')  // +row

  if (c0 === 0 && c1 === 1 && r0 === 0 && r1 === 1) return full // untouched → the byte-identical unit cell

  // The corner at (col a, row b), with `t` as the origin and the two cell edges as the basis.
  const u = { x: tileW, y: tileH }   // +col
  const v = { x: -tileW, y: tileH }  // +row
  const at = (a: number, b: number): Pt => ({
    x: full.t.x + u.x * a + v.x * b,
    y: full.t.y + u.y * a + v.y * b,
  })
  // Keep the positional corner NAMES: l is +row-most/−col, t the origin corner, r +col, b both.
  return { t: at(c0, r0), r: at(c1, r0), b: at(c1, r1), l: at(c0, r1) }
}

/** Turn a reach map by `rotation` quarter-turns — the KEYS move, the values ride along. Thickness axes are
 *  WORLD axes, so they rotate with the camera (`orientAssetForView`) and with the building a tile is stamped
 *  into (`compositionCellRender`), exactly like `depthDir`. */
export function rotateThicknessReach(reach: ThicknessReach, rotation: number): ThicknessReach {
  const out: ThicknessReach = {}
  for (const [dir, value] of Object.entries(reach) as [DepthDir, number][]) {
    out[rotateDepthDir(dir, rotation)] = value
  }
  return out
}

/**
 * Shrink along ONE axis to a fraction `t`, HUGGING the face `dir` points at — the authoring shorthand a
 * backend tile uses ("a door is 0.3 thick toward its wall"). Expressed in reaches: full toward `dir`, `t`
 * toward its opposite.
 */
export function thinGroundQuad(tileW: number, tileH: number, dir: DepthDir, t: number): GroundQuad {
  if (!(t > 0) || t >= 1) return unitGroundQuad(tileW, tileH)
  return reachGroundQuad(tileW, tileH, { [OPPOSITE_DIR[dir]]: t })
}

export function isoBlockFaces(
  center: Pt,
  tileW: number,
  tileH: number,
  blockH: number,
  level = 0,
  /** The ground footprint, as corner offsets from the cell centre. Defaults to the FULL cell, so every
   *  existing caller draws byte-identically; a THINNED quad (`thinGroundQuad`) composes the same way
   *  because the corners keep their cyclic order — the walls are still "the two edges meeting at `b`". */
  quad: GroundQuad = unitGroundQuad(tileW, tileH),
): BlockFaces {
  const px = center.x
  const by = center.y - level * blockH // this block's BASE diamond centre-y (lower on screen)
  const ty = by - blockH // this block's TOP diamond centre-y (one block higher)

  // A corner of the footprint, placed on the TOP plane (`ty`) or the BASE plane (`by`).
  const at = (c: Pt, planeY: number): Pt => ({ x: px + c.x, y: planeY + c.y })

  return {
    // TOP: the footprint at `ty`, as a flat fillIsoFaceWithTile quad (origin = left corner, eA → top, eB → bottom).
    top: {
      a: at(quad.l, ty),
      b: at(quad.t, ty),
      c: at(quad.r, ty),
      d: at(quad.b, ty),
    },
    // LEFT: the front-left L→B wall, rising from the base footprint (by) to the top one (ty).
    left: {
      a: at(quad.l, by), // bottom-left  = L at base
      b: at(quad.b, by), // bottom-right = B at base
      c: at(quad.b, ty), // top-right    = B at top
      d: at(quad.l, ty), // top-left     = L at top
    },
    // RIGHT: the front-right B→R wall.
    right: {
      a: at(quad.b, by), // bottom-left  = B at base
      b: at(quad.r, by), // bottom-right = R at base
      c: at(quad.r, ty), // top-right    = R at top
      d: at(quad.b, ty), // top-left     = B at top
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

/** Normalize a BIDIRECTIONAL span (anchor + `depth` ahead along `dir`, plus `depthBack` behind it) into the
 *  one-way span every depth fn already understands: the anchor moves BACK `depthBack` cells along −dir and the
 *  depth grows to depthBack+depth. depthBack ≤ 0 → anchor + depth unchanged (today's one-way span, byte-identical).
 *  So authoring can z-width BOTH ways (Alexander #58) while depthCells / isoDepthBox / spanBackmost / the depth
 *  sort keep their single "anchor is the start, depth runs along dir" contract untouched. Pure, unit-tested. */
export function normalizeDepthSpan(col: number, row: number, depth: number | undefined, depthBack: number | undefined, dir: DepthDir): { col: number; row: number; depth: number } {
  const b = Math.max(0, Math.floor(depthBack ?? 0))
  const d = Math.max(1, Math.floor(depth ?? 1))
  if (b === 0) return { col, row, depth: d }
  const { dc, dr } = DEPTH_CELL_STEP[dir]
  return { col: col - b * dc, row: row - b * dr, depth: b + d }
}

/** The GRID extents of a 2-axis z-width tile — how many cells it spans in each of ±col/±row from its anchor.
 *  Folds the model (depthDir + depth/depthBack on the primary axis, depthPerp/depthPerpBack on the perpendicular)
 *  into a plain rectangle cols [col−colMinus, col+colPlus] × rows [row−rowMinus, row+rowPlus]. `depth` INCLUDES the
 *  anchor (depth−1 cells forward); the other three are cells BEYOND the anchor. depthDir absent → all 0 (1 cell). */
export function assetRectExtents(a: { depthDir?: DepthDir; depth?: number; depthBack?: number; depthPerp?: number; depthPerpBack?: number }): { colMinus: number; colPlus: number; rowMinus: number; rowPlus: number } {
  const ext = { colMinus: 0, colPlus: 0, rowMinus: 0, rowPlus: 0 }
  const dir = a.depthDir
  if (!dir) return ext
  const add = (d: DepthDir, cells: number): void => {
    if (cells <= 0) return
    const { dc, dr } = DEPTH_CELL_STEP[d]
    if (dc > 0) ext.colPlus += cells
    else if (dc < 0) ext.colMinus += cells
    if (dr > 0) ext.rowPlus += cells
    else if (dr < 0) ext.rowMinus += cells
  }
  add(dir, Math.max(0, Math.floor(a.depth ?? 1) - 1)) // primary FORWARD (depth incl. anchor)
  add(rotateDepthDir(dir, 2), Math.max(0, Math.floor(a.depthBack ?? 0))) // primary BACK (opposite)
  const perp = rotateDepthDir(dir, 1)
  add(perp, Math.max(0, Math.floor(a.depthPerp ?? 0))) // perpendicular FORWARD
  add(rotateDepthDir(perp, 2), Math.max(0, Math.floor(a.depthPerpBack ?? 0))) // perpendicular BACK
  return ext
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
 * Restate a span from the end FARTHEST from the camera: the same cells, described from the other end.
 *
 * The depth sort keys on a span's anchor and only adds its length when the span runs toward the camera
 * (`depthFrontExtent`) — both rest on one invariant: THE ANCHOR IS THE BACKMOST CELL. Authoring holds to it
 * (`compressGround` anchors a run at min col/row; `right-down`/`left-down` both step forward), but a rotated
 * camera can turn a span's axis to `left-up`/`right-up`, which runs BACKWARD from the anchor. The anchor is
 * then the span's FRONT end, the sort treats it as the back, and the run draws over everything behind it —
 * a merged grass run painting over the tree trunks it should sit behind.
 *
 * Re-anchoring restores the invariant instead of teaching every sort rule about a second case. Pure.
 */
export function spanBackmost(col: number, row: number, depth: number, dir: DepthDir): { col: number; row: number; dir: DepthDir } {
  const n = Math.floor(depth)
  if (n <= 1) return { col, row, dir } // a single cell has no far end
  const { dc, dr } = DEPTH_CELL_STEP[dir]
  if (dc + dr > 0) return { col, row, dir } // already anchored at the back
  return { col: col + dc * (n - 1), row: row + dr * (n - 1), dir: rotateDepthDir(dir, 2) }
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
  // NEAR-cap vs FAR-cap is decided by whether the sweep RECEDES or APPROACHES: the visible cap sits on the
  // cell CLOSEST to the camera. A RECEDING dir (−row 'right-up' / −col 'left-up') sweeps away from the anchor,
  // so the anchor cell is the front → the cap is the UNMODIFIED unit wall (near). An APPROACHING dir (+row /
  // +col) sweeps toward the camera, so the swept FAR end is the front → the cap is TRANSLATED by `o(...)`.
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
