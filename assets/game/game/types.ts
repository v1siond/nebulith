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

export type WeaponKind = 'sword' | 'axe' | 'shield' | 'staff'
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
}

export type ArmorKind = 'iron' | 'leather'
export interface Armor {
  id: string
  kind: ArmorKind // iron → strength build, leather → int build
  name: string
  defenseBonus: number
  strengthBonus: number
  intBonus: number
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

// ── talents ─────────────────────────────────────────────────────────
export type TalentPath = 'warrior' | 'magician'

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
