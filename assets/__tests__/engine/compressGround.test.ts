/**
 * compressGround merges contiguous same-floor cells into ONE z-width run tile — but ALONG the road: it measures
 * each seed run in both axes and keeps the LONGER, so a grid-ROW road becomes a `\` run (depthDir 'right-down',
 * +col) and a grid-COLUMN road becomes a `/` run (depthDir 'left-down', +row). Every run anchors at its BACKMOST
 * cell (min col / min row) so the flat-run depth sort keeps it behind standing tiles, and every covered cell
 * still resolves back to the run (floorAt) so per-cell picking / 2D / collision keep working. (Image #97.)
 */
import { IsometricGrid } from '@/engine/IsometricGrid'

const grid = () => new IsometricGrid({ cols: 12, rows: 12, cellSize: 16, isoScale: 1 })

describe('compressGround — runs follow the road direction', () => {
  test('a horizontal road (grid row) merges into ONE `\\` run (right-down, +col)', () => {
    const g = grid()
    for (let c = 2; c <= 7; c++) g.setGround(c, 5, 'road') // 6-cell horizontal road on row 5
    g.compressGround()
    const run = g.floorAt(2, 5)!
    expect(run.depth).toBe(6)
    expect(run.depthDir).toBe('right-down')
    for (let c = 2; c <= 7; c++) expect(g.floorAt(c, 5)).toBe(run) // every covered cell → the SAME run
  })

  test('a vertical road (grid column) merges into ONE `/` run (left-down, +row) anchored at its BACK cell', () => {
    const g = grid()
    for (let r = 3; r <= 9; r++) g.setGround(4, r, 'road') // 7-cell vertical road on col 4
    g.compressGround()
    const run = g.floorAt(4, 3)! // anchor = min row (backmost), NOT the front (max row)
    expect(run.depth).toBe(7)
    expect(run.depthDir).toBe('left-down')
    expect(run.row).toBe(3) // anchored at the back, so the flat run sorts behind everything along its span
    for (let r = 3; r <= 9; r++) expect(g.floorAt(4, r)).toBe(run)
  })

  test('a 1×1 road island is left alone (no run — nothing to merge)', () => {
    const g = grid()
    g.setGround(6, 6, 'road') // lone road cell surrounded by grass
    g.compressGround()
    const cell = g.floorAt(6, 6)!
    expect(cell.depth ?? 1).toBe(1) // stays a plain per-cell floor
  })
})

/**
 * A RUN MAY NOT SPAN A STEP.
 *
 * Alexander, 2026-09-11: *"we have the grid height precisely to deal with things like this we need to implement
 * relieve/relief"*. Relief lives in the grid's per-cell height, and a merge that ignores it would quietly erase
 * the thing: the two floors either side of a dug channel's lip are the same tile in the same colour, so without
 * the elevation clause they collapse into ONE z-width block spanning both levels and the step vanishes.
 *
 * The second test is the one that matters as much: it would be easy to satisfy the first by breaking merging
 * altogether, and then every optimisation ticket regresses silently.
 */
describe('compressGround — a run stops at a change in elevation', () => {
  test('two floors either side of a step do NOT merge', () => {
    const g = grid()
    for (let c = 2; c <= 7; c++) g.setGround(c, 5, 'road')
    for (let c = 5; c <= 7; c++) g.setHeight(c, 5, -1) // the far half is dug out
    g.compressGround()

    const high = g.floorAt(2, 5)!
    const low = g.floorAt(5, 5)!
    expect(high).not.toBe(low) // two runs, not one spanning the step
    expect(high.depth).toBe(3) // cols 2..4 at level 0
    expect(low.depth).toBe(3) // cols 5..7 at level -1
  })

  test('a run at ONE elevation still merges, dug or raised', () => {
    for (const level of [-2, -1, 0, 3]) {
      const g = grid()
      for (let c = 2; c <= 7; c++) {
        g.setGround(c, 5, 'road')
        g.setHeight(c, 5, level)
      }
      g.compressGround()
      expect({ level, depth: g.floorAt(2, 5)!.depth }).toEqual({ level, depth: 6 })
    }
  })

  test('a single dug cell in the middle of a road breaks it into two runs', () => {
    const g = grid()
    for (let c = 0; c < 12; c++) g.setGround(c, 5, 'road')
    g.setHeight(5, 5, -1)
    g.compressGround()

    const runs = new Set(Array.from({ length: 12 }, (_, c) => g.floorAt(c, 5)))
    expect(runs.size).toBe(3) // cols 0..4, the dug cell, then 6..11
  })
})
