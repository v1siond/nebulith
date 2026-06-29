import {
  abilityReady,
  meetsRequirements,
  bindingForKey,
  ABILITY_TINT,
  FIRE_SLASH,
  DEFAULT_ABILITY_LOADOUT,
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
