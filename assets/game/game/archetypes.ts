/**
 * Enemy ARCHETYPES — the data-driven stat + attack profile per enemy "kind".
 *
 * Enemies used to be near-identical: every one fell back to DEFAULT_ENEMY_STATS and a
 * single strength-only melee. This module gives each archetype a DISTINCT, meaningful
 * profile — a full stat block (hp/strength/defense/dodge), a move cadence, an attack
 * reach, and a real attack PATTERN built on the #59 system (patterns.ts). The roster /
 * spawner picks an archetype per enemy type; makeEnemy applies it (see entities.ts).
 *
 * PURE data + a builder. No rendering, no RNG, no clock. The table is the single source
 * of truth for "what a brute/archer/etc. is"; the builder hands out FRESH clones so a
 * caller can never mutate the shared table.
 */
import type { Stats, AttackPattern } from './types'
import { buildAttackPattern, makeEnemyAttack, enemyAttackFromAbility, ENEMY_ATTACK_PRESETS } from './patterns'
import { FIRE_SLASH } from './abilities'

/** The archetype roster. Melee: grunt/brute/skirmisher; ranged: archer/mage; mixed: raider;
 *  cave: flyer (bat) / crawler (spider). */
export type EnemyArchetypeId = 'grunt' | 'brute' | 'skirmisher' | 'archer' | 'mage' | 'raider' | 'flyer' | 'crawler'

/** One archetype's full combat profile: stats + move cadence + reach + default attack pattern. */
export interface EnemyArchetype {
  id: EnemyArchetypeId
  /** display label (editor / debug). */
  name: string
  /** the complete base stat block for this archetype (merged over DEFAULT_ENEMY_STATS on build). */
  stats: Stats
  /** patrol cadence: ms between movement steps — this archetype's MOVE SPEED. LOWER = faster.
   *  Wired onto the spawner's patrol so brutes lumber and skirmishers dart. */
  moveDelayMs: number
  /** headline attack reach in cells — melee = 1 (adjacency); ranged keeps its distance.
   *  The ranged attacks below carry the same reach (that's what the combat tick reads). */
  reachCells: number
  /** the default retaliation pattern fired by the combat tick (nextEnemyAttack). */
  attack: AttackPattern
}

// ── reach tuning (cells) ─────────────────────────────────────────────
const MELEE_REACH = 1
const ARCHER_REACH = 6
const MAGE_REACH = 7

/** The Bolt preset (reused for the archer/raider ranged shot), with a safe fallback. */
const BOLT = ENEMY_ATTACK_PRESETS.find(a => a.mode === 'ranged' && a.animation === 'bolt')
  ?? { ...makeEnemyAttack('ranged', 6, 1500, 'bolt'), reachCells: ARCHER_REACH, name: 'Bolt' }

/**
 * The archetype TABLE. Each entry is DISTINCT across hp / damage / cooldown / reach /
 * move speed so the four placed types feel different. Attacks are built through the #59
 * helpers (makeEnemyAttack / enemyAttackFromAbility / ENEMY_ATTACK_PRESETS) so an enemy
 * attack IS a real attack like the player's. NOTE: enemy ranged "magic" (mage 'nova') is
 * cosmetic in v1 — the combat tick resolves every enemy swing as PHYSICAL (see deferred).
 */
export const ENEMY_ARCHETYPES: Readonly<Record<EnemyArchetypeId, EnemyArchetype>> = {
  // Average all-rounder: medium hp, medium-speed single melee.
  grunt: {
    id: 'grunt',
    name: 'Grunt',
    stats: { strength: 6, intelligence: 0, defense: 3, maxHp: 34, dodge: 5 },
    moveDelayMs: 1000,
    reachCells: MELEE_REACH,
    attack: buildAttackPattern('sequential', [
      { ...makeEnemyAttack('melee', 4, 1000, 'cleave'), name: 'Strike' },
    ]),
  },
  // Tank/bruiser: high hp + defense, SLOW, a heavy slow melee (the registry Fire Slash:
  // 18 dmg on a 6s cooldown) — reuses enemyAttackFromAbility so it hits like a player ability.
  brute: {
    id: 'brute',
    name: 'Brute',
    stats: { strength: 12, intelligence: 0, defense: 6, maxHp: 72, dodge: 0 },
    moveDelayMs: 1700,
    reachCells: MELEE_REACH,
    attack: buildAttackPattern('sequential', [enemyAttackFromAbility(FIRE_SLASH)]),
  },
  // Glass cannon's nimble cousin: low hp, HIGH dodge, FAST, a light melee on a short
  // cooldown (hits often).
  skirmisher: {
    id: 'skirmisher',
    name: 'Skirmisher',
    stats: { strength: 5, intelligence: 0, defense: 1, maxHp: 20, dodge: 18 },
    moveDelayMs: 550,
    reachCells: MELEE_REACH,
    attack: buildAttackPattern('sequential', [
      { ...makeEnemyAttack('melee', 2, 450, 'cleave'), name: 'Quick Slash' },
    ]),
  },
  // Ranged harasser: low hp, fires a Bolt from distance (reach 6) — reuses the Bolt preset.
  archer: {
    id: 'archer',
    name: 'Archer',
    stats: { strength: 4, intelligence: 0, defense: 1, maxHp: 22, dodge: 10 },
    moveDelayMs: 900,
    reachCells: ARCHER_REACH,
    attack: buildAttackPattern('sequential', [{ ...BOLT, reachCells: ARCHER_REACH }]),
  },
  // Caster: low hp, lobs an arcane bolt from even further (reach 7), 'nova' magic visual.
  mage: {
    id: 'mage',
    name: 'Mage',
    stats: { strength: 3, intelligence: 10, defense: 1, maxHp: 18, dodge: 6 },
    moveDelayMs: 950,
    reachCells: MAGE_REACH,
    attack: buildAttackPattern('sequential', [
      { ...makeEnemyAttack('ranged', 12, 1900, 'nova'), reachCells: MAGE_REACH, name: 'Arcane Bolt' },
    ]),
  },
  // Mixed bruiser: ALTERNATES a fast melee hack and a mid-range bolt (sequential), so it
  // both closes and pokes. Spans melee + ranged in one pattern.
  raider: {
    id: 'raider',
    name: 'Raider',
    stats: { strength: 7, intelligence: 0, defense: 3, maxHp: 40, dodge: 8 },
    moveDelayMs: 850,
    reachCells: ARCHER_REACH,
    attack: buildAttackPattern('sequential', [
      { ...makeEnemyAttack('melee', 6, 800, 'fire-slash'), name: 'Hack' },
      { ...makeEnemyAttack('ranged', 9, 1400, 'bolt'), reachCells: ARCHER_REACH, name: 'Snipe' },
    ]),
  },
  // Cave FLYER (bat): tiny hp, VERY high dodge, a flitting nuisance that lands a light
  // quick bite — nimble (just behind the skirmisher's darting pace).
  flyer: {
    id: 'flyer',
    name: 'Bat',
    stats: { strength: 4, intelligence: 0, defense: 0, maxHp: 16, dodge: 24 },
    moveDelayMs: 560,
    reachCells: MELEE_REACH,
    attack: buildAttackPattern('sequential', [
      { ...makeEnemyAttack('melee', 2, 500, 'cleave'), name: 'Bite' },
    ]),
  },
  // Cave CRAWLER (spider): medium hp, lurking pace, a stronger venom bite on a slower
  // cadence — the ambush melee of a cavern.
  crawler: {
    id: 'crawler',
    name: 'Spider',
    stats: { strength: 6, intelligence: 0, defense: 2, maxHp: 30, dodge: 12 },
    moveDelayMs: 720,
    reachCells: MELEE_REACH,
    attack: buildAttackPattern('sequential', [
      { ...makeEnemyAttack('melee', 4, 900, 'cleave'), name: 'Venom Bite' },
    ]),
  },
}

/** Iteration order for the archetype roster (editor pickers / tests). */
export const ENEMY_ARCHETYPE_IDS: readonly EnemyArchetypeId[] = [
  'grunt', 'brute', 'skirmisher', 'archer', 'mage', 'raider', 'flyer', 'crawler',
]

/** Narrow an arbitrary string to a known archetype id. */
export function isArchetypeId(id: string | undefined): id is EnemyArchetypeId {
  return id != null && id in ENEMY_ARCHETYPES
}

/** Look an archetype up by id (undefined for an unknown id). Pure. */
export function getArchetype(id: string | undefined): EnemyArchetype | undefined {
  return isArchetypeId(id) ? ENEMY_ARCHETYPES[id] : undefined
}

/** The buildable profile an enemy factory consumes: stats + attack + move cadence + reach. */
export interface ArchetypeProfile {
  stats: Stats
  attack: AttackPattern
  moveDelayMs: number
  reachCells: number
}

/**
 * Build a FRESH profile for an archetype — deep-cloned stats + attack list so the caller
 * owns mutable copies and the shared table is never aliased. The single entry point
 * makeEnemy / the spawner use to stamp an archetype onto an enemy.
 */
export function buildArchetypeProfile(id: EnemyArchetypeId): ArchetypeProfile {
  const a = ENEMY_ARCHETYPES[id]
  return {
    stats: { ...a.stats },
    attack: { mode: a.attack.mode, attacks: a.attack.attacks.map(x => ({ ...x })) },
    moveDelayMs: a.moveDelayMs,
    reachCells: a.reachCells,
  }
}
