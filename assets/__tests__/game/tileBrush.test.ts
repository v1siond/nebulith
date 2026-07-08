/**
 * TILE-BRUSH GRID SCENARIOS — the editor's pick-first brush against a real IsometricGrid. Validates the
 * user's model end-to-end at the primitive level: pick a tile → placing it changes the RIGHT thing
 * (terrain replaces ground, nature/buildings STACK as cell assets), placing on several cells is bulk,
 * ⌥Alt removes the TOP of a stack, and collision follows the stack (a blocking asset in the pile blocks).
 */
import { IsometricGrid } from '@/engine/IsometricGrid'
import { tilesForStyle, type TileDef } from '@/game/artStyle'
import { placeGroundTile, removeTopAsset, stackAssetTile } from '@/game/editor/tileBrush'

const EMOJI = tilesForStyle('emoji')
const byId = (id: string): TileDef => {
  const t = Object.values(EMOJI).flat().find(x => x.id === id)
  if (!t) throw new Error(`tile ${id} not in the emoji catalog`)
  return t
}
const makeGrid = () => new IsometricGrid({ cols: 6, rows: 6, cellSize: 32, isoScale: 1.4 })

describe('placeGroundTile — terrain replaces the cell ground', () => {
  test('sets ground[row][col] to the tile slug', () => {
    const g = makeGrid()
    placeGroundTile(g, 2, 3, byId('emoji:deep-water'))
    expect(g.ground[3][2]).toBe('deep-water') // row-major (col=2,row=3)
  })
  test('a second terrain tile REPLACES the ground (one ground per cell, not a stack)', () => {
    const g = makeGrid()
    placeGroundTile(g, 1, 1, byId('emoji:deep-water'))
    placeGroundTile(g, 1, 1, byId('emoji:desert'))
    expect(g.ground[1][1]).toBe('desert')
  })
})

describe('stackAssetTile — nature/buildings stack as cell assets', () => {
  test('one place → one asset at level 0, pinned to the exact tile', () => {
    const g = makeGrid()
    stackAssetTile(g, 1, 1, byId('emoji:pine-tree'))
    const stack = g.getAssetsAtCell(1, 1)
    expect(stack).toHaveLength(1)
    expect(stack[0].heightLevel).toBe(0)
    expect(stack[0].tileOverride).toBe('emoji:pine-tree')
    expect(stack[0].type).toBe('tree')
  })

  test('repeated places STACK — each one level higher, all kept, in order', () => {
    const g = makeGrid()
    stackAssetTile(g, 1, 1, byId('emoji:pine-tree'))
    stackAssetTile(g, 1, 1, byId('emoji:oak-tree'))
    stackAssetTile(g, 1, 1, byId('emoji:boulder'))
    const stack = g.getAssetsAtCell(1, 1)
    expect(stack.map(a => a.heightLevel)).toEqual([0, 1, 2])
    expect(stack.map(a => a.tileOverride)).toEqual(['emoji:pine-tree', 'emoji:oak-tree', 'emoji:boulder'])
  })

  test('stacking on top of a pre-existing generator asset (no heightLevel) lands at level 1', () => {
    const g = makeGrid()
    g.placeAsset(['🌲'], 2, 2, { type: 'tree', blocking: true }) // heightLevel undefined (→ 0)
    stackAssetTile(g, 2, 2, byId('emoji:oak-tree'))
    const stack = g.getAssetsAtCell(2, 2)
    expect(stack).toHaveLength(2)
    expect(stack[stack.length - 1].heightLevel).toBe(1)
  })

  test('a blocking tile (building) marks the cell collision; a flower does not', () => {
    const g = makeGrid()
    expect(g.isBlocked(3, 3)).toBe(false)
    stackAssetTile(g, 3, 3, byId('emoji:house')) // building → blocking
    expect(g.isBlocked(3, 3)).toBe(true)

    stackAssetTile(g, 4, 4, byId('emoji:rose')) // flower → non-blocking
    expect(g.isBlocked(4, 4)).toBe(false)
  })
})

describe('bulk placement — the same armed tile on several cells', () => {
  test('placing on each selected cell gives every cell its own asset', () => {
    const g = makeGrid()
    const tree = byId('emoji:pine-tree')
    const cells: Array<[number, number]> = [[0, 0], [1, 0], [2, 0], [3, 0]]
    for (const [c, r] of cells) stackAssetTile(g, c, r, tree) // the page loops the selection like this
    for (const [c, r] of cells) {
      const s = g.getAssetsAtCell(c, r)
      expect(s).toHaveLength(1)
      expect(s[0].tileOverride).toBe('emoji:pine-tree')
    }
    expect(g.assets).toHaveLength(4)
  })
})

describe('removeTopAsset — ⌥Alt remove + collision recompute', () => {
  test('removes the highest-level asset, leaving the rest of the stack', () => {
    const g = makeGrid()
    stackAssetTile(g, 1, 1, byId('emoji:pine-tree'))
    stackAssetTile(g, 1, 1, byId('emoji:oak-tree'))
    const removed = removeTopAsset(g, 1, 1)
    expect(removed?.tileOverride).toBe('emoji:oak-tree')
    const stack = g.getAssetsAtCell(1, 1)
    expect(stack).toHaveLength(1)
    expect(stack[0].tileOverride).toBe('emoji:pine-tree')
  })

  test('returns null on an empty cell (nothing to remove)', () => {
    const g = makeGrid()
    expect(removeTopAsset(g, 5, 5)).toBeNull()
    expect(g.assets).toHaveLength(0)
  })

  test('a cell stays blocked while a blocker remains, unblocks once the last blocker is popped', () => {
    const g = makeGrid()
    stackAssetTile(g, 2, 2, byId('emoji:house')) // blocking building (level 0)
    stackAssetTile(g, 2, 2, byId('emoji:rose'))  // non-blocking flower on top (level 1)
    expect(g.isBlocked(2, 2)).toBe(true)

    removeTopAsset(g, 2, 2) // pop the flower → the blocking house still there
    expect(g.isBlocked(2, 2)).toBe(true)

    removeTopAsset(g, 2, 2) // pop the house → nothing blocking left
    expect(g.isBlocked(2, 2)).toBe(false)
    expect(g.getAssetsAtCell(2, 2)).toHaveLength(0)
  })
})
