/**
 * Nebulith combat engine — PURE, deterministic, side-effect-free.
 *
 * Contract: nebulith/docs/COMBAT-AND-SYSTEMS-SPEC.md (§2–6).
 * Everything here is a pure function: feed it stats + equipment + (optional)
 * runtime state, get a value/result back. No globals, no mutation of inputs,
 * no I/O. Any randomness must be injected by the caller (none is needed yet —
 * the starting formulas in §5 are deterministic and flat).
 *
 * Build philosophy (per spec): start trivial, keep it composable so the
 * coefficients can be tuned later without reshaping the call sites.
 */

import type {
  Stats,
  Armor,
  Weapon,
  Attack,
  AttackSchool,
  AttackRange,
  CombatState,
} from '@/game/types'

// ── tunable coefficients (single source — refine here, not at call sites) ──
export const REGULAR_MULTIPLIER = 1 as const
export const SPECIAL_MULTIPLIER = 1.75 as const

/** How much one point of strength/int lifts the matching resource cap. */
const RAGE_PER_STRENGTH = 5 as const
const MANA_PER_INTELLIGENCE = 5 as const

/** Resource a single special attack burns (flat for now — §5 "start trivial"). */
const SPECIAL_RESOURCE_COST = 20 as const

/** Floor for mitigated melee physical damage (§5: `max(1, dmg - defense)`). */
const MIN_DAMAGE = 1 as const

// ── stat bonus sources ──────────────────────────────────────────────
/**
 * A thing that can contribute to derived stats. Both Weapon and Armor expose
 * the same bonus surface, so we aggregate them through one shape instead of
 * branching per equipment kind (Open/Closed: add a source, not a branch).
 */
interface StatBonus {
  strengthBonus?: number
  intBonus?: number
  defenseBonus?: number
  /** weapons carry their defense under `baseDefense`, armor under `defenseBonus`. */
  baseDefense?: number
}

const sumBonus = (acc: Stats, b: StatBonus | undefined): Stats => {
  if (!b) return acc
  return {
    ...acc,
    strength: acc.strength + (b.strengthBonus ?? 0),
    intelligence: acc.intelligence + (b.intBonus ?? 0),
    defense: acc.defense + (b.defenseBonus ?? 0) + (b.baseDefense ?? 0),
  }
}

/**
 * Effective stats = base + every equipped bonus source, folded together.
 * Pure: returns a fresh object, never touches `base`. maxHp is carried through
 * untouched (equipment doesn't grant HP in the starting model).
 */
export function deriveStats(base: Stats, weapon?: Weapon, armor?: Armor): Stats {
  return [weapon, armor].reduce<Stats>(sumBonus, { ...base })
}

// ── resource caps (derived from stats, §3) ──────────────────────────
export const rageCap = (strength: number): number =>
  Math.max(0, Math.round(strength * RAGE_PER_STRENGTH))

export const manaCap = (intelligence: number): number =>
  Math.max(0, Math.round(intelligence * MANA_PER_INTELLIGENCE))

/** Fresh runtime state for an entity: full HP, resources topped to their caps. */
export function startingCombatState(stats: Stats): CombatState {
  return {
    hp: stats.maxHp,
    rage: rageCap(stats.strength),
    mana: manaCap(stats.intelligence),
  }
}

// ── HP / death helpers ──────────────────────────────────────────────
/** Apply damage to an HP value, clamped at 0 (never negative). */
export const applyDamage = (hp: number, damage: number): number =>
  Math.max(0, hp - damage)

/** An entity is dead once its HP reaches 0. */
export const isDead = (hp: number): boolean => hp <= 0

// ── damage by school (dispatch map, not switch) ─────────────────────
/** Raw, pre-mitigation damage for a school given effective attacker stats. */
type DamageFormula = (eff: Stats, weapon: Weapon, multiplier: number) => number

const SCHOOL_DAMAGE: Record<AttackSchool, DamageFormula> = {
  // physical = (weaponBaseDmg + strength) * mult  (§5)
  physical: (eff, weapon, mult) => (weapon.baseDamage + eff.strength) * mult,
  // magical  = (staffBaseMagic + intelligence) * mult  (§5)
  magical: (eff, weapon, mult) => (weapon.baseMagic + eff.intelligence) * mult,
}

const multiplierFor = (attack: Attack): number =>
  attack.tier === 'special' ? SPECIAL_MULTIPLIER : REGULAR_MULTIPLIER

/**
 * Defense only bites melee physical (§5). Ranged physical and all magical
 * pass through unmitigated for now (magic-vs-defense is TBD in the spec).
 */
const mitigatesMelee = (school: AttackSchool, range: AttackRange): boolean =>
  school === 'physical' && range === 'melee'

const mitigate = (raw: number, attack: Attack, defenderDefense: number): number => {
  const rounded = Math.round(raw)
  if (!mitigatesMelee(attack.school, attack.range)) return Math.max(0, rounded)
  return Math.max(MIN_DAMAGE, rounded - defenderDefense)
}

// ── special-attack resource gating (dispatch map) ───────────────────
export type AttackFailure = 'insufficient-rage' | 'insufficient-mana'
export type ResourceKey = 'rage' | 'mana'

interface ResourceRule {
  key: ResourceKey
  failure: AttackFailure
}

/** Which resource a special of each school spends, and how it fails. */
const SPECIAL_RESOURCE: Record<AttackSchool, ResourceRule> = {
  physical: { key: 'rage', failure: 'insufficient-rage' },
  magical: { key: 'mana', failure: 'insufficient-mana' },
}

// ── resolveAttack ───────────────────────────────────────────────────
export interface ResolveAttackInput {
  attacker: Stats
  defender: Stats
  attack: Attack
  attackerWeapon: Weapon
  attackerArmor?: Armor
  /** defender equipment also feeds their effective defense. */
  defenderWeapon?: Weapon
  defenderArmor?: Armor
  /** defender's current HP; defaults to defender.maxHp. */
  defenderHp?: number
  /** attacker runtime resources — required for special (rage/mana) attacks. */
  attackerState?: CombatState
}

export interface ResolveAttackResult {
  /** did the attack actually go off? (specials can be gated by resources) */
  fired: boolean
  /** why it didn't fire, when `fired` is false. */
  reason?: AttackFailure
  /** final damage dealt (0 if it didn't fire). */
  damage: number
  /** defender HP after the hit (unchanged if it didn't fire). */
  defenderHpAfter: number
  /** did this hit drop the defender to 0? */
  lethal: boolean
  /** which resource was spent ('rage'|'mana'), or null for free regulars. */
  resource: ResourceKey | null
  /** how much of that resource was spent. */
  resourceSpent: number
  /** attacker runtime state after spending (echoes input when nothing spent). */
  attackerStateAfter?: CombatState
}

/** Resolve one attack into damage + resource cost. Pure — inputs untouched. */
export function resolveAttack(input: ResolveAttackInput): ResolveAttackResult {
  const { attack, defender, defenderHp, attackerState } = input
  const startingHp = defenderHp ?? defender.maxHp

  // Special attacks must clear their resource gate before anything happens.
  const gate = gateSpecial(attack, attackerState)
  if (gate) return blocked(gate, startingHp, attackerState)

  const damage = computeDamage(input)
  const defenderHpAfter = applyDamage(startingHp, damage)
  const spend = spendResource(attack, attackerState)

  return {
    fired: true,
    damage,
    defenderHpAfter,
    lethal: isDead(defenderHpAfter),
    resource: spend.resource,
    resourceSpent: spend.amount,
    attackerStateAfter: spend.stateAfter,
  }
}

// ── resolveAttack helpers (small, single-purpose) ───────────────────

/** Returns a failure reason iff a special can't pay its resource cost; else null. */
function gateSpecial(
  attack: Attack,
  state: CombatState | undefined,
): AttackFailure | null {
  if (attack.tier !== 'special') return null
  const rule = SPECIAL_RESOURCE[attack.school]
  const available = state?.[rule.key] ?? 0
  if (available < SPECIAL_RESOURCE_COST) return rule.failure
  return null
}

/** Effective attacker damage for this attack, after defender mitigation. */
function computeDamage(input: ResolveAttackInput): number {
  const { attacker, attackerWeapon, attackerArmor, attack } = input
  const attackerEff = deriveStats(attacker, attackerWeapon, attackerArmor)
  const raw = SCHOOL_DAMAGE[attack.school](
    attackerEff,
    attackerWeapon,
    multiplierFor(attack),
  )
  const defenderEff = deriveStats(input.defender, input.defenderWeapon, input.defenderArmor)
  return mitigate(raw, attack, defenderEff.defense)
}

interface ResourceSpend {
  resource: ResourceKey | null
  amount: number
  stateAfter?: CombatState
}

/** Compute the resource debit for a fired attack (specials only). */
function spendResource(
  attack: Attack,
  state: CombatState | undefined,
): ResourceSpend {
  if (attack.tier !== 'special') return { resource: null, amount: 0, stateAfter: state }
  const rule = SPECIAL_RESOURCE[attack.school]
  const stateAfter = state
    ? { ...state, [rule.key]: state[rule.key] - SPECIAL_RESOURCE_COST }
    : undefined
  return { resource: rule.key, amount: SPECIAL_RESOURCE_COST, stateAfter }
}

/** A non-firing result: no damage, defender + attacker state untouched. */
function blocked(
  reason: AttackFailure,
  defenderHp: number,
  attackerState: CombatState | undefined,
): ResolveAttackResult {
  return {
    fired: false,
    reason,
    damage: 0,
    defenderHpAfter: defenderHp,
    lethal: false,
    resource: null,
    resourceSpent: 0,
    attackerStateAfter: attackerState,
  }
}
