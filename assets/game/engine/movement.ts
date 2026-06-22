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
