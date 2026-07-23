/**
 * REMOVE SELECTED BLOCK — the Inspector's "Remove tile" action. Deletes the EXACT tile(s) the user has
 * SELECTED, one per selection KEY. Each key is "col,row,stackIndex" — the tile's slot in the cell's ordered
 * stack (getAssetsAtCell order: slot 0 = the base/floor slab, then up), the SAME per-tile identity the pick +
 * highlight use, so a same-level neighbour is never hit by mistake. The FLOOR slab is floor-safe (its own
 * Clear-tiles path owns the ground), and a bare "col,row" cell key removes nothing. Mirrors
 * tileBrush.removeAssetAtLevel's collision re-derive.
 */
import { IsometricGrid } from '@/engine/IsometricGrid'
import { removeSelectedBlock } from '@/game/editor/selectionEdit'

const makeGrid = () => new IsometricGrid({ cols: 8, rows: 8, cellSize: 32, isoScale: 1.4 })
const nonFloor = (g: IsometricGrid) => g.assets.filter(a => a.type !== 'floor')

describe('removeSelectedBlock — removes the SELECTED tile(s) by stack slot, never the floor', () => {
  test('a "col,row,stackIndex" key removes the ONE tile at that slot, leaving the rest + the floor intact', () => {
    const g = makeGrid()
    g.setGround(5, 5, 'grass') // floor = stack slot 0
    g.placeAsset(['🌲'], 5, 5, { type: 'tree', heightLevel: 1 }) // slot 1
    const middle = g.placeAsset(['🪨'], 5, 5, { type: 'rock', heightLevel: 2 }) // slot 2
    g.placeAsset(['🍃'], 5, 5, { type: 'leaf', heightLevel: 3 }) // slot 3

    removeSelectedBlock(g, ['5,5,2']) // stack slot 2 → `middle` (the rock)

    expect(g.assets).not.toContain(middle)
    expect(nonFloor(g)).toHaveLength(2)
    expect(nonFloor(g).map(a => a.type).sort()).toEqual(['leaf', 'tree'])
    expect(g.groundAt(5, 5)).toBe('grass') // floor untouched
  })

  test('removes EVERY tile across a multi-tile selection (each keyed by its own slot)', () => {
    const g = makeGrid()
    g.setGround(1, 1, 'grass'); g.setGround(2, 2, 'grass'); g.setGround(3, 3, 'grass')
    const tree = g.placeAsset(['🌲'], 1, 1, { type: 'tree', heightLevel: 1 }) // slot 1
    const rock = g.placeAsset(['🪨'], 2, 2, { type: 'rock', heightLevel: 1 }) // slot 1
    // a tall wall: ONE asset (scaleY 3) — a collapsed vertical run — so it is a SINGLE stack slot, not three.
    const wall = g.placeAsset(['🧱'], 3, 3, { type: 'wall', heightLevel: 1 }); wall.scaleY = 3 // slot 1

    removeSelectedBlock(g, ['1,1,1', '2,2,1', '3,3,1'])

    expect(nonFloor(g)).toHaveLength(0)
    expect(g.assets).not.toContain(tree)
    expect(g.assets).not.toContain(rock)
    expect(g.assets).not.toContain(wall)
    expect(g.groundAt(1, 1)).toBe('grass') // every floor survives
  })

  test('a tall collapsed wall is ONE stack slot — its single key removes the whole wall (no run math)', () => {
    const g = makeGrid()
    g.setGround(4, 4, 'grass')
    const wall = g.placeAsset(['🧱'], 4, 4, { type: 'wall', heightLevel: 1 }); wall.scaleY = 3 // slot 1, spans 3 levels
    removeSelectedBlock(g, ['4,4,1']) // the wall's OWN slot
    expect(nonFloor(g)).toHaveLength(0)
    expect(g.groundAt(4, 4)).toBe('grass')
  })

  test('the FLOOR slot (stackIndex 0) is floor-safe — a key at slot 0 removes nothing', () => {
    const g = makeGrid()
    g.setGround(5, 5, 'grass') // floor = slot 0
    const tree = g.placeAsset(['🌲'], 5, 5, { type: 'tree', heightLevel: 1 }) // slot 1

    removeSelectedBlock(g, ['5,5,0']) // point at the floor slot

    expect(g.groundAt(5, 5)).toBe('grass') // floor intact — never removable here (Clear tiles owns the ground)
    expect(g.assets).toContain(tree)     // and the stacked tile is untouched
  })

  test('a bare "col,row" cell key removes nothing (no tile slot to target)', () => {
    const g = makeGrid()
    g.setGround(5, 5, 'grass')
    const tree = g.placeAsset(['🌲'], 5, 5, { type: 'tree', heightLevel: 1 })

    removeSelectedBlock(g, ['5,5'])

    expect(g.groundAt(5, 5)).toBe('grass')
    expect(g.assets).toContain(tree)
  })

  test('re-derives collision: removing the only blocker unblocks the cell', () => {
    const g = makeGrid()
    g.setGround(5, 5, 'grass') // slot 0
    g.placeAsset(['🏠'], 5, 5, { type: 'house', heightLevel: 1, blocking: true }) // slot 1
    g.placeAsset(['🍃'], 5, 5, { type: 'leaf', heightLevel: 2 }) // slot 2
    expect(g.isBlocked(5, 5)).toBe(true)

    removeSelectedBlock(g, ['5,5,1']) // remove the blocking house (slot 1)

    expect(g.isBlocked(5, 5)).toBe(false)
    expect(nonFloor(g).map(a => a.type)).toEqual(['leaf'])
  })

  test('collision stays blocked when a blocker remains after the removal', () => {
    const g = makeGrid()
    g.setGround(5, 5, 'grass') // slot 0
    g.placeAsset(['🏠'], 5, 5, { type: 'house', heightLevel: 1, blocking: true }) // slot 1
    g.placeAsset(['🍃'], 5, 5, { type: 'leaf', heightLevel: 2 }) // slot 2
    expect(g.isBlocked(5, 5)).toBe(true)

    removeSelectedBlock(g, ['5,5,2']) // remove the non-blocking leaf (slot 2)

    expect(g.isBlocked(5, 5)).toBe(true) // house still blocks
    expect(nonFloor(g).map(a => a.type)).toEqual(['house'])
  })

  test('a slot with no tile there is a no-op for that key (nothing to remove)', () => {
    const g = makeGrid()
    g.setGround(5, 5, 'grass')
    g.placeAsset(['🌲'], 5, 5, { type: 'tree', heightLevel: 1 })

    removeSelectedBlock(g, ['5,5,7']) // no tile at stack slot 7

    expect(nonFloor(g)).toHaveLength(1)
  })

  test('two slot keys on the SAME cell remove BOTH stacked tiles (no shared global index)', () => {
    const g = makeGrid()
    g.setGround(6, 6, 'grass') // slot 0
    g.placeAsset(['🌲'], 6, 6, { type: 'tree', heightLevel: 1 }) // slot 1
    g.placeAsset(['🪨'], 6, 6, { type: 'rock', heightLevel: 2 }) // slot 2

    removeSelectedBlock(g, ['6,6,1', '6,6,2'])

    expect(nonFloor(g)).toHaveLength(0)
    expect(g.groundAt(6, 6)).toBe('grass') // floor stays
  })
})
