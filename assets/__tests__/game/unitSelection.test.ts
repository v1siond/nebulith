import { nearestUnit, cycleSelection, unitsInRange } from '@/game/unitSelection'

describe('unitsInRange — Tab-target candidates are only units near the player, nearest first', () => {
  const player = { col: 10, row: 10 }
  const units = [
    { id: 'far', col: 30, row: 10 },   // 20 cells away
    { id: 'near', col: 12, row: 10 },  // 2 cells
    { id: 'mid', col: 10, row: 15 },   // 5 cells
    { id: 'edge', col: 16, row: 10 },  // 6 cells (== range)
  ]
  test('excludes units beyond the range', () => {
    expect(unitsInRange(units, player.col, player.row, 6)).not.toContain('far')
  })
  test('includes a unit exactly at the range boundary', () => {
    expect(unitsInRange(units, player.col, player.row, 6)).toContain('edge')
  })
  test('orders survivors NEAREST first', () => {
    expect(unitsInRange(units, player.col, player.row, 6)).toEqual(['near', 'mid', 'edge'])
  })
  test('nothing in range → empty list', () => {
    expect(unitsInRange(units, 100, 100, 6)).toEqual([])
  })
})

describe('nearestUnit — click near a unit picks the nearest within range', () => {
  const cands = [
    { id: 'a', x: 10, y: 10 },
    { id: 'b', x: 100, y: 100 },
  ]
  test('picks the nearer candidate to the click', () => {
    expect(nearestUnit(cands, 20, 15, 50)).toBe('a') // ~11px from a, far from b
    expect(nearestUnit(cands, 95, 105, 50)).toBe('b')
  })
  test('returns null when the click is beyond maxDist of every candidate', () => {
    expect(nearestUnit(cands, 500, 500, 50)).toBeNull()
  })
  test('empty candidates → null', () => {
    expect(nearestUnit([], 0, 0, 50)).toBeNull()
  })
})

describe('cycleSelection — Tab cycles through the unit list, wrapping', () => {
  const ids = ['a', 'b', 'c']
  test('forward from current', () => {
    expect(cycleSelection(ids, 'a', 1)).toBe('b')
  })
  test('wraps forward past the end', () => {
    expect(cycleSelection(ids, 'c', 1)).toBe('a')
  })
  test('backward + wrap', () => {
    expect(cycleSelection(ids, 'a', -1)).toBe('c')
  })
  test('null or unknown current → first (fwd) / last (back)', () => {
    expect(cycleSelection(ids, null, 1)).toBe('a')
    expect(cycleSelection(ids, 'zzz', -1)).toBe('c')
  })
  test('empty list → null', () => {
    expect(cycleSelection([], null, 1)).toBeNull()
  })
})
