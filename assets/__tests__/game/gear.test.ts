import {
  sword, axe, bow, gun, staff, shield,
  ironHelmet, ironChest, leatherChest, ironGloves, leatherGloves,
  ironBoots, leatherBoots, dodgeRing, focusRing, amulet,
  healthPotion, manaPotion, rageTonic, bomb, teleportScroll,
  GEAR_CATALOG, starterWarriorGear, starterMageGear,
} from '@/game/gear'
import { allowedSlots } from '@/game/loadout'
import type { GearSlot } from '@/game/types'

describe('gear catalog — weapons', () => {
  it('melee physical weapons (sword/axe), axe hits harder', () => {
    for (const w of [sword(), axe()]) {
      expect(w.slot).toBe('weapon')
      if (w.slot !== 'weapon') return
      expect(w.weapon.school).toBe('physical')
      expect(w.weapon.range).toBe('melee')
    }
    const s = sword(), a = axe()
    if (s.slot === 'weapon' && a.slot === 'weapon') {
      expect(a.weapon.baseDamage).toBeGreaterThan(s.weapon.baseDamage)
    }
  })

  it('bow is ranged physical; staff is magical with magic + int', () => {
    const b = bow(), st = staff()
    if (b.slot === 'weapon') {
      expect(b.weapon.range).toBe('ranged')
      expect(b.weapon.school).toBe('physical')
    }
    if (st.slot === 'weapon') {
      expect(st.weapon.school).toBe('magical')
      expect(st.weapon.baseMagic).toBeGreaterThan(0)
      expect(st.weapon.intBonus).toBeGreaterThan(0)
    }
  })

  it('gun is a ranged physical weapon that deals damage (fires a projectile)', () => {
    const g = gun()
    if (g.slot !== 'weapon') throw new Error('gun must be a weapon item')
    expect(g.weapon.kind).toBe('gun')
    expect(g.weapon.range).toBe('ranged')
    expect(g.weapon.school).toBe('physical')
    expect(g.weapon.baseDamage).toBeGreaterThan(0)
  })

  it('shield carries a block chance and defense', () => {
    const sh = shield()
    if (sh.slot !== 'weapon') throw new Error('shield must be a weapon item')
    expect(sh.weapon.kind).toBe('shield')
    expect(sh.weapon.blockChance ?? 0).toBeGreaterThan(0)
    expect(sh.weapon.baseDefense).toBeGreaterThan(0)
  })
})

describe('gear catalog — armor covers every slot, with dodge gear', () => {
  const armors = [ironHelmet(), ironChest(), leatherChest(), ironGloves(), leatherGloves(), ironBoots(), leatherBoots(), dodgeRing(), focusRing(), amulet()]

  it('provides a piece for all 6 GearSlots', () => {
    const slots = new Set<GearSlot>()
    for (const it of armors) {
      if (it.slot === 'armor') slots.add(it.armor.slot ?? 'chest')
    }
    const expected: GearSlot[] = ['helmet', 'chest', 'gloves', 'boots', 'ring', 'neck']
    for (const s of expected) expect(slots.has(s)).toBe(true)
  })

  it('some armor grants dodge', () => {
    const withDodge = armors.filter(it => it.slot === 'armor' && (it.armor.dodgeBonus ?? 0) > 0)
    expect(withDodge.length).toBeGreaterThan(0)
  })

  it('rings resolve to ring1/ring2 and a helmet only to helmet (via allowedSlots)', () => {
    expect(allowedSlots(dodgeRing())).toEqual(['ring1', 'ring2'])
    expect(allowedSlots(ironHelmet())).toEqual(['helmet'])
  })
})

describe('gear catalog — consumables / special items', () => {
  it('potions/tonic carry their effect; bomb + scroll exist as consumables', () => {
    const hp = healthPotion(), mp = manaPotion(), rt = rageTonic()
    if (hp.slot === 'consumable') expect(hp.effect.hp).toBe(30)
    if (mp.slot === 'consumable') expect(mp.effect.mana).toBe(20)
    if (rt.slot === 'consumable') expect(rt.effect.rage).toBe(20)
    expect(bomb().slot).toBe('consumable')
    expect(teleportScroll().slot).toBe('consumable')
  })

  it('consumables are not equippable (allowedSlots empty)', () => {
    expect(allowedSlots(healthPotion())).toEqual([])
    expect(allowedSlots(bomb())).toEqual([])
  })
})

describe('gear catalog — catalog + starter sets', () => {
  it('GEAR_CATALOG holds many items with unique ids', () => {
    expect(GEAR_CATALOG.length).toBeGreaterThanOrEqual(18)
    const ids = GEAR_CATALOG.map(i => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('factories return fresh objects (no shared mutable references)', () => {
    expect(sword()).not.toBe(sword())
    expect(GEAR_CATALOG[0]).not.toBe(sword())
  })

  it('starter sets are non-empty; their gear is equippable', () => {
    for (const set of [starterWarriorGear(), starterMageGear()]) {
      expect(set.length).toBeGreaterThan(0)
      const gear = set.filter(i => i.slot !== 'consumable')
      expect(gear.every(i => allowedSlots(i).length > 0)).toBe(true)
    }
    expect(starterWarriorGear().some(i => i.id === 'wpn_shield')).toBe(true)
    expect(starterMageGear().some(i => i.id === 'wpn_staff')).toBe(true)
    // the warrior bag also carries the ranged options so the player can switch + fire
    expect(starterWarriorGear().some(i => i.id === 'wpn_bow')).toBe(true)
    expect(starterWarriorGear().some(i => i.id === 'wpn_gun')).toBe(true)
  })
})
