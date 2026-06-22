/**
 * Per-entity LOADOUT: worn gear by equip slot, a fixed-size bag, and quick-use
 * special slots (bombs / scrolls / potions) bound to number keys (1–0).
 *
 * Pure + immutable — every mutator returns a new Loadout, inputs untouched.
 * `loadoutBonuses` aggregates the stat contribution of everything worn (dodge from
 * armor, block from shields) so combat/derived-stats can fold it into an entity.
 */
import {
  type Item,
  type EquipSlot,
  type GearSlot,
  type Loadout,
  type LoadoutConfig,
  DEFAULT_BAG_SLOTS,
  DEFAULT_SPECIAL_SLOTS,
} from './types'

const SHORTCUT_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'] as const

/** Which equip slots a given item may occupy (empty for non-equippables). */
const ARMOR_SLOTS: Record<GearSlot, EquipSlot[]> = {
  helmet: ['helmet'],
  chest: ['chest'],
  gloves: ['gloves'],
  boots: ['boots'],
  ring: ['ring1', 'ring2'],
  neck: ['neck'],
}

export interface LoadoutBonuses {
  strength: number
  intelligence: number
  defense: number
  dodge: number
  block: number
}

export function createLoadout(config: LoadoutConfig = {}): Loadout {
  const bagSlots = config.bagSlots ?? DEFAULT_BAG_SLOTS
  const specialSlots = config.specialSlots ?? DEFAULT_SPECIAL_SLOTS
  return {
    equipped: {},
    bag: Array.from({ length: bagSlots }, () => null),
    special: Array.from({ length: specialSlots }, () => null),
    shortcuts: Array.from({ length: specialSlots }, (_, i) => SHORTCUT_KEYS[i % SHORTCUT_KEYS.length]),
  }
}

export function allowedSlots(item: Item): EquipSlot[] {
  if (item.slot === 'weapon') return ['weapon1', 'weapon2']
  if (item.slot === 'armor') return ARMOR_SLOTS[item.armor.slot ?? 'chest']
  return [] // consumables aren't equipped — they live in bag / special slots
}

export function equip(loadout: Loadout, item: Item, slot: EquipSlot): Loadout {
  if (!allowedSlots(item).includes(slot)) return loadout
  return { ...loadout, equipped: { ...loadout.equipped, [slot]: item } }
}

export function unequip(loadout: Loadout, slot: EquipSlot): Loadout {
  if (!(slot in loadout.equipped)) return loadout
  const equipped = { ...loadout.equipped }
  delete equipped[slot]
  return { ...loadout, equipped }
}

export function firstFreeBag(loadout: Loadout): number {
  return loadout.bag.findIndex(s => s === null)
}

export function addToBag(loadout: Loadout, item: Item): Loadout {
  const i = firstFreeBag(loadout)
  if (i < 0) return loadout // bag full
  const bag = [...loadout.bag]
  bag[i] = item
  return { ...loadout, bag }
}

export function setSpecial(loadout: Loadout, index: number, item: Item | null): Loadout {
  if (index < 0 || index >= loadout.special.length) return loadout
  const special = [...loadout.special]
  special[index] = item
  return { ...loadout, special }
}

export function setShortcut(loadout: Loadout, index: number, key: string): Loadout {
  if (index < 0 || index >= loadout.shortcuts.length) return loadout
  const shortcuts = [...loadout.shortcuts]
  shortcuts[index] = key
  return { ...loadout, shortcuts }
}

/** Aggregate everything worn into a flat stat-bonus block. */
export function loadoutBonuses(loadout: Loadout): LoadoutBonuses {
  const acc: LoadoutBonuses = { strength: 0, intelligence: 0, defense: 0, dodge: 0, block: 0 }
  for (const item of Object.values(loadout.equipped)) {
    if (!item) continue
    if (item.slot === 'weapon') {
      acc.strength += item.weapon.strengthBonus
      acc.intelligence += item.weapon.intBonus
      acc.defense += item.weapon.baseDefense
      acc.block += item.weapon.blockChance ?? 0
    } else if (item.slot === 'armor') {
      acc.strength += item.armor.strengthBonus
      acc.intelligence += item.armor.intBonus
      acc.defense += item.armor.defenseBonus
      acc.dodge += item.armor.dodgeBonus ?? 0
    }
  }
  return acc
}
