import '@/__tests__/helpers/installTilesetSeed' // install the DB-equivalent tileset the runtime loads
/**
 * TILE-BRUSH GRID SCENARIOS — the editor's pick-first brush against a real IsometricGrid. Validates the
 * user's model end-to-end at the primitive level: pick a tile → placing it changes the RIGHT thing
 * (terrain replaces ground, nature/buildings STACK as cell assets), placing on several cells is bulk,
 * ⌥Alt removes the TOP of a stack, and collision follows the stack (a blocking asset in the pile blocks).
 */
import { IsometricGrid, type GridAsset } from '@/engine/IsometricGrid'
import { tilesForStyle, type TileDef } from '@/game/artStyle'
import { placeGroundTile, removeTopAsset, removeAssetAtLevel, stackAssetTile } from '@/game/editor/tileBrush'

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

  test('a painted tile NEVER pins a "?" dingbat into its art (resolved by label→image, not a glyph)', () => {
    const g = makeGrid()
    // Every browseable stackable tile (nature + buildings) — its pinned art fallback is a real glyph or ''
    // (image tiles resolve via tileOverride), never the '?' the old tileChar stamped for an image/ascii tile.
    const stackable = [...EMOJI.nature, ...EMOJI.buildings]
    expect(stackable.length).toBeGreaterThan(10)
    let c = 0
    for (const tile of stackable) {
      stackAssetTile(g, c % 6, Math.floor(c / 6) % 6, tile); c++ // wrap into the 6×6 grid (stacking is fine here)
    }
    for (const a of g.assets) for (const ch of a.art) expect(ch).not.toBe('?')
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

// A PAINTED tile must behave EXACTLY like a GENERATED one (#52): a normal, editable asset that inherits the
// DB tile's BLOCK height + settings — so a block tile paints as a block (not a flat single-face billboard),
// its own render behaviour rides along, and NOTHING is forced to a single flat default.
describe('painted tile === generated tile — DB height + settings seed onto the asset', () => {
  const stackedAt = (g: IsometricGrid, col: number, row: number): GridAsset[] =>
    [...g.getAssetsAtCell(col, row)].sort((a, b) => (a.heightLevel ?? 0) - (b.heightLevel ?? 0))

  test('a DB BLOCK tile (boulder, height 1) paints as a real BLOCK — asset.height = 1, not flat', () => {
    const g = makeGrid()
    const boulder = byId('emoji:boulder')
    expect(boulder.height).toBe(1) // the palette tile carries the DB block height (single source of truth)
    stackAssetTile(g, 2, 2, boulder)
    expect(g.getAssetsAtCell(2, 2)[0].height).toBe(1)
  })

  test('a DB block wall carries its OWN render behaviour (fadeNear) — the SAME settings a stamped wall gets', () => {
    const g = makeGrid()
    stackAssetTile(g, 1, 1, byId('emoji:wall_stone_c'))
    const a = g.getAssetsAtCell(1, 1)[0]
    expect(a.height).toBe(1)
    expect(a.settings?.fadeNear).toBe(true)
  })

  test('a roof tile carries cutawayRoof from its DB settings', () => {
    const g = makeGrid()
    stackAssetTile(g, 1, 1, byId('emoji:roof'))
    expect(g.getAssetsAtCell(1, 1)[0].settings?.cutawayRoof).toBe(true)
  })

  test('a FLAT tile (a flower) is NOT forced to a block NOR to display:single — it stays the tile the DB defines', () => {
    const g = makeGrid()
    const rose = byId('emoji:rose')
    expect(rose.height ?? 0).toBe(0)
    stackAssetTile(g, 3, 3, rose)
    const a = g.getAssetsAtCell(3, 3)[0]
    expect(a.height).toBeUndefined()           // no fake block height forced onto a flat tile
    expect(a.settings?.display).toBeUndefined() // NOT forced single — the user's "always single type" complaint
  })

  test('every painted tile is a normal EDITABLE asset — its per-instance settings (shape/colour) are writable', () => {
    const g = makeGrid()
    stackAssetTile(g, 2, 2, byId('emoji:boulder'))
    const a = g.getAssetsAtCell(2, 2)[0]
    // the SAME writes the inspector's setAssetShape / setAssetColor perform on the selected tile
    a.shape = 'circle'
    a.color = '#123456'
    expect(a.shape).toBe('circle')
    expect(a.color).toBe('#123456')
  })

  // #52/#53 requirement 3 (paint a tile onto MULTIPLE cells) + 4 (edit settings across MANY selected tiles):
  // painting fans out per cell and a single settings edit reaches every selected tile.
  test('multi-cell paint: each of N cells gets its own editable BLOCK asset (DB height carried per cell)', () => {
    const g = makeGrid()
    const boulder = byId('emoji:boulder')
    const cells: Array<[number, number]> = [[0, 0], [1, 1], [2, 2], [3, 3]]
    for (const [c, r] of cells) stackAssetTile(g, c, r, boulder) // the page loops the multi-cell selection like this
    for (const [c, r] of cells) expect(g.getAssetsAtCell(c, r)[0].height).toBe(1)
    expect(g.assets).toHaveLength(4)
  })

  test('multi-tile settings edit FANS OUT to every selected tile (the inspector writer pattern)', () => {
    const g = makeGrid()
    const cells: Array<[number, number]> = [[0, 0], [1, 1], [2, 2]]
    for (const [c, r] of cells) stackAssetTile(g, c, r, byId('emoji:boulder'))
    // Mirror setAssetColor(i): apply to the i-th stacked tile of EVERY selected cell (applyToSelectedCells).
    const applyToSelection = (i: number, fn: (a: GridAsset) => void): void => {
      for (const [c, r] of cells) { const a = stackedAt(g, c, r)[i]; if (a) fn(a) }
    }
    applyToSelection(0, a => { a.color = '#ff8800'; a.shape = 'circle' })
    for (const [c, r] of cells) {
      const a = g.getAssetsAtCell(c, r)[0]
      expect(a.color).toBe('#ff8800')
      expect(a.shape).toBe('circle')
    }
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

describe('removeAssetAtLevel — ⌥Alt removes the block you POINT at, not blindly the top', () => {
  test('removes the asset at the given heightLevel, leaving the rest of the stack intact', () => {
    const g = makeGrid()
    stackAssetTile(g, 1, 1, byId('emoji:pine-tree')) // level 0
    stackAssetTile(g, 1, 1, byId('emoji:oak-tree'))  // level 1
    stackAssetTile(g, 1, 1, byId('emoji:boulder'))   // level 2 (top)
    const removed = removeAssetAtLevel(g, 1, 1, 1)    // point at the MIDDLE block
    expect(removed?.tileOverride).toBe('emoji:oak-tree')
    // the top (boulder) and bottom (pine) survive — only the pointed block is gone
    expect(g.getAssetsAtCell(1, 1).map(a => a.tileOverride)).toEqual(['emoji:pine-tree', 'emoji:boulder'])
  })

  test('re-derives collision: removing the only blocker unblocks the cell even if a non-blocker stays', () => {
    const g = makeGrid()
    stackAssetTile(g, 2, 2, byId('emoji:rose'))  // non-blocking flower (level 0)
    stackAssetTile(g, 2, 2, byId('emoji:house')) // blocking building (level 1, top)
    expect(g.isBlocked(2, 2)).toBe(true)
    removeAssetAtLevel(g, 2, 2, 1) // remove the blocker specifically
    expect(g.isBlocked(2, 2)).toBe(false)
    expect(g.getAssetsAtCell(2, 2).map(a => a.tileOverride)).toEqual(['emoji:rose'])
  })

  test('returns null when no asset sits at that level (nothing removed)', () => {
    const g = makeGrid()
    stackAssetTile(g, 3, 3, byId('emoji:pine-tree')) // level 0 only
    expect(removeAssetAtLevel(g, 3, 3, 2)).toBeNull()
    expect(g.getAssetsAtCell(3, 3)).toHaveLength(1)
  })
})
