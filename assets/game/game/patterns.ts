/**
 * MOVEMENT + ATTACK PATTERN builders for the editor's entity inspector.
 *
 * PURE + immutable — every function returns a NEW pattern, inputs untouched. The
 * editor authors patrols (waypoints + sequential/random traversal) and enemy
 * retaliation (melee/ranged + cooldown) through these so the UI stays data-only
 * and the rules are unit-testable.
 */
import type {
  Cell, MovementMode, MovementPattern, MovementStep, Direction,
  AttackMode, AttackPattern, AttackPatternMode, EnemyAttack,
} from './types'
import type { AbilityAnimation, AbilityDef } from './abilities'

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

// ── enemy attack patterns (MANY attacks, sequential / random) ───────
// Mirrors the movement model: an ordered LIST of attacks + a traversal mode. Each attack is
// the enemy-side mirror of a player ability/attack (melee/ranged + damage + cooldown + tint).
// PURE + immutable — the editor authors through these; the combat tick selects through them.

/** Engine default attack — a flat strength-only melee on the legacy cooldown. Used when an
 *  enemy has NO authored pattern, so nothing regresses. */
export const DEFAULT_ENEMY_ATTACK: EnemyAttack = {
  mode: 'melee',
  damage: 0,
  cooldownMs: 900,
  animation: 'cleave',
  name: 'Strike',
}

/** The fallback one-attack pattern (matches today's single-melee retaliation). */
export const DEFAULT_ENEMY_ATTACK_PATTERN: AttackPattern = {
  mode: 'sequential',
  attacks: [DEFAULT_ENEMY_ATTACK],
}

/** Seeded animations that read as RANGED (the rest are melee swings). */
const RANGED_ANIMATIONS: ReadonlySet<AbilityAnimation> = new Set([
  'bolt', 'piercing-shot', 'nova', 'lightning',
])

/** Infer melee vs ranged from a seeded animation. */
export function animationRange(animation: AbilityAnimation): AttackMode {
  return RANGED_ANIMATIONS.has(animation) ? 'ranged' : 'melee'
}

/** A fresh copy of the engine default attack. */
export function defaultEnemyAttack(): EnemyAttack {
  return { ...DEFAULT_ENEMY_ATTACK }
}

/** Build one enemy attack, clamping damage (≥0) + cooldown (≥ floor) to whole numbers. */
export function makeEnemyAttack(
  mode: AttackMode,
  damage: number,
  cooldownMs: number,
  animation?: AbilityAnimation,
): EnemyAttack {
  return {
    mode,
    damage: Math.max(0, Math.round(damage)),
    cooldownMs: Math.max(MIN_ATTACK_COOLDOWN_MS, Math.round(cooldownMs)),
    ...(animation ? { animation } : {}),
  }
}

/** Build an enemy attack FROM a registry ability — reuses its damage, cooldown, animation/tint and
 *  infers melee vs ranged from the animation, so "add an attack from the registry" gives the enemy a
 *  real, player-grade attack. */
export function enemyAttackFromAbility(ability: AbilityDef): EnemyAttack {
  return {
    mode: animationRange(ability.animation),
    damage: Math.max(0, Math.round(ability.effect.damage ?? 0)),
    cooldownMs: Math.max(MIN_ATTACK_COOLDOWN_MS, Math.round(ability.cooldownMs)),
    animation: ability.animation,
    abilityId: ability.id,
    name: ability.name,
  }
}

/** A few ready-made enemy attacks for quick authoring — fast cooldowns (unlike the heavy player
 *  abilities), a mix of melee + ranged so an author can build a varied pattern in two clicks. */
export const ENEMY_ATTACK_PRESETS: readonly EnemyAttack[] = [
  { mode: 'melee', damage: 0, cooldownMs: 900, animation: 'cleave', name: 'Claw' },
  { mode: 'melee', damage: 10, cooldownMs: 1200, animation: 'fire-slash', name: 'Fire Bite' },
  { mode: 'ranged', damage: 6, cooldownMs: 1500, animation: 'bolt', name: 'Bolt', reachCells: 6 },
  { mode: 'ranged', damage: 14, cooldownMs: 2200, animation: 'piercing-shot', name: 'Pierce', reachCells: 8 },
]

/** Build an attack pattern (defaults to a single strength-only melee, sequential). */
export function buildAttackPattern(
  mode: AttackPatternMode = 'sequential',
  attacks: EnemyAttack[] = [defaultEnemyAttack()],
): AttackPattern {
  return { mode, attacks: attacks.map(a => ({ ...a })) }
}

/** Flip the traversal mode (sequential ↔ random), keeping the attack list. */
export function setAttackPatternMode(pattern: AttackPattern, mode: AttackPatternMode): AttackPattern {
  return { ...pattern, mode }
}

/** Append an attack (returns a NEW pattern). */
export function addEnemyAttack(pattern: AttackPattern, attack: EnemyAttack = defaultEnemyAttack()): AttackPattern {
  return { ...pattern, attacks: [...pattern.attacks, { ...attack }] }
}

/** Remove the attack at `index` (returns a NEW pattern; may leave it empty). */
export function removeEnemyAttack(pattern: AttackPattern, index: number): AttackPattern {
  return { ...pattern, attacks: pattern.attacks.filter((_, i) => i !== index) }
}

/** Patch the attack at `index` — change mode/damage/cooldown/animation (clamped). Immutable. */
export function updateEnemyAttack(pattern: AttackPattern, index: number, patch: Partial<EnemyAttack>): AttackPattern {
  const attacks = pattern.attacks.map((a, i) => {
    if (i !== index) return a
    const merged = { ...a, ...patch }
    return {
      ...merged,
      damage: Math.max(0, Math.round(merged.damage)),
      cooldownMs: Math.max(MIN_ATTACK_COOLDOWN_MS, Math.round(merged.cooldownMs)),
    }
  })
  return { ...pattern, attacks }
}

// ── normalization + the selector (the combat tick reads through these) ──

/** A pre-multi-attack save: the old single { mode:'melee'|'ranged', cooldownMs } shape. */
interface LegacyAttackPattern {
  mode: AttackMode
  cooldownMs?: number
}

/** Accept either the new multi-attack pattern OR a legacy single-attack save and return a canonical
 *  pattern with a non-empty attack list. Missing/empty → the engine default (one strength-only melee),
 *  so an enemy with no authored attacks behaves exactly as before. */
export function normalizeAttackPattern(
  raw: AttackPattern | LegacyAttackPattern | undefined,
): AttackPattern {
  if (!raw) return DEFAULT_ENEMY_ATTACK_PATTERN
  // New shape: a non-empty attacks list wins.
  if ('attacks' in raw && Array.isArray(raw.attacks) && raw.attacks.length > 0) {
    const mode: AttackPatternMode = raw.mode === 'random' ? 'random' : 'sequential'
    return { mode, attacks: raw.attacks }
  }
  // Legacy single-attack: { mode:'melee'|'ranged', cooldownMs }.
  if ('mode' in raw && (raw.mode === 'melee' || raw.mode === 'ranged')) {
    const legacy = raw as LegacyAttackPattern
    return {
      mode: 'sequential',
      attacks: [makeEnemyAttack(legacy.mode, 0, legacy.cooldownMs ?? DEFAULT_ENEMY_ATTACK.cooldownMs)],
    }
  }
  return DEFAULT_ENEMY_ATTACK_PATTERN
}

/** Selector state: the per-enemy fire count (drives sequential cycling) + an RNG (random mode). */
export interface EnemyAttackSelectState {
  /** how many times this enemy has already fired (sequential index source). */
  fireCount: number
  /** RNG for random mode (returns 0–1); defaults to Math.random. */
  rng?: () => number
}

/** Pick the NEXT attack an enemy fires from its pattern. sequential → cycles 0,1,…,n-1,0,…;
 *  random → an in-set pick via `rng`. Empty/missing pattern → the engine default attack. Pure. */
export function nextEnemyAttack(
  pattern: AttackPattern | LegacyAttackPattern | undefined,
  state: EnemyAttackSelectState,
): EnemyAttack {
  const { mode, attacks } = normalizeAttackPattern(pattern) // guarantees ≥1 attack
  if (mode === 'random') {
    const rng = state.rng ?? Math.random
    const i = Math.min(attacks.length - 1, Math.max(0, Math.floor(rng() * attacks.length)))
    return attacks[i]
  }
  const len = attacks.length
  return attacks[((state.fireCount % len) + len) % len]
}
