/**
 * Per-cell floor dims on the grid model + the iso static-ground cache invalidation.
 *
 * setGroundDims mirrors setGroundColor: a per-cell override that bumps groundVersion so BOTH the 2D
 * static-ground layer (keyed on groundVersion) and the iso offscreen cache (keyed on
 * isoGroundSignature, which must now fold groundDims) rebuild when a floor cell's dims change.
 */
import { IsometricGrid } from '@/engine/IsometricGrid'
import { isoGroundSignature } from '@/engine/render/iso'

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

describe('isoGroundSignature folds groundDims → the iso static-ground cache invalidates on a dims edit', () => {
  test('signature changes when a visible cell gets per-cell dims', () => {
    const grid = mkGrid()
    const before = isoGroundSignature(grid, 0, 5, 0, 5)
    grid.setGroundDims(2, 2, { scaleX: 2 })
    const after = isoGroundSignature(grid, 0, 5, 0, 5)
    expect(after).not.toBe(before)
  })

  test('a pose-only edit also changes the signature', () => {
    const grid = mkGrid()
    const before = isoGroundSignature(grid, 0, 5, 0, 5)
    grid.setGroundDims(3, 1, { pose: { dx: 0.5 } })
    const after = isoGroundSignature(grid, 0, 5, 0, 5)
    expect(after).not.toBe(before)
  })

  test('an out-of-view dims edit does NOT change the in-view signature', () => {
    const grid = mkGrid()
    const before = isoGroundSignature(grid, 0, 2, 0, 2)
    grid.setGroundDims(5, 5, { scaleX: 2 }) // outside the [0..2] window
    const after = isoGroundSignature(grid, 0, 2, 0, 2)
    expect(after).toBe(before)
  })
})
