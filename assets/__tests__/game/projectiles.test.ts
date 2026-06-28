import { projectileCellAt, projectileArrived, resolveImpact } from '../../game/projectiles'
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
