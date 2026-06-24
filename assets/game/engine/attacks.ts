/**
 * A reusable ATTACK system. Attacks are NOT player- or enemy-specific — ANY entity
 * (player, monster, turret, trap…) owns a list of attacks, and the SAME pure logic
 * decides which one fires, enforces per-attack cooldowns, and advances COMBO chains.
 *
 * Separation of concerns (so this stays reusable + testable):
 *   - this module owns ELIGIBILITY + TIMING + CHAINING (deterministic, pure)
 *   - the caller (the combat loop) owns DAMAGE resolution and SPAWNING the animation
 *
 * An attack references an animation by `animKind`, so the attack system and the
 * animation system compose: firing an attack = the trigger that plays its animation.
 */
import type { Cell } from '@/game/types'

export type AttackRange = 'melee' | 'ranged'

/** One reusable attack definition. Entities hold a list of these; `chainTo` links a combo
 *  step that becomes available for a short window right after this attack fires. */
export interface AttackDef {
  id: string
  range: AttackRange
  /** max cell distance (chebyshev) the attack can reach. */
  reach: number
  cooldownMs: number
  /** base damage contribution — the caller folds this into its damage resolution. */
  power: number
  /** which animation this attack plays (e.g. 'slash', 'shot', 'lightning'). */
  animKind: string
  /** the next attack id in a combo; available for COMBO_WINDOW_MS after this one fires. */
  chainTo?: string
}

/** Per-attacker timing/combo state — one per entity, carried across ticks. */
export interface AttackerState {
  /** attackId → last-fired timestamp (ms), for cooldown. */
  lastFiredAt: Record<string, number>
  /** an open combo step (its id + the deadline to use it). */
  combo?: { next: string; until: number }
}

export const initAttacker = (): AttackerState => ({ lastFiredAt: {} })

/** How long a chained combo step stays available after the previous attack fires. */
export const COMBO_WINDOW_MS = 800

/** Chebyshev cell distance (8-neighbour reach). */
export const cellDistance = (a: Cell, b: Cell): number =>
  Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row))

/** Off cooldown? The first use of an attack is always allowed. Pure. */
export function offCooldown(def: AttackDef, state: AttackerState, now: number): boolean {
  const last = state.lastFiredAt[def.id]
  return last === undefined || now - last >= def.cooldownMs
}

/** Is the target within this attack's reach from `from`? Pure. */
export const inReach = (def: AttackDef, from: Cell, target: Cell): boolean =>
  cellDistance(from, target) <= def.reach

/**
 * Choose the attack to fire this tick: the open COMBO step takes precedence (if it's
 * ready + in reach), otherwise the first listed attack that is off-cooldown AND in reach.
 * Returns null when nothing can fire. Pure — same inputs, same choice.
 */
export function chooseAttack(
  attacks: readonly AttackDef[],
  state: AttackerState,
  from: Cell,
  target: Cell,
  now: number,
): AttackDef | null {
  if (state.combo && now <= state.combo.until) {
    const next = attacks.find(a => a.id === state.combo!.next)
    if (next && offCooldown(next, state, now) && inReach(next, from, target)) return next
  }
  return attacks.find(a => offCooldown(a, state, now) && inReach(a, from, target)) ?? null
}

/**
 * Stamp an attack as fired: record its cooldown and open its chain window (if it chains).
 * Pure → returns a NEW state (no mutation). The caller resolves damage + spawns the
 * `def.animKind` animation.
 */
export function fire(def: AttackDef, state: AttackerState, now: number): AttackerState {
  return {
    lastFiredAt: { ...state.lastFiredAt, [def.id]: now },
    combo: def.chainTo ? { next: def.chainTo, until: now + COMBO_WINDOW_MS } : undefined,
  }
}
