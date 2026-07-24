// Pure combat tick: the player attack, enemy retaliation from each enemy attack
// pattern, projectile resolution, and the per-frame runtime sync. Moved out of the
// game-engine page (stage 2). Pure — mutates only its passed-in args; no React/DOM.
import type { Entity, CombatState, Weapon, Armor, Stats, Attack, EnemyAttack } from '@/game/types'
import { deriveStats, startingCombatState, resolveAttack, applyDamage, isDead } from '@/game/combat'
import { isRespawned, DEFAULT_PLAYER_STATS } from '@/game/entities'
import { isRanged, weaponReach } from '@/game/weapons'
import { projectileArrived, resolveImpact, type Projectile } from '@/game/projectiles'
import { nextEnemyAttack } from '@/game/patterns'
import { abilityReady, ABILITY_TINT, type AbilityBinding, type AbilityAnimation } from '@/game/abilities'
import { weaponAnimKind, ATTACK_ANIM_MS, type AttackAnim, type AttackAnimKind } from '@/engine/attackAnimations'
import { weaponPose } from '@/engine/entityArt'
import { aimDelta, type PlayerState } from './player'
import { findTarget, isLivingEnemy, isAdjacentToPlayer, RANGED_RANGE, type EnemyRuntime } from './targeting'
import { isAttackable, isHostile } from './capabilities'

/** The player's DEFAULT melee — bare fists. The player starts unarmed (no weapon auto-equipped):
 *  weaponGlyph('unarmed') returns '' so NO blade is drawn, but the swing, the 1.5s cadence, and
 *  the reach (1 cell) all still resolve. Equip a weapon to show its blade. */
export const BARE_HANDS: Weapon = {
  id: 'bare-hands',
  kind: 'unarmed',
  name: 'Bare Hands',
  baseDamage: 4,
  baseMagic: 0,
  baseDefense: 0,
  strengthBonus: 0,
  intBonus: 0,
  school: 'physical',
  range: 'melee',
  hands: 1,
  reachCells: 1,
}

/** The two attacks bound to input: `f` = free regular, `g` = rage-fueled special. */
const REGULAR_MELEE: Attack = { school: 'physical', range: 'melee', tier: 'regular' }
const SPECIAL_MELEE: Attack = { school: 'physical', range: 'melee', tier: 'special' }

/** The two combat-engine attack shapes an enemy swing resolves through (resolveAttack reads
 *  school/range). Which one (and its damage/cooldown/tint) is chosen each tick comes from the
 *  enemy's attack PATTERN — see nextEnemyAttack + applyEnemyRetaliation. */
const ENEMY_ATTACK: Attack = REGULAR_MELEE
const ENEMY_RANGED_ATTACK: Attack = { school: 'physical', range: 'ranged', tier: 'regular' }

/** "+dmg" hit markers float for this long before fading. */
export const HIT_MARKER_MS = 650

/** A floating damage number anchored to a cell, shown briefly after a hit. */
export interface HitMarker {
  col: number
  row: number
  amount: number
  bornAt: number
  /** who took the hit — colors the marker (enemy red vs player white). */
  target: 'enemy' | 'player'
}

/** Read-only snapshot of player combat for the HUD (mirrored to React state). */
export interface PlayerHud {
  hp: number
  maxHp: number
  rage: number
  rageCap: number
  mana: number
  manaCap: number
}

/**
 * Ensure every current enemy has a runtime CombatState, and prune state for
 * enemies that no longer exist. Returns nothing — mutates the runtime maps in
 * place (the loop owns them; this is the one sync point each frame).
 */
function syncEnemyRuntime(entities: readonly Entity[], runtime: EnemyRuntime): void {
  const live = new Set<string>()
  for (const entity of entities) {
    if (!isAttackable(entity)) continue // a combat participant is any ATTACKABLE unit (setting), not just kind==='enemy'
    live.add(entity.id)
    if (runtime.combat.has(entity.id)) continue
    runtime.combat.set(entity.id, startingCombatState(entity.baseStats))
  }
  pruneRuntimeMaps(runtime, live)
}

/** Drop runtime entries for ids no longer present (entity erased in the editor). */
function pruneRuntimeMaps(runtime: EnemyRuntime, live: ReadonlySet<string>): void {
  for (const id of runtime.combat.keys()) {
    if (live.has(id)) continue
    runtime.combat.delete(id)
    runtime.diedAt.delete(id)
    runtime.lastAttackAt.delete(id)
    runtime.attackFireCount.delete(id)
  }
}

/** Respawn any dead enemy whose timer has elapsed (full HP, timers cleared). */
function respawnElapsedEnemies(entities: readonly Entity[], runtime: EnemyRuntime, now: number): void {
  for (const entity of entities) {
    if (!isAttackable(entity)) continue // same participant set as syncEnemyRuntime; a unit with no respawnMs simply never comes back
    const diedAt = runtime.diedAt.get(entity.id)
    if (diedAt === undefined) continue
    if (!isRespawned(diedAt, entity.respawnMs, now)) continue
    runtime.combat.set(entity.id, startingCombatState(entity.baseStats))
    runtime.diedAt.delete(entity.id)
    runtime.lastAttackAt.delete(entity.id)
    runtime.attackFireCount.delete(entity.id) // restart its attack cycle on respawn
  }
}

/** Build the HUD snapshot (caps derived from effective stats) for React mirroring. */
export function playerHudFrom(baseStats: Stats, weapon: Weapon, state: CombatState): PlayerHud {
  const eff = deriveStats(baseStats, weapon)
  const full = startingCombatState(eff)
  return {
    hp: state.hp,
    maxHp: eff.maxHp,
    rage: state.rage,
    rageCap: full.rage,
    mana: state.mana,
    manaCap: full.mana,
  }
}

/** Inputs the per-frame combat step reads/owns. Keeps the loop call site flat. */
export interface CombatStepInput {
  player: PlayerState
  entities: readonly Entity[]
  runtime: EnemyRuntime
  playerCombat: CombatState
  playerWeapon: Weapon
  /** equipped armor folds its defense into the player when taking melee hits. */
  playerArmor: Armor | null
  /** the player's effective stats from their equipped loadout (gear str/int/defense
   *  + dodge). Drives both the player's attacks and their dodge on retaliation. */
  playerStats: Stats
  /** the player's equipped shield (if any) — gives a block% on retaliation. */
  playerShield?: Weapon
  hitMarkers: HitMarker[]
  cellSize: number
  use2D: boolean
  attack: boolean // edge-triggered: regular attack this frame
  special: boolean // edge-triggered: special attack this frame
  /** an ability fired this frame (key 1–4): a melee swing with the ability's damage + blade tint. */
  abilitySwing?: AbilitySwing
  now: number
  /** the loop's live attack-animation list; a landed hit pushes one. */
  anims?: AttackAnim[]
  /** the loop's live projectile list; a ranged attack pushes a travelling shot here. */
  projectiles?: Projectile[]
  /** per-projectile attacker context, so impact-time damage knows who fired + with what. */
  projectileCtx?: Map<string, ProjectileContext>
}

/** The attacker side of a projectile, captured at fire so the impact (resolved later,
 *  in tickProjectiles) can run resolveAttack. The attacker's live runtime state is read
 *  at impact, not stored here. */
export interface ProjectileContext {
  attackerStats: Stats
  attackerWeapon: Weapon
  attack: Attack
}

/** What the combat step produces back to the loop (player state may be replaced on death/spend). */
interface CombatStepResult {
  playerCombat: CombatState
  /** enemyType of every enemy the player killed THIS frame — feeds 'kill' quest objectives. */
  kills: string[]
}

/**
 * One combat tick: respawn timers, the player's attack (if pressed), enemy
 * retaliation, and player-death reset. Mutates `runtime`/`hitMarkers` in place
 * (the loop owns them) and returns the player's (possibly new) CombatState plus
 * the enemyTypes killed this frame so the loop can advance kill quests.
 */
export function stepCombat(input: CombatStepInput): CombatStepResult {
  const { entities, runtime, hitMarkers, now } = input
  syncEnemyRuntime(entities, runtime)
  respawnElapsedEnemies(entities, runtime, now)
  prunePlayerStartedMarkers(hitMarkers, now)

  const kills: string[] = []
  let playerCombat = applyPlayerAttack(input, kills)
  playerCombat = applyEnemyRetaliation({ ...input, playerCombat })
  playerCombat = resetPlayerIfDead(playerCombat)
  return { playerCombat, kills }
}

/** Drop hit markers older than their lifetime so the array stays bounded. */
function prunePlayerStartedMarkers(markers: HitMarker[], now: number): void {
  // Filter in place to avoid per-frame allocation churn.
  let write = 0
  for (let read = 0; read < markers.length; read++) {
    const m = markers[read]
    if (now - m.bornAt >= HIT_MARKER_MS) continue
    markers[write++] = m
  }
  markers.length = write
}

/** Spawn an attack animation — the SAME call for EVERY attacker (player, enemy, turret).
 *  This is the single bridge from the attack system to the animation system; firing any
 *  attack plays its animation through here. */
function spawnAttackAnim(
  anims: AttackAnim[] | undefined,
  fromX: number, fromZ: number, toX: number, toZ: number,
  kind: AttackAnimKind, now: number, glyph?: string, inHand?: boolean, tint?: string, animation?: AbilityAnimation,
): void {
  if (!anims) return
  anims.push({ kind, fromX, fromZ, toX, toZ, start: now, durationMs: ATTACK_ANIM_MS[kind], glyph, inHand, tint, animation })
}

/** A triggered ability's contribution to this frame's player attack: its authored damage (applied
 *  in place of the weapon's roll, per the data-driven model) and the blade tint for the swing. */
interface AbilitySwing {
  damage: number
  tint: string
}

/** Fire the first off-cooldown ability whose bound key is on its rising edge this frame. Keys come
 *  from the loadout (rebindable, not hardcoded). Mutates `keyState` (per-key prev-down) and
 *  `lastUsed` (per-ability-id clock) in place; returns the swing to apply, or undefined. */
export function triggerAbility(
  loadout: readonly AbilityBinding[],
  keys: Record<string, boolean>,
  keyState: Record<string, boolean>,
  lastUsed: Map<string, number>,
  now: number,
): AbilitySwing | undefined {
  let swing: AbilitySwing | undefined
  for (const binding of loadout) {
    const down = !!keys[binding.key]
    const rising = down && !keyState[binding.key]
    keyState[binding.key] = down
    if (swing || !rising) continue // edge-trigger; first ability to fire this frame wins
    const ability = binding.ability
    if (!abilityReady(ability, lastUsed.get(ability.id), now)) continue
    lastUsed.set(ability.id, now)
    swing = { damage: ability.effect.damage ?? 0, tint: ABILITY_TINT[ability.animation] }
  }
  return swing
}

/** ms a projectile spends travelling per cell — slow enough that an enemy can step off
 *  the impact cell to dodge it (the core of "resolve on impact, not on fire"). */
const PROJECTILE_MS_PER_CELL = 55

/** The glyph a projectile draws, by firing weapon kind: bow → arrow, gun → bullet, else
 *  a generic bolt. (Per-weapon arrow/bullet/bolt selection.) */
const PROJECTILE_GLYPHS: Partial<Record<string, string>> = { bow: '➤', gun: '•' }
function projectileGlyph(kind: string): string {
  return PROJECTILE_GLYPHS[kind] ?? '→'
}

let projectileSeq = 0

/**
 * Resolve the player's chosen attack against the current target, if any. The equipped
 * weapon drives everything: isRanged + weaponReach decide melee-vs-ranged and reach.
 *   - MELEE  → instant strike within reach; damage resolves now. On a lethal hit, records
 *     the death timestamp (respawn) AND pushes the enemy's `enemyType` into `kills`.
 *   - RANGED → spawns a travelling Projectile and returns; NO damage now. Impact (and its
 *     kill bookkeeping) is resolved later by tickProjectiles when the shot arrives.
 */
function applyPlayerAttack(input: CombatStepInput, kills: string[]): CombatState {
  const { player, entities, runtime, playerCombat, playerWeapon, hitMarkers, cellSize, use2D, attack, special, now } = input
  if (!attack && !special) return playerCombat

  // Melee-vs-ranged + reach come from the equipped weapon, not a hardcoded mode/range.
  const ranged = isRanged(playerWeapon)
  const reach = weaponReach(playerWeapon)
  const target = findTarget(player, entities, runtime, cellSize, use2D, reach)
  // Aim at an acquired target's cell; otherwise straight down the 8-way aim line. A RANGED shot
  // with no target flies its FULL reach, so a bow/gun covers the SAME distance in EVERY
  // direction (#53) — it used to die at the 1-cell faced cell, so an open-field shot barely
  // left the player. Melee keeps its whiff at the adjacent aimed cell. The aim is 8-way + in
  // grid space (#55), so projectiles + the swing fire along all 8 directions in both views.
  const [dCol, dRow] = aimDelta(player, use2D)
  const pCol = Math.floor(player.x / cellSize)
  const pRow = Math.floor(player.z / cellSize)
  const lineDist = ranged ? reach : 1
  const aimCol = target ? target.col : pCol + dCol * lineDist
  const aimRow = target ? target.row : pRow + dRow * lineDist

  // RANGED: loose a projectile aimed at the target's CURRENT cell and stop. Damage is
  // deferred to impact (tickProjectiles) — it misses if the target steps off that cell.
  if (ranged) {
    spawnProjectile(input, aimCol, aimRow, target, now)
    return playerCombat
  }

  // MELEE: resolve damage now if we hit something; the swing is shown either way below.
  let animKind = weaponAnimKind(playerWeapon.kind, playerWeapon.range)
  let nextState = playerCombat
  const targetState = target ? runtime.combat.get(target.id) : undefined
  if (target && targetState) {
    const chosen: Attack = { school: playerWeapon.school, range: playerWeapon.range, tier: special ? 'special' : 'regular' }
    const result = resolveAttack({
      attacker: input.playerStats,
      defender: target.baseStats,
      attack: chosen,
      attackerWeapon: playerWeapon,
      defenderHp: targetState.hp,
      attackerState: playerCombat,
    })
    if (result.fired) {
      // An ability swing deals its OWN authored damage (data-driven model), not the weapon roll —
      // but still respects the avoidance rolls (a dodged/blocked slash deals 0 either way).
      const landed = !result.dodged && !result.blocked
      const damage = input.abilitySwing && landed ? input.abilitySwing.damage : result.damage
      const hpAfter = applyDamage(targetState.hp, damage)
      runtime.combat.set(target.id, { ...targetState, hp: hpAfter })
      pushHitMarker(hitMarkers, target.col, target.row, damage, 'enemy', now)
      if (result.blocked) animKind = 'block'
      if (isDead(hpAfter)) recordEnemyDeath(runtime, target, kills, now)
      nextState = result.attackerStateAfter ?? playerCombat
    }
  }

  // ALWAYS show the swing — even a whiff. Shared spawn → same for every attacker.
  // melee → the single in-hand weapon swings (drawn by the player); ranged/magic keep their own anim.
  // An ability recolors that one swing (Fire Slash → red-orange blade); a basic 'f' stays steel.
  spawnAttackAnim(input.anims, player.x, player.z, aimCol * cellSize + cellSize / 2, aimRow * cellSize + cellSize / 2, animKind, now, player.weaponGlyph, animKind === 'slash', input.abilitySwing?.tint)
  return nextState
}

/** A killed enemy: stamp its death time (respawn) and report its type for kill quests. */
function recordEnemyDeath(runtime: EnemyRuntime, enemy: Entity, kills: string[], now: number): void {
  runtime.diedAt.set(enemy.id, now)
  kills.push(enemy.enemyType ?? 'enemy')
}

/** The cell a projectile actually LEAVES from: the shooter cell offset `muzzle` fraction toward the aim,
 *  so an arrow/shot emerges from the weapon's muzzle instead of the shooter's centre. `muzzle` null/absent
 *  → the shooter cell unchanged (melee weapons and any weapon without a muzzle pose). Pure. */
export function muzzleOrigin(fromCol: number, fromRow: number, aimCol: number, aimRow: number, muzzle?: number | null): { col: number; row: number } {
  const m = muzzle ?? 0
  return { col: fromCol + (aimCol - fromCol) * m, row: fromRow + (aimRow - fromRow) * m }
}

/** Loose a travelling projectile from the player toward (aimCol,aimRow). Stores the
 *  attacker context so the deferred impact (tickProjectiles) can run resolveAttack.
 *  A target-less shot (no enemy acquired) still flies — it just resolves to a miss. */
function spawnProjectile(input: CombatStepInput, aimCol: number, aimRow: number, target: Entity | null, now: number): void {
  const list = input.projectiles
  if (!list) return
  const { player, cellSize, playerWeapon, special } = input
  const fromCol = Math.floor(player.x / cellSize)
  const fromRow = Math.floor(player.z / cellSize)
  const dist = Math.max(1, Math.max(Math.abs(aimCol - fromCol), Math.abs(aimRow - fromRow)))
  // The shot leaves the weapon's muzzle (pose.muzzle) — absent in the seeds → the shooter cell, unchanged.
  const o = muzzleOrigin(fromCol, fromRow, aimCol, aimRow, weaponPose(playerWeapon.kind, 'emoji')?.muzzle)
  const id = `proj-${now}-${projectileSeq++}`
  list.push({
    id,
    fromCol: o.col, fromRow: o.row,
    toCol: aimCol, toRow: aimRow,
    targetId: target ? target.id : '',
    startMs: now,
    durationMs: Math.round(dist * PROJECTILE_MS_PER_CELL),
    glyph: projectileGlyph(playerWeapon.kind),
    power: playerWeapon.baseDamage,
  })
  input.projectileCtx?.set(id, {
    attackerStats: input.playerStats,
    attackerWeapon: playerWeapon,
    attack: { school: playerWeapon.school, range: playerWeapon.range, tier: special ? 'special' : 'regular' },
  })
}

/** Inputs for one projectile-resolution tick (mirrors CombatStepResult bookkeeping). */
interface ProjectileTickInput {
  projectiles: Projectile[]
  ctx: Map<string, ProjectileContext>
  entities: readonly Entity[]
  runtime: EnemyRuntime
  playerCombat: CombatState
  hitMarkers: HitMarker[]
  anims?: AttackAnim[]
  cellSize: number
  now: number
  /** RNG for the impact dodge/block rolls; defaults to Math.random. */
  rng?: () => number
}

/**
 * Advance active projectiles: any that have ARRIVED resolve against the target's CURRENT
 * cell (resolveImpact → hit/missed_moved/dodged/blocked), apply damage via resolveAttack on
 * a hit, drop a flourish, and are removed. In-flight projectiles are kept (drawn by render).
 * Returns the (possibly spent) player state + enemyTypes killed this tick for kill quests.
 */
export function tickProjectiles(input: ProjectileTickInput): { playerCombat: CombatState; kills: string[] } {
  const { projectiles, ctx, now } = input
  const rng = input.rng ?? Math.random
  const kills: string[] = []
  let playerCombat = input.playerCombat
  let write = 0
  for (let read = 0; read < projectiles.length; read++) {
    const p = projectiles[read]
    if (!projectileArrived(p, now)) { projectiles[write++] = p; continue }
    playerCombat = resolveProjectileImpact(p, ctx.get(p.id), input, playerCombat, kills, rng)
    ctx.delete(p.id)
  }
  projectiles.length = write
  return { playerCombat, kills }
}

/** Resolve a single arrived projectile. Returns the attacker's state (a special spends
 *  its resource on a landed hit). Pushes kills + a hit marker on damage, always a flourish. */
function resolveProjectileImpact(
  p: Projectile,
  context: ProjectileContext | undefined,
  env: ProjectileTickInput,
  playerCombat: CombatState,
  kills: string[],
  rng: () => number,
): CombatState {
  const { entities, runtime, hitMarkers, anims, cellSize, now } = env
  const target = entities.find(e => e.id === p.targetId)
  const targetState = target ? runtime.combat.get(target.id) : undefined

  // No live target (despawned / cosmetic shot) → fizzle with a flourish, no damage.
  if (!target || !targetState || !context || isDead(targetState.hp)) {
    spawnImpactFlourish(anims, p.toCol, p.toRow, cellSize, now)
    return playerCombat
  }

  const dodgeChance = (target.baseStats.dodge ?? 0) / 100
  const blockChance = (context.attackerWeapon.blockChance ?? 0) // enemies carry no shields → ~0
  const outcome = resolveImpact(p, { col: target.col, row: target.row }, blockChance, dodgeChance, rng)
  if (outcome !== 'hit') {
    spawnImpactFlourish(anims, p.toCol, p.toRow, cellSize, now)
    return playerCombat
  }

  // Confirmed hit: resolveImpact already arbitrated dodge/block, so feed resolveAttack a
  // roll that never re-triggers them (roll()*100 < pct is false at 1.0 for pct ≤ 100).
  const result = resolveAttack({
    attacker: context.attackerStats,
    defender: target.baseStats,
    attack: context.attack,
    attackerWeapon: context.attackerWeapon,
    defenderHp: targetState.hp,
    attackerState: playerCombat,
    roll: () => 1,
  })
  if (result.fired) {
    runtime.combat.set(target.id, { ...targetState, hp: result.defenderHpAfter })
    pushHitMarker(hitMarkers, target.col, target.row, result.damage, 'enemy', now)
    if (result.lethal) recordEnemyDeath(runtime, target, kills, now)
    playerCombat = result.attackerStateAfter ?? playerCombat
  }
  spawnImpactFlourish(anims, target.col, target.row, cellSize, now)
  return playerCombat
}

/** A short impact spark on a cell (reuses the 'block' burst frames; sits in place). */
function spawnImpactFlourish(anims: AttackAnim[] | undefined, col: number, row: number, cellSize: number, now: number): void {
  const x = col * cellSize + cellSize / 2
  const z = row * cellSize + cellSize / 2
  spawnAttackAnim(anims, x, z, x, z, 'block', now)
}

/**
 * Each living enemy fires the NEXT attack from its authored pattern (sequential cycle / random
 * pick — see nextEnemyAttack), if that attack is in range AND off cooldown. The chosen attack
 * drives EVERYTHING: melee vs ranged reach, its damage (the swing's weapon base), its cooldown,
 * and its animation tint — so an enemy with a [melee, ranged] list visibly alternates a slash and
 * a bolt. An enemy with no authored pattern falls back to a single strength-only melee (no regress).
 */
export function applyEnemyRetaliation(input: CombatStepInput & { playerCombat: CombatState }): CombatState {
  const { player, entities, runtime, playerWeapon, hitMarkers, cellSize, now } = input
  let playerCombat = input.playerCombat

  // The player's effective stats already fold in equipped gear (defense + dodge); a
  // shield adds a block%. resolveAttack rolls dodge then block before damage.
  const defenderStats: Stats = input.playerStats

  for (const entity of entities) {
    if (!isLivingEnemy(entity, runtime)) continue
    if (!isHostile(entity)) continue // only HOSTILE units retaliate — an attackable-but-peaceful unit won't hit back
    // The pattern decides the next attack (the cooldown gate uses THAT attack's cooldown).
    const fireCount = runtime.attackFireCount.get(entity.id) ?? 0
    const chosen = nextEnemyAttack(entity.attack, { fireCount })
    if (!withinAttackReach(player, entity, cellSize, chosen)) continue
    if (!offCooldown(runtime, entity, now, chosen)) continue

    const ranged = chosen.mode === 'ranged'
    const result = resolveAttack({
      attacker: entity.baseStats,
      defender: defenderStats,
      attack: ranged ? ENEMY_RANGED_ATTACK : ENEMY_ATTACK,
      attackerWeapon: enemyFist(entity, chosen),
      defenderWeapon: input.playerShield ?? playerWeapon,
      defenderHp: playerCombat.hp,
    })
    runtime.lastAttackAt.set(entity.id, now)
    runtime.attackFireCount.set(entity.id, fireCount + 1) // advance the sequential cycle
    // The enemy's swing/bolt animates too — attacks trigger animations for EVERY attacker. The
    // attack's animation recolors it (a fire bite burns orange, a frost bolt glows blue).
    const tint = chosen.animation ? ABILITY_TINT[chosen.animation] : undefined
    // Pass the ability ANIMATION too (not just its tint) so the renderer can draw the ability's FX tile
    // (fire-slash 🔥 / bolt 🔮 / …) under a reskin — the tint recolours it, exactly as it recoloured the glyph.
    spawnAttackAnim(input.anims, entity.col * cellSize + cellSize / 2, entity.row * cellSize + cellSize / 2, player.x, player.z, ranged ? 'shot' : 'slash', now, undefined, false, tint, chosen.animation)
    playerCombat = { ...playerCombat, hp: result.defenderHpAfter }
    const pCol = Math.floor(player.x / cellSize)
    const pRow = Math.floor(player.z / cellSize)
    pushHitMarker(hitMarkers, pCol, pRow, result.damage, 'player', now)
    if (isDead(playerCombat.hp)) break // dead — stop piling on this frame
  }
  return playerCombat
}

/** An enemy's "weapon" for one attack: its bare strength plus the attack's authored damage as the
 *  weapon base. Ranged attacks fling a bolt (range + reach match so block/range checks line up). */
function enemyFist(entity: Entity, attack: EnemyAttack): Weapon {
  const ranged = attack.mode === 'ranged'
  return {
    id: `fist-${entity.id}`,
    kind: 'sword',
    name: attack.name ?? (ranged ? 'Bolt' : 'Claw'),
    baseDamage: attack.damage, // authored damage rides as the swing's weapon base
    baseMagic: 0,
    baseDefense: 0,
    strengthBonus: 0,
    intBonus: 0,
    school: 'physical',
    range: ranged ? 'ranged' : 'melee',
    hands: 1,
    reachCells: ranged ? (attack.reachCells ?? RANGED_RANGE) : 1,
  }
}

/** Can this enemy land THIS attack on the player? Melee = 8-adjacent; ranged reaches up to the
 *  attack's reachCells (default RANGED_RANGE) cells away in any direction (chebyshev distance). */
function withinAttackReach(player: PlayerState, entity: Entity, cellSize: number, attack: EnemyAttack): boolean {
  if (attack.mode !== 'ranged') return isAdjacentToPlayer(player, entity, cellSize)
  const pCol = Math.floor(player.x / cellSize)
  const pRow = Math.floor(player.z / cellSize)
  const dist = Math.max(Math.abs(entity.col - pCol), Math.abs(entity.row - pRow))
  const reach = attack.reachCells ?? RANGED_RANGE
  return dist >= 1 && dist <= reach
}

/** Has enough time elapsed since this enemy's last swing to fire its NEXT attack? (first hit is
 *  always allowed.) Gated by the chosen attack's own cooldown. */
function offCooldown(runtime: EnemyRuntime, entity: Entity, now: number, attack: EnemyAttack): boolean {
  const last = runtime.lastAttackAt.get(entity.id)
  if (last === undefined) return true
  return now - last >= attack.cooldownMs
}

/** Append a floating "+dmg" marker (skipped when no damage was dealt). */
export function pushHitMarker(
  markers: HitMarker[],
  col: number,
  row: number,
  amount: number,
  target: 'enemy' | 'player',
  now: number,
): void {
  if (amount <= 0) return
  markers.push({ col, row, amount, target, bornAt: now })
}

/** Player death → reset to full HP at spawn (placeholder until respawn/death UX). */
function resetPlayerIfDead(playerCombat: CombatState): CombatState {
  if (!isDead(playerCombat.hp)) return playerCombat
  // NOTE: trivial reset for now — full restore in place. No spawn teleport yet
  // (spec §"keep it simple first"); proper death/respawn UX comes later.
  return startingCombatState(deriveStats(DEFAULT_PLAYER_STATS, BARE_HANDS))
}
