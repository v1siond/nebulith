/**
 * UNIT-DATA PERSISTENCE — fold each unit's LOADOUT (+ the hero's INVENTORY) onto the entities at save,
 * split them back out on load.
 *
 * "everything is data ... what a unit HAS is data" (Alexander): a unit's gear rides ON the unit, so it
 * persists through the SAME `entities` channel every entity already round-trips (templates.tsx →
 * template.entities jsonb → nebulith Postgres over HTTP). No parallel per-unit-type table — units are the
 * same, so their inventory is just data on the unit. These two pure functions are the boundary codec ONLY:
 * the running editor keeps its `loadouts` map + hero `inventory` state; fold marries them to the entities
 * at the save edge and split reads them back at the load edge — exactly as entities/quests already ride
 * assetsData (lib/gridCodec.ts).
 *
 * Round-trip guarantee (tested in __tests__/game/unitDataPersistence.test.ts): for any entity list,
 * `split(fold(entities, loadouts, inventory))` reproduces `loadouts` + `playerInventory` EXACTLY —
 * including bag/special ORDER and empty gaps — for the player and any npc/enemy alike.
 */
import type { Entity, Inventory, Loadout } from '@/game/types'

/** The editor keys the PLAYER's loadout under this sentinel (not the player entity's id): the player entity
 *  and the '__player__' loadout are the same character, so the equipment panel + play loop resolve the hero
 *  to this key (templates.tsx). Every other unit keys on its own entity id. */
export const PLAYER_LOADOUT_KEY = '__player__'

/** The loadout-map key for an entity: the player sentinel for the hero, else the entity's own id. */
export function loadoutKeyFor(entity: Entity): string {
  return entity.kind === 'player' ? PLAYER_LOADOUT_KEY : entity.id
}

/**
 * Attach each unit's loadout (+ the hero's inventory) onto the entities so they persist with the unit.
 * Pure: returns a NEW entity per unit that has data to carry; inputs are untouched. A unit with no loadout
 * in the map (and no inventory) is passed through unchanged — no empty blob is written, keeping saves lean.
 */
export function foldUnitData(
  entities: readonly Entity[],
  loadouts: Readonly<Record<string, Loadout>>,
  playerInventory: Inventory | null,
): Entity[] {
  return entities.map((entity) => {
    const loadout = loadouts[loadoutKeyFor(entity)]
    const inventory = entity.kind === 'player' ? playerInventory : null
    if (!loadout && !inventory) return entity
    const next: Entity = { ...entity }
    if (loadout) next.loadout = loadout
    if (inventory) next.inventory = inventory
    return next
  })
}

export interface SplitUnitData {
  /** per-unit loadouts, keyed exactly as the editor keys them (player → {@link PLAYER_LOADOUT_KEY}). */
  loadouts: Record<string, Loadout>
  /** the hero's restored inventory, or null when the save carried none. */
  playerInventory: Inventory | null
}

/**
 * Pull each unit's persisted loadout (+ the hero's inventory) back into the editor's maps. Pure — reads
 * only the entities' own `loadout`/`inventory` DATA. The inventory is player-only by construction (fold
 * only writes it on the hero), so a stray `inventory` on a non-player is ignored.
 */
export function splitUnitData(entities: readonly Entity[]): SplitUnitData {
  const loadouts: Record<string, Loadout> = {}
  let playerInventory: Inventory | null = null
  for (const entity of entities) {
    if (entity.loadout) loadouts[loadoutKeyFor(entity)] = entity.loadout
    if (entity.kind === 'player' && entity.inventory) playerInventory = entity.inventory
  }
  return { loadouts, playerInventory }
}
