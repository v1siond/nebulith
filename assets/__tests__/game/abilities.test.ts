import '@/__tests__/helpers/installTilesetSeed' // the registry rows carry tile-backed icons; install the captured tileset so they resolve
import {
  abilityReady,
  meetsRequirements,
  bindingForKey,
  getAbility,
  defaultAbilityLoadout,
  abilityRegistry,
  assignAbility,
  removeAbility,
  rebindAbility,
  bindingForSlot,
  installAbilityRegistry,
  type AbilityCategory,
  type AbilityDef,
} from '@/game/abilities'
import { abilityTint } from '@/game/abilityArt'
import liveAbilities from '@/__tests__/fixtures/abilities.json'

beforeEach(() => installAbilityRegistry(liveAbilities.data as never))

describe('abilities — seeded Fire Slash', () => {
  it('is offensive, uses the fire-slash animation, has a cooldown + damage', () => {
    expect(getAbility('fire-slash')!.category).toBe('offensive')
    expect(getAbility('fire-slash')!.animation).toBe('fire-slash')
    expect(getAbility('fire-slash')!.cooldownMs).toBeGreaterThan(0)
    expect(getAbility('fire-slash')!.effect.damage).toBeGreaterThan(0)
  })

  it('the fire-slash animation tints the blade red-orange — from the SERVED tile, not a frontend table', () => {
    // §3.14b #2: the old `ABILITY_TINT` map re-declared nine hexes the API already sends on each animation's
    // own tile. Re-seed that tile a different colour and the blade follows; nothing here to keep in sync.
    expect(abilityTint('fire-slash')).toBe('#ff7a2a')
  })

  it('default loadout binds Fire Slash to slot/key 1', () => {
    const one = defaultAbilityLoadout().find(b => b.slot === 1)
    expect(one?.key).toBe('1')
    expect(one?.ability.id).toBe('fire-slash')
  })
})

describe('abilities — cooldown', () => {
  it('first use is always ready', () => {
    expect(abilityReady(getAbility('fire-slash')!, undefined, 1000)).toBe(true)
  })

  it('is on cooldown until cooldownMs has elapsed, then ready again', () => {
    const used = 1000
    expect(abilityReady(getAbility('fire-slash')!, used, used + getAbility('fire-slash')!.cooldownMs - 1)).toBe(false)
    expect(abilityReady(getAbility('fire-slash')!, used, used + getAbility('fire-slash')!.cooldownMs)).toBe(true)
  })
})

describe('abilities — requirements', () => {
  it('no requirements → always allowed', () => {
    expect(meetsRequirements(getAbility('fire-slash')!, {})).toBe(true)
  })

  it('enforces a weapon requirement but NOT level yet (progress system pending)', () => {
    const swordOnly: AbilityDef = { ...getAbility('fire-slash')!, requirements: { weaponKind: 'sword', level: 99 } }
    expect(meetsRequirements(swordOnly, { weaponKind: 'bow', level: 1 })).toBe(false) // wrong weapon
    expect(meetsRequirements(swordOnly, { weaponKind: 'sword', level: 1 })).toBe(true) // level 99 NOT enforced yet
  })
})

describe('abilities — key binding lookup', () => {
  it('finds the binding for a pressed key', () => {
    expect(bindingForKey(defaultAbilityLoadout(), '1')?.ability.id).toBe('fire-slash')
    expect(bindingForKey(defaultAbilityLoadout(), '2')).toBeUndefined()
  })
})

describe('abilities — registry (the database)', () => {
  it('seeds a rich library — at least 10 abilities to browse', () => {
    expect(abilityRegistry().length).toBeGreaterThanOrEqual(10)
  })

  it('covers EVERY category so the browse modal spans the whole spread', () => {
    const all: AbilityCategory[] = ['offensive', 'defensive', 'debuff', 'protection', 'healing']
    const present = new Set(abilityRegistry().map(a => a.category))
    for (const cat of all) expect(present.has(cat)).toBe(true)
  })

  it('offers both melee and ranged offensive options (variety within a category)', () => {
    const offensive = abilityRegistry().filter(a => a.category === 'offensive')
    const melee = offensive.filter(a => a.animation === 'fire-slash' || a.animation === 'cleave')
    const ranged = offensive.filter(a => ['bolt', 'piercing-shot', 'nova', 'lightning'].includes(a.animation))
    expect(melee.length).toBeGreaterThanOrEqual(1)
    expect(ranged.length).toBeGreaterThanOrEqual(1)
  })

  it('every healing ability actually heals and every protection ability shields', () => {
    for (const a of abilityRegistry().filter(a => a.category === 'healing')) {
      expect(a.effect.healing).toBeGreaterThan(0)
    }
    for (const a of abilityRegistry().filter(a => a.category === 'protection')) {
      expect(a.effect.shieldMs).toBeGreaterThan(0)
    }
  })

  it('every ability has a cooldown and a non-empty effect', () => {
    for (const a of abilityRegistry()) {
      expect(a.cooldownMs).toBeGreaterThan(0)
      expect(Object.keys(a.effect).length).toBeGreaterThan(0)
    }
  })

  it('every ability has a tint for its animation (the render can recolor it)', () => {
    for (const a of abilityRegistry()) {
      expect(abilityTint(a.animation)).toBeTruthy()
    }
  })

  it('ids are unique', () => {
    const ids = abilityRegistry().map(a => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('getAbility round-trips a known id and returns undefined for a miss', () => {
    expect(getAbility('fire-slash')).toBe(getAbility('fire-slash')!)
    expect(getAbility('power-shot')?.category).toBe('offensive')
    expect(getAbility('guard')?.effect.shieldMs).toBeGreaterThan(0)
    expect(getAbility('frost')?.effect.debuff?.kind).toBe('slow')
    expect(getAbility('does-not-exist')).toBeUndefined()
  })

  it('getAbility round-trips the newly seeded abilities too', () => {
    expect(getAbility('cleave')?.category).toBe('offensive')
    expect(getAbility('arcane-bolt')?.effect.damage).toBeGreaterThan(0)
    expect(getAbility('bulwark')?.category).toBe('protection')
    expect(getAbility('mend')?.effect.healing).toBeGreaterThan(0)
    expect(getAbility('poison-dart')?.effect.debuff?.kind).toBe('poison')
    expect(getAbility('enfeeble')?.effect.debuff?.kind).toBe('weaken')
  })

  it('every registered ability round-trips through getAbility by id', () => {
    for (const a of abilityRegistry()) expect(getAbility(a.id)).toBe(a)
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
    let lo = assignAbility([], 1, getAbility('fire-slash')!)
    lo = assignAbility(lo, 1, getAbility('guard')!)
    expect(lo.filter(b => b.slot === 1)).toHaveLength(1)
    expect(bindingForSlot(lo, 1)?.ability.id).toBe('guard')
  })

  it('removes an ability from a slot, leaving the others', () => {
    let lo = assignAbility([], 1, getAbility('fire-slash')!)
    lo = assignAbility(lo, 3, getAbility('power-shot')!)
    lo = removeAbility(lo, 1)
    expect(bindingForSlot(lo, 1)).toBeUndefined()
    expect(bindingForSlot(lo, 3)?.ability.id).toBe('power-shot')
  })

  it('does not mutate the input loadout (immutability)', () => {
    const before = defaultAbilityLoadout()
    const after = assignAbility(before, 2, getAbility('frost')!)
    expect(before).toHaveLength(1) // untouched
    expect(after).toHaveLength(2)
  })
})

describe('abilities — rebinding a slot to any key', () => {
  it('changes only the targeted slot\'s key, keeping its ability', () => {
    const lo = assignAbility([], 1, getAbility('fire-slash')!)
    const next = rebindAbility(lo, 1, 'q')
    const b = bindingForSlot(next, 1)
    expect(b?.key).toBe('q')
    expect(b?.ability.id).toBe('fire-slash')
    expect(bindingForKey(next, 'q')?.ability.id).toBe('fire-slash')
    expect(bindingForKey(next, '1')).toBeUndefined()
  })

  it('swaps keys when the target key is already taken (keeps every key unique)', () => {
    let lo = assignAbility([], 1, getAbility('fire-slash')!) // key '1'
    lo = assignAbility(lo, 2, getAbility('guard')!) // key '2'
    const next = rebindAbility(lo, 1, '2') // slot 1 wants '2', which slot 2 holds → swap
    expect(bindingForSlot(next, 1)?.key).toBe('2')
    expect(bindingForSlot(next, 2)?.key).toBe('1')
    const keys = next.map(b => b.key)
    expect(new Set(keys).size).toBe(keys.length) // all unique
  })

  it('is a no-op for an empty slot and does not mutate the input', () => {
    const before = assignAbility([], 1, getAbility('fire-slash')!)
    const after = rebindAbility(before, 3, 'r') // slot 3 empty
    expect(bindingForSlot(after, 1)?.key).toBe('1')
    expect(after).toHaveLength(1)
    expect(before[0].key).toBe('1') // untouched
  })
})
