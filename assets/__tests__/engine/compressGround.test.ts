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
