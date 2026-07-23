// The pure selection-SET logic behind "select cells/blocks in any view": compute the NEXT selection from a
// gesture (a rectangle drag, or a single click), additively or not. Kept pure so the requirement "additive
// multi-select — 4 + 4 = 8, no restart" is proven without driving React. The handlers (templates.tsx) wire to it.
import { rectSelectionKeys, applyRectSelection, applyCellSelection, blockKeyForPick } from '@/game/editor/selection'

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

describe('blockKeyForPick — the ONE key derivation shared by single-click + shift-click', () => {
  test('a picked TILE → the "col,row,stackIndex" key (its slot in the cell stack, not the heightLevel)', () => {
    expect(blockKeyForPick({ col: 3, row: 4, stackIndex: 2, source: 'asset' })).toBe('3,4,2')
    expect(blockKeyForPick({ col: 5, row: 5, stackIndex: 2 })).toBe('5,5,2') // the stack slot drives it, not the source
  })

  test('the BASE/FLOOR slot (stackIndex 0) is still a TILE key — grass, road and a wall base alike, no special case', () => {
    expect(blockKeyForPick({ col: 3, row: 4, stackIndex: 0, source: 'asset' })).toBe('3,4,0') // the grass/road floor slab
    expect(blockKeyForPick({ col: 7, row: 1, stackIndex: 1, source: 'asset' })).toBe('7,1,1') // a wall stacked on the floor
  })

  test('same-level tiles keyed APART — grass slab (slot 0) and wall block (slot 1) at the SAME cell get DIFFERENT keys', () => {
    // The "clicking the column selected the grass" fix: two tiles at heightLevel 0 are distinct STACK SLOTS.
    const grass = blockKeyForPick({ col: 6, row: 6, stackIndex: 0, source: 'asset' })
    const wall = blockKeyForPick({ col: 6, row: 6, stackIndex: 1, source: 'asset' })
    expect(grass).toBe('6,6,0')
    expect(wall).toBe('6,6,1')
    expect(grass).not.toBe(wall) // selectable as SEPARATE tiles
  })

  test('a pick with NO tile (a bare/empty cell region) → the flat "col,row" cell key', () => {
    expect(blockKeyForPick({ col: 5, row: 5, source: 'asset' })).toBe('5,5') // no stack slot → a bare cell region
    expect(blockKeyForPick({ col: 9, row: 2 })).toBe('9,2')
  })

  test('single-click and shift-click land on the SAME key for the SAME picked tile', () => {
    const pick = { col: 8, row: 2, stackIndex: 3, source: 'asset' as const }
    expect(blockKeyForPick(pick)).toBe(blockKeyForPick(pick)) // one derivation, no drift between gestures
    expect(blockKeyForPick(pick)).toBe('8,2,3')
  })
})
