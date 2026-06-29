import {
  abilityReady,
  meetsRequirements,
  bindingForKey,
  ABILITY_TINT,
  FIRE_SLASH,
  DEFAULT_ABILITY_LOADOUT,
  ABILITY_REGISTRY,
  getAbility,
  assignAbility,
  removeAbility,
  bindingForSlot,
  type AbilityDef,
} from '@/game/abilities'

describe('abilities — seeded Fire Slash', () => {
  it('is offensive, uses the fire-slash animation, has a cooldown + damage', () => {
    expect(FIRE_SLASH.category).toBe('offensive')
    expect(FIRE_SLASH.animation).toBe('fire-slash')
    expect(FIRE_SLASH.cooldownMs).toBeGreaterThan(0)
    expect(FIRE_SLASH.effect.damage).toBeGreaterThan(0)
  })

  it('the fire-slash animation tints the blade red-orange', () => {
    expect(ABILITY_TINT['fire-slash']).toBe('#ff7a2a')
  })

  it('default loadout binds Fire Slash to slot/key 1', () => {
    const one = DEFAULT_ABILITY_LOADOUT.find(b => b.slot === 1)
    expect(one?.key).toBe('1')
    expect(one?.ability.id).toBe('fire-slash')
  })
})

describe('abilities — cooldown', () => {
  it('first use is always ready', () => {
    expect(abilityReady(FIRE_SLASH, undefined, 1000)).toBe(true)
  })

  it('is on cooldown until cooldownMs has elapsed, then ready again', () => {
    const used = 1000
    expect(abilityReady(FIRE_SLASH, used, used + FIRE_SLASH.cooldownMs - 1)).toBe(false)
    expect(abilityReady(FIRE_SLASH, used, used + FIRE_SLASH.cooldownMs)).toBe(true)
  })
})

describe('abilities — requirements', () => {
  it('no requirements → always allowed', () => {
    expect(meetsRequirements(FIRE_SLASH, {})).toBe(true)
  })

  it('enforces a weapon requirement but NOT level yet (progress system pending)', () => {
    const swordOnly: AbilityDef = { ...FIRE_SLASH, requirements: { weaponKind: 'sword', level: 99 } }
    expect(meetsRequirements(swordOnly, { weaponKind: 'bow', level: 1 })).toBe(false) // wrong weapon
    expect(meetsRequirements(swordOnly, { weaponKind: 'sword', level: 1 })).toBe(true) // level 99 NOT enforced yet
  })
})

describe('abilities — key binding lookup', () => {
  it('finds the binding for a pressed key', () => {
    expect(bindingForKey(DEFAULT_ABILITY_LOADOUT, '1')?.ability.id).toBe('fire-slash')
    expect(bindingForKey(DEFAULT_ABILITY_LOADOUT, '2')).toBeUndefined()
  })
})

describe('abilities — registry (the database)', () => {
  it('seeds at least 4 abilities spanning at least 3 categories', () => {
    expect(ABILITY_REGISTRY.length).toBeGreaterThanOrEqual(4)
    const categories = new Set(ABILITY_REGISTRY.map(a => a.category))
    expect(categories.size).toBeGreaterThanOrEqual(3)
  })

  it('covers offensive, defensive and debuff so there is real variety to assign', () => {
    const categories = new Set(ABILITY_REGISTRY.map(a => a.category))
    expect(categories.has('offensive')).toBe(true)
    expect(categories.has('defensive')).toBe(true)
    expect(categories.has('debuff')).toBe(true)
  })

  it('every ability has a cooldown and a non-empty effect', () => {
    for (const a of ABILITY_REGISTRY) {
      expect(a.cooldownMs).toBeGreaterThan(0)
      expect(Object.keys(a.effect).length).toBeGreaterThan(0)
    }
  })

  it('every ability has a tint for its animation (the render can recolor it)', () => {
    for (const a of ABILITY_REGISTRY) {
      expect(ABILITY_TINT[a.animation]).toBeTruthy()
    }
  })

  it('ids are unique', () => {
    const ids = ABILITY_REGISTRY.map(a => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('getAbility round-trips a known id and returns undefined for a miss', () => {
    expect(getAbility('fire-slash')).toBe(FIRE_SLASH)
    expect(getAbility('power-shot')?.category).toBe('offensive')
    expect(getAbility('guard')?.effect.shieldMs).toBeGreaterThan(0)
    expect(getAbility('frost')?.effect.debuff?.kind).toBe('slow')
    expect(getAbility('does-not-exist')).toBeUndefined()
  })
})

describe('abilities — editable loadout (assign / remove)', () => {
  it('assigns an ability into a slot, keying it to the slot number', () => {
    const next = assignAbility([], 2, getAbility('frost')!)
    const b = bindingForSlot(next, 2)
    expect(b?.ability.id).toBe('frost')
    expect(b?.key).toBe('2')
  })

  it('replaces the occupant when assigning into a taken slot (no duplicates)', () => {
    let lo = assignAbility([], 1, FIRE_SLASH)
    lo = assignAbility(lo, 1, getAbility('guard')!)
    expect(lo.filter(b => b.slot === 1)).toHaveLength(1)
    expect(bindingForSlot(lo, 1)?.ability.id).toBe('guard')
  })

  it('removes an ability from a slot, leaving the others', () => {
    let lo = assignAbility([], 1, FIRE_SLASH)
    lo = assignAbility(lo, 3, getAbility('power-shot')!)
    lo = removeAbility(lo, 1)
    expect(bindingForSlot(lo, 1)).toBeUndefined()
    expect(bindingForSlot(lo, 3)?.ability.id).toBe('power-shot')
  })

  it('does not mutate the input loadout (immutability)', () => {
    const before = DEFAULT_ABILITY_LOADOUT
    const after = assignAbility(before, 2, getAbility('frost')!)
    expect(before).toHaveLength(1) // untouched
    expect(after).toHaveLength(2)
  })
})
