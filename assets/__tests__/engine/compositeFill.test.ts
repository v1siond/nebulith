import { IsometricGrid } from '@/engine/IsometricGrid'
import { fillSelectionWithComposite, scaleCompositeToRegion, type CompositeTile } from '@/engine/compositeFill'

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
    expect(grid.assets.filter(a => a.type !== 'floor').length).toBe(12) // exactly the selection, nothing outside
  })

  it('leaves a cell empty where a NON-rectangular pattern has no tile at that offset', () => {
    // L-shaped 2×2 minus the (1,1) corner → in a tiled fill, every 4th cell (the
    // missing offset) stays empty.
    const lShape: CompositeTile[] = WELL.filter(t => !(t.dx === 1 && t.dy === 1))
    const grid = newGrid()
    fillSelectionWithComposite(grid, lShape, region(0, 0, 2, 2))
    expect(grid.assets.filter(a => a.type !== 'floor').length).toBe(3) // the (1,1) offset cell is skipped
  })

  it('does nothing for an empty pattern or empty selection', () => {
    const a = newGrid()
    fillSelectionWithComposite(a, [], region(0, 0, 3, 3))
    expect(a.assets.filter(a => a.type !== 'floor').length).toBe(0)
    const b = newGrid()
    fillSelectionWithComposite(b, WELL, new Set())
    expect(b.assets.filter(a => a.type !== 'floor').length).toBe(0)
  })
})

// Distinct char per quadrant so we can verify the scale mapping.
const QUAD: CompositeTile[] = [
  { tile: 'q', char: 'A', dx: 0, dy: 0, blocking: true, type: 'decoration' },
  { tile: 'q', char: 'B', dx: 1, dy: 0, blocking: true, type: 'decoration' },
  { tile: 'q', char: 'C', dx: 0, dy: 1, blocking: true, type: 'decoration' },
  { tile: 'q', char: 'D', dx: 1, dy: 1, blocking: true, type: 'decoration' },
]

describe('compositeFill — scale ONE composite to span the selection', () => {
  it('a 2×2 over a 4×4 region → 16 cells, ONE scaled instance (each quadrant a 2×2 block)', () => {
    const grid = newGrid()
    scaleCompositeToRegion(grid, QUAD, region(0, 0, 4, 4))
    expect(grid.assets.filter(a => a.type !== 'floor').length).toBe(16) // fills the whole bounding box, one instance
    const charAt = (c: number, r: number) => grid.assets.find(a => a.col === c && a.row === r && a.type !== 'floor')?.art[0]
    expect(charAt(0, 0)).toBe('A')
    expect(charAt(1, 1)).toBe('A') // top-left quadrant
    expect(charAt(2, 0)).toBe('B')
    expect(charAt(3, 1)).toBe('B') // top-right
    expect(charAt(0, 3)).toBe('C') // bottom-left
    expect(charAt(3, 3)).toBe('D') // bottom-right
  })

  it('does nothing for an empty pattern or selection', () => {
    const g = newGrid()
    scaleCompositeToRegion(g, [], region(0, 0, 3, 3))
    expect(g.assets.filter(a => a.type !== 'floor').length).toBe(0)
    scaleCompositeToRegion(g, QUAD, new Set())
    expect(g.assets.filter(a => a.type !== 'floor').length).toBe(0)
  })
})
