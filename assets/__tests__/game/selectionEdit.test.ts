import { commonValue, commonBool, cellsFromKeys } from '@/game/editor/selectionEdit'

describe('commonValue — shared value across a multi-selection (else "mixed")', () => {
  it('returns the shared value when every item matches', () => {
    expect(commonValue(['#ff0000', '#ff0000', '#ff0000'])).toBe('#ff0000')
    expect(commonValue([3, 3])).toBe(3)
  })
  it('returns null when the items differ (mixed)', () => {
    expect(commonValue(['#ff0000', '#00ff00'])).toBeNull()
    expect(commonValue([2, 3, 2])).toBeNull()
  })
  it('returns null for an empty selection', () => {
    expect(commonValue([])).toBeNull()
  })
})

describe('commonBool — collision summary across the selection', () => {
  it('all blocked → true, all clear → false, mixed → null', () => {
    expect(commonBool([true, true, true])).toBe(true)
    expect(commonBool([false, false])).toBe(false)
    expect(commonBool([true, false])).toBeNull()
  })
})

describe('cellsFromKeys — parse "col,row" selection keys', () => {
  it('parses valid keys and skips malformed ones', () => {
    expect(cellsFromKeys(['3,4', '10,2'])).toEqual([{ col: 3, row: 4 }, { col: 10, row: 2 }])
    expect(cellsFromKeys(['bad', '5,6'])).toEqual([{ col: 5, row: 6 }])
  })
  it('handles an empty selection', () => {
    expect(cellsFromKeys([])).toEqual([])
  })
})
