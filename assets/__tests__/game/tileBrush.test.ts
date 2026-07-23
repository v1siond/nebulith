import '@/__tests__/helpers/installTilesetSeed' // install the DB-equivalent tileset the runtime loads
/**
 * TILE-BRUSH GRID SCENARIOS — the editor's pick-first brush against a real IsometricGrid. Validates the
 * user's model end-to-end at the primitive level: pick a tile → placing it changes the RIGHT thing
 * (terrain replaces ground, nature/buildings STACK as cell assets), placing on several cells is bulk,
 * ⌥Alt removes the TOP of a stack, and collision follows the stack (a blocking asset in the pile blocks).
 *
 * FLOOR-STAYS: the grid ctor fills grass, so EVERY cell already carries a floor tile (stack slot 0). Placing
 * a tile STACKS on top of it (never replaces it) — so the placed asset is the FIRST NON-FLOOR entry, read
 * here via `nonFloor()`. The floor slab is only removed by an explicit Clear/⌥Alt-erase, never by placement.
 */
import { IsometricGrid, type GridAsset } from '@/engine/IsometricGrid'
import { tilesForStyle, type TileDef } from '@/game/artStyle'
import { clearGroundTile, placeGroundTile, removeTopAsset, removeAssetAtLevel, stackAssetTile } from '@/game/editor/tileBrush'
import { tileSlug } from '@/game/editor/tilePlacement'
import { captureMapSnapshot, restoreMapSnapshot } from '@/game/editor/mapSnapshot'

const EMOJI = tilesForStyle('emoji')
const byId = (id: string): TileDef => {
  const t = Object.values(EMOJI).flat().find(x => x.id === id)
  if (!t) throw new Error(`tile ${id} not in the emoji catalog`)
  return t
}
const makeGrid = () => new IsometricGrid({ cols: 6, rows: 6, cellSize: 32, isoScale: 1.4 })
// The STACKED (non-floor) tiles at a cell — the placed assets, in stack order (the floor stays at slot 0).
const nonFloor = (g: IsometricGrid, col: number, row: number): GridAsset[] =>
  g.getAssetsAtCell(col, row).filter(a => a.type !== 'floor')

describe('placeGroundTile — terrain replaces the cell ground', () => {
  test('sets ground[row][col] to the tile slug', () => {
    const g = makeGrid()
    placeGroundTile(g, 2, 3, byId('emoji:deep-water'))
    expect(g.groundAt(2, 3)).toBe('deep-water') // row-major (col=2,row=3)
  })
  test('a second terrain tile REPLACES the ground (one ground per cell, not a stack)', () => {
    const g = makeGrid()
    placeGroundTile(g, 1, 1, byId('emoji:deep-water'))
    placeGroundTile(g, 1, 1, byId('emoji:desert'))
    expect(g.groundAt(1, 1)).toBe('desert')
  })
})

describe('stackAssetTile — nature/buildings stack as cell assets (ON TOP of the floor)', () => {
  test('one place → one stacked asset at level 0 (on the floor slab), pinned to the exact tile', () => {
    const g = makeGrid()
    stackAssetTile(g, 1, 1, byId('emoji:pine-tree'))
    const placed = nonFloor(g, 1, 1)
    expect(placed).toHaveLength(1)
    expect(placed[0].heightLevel).toBe(0) // sits at level 0 ON the floor slab (which stays as slot 0)
    expect(placed[0].tileOverride).toBe('emoji:pine-tree')
    expect(placed[0].type).toBe('pine-tree') // the tile's OWN slug, not a classified category
    expect(g.groundAt(1, 1)).toBe('grass')  // the grass floor is NOT removed — it stays beneath
  })

  test('a painted tile NEVER pins a "?" dingbat into its art (resolved by label→image, not a glyph)', () => {
    const g = makeGrid()
    // Every browseable stackable tile (nature + building pieces) — its pinned art fallback is a real glyph or ''
    // (image tiles resolve via tileOverride), never the '?' the old tileChar stamped for an image/ascii tile.
    const stackable = [...EMOJI.nature, ...EMOJI.walls, ...EMOJI.windows, ...EMOJI.doors, ...EMOJI.roofs, ...EMOJI.props]
    expect(stackable.length).toBeGreaterThan(10)
    let c = 0
    for (const tile of stackable) {
      stackAssetTile(g, c % 6, Math.floor(c / 6) % 6, tile); c++ // wrap into the 6×6 grid (stacking is fine here)
    }
    for (const a of g.assets) for (const ch of a.art) expect(ch).not.toBe('?')
  })

  test('repeated places STACK — each one level higher, all kept, in order (above the floor)', () => {
    const g = makeGrid()
    stackAssetTile(g, 1, 1, byId('emoji:pine-tree'))
    stackAssetTile(g, 1, 1, byId('emoji:oak-tree'))
    stackAssetTile(g, 1, 1, byId('emoji:boulder'))
    const placed = nonFloor(g, 1, 1)
    expect(placed.map(a => a.heightLevel)).toEqual([0, 1, 2])
    expect(placed.map(a => a.tileOverride)).toEqual(['emoji:pine-tree', 'emoji:oak-tree', 'emoji:boulder'])
  })

  test('stacking on top of a pre-existing generator asset (no heightLevel) lands at level 1', () => {
    const g = makeGrid()
    g.placeAsset(['🌲'], 2, 2, { type: 'tree', blocking: true }) // heightLevel undefined (→ 0)
    stackAssetTile(g, 2, 2, byId('emoji:oak-tree'))
    const placed = nonFloor(g, 2, 2)
    expect(placed).toHaveLength(2)
    expect(placed[placed.length - 1].heightLevel).toBe(1)
  })

  test('painting is UNIFORMLY walkable by default — a tall building and a flat flower both land walkable (no type branch)', () => {
    const g = makeGrid()
    expect(g.isBlocked(3, 3)).toBe(false)
    stackAssetTile(g, 3, 3, byId('emoji:house')) // a tall building paints WALKABLE by default — no type/height rule
    expect(g.isBlocked(3, 3)).toBe(false)

    stackAssetTile(g, 4, 4, byId('emoji:rose')) // a flat flower paints WALKABLE too — the SAME uniform default
    expect(g.isBlocked(4, 4)).toBe(false)

    // collision is a per-cell SETTING: the inspector's Blocked toggle blocks the cell regardless of the tile
    g.setCollision(3, 3, true)
    expect(g.isBlocked(3, 3)).toBe(true)
  })
})

describe('bulk placement — the same armed tile on several cells', () => {
  test('placing on each selected cell gives every cell its own asset', () => {
    const g = makeGrid()
    const tree = byId('emoji:pine-tree')
    const cells: Array<[number, number]> = [[0, 0], [1, 0], [2, 0], [3, 0]]
    for (const [c, r] of cells) stackAssetTile(g, c, r, tree) // the page loops the selection like this
    for (const [c, r] of cells) {
      const s = nonFloor(g, c, r)
      expect(s).toHaveLength(1)
      expect(s[0].tileOverride).toBe('emoji:pine-tree')
    }
    expect(g.assets.filter(a => a.type !== 'floor')).toHaveLength(4)
  })
})

// A PAINTED tile carries its OWN block height as DATA and the brush reads it through ONE uniform path — no
// type/category/art-style branch. A STANDING tile (DB height ≥1) paints as an extruded 3D block; a GROUND/FLAT
// tile (DB height 0 — flower, leaf, facade piece) paints FLAT (floor face only in iso). Its own authored
// render behaviour (settings) rides along, and NOTHING is forced. The user can override any of it per-tile.
describe('painted tile — its OWN height + settings seed onto the asset (uniform read, no type branch)', () => {
  test('a boulder paints as a real BLOCK — asset.height = its own DB height (1)', () => {
    const g = makeGrid()
    stackAssetTile(g, 2, 2, byId('emoji:boulder'))
    expect(nonFloor(g, 2, 2)[0].height).toBe(1)
  })

  test('a DB block wall carries its OWN render behaviour (fadeNear) — the SAME settings a stamped wall gets', () => {
    const g = makeGrid()
    stackAssetTile(g, 1, 1, byId('emoji:wall_stone_c'))
    const a = nonFloor(g, 1, 1)[0]
    expect(a.height).toBe(1)
    expect(a.settings?.fadeNear).toBe(true)
  })

  test('a roof tile carries cutawayRoof from its DB settings (and inserts flat — its DB height is 0)', () => {
    const g = makeGrid()
    stackAssetTile(g, 1, 1, byId('emoji:roof'))
    const a = nonFloor(g, 1, 1)[0]
    expect(a.settings?.cutawayRoof).toBe(true)
    expect(a.height).toBe(0) // a facade piece is flat (floor face) — its own DB height, not a forced block
  })

  test('a flower inserts FLAT (its own DB height 0 — floor face only in iso) and never forced to display:single', () => {
    const g = makeGrid()
    stackAssetTile(g, 3, 3, byId('emoji:rose'))
    const a = nonFloor(g, 3, 3)[0]
    expect(a.height).toBe(0)                    // ground/flat tile — its own height, walkable, no extrusion
    expect(a.settings?.display).toBeUndefined() // NOT forced single — the user's "always single type" complaint
  })

  test('every painted tile is a normal EDITABLE asset — its per-instance settings (shape/colour) are writable', () => {
    const g = makeGrid()
    stackAssetTile(g, 2, 2, byId('emoji:boulder'))
    const a = nonFloor(g, 2, 2)[0]
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
    for (const [c, r] of cells) expect(nonFloor(g, c, r)[0].height).toBe(1)
    expect(g.assets.filter(a => a.type !== 'floor')).toHaveLength(4)
  })

  test('multi-tile settings edit FANS OUT to every selected tile (the inspector writer pattern)', () => {
    const g = makeGrid()
    const cells: Array<[number, number]> = [[0, 0], [1, 1], [2, 2]]
    for (const [c, r] of cells) stackAssetTile(g, c, r, byId('emoji:boulder'))
    // Mirror setAssetColor: apply to the i-th STACKED (non-floor) tile of EVERY selected cell (applyToSelectedCells).
    const applyToSelection = (i: number, fn: (a: GridAsset) => void): void => {
      for (const [c, r] of cells) { const a = nonFloor(g, c, r)[i]; if (a) fn(a) }
    }
    applyToSelection(0, a => { a.color = '#ff8800'; a.shape = 'circle' })
    for (const [c, r] of cells) {
      const a = nonFloor(g, c, r)[0]
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
    const a = nonFloor(g, 1, 1)[0]
    expect(a.height).toBeGreaterThanOrEqual(1)  // a real extruded block, not a flat billboard
    expect(a.settings?.display).toBeUndefined() // absent == all-faces (never forced to single)
    expect(a.depth ?? 1).toBe(1)                // it's a block with NO Z-Width applied
    expect(a.blocking).toBe(false)              // WALKABLE by default — height NEVER forces collision (a per-cell setting)
  })

  test('a wall keeps its own render behaviour (fadeNear) while still defaulting to all-faces', () => {
    const g = makeGrid()
    stackAssetTile(g, 2, 2, byId('emoji:wall'))
    const a = nonFloor(g, 2, 2)[0]
    expect(a.settings?.fadeNear).toBe(true)     // the DB tile's own behaviour rides along
    expect(a.settings?.display).toBeUndefined() // but display stays default (all-faces)
  })

  test('terrain routes to the floor (placeGroundTile), never a stacked block', () => {
    const g = makeGrid()
    placeGroundTile(g, 4, 4, byId('emoji:grass'))
    expect(nonFloor(g, 4, 4)).toHaveLength(0)
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
    const a = nonFloor(g, 1, 1)[0]
    expect(a.height).toBeGreaterThanOrEqual(1) // its own DB height ≥1 → a real block
    expect(a.blocking).toBe(false)             // WALKABLE by default — height does not force collision
    expect(a.type).toBe(tileSlug(id))          // the tile's OWN slug — no classified category
    expect(a.tileOverride).toBe(id)            // the exact palette tile is pinned, so it renders as its own art
  })

  // Ground overlays (flowers, fallen leaves) carry DB height 0 → they insert FLAT (floor face), through the
  // SAME code path a tree takes. If the user wants one to stand, that is a per-tile height edit.
  test.each(['emoji:flower', 'emoji:rose', 'emoji:fallen-leaf'])('%s (DB height 0) inserts FLAT + walkable', (id) => {
    const g = makeGrid()
    stackAssetTile(g, 2, 2, byId(id))
    const a = nonFloor(g, 2, 2)[0]
    expect(a.height).toBe(0)       // flat — its own ground-level height
    expect(a.blocking).toBe(false) // WALKABLE by the uniform default (same as every tile — not because height is 0)
  })
})

// THE definitive model — height is per-tile DATA read through ONE uniform mechanism, with NO type/category/
// art-style branch. Two tiles differ ONLY by the height value they carry: a ground tile inserts flat, a
// standing tile inserts as a block — but BOTH paint with the identical uniform WALKABLE collision default
// (collision is a per-cell setting, decoupled from height). A synthetic tile with height 0 / 2 / 5 inserts at
// EXACTLY that height — proving the brush reads the tile's own height and never forces a constant.
describe('per-tile height, read uniformly — no type/category/style distinction in the mechanism', () => {
  const paintFresh = (tile: TileDef): GridAsset => {
    const g = makeGrid()
    stackAssetTile(g, 0, 0, tile)
    return nonFloor(g, 0, 0)[0] // the placed tile (the floor stays at slot 0)
  }

  test('a flower (height 0) and a building (height ≥1) run the SAME mechanism but carry different height DATA', () => {
    const flower = paintFresh(byId('emoji:rose'))     // ground overlay
    const building = paintFresh(byId('emoji:house'))  // standing block
    expect(flower.height).toBe(0)                     // flat
    expect(building.height).toBeGreaterThanOrEqual(1) // block
    // collision is the SAME uniform walkable default for BOTH — height does not change it (fully decoupled)
    expect(flower.blocking).toBe(false)
    expect(building.blocking).toBe(false)
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

  // COLLISION IS NOT DERIVED FROM HEIGHT (the user's rule: "collision is a setting … a 4 blocks tall
  // projection which is all walkable"). Every painted tile — height 0, 1, 3 or 4 — lands with the SAME
  // uniform walkable default. Height and collision are fully decoupled.
  test('collision does NOT depend on height — every painted tile is walkable by default (height 0 / 1 / 3 / 4)', () => {
    const base = byId('emoji:rose')
    expect(paintFresh({ ...base, height: 0 }).blocking).toBe(false)
    expect(paintFresh({ ...base, height: 1 }).blocking).toBe(false)
    expect(paintFresh({ ...base, height: 3 }).blocking).toBe(false)
    expect(paintFresh({ ...base, height: 4 }).blocking).toBe(false) // a 4-block-tall projection is WALKABLE
  })

  // The INSERT PATH has NO type/category/height branch for collision: paint a building, a standing nature
  // block and a flat flower — all different type, category AND height — and every one gets the byte-identical
  // walkable default. If any branch existed, one of these would differ.
  test('the insert path has NO type/category/height branch for collision — every tile gets the identical default', () => {
    const building = paintFresh(byId('emoji:house'))     // building category, height ≥1
    const nature = paintFresh(byId('emoji:pine-tree'))   // nature category, height ≥1
    const flower = paintFresh(byId('emoji:rose'))        // nature overlay, height 0
    expect(building.blocking).toBe(false)
    expect(nature.blocking).toBe(false)
    expect(flower.blocking).toBe(false)
    expect(new Set([building.blocking, nature.blocking, flower.blocking]).size).toBe(1) // one uniform default
  })

  // Collision is a per-cell SETTING the user drives (inspector Blocked/Walkable → grid.setCollision), fully
  // decoupled from height: a TALL painted tile is walkable until the user blocks it, a FLAT tile can be blocked
  // too, and a blocked cell can go back to walkable — height neither forces nor prevents any of it.
  test('the Blocked/Walkable SETTING drives collision regardless of height (both directions)', () => {
    const g = makeGrid()
    // a 4-block-tall painted projection defaults WALKABLE, then the user sets it Blocked, then Walkable again
    stackAssetTile(g, 1, 1, { ...byId('emoji:rose'), height: 4 })
    expect(g.isBlocked(1, 1)).toBe(false) // tall, but walkable by default — no height→collision
    g.setCollision(1, 1, true)            // the inspector's Blocked toggle
    expect(g.isBlocked(1, 1)).toBe(true)
    g.setCollision(1, 1, false)           // and back to Walkable
    expect(g.isBlocked(1, 1)).toBe(false)
    // a FLAT (height 0) painted tile can be set Blocked all the same — collision is not tied to height
    stackAssetTile(g, 2, 2, { ...byId('emoji:rose'), height: 0 })
    expect(g.isBlocked(2, 2)).toBe(false)
    g.setCollision(2, 2, true)
    expect(g.isBlocked(2, 2)).toBe(true)
  })
})

describe('removeTopAsset — ⌥Alt remove + collision recompute', () => {
  test('removes the highest-level asset, leaving the rest of the stack (and the floor)', () => {
    const g = makeGrid()
    stackAssetTile(g, 1, 1, byId('emoji:pine-tree'))
    stackAssetTile(g, 1, 1, byId('emoji:oak-tree'))
    const removed = removeTopAsset(g, 1, 1)
    expect(removed?.tileOverride).toBe('emoji:oak-tree')
    const placed = nonFloor(g, 1, 1)
    expect(placed).toHaveLength(1)
    expect(placed[0].tileOverride).toBe('emoji:pine-tree')
    expect(g.groundAt(1, 1)).toBe('grass') // the floor is never popped by ⌥Alt
  })

  test('returns null on a cell with no stacked tile (only its floor — nothing to remove)', () => {
    const g = makeGrid()
    expect(removeTopAsset(g, 5, 5)).toBeNull()
    expect(g.assets.filter(a => a.type !== 'floor')).toHaveLength(0)
  })

  test('a cell stays blocked while a blocking (authored) asset remains, unblocks once it is popped', () => {
    const g = makeGrid()
    // Painted tiles are always walkable; a BLOCKING asset only ever comes from authored per-cell DATA (a
    // stamped composition cell), so we place it directly the way stampComposition does — blocking is DATA.
    g.placeAsset(['🧱'], 2, 2, { type: 'wall', blocking: true, heightLevel: 0 })
    stackAssetTile(g, 2, 2, byId('emoji:rose')) // a painted (walkable) tile on top (level 1)
    expect(g.isBlocked(2, 2)).toBe(true)

    removeTopAsset(g, 2, 2) // pop the walkable tile → the blocking asset still there
    expect(g.isBlocked(2, 2)).toBe(true)

    removeTopAsset(g, 2, 2) // pop the blocking asset → nothing blocking left
    expect(g.isBlocked(2, 2)).toBe(false)
    expect(nonFloor(g, 2, 2)).toHaveLength(0) // both stacked tiles popped; the floor slab remains
  })
})

// CLEAR TILES must EMPTY the whole cell (user: "I was expecting to clear the road tiles, but didn't"). A road /
// terrain / plaza is a floor tile painted via placeGroundTile, so clearing a cell has to reset the GROUND too,
// not just pop the stacked assets. clearGroundTile does that BARE reset uniformly — no branch on tile type.
describe('clearGroundTile — reset a cell FLOOR back to bare (the road/ground goes too)', () => {
  test('a painted ground tile (road/terrain) is reset to the bare default grass', () => {
    const g = makeGrid()
    placeGroundTile(g, 2, 2, byId('emoji:desert')) // stand-in for a painted road/terrain/plaza floor tile
    expect(g.groundAt(2, 2)).toBe('desert')
    clearGroundTile(g, 2, 2)
    expect(g.groundAt(2, 2)).toBe('grass') // the road/ground is gone — the cell is bare
  })

  test('clears the floor tile entirely (its colour + dims go with it), so the cell is truly bare', () => {
    const g = makeGrid()
    placeGroundTile(g, 1, 1, byId('emoji:desert'))
    // The floor is a plain level-0 asset — its colour/dims are its OWN GridAsset fields (no separate ground store).
    g.floorAt(1, 1)!.color = '#804000'                // a styled/tinted road
    g.floorAt(1, 1)!.scaleX = 2
    g.floorAt(1, 1)!.pose = { rot: Math.PI / 2 }
    clearGroundTile(g, 1, 1)
    expect(g.groundAt(1, 1)).toBe('grass')            // slug back to the bare default
    expect(g.floorAt(1, 1)).toBeUndefined()           // the whole floor asset is gone — colour + dims with it
  })

  test('the SAME reset for ANY ground tile — road, water, plaza all clear identically (no type branch)', () => {
    const g = makeGrid()
    for (const [id, cell] of [['emoji:desert', [0, 0]], ['emoji:deep-water', [1, 0]], ['emoji:grass', [2, 0]]] as const) {
      placeGroundTile(g, cell[0], cell[1], byId(id))
      clearGroundTile(g, cell[0], cell[1])
      expect(g.groundAt(cell[0], cell[1])).toBe('grass') // every one ends bare, the same way
    }
  })
})

// The FULL "Clear tiles" flow the page runs on a selection: pop every stacked asset AND clear the ground tile,
// captured by a history checkpoint so Ctrl+Z restores BOTH the assets AND the cleared road.
describe('Clear tiles on a selection — empties assets + ground, and undo restores the road', () => {
  // Mirror clearTilesOnSelection's per-cell body (the page loops the selection like this).
  const clearCell = (g: IsometricGrid, col: number, row: number): void => {
    while (removeTopAsset(g, col, row)) { /* pop the stacked assets until none remain */ }
    clearGroundTile(g, col, row)
    g.setCollision(col, row, false)
  }

  test('a cell with a road floor + a stacked tree goes fully bare', () => {
    const g = makeGrid()
    placeGroundTile(g, 2, 2, byId('emoji:desert')) // the road/ground
    stackAssetTile(g, 2, 2, byId('emoji:pine-tree')) // a stacked asset on top
    clearCell(g, 2, 2)
    expect(g.getAssetsAtCell(2, 2)).toHaveLength(0) // stacked asset AND floor gone
    expect(g.groundAt(2, 2)).toBe('grass')          // road gone — the cell is bare
    expect(g.isBlocked(2, 2)).toBe(false)           // walkable, like a freshly-initialised cell
  })

  test('undo (a captured snapshot) restores the cell to its pre-clear state', () => {
    const g = makeGrid()
    placeGroundTile(g, 3, 3, byId('emoji:desert'))
    const before = captureMapSnapshot(g, []) // checkpoint the ROAD before anything is stacked on it
    stackAssetTile(g, 3, 3, byId('emoji:pine-tree')) // the pine STACKS on the road (the floor stays beneath)
    expect(g.groundAt(3, 3)).toBe('desert')          // the road floor is NOT removed by placing a tile on it
    clearCell(g, 3, 3)
    expect(g.getAssetsAtCell(3, 3)).toHaveLength(0)
    restoreMapSnapshot(g, before) // Ctrl+Z back to the checkpoint
    expect(g.groundAt(3, 3)).toBe('desert') // the road floor is restored
    expect(nonFloor(g, 3, 3)).toHaveLength(0) // and no tree
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
    expect(nonFloor(g, 1, 1).map(a => a.tileOverride)).toEqual(['emoji:pine-tree', 'emoji:boulder'])
  })

  test('re-derives collision: removing the only blocking (authored) asset unblocks the cell even if a walkable tile stays', () => {
    const g = makeGrid()
    stackAssetTile(g, 2, 2, byId('emoji:rose'))                                   // painted, walkable (level 0)
    g.placeAsset(['🧱'], 2, 2, { type: 'wall', blocking: true, heightLevel: 1 })  // authored blocker (level 1, top)
    expect(g.isBlocked(2, 2)).toBe(true)
    removeAssetAtLevel(g, 2, 2, 1) // remove the blocker specifically
    expect(g.isBlocked(2, 2)).toBe(false)
    expect(nonFloor(g, 2, 2).map(a => a.tileOverride)).toEqual(['emoji:rose'])
  })

  test('returns null when no asset sits at that level (nothing removed)', () => {
    const g = makeGrid()
    stackAssetTile(g, 3, 3, byId('emoji:pine-tree')) // level 0 only
    expect(removeAssetAtLevel(g, 3, 3, 2)).toBeNull()
    expect(nonFloor(g, 3, 3)).toHaveLength(1)
  })
})
