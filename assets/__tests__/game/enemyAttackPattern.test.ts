import { applyEnemyRetaliation, type CombatStepInput } from '@/game/runtime/combat'
import { makeEnemyRuntime, type EnemyRuntime } from '@/game/runtime/targeting'
import { type PlayerState } from '@/game/runtime/player'
import { buildAttackPattern, makeEnemyAttack } from '@/game/patterns'
import type { AttackAnim } from '@/engine/attackAnimations'
import type { Entity, Stats, Weapon, CombatState, AttackPattern } from '@/game/types'

// ───────────────────────────────────────────────────────────────────────────
// The COMBAT TICK now drives enemy attacks from each enemy's pattern: it fires the
// NEXT attack (sequential cycle / random pick), applies that attack's damage, and
// spawns its animation (melee 'slash' vs ranged 'shot'). These tests drive the REAL
// applyEnemyRetaliation and assert an enemy with a [melee, ranged] list visibly
// alternates a swing and a bolt — proving enemies use melee AND ranged from a pattern.
// ───────────────────────────────────────────────────────────────────────────

const CS = 16

const playerStats = (over: Partial<Stats> = {}): Stats => ({
  strength: 10,
  intelligence: 10,
  defense: 0, // no mitigation, so a melee hit lands its full strength + weapon base
  maxHp: 100,
  dodge: 0, // never dodge — deterministic
  ...over,
})

const bareHands = (): Weapon => ({
  id: 'w-bare',
  kind: 'unarmed',
  name: 'Bare Hands',
  baseDamage: 0,
  baseMagic: 0,
  baseDefense: 0,
  strengthBonus: 0,
  intBonus: 0,
  school: 'physical',
  range: 'melee',
  hands: 1,
  reachCells: 1,
})

/** A player standing at the centre of (col,row). */
const playerAt = (col: number, row: number): PlayerState => ({
  x: col * CS + CS / 2,
  z: row * CS + CS / 2,
  facing: 'left',
  moving: false,
  frame: 0,
})

/** An enemy at (col,row) with an attack pattern + strong enough to deal visible damage. */
const enemyAt = (col: number, row: number, attack?: AttackPattern): Entity => ({
  id: 'e1',
  kind: 'enemy',
  col,
  row,
  baseStats: { strength: 20, intelligence: 0, defense: 0, maxHp: 100 },
  attack,
})

/** Build a combat-step input wired for retaliation only (player attack fields left idle). */
const stepInput = (
  player: PlayerState,
  entity: Entity,
  runtime: EnemyRuntime,
  now: number,
  anims: AttackAnim[],
  playerCombat: CombatState,
): CombatStepInput & { playerCombat: CombatState } => ({
  player,
  entities: [entity],
  runtime,
  playerCombat,
  playerWeapon: bareHands(),
  playerArmor: null,
  playerStats: playerStats(),
  hitMarkers: [],
  cellSize: CS,
  use2D: true,
  attack: false,
  special: false,
  now,
  anims,
})

describe('applyEnemyRetaliation — fires the NEXT attack from the enemy pattern', () => {
  it('a [melee, ranged] SEQUENTIAL pattern alternates a slash then a bolt', () => {
    const pattern = buildAttackPattern('sequential', [
      makeEnemyAttack('melee', 5, 900, 'cleave'),
      makeEnemyAttack('ranged', 8, 1500, 'bolt'),
    ])
    const enemy = enemyAt(10, 10, pattern)
    const player = playerAt(11, 10) // adjacent → in melee reach AND within ranged reach
    const runtime = makeEnemyRuntime()
    const anims: AttackAnim[] = []
    let combat: CombatState = { hp: 100, rage: 0, mana: 0 }

    // tick 1 (fireCount 0 → melee): a 'slash' animation, melee damage applied
    combat = applyEnemyRetaliation(stepInput(player, enemy, runtime, 0, anims, combat))
    expect(anims).toHaveLength(1)
    expect(anims[0].kind).toBe('slash')
    expect(runtime.attackFireCount.get('e1')).toBe(1)
    expect(combat.hp).toBeLessThan(100) // it hit us

    // tick 2 (fireCount 1 → ranged): now past the ranged attack's 1500ms cooldown → a 'shot'
    combat = applyEnemyRetaliation(stepInput(player, enemy, runtime, 2000, anims, combat))
    expect(anims).toHaveLength(2)
    expect(anims[1].kind).toBe('shot')
    expect(runtime.attackFireCount.get('e1')).toBe(2)

    // the two swings used the two DIFFERENT animations → both melee and ranged fired from the list
    expect(anims.map(a => a.kind)).toEqual(['slash', 'shot'])
  })

  it('tints the swing/bolt with the chosen attack animation', () => {
    const pattern = buildAttackPattern('sequential', [makeEnemyAttack('ranged', 8, 1500, 'bolt')])
    const enemy = enemyAt(10, 10, pattern)
    const runtime = makeEnemyRuntime()
    const anims: AttackAnim[] = []
    applyEnemyRetaliation(stepInput(playerAt(11, 10), enemy, runtime, 0, anims, { hp: 100, rage: 0, mana: 0 }))
    expect(anims[0].kind).toBe('shot')
    expect(anims[0].tint).toBeDefined() // recolored to the 'bolt' tint
  })

  it('respects per-attack cooldown — it will NOT fire the next attack before its cooldown elapses', () => {
    const pattern = buildAttackPattern('sequential', [
      makeEnemyAttack('melee', 5, 900, 'cleave'),
      makeEnemyAttack('ranged', 8, 1500, 'bolt'),
    ])
    const enemy = enemyAt(10, 10, pattern)
    const player = playerAt(11, 10)
    const runtime = makeEnemyRuntime()
    const anims: AttackAnim[] = []
    let combat: CombatState = { hp: 100, rage: 0, mana: 0 }

    combat = applyEnemyRetaliation(stepInput(player, enemy, runtime, 0, anims, combat))
    expect(anims).toHaveLength(1) // first swing fires (no prior cooldown)

    // only 100ms later — the next attack (ranged, cd 1500) is still on cooldown → no new swing
    combat = applyEnemyRetaliation(stepInput(player, enemy, runtime, 100, anims, combat))
    expect(anims).toHaveLength(1)
    expect(runtime.attackFireCount.get('e1')).toBe(1) // cycle did not advance
  })

  it('an enemy with NO authored pattern falls back to a single melee (no regress)', () => {
    const enemy = enemyAt(10, 10) // no attack pattern
    const player = playerAt(11, 10)
    const runtime = makeEnemyRuntime()
    const anims: AttackAnim[] = []
    let combat: CombatState = { hp: 100, rage: 0, mana: 0 }

    combat = applyEnemyRetaliation(stepInput(player, enemy, runtime, 0, anims, combat))
    combat = applyEnemyRetaliation(stepInput(player, enemy, runtime, 5000, anims, combat))
    expect(anims.map(a => a.kind)).toEqual(['slash', 'slash']) // always melee, never a bolt
    expect(combat.hp).toBeLessThan(100)
  })

  it('a melee attack does NOT fire when the player is out of melee reach', () => {
    const pattern = buildAttackPattern('sequential', [makeEnemyAttack('melee', 5, 900, 'cleave')])
    const enemy = enemyAt(10, 10, pattern)
    const player = playerAt(15, 10) // 5 cells away — well beyond melee adjacency
    const runtime = makeEnemyRuntime()
    const anims: AttackAnim[] = []
    applyEnemyRetaliation(stepInput(player, enemy, runtime, 0, anims, { hp: 100, rage: 0, mana: 0 }))
    expect(anims).toHaveLength(0)
    expect(runtime.attackFireCount.get('e1')).toBeUndefined()
  })

  it('a ranged attack reaches a distant player that a melee attack could not', () => {
    const pattern = buildAttackPattern('sequential', [makeEnemyAttack('ranged', 8, 1500, 'bolt')])
    const enemy = enemyAt(10, 10, pattern)
    const player = playerAt(14, 10) // 4 cells away — within the default ranged reach
    const runtime = makeEnemyRuntime()
    const anims: AttackAnim[] = []
    const combat = applyEnemyRetaliation(stepInput(player, enemy, runtime, 0, anims, { hp: 100, rage: 0, mana: 0 }))
    expect(anims).toHaveLength(1)
    expect(anims[0].kind).toBe('shot')
    expect(combat.hp).toBeLessThan(100)
  })
})
