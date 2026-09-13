/**
 * A tile collides with what it OCCUPIES, not with its whole cell. Alexander, 2026-09-11 (Image #17): *"they should
 * adapt to the size of the tile ... the character behaves as if I'm colliding with walls, when there's plenty of
 * space between the tree and my unit"*.
 */
import { boxesForAsset, worldPointBlocked, FULL_CELL, MIN_BOX_SIDE, type BoxGrid } from '@/engine/collisionBoxes'
import type { GridAsset } from '@/engine/IsometricGrid'

/**
 * A tile that OCCUPIES ITS WHOLE CELL, which is what `blocking: true` used to mean and what
 * `ensure_collisions/0` now writes for every solid row. Saying it in the data is the point: a tile is solid
 * where its boxes are, and one with no boxes is not solid at all (Alexander, 2026-09-13, on removing the
 * flag: *"we fucking have collissions which already do the fucking job"*).
 */
const WHOLE_CELL = [{ x: 0, y: 0, w: 1, h: 1 }]
const asset = (patch: Partial<GridAsset> = {}): GridAsset =>
  ({ art: [''], col: 1, row: 1, type: 'tree', settings: { collision: WHOLE_CELL }, ...patch } as GridAsset)

/** A 3-cell-wide strip: cell 1 holds `at1`, the rest is clear. Cell size 16, like the editor's default. */
function grid(at1: GridAsset[], blocked = new Set([1])): BoxGrid {
  return {
    cols: 3, rows: 1, cellSize: 16,
    isBlocked: (col, row) => col < 0 || row < 0 || col >= 3 || row >= 1 || blocked.has(col),
    getAssetsAtCell: col => (col === 1 ? at1 : []),
  }
}

describe('what a tile makes solid', () => {
  it('a tile drawn at its full cell keeps the whole cell', () => {
    expect(boxesForAsset(asset())).toEqual([FULL_CELL])
    expect(boxesForAsset(asset({ scale: 1, scaleX: 1 }))).toEqual([FULL_CELL])
  })

  it('a trunk drawn at 0.6 of its cell blocks 0.6 of it, centred', () => {
    const [box] = boxesForAsset(asset({ scale: 0.6 }))
    expect(box.w).toBeCloseTo(0.6)
    expect(box.h).toBeCloseTo(0.6)
    expect(box.x).toBeCloseTo(0.2)
    expect(box.y).toBeCloseTo(0.2)
  })

  it('however thin it is drawn, it never shrinks past the minimum', () => {
    const [box] = boxesForAsset(asset({ scale: 0.01 }))
    expect(box.w).toBeCloseTo(MIN_BOX_SIDE)
  })

  it('authored boxes win, as many as the tile likes', () => {
    const boxes = [{ x: 0, y: 0, w: 0.3, h: 1 }, { x: 0.7, y: 0, w: 0.3, h: 1 }]
    expect(boxesForAsset(asset({ scale: 0.6, settings: { collision: boxes } }))).toEqual(boxes)
  })

  it('a tile that declares no boxes makes nothing solid', () => {
    expect(boxesForAsset(asset({ settings: { collision: [] } }))).toEqual([])
    expect(boxesForAsset(asset({ settings: undefined }))).toEqual([]) // and neither does one that says nothing
  })
})

describe('a body collides on real contact', () => {
  const trunk = grid([asset({ scale: 0.6 })])

  it('the middle of a trunk cell is solid', () => {
    expect(worldPointBlocked(trunk, 16 + 8, 8)).toBe(true)
  })

  it('the edges of that same cell are free: the trunk is not its cell', () => {
    expect(worldPointBlocked(trunk, 16 + 1, 8)).toBe(false)
    expect(worldPointBlocked(trunk, 16 + 15, 8)).toBe(false)
  })

  it('a clear cell is free and out of bounds is solid', () => {
    expect(worldPointBlocked(trunk, 8, 8)).toBe(false)
    expect(worldPointBlocked(trunk, -1, 8)).toBe(true)
    expect(worldPointBlocked(trunk, 999, 8)).toBe(true)
  })

  it('a cell blocked with nothing to measure stays solid wall to wall, as before', () => {
    const painted = grid([]) // collision painted by hand, or set by the generator with no asset behind it
    for (const x of [16 + 1, 16 + 8, 16 + 15]) expect(worldPointBlocked(painted, x, 8)).toBe(true)
  })

  it('a wall still blocks its whole cell', () => {
    const wall = grid([asset({ type: 'wall' })])
    for (const x of [16 + 1, 16 + 8, 16 + 15]) expect(worldPointBlocked(wall, x, 8)).toBe(true)
  })

  it('Image #17: a body 0.84 of a cell wide walks between two trees a cell apart', () => {
    // trunks in cells 0 and 2, the player walking up the middle of cell 1 with its four corners tested
    const cs = 16
    const trees: BoxGrid = {
      cols: 3, rows: 3, cellSize: cs,
      isBlocked: (col, row) => col < 0 || row < 0 || col >= 3 || row >= 3 || ((col === 0 || col === 2) && row === 1),
      getAssetsAtCell: (col, row) => ((col === 0 || col === 2) && row === 1 ? [asset({ scale: 0.6, col, row })] : []),
    }
    const pr = cs * 0.42
    const x = 1.5 * cs
    const z = 1.5 * cs
    const corners: Array<[number, number]> = [[x - pr, z - pr], [x + pr, z - pr], [x - pr, z + pr], [x + pr, z + pr]]
    expect(corners.map(([cx, cz]) => worldPointBlocked(trees, cx, cz))).toEqual([false, false, false, false])
  })
})
