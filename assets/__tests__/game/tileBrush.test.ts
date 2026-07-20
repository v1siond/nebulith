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
import { tileSlug } from '@/game/editor/tilePlacement'

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
    expect(stack[0].type).toBe('pine-tree') // the tile's OWN slug, not a classified category
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

// A PAINTED tile carries its OWN block height as DATA and the brush reads it through ONE uniform path — no
// type/category/art-style branch. A STANDING tile (DB height ≥1) paints as an extruded 3D block; a GROUND/FLAT
// tile (DB height 0 — flower, leaf, facade piece) paints FLAT (floor face only in iso). Its own authored
// render behaviour (settings) rides along, and NOTHING is forced. The user can override any of it per-tile.
describe('painted tile — its OWN height + settings seed onto the asset (uniform read, no type branch)', () => {
  const stackedAt = (g: IsometricGrid, col: number, row: number): GridAsset[] =>
    [...g.getAssetsAtCell(col, row)].sort((a, b) => (a.heightLevel ?? 0) - (b.heightLevel ?? 0))

  test('a boulder paints as a real BLOCK — asset.height = its own DB height (1)', () => {
    const g = makeGrid()
    stackAssetTile(g, 2, 2, byId('emoji:boulder'))
    expect(g.getAssetsAtCell(2, 2)[0].height).toBe(1)
  })

  test('a DB block wall carries its OWN render behaviour (fadeNear) — the SAME settings a stamped wall gets', () => {
    const g = makeGrid()
    stackAssetTile(g, 1, 1, byId('emoji:wall_stone_c'))
    const a = g.getAssetsAtCell(1, 1)[0]
    expect(a.height).toBe(1)
    expect(a.settings?.fadeNear).toBe(true)
  })

  test('a roof tile carries cutawayRoof from its DB settings (and inserts flat — its DB height is 0)', () => {
    const g = makeGrid()
    stackAssetTile(g, 1, 1, byId('emoji:roof'))
    const a = g.getAssetsAtCell(1, 1)[0]
    expect(a.settings?.cutawayRoof).toBe(true)
    expect(a.height).toBe(0) // a facade piece is flat (floor face) — its own DB height, not a forced block
  })

  test('a flower inserts FLAT (its own DB height 0 — floor face only in iso) and never forced to display:single', () => {
    const g = makeGrid()
    stackAssetTile(g, 3, 3, byId('emoji:rose'))
    const a = g.getAssetsAtCell(3, 3)[0]
    expect(a.height).toBe(0)                    // ground/flat tile — its own height, walkable, no extrusion
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

// THE PAINTER BUG (user: "painter … only applies the cube/block on iso when I increase the z-width, it's
// still inserted on the map as single and not as all faces on iso"). A STANDING building tile (DB height ≥1)
// inserts as an all-faces 3D BLOCK immediately — NO z-width needed, NOTHING forced to display:single. Its
// block height is read straight from the tile's own DB height, so there is no drift back to a flat billboard.
describe('painted building tiles insert as all-faces 3D blocks by default (the painter bug)', () => {
  test.each(['emoji:wall', 'emoji:house', 'emoji:castle'])('%s paints as a block (its own DB height ≥1), all-faces, no z-width', (id) => {
    const g = makeGrid()
    stackAssetTile(g, 1, 1, byId(id))
    const a = g.getAssetsAtCell(1, 1)[0]
    expect(a.height).toBeGreaterThanOrEqual(1)  // a real extruded block, not a flat billboard
    expect(a.settings?.display).toBeUndefined() // absent == all-faces (never forced to single)
    expect(a.depth ?? 1).toBe(1)                // it's a block with NO Z-Width applied
    expect(a.blocking).toBe(true)               // above-ground → blocks the cell
  })

  test('a wall keeps its own render behaviour (fadeNear) while still defaulting to all-faces', () => {
    const g = makeGrid()
    stackAssetTile(g, 2, 2, byId('emoji:wall'))
    const a = g.getAssetsAtCell(2, 2)[0]
    expect(a.settings?.fadeNear).toBe(true)     // the DB tile's own behaviour rides along
    expect(a.settings?.display).toBeUndefined() // but display stays default (all-faces)
  })

  test('terrain routes to the floor (placeGroundTile), never a stacked block', () => {
    const g = makeGrid()
    placeGroundTile(g, 4, 4, byId('emoji:grass'))
    expect(g.getAssetsAtCell(4, 4)).toHaveLength(0)
  })
})

// User (Image #60): "the painting … only works for the building tiles. all tiles work the same." Every tile
// inserts through the SAME uniform path — a standing NATURE tile (tree/rock/plant, DB height ≥1) paints as a
// 3D block exactly like a building, while a ground overlay (flower/leaf, DB height 0) paints flat. The split
// is DATA (the tile's own height), never a per-category code branch — and `type` is the tile's own slug.
describe('painted NATURE tiles read their own height through the SAME path as buildings', () => {
  test.each([
    'emoji:tree', 'emoji:palm-tree', 'emoji:pine-tree', 'emoji:rock', 'emoji:bush',
    'emoji:mushroom', 'emoji:crate', 'emoji:lamp', 'emoji:potted-plant',
  ])('%s (a standing nature tile, DB height ≥1) paints as a 3D block, like a building', (id) => {
    const g = makeGrid()
    stackAssetTile(g, 1, 1, byId(id))
    const a = g.getAssetsAtCell(1, 1)[0]
    expect(a.height).toBeGreaterThanOrEqual(1) // its own DB height ≥1 → a real block
    expect(a.blocking).toBe(true)              // above-ground → blocks
    expect(a.type).toBe(tileSlug(id))          // the tile's OWN slug — no classified category
    expect(a.tileOverride).toBe(id)            // the exact palette tile is pinned, so it renders as its own art
  })

  // Ground overlays (flowers, fallen leaves) carry DB height 0 → they insert FLAT (floor face) and WALKABLE,
  // through the SAME code path a tree takes. If the user wants one to stand, that is a per-tile height edit.
  test.each(['emoji:flower', 'emoji:rose', 'emoji:fallen-leaf'])('%s (DB height 0) inserts FLAT + walkable', (id) => {
    const g = makeGrid()
    stackAssetTile(g, 2, 2, byId(id))
    const a = g.getAssetsAtCell(2, 2)[0]
    expect(a.height).toBe(0)      // flat — its own ground-level height
    expect(a.blocking).toBe(false) // ground → walkable
  })
})

// THE definitive model — height is per-tile DATA read through ONE uniform mechanism, with NO type/category/
// art-style branch. Two tiles differ ONLY by the height value they carry: a ground tile inserts flat + walkable,
// a standing tile inserts as a block + blocked. A synthetic tile with height 0 / 2 / 5 inserts at EXACTLY that
// height — proving the brush reads the tile's own height and never forces a constant.
describe('per-tile height, read uniformly — no type/category/style distinction in the mechanism', () => {
  const paintFresh = (tile: TileDef): GridAsset => {
    const g = makeGrid()
    stackAssetTile(g, 0, 0, tile)
    return g.getAssetsAtCell(0, 0)[0]
  }

  test('a flower (height 0) and a building (height ≥1) run the SAME mechanism but carry different height DATA', () => {
    const flower = paintFresh(byId('emoji:rose'))     // ground overlay
    const building = paintFresh(byId('emoji:house'))  // standing block
    expect(flower.height).toBe(0)                     // flat, walkable
    expect(flower.blocking).toBe(false)
    expect(building.height).toBeGreaterThanOrEqual(1) // block, blocked
    expect(building.blocking).toBe(true)
    // same display default (both all-faces) — the mechanism is identical, only the height DATA differs
    expect(flower.settings?.display).toBe(building.settings?.display)
  })

  test('the brush READS the tile’s own height — a synthetic tile with height 0 / 2 / 5 inserts at exactly that height', () => {
    // Proves there is a single uniform height read (no forced constant, no type branch): the placed block
    // count is exactly the catalog tile's height, whatever it is.
    const base = byId('emoji:rose')
    expect(paintFresh({ ...base, height: 0 }).height).toBe(0)
    expect(paintFresh({ ...base, height: 2 }).height).toBe(2)
    expect(paintFresh({ ...base, height: 5 }).height).toBe(5)
    expect(paintFresh({ ...base, height: undefined }).height).toBe(0) // no height DATA → flat
  })

  test('collision derives from height uniformly — height > 0 blocks, height 0 is walkable', () => {
    const base = byId('emoji:rose')
    expect(paintFresh({ ...base, height: 0 }).blocking).toBe(false)
    expect(paintFresh({ ...base, height: 1 }).blocking).toBe(true)
    expect(paintFresh({ ...base, height: 3 }).blocking).toBe(true)
  })

  // The per-tile Blocked/Walkable OVERRIDE (the inspector's cell-collision toggle → grid.setCollision) WINS
  // over the height-derived default, in BOTH directions.
  test('the per-tile collision OVERRIDE wins over the height-derived default (both directions)', () => {
    const g = makeGrid()
    // a flat flower defaults walkable → override it to Blocked
    stackAssetTile(g, 1, 1, byId('emoji:rose'))
    expect(g.isBlocked(1, 1)).toBe(false)
    g.setCollision(1, 1, true) // the inspector's Blocked override
    expect(g.isBlocked(1, 1)).toBe(true)
    // a standing tree defaults blocked → override it to Walkable
    stackAssetTile(g, 2, 2, byId('emoji:pine-tree'))
    expect(g.isBlocked(2, 2)).toBe(true)
    g.setCollision(2, 2, false) // the inspector's Walkable override
    expect(g.isBlocked(2, 2)).toBe(false)
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
