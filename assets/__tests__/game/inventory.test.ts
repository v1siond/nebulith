import {
  emptyInventory,
  createInventory,
  addItem,
  removeItem,
  findItem,
  findItemsBySlot,
  equipWeapon,
  equipArmor,
  unequipWeapon,
  unequipArmor,
  useConsumable,
  equippedStatBonuses,
} from '@/game/inventory'
import type { Armor, Inventory, Item, Weapon } from '@/game/types'

// ── fixtures ─────────────────────────────────────────────────────────
function makeWeapon(over: Partial<Weapon> = {}): Weapon {
  return {
    id: 'w-sword',
    kind: 'sword',
    name: 'Iron Sword',
    baseDamage: 12,
    baseMagic: 0,
    baseDefense: 2,
    strengthBonus: 3,
    intBonus: 0,
    school: 'physical',
    range: 'melee',
    hands: 1,
    reachCells: 1,
    ...over,
  }
}

function makeStaff(over: Partial<Weapon> = {}): Weapon {
  return makeWeapon({
    id: 'w-staff',
    kind: 'staff',
    name: 'Oak Staff',
    baseDamage: 0,
    baseMagic: 14,
    baseDefense: 0,
    strengthBonus: 0,
    intBonus: 5,
    school: 'magical',
    range: 'ranged',
    ...over,
  })
}

function makeArmor(over: Partial<Armor> = {}): Armor {
  return {
    id: 'a-iron',
    kind: 'iron',
    name: 'Iron Mail',
    defenseBonus: 8,
    strengthBonus: 4,
    intBonus: 0,
    ...over,
  }
}

function weaponItem(over: Partial<Weapon> = {}): Extract<Item, { slot: 'weapon' }> {
  const weapon = makeWeapon(over)
  return { id: weapon.id, name: weapon.name, slot: 'weapon', weapon }
}

function armorItem(over: Partial<Armor> = {}): Extract<Item, { slot: 'armor' }> {
  const armor = makeArmor(over)
  return { id: armor.id, name: armor.name, slot: 'armor', armor }
}

function consumableItem(
  id: string,
  effect = { hp: 25 },
): Extract<Item, { slot: 'consumable' }> {
  return { id, name: 'Health Potion', slot: 'consumable', effect }
}

/** Freeze an inventory deeply so any mutation attempt throws (immutability proof). */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

// ── create / empty ───────────────────────────────────────────────────
describe('emptyInventory', () => {
  it('returns an empty inventory with nothing equipped', () => {
    const inv = emptyInventory()
    expect(inv.items).toEqual([])
    expect(inv.equippedWeapon).toBeNull()
    expect(inv.equippedArmor).toBeNull()
  })

  it('returns a fresh instance each call (no shared array)', () => {
    const a = emptyInventory()
    const b = emptyInventory()
    expect(a).not.toBe(b)
    expect(a.items).not.toBe(b.items)
  })
})

describe('createInventory', () => {
  it('seeds items and equipped slots', () => {
    const weapon = makeWeapon()
    const inv = createInventory([weaponItem()], weapon, null)
    expect(inv.items).toHaveLength(1)
    expect(inv.equippedWeapon).toBe(weapon)
    expect(inv.equippedArmor).toBeNull()
  })

  it('copies the items array so later input mutation does not leak in', () => {
    const seed: Item[] = [weaponItem()]
    const inv = createInventory(seed)
    seed.push(armorItem())
    expect(inv.items).toHaveLength(1)
  })
})

// ── addItem / removeItem ─────────────────────────────────────────────
describe('addItem', () => {
  it('appends an item and returns a NEW inventory (input untouched)', () => {
    const inv = deepFreeze(emptyInventory())
    const next = addItem(inv, consumableItem('c-1'))
    expect(next).not.toBe(inv)
    expect(inv.items).toHaveLength(0) // input unchanged
    expect(next.items).toHaveLength(1)
    expect(next.items[0].id).toBe('c-1')
  })

  it('preserves equipped slots when adding', () => {
    const weapon = makeWeapon()
    const inv = createInventory([], weapon, null)
    const next = addItem(inv, consumableItem('c-1'))
    expect(next.equippedWeapon).toBe(weapon)
  })
})

describe('removeItem', () => {
  it('removes the item by id and returns a new inventory', () => {
    const inv = deepFreeze(createInventory([consumableItem('c-1'), consumableItem('c-2')]))
    const next = removeItem(inv, 'c-1')
    expect(next).not.toBe(inv)
    expect(next.items.map((i) => i.id)).toEqual(['c-2'])
    expect(inv.items).toHaveLength(2) // input unchanged
  })

  it('is a no-op when the id is missing (guarded, returns same reference)', () => {
    const inv = createInventory([consumableItem('c-1')])
    const next = removeItem(inv, 'does-not-exist')
    expect(next).toBe(inv)
  })
})

// ── query helpers ────────────────────────────────────────────────────
describe('findItem', () => {
  it('finds an item by id', () => {
    const item = consumableItem('c-1')
    const inv = createInventory([item, consumableItem('c-2')])
    expect(findItem(inv, 'c-1')).toBe(item)
  })

  it('returns undefined for a missing id', () => {
    const inv = createInventory([consumableItem('c-1')])
    expect(findItem(inv, 'nope')).toBeUndefined()
  })
})

describe('findItemsBySlot', () => {
  it('returns only items in the requested slot', () => {
    const inv = createInventory([weaponItem(), armorItem(), consumableItem('c-1')])
    expect(findItemsBySlot(inv, 'weapon').map((i) => i.slot)).toEqual(['weapon'])
    expect(findItemsBySlot(inv, 'consumable')).toHaveLength(1)
  })

  it('returns an empty array when nothing matches', () => {
    const inv = createInventory([consumableItem('c-1')])
    expect(findItemsBySlot(inv, 'weapon')).toEqual([])
  })
})

// ── equipWeapon ──────────────────────────────────────────────────────
describe('equipWeapon', () => {
  it('equips a weapon and pulls it out of items', () => {
    const inv = deepFreeze(createInventory([weaponItem()]))
    const next = equipWeapon(inv, 'w-sword')
    expect(next.equippedWeapon?.id).toBe('w-sword')
    expect(next.items).toHaveLength(0)
    expect(inv.equippedWeapon).toBeNull() // input unchanged
  })

  it('swaps: the previously-equipped weapon returns to items', () => {
    const oldItem = weaponItem({ id: 'w-old', name: 'Old Blade' })
    const newItem = weaponItem({ id: 'w-new', name: 'New Blade' })
    const inv = createInventory([newItem], oldItem.weapon, null)
    const next = equipWeapon(inv, 'w-new')
    expect(next.equippedWeapon?.id).toBe('w-new')
    expect(next.items.map((i) => i.id)).toEqual(['w-old'])
  })

  it('guards: refuses to equip an armor item into the weapon slot (no-op)', () => {
    const inv = createInventory([armorItem({ id: 'a-iron' })])
    const next = equipWeapon(inv, 'a-iron')
    expect(next).toBe(inv)
    expect(next.equippedWeapon).toBeNull()
  })

  it('guards: a missing id is a no-op', () => {
    const inv = createInventory([weaponItem()])
    expect(equipWeapon(inv, 'ghost')).toBe(inv)
  })
})

// ── equipArmor ───────────────────────────────────────────────────────
describe('equipArmor', () => {
  it('equips armor and removes it from items', () => {
    const inv = deepFreeze(createInventory([armorItem()]))
    const next = equipArmor(inv, 'a-iron')
    expect(next.equippedArmor?.id).toBe('a-iron')
    expect(next.items).toHaveLength(0)
  })

  it('swaps the previously-equipped armor back into items', () => {
    const oldArmor = makeArmor({ id: 'a-old', name: 'Old Mail' })
    const inv = createInventory([armorItem({ id: 'a-new', name: 'New Mail' })], null, oldArmor)
    const next = equipArmor(inv, 'a-new')
    expect(next.equippedArmor?.id).toBe('a-new')
    expect(next.items.map((i) => i.id)).toEqual(['a-old'])
  })

  it('guards: refuses to equip a weapon item into the armor slot (no-op)', () => {
    const inv = createInventory([weaponItem({ id: 'w-sword' })])
    const next = equipArmor(inv, 'w-sword')
    expect(next).toBe(inv)
    expect(next.equippedArmor).toBeNull()
  })

  it('guards: a missing id is a no-op', () => {
    const inv = createInventory([armorItem()])
    expect(equipArmor(inv, 'ghost')).toBe(inv)
  })
})

// ── unequip ──────────────────────────────────────────────────────────
describe('unequipWeapon', () => {
  it('moves the equipped weapon back to items and clears the slot', () => {
    const weapon = makeWeapon()
    const inv = deepFreeze(createInventory([], weapon, null))
    const next = unequipWeapon(inv)
    expect(next.equippedWeapon).toBeNull()
    expect(next.items.map((i) => i.id)).toEqual(['w-sword'])
  })

  it('is a no-op when no weapon is equipped', () => {
    const inv = createInventory([])
    expect(unequipWeapon(inv)).toBe(inv)
  })
})

describe('unequipArmor', () => {
  it('moves the equipped armor back to items and clears the slot', () => {
    const armor = makeArmor()
    const inv = createInventory([], null, armor)
    const next = unequipArmor(inv)
    expect(next.equippedArmor).toBeNull()
    expect(next.items.map((i) => i.id)).toEqual(['a-iron'])
  })

  it('is a no-op when no armor is equipped', () => {
    const inv = createInventory([])
    expect(unequipArmor(inv)).toBe(inv)
  })
})

// ── useConsumable ────────────────────────────────────────────────────
describe('useConsumable', () => {
  it('returns the effect to apply and removes the consumable', () => {
    const inv = deepFreeze(createInventory([consumableItem('c-1', { hp: 30, mana: 10 })]))
    const { inventory, effect } = useConsumable(inv, 'c-1')
    expect(effect).toEqual({ hp: 30, mana: 10 })
    expect(inventory.items).toHaveLength(0)
    expect(inv.items).toHaveLength(1) // input unchanged
  })

  it('guards: refuses a non-consumable item (effect null, inventory unchanged)', () => {
    const inv = createInventory([weaponItem({ id: 'w-sword' })])
    const { inventory, effect } = useConsumable(inv, 'w-sword')
    expect(effect).toBeNull()
    expect(inventory).toBe(inv)
  })

  it('guards: a missing id yields a null effect and unchanged inventory', () => {
    const inv = createInventory([consumableItem('c-1')])
    const { inventory, effect } = useConsumable(inv, 'ghost')
    expect(effect).toBeNull()
    expect(inventory).toBe(inv)
  })
})

// ── equippedStatBonuses ──────────────────────────────────────────────
describe('equippedStatBonuses', () => {
  it('returns zeroes when nothing is equipped', () => {
    expect(equippedStatBonuses(emptyInventory())).toEqual({
      strength: 0,
      intelligence: 0,
      defense: 0,
    })
  })

  it('sums weapon + armor bonuses (warrior build)', () => {
    const weapon = makeWeapon({ strengthBonus: 3, intBonus: 0, baseDefense: 2 })
    const armor = makeArmor({ strengthBonus: 4, intBonus: 0, defenseBonus: 8 })
    const inv = createInventory([], weapon, armor)
    expect(equippedStatBonuses(inv)).toEqual({
      strength: 7, // 3 + 4
      intelligence: 0,
      defense: 10, // weapon.baseDefense 2 + armor.defenseBonus 8
    })
  })

  it('counts staff + leather (magician build) into intelligence', () => {
    const staff = makeStaff({ intBonus: 5, strengthBonus: 0, baseDefense: 0 })
    const armor = makeArmor({ kind: 'leather', strengthBonus: 0, intBonus: 6, defenseBonus: 3 })
    const inv = createInventory([], staff, armor)
    expect(equippedStatBonuses(inv)).toEqual({
      strength: 0,
      intelligence: 11, // 5 + 6
      defense: 3,
    })
  })

  it('still aggregates with only a weapon equipped', () => {
    const weapon = makeWeapon({ strengthBonus: 3, baseDefense: 2 })
    const inv = createInventory([], weapon, null)
    expect(equippedStatBonuses(inv)).toEqual({
      strength: 3,
      intelligence: 0,
      defense: 2,
    })
  })
})
