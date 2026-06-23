/**
 * Entity movement patterns — a pure, deterministic stepper for patrolling enemies.
 *
 * An entity follows a MovementPattern (an ordered list of waypoint cells) one cell
 * per tick. `sequential` walks the waypoints in order and loops; `random` picks the
 * next waypoint via an injected chooser on arrival (so it stays unit-testable — no
 * internal RNG). Movement never walks through a blocked cell: if the next step is
 * blocked the entity waits that tick.
 *
 * Pure: positions/state in → new positions/state out. The play loop owns the clock
 * and the per-entity cursor map.
 */

import type { Cell, MovementPattern } from '@/game/types'
export type { Cell, MovementMode, MovementPattern } from '@/game/types'

/** Per-entity cursor: which waypoint we're heading to, and the loop direction. */
export interface MoverState {
  target: number
  dir: number
}

export const initMover = (): MoverState => ({ target: 1, dir: 1 })

/** Pick the next waypoint index for a `random` pattern, default-excluding the
 *  current one so it actually moves on. Injected so tests stay deterministic. */
export type RandomChooser = (count: number, current: number) => number

const sign = (n: number): number => (n > 0 ? 1 : n < 0 ? -1 : 0)

/** One 4-neighbour step from `pos` toward `target` (longer axis first), or `pos`
 *  itself if it would enter a blocked cell or is already there. */
function stepToward(pos: Cell, target: Cell, isBlocked: (col: number, row: number) => boolean): Cell {
  const dc = target.col - pos.col
  const dr = target.row - pos.row
  if (dc === 0 && dr === 0) return pos
  const next = Math.abs(dc) >= Math.abs(dr)
    ? { col: pos.col + sign(dc), row: pos.row }
    : { col: pos.col, row: pos.row + sign(dr) }
  return isBlocked(next.col, next.row) ? pos : next
}

/** Advance the cursor to the next waypoint once the current one is reached. */
function advanceCursor(pattern: MovementPattern, state: MoverState, chooseRandom?: RandomChooser): MoverState {
  const n = pattern.waypoints.length
  if (pattern.mode === 'random') {
    const pick = chooseRandom ?? ((count, current) => (current + 1) % count)
    return { target: pick(n, state.target), dir: state.dir }
  }
  return { target: (state.target + 1) % n, dir: state.dir } // sequential loop
}

/**
 * Step an entity one cell along its pattern. Returns the new position + cursor.
 * No-op for patterns with fewer than 2 waypoints (nothing to patrol between).
 */
export function stepMover(
  pos: Cell,
  pattern: MovementPattern,
  state: MoverState,
  isBlocked: (col: number, row: number) => boolean,
  chooseRandom?: RandomChooser,
): { pos: Cell; state: MoverState } {
  const n = pattern.waypoints.length
  if (n < 2) return { pos, state }

  const target = pattern.waypoints[state.target % n]
  // Already standing on the target waypoint → pick the next, then step toward it.
  if (pos.col === target.col && pos.row === target.row) {
    const advanced = advanceCursor(pattern, state, chooseRandom)
    const nextTarget = pattern.waypoints[advanced.target % n]
    return { pos: stepToward(pos, nextTarget, isBlocked), state: advanced }
  }
  return { pos: stepToward(pos, target, isBlocked), state }
}

// ── run-patrol: move a run of cells, pause, then turn (erratic patrol) ──────────
export const RUN_PATROL_LENGTH = 4
export const RUN_PATROL_DELAY_MS = 600

/** Per-entity run-patrol cursor: current direction, cells left in the run, ticks
 *  left to pause, and the last horizontal/vertical dirs (for reverse / go-back). */
export interface RunState {
  dc: number
  dr: number
  stepsLeft: number
  waitLeft: number
  lastDc: number
  lastDr: number
}

/** Injectable RNG (→ [0,1)) so `mixed` patrols stay unit-testable. */
export type Rng = () => number

const runLen = (p: MovementPattern): number => Math.max(1, p.runLength ?? RUN_PATROL_LENGTH)

/** Initial run cursor. Horizontal/mixed start moving right; vertical starts down. */
export function initRunState(pattern: MovementPattern): RunState {
  const vertical = pattern.axis === 'vertical'
  const dc = vertical ? 0 : 1
  const dr = vertical ? 1 : 0
  return { dc, dr, stepsLeft: runLen(pattern), waitLeft: 0, lastDc: dc || 1, lastDr: dr || 1 }
}

/** Pick the next run direction once a run + its pause complete. */
function chooseNextDir(pattern: MovementPattern, s: RunState, rng: Rng): Pick<RunState, 'dc' | 'dr' | 'lastDc' | 'lastDr'> {
  const axis = pattern.axis ?? 'mixed'
  if (axis === 'vertical') {
    const dr = -(s.lastDr || 1) // reverse: out and back
    return { dc: 0, dr, lastDc: s.lastDc, lastDr: dr }
  }
  if (axis === 'horizontal') {
    const dc = -(s.lastDc || 1)
    return { dc, dr: 0, lastDc: dc, lastDr: s.lastDr }
  }
  // mixed: pick an axis — vertical → randomize up/down; horizontal → go back (reverse)
  if (rng() < 0.5) {
    const dr = rng() < 0.5 ? -1 : 1
    return { dc: 0, dr, lastDc: s.lastDc, lastDr: dr }
  }
  const dc = -(s.lastDc || 1)
  return { dc, dr: 0, lastDc: dc, lastDr: s.lastDr }
}

/**
 * Step an entity along a RUN-PATROL: move `runLength` cells in the current direction,
 * pause `delayTicks`, then turn (per `axis`). A blocked cell ends the current run
 * early (then it pauses + turns). Pure + deterministic (RNG injected for `mixed`).
 */
export function stepRunPatrol(
  pos: Cell,
  pattern: MovementPattern,
  state: RunState,
  isBlocked: (col: number, row: number) => boolean,
  opts?: { rng?: Rng; delayTicks?: number },
): { pos: Cell; state: RunState } {
  const rng = opts?.rng ?? Math.random
  const delayTicks = Math.max(0, opts?.delayTicks ?? 6)
  let s = state

  // pausing between runs
  if (s.waitLeft > 0) {
    const waitLeft = s.waitLeft - 1
    if (waitLeft > 0) return { pos, state: { ...s, waitLeft } }
    s = { ...s, ...chooseNextDir(pattern, s, rng), stepsLeft: runLen(pattern), waitLeft: 0 }
    // fall through and take the first step of the new run
  }

  // moving along the run
  const next = { col: pos.col + s.dc, row: pos.row + s.dr }
  if (isBlocked(next.col, next.row)) {
    return { pos, state: { ...s, stepsLeft: 0, waitLeft: delayTicks } } // wall → pause, then turn
  }
  const stepsLeft = s.stepsLeft - 1
  return {
    pos: next,
    state: {
      ...s,
      stepsLeft: Math.max(0, stepsLeft),
      waitLeft: stepsLeft <= 0 ? delayTicks : 0,
      lastDc: s.dc !== 0 ? s.dc : s.lastDc,
      lastDr: s.dr !== 0 ? s.dr : s.lastDr,
    },
  }
}
