/**
 * LOADING A SAVED MAP MUST NOT BLOCK THE FLOOR WITH THE STOREY ABOVE IT.
 *
 * Alexander (2026-09-06, Image #13): *"actually it's worse, the collissions don't match the generated building"*.
 *
 * Measured cause — his saved `village` template holds 204 blocking assets, 89 of them ABOVE ground level
 * (`window` @L2/L4/L6, upper wall courses @L3/L5, `awning` @L2). `deserializeToGrid` blocked a cell for EVERY
 * blocking asset regardless of level:
 *     // Blocks are collision regardless of any visual height level — a blocking asset always blocks its cell.
 * So a second-floor window stamped collision onto the floor of the room beneath it, and the collision map traced
 * the UPPER STOREYS instead of the walls. Freshly generated maps were fine (0 mismatches measured) — only saved
 * ones were wrong, which is why it looked like the collisions "don't match the building".
 *
 * The rule, the same one the composition stamp follows: the 2D collision map is written by GROUND-level blocks
 * only. A unit walks on the ground, so the ground is what that flat map means. Tiles keep their own truthful
 * `blocking` data — a roof still blocks as a block; it just does not seal the room under it.
 */
import { deserializeToGrid } from '@/lib/api'
import type { TemplateData } from '@/lib/api'
import { FLOOR_TYPE } from '@/engine/IsometricGrid'

const COLS = 6
const ROWS = 6

/** A saved template carrying exactly the assets given, over a flat paved map. */
const template = (assets: Record<string, unknown>[]): TemplateData => {
  const floors = []
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      floors.push({ art: [''], col: c, row: r, type: FLOOR_TYPE, tileKey: 'path_stone', heightLevel: 0, blocking: false, height: 1 })
  return {
    id: 't', name: 'test', cols: COLS, rows: ROWS, cellSize: 16, isoScale: 1.4,
    heightData: Array.from({ length: ROWS }, () => Array(COLS).fill(0)),
    groundData: Array.from({ length: ROWS }, () => Array(COLS).fill('path_stone')),
    assetsData: [...floors, ...assets],
    entities: [], connectors: [], quests: [], spawnCol: 0, spawnRow: 0,
  } as unknown as TemplateData
}

describe('deserializeToGrid — only ground-level blocks reach the collision map', () => {
  test('a GROUND-level wall blocks its cell', () => {
    const grid = deserializeToGrid(template([
      { art: ['#'], col: 2, row: 2, type: 'house_4', label: 'wall_stone_c', heightLevel: 1, blocking: true, height: 1 },
    ]))
    expect(grid.isBlocked(2, 2)).toBe(true)
  })

  test('THE BUG: a second-floor WINDOW does not block the floor beneath it', () => {
    const grid = deserializeToGrid(template([
      { art: ['#'], col: 3, row: 3, type: 'house_4', label: 'window', heightLevel: 4, blocking: true, height: 1 },
    ]))
    expect(grid.isBlocked(3, 3)).toBe(false)
  })

  test('a ROOF high above an open cell leaves it walkable', () => {
    const grid = deserializeToGrid(template([
      { art: ['#'], col: 4, row: 4, type: 'house_4', label: 'roof', heightLevel: 6, blocking: true, height: 1 },
    ]))
    expect(grid.isBlocked(4, 4)).toBe(false)
  })

  test('a wall on the ground still blocks even when an upper storey stands on the same cell', () => {
    const grid = deserializeToGrid(template([
      { art: ['#'], col: 1, row: 1, type: 'house_4', label: 'wall_stone_c', heightLevel: 1, blocking: true, height: 1 },
      { art: ['#'], col: 1, row: 1, type: 'house_4', label: 'window', heightLevel: 3, blocking: true, height: 1 },
    ]))
    expect(grid.isBlocked(1, 1)).toBe(true)
  })

  test('a non-blocking asset never blocks, at any level', () => {
    const grid = deserializeToGrid(template([
      { art: ['#'], col: 5, row: 5, type: 'house_4', label: 'door', heightLevel: 1, blocking: false, height: 1 },
    ]))
    expect(grid.isBlocked(5, 5)).toBe(false)
  })
})
