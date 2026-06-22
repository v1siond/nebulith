/**
 * Nebulith — inventory system (pure, immutable).
 *
 * Spec: nebulith/docs/COMBAT-AND-SYSTEMS-SPEC.md §4 (equipment) & §7 (inventory).
 * Every function returns a NEW Inventory (or leaves the input untouched and returns
 * the same reference on a guarded no-op). Nothing here mutates its arguments — the
 * combat module consumes `equippedStatBonuses` to fold gear into the damage model.
 *
 * Style: guard clauses / early returns, small single-responsibility helpers, strict
 * types (no `any`). See game-website/docs/CODING-STANDARDS.md.
 */

import type {
  Armor,
  ConsumableEffect,
  Inventory,
  Item,
  ItemSlot,
  Weapon,
} from '@/game/types'

// ── discriminated-union narrowing helpers ───────────────────────────
type WeaponItem = Extract<Item, { slot: 'weapon' }>
type ArmorItem = Extract<Item, { slot: 'armor' }>
type ConsumableItem = Extract<Item, { slot: 'consumable' }>

const isWeaponItem = (item: Item): item is WeaponItem => item.slot === 'weapon'
const isArmorItem = (item: Item): item is ArmorItem => item.slot === 'armor'
const isConsumableItem = (item: Item): item is ConsumableItem =>
  item.slot === 'consumable'

/** Aggregate stat bonuses the combat module folds into the damage model. */
export interface StatBonuses {
  strength: number
  intelligence: number
  defense: number
}

// ── create / empty ──────────────────────────────────────────────────
/** A brand-new empty inventory (fresh array + slots each call). */
export function emptyInventory(): Inventory {
  return { items: [], equippedWeapon: null, equippedArmor: null }
}

/** Build an inventory from seeds, defensively copying the items array. */
export function createInventory(
  items: Item[] = [],
  equippedWeapon: Weapon | null = null,
  equippedArmor: Armor | null = null,
): Inventory {
  return { items: [...items], equippedWeapon, equippedArmor }
}

// ── query helpers ───────────────────────────────────────────────────
/** Find an item by id (undefined when absent). */
export function findItem(inv: Inventory, itemId: string): Item | undefined {
  return inv.items.find((item) => item.id === itemId)
}

/** All items in a given slot (weapon | armor | consumable). */
export function findItemsBySlot(inv: Inventory, slot: ItemSlot): Item[] {
  return inv.items.filter((item) => item.slot === slot)
}

// ── add / remove ────────────────────────────────────────────────────
/** Return a new inventory with `item` appended. */
export function addItem(inv: Inventory, item: Item): Inventory {
  return { ...inv, items: [...inv.items, item] }
}

/** Drop an item by id. Missing id is a guarded no-op (same reference back). */
export function removeItem(inv: Inventory, itemId: string): Inventory {
  if (!findItem(inv, itemId)) return inv
  return { ...inv, items: inv.items.filter((item) => item.id !== itemId) }
}

// ── equip / unequip ─────────────────────────────────────────────────
/**
 * Equip a weapon item: pull it from items into the weapon slot and push the
 * previously-equipped weapon back into items. Guards against missing ids and
 * non-weapon items (returns the input unchanged).
 */
export function equipWeapon(inv: Inventory, itemId: string): Inventory {
  const item = findItem(inv, itemId)
  if (!item || !isWeaponItem(item)) return inv

  const remaining = inv.items.filter((it) => it.id !== itemId)
  return {
    ...inv,
    items: [...remaining, ...weaponSlotToItems(inv.equippedWeapon)],
    equippedWeapon: item.weapon,
  }
}

/**
 * Equip an armor item: pull it from items into the armor slot and push the
 * previously-equipped armor back into items. Guards against missing ids and
 * non-armor items (returns the input unchanged).
 */
export function equipArmor(inv: Inventory, itemId: string): Inventory {
  const item = findItem(inv, itemId)
  if (!item || !isArmorItem(item)) return inv

  const remaining = inv.items.filter((it) => it.id !== itemId)
  return {
    ...inv,
    items: [...remaining, ...armorSlotToItems(inv.equippedArmor)],
    equippedArmor: item.armor,
  }
}

/** Move the equipped weapon back to items; no-op when nothing is equipped. */
export function unequipWeapon(inv: Inventory): Inventory {
  if (!inv.equippedWeapon) return inv
  return {
    ...inv,
    items: [...inv.items, ...weaponSlotToItems(inv.equippedWeapon)],
    equippedWeapon: null,
  }
}

/** Move the equipped armor back to items; no-op when nothing is equipped. */
export function unequipArmor(inv: Inventory): Inventory {
  if (!inv.equippedArmor) return inv
  return {
    ...inv,
    items: [...inv.items, ...armorSlotToItems(inv.equippedArmor)],
    equippedArmor: null,
  }
}

// ── consumables ─────────────────────────────────────────────────────
/** Result of consuming an item: the effect to apply + the resulting inventory. */
export interface UseConsumableResult {
  inventory: Inventory
  effect: ConsumableEffect | null
}

/**
 * Use a consumable: return its effect for the caller (combat) to apply and a new
 * inventory with the item removed. Guards non-consumable / missing ids: effect is
 * null and the inventory is returned unchanged.
 */
export function useConsumable(inv: Inventory, itemId: string): UseConsumableResult {
  const item = findItem(inv, itemId)
  if (!item || !isConsumableItem(item)) {
    return { inventory: inv, effect: null }
  }
  return { inventory: removeItem(inv, itemId), effect: item.effect }
}

// ── stat aggregation ────────────────────────────────────────────────
/**
 * Aggregate {strength, intelligence, defense} granted by the equipped weapon +
 * armor (spec §4). The combat module sums these onto the entity's base stats.
 */
export function equippedStatBonuses(inv: Inventory): StatBonuses {
  const weapon = weaponBonuses(inv.equippedWeapon)
  const armor = armorBonuses(inv.equippedArmor)
  return {
    strength: weapon.strength + armor.strength,
    intelligence: weapon.intelligence + armor.intelligence,
    defense: weapon.defense + armor.defense,
  }
}

// ── internal helpers (SRP) ──────────────────────────────────────────
const NO_BONUS: StatBonuses = { strength: 0, intelligence: 0, defense: 0 }

function weaponBonuses(weapon: Weapon | null): StatBonuses {
  if (!weapon) return NO_BONUS
  return {
    strength: weapon.strengthBonus,
    intelligence: weapon.intBonus,
    defense: weapon.baseDefense,
  }
}

function armorBonuses(armor: Armor | null): StatBonuses {
  if (!armor) return NO_BONUS
  return {
    strength: armor.strengthBonus,
    intelligence: armor.intBonus,
    defense: armor.defenseBonus,
  }
}

/** Wrap an unequipped weapon back into an Item (empty when the slot was empty). */
function weaponSlotToItems(weapon: Weapon | null): WeaponItem[] {
  if (!weapon) return []
  return [{ id: weapon.id, name: weapon.name, slot: 'weapon', weapon }]
}

/** Wrap an unequipped armor back into an Item (empty when the slot was empty). */
function armorSlotToItems(armor: Armor | null): ArmorItem[] {
  if (!armor) return []
  return [{ id: armor.id, name: armor.name, slot: 'armor', armor }]
}
