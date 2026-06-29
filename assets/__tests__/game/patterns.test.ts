import {
  buildBoxPatrol,
  appendWaypoint,
  setMovementMode,
  clearWaypoints,
  buildStepList,
  addMovementStep,
  removeMovementStep,
  updateMovementStep,
  setStepDelay,
  MIN_ATTACK_COOLDOWN_MS,
  // enemy attack patterns (multi-attack, sequential/random)
  DEFAULT_ENEMY_ATTACK,
  DEFAULT_ENEMY_ATTACK_PATTERN,
  defaultEnemyAttack,
  makeEnemyAttack,
  enemyAttackFromAbility,
  animationRange,
  ENEMY_ATTACK_PRESETS,
  buildAttackPattern,
  setAttackPatternMode,
  addEnemyAttack,
  removeEnemyAttack,
  updateEnemyAttack,
  normalizeAttackPattern,
  nextEnemyAttack,
} from '@/game/patterns'
import { POWER_SHOT } from '@/game/abilities'
import type { AttackPattern, EnemyAttack } from '@/game/types'

describe('movement patterns', () => {
  it('buildBoxPatrol makes a 4-corner loop around the origin', () => {
    const p = buildBoxPatrol(5, 5, 'sequential', 2)
    expect(p.mode).toBe('sequential')
    expect(p.waypoints).toEqual([
      { col: 5, row: 5 },
      { col: 7, row: 5 },
      { col: 7, row: 7 },
      { col: 5, row: 7 },
    ])
  })

  it('appendWaypoint creates a pattern when none exists and appends to it', () => {
    const a = appendWaypoint(undefined, { col: 1, row: 2 }, 'random')
    expect(a).toEqual({ mode: 'random', waypoints: [{ col: 1, row: 2 }] })
    const b = appendWaypoint(a, { col: 3, row: 4 })
    expect(b.waypoints).toEqual([{ col: 1, row: 2 }, { col: 3, row: 4 }])
    expect(b.mode).toBe('random') // mode preserved
  })

  it('appendWaypoint ignores an immediate duplicate of the last waypoint', () => {
    const a = appendWaypoint(undefined, { col: 1, row: 1 })
    const b = appendWaypoint(a, { col: 1, row: 1 })
    expect(b.waypoints).toHaveLength(1)
  })

  it('appendWaypoint does not mutate the input pattern', () => {
    const a = { mode: 'sequential' as const, waypoints: [{ col: 0, row: 0 }] }
    appendWaypoint(a, { col: 9, row: 9 })
    expect(a.waypoints).toHaveLength(1)
  })

  it('setMovementMode flips the mode but keeps the waypoints', () => {
    const a = buildBoxPatrol(0, 0, 'sequential')
    const b = setMovementMode(a, 'random')
    expect(b.mode).toBe('random')
    expect(b.waypoints).toEqual(a.waypoints)
  })

  it('clearWaypoints empties the path but keeps the mode', () => {
    const a = buildBoxPatrol(0, 0, 'random')
    const b = clearWaypoints(a)
    expect(b.mode).toBe('random')
    expect(b.waypoints).toEqual([])
  })
})

describe('enemy attack patterns — building one attack', () => {
  it('makeEnemyAttack clamps damage (≥0) + cooldown (≥ floor) to whole numbers', () => {
    const a = makeEnemyAttack('melee', -5, 50)
    expect(a.damage).toBe(0)
    expect(a.cooldownMs).toBe(MIN_ATTACK_COOLDOWN_MS)
    expect(a.mode).toBe('melee')

    const b = makeEnemyAttack('ranged', 12.6, 1500.7, 'bolt')
    expect(b.damage).toBe(13)
    expect(b.cooldownMs).toBe(1501)
    expect(b.animation).toBe('bolt')
  })

  it('animationRange infers ranged from bolt/shot/magic animations, melee otherwise', () => {
    expect(animationRange('bolt')).toBe('ranged')
    expect(animationRange('piercing-shot')).toBe('ranged')
    expect(animationRange('lightning')).toBe('ranged')
    expect(animationRange('fire-slash')).toBe('melee')
    expect(animationRange('cleave')).toBe('melee')
  })

  it('enemyAttackFromAbility reuses the ability damage/cooldown/animation + infers range', () => {
    // POWER_SHOT is a piercing ranged ability → a ranged enemy attack carrying its numbers.
    const a = enemyAttackFromAbility(POWER_SHOT)
    expect(a.mode).toBe('ranged')
    expect(a.damage).toBe(POWER_SHOT.effect.damage)
    expect(a.cooldownMs).toBe(POWER_SHOT.cooldownMs)
    expect(a.animation).toBe(POWER_SHOT.animation)
    expect(a.abilityId).toBe(POWER_SHOT.id)
    expect(a.name).toBe(POWER_SHOT.name)
  })

  it('the presets include both melee and ranged ready-made attacks', () => {
    expect(ENEMY_ATTACK_PRESETS.some(a => a.mode === 'melee')).toBe(true)
    expect(ENEMY_ATTACK_PRESETS.some(a => a.mode === 'ranged')).toBe(true)
  })
})

describe('enemy attack patterns — editing the list (immutable)', () => {
  it('buildAttackPattern seeds a sequential single-melee pattern by default', () => {
    const p = buildAttackPattern()
    expect(p.mode).toBe('sequential')
    expect(p.attacks).toHaveLength(1)
    expect(p.attacks[0].mode).toBe('melee')
  })

  it('add / remove / update attacks immutably; damage + cooldown clamp', () => {
    const p = buildAttackPattern('sequential', [defaultEnemyAttack()])
    const added = addEnemyAttack(p, makeEnemyAttack('ranged', 8, 1500, 'bolt'))
    expect(added.attacks).toHaveLength(2)
    expect(p.attacks).toHaveLength(1) // original untouched

    const removed = removeEnemyAttack(added, 0)
    expect(removed.attacks).toHaveLength(1)
    expect(removed.attacks[0].mode).toBe('ranged') // first dropped

    const clamped = updateEnemyAttack(added, 0, { damage: -3, cooldownMs: 10 })
    expect(clamped.attacks[0].damage).toBe(0)
    expect(clamped.attacks[0].cooldownMs).toBe(MIN_ATTACK_COOLDOWN_MS)
    expect(added.attacks[0].cooldownMs).not.toBe(MIN_ATTACK_COOLDOWN_MS) // original untouched
  })

  it('setAttackPatternMode flips traversal but keeps the attacks', () => {
    const p = buildAttackPattern('sequential', [defaultEnemyAttack(), makeEnemyAttack('ranged', 5, 1500)])
    const flipped = setAttackPatternMode(p, 'random')
    expect(flipped.mode).toBe('random')
    expect(flipped.attacks).toEqual(p.attacks)
  })
})

describe('normalizeAttackPattern — back-compat + empty handling', () => {
  it('missing pattern → the engine default (one strength-only melee)', () => {
    expect(normalizeAttackPattern(undefined)).toEqual(DEFAULT_ENEMY_ATTACK_PATTERN)
    expect(DEFAULT_ENEMY_ATTACK_PATTERN.attacks[0]).toEqual(DEFAULT_ENEMY_ATTACK)
  })

  it('an EMPTY attack list normalizes to the default (never zero attacks)', () => {
    const empty: AttackPattern = { mode: 'sequential', attacks: [] }
    expect(normalizeAttackPattern(empty).attacks.length).toBeGreaterThan(0)
  })

  it('a LEGACY single { mode:melee|ranged, cooldownMs } save → a one-attack list', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const legacy = { mode: 'ranged', cooldownMs: 1500 } as any
    const norm = normalizeAttackPattern(legacy)
    expect(norm.mode).toBe('sequential') // traversal defaults to sequential
    expect(norm.attacks).toHaveLength(1)
    expect(norm.attacks[0].mode).toBe('ranged') // the legacy melee/ranged becomes the attack's range
    expect(norm.attacks[0].cooldownMs).toBe(1500)
  })

  it('a new multi-attack pattern passes through, coercing a bad mode to sequential', () => {
    const p = buildAttackPattern('random', [defaultEnemyAttack(), makeEnemyAttack('ranged', 5, 1500)])
    expect(normalizeAttackPattern(p).mode).toBe('random')
    expect(normalizeAttackPattern(p).attacks).toHaveLength(2)
  })
})

describe('nextEnemyAttack — the selector (sequential cycles, random in-set, empty → default)', () => {
  const melee = makeEnemyAttack('melee', 4, 900, 'cleave')
  const ranged = makeEnemyAttack('ranged', 8, 1500, 'bolt')
  const third = makeEnemyAttack('melee', 12, 1200, 'fire-slash')

  it('SEQUENTIAL cycles through every attack in order, then repeats', () => {
    const p = buildAttackPattern('sequential', [melee, ranged, third])
    const seq = [0, 1, 2, 3, 4, 5].map(fireCount => nextEnemyAttack(p, { fireCount }))
    expect(seq.map(a => a.mode)).toEqual([
      'melee', 'ranged', 'melee', // 0,1,2
      'melee', 'ranged', 'melee', // 3,4,5 → wraps back to the start
    ])
    // every attack in the list is hit within one cycle (no attack is skipped)
    expect(new Set([seq[0], seq[1], seq[2]]).size).toBe(3)
  })

  it('SEQUENTIAL with one attack always returns that attack (the default-pattern case)', () => {
    const p = buildAttackPattern('sequential', [melee])
    expect(nextEnemyAttack(p, { fireCount: 0 })).toEqual(melee)
    expect(nextEnemyAttack(p, { fireCount: 7 })).toEqual(melee)
  })

  it('RANDOM always returns an attack from the set (drives a controllable RNG across the range)', () => {
    const list: EnemyAttack[] = [melee, ranged, third]
    const p = buildAttackPattern('random', list)
    // sweep the rng across [0,1) — every pick must be one of the authored attacks
    const picks = [0, 0.34, 0.5, 0.99].map(r => nextEnemyAttack(p, { fireCount: 0, rng: () => r }))
    picks.forEach(pick => expect(list).toContainEqual(pick))
    expect(nextEnemyAttack(p, { fireCount: 0, rng: () => 0 })).toEqual(melee) // low → first
    expect(nextEnemyAttack(p, { fireCount: 0, rng: () => 0.999 })).toEqual(third) // high → last
  })

  it('an EMPTY / missing pattern falls back to the engine default attack', () => {
    expect(nextEnemyAttack(undefined, { fireCount: 0 })).toEqual(DEFAULT_ENEMY_ATTACK)
    expect(nextEnemyAttack({ mode: 'sequential', attacks: [] }, { fireCount: 3 })).toEqual(DEFAULT_ENEMY_ATTACK)
  })
})

describe('step-list movement helpers', () => {
  it('buildStepList seeds a 4-direction run list with the given mode', () => {
    const p = buildStepList('random')
    expect(p.mode).toBe('random')
    expect(p.steps?.map(s => s.dir)).toEqual(['right', 'left', 'up', 'down'])
    expect(p.steps?.every(s => s.cells === 5)).toBe(true)
  })

  it('setMovementMode PRESERVES the steps (regression: it used to drop them)', () => {
    const p = buildStepList('sequential')
    const flipped = setMovementMode(p, 'random')
    expect(flipped.mode).toBe('random')
    expect(flipped.steps).toEqual(p.steps)
  })

  it('add / remove / update steps immutably; cells clamp to ≥1', () => {
    const p = buildStepList('sequential')
    const added = addMovementStep(p, { dir: 'up', cells: 2 })
    expect(added.steps).toHaveLength(5)
    expect(p.steps).toHaveLength(4) // original untouched

    const removed = removeMovementStep(added, 0)
    expect(removed.steps).toHaveLength(4)
    expect(removed.steps?.[0].dir).toBe('left') // first dropped

    const clamped = updateMovementStep(p, 0, { cells: 0 })
    expect(clamped.steps?.[0].cells).toBe(1) // clamped up to a minimum of 1
  })

  it('setStepDelay clamps to a whole non-negative number', () => {
    expect(setStepDelay(buildStepList('random'), -50).delayMs).toBe(0)
    expect(setStepDelay(buildStepList('random'), 1234.7).delayMs).toBe(1235)
  })
})
