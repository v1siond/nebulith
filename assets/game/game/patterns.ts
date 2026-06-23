/**
 * MOVEMENT + ATTACK PATTERN builders for the editor's entity inspector.
 *
 * PURE + immutable — every function returns a NEW pattern, inputs untouched. The
 * editor authors patrols (waypoints + sequential/random traversal) and enemy
 * retaliation (melee/ranged + cooldown) through these so the UI stays data-only
 * and the rules are unit-testable.
 */
import type { Cell, MovementMode, MovementPattern, AttackMode, AttackPattern } from './types'

/** Smallest sane retaliation cooldown (ms) — keeps the editor off 0/negative. */
export const MIN_ATTACK_COOLDOWN_MS = 200

// ── movement patterns ───────────────────────────────────────────────

/** A square patrol loop of side `radius` around (col,row). stepMover skips any
 *  waypoint that's blocked/off-map, so the box is safe near edges. */
export function buildBoxPatrol(
  col: number,
  row: number,
  mode: MovementMode = 'sequential',
  radius = 2,
): MovementPattern {
  return {
    mode,
    waypoints: [
      { col, row },
      { col: col + radius, row },
      { col: col + radius, row: row + radius },
      { col, row: row + radius },
    ],
  }
}

/** Append a waypoint, returning a NEW pattern (creates one if none). An immediate
 *  repeat of the last waypoint is ignored so a double-click doesn't stack dupes. */
export function appendWaypoint(
  pattern: MovementPattern | undefined,
  cell: Cell,
  mode: MovementMode = 'sequential',
): MovementPattern {
  const base: MovementPattern = pattern ?? { mode, waypoints: [] }
  const last = base.waypoints[base.waypoints.length - 1]
  if (last && last.col === cell.col && last.row === cell.row) return base
  return { ...base, waypoints: [...base.waypoints, { col: cell.col, row: cell.row }] }
}

/** Switch a pattern's traversal mode (sequential ↔ random), keeping its waypoints. */
export function setMovementMode(
  pattern: MovementPattern | undefined,
  mode: MovementMode,
): MovementPattern {
  return { mode, waypoints: pattern?.waypoints ?? [] }
}

/** Drop all waypoints, keeping the mode (start re-authoring a path from scratch). */
export function clearWaypoints(
  pattern: MovementPattern | undefined,
  mode: MovementMode = 'sequential',
): MovementPattern {
  return { mode: pattern?.mode ?? mode, waypoints: [] }
}

// ── attack patterns ─────────────────────────────────────────────────

/** Build an attack pattern, clamping the cooldown to a sane floor and whole ms. */
export function makeAttackPattern(mode: AttackMode, cooldownMs: number): AttackPattern {
  return { mode, cooldownMs: Math.max(MIN_ATTACK_COOLDOWN_MS, Math.round(cooldownMs)) }
}

/** A sensible default retaliation pattern (ranged enemies swing slower). */
export function defaultAttackPattern(mode: AttackMode = 'melee'): AttackPattern {
  return makeAttackPattern(mode, mode === 'ranged' ? 1500 : 900)
}
