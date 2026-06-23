/**
 * MOVEMENT + ATTACK PATTERN builders for the editor's entity inspector.
 *
 * PURE + immutable — every function returns a NEW pattern, inputs untouched. The
 * editor authors patrols (waypoints + sequential/random traversal) and enemy
 * retaliation (melee/ranged + cooldown) through these so the UI stays data-only
 * and the rules are unit-testable.
 */
import type { Cell, MovementMode, MovementPattern, MovementStep, Direction, AttackMode, AttackPattern } from './types'

/** Smallest sane retaliation cooldown (ms) — keeps the editor off 0/negative. */
export const MIN_ATTACK_COOLDOWN_MS = 200
/** Default pause (ms) between movement steps. */
export const DEFAULT_STEP_DELAY_MS = 1200

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

/** Switch a pattern's traversal mode (sequential ↔ random), keeping everything else
 *  (steps, waypoints, delay) intact. */
export function setMovementMode(
  pattern: MovementPattern | undefined,
  mode: MovementMode,
): MovementPattern {
  return { ...(pattern ?? { waypoints: [] }), mode }
}

// ── step list ("advance N cells in a direction" × list) ─────────────

/** The default erratic step list: a 5-cell run in each direction. */
export const DEFAULT_STEP_LIST: MovementStep[] = [
  { dir: 'right', cells: 5 },
  { dir: 'left', cells: 5 },
  { dir: 'up', cells: 5 },
  { dir: 'down', cells: 5 },
]

/** A fresh step-list pattern (seeded when you first enable movement on a still entity). */
export function buildStepList(mode: MovementMode = 'random', delayMs = DEFAULT_STEP_DELAY_MS): MovementPattern {
  return { mode, waypoints: [], steps: DEFAULT_STEP_LIST.map(s => ({ ...s })), delayMs }
}

/** Append a new step (returns a NEW pattern). */
export function addMovementStep(pattern: MovementPattern, step: MovementStep = { dir: 'right', cells: 3 }): MovementPattern {
  return { ...pattern, steps: [...(pattern.steps ?? []), { ...step }] }
}

/** Remove the step at `index` (returns a NEW pattern). */
export function removeMovementStep(pattern: MovementPattern, index: number): MovementPattern {
  return { ...pattern, steps: (pattern.steps ?? []).filter((_, i) => i !== index) }
}

/** Patch the step at `index` — change its direction or cell count (cells clamped ≥1). */
export function updateMovementStep(pattern: MovementPattern, index: number, patch: Partial<MovementStep>): MovementPattern {
  const steps = (pattern.steps ?? []).map((s, i) => {
    if (i !== index) return s
    const merged = { ...s, ...patch }
    return { dir: merged.dir as Direction, cells: Math.max(1, Math.round(merged.cells)) }
  })
  return { ...pattern, steps }
}

/** Set the between-step pause (ms), clamped to a whole non-negative number. */
export function setStepDelay(pattern: MovementPattern, delayMs: number): MovementPattern {
  return { ...pattern, delayMs: Math.max(0, Math.round(delayMs)) }
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
