import {
  createLoadout,
  allowedSlots,
  equip,
  unequip,
  addToBag,
  setSpecial,
  setShortcut,
  loadoutBonuses,
} from '@/game/loadout'
import { DEFAULT_BAG_SLOTS, DEFAULT_SPECIAL_SLOTS, type Item, type GearSlot } from '@/game/types'

// ── fixtures ────────────────────────────────────────────────────────
const weaponItem = (id = 'w1'): Item => ({
  id,
  name: 'Sword',
  slot: 'weapon',
  weapon: { id, kind: 'sword', name: 'Sword', baseDamage: 10, baseMagic: 0, baseDefense: 0, strengthBonus: 2, intBonus: 0, school: 'physical', range: 'melee', hands: 1, reachCells: 1 },
})
const shieldItem = (id = 'sh', blockChance = 40): Item => ({
  id,
  name: 'Shield',
  slot: 'weapon',
  weapon: { id, kind: 'shield', name: 'Shield', baseDamage: 0, baseMagic: 0, baseDefense: 5, strengthBonus: 0, intBonus: 0, school: 'physical', range: 'melee', hands: 1, reachCells: 1, blockChance },
})
const armorItem = (id: string, slot: GearSlot | undefined, dodgeBonus = 0, defenseBonus = 3): Item => ({
  id,
  name: id,
  slot: 'armor',
  armor: { id, kind: 'iron', name: id, defenseBonus, strengthBonus: 0, intBonus: 0, slot, dodgeBonus },
})
const potion = (id = 'p1'): Item => ({ id, name: 'Potion', slot: 'consumable', effect: { hp: 20 } })

describe('loadout — creation + config', () => {
  it('defaults to 24 bag + 4 special slots, empty, with 1–4 shortcuts', () => {
    const l = createLoadout()
    expect(l.bag).toHaveLength(DEFAULT_BAG_SLOTS)
    expect(l.special).toHaveLength(DEFAULT_SPECIAL_SLOTS)
    expect(l.bag.every(s => s === null)).toBe(true)
    expect(Object.keys(l.equipped)).toHaveLength(0)
    expect(l.shortcuts).toEqual(['1', '2', '3', '4'])
  })
  it('honors a custom bag/special size', () => {
    const l = createLoadout({ bagSlots: 10, specialSlots: 2 })
    expect(l.bag).toHaveLength(10)
    expect(l.special).toHaveLength(2)
    expect(l.shortcuts).toEqual(['1', '2'])
  })
})

describe('loadout — allowedSlots', () => {
  it('weapons fit weapon1/weapon2', () => {
    expect(allowedSlots(weaponItem())).toEqual(['weapon1', 'weapon2'])
  })
  it('a ring fits ring1/ring2; a helmet only helmet', () => {
    expect(allowedSlots(armorItem('r', 'ring'))).toEqual(['ring1', 'ring2'])
    expect(allowedSlots(armorItem('h', 'helmet'))).toEqual(['helmet'])
  })
  it('armor with no slot defaults to chest; consumables fit nothing', () => {
    expect(allowedSlots(armorItem('a', undefined))).toEqual(['chest'])
    expect(allowedSlots(potion())).toEqual([])
  })
})

describe('loadout — equip / unequip (immutable)', () => {
  it('equips into an allowed slot, leaving the input untouched', () => {
    const l0 = createLoadout()
    const l1 = equip(l0, weaponItem('w1'), 'weapon1')
    expect(l1.equipped.weapon1?.id).toBe('w1')
    expect(l0.equipped.weapon1).toBeUndefined()
  })
  it('refuses an item that does not fit the slot', () => {
    const l = equip(createLoadout(), weaponItem('w1'), 'helmet')
    expect(l.equipped.helmet).toBeUndefined()
  })
  it('unequips a slot', () => {
    const l = unequip(equip(createLoadout(), weaponItem(), 'weapon1'), 'weapon1')
    expect(l.equipped.weapon1).toBeUndefined()
  })
})

describe('loadout — bag + special slots', () => {
  it('addToBag fills the first free slot; a full bag is a no-op', () => {
    let l = createLoadout({ bagSlots: 1 })
    l = addToBag(l, potion('p1'))
    expect(l.bag[0]?.id).toBe('p1')
    const full = addToBag(l, potion('p2'))
    expect(full.bag).toHaveLength(1)
    expect(full.bag[0]?.id).toBe('p1')
  })
  it('assigns a special slot + rebinds its shortcut', () => {
    let l = createLoadout()
    l = setSpecial(l, 0, potion('bomb'))
    expect(l.special[0]?.id).toBe('bomb')
    l = setShortcut(l, 0, '5')
    expect(l.shortcuts[0]).toBe('5')
  })
})

describe('loadout — aggregate bonuses (dodge from armor, block from shield)', () => {
  it('sums defense/str/int and pulls dodge from armor, block from a shield', () => {
    let l = createLoadout()
    l = equip(l, armorItem('boots', 'boots', 8, 2), 'boots')
    l = equip(l, shieldItem('sh', 40), 'weapon2')
    const b = loadoutBonuses(l)
    expect(b.dodge).toBe(8)
    expect(b.block).toBe(40)
    expect(b.defense).toBe(7) // 2 (boots) + 5 (shield baseDefense)
  })
})
