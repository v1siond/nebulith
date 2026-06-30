// Pure target selection + per-enemy runtime bookkeeping for the combat tick.
// Moved out of the game-engine page (stage 2). Pure — no React, no DOM.
import type { Entity, CombatState } from '@/game/types'
import { isDead } from '@/game/combat'
import { entityCovers } from '@/game/entities'
import { aimDelta, type PlayerState } from './player'

/** Per-enemy runtime bookkeeping the loop owns, keyed by entity id. */
export interface EnemyRuntime {
  combat: Map<string, CombatState>
  /** death timestamp per enemy id (drives respawn timing). */
  diedAt: Map<string, number>
  /** last time each enemy landed a retaliation hit (drives its cooldown). */
  lastAttackAt: Map<string, number>
  /** how many times each enemy has fired (drives sequential attack-pattern cycling). */
  attackFireCount: Map<string, number>
}

export const makeEnemyRuntime = (): EnemyRuntime => ({
  combat: new Map(),
  diedAt: new Map(),
  lastAttackAt: new Map(),
  attackFireCount: new Map(),
})

/** Is this entity a living (not currently dead/awaiting-respawn) enemy? */
export function isLivingEnemy(entity: Entity, runtime: EnemyRuntime): boolean {
  if (entity.kind !== 'enemy') return false
  if (entity.hittable === false) return false // a non-hittable enemy is passive scenery
  const state = runtime.combat.get(entity.id)
  if (!state) return true // freshly placed, not yet initialized → alive
  return !isDead(state.hp)
}

/** The cell one step along the player's AIM (its 8-way grid delta, or the facing fallback). */
function aimCell(player: PlayerState, cellSize: number, use2D: boolean): { col: number; row: number } {
  const [dCol, dRow] = aimDelta(player, use2D)
  return {
    col: Math.floor(player.x / cellSize) + dCol,
    row: Math.floor(player.z / cellSize) + dRow,
  }
}

const ADJACENT_DELTAS: ReadonlyArray<readonly [number, number]> = [
  [0, -1], [0, 1], [-1, 0], [1, 0], // orthogonal first (preferred)
  [-1, -1], [1, 1], [-1, 1], [1, -1], // then diagonals (iso neighbours)
]

/**
 * Pick the enemy the player is attacking: the aimed cell wins; otherwise scan down
 * the 8-way aim line up to the weapon's `reach` (melee 1–2, ranged 6–12); otherwise the
 * nearest living adjacent enemy; null if none in reach. Dead enemies are skipped.
 */
export const RANGED_RANGE = 6 // default cells a ranged enemy reaches (enemy retaliation)

export function findTarget(
  player: PlayerState,
  entities: readonly Entity[],
  runtime: EnemyRuntime,
  cellSize: number,
  use2D: boolean,
  reach = 1,
): Entity | null {
  const faced = aimCell(player, cellSize, use2D)
  const facedEnemy = enemyAtCell(entities, runtime, faced.col, faced.row)
  if (facedEnemy) return facedEnemy
  // Scan further down the aim line for reach > 1 (2H melee = 2, ranged = 6–12).
  if (reach >= 2) {
    const [dCol, dRow] = aimDelta(player, use2D)
    const pCol = Math.floor(player.x / cellSize)
    const pRow = Math.floor(player.z / cellSize)
    for (let d = 2; d <= reach; d++) {
      const e = enemyAtCell(entities, runtime, pCol + dCol * d, pRow + dRow * d)
      if (e) return e
    }
  }
  return nearestAdjacentEnemy(player, entities, runtime, cellSize)
}

/** A living enemy whose FOOTPRINT covers (col,row), or null. Footprint-aware (not just the anchor):
 *  enemies are multi-cell (a goblin is 2 wide × 3 tall), so a swing at ANY of its cells lands —
 *  otherwise attacking from the side its body extends toward silently missed (#36). Topmost-first. */
function enemyAtCell(
  entities: readonly Entity[],
  runtime: EnemyRuntime,
  col: number,
  row: number,
): Entity | null {
  for (let i = entities.length - 1; i >= 0; i--) {
    const e = entities[i]
    if (isLivingEnemy(e, runtime) && entityCovers(e, col, row)) return e
  }
  return null
}

/** First living enemy in any of the 8 cells around the player, or null. */
function nearestAdjacentEnemy(
  player: PlayerState,
  entities: readonly Entity[],
  runtime: EnemyRuntime,
  cellSize: number,
): Entity | null {
  const pCol = Math.floor(player.x / cellSize)
  const pRow = Math.floor(player.z / cellSize)
  for (const [dCol, dRow] of ADJACENT_DELTAS) {
    const found = enemyAtCell(entities, runtime, pCol + dCol, pRow + dRow)
    if (found) return found
  }
  return null
}

/** Is the player standing adjacent (incl. diagonally) to this entity? */
export function isAdjacentToPlayer(player: PlayerState, entity: Entity, cellSize: number): boolean {
  const pCol = Math.floor(player.x / cellSize)
  const pRow = Math.floor(player.z / cellSize)
  return Math.abs(entity.col - pCol) <= 1 && Math.abs(entity.row - pRow) <= 1
}
