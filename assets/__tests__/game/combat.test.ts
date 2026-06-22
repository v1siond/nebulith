import {
  deriveStats,
  rageCap,
  manaCap,
  startingCombatState,
  applyDamage,
  isDead,
  resolveAttack,
  REGULAR_MULTIPLIER,
  SPECIAL_MULTIPLIER,
} from '@/game/combat'
import type {
  Stats,
  Attack,
  Weapon,
  Armor,
  CombatState,
} from '@/game/types'

// ── fixtures ────────────────────────────────────────────────────────
const baseStats = (over: Partial<Stats> = {}): Stats => ({
  strength: 10,
  intelligence: 10,
  defense: 5,
  maxHp: 100,
  ...over,
})

const sword = (over: Partial<Weapon> = {}): Weapon => ({
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
  ...over,
})

const bow = (over: Partial<Weapon> = {}): Weapon => ({
  id: 'w-bow',
  kind: 'sword', // WeaponKind has no 'bow'; ranged physical modeled via range
  name: 'Hunter Bow',
  baseDamage: 8,
  baseMagic: 0,
  baseDefense: 0,
  strengthBonus: 1,
  intBonus: 0,
  school: 'physical',
  range: 'ranged',
  ...over,
})

const staff = (over: Partial<Weapon> = {}): Weapon => ({
  id: 'w-staff',
  kind: 'staff',
  name: 'Oak Staff',
  baseDamage: 0,
  baseMagic: 14,
  baseDefense: 0,
  strengthBonus: 0,
  intBonus: 4,
  school: 'magical',
  range: 'ranged',
  ...over,
})

const ironArmor = (over: Partial<Armor> = {}): Armor => ({
  id: 'a-iron',
  kind: 'iron',
  name: 'Iron Plate',
  defenseBonus: 8,
  strengthBonus: 4,
  intBonus: 0,
  ...over,
})

const leatherArmor = (over: Partial<Armor> = {}): Armor => ({
  id: 'a-leather',
  kind: 'leather',
  name: 'Leather Vest',
  defenseBonus: 3,
  strengthBonus: 0,
  intBonus: 5,
  ...over,
})

const attack = (over: Partial<Attack> = {}): Attack => ({
  school: 'physical',
  range: 'melee',
  tier: 'regular',
  ...over,
})

// ── deriveStats ─────────────────────────────────────────────────────
describe('deriveStats — base + weapon + armor aggregation', () => {
  it('returns the base stats unchanged with no equipment', () => {
    expect(deriveStats(baseStats())).toEqual(baseStats())
  })

  it('adds weapon bonuses (strength, defense) onto base', () => {
    const d = deriveStats(baseStats(), sword())
    expect(d.strength).toBe(10 + 3)
    expect(d.defense).toBe(5 + 2) // base + weapon baseDefense
    expect(d.intelligence).toBe(10)
  })

  it('adds armor bonuses: iron gives strength + defense', () => {
    const d = deriveStats(baseStats(), undefined, ironArmor())
    expect(d.strength).toBe(10 + 4)
    expect(d.defense).toBe(5 + 8)
    expect(d.intelligence).toBe(10)
  })

  it('adds armor bonuses: leather gives intelligence + defense', () => {
    const d = deriveStats(baseStats(), undefined, leatherArmor())
    expect(d.intelligence).toBe(10 + 5)
    expect(d.defense).toBe(5 + 3)
    expect(d.strength).toBe(10)
  })

  it('aggregates weapon AND armor together', () => {
    const d = deriveStats(baseStats(), staff(), leatherArmor())
    expect(d.intelligence).toBe(10 + 4 + 5)
    expect(d.defense).toBe(5 + 0 + 3)
    expect(d.maxHp).toBe(100) // equipment does not change maxHp here
  })

  it('does not mutate the base stats object (purity)', () => {
    const base = baseStats()
    deriveStats(base, sword(), ironArmor())
    expect(base).toEqual(baseStats())
  })
})

// ── resource caps ───────────────────────────────────────────────────
describe('rageCap / manaCap — derived from strength / intelligence', () => {
  it('rage cap scales with strength', () => {
    expect(rageCap(0)).toBeLessThan(rageCap(20))
    expect(rageCap(20)).toBeGreaterThan(rageCap(10))
  })

  it('mana cap scales with intelligence', () => {
    expect(manaCap(0)).toBeLessThan(manaCap(20))
    expect(manaCap(20)).toBeGreaterThan(manaCap(10))
  })

  it('caps are non-negative integers', () => {
    expect(Number.isInteger(rageCap(7))).toBe(true)
    expect(rageCap(0)).toBeGreaterThanOrEqual(0)
    expect(Number.isInteger(manaCap(7))).toBe(true)
    expect(manaCap(0)).toBeGreaterThanOrEqual(0)
  })
})

// ── startingCombatState ─────────────────────────────────────────────
describe('startingCombatState — runtime state from stats', () => {
  it('starts full hp and full resources at their derived caps', () => {
    const s: CombatState = startingCombatState(baseStats({ strength: 20, intelligence: 20, maxHp: 80 }))
    expect(s.hp).toBe(80)
    expect(s.rage).toBe(rageCap(20))
    expect(s.mana).toBe(manaCap(20))
  })
})

// ── applyDamage / isDead ────────────────────────────────────────────
describe('applyDamage / isDead — HP + death helpers', () => {
  it('subtracts damage and never drops below zero', () => {
    expect(applyDamage(30, 12)).toBe(18)
    expect(applyDamage(10, 999)).toBe(0)
  })

  it('isDead is true only at or below zero hp', () => {
    expect(isDead(1)).toBe(false)
    expect(isDead(0)).toBe(true)
    expect(isDead(-5)).toBe(true)
  })
})

// ── resolveAttack: regular attacks ──────────────────────────────────
describe('resolveAttack — regular (free) attacks', () => {
  it('regular physical melee fires and spends no resource', () => {
    const r = resolveAttack({
      attacker: baseStats(),
      defender: baseStats(),
      attack: attack({ tier: 'regular', school: 'physical', range: 'melee' }),
      attackerWeapon: sword(),
    })
    expect(r.fired).toBe(true)
    expect(r.resource).toBeNull() // regular spends nothing
    expect(r.resourceSpent).toBe(0)
    expect(r.damage).toBeGreaterThan(0)
  })

  it('regular damage = base regular multiplier (no special bonus)', () => {
    const r = resolveAttack({
      attacker: baseStats(),
      defender: baseStats({ defense: 0 }),
      attack: attack({ tier: 'regular' }),
      attackerWeapon: sword(),
    })
    // physical = (weaponBaseDmg + strengthEff) * REGULAR; def 0 → unmitigated
    const strengthEff = 10 + 3 // sword strengthBonus
    expect(r.damage).toBe(Math.round((12 + strengthEff) * REGULAR_MULTIPLIER))
  })
})

// ── resolveAttack: physical vs magical scaling ──────────────────────
describe('resolveAttack — physical vs magical schools', () => {
  it('strength increases physical damage', () => {
    const weak = resolveAttack({
      attacker: baseStats({ strength: 5 }),
      defender: baseStats({ defense: 0 }),
      attack: attack(),
      attackerWeapon: sword(),
    })
    const strong = resolveAttack({
      attacker: baseStats({ strength: 25 }),
      defender: baseStats({ defense: 0 }),
      attack: attack(),
      attackerWeapon: sword(),
    })
    expect(strong.damage).toBeGreaterThan(weak.damage)
  })

  it('intelligence increases magical damage', () => {
    const weak = resolveAttack({
      attacker: baseStats({ intelligence: 5 }),
      defender: baseStats({ defense: 0 }),
      attack: attack({ school: 'magical', range: 'ranged' }),
      attackerWeapon: staff(),
    })
    const smart = resolveAttack({
      attacker: baseStats({ intelligence: 25 }),
      defender: baseStats({ defense: 0 }),
      attack: attack({ school: 'magical', range: 'ranged' }),
      attackerWeapon: staff(),
    })
    expect(smart.damage).toBeGreaterThan(weak.damage)
  })

  it('strength does NOT scale magical damage (school isolation)', () => {
    const lowStr = resolveAttack({
      attacker: baseStats({ strength: 1, intelligence: 10 }),
      defender: baseStats({ defense: 0 }),
      attack: attack({ school: 'magical', range: 'ranged' }),
      attackerWeapon: staff(),
    })
    const highStr = resolveAttack({
      attacker: baseStats({ strength: 99, intelligence: 10 }),
      defender: baseStats({ defense: 0 }),
      attack: attack({ school: 'magical', range: 'ranged' }),
      attackerWeapon: staff(),
    })
    expect(highStr.damage).toBe(lowStr.damage)
  })
})

// ── resolveAttack: defense mitigation ───────────────────────────────
describe('resolveAttack — defense mitigates melee physical only', () => {
  it('defense reduces incoming melee physical damage', () => {
    const noDef = resolveAttack({
      attacker: baseStats(),
      defender: baseStats({ defense: 0 }),
      attack: attack({ school: 'physical', range: 'melee' }),
      attackerWeapon: sword(),
    })
    const highDef = resolveAttack({
      attacker: baseStats(),
      defender: baseStats({ defense: 30 }),
      attack: attack({ school: 'physical', range: 'melee' }),
      attackerWeapon: sword(),
    })
    expect(highDef.damage).toBeLessThan(noDef.damage)
  })

  it('melee physical damage floors at 1 even against huge defense', () => {
    const r = resolveAttack({
      attacker: baseStats({ strength: 1 }),
      defender: baseStats({ defense: 9999 }),
      attack: attack({ school: 'physical', range: 'melee' }),
      attackerWeapon: sword(),
    })
    expect(r.damage).toBe(1)
  })

  it('defense does NOT reduce ranged physical damage', () => {
    const noDef = resolveAttack({
      attacker: baseStats(),
      defender: baseStats({ defense: 0 }),
      attack: attack({ school: 'physical', range: 'ranged' }),
      attackerWeapon: bow(),
    })
    const highDef = resolveAttack({
      attacker: baseStats(),
      defender: baseStats({ defense: 30 }),
      attack: attack({ school: 'physical', range: 'ranged' }),
      attackerWeapon: bow(),
    })
    expect(highDef.damage).toBe(noDef.damage)
  })

  it('defense does NOT reduce magical damage', () => {
    const noDef = resolveAttack({
      attacker: baseStats(),
      defender: baseStats({ defense: 0 }),
      attack: attack({ school: 'magical', range: 'ranged' }),
      attackerWeapon: staff(),
    })
    const highDef = resolveAttack({
      attacker: baseStats(),
      defender: baseStats({ defense: 30 }),
      attack: attack({ school: 'magical', range: 'ranged' }),
      attackerWeapon: staff(),
    })
    expect(highDef.damage).toBe(noDef.damage)
  })

  it('defender weapon/armor defense bonuses also mitigate melee physical', () => {
    const bare = resolveAttack({
      attacker: baseStats(),
      defender: baseStats({ defense: 0 }),
      attack: attack({ school: 'physical', range: 'melee' }),
      attackerWeapon: sword(),
    })
    const armored = resolveAttack({
      attacker: baseStats(),
      defender: baseStats({ defense: 0 }),
      defenderArmor: ironArmor(), // +8 defense
      attack: attack({ school: 'physical', range: 'melee' }),
      attackerWeapon: sword(),
    })
    expect(armored.damage).toBeLessThan(bare.damage)
  })
})

// ── resolveAttack: special attacks & resources ──────────────────────
describe('resolveAttack — special attacks consume rage / mana', () => {
  it('physical special hits harder than regular and consumes rage', () => {
    const reg = resolveAttack({
      attacker: baseStats(),
      defender: baseStats({ defense: 0 }),
      attack: attack({ tier: 'regular', school: 'physical', range: 'melee' }),
      attackerWeapon: sword(),
      attackerState: startingCombatState(baseStats()),
    })
    const spc = resolveAttack({
      attacker: baseStats(),
      defender: baseStats({ defense: 0 }),
      attack: attack({ tier: 'special', school: 'physical', range: 'melee' }),
      attackerWeapon: sword(),
      attackerState: startingCombatState(baseStats()),
    })
    expect(spc.fired).toBe(true)
    expect(spc.damage).toBeGreaterThan(reg.damage)
    expect(spc.resource).toBe('rage')
    expect(spc.resourceSpent).toBeGreaterThan(0)
    expect(spc.attackerStateAfter?.rage).toBe(
      startingCombatState(baseStats()).rage - spc.resourceSpent,
    )
  })

  it('magical special consumes mana, not rage', () => {
    const start = startingCombatState(baseStats())
    const spc = resolveAttack({
      attacker: baseStats(),
      defender: baseStats({ defense: 0 }),
      attack: attack({ tier: 'special', school: 'magical', range: 'ranged' }),
      attackerWeapon: staff(),
      attackerState: start,
    })
    expect(spc.fired).toBe(true)
    expect(spc.resource).toBe('mana')
    expect(spc.attackerStateAfter?.mana).toBe(start.mana - spc.resourceSpent)
    expect(spc.attackerStateAfter?.rage).toBe(start.rage) // rage untouched
  })

  it('special is BLOCKED with insufficient rage (deals no damage, no state change)', () => {
    const dry: CombatState = { hp: 100, rage: 0, mana: 50 }
    const r = resolveAttack({
      attacker: baseStats(),
      defender: baseStats({ defense: 0 }),
      attack: attack({ tier: 'special', school: 'physical', range: 'melee' }),
      attackerWeapon: sword(),
      attackerState: dry,
    })
    expect(r.fired).toBe(false)
    expect(r.reason).toBe('insufficient-rage')
    expect(r.damage).toBe(0)
    expect(r.resourceSpent).toBe(0)
    expect(r.attackerStateAfter).toEqual(dry) // unchanged
  })

  it('special is BLOCKED with insufficient mana', () => {
    const dry: CombatState = { hp: 100, rage: 50, mana: 0 }
    const r = resolveAttack({
      attacker: baseStats(),
      defender: baseStats({ defense: 0 }),
      attack: attack({ tier: 'special', school: 'magical', range: 'ranged' }),
      attackerWeapon: staff(),
      attackerState: dry,
    })
    expect(r.fired).toBe(false)
    expect(r.reason).toBe('insufficient-mana')
    expect(r.damage).toBe(0)
  })

  it('special FAILS clearly when no combat state is supplied', () => {
    const r = resolveAttack({
      attacker: baseStats(),
      defender: baseStats({ defense: 0 }),
      attack: attack({ tier: 'special', school: 'physical', range: 'melee' }),
      attackerWeapon: sword(),
      // no attackerState
    })
    expect(r.fired).toBe(false)
    expect(r.reason).toBe('insufficient-rage')
  })

  it('SPECIAL_MULTIPLIER is strictly greater than REGULAR_MULTIPLIER', () => {
    expect(SPECIAL_MULTIPLIER).toBeGreaterThan(REGULAR_MULTIPLIER)
  })
})

// ── resolveAttack: hp resolution & lethality ────────────────────────
describe('resolveAttack — defender hp resolution & lethality', () => {
  it('reports defender hp after the hit using defenderHp input', () => {
    const r = resolveAttack({
      attacker: baseStats(),
      defender: baseStats({ defense: 0 }),
      attack: attack(),
      attackerWeapon: sword(),
      defenderHp: 100,
    })
    expect(r.defenderHpAfter).toBe(100 - r.damage)
    expect(r.lethal).toBe(false)
  })

  it('defaults defenderHp to defender.maxHp when not supplied', () => {
    const r = resolveAttack({
      attacker: baseStats(),
      defender: baseStats({ defense: 0, maxHp: 60 }),
      attack: attack(),
      attackerWeapon: sword(),
    })
    expect(r.defenderHpAfter).toBe(60 - r.damage)
  })

  it('marks the hit lethal when damage meets or exceeds remaining hp', () => {
    const r = resolveAttack({
      attacker: baseStats({ strength: 50 }),
      defender: baseStats({ defense: 0 }),
      attack: attack({ tier: 'special' }),
      attackerWeapon: sword({ baseDamage: 100 }),
      attackerState: startingCombatState(baseStats({ strength: 50 })),
      defenderHp: 5,
    })
    expect(r.lethal).toBe(true)
    expect(r.defenderHpAfter).toBe(0)
  })

  it('a blocked special is never lethal and leaves hp untouched', () => {
    const r = resolveAttack({
      attacker: baseStats({ strength: 99 }),
      defender: baseStats({ defense: 0 }),
      attack: attack({ tier: 'special' }),
      attackerWeapon: sword({ baseDamage: 100 }),
      attackerState: { hp: 100, rage: 0, mana: 0 },
      defenderHp: 5,
    })
    expect(r.fired).toBe(false)
    expect(r.lethal).toBe(false)
    expect(r.defenderHpAfter).toBe(5)
  })
})

describe('resolveAttack — dodge & block (avoidance before damage)', () => {
  const hit = (): Attack => ({ school: 'physical', range: 'melee', tier: 'regular' })

  it('a dodged attack still fires but deals no damage and leaves HP intact', () => {
    const r = resolveAttack({
      attacker: baseStats(),
      defender: baseStats({ dodge: 100 }), // always dodges
      attack: hit(),
      attackerWeapon: sword(),
      defenderHp: 100,
      roll: () => 0, // 0 < dodge% ⇒ dodged
    })
    expect(r.fired).toBe(true)
    expect(r.dodged).toBe(true)
    expect(r.damage).toBe(0)
    expect(r.defenderHpAfter).toBe(100)
  })

  it("a shield's block negates the hit when not dodged", () => {
    const r = resolveAttack({
      attacker: baseStats(),
      defender: baseStats({ dodge: 0 }),
      attack: hit(),
      attackerWeapon: sword(),
      defenderWeapon: sword({ kind: 'shield', blockChance: 100 }),
      defenderHp: 100,
      roll: () => 0, // dodge 0<0 false → block 0<100 true
    })
    expect(r.dodged).toBeFalsy()
    expect(r.blocked).toBe(true)
    expect(r.damage).toBe(0)
    expect(r.defenderHpAfter).toBe(100)
  })

  it('lands normally when both rolls miss their chance', () => {
    const r = resolveAttack({
      attacker: baseStats(),
      defender: baseStats({ dodge: 30 }),
      attack: hit(),
      attackerWeapon: sword(),
      defenderWeapon: sword({ kind: 'shield', blockChance: 30 }),
      roll: () => 0.99, // 99 ≥ 30 for both
    })
    expect(r.dodged).toBeFalsy()
    expect(r.blocked).toBeFalsy()
    expect(r.damage).toBeGreaterThan(0)
  })

  it('treats missing dodge/blockChance as zero (no avoidance)', () => {
    const r = resolveAttack({
      attacker: baseStats(),
      defender: baseStats(), // dodge undefined
      attack: hit(),
      attackerWeapon: sword(),
      defenderWeapon: sword({ kind: 'shield' }), // blockChance undefined
      roll: () => 0,
    })
    expect(r.dodged).toBeFalsy()
    expect(r.blocked).toBeFalsy()
    expect(r.damage).toBeGreaterThan(0)
  })
})
