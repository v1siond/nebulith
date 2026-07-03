/**
 * Regression: clicking the PLAYER selected nothing (stats + animation panel never appeared).
 *
 * Root cause: the player SPRITE is drawn at its live play-loop position (playerRef), but the
 * player ENTITY's col/row is only written by syncPlayerEntity (spawn / load / place) — the game
 * loop never re-syncs it. So once the hero walks, entityAtClick hit-tested the STALE spawn cell
 * and missed. Enemies/NPCs worked because their entity col/row IS advanced every patrol tick.
 *
 * Fix: hit-test the player at its LIVE cell — withPlayerCell() overrides the player entity's cell
 * before the existing (view-aware, billboard-aware) entityAtClick runs.
 */
import { makePlayer, makeEnemy, entityAtClick, withPlayerCell } from '@/game/entities'

describe('player selection follows the live player position, not the frozen spawn cell', () => {
  test('withPlayerCell overrides ONLY the player entity’s cell, leaving others untouched', () => {
    const player = makePlayer('p1', 5, 5)
    const enemy = makeEnemy('e1', 2, 2, 'goblin')
    const moved = withPlayerCell([player, enemy], { col: 10, row: 10 })
    expect(moved.find(e => e.id === 'p1')).toMatchObject({ col: 10, row: 10 })
    expect(moved.find(e => e.id === 'e1')).toMatchObject({ col: 2, row: 2 }) // enemy untouched
  })

  test('a player that walked away from spawn is selectable at its LIVE cell (was the bug)', () => {
    const player = makePlayer('p1', 5, 5) // entity frozen at spawn (5,5)
    const enemy = makeEnemy('e1', 2, 2, 'goblin')
    const entities = [player, enemy]
    const live = { col: 10, row: 10 } // the hero has walked here (playerRef)

    // THE BUG: raw entities are hit-tested at the stale spawn cell → clicking the live cell misses.
    expect(entityAtClick(entities, 10, 10, 'top')).toBeNull()

    // THE FIX: hit-test with the player's live cell → the player IS selected.
    expect(entityAtClick(withPlayerCell(entities, live), 10, 10, 'top')?.id).toBe('p1')
  })

  test('the moved player is NOT found at its now-vacated spawn cell', () => {
    const player = makePlayer('p1', 5, 5)
    const live = { col: 10, row: 10 }
    // the spawn cell (5,5) is empty now that the player is at its live cell — clicking it selects nothing
    expect(entityAtClick(withPlayerCell([player], live), 5, 5, 'top')).toBeNull()
  })
})
