import { projectileCellAt, projectileArrived, resolveImpact } from '../../game/projectiles'
import { muzzleOrigin } from '@/game/runtime/combat'

describe('muzzleOrigin — the projectile leaves the weapon muzzle, not the shooter cell', () => {
  test('muzzle 0.5 puts the origin halfway toward a 4-cell-away aim', () => {
    expect(muzzleOrigin(0, 0, 4, 0, 0.5)).toEqual({ col: 2, row: 0 })
  })
  test('muzzle null / absent keeps the shooter cell (unchanged behaviour)', () => {
    expect(muzzleOrigin(3, 3, 9, 3, null)).toEqual({ col: 3, row: 3 })
    expect(muzzleOrigin(3, 3, 9, 3)).toEqual({ col: 3, row: 3 })
  })
  test('offsets along BOTH axes toward a diagonal aim', () => {
    expect(muzzleOrigin(0, 0, 2, 4, 0.5)).toEqual({ col: 1, row: 2 })
  })
})
const p = { id: 'p1', fromCol: 0, fromRow: 0, toCol: 4, toRow: 0, targetId: 'e1', startMs: 0, durationMs: 400, glyph: '→', power: 5 }
test('cellAt lerps endpoints', () => {
  expect(projectileCellAt(p, 0)).toEqual({ col: 0, row: 0 })
  expect(projectileCellAt(p, 400)).toEqual({ col: 4, row: 0 })
})
test('arrived at/after duration', () => {
  expect(projectileArrived(p, 399)).toBe(false)
  expect(projectileArrived(p, 400)).toBe(true)
})
test('missed_moved when target vacated the impact cell', () => {
  expect(resolveImpact(p, { col: 9, row: 9 }, 0, 0, () => 0.99)).toBe('missed_moved')
})
test('dodged then blocked rolls; else hit', () => {
  expect(resolveImpact(p, { col: 4, row: 0 }, 0, 0.5, () => 0.1)).toBe('dodged')
  expect(resolveImpact(p, { col: 4, row: 0 }, 0.5, 0, () => 0.1)).toBe('blocked')
  expect(resolveImpact(p, { col: 4, row: 0 }, 0.2, 0.2, () => 0.99)).toBe('hit')
})
