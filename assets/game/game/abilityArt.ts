/**
 * An ability's ART — resolved from the backend, never declared here.
 *
 * Each `AbilityAnimation` is also a TILE label the backend serves (`fire-slash`, `nova`, `lightning`, …),
 * and that tile row already carries the animation's colour in its own settings. The frontend used to keep a
 * parallel `ABILITY_TINT` table of the same nine hexes; this reads the served value instead, so re-seeding a
 * tile a different colour moves the UI with it (§3.14b #2).
 *
 * Kept out of `game/abilities.ts` so that stays what its docblock claims — pure ability DATA with no lookups
 * into loaded tilesets.
 */
import { styleCatalog } from '@/engine/tileset/styleTiles'
import type { AbilityAnimation } from './abilities'
import { tileColorByLabel } from '@/engine/tileset/tileset'

/**
 * The colour of an ability's animation, from its tile. `undefined` when the tileset has no such tile — the
 * caller decides what a missing tile looks like; this never invents one.
 *
 * Style-independent by data: the ascii and emoji rows carry the identical hex, and the ascii row repeats it
 * across every zone (verified against the live API), so either tileset answers the same. ASCII is asked
 * because it is the tileset that is always loaded.
 */
export function abilityTint(animation: AbilityAnimation): string | undefined {
  return tileColorByLabel(styleCatalog('ascii'), animation)
}
