/**
 * BUILDINGS ARE COMPOSITIONS: a pre-built building stamps as PLAIN per-cell tiles (like a tree), through the
 * SAME stampComposition path — not a special `type:'building'` unit. Its behaviors ride on GENERIC per-tile
 * settings the ONE render path reads:
 *   - walls / windows / doors carry settings.fadeNear  (ease translucent near the hero)
 *   - roof blocks carry        settings.cutawayRoof     (lift off entirely near the hero)
 * No stamped asset is `type:'building'` and none carries `buildingType`; the type is the composition KIND
 * (house_4 / store_5 / …) and each cell carries its part label (wall/window/door/roof/roof_top).
 */
import '@/__tests__/helpers/installTilesetSeed' // building compositions + tile settings come from the loaded backend tileset fixture
import { IsometricGrid } from '@/engine/IsometricGrid'
import { stampBuildingComposition } from '@/game/runtime/composition'

const mkGrid = () => new IsometricGrid({ cols: 32, rows: 32, cellSize: 16, isoScale: 1.4 })
// A cell label is a building PART when it is a base part OR a material/variant of one
// (a store's `roof_top_store`, a house's `wall_wood_c`, a slate `roof_slate`, …) — each still a
// roof/wall/window/door/apex.
const isBuildingPart = (label = '') => /^(roof_top|roof|wall|window|door)/.test(label)

describe('stampBuildingComposition → plain per-cell tiles carrying generic behavior settings', () => {
  test('every stamped cell is a labeled tile — none is `type:"building"`, none carries `buildingType`', () => {
    const grid = mkGrid()
    const placed = stampBuildingComposition(grid, 'house', 4, 12, 12, 'spring', 'south')
    expect(placed).toBeGreaterThan(0)
    // `placed` counts the composition CELLS; contiguous same-tile vertical runs collapse into ONE sized
    // (scaleY) block, so there are FEWER assets than cells (the perf "intelligent building" reduction).
    expect(grid.assets.filter(a => a.type !== 'floor').length).toBeGreaterThan(0)
    expect(grid.assets.filter(a => a.type !== 'floor').length).toBeLessThanOrEqual(placed)
    expect(grid.assets.some(a => a.type === 'building')).toBe(false)
    expect(grid.assets.some(a => a.buildingType != null)).toBe(false)
    // The asset TYPE is the composition kind; every cell carries a building PART label (house_4's
    // cells resolve to its wood MATERIAL pieces: wall_wood_c / wall_wood_* + a red gable roof/roof_top).
    expect(grid.assets.filter(a => a.type !== 'floor').every(a => a.type === 'house_4')).toBe(true)
    expect(grid.assets.filter(a => a.type !== 'floor').every(a => isBuildingPart(a.label))).toBe(true)
  })

  test('walls / windows / doors carry settings.fadeNear (and NOT cutawayRoof)', () => {
    const grid = mkGrid()
    stampBuildingComposition(grid, 'house', 4, 12, 12, 'spring', 'south')
    const facade = grid.assets.filter(a => /^(wall|window|door)/.test(a.label ?? ''))
    expect(facade.length).toBeGreaterThan(0)
    expect(facade.every(a => a.settings?.fadeNear === true)).toBe(true)
    expect(facade.every(a => a.settings?.cutawayRoof == null)).toBe(true)
  })

  test('roof blocks carry settings.cutawayRoof', () => {
    const grid = mkGrid()
    stampBuildingComposition(grid, 'house', 4, 12, 12, 'spring', 'south')
    // roof BODY cells (roof / roof_slate …), not the roof_top apex (which fades, not cuts away).
    const roofs = grid.assets.filter(a => (a.label ?? '').startsWith('roof') && !(a.label ?? '').startsWith('roof_top'))
    expect(roofs.length).toBeGreaterThan(0)
    expect(roofs.every(a => a.settings?.cutawayRoof === true)).toBe(true)
  })

  test('a STORE stamps brick MATERIAL walls + storefront (wall_brick, flat roof, display_window, awning, blue badge)', () => {
    const grid = mkGrid()
    const placed = stampBuildingComposition(grid, 'store', 5, 12, 12, 'spring', 'south')
    expect(placed).toBeGreaterThan(0)
    const labels = new Set(grid.assets.map(a => a.label))
    // The store now has BRICK material walls + the storefront (a wide display window + striped awning) over
    // a flat roof (parapet), and keeps its blue "Store" roof-top sign badge; door/upper-window stay generic.
    for (const part of ['wall_brick_c', 'window', 'door', 'display_window', 'awning', 'parapet', 'roof_top_store'])
      expect(labels.has(part)).toBe(true)
    expect(grid.assets.filter(a => a.type !== 'floor').every(a => a.type === 'store_5')).toBe(true)
  })

  test('exactly ONE apex roof_top tile — the single roof apex', () => {
    const grid = mkGrid()
    stampBuildingComposition(grid, 'house', 4, 12, 12, 'spring', 'south')
    expect(grid.assets.filter(a => (a.label ?? '').startsWith('roof_top'))).toHaveLength(1)
  })
})
