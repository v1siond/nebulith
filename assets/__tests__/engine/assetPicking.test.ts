import { assetCovers, assetAtFootprint, assetAtClick } from '@/engine/assetPicking'

describe('assetCovers — top-left-anchored square footprint', () => {
  test('single-cell asset covers only its own cell', () => {
    const a = { col: 5, row: 5 }
    expect(assetCovers(a, 5, 5)).toBe(true)
    expect(assetCovers(a, 5, 4)).toBe(false)
    expect(assetCovers(a, 6, 5)).toBe(false)
  })
  test('footprint:2 asset covers its 2×2 block', () => {
    const a = { col: 5, row: 5, footprint: 2 }
    for (const [c, r] of [[5, 5], [6, 5], [5, 6], [6, 6]]) expect(assetCovers(a, c, r)).toBe(true)
    expect(assetCovers(a, 7, 5)).toBe(false)
  })
})

describe('assetAtFootprint — topmost (last drawn) wins', () => {
  test('returns the last-drawn asset when two overlap', () => {
    const under = { col: 5, row: 5, id: 'under' }
    const over = { col: 5, row: 5, id: 'over' }
    expect(assetAtFootprint([under, over], 5, 5)?.id).toBe('over')
    expect(assetAtFootprint([under, over], 9, 9)).toBeNull()
  })
})

describe('assetAtClick — billboard sprite drawn ABOVE its base cell', () => {
  const tree = { col: 5, row: 5, id: 'tree' }

  test('top view = exact cell only (sprite drawn on-cell, no walk)', () => {
    expect(assetAtClick([tree], 5, 5, 'top')?.id).toBe('tree')
    expect(assetAtClick([tree], 5, 4, 'top')).toBeNull()
  })

  test('2d: clicking up to 2 cells above the base (screen-up = -row) still selects it', () => {
    expect(assetAtClick([tree], 5, 5, '2d')?.id).toBe('tree') // exact
    expect(assetAtClick([tree], 5, 4, '2d')?.id).toBe('tree') // 1 above → walk +row
    expect(assetAtClick([tree], 5, 3, '2d')?.id).toBe('tree') // 2 above
    expect(assetAtClick([tree], 5, 2, '2d')).toBeNull()       // 3 above → beyond span
  })

  test('iso: screen-up is -col,-row, so walk +col,+row toward the base', () => {
    expect(assetAtClick([tree], 4, 4, 'iso')?.id).toBe('tree') // 1 up-screen
    expect(assetAtClick([tree], 5, 5, 'iso')?.id).toBe('tree') // exact
    expect(assetAtClick([tree], 1, 1, 'iso')).toBeNull()       // far away
  })

  test('empty grid → null', () => {
    expect(assetAtClick([], 5, 5, 'iso')).toBeNull()
  })
})
