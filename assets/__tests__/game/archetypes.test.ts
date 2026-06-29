import {
  ENEMY_ARCHETYPES,
  ENEMY_ARCHETYPE_IDS,
  getArchetype,
  isArchetypeId,
  buildArchetypeProfile,
  type EnemyArchetypeId,
} from '@/game/archetypes'
import { nextEnemyAttack } from '@/game/patterns'
import { makeEnemy, DEFAULT_ENEMY_STATS } from '@/game/entities'
import { scatterEntities, archetypeForEnemyType, ENEMY_TYPES } from '@/game/spawner'
import type { AttackMode, EnemyAttack } from '@/game/types'

const ALL = ENEMY_ARCHETYPE_IDS
const modesOf = (attacks: EnemyAttack[]): AttackMode[] => attacks.map(a => a.mode)
const hasMode = (id: EnemyArchetypeId, mode: AttackMode): boolean =>
  ENEMY_ARCHETYPES[id].attack.attacks.some(a => a.mode === mode)

// deterministic LCG in [0,1) so a seed reproduces a run
const seeded = (seed: number): (() => number) => {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
const openGrid = (cols: number, rows: number): boolean[][] =>
  Array.from({ length: rows }, () => Array.from({ length: cols }, () => false))

describe('enemy archetype TABLE — distinct, meaningful profiles', () => {
  it('every roster id resolves to an archetype whose id matches its key', () => {
    expect(ALL.length).toBeGreaterThanOrEqual(5)
    for (const id of ALL) {
      const a = ENEMY_ARCHETYPES[id]
      expect(a).toBeDefined()
      expect(a.id).toBe(id)
      expect(a.name.length).toBeGreaterThan(0)
    }
  })

  it('no two archetypes share the same stat block (each is distinct)', () => {
    const sigs = ALL.map(id => {
      const s = ENEMY_ARCHETYPES[id].stats
      return `${s.maxHp}/${s.strength}/${s.intelligence}/${s.defense}/${s.dodge ?? 0}`
    })
    expect(new Set(sigs).size).toBe(ALL.length)
  })

  it('stats span a meaningful range (hp, defense, dodge, move speed all vary)', () => {
    const hp = ALL.map(id => ENEMY_ARCHETYPES[id].stats.maxHp)
    const def = ALL.map(id => ENEMY_ARCHETYPES[id].stats.defense)
    const dodge = ALL.map(id => ENEMY_ARCHETYPES[id].stats.dodge ?? 0)
    const speed = ALL.map(id => ENEMY_ARCHETYPES[id].moveDelayMs)
    expect(Math.max(...hp)).toBeGreaterThan(Math.min(...hp) * 2) // a real hp spread
    expect(Math.max(...def)).toBeGreaterThan(Math.min(...def))
    expect(Math.max(...dodge)).toBeGreaterThan(Math.min(...dodge))
    expect(Math.max(...speed)).toBeGreaterThan(Math.min(...speed)) // some lumber, some dart
    for (const id of ALL) expect(ENEMY_ARCHETYPES[id].stats.maxHp).toBeGreaterThan(0)
  })

  it('every archetype has a non-empty attack pattern the selector can fire', () => {
    for (const id of ALL) {
      const { attack } = ENEMY_ARCHETYPES[id]
      expect(attack.attacks.length).toBeGreaterThanOrEqual(1)
      const fired = nextEnemyAttack(attack, { fireCount: 0 })
      expect(fired).toBeDefined()
      expect(fired.cooldownMs).toBeGreaterThan(0)
    }
  })

  it('archetypes span melee AND ranged (and at least one mixes both)', () => {
    const meleeOnly = ALL.filter(id => hasMode(id, 'melee') && !hasMode(id, 'ranged'))
    const rangedOnly = ALL.filter(id => hasMode(id, 'ranged') && !hasMode(id, 'melee'))
    const mixed = ALL.filter(id => hasMode(id, 'melee') && hasMode(id, 'ranged'))
    expect(meleeOnly.length).toBeGreaterThanOrEqual(1) // e.g. grunt/brute/skirmisher
    expect(rangedOnly.length).toBeGreaterThanOrEqual(1) // e.g. archer/mage
    expect(mixed.length).toBeGreaterThanOrEqual(1) // the raider
  })

  it('ranged attacks keep their distance (reach > 1 cell)', () => {
    for (const id of ALL) {
      for (const atk of ENEMY_ARCHETYPES[id].attack.attacks) {
        if (atk.mode !== 'ranged') continue
        expect(atk.reachCells ?? 0).toBeGreaterThan(1)
      }
    }
  })
})

describe('archetype builder — yields the right hp / damage / pattern', () => {
  it('brute is a HIGH-hp, slow, heavy MELEE hitter', () => {
    const p = buildArchetypeProfile('brute')
    const grunt = buildArchetypeProfile('grunt')
    expect(p.stats.maxHp).toBeGreaterThan(grunt.stats.maxHp) // tankier than a grunt
    expect(p.moveDelayMs).toBe(Math.max(...ALL.map(id => ENEMY_ARCHETYPES[id].moveDelayMs))) // slowest mover
    const atk = nextEnemyAttack(p.attack, { fireCount: 0 })
    expect(atk.mode).toBe('melee')
    expect(atk.damage).toBeGreaterThanOrEqual(15) // a HEAVY swing
    expect(atk.cooldownMs).toBeGreaterThan(grunt.attack.attacks[0].cooldownMs) // and a SLOW one
  })

  it('skirmisher is a LOW-hp, fast, light-but-frequent MELEE attacker', () => {
    const p = buildArchetypeProfile('skirmisher')
    const grunt = buildArchetypeProfile('grunt')
    expect(p.stats.maxHp).toBeLessThan(grunt.stats.maxHp)
    expect(p.stats.dodge ?? 0).toBeGreaterThan(grunt.stats.dodge ?? 0) // nimble
    expect(p.moveDelayMs).toBe(Math.min(...ALL.map(id => ENEMY_ARCHETYPES[id].moveDelayMs))) // fastest mover
    const atk = nextEnemyAttack(p.attack, { fireCount: 0 })
    expect(atk.mode).toBe('melee')
    expect(atk.cooldownMs).toBeLessThan(grunt.attack.attacks[0].cooldownMs) // hits more often
  })

  it('archer fires a RANGED shot from distance', () => {
    const atk = nextEnemyAttack(buildArchetypeProfile('archer').attack, { fireCount: 0 })
    expect(atk.mode).toBe('ranged')
    expect(atk.reachCells ?? 0).toBeGreaterThan(1)
  })

  it('raider ALTERNATES a melee swing then a ranged shot (sequential)', () => {
    const { attack } = buildArchetypeProfile('raider')
    expect(attack.mode).toBe('sequential')
    expect(attack.attacks.length).toBe(2)
    expect(nextEnemyAttack(attack, { fireCount: 0 }).mode).toBe('melee')
    expect(nextEnemyAttack(attack, { fireCount: 1 }).mode).toBe('ranged')
    expect(nextEnemyAttack(attack, { fireCount: 2 }).mode).toBe('melee') // cycles
  })

  it('returns FRESH clones — mutating a profile never touches the shared table', () => {
    const a = buildArchetypeProfile('grunt')
    const b = buildArchetypeProfile('grunt')
    expect(a).not.toBe(b)
    expect(a.attack).not.toBe(b.attack)
    expect(a.attack.attacks[0]).not.toBe(b.attack.attacks[0])
    a.stats.maxHp = 9999
    a.attack.attacks[0].damage = 9999
    expect(ENEMY_ARCHETYPES.grunt.stats.maxHp).not.toBe(9999)
    expect(buildArchetypeProfile('grunt').stats.maxHp).not.toBe(9999)
    expect(buildArchetypeProfile('grunt').attack.attacks[0].damage).not.toBe(9999)
  })

  it('getArchetype / isArchetypeId narrow known ids and reject unknown ones', () => {
    expect(isArchetypeId('brute')).toBe(true)
    expect(isArchetypeId('dragon')).toBe(false)
    expect(isArchetypeId(undefined)).toBe(false)
    expect(getArchetype('archer')?.id).toBe('archer')
    expect(getArchetype('nope')).toBeUndefined()
  })
})

describe('makeEnemy — archetype wiring + back-compat default', () => {
  it('with NO archetype keeps the legacy defaults (flat stats, no authored attack)', () => {
    const e = makeEnemy('e1', 0, 0, 'goblin')
    expect(e.baseStats).toEqual(DEFAULT_ENEMY_STATS)
    expect(e.attack).toBeUndefined() // → engine single-melee fallback (no regression)
  })

  it('with an archetype stamps that archetype stats + a real attack pattern', () => {
    const e = makeEnemy('e1', 0, 0, 'skeleton', { archetype: 'brute' })
    expect(e.baseStats).toEqual(ENEMY_ARCHETYPES.brute.stats)
    expect(e.attack).toBeDefined()
    expect(nextEnemyAttack(e.attack, { fireCount: 0 }).damage).toBe(
      nextEnemyAttack(ENEMY_ARCHETYPES.brute.attack, { fireCount: 0 }).damage,
    )
  })

  it('an explicit stats override still wins over the archetype stats', () => {
    const e = makeEnemy('boss', 0, 0, 'skeleton', { archetype: 'brute', stats: { maxHp: 500 } })
    expect(e.baseStats.maxHp).toBe(500) // override wins
    expect(e.baseStats.strength).toBe(ENEMY_ARCHETYPES.brute.stats.strength) // rest from archetype
  })
})

describe('spawner — enemies vary by type via archetypes', () => {
  it('maps each roster type to a distinct archetype, unknown → undefined', () => {
    const ids = ENEMY_TYPES.map(t => archetypeForEnemyType(t))
    expect(ids.every(Boolean)).toBe(true)
    expect(new Set(ids).size).toBe(ENEMY_TYPES.length) // four types, four DISTINCT archetypes
    expect(archetypeForEnemyType('totally-made-up')).toBeUndefined()
  })

  it('scattered enemies carry attack patterns and span more than one stat profile', () => {
    const ents = scatterEntities({ collision: openGrid(60, 60), count: 16, rng: seeded(99) })
    expect(ents.length).toBeGreaterThan(0)
    for (const e of ents) {
      expect(e.attack).toBeDefined() // every scattered enemy got an archetype pattern
      expect(e.attack!.attacks.length).toBeGreaterThanOrEqual(1)
    }
    const hpProfiles = new Set(ents.map(e => e.baseStats.maxHp))
    expect(hpProfiles.size).toBeGreaterThanOrEqual(2) // not all identical anymore
    const modes = new Set(ents.flatMap(e => modesOf(e.attack!.attacks)))
    expect(modes.has('melee') && modes.has('ranged')).toBe(true) // both fighting styles present
  })

  it('scattered enemies inherit the archetype move cadence on their patrol', () => {
    const ents = scatterEntities({ collision: openGrid(60, 60), count: 16, rng: seeded(7) })
    const delays = new Set(ents.map(e => e.movement?.delayMs).filter(d => d != null))
    expect(delays.size).toBeGreaterThanOrEqual(2) // brutes lumber, skirmishers dart
  })
})
