import { buildingViewExtraCells } from '@/engine/buildingEditor'
import type { GridBuilding } from '@/engine/IsometricGrid'

// Collision = the cells the building occupies in EACH view (a different projection of the same 3D box):
//   TOP = footprint only, 2D = W × facadeHeight elevation, ISO = footprint swept up the (-1,-1) diagonal.
// Footprint: cols [10,13] (W=4) × rows [8,10] (depth=3, front/bottom row = 10). Facade elevation = 6 rows.
const b = {
  col: 10, row: 10, length: 4, height: 3, depth: 3, type: 'hospital', facing: 0, facadeOnBack: false,
  cells: Array.from({ length: 6 }, () => Array.from({ length: 4 }, () => 'wall')),
} as unknown as GridBuilding

const inFootprint = (c: number, r: number) => c >= 10 && c < 14 && r >= 8 && r < 11

describe('buildingViewExtraCells — per-view collision matches the drawn projection', () => {
  test('TOP view is just the footprint — no extra cells', () => {
    expect(buildingViewExtraCells(b, 'top')).toEqual([])
  })

  test('2D is the elevation: W wide × (facadeHeight − depth) rows straight above the footprint', () => {
    const got = buildingViewExtraCells(b, 'td').map(c => `${c.col},${c.row}`).sort()
    const want: string[] = []
    for (let r = 5; r <= 7; r++) for (let c = 10; c <= 13; c++) want.push(`${c},${r}`) // rows 8-10 up to facadeH=6 → rows 5,6,7
    expect(got).toEqual(want.sort())
  })

  test('ISO sweeps the footprint up-screen: every extra cell has a footprint cell diagonally down-right within the height', () => {
    const extra = buildingViewExtraCells(b, 'iso')
    expect(extra.length).toBeGreaterThan(0)
    for (const cell of extra) {
      expect(inFootprint(cell.col, cell.row)).toBe(false) // never re-blocks the footprint
      let reached = false
      for (let k = 1; k <= 6; k++) if (inFootprint(cell.col + k, cell.row + k)) { reached = true; break }
      expect(reached).toBe(true) // exactly the diagonal sweep, nothing spurious
    }
  })

  test('ISO extends farther for a taller building', () => {
    const tall = { ...b, cells: Array.from({ length: 12 }, () => ['wall', 'wall', 'wall', 'wall']) } as unknown as GridBuilding
    const short = { ...b, cells: Array.from({ length: 4 }, () => ['wall', 'wall', 'wall', 'wall']) } as unknown as GridBuilding
    expect(buildingViewExtraCells(tall, 'iso').length).toBeGreaterThan(buildingViewExtraCells(short, 'iso').length)
  })
})
