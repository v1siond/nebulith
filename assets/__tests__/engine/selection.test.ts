// The pure selection-SET logic behind "select cells/blocks in any view": compute the NEXT selection from a
// gesture (a rectangle drag, or a single click), additively or not. Kept pure so the requirement "additive
// multi-select — 4 + 4 = 8, no restart" is proven without driving React. The handlers (templates.tsx) wire to it.
import { rectSelectionKeys, applyRectSelection, applyCellSelection } from '@/game/editor/selection'

describe('selection set — batch + additive (4 + 4 = 8, no restart)', () => {
  test('rectSelectionKeys → the INCLUSIVE rectangle of "col,row" keys (order-independent corners)', () => {
    expect(rectSelectionKeys({ col: 1, row: 1 }, { col: 2, row: 2 })).toEqual(new Set(['1,1', '2,1', '1,2', '2,2']))
    // corners in any order give the same rectangle
    expect(rectSelectionKeys({ col: 2, row: 2 }, { col: 1, row: 1 })).toEqual(new Set(['1,1', '2,1', '1,2', '2,2']))
  })

  test('a NON-additive rectangle REPLACES the base selection', () => {
    const base = new Set(['9,9'])
    expect(applyRectSelection(base, { col: 1, row: 1 }, { col: 2, row: 2 }, false))
      .toEqual(new Set(['1,1', '2,1', '1,2', '2,2']))
  })

  test('an ADDITIVE rectangle MERGES into the base — select 4, then 4 more → 8', () => {
    const first = applyRectSelection(new Set(), { col: 1, row: 1 }, { col: 2, row: 2 }, false) // 4
    const next = applyRectSelection(first, { col: 5, row: 5 }, { col: 6, row: 6 }, true)        // + 4 more
    expect(next.size).toBe(8)
    expect(next).toEqual(new Set(['1,1', '2,1', '1,2', '2,2', '5,5', '6,5', '5,6', '6,6']))
  })

  test('additive OVERLAP does not double-count (Set semantics — no restart, no dupes)', () => {
    const base = new Set(['1,1', '2,1', '1,2', '2,2'])
    const next = applyRectSelection(base, { col: 2, row: 2 }, { col: 3, row: 3 }, true) // overlaps 2,2
    expect(next.has('2,2')).toBe(true)
    expect(next.size).toBe(base.size + 3) // only the 3 NEW cells (2,3 3,2 3,3) are added
  })

  test('applyCellSelection: additive ADDS one, non-additive REPLACES', () => {
    expect(applyCellSelection(new Set(['1,1']), '2,2', true)).toEqual(new Set(['1,1', '2,2']))
    expect(applyCellSelection(new Set(['1,1']), '2,2', false)).toEqual(new Set(['2,2']))
  })
})
