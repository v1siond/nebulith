// Pure player runtime: state shape, 8-way aim + facing, jump landing, and the
// name/life-bar display helpers. Moved out of the game-engine page (stage 2) so
// tests + every view share one source. Pure — no React, no DOM.
import type { Entity, CombatState } from '@/game/types'
import type { EntityAnimation } from './entityAnimation'
import type { TilePose } from '@/engine/tileset/pose'

// Player state
export interface PlayerState {
  x: number
  z: number
  facing: 'up' | 'down' | 'left' | 'right'
  /** 8-way GRID aim delta (col/row each ∈ -1..1) the player's targeting, projectiles, and
   *  swing follow — set from the movement keys, mapped to grid space per view. Separate from the
   *  4-way `facing` (which drives the weapon hand). Undefined → fall back to the facing delta. */
  aim?: { col: number; row: number }
  moving: boolean
  /** true while moving with Shift held — drives the RUN animation frame (🏃 vs the walk 🚶). */
  running?: boolean
  /** authored animations mirrored from the player entity, so the live hero plays whatever you author
   *  in the Inspector (falls back to the default character set when absent). */
  animations?: EntityAnimation[]
  /** person variant mirrored from the player entity → the hero renders the male/female figure. */
  variant?: 'male' | 'female'
  frame: number
  /** visual hop height (px) while mid-jump; 0 on the ground. */
  jumpHeight?: number
  /** held-weapon glyph drawn beside the figure (from the equipped loadout); '' = unarmed. */
  weaponGlyph?: string
  shieldGlyph?: string
  /** the equipped weapon/shield POSE (orientation/size/flip/offset) from the loaded tileset; the arm
   *  renderer applies it so the weapon's look is data-driven. Undefined → identity (no transform). */
  weaponPose?: TilePose
  shieldPose?: TilePose
  /** wearing any armor → the figure is tinted to show the upgrade. */
  armored?: boolean
  /** per-entity character tone (deterministic by the player entity's id) — the figure's body
   *  glyph / block-bg colors when unarmored. Undefined → the classic gold. */
  bodyColor?: string
  bodyBg?: string
  /** live HP + its max, mirrored from the combat state each frame so every view can draw the
   *  over-figure life bar the SAME way enemies get one. Undefined → no bar drawn yet. */
  hp?: number
  maxHp?: number
  /** display name shown above the life bar (like an enemy's type/name) + in the inventory
   *  header. Mirrored from the player entity each sync; persists on that entity. */
  name?: string
}

/** A grid cell. */
export interface SpawnCell { col: number; row: number }

/**
 * Where the player lands on a template LOAD. Priority:
 *   1. `override`  — an explicit teleport target (connector / trigger `go to`);
 *   2. `keptCell`  — reloading the map you're already in: keep the CURRENT position (#87), so a
 *                    load never yanks you back to the last-saved spawn;
 *   3. `playerMarker` — the saved player entity's cell (the placed spawn);
 *   4. `templateSpawn` — the template's authored default spawn.
 * The chosen cell is CLAMPED to the grid, so a stale / out-of-bounds spawn (e.g. a legacy fixed
 * 25,25 on a smaller target) can never land off-map (#88) — the caller then snaps it to the nearest
 * WALKABLE cell. Pure: no grid/DOM access, so the priority + clamp are unit-tested directly.
 */
export function resolveSpawnCell(
  choices: { override?: SpawnCell | null; keptCell?: SpawnCell | null; playerMarker?: SpawnCell | null; templateSpawn: SpawnCell },
  cols: number,
  rows: number,
): SpawnCell {
  const pick = choices.override ?? choices.keptCell ?? choices.playerMarker ?? choices.templateSpawn
  return {
    col: Math.max(0, Math.min(pick.col, cols - 1)),
    row: Math.max(0, Math.min(pick.row, rows - 1)),
  }
}

// Jump = clear up to this many blocked cells in the facing direction (settings later).
const JUMP_CLEAR = 1

/** Cell delta for a facing, matching how movement reads facing per view. */
export function facingDelta(facing: PlayerState['facing'], use2D: boolean): [number, number] {
  if (use2D) {
    if (facing === 'up') return [0, -1]
    if (facing === 'down') return [0, 1]
    if (facing === 'left') return [-1, 0]
    return [1, 0] // right
  }
  if (facing === 'up') return [-1, -1]
  if (facing === 'down') return [1, 1]
  if (facing === 'left') return [-1, 1]
  return [1, -1] // right (isometric diagonals)
}

/** The direction currently held on WASD/arrows, or null if none. Lets a standing
 *  jump commit to the way you're pressing (facing itself is only updated while
 *  walking, which a jump skips). View-agnostic — facingDelta handles iso vs 2D. */
export function facingFromKeys(keys: Record<string, boolean>): PlayerState['facing'] | null {
  if (keys['ArrowUp'] || keys['w']) return 'up'
  if (keys['ArrowDown'] || keys['s']) return 'down'
  if (keys['ArrowLeft'] || keys['a']) return 'left'
  if (keys['ArrowRight'] || keys['d']) return 'right'
  return null
}

/** The 8-way GRID aim delta the player's targeting, projectiles, and swing follow. Prefers the
 *  player's live `aim` (set from the movement keys) and falls back to the 4-way `facing` delta
 *  when none is held. The delta is in GRID space, so all 8 directions resolve identically in 2D
 *  and iso (the iso projection turns a grid "down" step into down-right on screen, etc.). */
export function aimDelta(player: PlayerState, use2D: boolean): [number, number] {
  const a = player.aim
  if (a && (a.col !== 0 || a.row !== 0)) return [a.col, a.row]
  return facingDelta(player.facing, use2D)
}

/** The 8-way GRID aim from the movement keys held this frame: sum each pressed direction's
 *  per-view grid delta — the SAME mapping movement uses, so you aim where you'd walk — then snap
 *  each axis to its sign. Two keys → a diagonal (e.g. W+D); one key → a grid orthogonal in 2D /
 *  a grid diagonal in iso. Opposite keys cancel. null when nothing aimable is held (keep the
 *  last aim so a standing shot still fires the way you last moved). */
export function aimFromKeys(keys: Record<string, boolean>, use2D: boolean): { col: number; row: number } | null {
  let col = 0
  let row = 0
  const add = (f: PlayerState['facing']): void => {
    const [c, r] = facingDelta(f, use2D)
    col += c
    row += r
  }
  if (keys['ArrowUp'] || keys['w']) add('up')
  if (keys['ArrowDown'] || keys['s']) add('down')
  if (keys['ArrowLeft'] || keys['a']) add('left')
  if (keys['ArrowRight'] || keys['d']) add('right')
  const sc = Math.sign(col)
  const sr = Math.sign(row)
  if (sc === 0 && sr === 0) return null
  return { col: sc, row: sr }
}

/** The cell a jump lands on: the farthest reachable cell up to JUMP_CLEAR+1 along (dCol,dRow),
 *  skipping blocked/out-of-bounds cells between (you're airborne, so a wall only SHORTENS the leap
 *  instead of cancelling it — which is why a jump in a dense town used to look like it just bobbed).
 *  A standing jump (forward=false) stays on (pCol,pRow). Returns null when moving but nothing ahead
 *  is reachable — the caller keeps walking rather than lock into a bob. Pure (grid via isBlocked). */
export function jumpLandingCell(
  pCol: number,
  pRow: number,
  dCol: number,
  dRow: number,
  forward: boolean,
  isBlocked: (col: number, row: number) => boolean,
  cols: number,
  rows: number,
): { col: number; row: number } | null {
  if (!forward) return { col: pCol, row: pRow } // standing hop — straight up on the same cell
  for (let d = JUMP_CLEAR + 1; d >= 1; d--) {
    const col = pCol + dCol * d
    const row = pRow + dRow * d
    if (col < 0 || row < 0 || col >= cols || row >= rows) continue
    if (isBlocked(col, row)) continue
    return { col, row }
  }
  return null
}

/** Clamp value/max into 0..1 (0 when max ≤ 0). Pure — shared by the enemy + player life bars. */
export function barFraction(value: number, max: number): number {
  if (max <= 0) return 0
  return Math.max(0, Math.min(1, value / max))
}

/** Fraction (0..1) of an enemy's HP remaining; 1 if no runtime state yet. */
export function hpFraction(entity: Entity, combat: CombatState | undefined): number {
  if (!combat) return 1
  return barFraction(combat.hp, entity.baseStats.maxHp)
}

/** Default shown when the player has no name yet. */
export const DEFAULT_PLAYER_NAME = 'Hero'

/** The player's shown name: its (trimmed) entity name when set, else the default. Pure. */
export function playerDisplayName(name?: string | null): string {
  return (name ?? '').trim() || DEFAULT_PLAYER_NAME
}
