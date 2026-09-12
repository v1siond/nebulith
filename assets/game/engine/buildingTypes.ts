/**
 * The building TYPE vocabulary — the small, dependency-free enum shared by generation, the editor
 * and the composition helpers. A building is NOT a procedural unit: a pre-built building is a backend
 * composition TEMPLATE (see game/runtime/buildingComposition.ts) stamped as per-cell tiles, the SAME
 * path trees use. This module is just the name set, kept separate so nothing has to import a heavy
 * generator to name a type.
 */
export type BuildingType =
  | 'house'
  | 'big-house'
  | 'store'
  | 'office'
  | 'hospital'
  | 'cathedral'
  | 'temple'
  | 'castle'
  // THE THINGS THAT MAKE A PLACE A PLACE. Alexander, 2026-09-11: *"having different types of settlements
  // implies having different objects, just like we added a bunch of new trees to be able to do the jungle and
  // other forests, we have to add new buildings with design matching the context of the settlement"*, with a
  // town of *"wood houses and elements, stables"* against a city of blocks and towers, and *"cities have more
  // skycrappers, towns have more houses"*. The backend composes each of these; a place picks which it wants.
  | 'stable'
  | 'barn'
  | 'smithy'
  | 'church'
  | 'manor'
  | 'apartment'
  | 'tower'

/**
 * HOW MANY OF A TYPE A PLACE ASKS FOR. Alexander, 2026-09-11: *"cities have more skycrappers, towns have more
 * houses"*, and *"having different types of settlements implies having different objects"*.
 *
 * A place's character is a LIST of these, served per place, so a traditional town asking for stables and a
 * modern city asking for towers is a data difference and not a branch in the planner. `count` is an inclusive
 * [min, max] that the generator rolls.
 */
export interface MixEntry {
  type: BuildingType
  count: readonly [number, number]
}
