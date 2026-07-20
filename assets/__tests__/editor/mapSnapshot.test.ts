/**
 * mapSnapshot — capture + restore the EXACT map (grid layers + placed assets + entities) an undo rolls back to.
 * These tests prove the round-trip is exact, that the stored snapshot is a DEEP copy (a later edit can't corrupt
 * it — an undo/redo cycle restores the same snapshot twice), and that a snapshot from a differently-sized grid
 * is refused so it can never corrupt the live map.
 */
import { IsometricGrid } from '@/engine/IsometricGrid'
import { captureMapSnapshot, restoreMapSnapshot } from '@/game/editor/mapSnapshot'
import type { Entity } from '@/game/types'

const mkGrid = () => new IsometricGrid({ cols: 6, rows: 6, cellSize: 16, isoScale: 1.4 })
const ent = (id: string, col: number, row: number): Entity => ({ id, kind: 'enemy', col, row }) as unknown as Entity

describe('mapSnapshot — capture/restore the exact map (grid + entities)', () => {
  test('restore brings the grid back to the captured ground / height / collision / assets', () => {
    const grid = mkGrid()
    grid.setGround(1, 1, 'water')
    grid.setHeight(2, 2, 3)
    grid.placeAsset(['A'], 0, 0, { type: 'house', blocking: true }) // blocking → collision at (0,0)
    const entities: Entity[] = [ent('e1', 4, 4)]

    const snap = captureMapSnapshot(grid, entities)

    // edit further — this is the state an undo must roll back
    grid.setGround(1, 1, 'lava')
    grid.setHeight(2, 2, 0)
    grid.placeAsset(['B'], 5, 5, { type: 'tree' })

    const restored = restoreMapSnapshot(grid, snap)
    expect(restored).not.toBeNull()
    expect(grid.ground[1][1]).toBe('water')
    expect(grid.height[2][2]).toBe(3)
    expect(grid.collision[0][0]).toBe(1)
    expect(grid.assets.map(a => a.type)).toEqual(['house']) // the 'tree' edit is gone
    expect(restored!.map(e => e.id)).toEqual(['e1'])
  })

  test('the stored snapshot is DEEP — mutating the grid after a restore does not corrupt it', () => {
    const grid = mkGrid()
    grid.placeAsset(['A'], 0, 0, { type: 'house' })
    const snap = captureMapSnapshot(grid, [])

    restoreMapSnapshot(grid, snap)
    grid.placeAsset(['B'], 1, 1, { type: 'tree' }) // mutate AFTER a restore (grid.placeAsset pushes in place)
    grid.setGround(0, 0, 'water')

    // a SECOND restore of the same snapshot still yields the pristine original → the snapshot wasn't aliased
    const again = restoreMapSnapshot(grid, snap)
    expect(again).not.toBeNull()
    expect(grid.assets.map(a => a.type)).toEqual(['house'])
    expect(grid.ground[0][0]).toBe('grass')
  })

  test('entities in a snapshot are cloned — editing a restored entity does not change the snapshot', () => {
    const grid = mkGrid()
    const snap = captureMapSnapshot(grid, [ent('e1', 1, 1)])
    const restored = restoreMapSnapshot(grid, snap)!
    restored[0].col = 99 // move the restored copy
    // restoring again gives the ORIGINAL position — the stored entity was not mutated
    expect(restoreMapSnapshot(grid, snap)![0].col).toBe(1)
  })

  test('a snapshot from a differently sized grid is refused (returns null, grid untouched)', () => {
    const small = new IsometricGrid({ cols: 4, rows: 4, cellSize: 16 })
    const snap = captureMapSnapshot(small, [])
    const big = new IsometricGrid({ cols: 8, rows: 8, cellSize: 16 })
    big.placeAsset(['X'], 0, 0, { type: 'wall' })
    expect(restoreMapSnapshot(big, snap)).toBeNull()
    expect(big.assets.map(a => a.type)).toEqual(['wall']) // left untouched
  })
})
