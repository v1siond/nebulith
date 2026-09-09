/**
 * A HAND-PAINTED TILE KEEPS ITS BACKEND THICKNESS.
 *
 * `composition.ts` claims thickness applies "WHEREVER it is placed — generator-stamped or hand-painted".
 * Only the first half was true: the stamp path reads `tile.settings.scaleZ`, but the paint brush ran
 * everything through `tileRenderBehavior`, which passes only fadeNear / cutawayRoof / minAlpha / display.
 * So the backend served `door` at `scaleZ: 0.3` and the brush placed a full cube — the door stopped
 * reading as a door the moment you painted one by hand.
 *
 * Thickness is backend TILE data (`tile_source.ex:45`: "scaleZ is THICKNESS … a door is a thin panel in
 * the wall, not a full cube"). Placement copies that authored value onto the instance as state; the
 * render only ever reads it.
 */
import { IsometricGrid } from '@/engine/IsometricGrid'
import { replaceTileInPlace, stackAssetTile } from '@/game/editor/tileBrush'
import type { TileDef } from '@/game/artStyle'

const grid = () => new IsometricGrid({ cols: 4, rows: 4, cellSize: 16, isoScale: 2.5 })

/** A tile as the backend serves it — `settings` is the authored blob, verbatim. */
const tile = (id: string, settings?: Record<string, unknown>, height = 1): TileDef => ({
  id,
  label: id,
  category: 'doors',
  styleId: 'emoji',
  visual: { kind: 'image', image: `/tiles/emoji/${id}.png`, color: '#5a3a22' },
  height,
  settings,
} as unknown as TileDef)

/** The real door row, exactly as `/api/tilesets` serves it. */
const DOOR = tile('door', { color: '#5a3a22', fadeNear: true, minAlpha: 0.9, scaleZ: 0.3 })
const WALL = tile('wall_brick', { color: '#9e4b3b' })

const topAsset = (g: IsometricGrid, col = 1, row = 1) => {
  const stack = g.getAssetsAtCell(col, row)
  return stack[stack.length - 1]
}

describe('painting a tile carries its authored thickness', () => {
  it('a painted door is thin, like a stamped one', () => {
    const g = grid()
    stackAssetTile(g, 1, 1, DOOR)
    expect(topAsset(g).scaleZ).toBe(0.3)
  })

  it('a tile with no authored thickness is left alone — a full block, unchanged', () => {
    const g = grid()
    stackAssetTile(g, 1, 1, WALL)
    expect(topAsset(g).scaleZ).toBeUndefined()
  })

  it('does not disturb the render behaviour the brush already carried', () => {
    const g = grid()
    stackAssetTile(g, 1, 1, DOOR)
    expect(topAsset(g).settings).toMatchObject({ fadeNear: true, minAlpha: 0.9 })
  })

  it('ignores a malformed thickness rather than collapsing the block', () => {
    const g = grid()
    stackAssetTile(g, 1, 1, tile('bad', { scaleZ: 'thin' }))
    expect(topAsset(g).scaleZ).toBeUndefined()
  })

  it('ignores a zero or negative thickness — a block cannot have none', () => {
    const g = grid()
    stackAssetTile(g, 1, 1, tile('zero', { scaleZ: 0 }))
    stackAssetTile(g, 2, 1, tile('neg', { scaleZ: -1 }))
    expect(topAsset(g).scaleZ).toBeUndefined()
    expect(topAsset(g, 2, 1).scaleZ).toBeUndefined()
  })
})

describe('replacing a tile in place swaps its thickness too', () => {
  it('swapping a wall for a door makes the slot thin', () => {
    const g = grid()
    stackAssetTile(g, 1, 1, WALL)
    const index = g.getAssetsAtCell(1, 1).length - 1
    expect(replaceTileInPlace(g, 1, 1, index, DOOR)).toBe(true)
    expect(topAsset(g).scaleZ).toBe(0.3)
  })

  it('swapping a door back for a wall CLEARS the thickness — no leftover thinness', () => {
    const g = grid()
    stackAssetTile(g, 1, 1, DOOR)
    const index = g.getAssetsAtCell(1, 1).length - 1
    expect(replaceTileInPlace(g, 1, 1, index, WALL)).toBe(true)
    expect(topAsset(g).scaleZ).toBeUndefined()
  })
})
