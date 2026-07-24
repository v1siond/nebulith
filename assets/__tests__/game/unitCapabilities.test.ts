/**
 * UNIT CAPABILITIES ARE SETTINGS, not kinds.
 *
 * "all units are the same … an enemy is just a tile, a unit, that can be attacked and is hostile to the
 *  player. hostile, can be attacked, etc are just settings" (Alexander).
 *
 * These tests prove the two capability gates that USED to be hard-coded to `kind === 'enemy'` now read a
 * per-unit SETTING (`hittable` / `hostile`) with a kind-derived DEFAULT, so:
 *   • existing saves are unchanged (an enemy defaults attackable + hostile; others default neither), AND
 *   • ANY unit becomes attackable / hostile via its setting — no per-kind capability code.
 *
 * Behaviour, not implementation: alongside the pure predicates we drive the REAL targeting (`findTarget`)
 * and the REAL combat tick (`stepCombat`) so the capability is proven genuinely honored, not hollow.
 */
import { isAttackable, isHostile } from '@/game/runtime/capabilities'
import { findTarget, isLivingEnemy, makeEnemyRuntime } from '@/game/runtime/targeting'
import { stepCombat, BARE_HANDS, type CombatStepInput } from '@/game/runtime/combat'
import { startingCombatState } from '@/game/combat'
import { makePlayer, makeEnemy, makeNpc, DEFAULT_PLAYER_STATS } from '@/game/entities'
import type { PlayerState } from '@/game/runtime/player'
import type { Entity } from '@/game/types'

const CS = 16
const playerAt = (col: number, row: number, facing: PlayerState['facing']): PlayerState => ({
  x: col * CS + CS / 2, z: row * CS + CS / 2, facing, moving: false, frame: 0,
})

describe('capabilities — isAttackable is the `hittable` SETTING, defaulted by kind', () => {
  it('defaults: enemy attackable, npc + player NOT (existing saves unchanged)', () => {
    expect(isAttackable(makeEnemy('e', 0, 0, 'goblin'))).toBe(true)
    expect(isAttackable(makeNpc('n', 0, 0))).toBe(false)
    expect(isAttackable(makePlayer('p', 0, 0))).toBe(false)
  })

  it('the setting OVERRIDES the kind default in BOTH directions', () => {
    expect(isAttackable({ ...makeNpc('n', 0, 0), hittable: true })).toBe(true) // a peaceful merchant made attackable
    expect(isAttackable({ ...makeEnemy('e', 0, 0, 'goblin'), hittable: false })).toBe(false) // a passive-scenery enemy
    expect(isAttackable({ ...makePlayer('p', 0, 0), hittable: true })).toBe(true) // even the player, via the setting
  })
})

describe('capabilities — isHostile is the `hostile` SETTING, defaulted by kind', () => {
  it('defaults: enemy hostile, npc + player NOT', () => {
    expect(isHostile(makeEnemy('e', 0, 0, 'goblin'))).toBe(true)
    expect(isHostile(makeNpc('n', 0, 0))).toBe(false)
    expect(isHostile(makePlayer('p', 0, 0))).toBe(false)
  })

  it('the setting decouples HOSTILE from ATTACKABLE — a unit can be hittable but peaceful', () => {
    const peacefulTarget: Entity = { ...makeNpc('n', 0, 0), hittable: true, hostile: false }
    expect(isAttackable(peacefulTarget)).toBe(true)
    expect(isHostile(peacefulTarget)).toBe(false)
  })
})

describe('capabilities — targeting honors `hittable` (a non-enemy unit becomes attackable via its setting)', () => {
  it('findTarget selects a hittable NPC standing adjacent, and ignores a plain (non-hittable) NPC', () => {
    const hostileNpc: Entity = { ...makeNpc('friend', 10, 10), hittable: true }
    const plainNpc = makeNpc('plain', 10, 10)
    const player = playerAt(9, 10, 'right') // one cell to the NPC's left, facing it

    expect(findTarget(player, [hostileNpc], makeEnemyRuntime(), CS, true, 1)?.id).toBe('friend')
    expect(findTarget(player, [plainNpc], makeEnemyRuntime(), CS, true, 1)).toBeNull()
  })

  it('isLivingEnemy (the targeting gate) treats a hittable NPC as a living target, a plain one as not', () => {
    expect(isLivingEnemy({ ...makeNpc('friend', 5, 5), hittable: true }, makeEnemyRuntime())).toBe(true)
    expect(isLivingEnemy(makeNpc('plain', 5, 5), makeEnemyRuntime())).toBe(false)
    expect(isLivingEnemy(makePlayer('p', 5, 5), makeEnemyRuntime())).toBe(false)
  })
})

describe('capabilities — the combat runtime gives any ATTACKABLE unit a real combat state (not hollow)', () => {
  const baseInput = (entities: Entity[]): CombatStepInput => ({
    player: playerAt(0, 0, 'down'),
    entities,
    runtime: makeEnemyRuntime(),
    playerCombat: startingCombatState(DEFAULT_PLAYER_STATS),
    playerWeapon: BARE_HANDS,
    playerArmor: null,
    playerStats: DEFAULT_PLAYER_STATS,
    hitMarkers: [],
    cellSize: CS,
    use2D: true,
    attack: false,
    special: false,
    now: 1000,
  })

  it('an attackable NPC receives a combat state after a tick, so it is genuinely damageable', () => {
    const attackableNpc: Entity = { ...makeNpc('friend', 20, 20), hittable: true }
    const input = baseInput([attackableNpc])
    stepCombat(input)
    expect(input.runtime.combat.has('friend')).toBe(true)
  })

  it('the PLAYER never gets an enemy combat state (it is not attackable by default)', () => {
    const input = baseInput([makePlayer('p', 20, 20)])
    stepCombat(input)
    expect(input.runtime.combat.has('p')).toBe(false)
  })

  it('a plain (non-hittable) NPC gets no combat state', () => {
    const input = baseInput([makeNpc('plain', 20, 20)])
    stepCombat(input)
    expect(input.runtime.combat.has('plain')).toBe(false)
  })
})
