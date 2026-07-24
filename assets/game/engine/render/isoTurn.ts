/**
 * isoTurn — the PURE maths for a CONTINUOUS iso camera turn: the world spins while you drag and eases into
 * the nearest of the 4 corners when you let go. No React, no canvas, no timers; every function is pure.
 *
 * Alexander: "when rotating i want to see the animation of the world rotating, in fact, Ideally, I should have
 * a controller that allows me to rotate more accurately, with the current 4 options as the quick turnarounds."
 *
 * ─── The model ────────────────────────────────────────────────────────────────────────────────────────────
 * A TURN is measured in QUARTER-TURNS on a 0..4 circle. A WHOLE turn IS an `Orientation` — the four corners
 * the 4-way camera already ships — and every function here DELEGATES to `isoOrientation` at a whole turn, so a
 * settled camera runs today's exact integer maths and today's exact frame. Only the transient between corners
 * is new.
 *
 * ─── Why rotating the GRID coord is a real turntable ──────────────────────────────────────────────────────
 * The iso renderer projects a ground coord with x ∝ (col − row) and y ∝ (col + row) — a fixed linear map that
 * carries the 2:1 iso squash. The ground plane IS the (col,row) plane and height is a separate vertical
 * offset, so rotating (col,row) about the grid centre and leaving the height alone is exactly a turntable spin
 * about the vertical axis, seen through the unchanged iso projection. At turn 1 the continuous rotation
 * `(cu,cv) → (−cv, cu)` is precisely `isoOrientation`'s clockwise quarter-turn, so the two agree at every corner.
 *
 * ─── The one quantisation ─────────────────────────────────────────────────────────────────────────────────
 * Between corners the VIEW DIMS (which swap on an odd corner) follow the NEAREST corner. That term is a
 * re-centring constant: the renderer projects a cell's offset FROM THE CAMERA FOCUS and both go through this
 * module, so the constant cancels and the pixels stay smooth across the 45° crossover. It only shows where a
 * consumer uses the dims on their own — the camera CLAMP (game mode; the editor pans unclamped).
 */
import { orientCell, deorientCell, orientedDims, type Orientation } from './isoOrientation'

/** Quarter-turns of the camera about the map's vertical axis, CW, on a 0..4 circle. A WHOLE value is one of
 *  the four `Orientation` corners; anything between is a transient the drag/settle animation passes through. */
export type CameraTurn = number

/** Progress → eased progress, both 0..1. Injectable so a button spin can use its own curve (OCP). */
export type TurnEasing = (progress: number) => number

const QUARTER_TURN_RAD = Math.PI / 2

/** Normalise any turn onto the 0..4 circle. A turn already in range is returned UNTOUCHED — no modulo, so no
 *  float drift can creep into a value the projection is about to use. */
export function wrapTurn(turn: CameraTurn): CameraTurn {
  if (turn > 0 && turn < 4) return turn
  const t = turn % 4
  // `+ 0` normalises −0 to 0, so a wrapped resting turn compares `=== 0` (and Object.is-equal in tests).
  return t < 0 ? t + 4 : t + 0
}

/** Is the camera SETTLED on a corner? A whole turn takes every today-path in this module. */
export function isWholeTurn(turn: CameraTurn): boolean {
  return Number.isInteger(turn)
}

/** The corner a turn is NEAREST — the camera's facing for every decision that has no continuous form (the
 *  span axes, the clamp dims), and what a settled camera reports. Wraps past the last corner (3.7 → 0). */
export function facingForTurn(turn: CameraTurn): Orientation {
  return (Math.round(wrapTurn(turn)) % 4) as Orientation
}

/** The grid dims as the view frame sees them mid-turn — the NEAREST corner's dims (see the header: this is a
 *  re-centring constant that cancels against the focus). */
export function orientedDimsForTurn(cols: number, rows: number, turn: CameraTurn): { cols: number; rows: number } {
  return orientedDims(cols, rows, facingForTurn(turn))
}

/** A WORLD → VIEW cell mapper for ONE frame at `turn`: the trig is resolved once here, not per tile.
 *  At a WHOLE turn it IS `orientCell` — same integer maths, same result, no float path. */
export function cellOrienterFor(cols: number, rows: number, turn: CameraTurn): (col: number, row: number) => { col: number; row: number } {
  const t = wrapTurn(turn)
  if (isWholeTurn(t)) return (col, row) => orientCell(col, row, cols, rows, t as Orientation)

  const cos = Math.cos(t * QUARTER_TURN_RAD), sin = Math.sin(t * QUARTER_TURN_RAD)
  const worldMidCol = (cols - 1) / 2, worldMidRow = (rows - 1) / 2
  const view = orientedDimsForTurn(cols, rows, t)
  const viewMidCol = (view.cols - 1) / 2, viewMidRow = (view.rows - 1) / 2
  return (col, row) => {
    // Standard 2D rotation of the coord ABOUT THE GRID CENTRE by θ = t·(π/2), then re-centre into the view
    // frame (whose dims may be swapped): offset to (cu,cv) → rotate → add the view mid-point back. The signs
    // are the CW matrix [[cos,−sin],[sin,cos]]; at t=1 (cos 0, sin 1) it collapses to (cu,cv)→(−cv,cu), which
    // is exactly isoOrientation's integer quarterTurnCW — so the continuous path meets the corner path here.
    const cu = col - worldMidCol, cv = row - worldMidRow
    return { col: cu * cos - cv * sin + viewMidCol, row: cu * sin + cv * cos + viewMidRow }
  }
}

/** One WORLD coord → the VIEW frame at a continuous `turn`. The single-shot form of `cellOrienterFor` (a
 *  per-frame caller should build the orienter once instead). */
export function orientCellTurn(col: number, row: number, cols: number, rows: number, turn: CameraTurn): { col: number; row: number } {
  return cellOrienterFor(cols, rows, turn)(col, row)
}

/** VIEW → WORLD, the inverse of `orientCellTurn` (what a pick needs). At a WHOLE turn it IS `deorientCell` —
 *  integer in, integer out. Mid-turn it returns a FRACTIONAL world coord: the caller floors it to a cell. */
export function deorientCellTurn(col: number, row: number, cols: number, rows: number, turn: CameraTurn): { col: number; row: number } {
  const t = wrapTurn(turn)
  if (isWholeTurn(t)) return deorientCell(col, row, cols, rows, t as Orientation)

  const cos = Math.cos(t * QUARTER_TURN_RAD), sin = Math.sin(t * QUARTER_TURN_RAD)
  const view = orientedDimsForTurn(cols, rows, t)
  // The exact inverse of the forward mapper: rotate the VIEW offset by −θ (the transpose of the CW matrix,
  // so the +sin/−sin swap versus cellOrienterFor) about the VIEW centre, then re-centre into WORLD dims.
  const vu = col - (view.cols - 1) / 2, vv = row - (view.rows - 1) / 2
  return { col: vu * cos + vv * sin + (cols - 1) / 2, row: -vu * sin + vv * cos + (rows - 1) / 2 }
}

/** Where a RELEASED drag should come to rest: the NEAREST corner, expressed in the SAME unwrapped frame the
 *  camera is spinning in — 3.7 settles onto 4 (which rests at 0), so the animation keeps turning forward
 *  instead of rewinding three quarter-turns backwards. */
export function settleTarget(turn: CameraTurn): CameraTurn {
  return Math.round(turn)
}

/** "Spin N quarter-turns from here" — what the 4 quick-turn buttons animate to. Counted from the corner the
 *  camera is settling on, so a button pressed MID-SPIN still lands square on a corner, never on an angle. */
export function spinTarget(from: CameraTurn, quarters: number): CameraTurn {
  return settleTarget(from) + quarters
}

/** Decelerating ease (cubic) — fast off the mark, gentle into the corner, which is what a released spin
 *  should feel like. Clamps, so a caller can hand it raw elapsed/duration. */
export function easeOutCubic(progress: number): number {
  if (progress <= 0) return 0
  if (progress >= 1) return 1
  const remaining = 1 - progress
  return 1 - remaining * remaining * remaining
}

/** The turn to render at `progress` (0..1) of an animation from `from` to `to`. At progress 1 it lands on the
 *  WRAPPED target EXACTLY — an exact whole turn is what restores today's bit-identical corner frame, so this
 *  must never leave a float residue behind. Timers/RAF live in the caller; this stays pure. */
export function turnAt(from: CameraTurn, to: CameraTurn, progress: number, ease: TurnEasing = easeOutCubic): CameraTurn {
  if (progress <= 0) return from
  if (progress >= 1) return wrapTurn(to)
  return from + (to - from) * ease(progress)
}
