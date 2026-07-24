/**
 * UNIT CAPABILITIES — a unit's abilities are DATA (settings), not its kind.
 *
 * "all units are the same, the only difference between the player and the rest is that player is controlled
 *  by user … an enemy is just a tile, a unit, that can be attacked and is hostile to the player. hostile,
 *  can be attacked, etc are just settings" (Alexander).
 *
 * Each capability reads its OWN boolean setting on the entity and falls back to a kind-derived DEFAULT, so
 * existing saves are unchanged (an enemy defaults attackable + hostile) while ANY unit can opt in or out via
 * the setting — there is no per-kind capability branch in the combat/targeting code. The `kind` stays as a
 * label/preset (it seeds the default); it no longer GATES what a unit can do.
 */
import type { Entity } from '@/game/types'

/** Can this unit be attacked — targeted by the player and take damage? Setting: `hittable`.
 *  Default by kind: enemies yes, everyone else no. */
export function isAttackable(entity: Entity): boolean {
  return entity.hittable ?? entity.kind === 'enemy'
}

/** Is this unit hostile — does it attack the player (retaliate)? Setting: `hostile`.
 *  Default by kind: enemies yes, everyone else no. Independent of {@link isAttackable}, so a unit can be
 *  attackable-but-peaceful (`hittable: true, hostile: false`) or a hostile-but-untargetable hazard. */
export function isHostile(entity: Entity): boolean {
  return entity.hostile ?? entity.kind === 'enemy'
}
