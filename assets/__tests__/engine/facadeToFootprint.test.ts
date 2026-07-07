/**
 * facadeToFootprint — regenerate an OLD saved facade building (grid.buildings) into the new tile
 * footprint: perimeter = wall tiles (iso height = floors), interior = flat floor tiles, and the ONE
 * road-facing door cell stays a flat door (keeping its connector). Position/size/floors are preserved;
 * the exact old facade shape is not. Called on template LOAD so pre-tileset maps come back as tiles.
 *
 * Pure: it reuses buildingRect + the facing-aware doorCellFor so a converted door lands exactly where
 * the live stamp / generator would.
 */
import { facadeToFootprint } from '@/engine/buildingEditor'
import type { GridBuilding } from '@/engine/IsometricGrid'

// A south-facing 4×3 building (bottom row 12) with 2 body floors + 1 roof row.
const south: GridBuilding = {
  col: 10,
  row: 12, // bottom/front row
  length: 4,
  height: 3, // grid row-span
  depth: 3,
  type: 'house',
  facing: 0,
  cells: [
    ['roof', 'roof', 'roof', 'roof'],
    ['wall', 'window', 'window', 'wall'],
    ['wall', 'wall', 'door', 'wall'],
  ],
}

describe('facadeToFootprint — a saved facade building → wall/floor/door tile footprint', () => {
  test('south house: 9 walls (height = 2 floors) + 2 interior floors + 1 door', () => {
    const cells = facadeToFootprint(south)
    expect(cells).toHaveLength(12) // rect 4×3
    const walls = cells.filter(c => c.kind === 'wall')
    const floors = cells.filter(c => c.kind === 'floor')
    const doors = cells.filter(c => c.kind === 'door')
    expect(walls).toHaveLength(9)
    expect(floors).toHaveLength(2)
    expect(doors).toHaveLength(1)
    expect(walls.every(c => c.height === 2)).toBe(true) // 2 body rows → 2 floors tall
    expect(floors.every(c => c.height === 0)).toBe(true)
    expect(doors[0]).toMatchObject({ col: 12, row: 12, height: 0 }) // south door = bottom-edge centre
    expect(floors.map(c => `${c.col},${c.row}`).sort()).toEqual(['11,11', '12,11'])
  })

  test('position + size preserved: corners land on the saved rect', () => {
    const cells = facadeToFootprint(south)
    const at = (col: number, row: number) => cells.find(c => c.col === col && c.row === row)
    expect(at(10, 10)).toMatchObject({ kind: 'wall' }) // rect top-left
    expect(at(13, 12)).toMatchObject({ kind: 'wall' }) // rect bottom-right
  })

  test('facing preserved: an east-facing building puts the door on the right edge', () => {
    const east = { ...south, facing: 1, facadeOnBack: false }
    const door = facadeToFootprint(east).find(c => c.kind === 'door')
    expect(door).toMatchObject({ col: 13, row: 11 }) // east door = right-edge centre of rect (rows 10-12)
  })

  test('floors clamp to at least 1 even if the facade has no body rows', () => {
    const roofOnly = { ...south, cells: [['roof', 'roof', 'roof', 'roof']] }
    expect(facadeToFootprint(roofOnly).filter(c => c.kind === 'wall').every(c => c.height === 1)).toBe(true)
  })
})
