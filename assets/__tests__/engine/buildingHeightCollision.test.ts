import { buildingHeightExtraCells, buildingFootprintCells, buildingDoorCell } from '@/engine/buildingEditor'
import type { GridBuilding } from '@/engine/IsometricGrid'

// A tall building (approach B) keeps its drawn box and EXTENDS collision to cover the ground it rises
// over. The extra cells are the footprint swept "up-screen": iso along the (-1,-1) diagonal, 2D straight
// north. Top view stays the flat footprint. Height comes from the facade rows (b.cells.length).

// Footprint: cols [10,11] × rows [9,10] (row is the FRONT/bottom row = 10, height row-span = 2).
// Facade elevation = 4 rows.
const b = {
  col: 10, row: 10, length: 2, height: 2, depth: 2, type: 'house',
  facing: 0, facadeOnBack: false,
  cells: [['roof', 'roof'], ['roof', 'roof'], ['wall', 'wall'], ['door', 'door']],
} as unknown as GridBuilding

const sum = (c: { col: number; row: number }) => c.col + c.row
const footprint = buildingFootprintCells(b).cells
const minFootSum = Math.min(...footprint.map(sum)) // the up-screen-most footprint cell

describe('buildingHeightExtraCells — tall buildings extend collision up-screen (approach B)', () => {
  test('top view adds NO extra cells (the flat footprint is the positional guide)', () => {
    expect(buildingHeightExtraCells(b, 'top')).toEqual([])
  })

  test('iso extends along the (-1,-1) diagonal — every extra cell is strictly up-screen of the footprint', () => {
    const extra = buildingHeightExtraCells(b, 'iso')
    expect(extra.length).toBeGreaterThan(0)
    for (const c of extra) expect(sum(c)).toBeLessThan(minFootSum) // above the whole footprint on the iso screen
  })

  test('2D extends straight north — extras keep the footprint columns and sit above its front row', () => {
    const extra = buildingHeightExtraCells(b, 'td')
    expect(extra.length).toBeGreaterThan(0)
    const footCols = new Set(footprint.map(c => c.col))
    const minFootRow = Math.min(...footprint.map(c => c.row))
    for (const c of extra) {
      expect(footCols.has(c.col)).toBe(true) // same columns, no sideways spread
      expect(c.row).toBeLessThan(minFootRow) // north of the footprint
    }
  })

  test('never re-blocks the footprint or the walkable door', () => {
    const footKeys = new Set(footprint.map(c => `${c.col},${c.row}`))
    const door = buildingDoorCell(b)
    for (const view of ['iso', 'td'] as const) {
      for (const c of buildingHeightExtraCells(b, view)) {
        expect(footKeys.has(`${c.col},${c.row}`)).toBe(false)
        expect(c.col === door.col && c.row === door.row).toBe(false)
      }
    }
  })

  test('a taller building reaches farther than a short one', () => {
    const tall = { ...b, cells: Array.from({ length: 10 }, () => ['wall', 'wall']) } as unknown as GridBuilding
    const short = { ...b, cells: [['roof', 'roof'], ['door', 'door']] } as unknown as GridBuilding
    expect(buildingHeightExtraCells(tall, 'iso').length).toBeGreaterThan(buildingHeightExtraCells(short, 'iso').length)
  })
})
