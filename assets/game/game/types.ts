/**
 * Shared game-domain type contract for Nebulith's RPG layer
 * (see nebulith/docs/COMBAT-AND-SYSTEMS-SPEC.md).
 *
 * This is the cross-module CONTRACT — combat, inventory, quests, and entities all
 * build against these types. Treat it as stable/read-only from those modules;
 * module-internal types live in their own files.
 */

// ── stats & runtime combat state ────────────────────────────────────
export interface Stats {
  strength: number // ↑ physical damage, ↑ rage cap
  intelligence: number // ↑ magical damage, ↑ mana cap
  defense: number // ↓ melee (physical) damage taken
  maxHp: number
  /** % chance (0–100) to fully dodge an incoming attack. Optional → 0 when absent. */
  dodge?: number
}

/** Mutable per-entity runtime state during play. */
export interface CombatState {
  hp: number
  rage: number // resource for physical specials (cap derived from strength)
  mana: number // resource for magical specials (cap derived from intelligence)
}

// ── equipment ───────────────────────────────────────────────────────
export type AttackSchool = 'physical' | 'magical'
export type AttackRange = 'melee' | 'ranged'
export type AttackTier = 'regular' | 'special'

export interface Attack {
  school: AttackSchool
  range: AttackRange
  tier: AttackTier
}

export type WeaponKind = 'sword' | 'axe' | 'shield' | 'staff' | 'bow' | 'gun' | 'unarmed'
export interface Weapon {
  id: string
  kind: WeaponKind
  name: string
  baseDamage: number // physical base
  baseMagic: number // magical base (staff)
  baseDefense: number // shields / some weapons
  strengthBonus: number
  intBonus: number
  school: AttackSchool // the school this weapon attacks with by default
  range: AttackRange
  /** how many hands the weapon needs: 1 = one-handed, 2 = two-handed.
   *  Drives melee reach (1H → 1 cell, 2H → 2 cells). */
  hands: 1 | 2
  /** authored cell reach. Ranged weapons clamp this to [6,12]; melee derive reach
   *  from `hands` instead (see game/weapons.ts weaponReach). */
  reachCells: number
  /** shields: % chance (0–100) to fully block one incoming attack. */
  blockChance?: number
}

export type ArmorKind = 'iron' | 'leather'
/** The body slot a piece of armor / jewelry occupies. */
export type GearSlot = 'helmet' | 'chest' | 'gloves' | 'boots' | 'ring' | 'neck'
export interface Armor {
  id: string
  kind: ArmorKind // iron → strength build, leather → int build
  name: string
  defenseBonus: number
  strengthBonus: number
  intBonus: number
  /** body slot; defaults to 'chest' when omitted (back-compat with older armor). */
  slot?: GearSlot
  /** % dodge granted while worn. */
  dodgeBonus?: number
}

// ── inventory ───────────────────────────────────────────────────────
export type ItemSlot = 'weapon' | 'armor' | 'consumable'
export interface ConsumableEffect {
  hp?: number
  rage?: number
  mana?: number
}
export type Item =
  | { id: string; name: string; slot: 'weapon'; weapon: Weapon }
  | { id: string; name: string; slot: 'armor'; armor: Armor }
  | { id: string; name: string; slot: 'consumable'; effect: ConsumableEffect }

export interface Inventory {
  items: Item[]
  equippedWeapon: Weapon | null
  equippedArmor: Armor | null
}

// ── loadout (per-entity equip slots + bag + special slots) ──────────
export type EquipSlot =
  | 'helmet' | 'chest' | 'gloves' | 'boots'
  | 'weapon1' | 'weapon2'
  | 'ring1' | 'ring2' | 'neck'

/** Render/iteration order for the equip panel. */
export const EQUIP_SLOTS: readonly EquipSlot[] = [
  'helmet', 'chest', 'gloves', 'boots', 'weapon1', 'weapon2', 'ring1', 'ring2', 'neck',
] as const

export const DEFAULT_BAG_SLOTS = 24
export const DEFAULT_SPECIAL_SLOTS = 4

export interface LoadoutConfig {
  bagSlots?: number // default 24
  specialSlots?: number // default 4
}

/** One entity's gear: worn items by slot, a fixed-size bag, and quick-use special
 *  slots (bombs / scrolls / potions) each bound to a number key (1–0). */
export interface Loadout {
  equipped: Partial<Record<EquipSlot, Item>>
  bag: (Item | null)[]
  special: (Item | null)[]
  /** the key (1–0) bound to each special slot, by index. */
  shortcuts: string[]
}

// ── talents ─────────────────────────────────────────────────────────
export type TalentPath = 'warrior' | 'magician'

// ── movement patterns (patrolling entities) ─────────────────────────
export interface Cell {
  col: number
  row: number
}
/** sequential = walk the waypoints in order, looping; random = pick a random
 *  next waypoint on arrival. (See engine/movement.ts for the stepper.) */
export type MovementMode = 'sequential' | 'random'
/** Run-patrol axis: which directions an entity runs along between pauses.
 *  vertical = up/down runs; horizontal = left/right runs; mixed = pick an axis each
 *  run (vertical → randomize up/down, horizontal → reverse / go back). */
export type MovementAxis = 'vertical' | 'horizontal' | 'mixed'

/** A cardinal direction for a movement step. */
export type Direction = 'up' | 'down' | 'left' | 'right'
/** One authored movement step: "advance `cells` cells in `dir`". */
export interface MovementStep {
  dir: Direction
  cells: number
}
export interface MovementPattern {
  mode: MovementMode
  waypoints: Cell[]
  /** CANONICAL model: an ordered list of "advance N cells in a direction" steps.
   *  sequential = run them in order, looping; random = pick one, run it, pause, repeat.
   *  Collision-aware (see engine/movement.ts stepStepList). Takes precedence over
   *  waypoints/axis when present + non-empty. */
  steps?: MovementStep[]
  /** When set, the entity uses RUN-PATROL instead of waypoints: it runs `runLength`
   *  cells in one direction, pauses `delayMs`, then picks the next direction by axis. */
  axis?: MovementAxis
  /** cells per run before pausing (run-patrol). Default RUN_PATROL_LENGTH. */
  runLength?: number
  /** pause between steps/runs, in ms. Default RUN_PATROL_DELAY_MS. */
  delayMs?: number
}

/** How an enemy retaliates: melee adjacency vs ranged line-of-distance, plus the
 *  cooldown (ms) between swings. Authored per-enemy in the editor's inspector. */
export type AttackMode = 'melee' | 'ranged'
export interface AttackPattern {
  mode: AttackMode
  cooldownMs: number
}

// ── rarity & respawn ────────────────────────────────────────────────
/** Enemy rarity tier. Rarer enemies are slower to respawn, so they stay scarce. */
export type Rarity = 'common' | 'uncommon' | 'rare' | 'elite'

/** Respawn delay (ms) per rarity: regulars come back in ~20s, elites take minutes.
 *  Single source of truth shared by the factories, the spawner, and the play loop. */
export const RESPAWN_MS_BY_RARITY: Record<Rarity, number> = {
  common: 20_000,
  uncommon: 35_000,
  rare: 60_000,
  elite: 120_000,
}

/** The respawn delay for a rarity, defaulting to 'common' when none is given. */
export function respawnMsForRarity(rarity?: Rarity): number {
  return RESPAWN_MS_BY_RARITY[rarity ?? 'common']
}

// ── entities ────────────────────────────────────────────────────────
export type EntityKind = 'player' | 'enemy' | 'npc'
export interface Entity {
  id: string
  kind: EntityKind
  col: number
  row: number
  name?: string
  baseStats: Stats
  /** enemies: respawn delay in ms after death (kill-quests stay farmable). */
  respawnMs?: number
  /** npc: the quest this giver offers. */
  questId?: string
  /** enemy type tag used by 'kill' objectives. */
  enemyType?: string
  /** enemy rarity tier; drives respawn timing (see RESPAWN_MS_BY_RARITY). */
  rarity?: Rarity
  /** patrol path; the play loop advances it each movement tick. */
  movement?: MovementPattern
  /** retaliation pattern (enemies): melee/ranged + cooldown. Omitted = engine default. */
  attack?: AttackPattern
  /** can this entity be attacked? defaults: enemy=true, npc/decoration=false. */
  hittable?: boolean
}

// ── quests / missions ───────────────────────────────────────────────
export type ObjectiveKind = 'kill' | 'travel' | 'find'
export interface Objective {
  kind: ObjectiveKind
  /** enemyType for kill, stage/cell id for travel, npc id for find. */
  target: string
  required: number
  current: number
  done: boolean
  label: string
}

export type RewardKind = 'item' | 'xp' | 'stat'
export interface Reward {
  kind: RewardKind
  amount: number
  itemId?: string
  stat?: keyof Stats
}

export type QuestState = 'available' | 'active' | 'completed' | 'turned_in'
export interface Quest {
  id: string
  giverId: string
  title: string
  description: string
  objectives: Objective[]
  rewards: Reward[]
  state: QuestState
}
