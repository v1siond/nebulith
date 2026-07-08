/**
 * Per-cell floor dims on the grid model + the iso static-ground cache invalidation.
 *
 * setGroundDims mirrors setGroundColor: a per-cell override that bumps groundVersion so BOTH the 2D
 * static-ground layer AND the iso offscreen cache — which now BOTH key their content signature on
 * grid.groundVersion (O(1)) — rebuild when a floor cell's dims change.
 */
import { IsometricGrid } from '@/engine/IsometricGrid'

const mkGrid = () => new IsometricGrid({ cols: 6, rows: 6, cellSize: 16, isoScale: 1.4 })

describe('IsometricGrid.setGroundDims — per-cell floor dims (mirrors setGroundColor)', () => {
  test('stores a partial and bumps groundVersion so caches rebuild', () => {
    const grid = mkGrid()
    const v0 = grid.groundVersion
    grid.setGroundDims(2, 3, { scaleX: 2 })
    expect(grid.groundDims[3]?.[2]).toEqual({ scaleX: 2 })
    expect(grid.groundVersion).toBe(v0 + 1)
  })

  test('merges successive partials onto the same cell (Width, then Depth, then pose)', () => {
    const grid = mkGrid()
    grid.setGroundDims(1, 1, { scaleX: 2 })
    grid.setGroundDims(1, 1, { scaleZ: 3 })
    grid.setGroundDims(1, 1, { pose: { dx: 0.4 } })
    expect(grid.groundDims[1][1]).toEqual({ scaleX: 2, scaleZ: 3, pose: { dx: 0.4 } })
  })

  test('a per-cell edit does NOT touch its neighbours (offsets only that cell)', () => {
    const grid = mkGrid()
    grid.setGroundDims(1, 1, { pose: { dx: 0.5 } })
    expect(grid.groundDims[1][0]).toBeUndefined()
    expect(grid.groundDims[0]?.[1]).toBeUndefined()
    expect(grid.groundDims[2]?.[1]).toBeUndefined()
  })

  test('clears the pose when passed { pose: undefined }', () => {
    const grid = mkGrid()
    grid.setGroundDims(0, 0, { pose: { dx: 0.5 } })
    grid.setGroundDims(0, 0, { pose: undefined })
    expect(grid.groundDims[0][0]?.pose).toBeUndefined()
  })

  test('ignores out-of-bounds cells (no version bump)', () => {
    const grid = mkGrid()
    const v0 = grid.groundVersion
    grid.setGroundDims(-1, 0, { scaleX: 2 })
    grid.setGroundDims(0, 99, { scaleX: 2 })
    expect(grid.groundVersion).toBe(v0)
  })
})

describe('groundVersion is the iso static-ground cache signature → a floor-dims edit invalidates it', () => {
  // The iso offscreen cache now compares grid.groundVersion (see render/iso.ts) as its content
  // signature, exactly like the 2D static-ground layer. So the invariant the cache relies on is that
  // any floor edit bumps groundVersion — a version change is what forces a rebuild.
  test('a dims edit bumps groundVersion so the cache rebuilds', () => {
    const grid = mkGrid()
    const before = grid.groundVersion
    grid.setGroundDims(2, 2, { scaleX: 2 })
    expect(grid.groundVersion).toBe(before + 1)
  })

  test('a pose-only edit also bumps groundVersion', () => {
    const grid = mkGrid()
    const before = grid.groundVersion
    grid.setGroundDims(3, 1, { pose: { dx: 0.5 } })
    expect(grid.groundVersion).toBe(before + 1)
  })

  test('a colour or height edit bumps the same signature (all floor edits invalidate the cache)', () => {
    const grid = mkGrid()
    const v0 = grid.groundVersion
    grid.setGroundColor(1, 1, '#ff0000')
    grid.setHeight(2, 2, 3)
    grid.setGround(0, 0, 'stone')
    expect(grid.groundVersion).toBe(v0 + 3)
  })
})
