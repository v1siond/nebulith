import {
  findTarget,
  makeEnemyRuntime,
  aimFromKeys,
  aimDelta,
  type PlayerState,
} from '@/pages/personal-projects/game-engine/templates'
import { makeEnemy } from '@/game/entities'

// ───────────────────────────────────────────────────────────────────────────
// 8-DIRECTION AIM (#55) — the player can target + fire along all 8 grid directions
// (N/S/E/W + the 4 diagonals), in BOTH 2D and iso. The aim lives in GRID space, so a
// direction resolves to the same cells in either view; only the keys→grid mapping (which
// movement already uses) differs by view. These tests drive the REAL aim helpers + findTarget.
// ───────────────────────────────────────────────────────────────────────────

const CS = 16

/** The 8 grid directions as (col,row) deltas. */
const DIRS = {
  N: { col: 0, row: -1 },
  S: { col: 0, row: 1 },
  E: { col: 1, row: 0 },
  W: { col: -1, row: 0 },
  NE: { col: 1, row: -1 },
  NW: { col: -1, row: -1 },
  SE: { col: 1, row: 1 },
  SW: { col: -1, row: 1 },
} as const

/** A player centred on (col,row) with an explicit 8-way grid aim. */
const playerAt = (col: number, row: number, aim: { col: number; row: number }): PlayerState => ({
  x: col * CS + CS / 2,
  z: row * CS + CS / 2,
  facing: 'down',
  moving: false,
  frame: 0,
  aim,
})

describe('aimFromKeys — WASD reaches all 8 GRID directions in each view', () => {
  // 2D: a single key is a grid orthogonal; two keys make a grid diagonal.
  it.each([
    [{ w: true }, DIRS.N],
    [{ s: true }, DIRS.S],
    [{ a: true }, DIRS.W],
    [{ d: true }, DIRS.E],
    [{ w: true, d: true }, DIRS.NE],
    [{ w: true, a: true }, DIRS.NW],
    [{ s: true, d: true }, DIRS.SE],
    [{ s: true, a: true }, DIRS.SW],
  ])('2D keys %p aim %p', (keys, expected) => {
    expect(aimFromKeys(keys as Record<string, boolean>, true)).toEqual(expected)
  })

  // iso: a single key is a grid DIAGONAL (iso movement is diagonal); two keys make a grid
  // orthogonal. Either way all 8 grid directions are reachable.
  it.each([
    [{ w: true }, DIRS.NW],
    [{ s: true }, DIRS.SE],
    [{ a: true }, DIRS.SW],
    [{ d: true }, DIRS.NE],
    [{ w: true, d: true }, DIRS.N],
    [{ s: true, a: true }, DIRS.S],
    [{ w: true, a: true }, DIRS.W],
    [{ s: true, d: true }, DIRS.E],
  ])('iso keys %p aim %p', (keys, expected) => {
    expect(aimFromKeys(keys as Record<string, boolean>, false)).toEqual(expected)
  })

  it('opposite keys cancel, and no keys → null (keep the last aim)', () => {
    expect(aimFromKeys({ w: true, s: true }, true)).toBeNull()
    expect(aimFromKeys({ a: true, d: true }, false)).toBeNull()
    expect(aimFromKeys({}, true)).toBeNull()
  })
})

describe('findTarget + aimDelta — an enemy on each of the 8 directions is selectable along the aim', () => {
  const px = 20
  const py = 20
  const REACH = 6 // a bow: the aim line must reach a few cells out

  for (const [name, d] of Object.entries(DIRS)) {
    // Run both views: with an explicit grid aim the result is identical (grid space).
    it.each([true, false])(`${name} — selects the enemy + produces the aim (use2D=%p)`, (use2D) => {
      // Place the enemy 3 cells out along the aim (beyond melee adjacency, so ONLY the aim line
      // finds it — proving the aim drives targeting, not a blanket 8-neighbour fallback).
      const enemy = makeEnemy('e', px + d.col * 3, py + d.row * 3, 'goblin')
      const player = playerAt(px, py, d)

      expect(findTarget(player, [enemy], makeEnemyRuntime(), CS, use2D, REACH)?.id).toBe('e')
      // a concrete aim delta is produced for the projectile / swing to follow
      expect(aimDelta(player, use2D)).toEqual([d.col, d.row])
    })
  }

  it('does NOT select an enemy off the aim line and out of adjacency', () => {
    const enemy = makeEnemy('e', px, py - 4, 'goblin') // 4 cells north
    const player = playerAt(px, py, DIRS.S) // aiming south, away from it
    expect(findTarget(player, [enemy], makeEnemyRuntime(), CS, true, REACH)).toBeNull()
  })

  it('falls back to the 4-way facing when no aim is set', () => {
    const player: PlayerState = { x: px * CS + CS / 2, z: py * CS + CS / 2, facing: 'right', moving: false, frame: 0 }
    expect(aimDelta(player, true)).toEqual([1, 0]) // 2D right = grid east
    expect(aimDelta(player, false)).toEqual([1, -1]) // iso right = grid north-east diagonal
  })
})
