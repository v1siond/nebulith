/**
 * DE-SEGMENTED BUILDINGS: stampBuildingCells stamps a building as PLAIN tiles (like a tree), not a special
 * `type:'building'` unit. Its behaviors ride on GENERIC per-tile settings the ONE render path reads:
 *   - walls / windows / doors carry settings.fadeNear  (ease translucent near the hero)
 *   - roof blocks carry        settings.cutawayRoof     (lift off entirely near the hero)
 *   - the apex roof block of a shop/hospital carries settings.badge (STORE/HOSPITAL signage), NOT buildingType.
 * No stamped asset is `type:'building'` and none carries `buildingType`.
 */
import { IsometricGrid } from '@/engine/IsometricGrid'
import { makeBuilding } from '@/engine/buildingEditor'
import { stampBuildingCells } from '@/game/runtime/buildings'

const mkGrid = () => new IsometricGrid({ cols: 32, rows: 32, cellSize: 16, isoScale: 1.4 })

describe('stampBuildingCells → plain `type:"structure"` tiles carrying generic behavior settings', () => {
  test('no stamped block is `type:"building"` or carries `buildingType`; all are `structure`', () => {
    const grid = mkGrid()
    stampBuildingCells(grid, makeBuilding('house', 'south', 12, 12), 'spring')
    expect(grid.assets.length).toBeGreaterThan(0)
    expect(grid.assets.some(a => a.type === 'building')).toBe(false)
    expect(grid.assets.some(a => a.buildingType != null)).toBe(false)
    expect(grid.assets.every(a => a.type === 'structure')).toBe(true)
  })

  test('walls / windows / doors carry settings.fadeNear (and NOT cutawayRoof)', () => {
    const grid = mkGrid()
    stampBuildingCells(grid, makeBuilding('house', 'south', 12, 12), 'spring')
    const facade = grid.assets.filter(a => a.label === 'wall' || a.label === 'window' || a.label === 'door')
    expect(facade.length).toBeGreaterThan(0)
    expect(facade.every(a => a.settings?.fadeNear === true)).toBe(true)
    expect(facade.every(a => a.settings?.cutawayRoof == null)).toBe(true)
  })

  test('roof blocks carry settings.cutawayRoof', () => {
    const grid = mkGrid()
    stampBuildingCells(grid, makeBuilding('house', 'south', 12, 12), 'spring')
    const roofs = grid.assets.filter(a => a.label === 'roof')
    expect(roofs.length).toBeGreaterThan(0)
    expect(roofs.every(a => a.settings?.cutawayRoof === true)).toBe(true)
  })

  test('a STORE puts its signage on the APEX roof block via a generic settings.badge — exactly one badge', () => {
    const grid = mkGrid()
    stampBuildingCells(grid, makeBuilding('store', 'south', 12, 12), 'spring')

    const badged = grid.assets.filter(a => a.settings?.badge != null)
    expect(badged).toHaveLength(1) // one signage per building, on the apex

    const roofs = grid.assets.filter(a => a.label === 'roof')
    const apex = roofs.reduce((top, a) => ((a.heightLevel ?? 0) > (top.heightLevel ?? 0) ? a : top))
    expect(badged[0]).toBe(apex) // the badge sits on the topmost (apex) roof block
    expect(apex.settings?.badge?.text).toBe('STORE')
    expect(apex.settings?.badge?.color).toBeTruthy()
    // The apex is still a roof block, so it also keeps its cutaway behavior.
    expect(apex.settings?.cutawayRoof).toBe(true)
  })

  test('a plain HOUSE (no signage type) carries NO badge on any block', () => {
    const grid = mkGrid()
    stampBuildingCells(grid, makeBuilding('house', 'south', 12, 12), 'spring')
    expect(grid.assets.some(a => a.settings?.badge != null)).toBe(false)
  })
})
