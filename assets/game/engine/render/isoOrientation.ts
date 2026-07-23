/**
 * isoOrientation — the PURE, dependency-free math for a 4-way (90°) isometric camera rotation and the
 * matching tile-facing. No React, no canvas, no imports; every function is a single-purpose pure map.
 *
 * ─── The model ────────────────────────────────────────────────────────────────────────────────────────
 * The iso renderer (engine/render/iso.ts) has ONE fixed projection: a grid coord (col,row) maps to screen
 * with x ∝ (col − row) and y ∝ (col + row) — so +col points down-right, +row points down-left, the world
 * origin (0,0) is the BACK/top corner, and a higher (col + row) is nearer the camera (the FRONT/bottom).
 * We DON'T touch that projection. Instead we rotate the grid coordinate BEFORE projecting it: feed the
 * renderer `orientCell(worldCol,worldRow,…,o)` and the whole map appears rotated by `o` quarter-turns.
 *
 * ─── The convention (why CW, why these formulas) ──────────────────────────────────────────────────────
 * `Orientation` counts quarter-turns CLOCKWISE, matching the map's on-screen appearance: at o=0 you see the
 * default view; each +1 rotates the rendered map CW by 90°. We reuse the EXACT clockwise quarter-turn that
 * buildingCatalog.rotateFootprintOffset already uses so camera rotation and building/tile facing compose
 * without a sign clash: a coord (col,row) in a `w×h` grid turns CW to (h−1−row, col) in the swapped `h×w`
 * grid — identical to that module's `rotateOffsetCW((dx,dy),w,h) = (h−1−dy, dx)`.
 *
 * Screen sanity-check for "CW": rotating an image CW sends TL→TR→BR→BL→TL. For a 5×3 grid, world TL (0,0)
 * lands at view (2,0) = the top-RIGHT of the swapped 3×5 view. That is a clockwise turn. ✓
 */

/** Camera corner / quarter-turns CW. 0 = the current default iso view. */
export type Orientation = 0 | 1 | 2 | 3

/** One 90° CLOCKWISE turn of a grid coord: (col,row) in a `w×h` grid → the coord in the swapped `h×w` grid.
 *  This is the single geometric primitive both orient and deorient are built from, so the inverse is
 *  provably exact (four turns = identity). Mirrors buildingCatalog.rotateOffsetCW so facing composes. */
function quarterTurnCW(col: number, row: number, w: number, h: number): { col: number; row: number; w: number; h: number } {
  return { col: h - 1 - row, row: col, w: h, h: w }
}

/** Apply `turns` (0–3) clockwise quarter-turns to a coord, threading the grid dims through each turn so an
 *  odd number of turns lands in the swapped-dims grid. `turns` is pre-normalised to 0–3 by the callers. */
function rotateGridCoord(col: number, row: number, w: number, h: number, turns: number): { col: number; row: number } {
  let cur = { col, row, w, h }
  for (let i = 0; i < turns; i++) cur = quarterTurnCW(cur.col, cur.row, cur.w, cur.h)
  return { col: cur.col, row: cur.row }
}

/** The grid dims as seen in the view frame — width/height swap for the odd (90°/270°) orientations. */
export function orientedDims(cols: number, rows: number, o: Orientation): { cols: number; rows: number } {
  return o % 2 === 0 ? { cols, rows } : { cols: rows, rows: cols }
}

/** Rotate a WORLD grid coord into the VIEW frame: the coord to feed the fixed iso projection so the whole
 *  map appears rotated by `o` quarter-turns CW about the grid centre. Result is in-bounds of
 *  `orientedDims(cols,rows,o)`. */
export function orientCell(col: number, row: number, cols: number, rows: number, o: Orientation): { col: number; row: number } {
  return rotateGridCoord(col, row, cols, rows, o)
}

/** The EXACT inverse of `orientCell` (VIEW → WORLD): map a screen-resolved view cell back to the real grid
 *  cell, so a pick keeps working under rotation. Undoing `o` CW turns is `4−o` more CW turns (they sum to a
 *  full identity revolution); we start from the VIEW dims so the turns thread back to the world dims. */
export function deorientCell(col: number, row: number, cols: number, rows: number, o: Orientation): { col: number; row: number } {
  const view = orientedDims(cols, rows, o)
  return rotateGridCoord(col, row, view.cols, view.rows, (4 - o) % 4)
}

/** Back-to-front draw key in the VIEW frame — a HIGHER key draws later / in front, so occlusion stays
 *  correct when the camera is rotated. Derived from the ORIENTED coord's (col + row), exactly the depth key
 *  iso.ts's painter sort uses on the coords it projects (isoDepthCompare: `o.col + o.row`). */
export function orientedDrawKey(col: number, row: number, cols: number, rows: number, o: Orientation): number {
  const v = orientCell(col, row, cols, rows, o)
  return v.col + v.row
}

/** Normalise any integer to an Orientation (0–3), wrapping negatives. */
function wrapOrientation(n: number): Orientation {
  return (((n % 4) + 4) % 4) as Orientation
}

/** The on-screen facing to render for a tile whose FIXED world-facing is `tileFacing` (0–3, the direction it
 *  points in the world, in buildingCatalog.FACING_ROTATION's convention: south=0, west=1, north=2, east=3),
 *  given the current `camera` orientation.
 *
 *  Relationship: ADD, mod 4 — `(tileFacing + camera) % 4`. The world-facing NEVER changes as the camera
 *  turns (a door points the same world direction always); rotating the camera changes only which screen-side
 *  you view it from. WHY add: `orientCell` carries the world CW by `camera` quarter-turns into the view
 *  frame, so a fixed direction is carried CW by the same amount, and a +1 CW turn is +1 in the facing index
 *  (south→west→north→east). Hence a full 4-turn cycle returns the on-screen facing to its start. */
export function combineFacing(tileFacing: Orientation, camera: Orientation): Orientation {
  return wrapOrientation(tileFacing + camera)
}

/** Cycle the orientation one step, wrapping 0..3. `dir` = +1 (turn CW) or −1 (turn CCW). */
export function nextOrientation(o: Orientation, dir: 1 | -1): Orientation {
  return wrapOrientation(o + dir)
}
