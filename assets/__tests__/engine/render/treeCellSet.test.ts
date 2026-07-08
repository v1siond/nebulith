/**
 * treeCellSet memoization (render/shared).
 *
 * Both the iso and 2D views need the `col,row` Set of every tree asset to place ground-contact
 * shadows. Rebuilding that Set with a full assets scan + alloc every frame was waste, so it's
 * memoized on (grid.assets reference, grid.assets.length). This test locks that the cached Set is
 * (a) content-correct, (b) REUSED while the assets are unchanged, and (c) REBUILT exactly when the
 * tree cells can change — a push add (length grows) or an array reassignment (new reference) — while
 * an in-place field edit that touches no tree cell keeps the cached Set.
 */
import { IsometricGrid } from '@/engine/IsometricGrid'
import { treeCellSet } from '@/engine/render/shared'

const mkGrid = () => new IsometricGrid({ cols: 10, rows: 10, cellSize: 16, isoScale: 1.4 })

describe('treeCellSet — memoized tree-cell key Set', () => {
  test('empty grid → empty set', () => {
    const grid = mkGrid()
    expect(treeCellSet(grid).size).toBe(0)
  })

  test('holds exactly the tree cells (ignores non-tree assets)', () => {
    const grid = mkGrid()
    grid.placeAsset(['@'], 2, 3, { type: 'tree' })
    grid.placeAsset(['@'], 5, 6, { type: 'tree' })
    grid.placeAsset(['#'], 1, 1, { type: 'crate' })
    const set = treeCellSet(grid)
    expect(set.size).toBe(2)
    expect(set.has('2,3')).toBe(true)
    expect(set.has('5,6')).toBe(true)
    expect(set.has('1,1')).toBe(false)
  })

  test('returns the SAME Set reference while assets are unchanged (memoized)', () => {
    const grid = mkGrid()
    grid.placeAsset(['@'], 2, 3, { type: 'tree' })
    const a = treeCellSet(grid)
    const b = treeCellSet(grid)
    expect(b).toBe(a)
  })

  test('rebuilds when a tree is pushed (length grows, same array reference)', () => {
    const grid = mkGrid()
    grid.placeAsset(['@'], 2, 3, { type: 'tree' })
    const before = treeCellSet(grid)
    grid.placeAsset(['@'], 7, 8, { type: 'tree' }) // push → identity stable, length +1
    const after = treeCellSet(grid)
    expect(after).not.toBe(before)
    expect(after.has('7,8')).toBe(true)
    expect(after.size).toBe(2)
  })

  test('rebuilds when grid.assets is reassigned (a removal via filter → new reference)', () => {
    const grid = mkGrid()
    grid.placeAsset(['@'], 2, 3, { type: 'tree' })
    grid.placeAsset(['@'], 7, 8, { type: 'tree' })
    const before = treeCellSet(grid)
    expect(before.size).toBe(2)
    grid.assets = grid.assets.filter(a => !(a.col === 7 && a.row === 8)) // remove one tree → new array
    const after = treeCellSet(grid)
    expect(after).not.toBe(before)
    expect(after.has('7,8')).toBe(false)
    expect(after.size).toBe(1)
  })

  test('an in-place field edit that touches no tree cell keeps the cached Set', () => {
    const grid = mkGrid()
    grid.placeAsset(['@'], 2, 3, { type: 'tree' })
    const before = treeCellSet(grid)
    grid.assets[0].color = '#123456' // same reference + length, tree cell unchanged
    const after = treeCellSet(grid)
    expect(after).toBe(before)
    expect(after.has('2,3')).toBe(true)
  })
})
