// Play-loop MOVEMENT runtime — pulled out of the game-engine page (stage 5a).
// Orchestration over the pure steppers in engine/movement: per-enemy patrol
// advancement (with an unstick BFS), the player jump-arc kickoff, and the cannon
// turret tick. Pure + module-level so nothing re-allocates per frame and the
// rules stay unit-testable; each function takes the grid/state it needs.
import { shouldFire } from '@/engine/behaviors'
import type { IsometricGrid } from '@/engine/IsometricGrid'
import { type MoverState, RUN_PATROL_DELAY_MS, type RunState, STEP_LIST_DELAY_MS, type StepListState, initMover, initRunState, initStepList, stepMover, stepRunPatrol, stepStepList } from '@/engine/movement'
import { ENEMY_MOVE_MS } from '@/engine/render/shared'
import { entityCollisionCells } from '@/game/entities'
import { type HitMarker, pushHitMarker } from '@/game/runtime/combat'
import { type PlayerState, RUN_JUMP_CELLS, WALK_JUMP_CELLS, aimDelta, jumpLandingCell } from '@/game/runtime/player'
import { type Entity, type MovementPattern } from '@/game/types'

// ── JUMP ─────────────────────────────────────────────────────────────

/** A jump in flight: the loop interpolates the player from→to over JUMP_MS with a
 *  parabolic visual hop, so they travel ACROSS the intervening cell(s) and arc up,
 *  rather than teleporting. */
export interface JumpState {
  active: boolean
  fromX: number
  fromZ: number
  toX: number
  toZ: number
  start: number
}
export const JUMP_MS = 380 // arc duration
export const JUMP_PEAK_PX = 26 // visual hop height at mid-arc

/** Begin a jump. A MOVING jump leaps along the 8-way AIM (so all 8 directions work, #66); a STANDING
 *  jump (`forward===false`) hops straight up on the same cell. `running` (Shift held) makes it a longer
 *  RUN leap vs a short WALK hop, so the jump carries the momentum of your gait (#34). The loop animates
 *  the arc over a fixed time → the longer running leap is a faster arc. No-op if already mid-jump. */
export function beginJump(player: PlayerState, grid: IsometricGrid, use2D: boolean, jump: JumpState, now: number, forward: boolean, running: boolean): void {
  if (jump.active) return
  // Leap along the 8-way AIM (the way you're actually moving), not the 4-way facing — otherwise a
  // diagonal hold collapses to a cardinal hop (the iso "x/y but no z" + 2D "no diagonal" bug). #66
  const [dCol, dRow] = aimDelta(player, use2D)
  const cs = grid.cellSize
  const pCol = Math.floor(player.x / cs)
  const pRow = Math.floor(player.z / cs)
  const reach = running ? RUN_JUMP_CELLS : WALK_JUMP_CELLS // running carries farther → faster arc
  const landing = jumpLandingCell(pCol, pRow, dCol, dRow, forward, (c, r) => grid.isBlocked(c, r), grid.cols, grid.rows, reach)
  if (!landing) return
  jump.active = true
  jump.fromX = player.x
  jump.fromZ = player.z
  jump.toX = landing.col * cs + cs / 2
  jump.toZ = landing.row * cs + cs / 2
  jump.start = now
}

// ── ENEMY PATROL ─────────────────────────────────────────────────────

/** Newly-placed enemies (no authored pattern) patrol erratically out of the box:
 *  a step list of 5-cell runs in each direction, picked at random with pauses. */
const DEFAULT_ENEMY_PATROL: MovementPattern = {
  mode: 'random',
  waypoints: [],
  steps: [
    { dir: 'right', cells: 5 },
    { dir: 'left', cells: 5 },
    { dir: 'up', cells: 5 },
    { dir: 'down', cells: 5 },
  ],
  delayMs: 1000, // realistic patrol: walk a 5-cell run, then PAUSE/idle ~1s, then turn and walk again
                 // (smooth glide + idle-hold animation make this read as resting, not the old choppiness)
}

export type Cursor = MoverState | RunState | StepListState
const isStepListState = (s: Cursor | undefined): s is StepListState => !!s && 'cellsLeft' in s
const isRunState = (s: Cursor | undefined): s is RunState => !!s && 'stepsLeft' in s
const isMoverState = (s: Cursor | undefined): s is MoverState => !!s && 'target' in s

/** Nearest walkable cell to (col,row) via bounded 4-neighbour BFS. Returns the cell
 *  itself if already walkable, or null if nothing walkable is near — used to unstick
 *  enemies embedded in terrain / out of bounds. */
function nearestWalkable(grid: IsometricGrid, col: number, row: number, maxRings = 12): { col: number; row: number } | null {
  if (!grid.isBlocked(col, row)) return { col, row }
  const seen = new Set<string>([`${col},${row}`])
  let frontier = [{ col, row }]
  for (let r = 0; r < maxRings && frontier.length > 0; r++) {
    const nextRing: { col: number; row: number }[] = []
    for (const c of frontier) {
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nc = c.col + dc
        const nr = c.row + dr
        const key = `${nc},${nr}`
        if (seen.has(key)) continue
        seen.add(key)
        if (!grid.isBlocked(nc, nr)) return { col: nc, row: nr }
        nextRing.push({ col: nc, row: nr })
      }
    }
    frontier = nextRing
  }
  return null
}

/** Advance every patrolling enemy ONE cell along its movement pattern, treating
 *  walls, the player's cell, and other entities as blocked. Returns a NEW entities
 *  list when something moved, else the same reference (so the loop can skip a
 *  re-render). Per-entity cursors persist across ticks in `cursors`. */
export function advanceEnemyMovement(
  grid: IsometricGrid,
  entities: readonly Entity[],
  player: { x: number; z: number },
  cursors: Map<string, Cursor>,
  entityBlocked: Set<string>,
): readonly Entity[] {
  const pCol = Math.floor(player.x / grid.cellSize)
  const pRow = Math.floor(player.z / grid.cellSize)
  let moved = false
  const next = entities.map(e => {
    if (e.kind !== 'enemy') return e
    // UNSTICK: if the enemy is embedded in terrain or out of bounds (trees grew around it
    // after a regenerate, or it was dropped on a wall), relocate it to the nearest walkable
    // cell so it never sits frozen inside a tree / off the map.
    if (grid.isBlocked(e.col, e.row)) {
      const spot = nearestWalkable(grid, e.col, e.row)
      if (spot && (spot.col !== e.col || spot.row !== e.row)) {
        moved = true
        cursors.delete(e.id)
        return { ...e, col: spot.col, row: spot.row }
      }
    }
    const pattern = e.movement ?? DEFAULT_ENEMY_PATROL
    const own = entityCollisionCells([e]) // an entity must not collide with its own (base-row) footprint
    const blocked = (c: number, r: number): boolean =>
      grid.isBlocked(c, r) ||
      (c === pCol && r === pRow) ||
      (entityBlocked.has(`${c},${r}`) && !own.has(`${c},${r}`))

    // Pick the stepper: a step list ("advance N cells in a direction") takes precedence;
    // else run-patrol (axis set OR <2 waypoints); else the authored waypoint path.
    const prev = cursors.get(e.id)
    const here = { col: e.col, row: e.row }
    const delayTicks = Math.max(0, Math.round((pattern.delayMs ?? STEP_LIST_DELAY_MS) / ENEMY_MOVE_MS))
    let stepped: { pos: { col: number; row: number }; state: Cursor }
    if (pattern.waypoints.length >= 2) {
      stepped = stepMover(here, pattern, isMoverState(prev) ? prev : initMover(), blocked) // explicit click-path wins
    } else if (pattern.steps && pattern.steps.length > 0) {
      stepped = stepStepList(here, pattern, isStepListState(prev) ? prev : initStepList(), blocked, { delayTicks })
    } else if (pattern.axis) {
      stepped = stepRunPatrol(here, pattern, isRunState(prev) ? prev : initRunState(pattern), blocked, {
        delayTicks: Math.max(0, Math.round((pattern.delayMs ?? RUN_PATROL_DELAY_MS) / ENEMY_MOVE_MS)),
      })
    } else {
      stepped = stepMover(here, pattern, isMoverState(prev) ? prev : initMover(), blocked) // no-op (<2 waypoints)
    }

    cursors.set(e.id, stepped.state)
    if (stepped.pos.col === e.col && stepped.pos.row === e.row) return e
    moved = true
    return { ...e, col: stepped.pos.col, row: stepped.pos.row }
  })
  return moved ? next : entities
}

// ── CANNONS ──────────────────────────────────────────────────────────
// Cannon behavior: a placed `cannon` asset auto-fires on this cadence, hitting a
// player within CANNON_RANGE cells for CANNON_DAMAGE (a simple line-of-no-sight
// turret — projectile travel is a later refinement).
const CANNON_INTERVAL_MS = 1800
const CANNON_RANGE = 4
const CANNON_DAMAGE = 6

/** Fire every ready cannon; return total damage dealt to the player this tick and
 *  push a hit marker on the player when struck. `lastFired` persists per cannon. */
export function tickCannons(
  grid: IsometricGrid,
  player: { x: number; z: number },
  lastFired: Map<string, number>,
  hitMarkers: HitMarker[],
  now: number,
): number {
  const pCol = Math.floor(player.x / grid.cellSize)
  const pRow = Math.floor(player.z / grid.cellSize)
  let damage = 0
  for (const a of grid.assets) {
    if (a.tileKey !== 'cannon') continue
    const key = `${a.col},${a.row}`
    if (!shouldFire(CANNON_INTERVAL_MS, lastFired.get(key) ?? 0, now)) continue
    lastFired.set(key, now)
    if (Math.abs(a.col - pCol) + Math.abs(a.row - pRow) <= CANNON_RANGE) {
      damage += CANNON_DAMAGE
      pushHitMarker(hitMarkers, pCol, pRow, CANNON_DAMAGE, 'player', now)
    }
  }
  return damage
}
