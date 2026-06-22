import { IsometricGrid } from '@/engine/IsometricGrid'
import { fillSelectionWithComposite, type CompositeTile } from '@/engine/compositeFill'

// A 2×2 "well": four blocking edge tiles — the composite that was hardcoded to 4
// cells regardless of how many the user selected.
const WELL: CompositeTile[] = [
  { tile: 'well_edge', char: 'O', dx: 0, dy: 0, blocking: true, type: 'decoration' },
  { tile: 'well_edge', char: 'O', dx: 1, dy: 0, blocking: true, type: 'decoration' },
  { tile: 'well_edge', char: 'O', dx: 0, dy: 1, blocking: true, type: 'decoration' },
  { tile: 'well_edge', char: 'O', dx: 1, dy: 1, blocking: true, type: 'decoration' },
]

const region = (c0: number, r0: number, w: number, h: number): Set<string> => {
  const s = new Set<string>()
  for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) s.add(`${c},${r}`)
  return s
}

const newGrid = () => new IsometricGrid({ cols: 12, rows: 12, cellSize: 16, isoScale: 1 })

describe('compositeFill — tile a composite across a multi-cell selection', () => {
  it('fills EVERY selected cell (a 2×2 well over a 4×3 region → 12 placed, blocking cells)', () => {
    const grid = newGrid()
    const sel = region(2, 2, 4, 3) // 12 cells
    fillSelectionWithComposite(grid, WELL, sel)
    for (const key of sel) {
      const [c, r] = key.split(',').map(Number)
      expect(grid.assets.some(a => a.col === c && a.row === r)).toBe(true)
      expect(grid.isBlocked(c, r)).toBe(true)
    }
    expect(grid.assets.length).toBe(12) // exactly the selection, nothing outside
  })

  it('leaves a cell empty where a NON-rectangular pattern has no tile at that offset', () => {
    // L-shaped 2×2 minus the (1,1) corner → in a tiled fill, every 4th cell (the
    // missing offset) stays empty.
    const lShape: CompositeTile[] = WELL.filter(t => !(t.dx === 1 && t.dy === 1))
    const grid = newGrid()
    fillSelectionWithComposite(grid, lShape, region(0, 0, 2, 2))
    expect(grid.assets.length).toBe(3) // the (1,1) offset cell is skipped
  })

  it('does nothing for an empty pattern or empty selection', () => {
    const a = newGrid()
    fillSelectionWithComposite(a, [], region(0, 0, 3, 3))
    expect(a.assets.length).toBe(0)
    const b = newGrid()
    fillSelectionWithComposite(b, WELL, new Set())
    expect(b.assets.length).toBe(0)
  })
})
