/**
 * WEAPON CLASS HELPERS — pure, deterministic. The unified combat model gives every
 * weapon a numeric cell reach:
 *   - melee: 1 (one-handed) / 2 (two-handed)
 *   - ranged: the authored `reachCells`, clamped to [6, 12]
 * `range: 'ranged'` is the projectile classifier (ranged weapons travel a projectile;
 * melee weapons strike instantly within reach).
 */
import type { Weapon } from './types'

/** Min/max cell reach a ranged weapon can be authored to. */
export const RANGED_MIN_REACH = 6 as const
export const RANGED_MAX_REACH = 12 as const

/** A weapon fires a travelling projectile (vs an instant melee strike). */
export function isRanged(w: Weapon): boolean {
  return w.range === 'ranged'
}

/** Cell reach for this weapon: ranged clamps to [6,12]; melee → 2H reaches 2, else 1. */
export function weaponReach(w: Weapon): number {
  if (isRanged(w)) return Math.min(RANGED_MAX_REACH, Math.max(RANGED_MIN_REACH, w.reachCells ?? RANGED_MIN_REACH))
  return w.hands === 2 ? 2 : 1
}
