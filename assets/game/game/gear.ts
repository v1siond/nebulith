/**
 * GEAR CATALOG — ready-to-use weapons, armor/clothes, and consumables as `Item`s
 * for the loadout system. Every export is a factory returning a FRESH object, so
 * callers never share mutable references (equip one into a slot without aliasing).
 *
 * Stat data only — the visual ASCII glyph for each item is a UI concern mapped in
 * the editor, not stored on the item.
 */
import type { Item, Weapon, Armor, ConsumableEffect } from './types'

// ── builders ────────────────────────────────────────────────────────
function weaponItem(w: Weapon): Item {
  return { id: w.id, name: w.name, slot: 'weapon', weapon: { ...w } }
}
function armorItem(a: Armor): Item {
  return { id: a.id, name: a.name, slot: 'armor', armor: { ...a } }
}
function consumable(id: string, name: string, effect: ConsumableEffect): Item {
  return { id, name, slot: 'consumable', effect: { ...effect } }
}

// ── weapons ─────────────────────────────────────────────────────────
// sword = one-handed melee → reach 1.
export const sword = (): Item =>
  weaponItem({ id: 'wpn_sword', kind: 'sword', name: 'Iron Sword', baseDamage: 12, baseMagic: 0, baseDefense: 2, strengthBonus: 3, intBonus: 0, school: 'physical', range: 'melee', hands: 1, reachCells: 1 })

// axe = two-handed melee → reach 2.
export const axe = (): Item =>
  weaponItem({ id: 'wpn_axe', kind: 'axe', name: 'Battle Axe', baseDamage: 18, baseMagic: 0, baseDefense: 0, strengthBonus: 4, intBonus: 0, school: 'physical', range: 'melee', hands: 2, reachCells: 2 })

// bow = two-handed RANGED → fires a travelling arrow; reach 8 (within the 6–12 band).
export const bow = (): Item =>
  weaponItem({ id: 'wpn_bow', kind: 'bow', name: 'Hunter Bow', baseDamage: 10, baseMagic: 0, baseDefense: 0, strengthBonus: 2, intBonus: 0, school: 'physical', range: 'ranged', hands: 2, reachCells: 8 })

// gun = one-handed RANGED → fires a travelling bullet; harder hit than the bow, no str scaling;
// reach 7 (within the 6–12 band).
export const gun = (): Item =>
  weaponItem({ id: 'wpn_gun', kind: 'gun', name: 'Flintlock Pistol', baseDamage: 16, baseMagic: 0, baseDefense: 0, strengthBonus: 0, intBonus: 0, school: 'physical', range: 'ranged', hands: 1, reachCells: 7 })

// staff = two-handed magical MELEE caster → reach 2.
export const staff = (): Item =>
  weaponItem({ id: 'wpn_staff', kind: 'staff', name: 'Oak Staff', baseDamage: 2, baseMagic: 14, baseDefense: 1, strengthBonus: 0, intBonus: 4, school: 'magical', range: 'melee', hands: 2, reachCells: 2 })

// shield = one-handed off-hand → reach 1.
export const shield = (): Item =>
  weaponItem({ id: 'wpn_shield', kind: 'shield', name: 'Round Shield', baseDamage: 0, baseMagic: 0, baseDefense: 6, strengthBonus: 0, intBonus: 0, school: 'physical', range: 'melee', hands: 1, reachCells: 1, blockChance: 35 })

// ── armor / clothes (covers every GearSlot) ─────────────────────────
export const ironHelmet = (): Item =>
  armorItem({ id: 'arm_helmet_iron', kind: 'iron', name: 'Iron Helmet', defenseBonus: 3, strengthBonus: 1, intBonus: 0, slot: 'helmet' })

export const ironChest = (): Item =>
  armorItem({ id: 'arm_chest_iron', kind: 'iron', name: 'Iron Cuirass', defenseBonus: 6, strengthBonus: 2, intBonus: 0, slot: 'chest' })

export const leatherChest = (): Item =>
  armorItem({ id: 'arm_chest_leather', kind: 'leather', name: 'Leather Jerkin', defenseBonus: 3, strengthBonus: 0, intBonus: 2, slot: 'chest', dodgeBonus: 4 })

export const leatherGloves = (): Item =>
  armorItem({ id: 'arm_gloves_leather', kind: 'leather', name: 'Leather Gloves', defenseBonus: 1, strengthBonus: 0, intBonus: 1, slot: 'gloves', dodgeBonus: 3 })

export const leatherBoots = (): Item =>
  armorItem({ id: 'arm_boots_leather', kind: 'leather', name: 'Leather Boots', defenseBonus: 1, strengthBonus: 0, intBonus: 0, slot: 'boots', dodgeBonus: 5 })

export const ironGloves = (): Item =>
  armorItem({ id: 'arm_gloves_iron', kind: 'iron', name: 'Iron Gauntlets', defenseBonus: 2, strengthBonus: 1, intBonus: 0, slot: 'gloves' })

export const ironBoots = (): Item =>
  armorItem({ id: 'arm_boots_iron', kind: 'iron', name: 'Iron Greaves', defenseBonus: 2, strengthBonus: 1, intBonus: 0, slot: 'boots' })

export const dodgeRing = (): Item =>
  armorItem({ id: 'arm_ring_dodge', kind: 'leather', name: 'Ring of Evasion', defenseBonus: 0, strengthBonus: 0, intBonus: 0, slot: 'ring', dodgeBonus: 5 })

export const focusRing = (): Item =>
  armorItem({ id: 'arm_ring_focus', kind: 'leather', name: 'Ring of Focus', defenseBonus: 0, strengthBonus: 0, intBonus: 3, slot: 'ring' })

export const amulet = (): Item =>
  armorItem({ id: 'arm_neck_amulet', kind: 'leather', name: 'Warding Amulet', defenseBonus: 2, strengthBonus: 0, intBonus: 2, slot: 'neck' })

// ── consumables / special items ─────────────────────────────────────
export const healthPotion = (): Item => consumable('itm_potion_hp', 'Health Potion', { hp: 30 })
export const manaPotion = (): Item => consumable('itm_potion_mana', 'Mana Potion', { mana: 20 })
export const rageTonic = (): Item => consumable('itm_tonic_rage', 'Rage Tonic', { rage: 20 })
// Special-slot throwables — behavior (throw/teleport) is wired in the play loop later;
// the catalog just needs the items to exist so they can sit in a special slot.
export const bomb = (): Item => consumable('itm_bomb', 'Bomb', {})
export const teleportScroll = (): Item => consumable('itm_scroll_teleport', 'Teleport Scroll', {})

// ── catalog + starter sets ──────────────────────────────────────────
export const GEAR_CATALOG: Item[] = [
  sword(), axe(), bow(), gun(), staff(), shield(),
  ironHelmet(), ironChest(), leatherChest(), ironGloves(), leatherGloves(),
  ironBoots(), leatherBoots(), dodgeRing(), focusRing(), amulet(),
  healthPotion(), manaPotion(), rageTonic(), bomb(), teleportScroll(),
]

/** A melee tank kit: sword + shield + iron plate + a heal, plus a bow + gun so the player can
 *  switch to ranged (equip either and fire). */
export const starterWarriorGear = (): Item[] => [
  sword(), shield(), bow(), gun(), ironHelmet(), ironChest(), ironGloves(), ironBoots(), healthPotion(),
]

/** A caster kit: staff + light armor + a focus ring + mana. */
export const starterMageGear = (): Item[] => [
  staff(), leatherChest(), leatherGloves(), leatherBoots(), focusRing(), amulet(), manaPotion(),
]
