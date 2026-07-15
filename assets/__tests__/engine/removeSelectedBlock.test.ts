/**
 * REMOVE SELECTED BLOCK — the Inspector's "Remove tile" action. Deletes the EXACT stacked block the user
 * has selected (selectedTileLevel >= 1), never the floor (level 0 is a no-op — the ground is not
 * removable from this control). Mirrors tileBrush.removeAssetAtLevel's collision re-derive, but is driven
 * by the INSPECTOR's selected level + selected cells rather than a pointer position.
 */
import { IsometricGrid } from '@/engine/IsometricGrid'
import { removeSelectedBlock } from '@/game/editor/selectionEdit'

const makeGrid = () => new IsometricGrid({ cols: 8, rows: 8, cellSize: 32, isoScale: 1.4 })

describe('removeSelectedBlock — removes the SELECTED stacked block, never the floor', () => {
  test('removes the asset at the selected level, leaving the other stacked assets + floor intact', () => {
    const g = makeGrid()
    g.setGround(5, 5, 'grass')
    g.placeAsset(['🌲'], 5, 5, { type: 'tree', heightLevel: 1 })
    const middle = g.placeAsset(['🪨'], 5, 5, { type: 'rock', heightLevel: 2 })
    g.placeAsset(['🍃'], 5, 5, { type: 'leaf', heightLevel: 3 })

    // selectedTileLevel is 1-based into the stack (0 = floor); level 2 → stackedAssetsAt index 1 → `middle`.
    removeSelectedBlock(g, [{ col: 5, row: 5 }], 2)

    expect(g.assets).not.toContain(middle)
    expect(g.assets).toHaveLength(2)
    expect(g.assets.map(a => a.type).sort()).toEqual(['leaf', 'tree'])
    expect(g.ground[5][5]).toBe('grass') // floor untouched
  })

  test('selectedTileLevel === 0 (the floor) is a no-op — nothing removed, ground intact', () => {
    const g = makeGrid()
    g.setGround(5, 5, 'grass')
    g.placeAsset(['🌲'], 5, 5, { type: 'tree', heightLevel: 1 })

    removeSelectedBlock(g, [{ col: 5, row: 5 }], 0)

    expect(g.assets).toHaveLength(1)
    expect(g.ground[5][5]).toBe('grass')
  })

  test('re-derives collision: removing the only blocker unblocks the cell', () => {
    const g = makeGrid()
    g.setGround(5, 5, 'grass')
    g.placeAsset(['🏠'], 5, 5, { type: 'house', heightLevel: 1, blocking: true })
    g.placeAsset(['🍃'], 5, 5, { type: 'leaf', heightLevel: 2 })
    expect(g.isBlocked(5, 5)).toBe(true)

    removeSelectedBlock(g, [{ col: 5, row: 5 }], 1) // remove the blocking house (level 1)

    expect(g.isBlocked(5, 5)).toBe(false)
    expect(g.assets.map(a => a.type)).toEqual(['leaf'])
  })

  test('collision stays blocked when a blocker remains after the removal', () => {
    const g = makeGrid()
    g.setGround(5, 5, 'grass')
    g.placeAsset(['🏠'], 5, 5, { type: 'house', heightLevel: 1, blocking: true })
    g.placeAsset(['🍃'], 5, 5, { type: 'leaf', heightLevel: 2 })
    expect(g.isBlocked(5, 5)).toBe(true)

    removeSelectedBlock(g, [{ col: 5, row: 5 }], 2) // remove the non-blocking leaf (level 2)

    expect(g.isBlocked(5, 5)).toBe(true) // house still blocks
    expect(g.assets.map(a => a.type)).toEqual(['house'])
  })

  test('applies across every selected cell', () => {
    const g = makeGrid()
    g.setGround(1, 1, 'grass')
    g.setGround(2, 2, 'grass')
    g.placeAsset(['🌲'], 1, 1, { type: 'tree', heightLevel: 1 })
    g.placeAsset(['🌲'], 2, 2, { type: 'tree', heightLevel: 1 })

    removeSelectedBlock(g, [{ col: 1, row: 1 }, { col: 2, row: 2 }], 1)

    expect(g.assets).toHaveLength(0)
  })

  test('a level with no asset at that cell is a no-op for that cell (nothing to remove)', () => {
    const g = makeGrid()
    g.setGround(5, 5, 'grass')
    g.placeAsset(['🌲'], 5, 5, { type: 'tree', heightLevel: 1 })

    removeSelectedBlock(g, [{ col: 5, row: 5 }], 3) // no asset at level 3

    expect(g.assets).toHaveLength(1)
  })
})
