import { findTarget, makeEnemyRuntime } from '@/game/runtime/targeting'
import { type PlayerState } from '@/game/runtime/player'
import { makeEnemy } from '@/game/entities'
import { entityFootprint } from '@/engine/entityArt'
import type { Entity } from '@/game/types'

// ───────────────────────────────────────────────────────────────────────────
// Melee TARGET SELECTION (findTarget) — the bug behind #36: enemies have multi-cell
// footprints (a goblin is 2 wide × 3 tall), but targeting matched only the ANCHOR cell,
// so attacking a monster from the side its body extends toward (its right / top) silently
// missed. In 2D, where you approach orthogonally, that read as "left/right does nothing".
// These tests drive the REAL findTarget against a REAL goblin and assert all four sides hit.
// ───────────────────────────────────────────────────────────────────────────

const CS = 16

/** A player standing at the centre of (col,row), facing a direction. */
const playerAt = (col: number, row: number, facing: PlayerState['facing']): PlayerState => ({
  x: col * CS + CS / 2,
  z: row * CS + CS / 2,
  facing,
  moving: false,
  frame: 0,
})

/** The enemy's footprint rect (bottom-anchored, horizontally centred — matches the renderer). */
const footRect = (e: Entity) => {
  const { w, h } = entityFootprint(e)
  return {
    left: e.col - Math.floor((w - 1) / 2),
    right: e.col + Math.ceil((w - 1) / 2),
    top: e.row - (h - 1),
    bottom: e.row,
  }
}

describe('findTarget — a melee swing hits an adjacent enemy on every side (2D)', () => {
  const enemy = makeEnemy('g', 10, 10, 'goblin')
  const entities = [enemy]
  const r = footRect(enemy)

  // sanity: this enemy really is multi-cell (otherwise the test proves nothing)
  it('the goblin footprint spans more than one cell', () => {
    expect(r.right - r.left).toBeGreaterThan(0) // >1 wide
    expect(r.bottom - r.top).toBeGreaterThan(0) // >1 tall
  })

  // Each case: stand one cell outside an edge of the footprint, face into it, and expect a hit.
  // Pre-fix, the left/right/top cases land on a FOOTPRINT cell (not the anchor) and missed.
  const cases: Array<{ side: string; player: PlayerState }> = [
    { side: 'left', player: playerAt(r.left - 1, r.top, 'right') },
    { side: 'right', player: playerAt(r.right + 1, r.top, 'left') },
    { side: 'top', player: playerAt(r.left, r.top - 1, 'down') },
    { side: 'bottom', player: playerAt(r.left, r.bottom + 1, 'up') },
  ]

  it.each(cases)('selects the enemy from the $side', ({ player }) => {
    const target = findTarget(player, entities, makeEnemyRuntime(), CS, true, 1)
    expect(target?.id).toBe('g')
  })

  it('does NOT select an enemy that is out of melee reach', () => {
    const player = playerAt(r.left - 3, r.top, 'right') // 3 cells clear of the footprint
    expect(findTarget(player, entities, makeEnemyRuntime(), CS, true, 1)).toBeNull()
  })

  it('a longer reach (2H/ranged) reaches one cell further down the facing line', () => {
    const player = playerAt(r.left - 2, r.top, 'right') // 2 cells out, facing the enemy
    expect(findTarget(player, entities, makeEnemyRuntime(), CS, true, 1)).toBeNull() // out of reach 1
    expect(findTarget(player, entities, makeEnemyRuntime(), CS, true, 2)?.id).toBe('g') // in reach 2
  })

  it('ignores a dead enemy (no live combat state once killed)', () => {
    const rt = makeEnemyRuntime()
    rt.combat.set('g', { hp: 0, rage: 0, mana: 0 }) // dead
    const player = playerAt(r.left - 1, r.top, 'right')
    expect(findTarget(player, entities, rt, CS, true, 1)).toBeNull()
  })
})

describe('findTarget — iso parity (all-direction adjacency still works)', () => {
  const enemy = makeEnemy('g', 10, 10, 'goblin')
  const r = footRect(enemy)

  it('hits an enemy whose footprint is diagonally adjacent, regardless of facing', () => {
    // iso approaches are diagonal; standing off the footprint corner still finds it via the
    // 8-neighbour fallback (footprint-aware), matching iso "hits all directions".
    const player = playerAt(r.right + 1, r.top - 1, 'up')
    expect(findTarget(player, [enemy], makeEnemyRuntime(), CS, false, 1)?.id).toBe('g')
  })
})
