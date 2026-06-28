/**
 * Entity model + placement logic for Nebulith's RPG/game layer.
 * (see nebulith/docs/COMBAT-AND-SYSTEMS-SPEC.md §1 entities, §2 HP, §10 quests/respawn)
 *
 * PURE module: no module-level mutable state, no globals, no clock, no RNG.
 * Ids and the current time are passed IN so every function is deterministic and
 * unit-testable. Lists are treated as immutable — mutating helpers return a NEW
 * list. The game loop / editor own the stateful orchestration around these rules.
 */
import type { Entity, EntityKind, Stats, Rarity } from '@/game/types'
import { RESPAWN_MS_BY_RARITY, respawnMsForRarity } from '@/game/types'
import { entityFootprint } from '@/engine/entityArt'

// ── default stats ───────────────────────────────────────────────────
// Trivial starting values per the spec ("start with X/Y HP, flat numbers; tune
// later"). Exported so tests and callers share one source of truth.

/** The player starts sturdier than a basic enemy. */
export const DEFAULT_PLAYER_STATS: Stats = {
  strength: 10,
  intelligence: 10,
  defense: 5,
  maxHp: 100,
}

/** A baseline trash mob; bosses override via makeEnemy's stats option. */
export const DEFAULT_ENEMY_STATS: Stats = {
  strength: 5,
  intelligence: 0,
  defense: 2,
  maxHp: 30,
}

/** NPCs are non-combat by default; stats exist only to satisfy the contract. */
export const DEFAULT_NPC_STATS: Stats = {
  strength: 1,
  intelligence: 1,
  defense: 0,
  maxHp: 10,
}

// ── factories ───────────────────────────────────────────────────────

/** Create the player/spawn entity. */
export function makePlayer(id: string, col: number, row: number, name?: string): Entity {
  return {
    id,
    kind: 'player',
    col,
    row,
    name,
    baseStats: { ...DEFAULT_PLAYER_STATS },
  }
}

export interface MakeEnemyOptions {
  name?: string
  /** Respawn delay (ms) after death; omit = derive from rarity, 0 = does not respawn. */
  respawnMs?: number
  /** Rarity tier; sets the default respawnMs (rarer = slower to come back). Default 'common'. */
  rarity?: Rarity
  /** Partial stat overrides merged over the enemy defaults (e.g. bosses). */
  stats?: Partial<Stats>
}

/** Default respawn delay for a regular (common) enemy (~20s) so kill-quests stay
 *  farmable out of the box. Set respawnMs to 0 for a permanent (non-respawning) enemy. */
export const DEFAULT_RESPAWN_MS = RESPAWN_MS_BY_RARITY.common

/**
 * Create an enemy of a given `enemyType` (the tag 'kill' objectives count).
 * respawnMs defaults to the rarity's delay (common when unset) so dropped enemies
 * respawn; pass an explicit respawnMs to override, or 0 for a permanent enemy.
 */
export function makeEnemy(
  id: string,
  col: number,
  row: number,
  enemyType: string,
  options: MakeEnemyOptions = {},
): Entity {
  return {
    id,
    kind: 'enemy',
    col,
    row,
    name: options.name,
    enemyType,
    rarity: options.rarity,
    respawnMs: options.respawnMs ?? respawnMsForRarity(options.rarity),
    baseStats: { ...DEFAULT_ENEMY_STATS, ...options.stats },
  }
}

export interface MakeNpcOptions {
  name?: string
  /** The quest this NPC gives, if it's a quest giver (§10). */
  questId?: string
}

/** Create an NPC; pass a questId to make it a quest giver. */
export function makeNpc(id: string, col: number, row: number, options: MakeNpcOptions = {}): Entity {
  return {
    id,
    kind: 'npc',
    col,
    row,
    name: options.name,
    questId: options.questId,
    baseStats: { ...DEFAULT_NPC_STATS },
  }
}

// ── placement ───────────────────────────────────────────────────────

/** Does (col,row) act as a logical block? Matches the engine's isBlocked shape. */
export type CollisionFn = (col: number, row: number) => boolean

function isInBounds(col: number, row: number, gridCols: number, gridRows: number): boolean {
  if (col < 0 || row < 0) return false
  if (col >= gridCols || row >= gridRows) return false
  return true
}

function isOccupied(entities: readonly Entity[], col: number, row: number): boolean {
  return entities.some(e => e.col === col && e.row === row)
}

/**
 * Guard for placing an entity on a cell: must be in-bounds, not a blocked
 * (collision) cell, and not already occupied by another entity.
 */
export function canPlaceEntity(
  entities: readonly Entity[],
  col: number,
  row: number,
  gridCols: number,
  gridRows: number,
  collision: CollisionFn,
): boolean {
  if (!isInBounds(col, row, gridCols, gridRows)) return false
  if (collision(col, row)) return false
  if (isOccupied(entities, col, row)) return false
  return true
}

/** Immutably append an entity, returning a NEW list. */
export function placeEntity(entities: readonly Entity[], entity: Entity): Entity[] {
  return [...entities, entity]
}

/** Immutably remove the entity with `id`, returning a NEW list. */
export function removeEntity(entities: readonly Entity[], id: string): Entity[] {
  return entities.filter(e => e.id !== id)
}

/** The entity occupying (col,row), or null if the cell is empty. */
export function entityAt(entities: readonly Entity[], col: number, row: number): Entity | null {
  return entities.find(e => e.col === col && e.row === row) ?? null
}

/** The entity whose multi-cell FOOTPRINT covers (col,row) — for click-selection, so
 *  clicking any part of a 2-tall figure (not just its anchor cell) selects it. Figures
 *  are bottom-anchored vertically (extend upward) and centered horizontally, matching
 *  the renderer. Iterates last→first so the topmost drawn entity wins. */
export function entityAtFootprint(entities: readonly Entity[], col: number, row: number): Entity | null {
  for (let i = entities.length - 1; i >= 0; i--) {
    const e = entities[i]
    const { w, h } = entityFootprint(e)
    const left = e.col - Math.floor((w - 1) / 2)
    const right = e.col + Math.ceil((w - 1) / 2)
    const top = e.row - (h - 1)
    if (col >= left && col <= right && row >= top && row <= e.row) return e
  }
  return null
}

/** The set of cells (`"col,row"`) occupied by entities' FULL footprints — for movement
 *  collision, so the player can't walk through a monster and patrols collide with each
 *  other. Anchoring matches `entityAtFootprint` (bottom-anchored, centered). `exclude`
 *  skips entities (the player's own marker, dead enemies, or the entity currently
 *  moving) so they don't block what they shouldn't. */
export function entityOccupiedCells(
  entities: readonly Entity[],
  exclude?: (e: Entity) => boolean,
): Set<string> {
  const cells = new Set<string>()
  for (const e of entities) {
    if (exclude?.(e)) continue
    const { w, h } = entityFootprint(e)
    const left = e.col - Math.floor((w - 1) / 2)
    const right = e.col + Math.ceil((w - 1) / 2)
    const top = e.row - (h - 1)
    for (let c = left; c <= right; c++) {
      for (let r = top; r <= e.row; r++) cells.add(`${c},${r}`)
    }
  }
  return cells
}

// ── respawn timing (pure; `now` passed in) ──────────────────────────

/** The absolute time an enemy that died at `diedAt` will respawn. */
export function nextRespawnAt(diedAt: number, respawnMs: number): number {
  return diedAt + respawnMs
}

/**
 * Has a dead enemy respawned by `now`? An enemy with no (or zero) respawn delay
 * never respawns.
 */
export function isRespawned(diedAt: number, respawnMs: number | undefined, now: number): boolean {
  if (!respawnMs) return false
  return now >= nextRespawnAt(diedAt, respawnMs)
}

// ── queries ─────────────────────────────────────────────────────────

/** All entities of a given kind. */
export function byKind(entities: readonly Entity[], kind: EntityKind): Entity[] {
  return entities.filter(e => e.kind === kind)
}

/** All enemies tagged with `enemyType` (used by 'kill' objectives). */
export function enemiesOfType(entities: readonly Entity[], enemyType: string): Entity[] {
  return entities.filter(e => e.kind === 'enemy' && e.enemyType === enemyType)
}
