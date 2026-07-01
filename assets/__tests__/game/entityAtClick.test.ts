/**
 * Selecting a unit must be VIEW-AWARE: in iso/2d the figure is drawn ABOVE its foot cell, so a click
 * on the figure lands on a cell above it (screen-up). entityAtClick also checks toward the feet, so
 * clicking the standing figure selects the unit — the reason "select the player" only worked in top.
 */
import { entityAtClick } from '@/game/entities'
import type { Entity, Stats } from '@/game/types'

const stats: Stats = { strength: 1, intelligence: 1, defense: 1, maxHp: 10 }
const E: Entity[] = [{ id: 'p', kind: 'player', col: 10, row: 10, baseStats: stats }]

describe('entityAtClick — billboard-aware selection', () => {
  test('exact foot cell hits in every view', () => {
    for (const v of ['top', '2d', 'iso'] as const) expect(entityAtClick(E, 10, 10, v)?.id).toBe('p')
  })
  test('iso: clicking the FIGURE (up-left of the foot: col−,row−) still selects it', () => {
    expect(entityAtClick(E, 9, 9, 'iso')?.id).toBe('p') // 1 cell up-screen
    expect(entityAtClick(E, 8, 8, 'iso')?.id).toBe('p') // 2 cells up-screen
  })
  test('2d: clicking the FIGURE (above the foot: row−) still selects it', () => {
    expect(entityAtClick(E, 10, 9, '2d')?.id).toBe('p')
    expect(entityAtClick(E, 10, 8, '2d')?.id).toBe('p')
  })
  test('top view checks ONLY the cell (figure is on the cell there)', () => {
    expect(entityAtClick(E, 10, 8, 'top')).toBeNull()
  })
  test('an empty area selects nothing', () => {
    expect(entityAtClick(E, 3, 3, 'iso')).toBeNull()
    // reach = footprint-up (1) + figCells (2) = 3 cells; row 6 is beyond it.
    expect(entityAtClick(E, 10, 6, '2d')).toBeNull()
  })
})
