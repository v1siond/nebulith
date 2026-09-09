/**
 * A UNIT STANDS ON THE GROUND — not on the roof over its head.
 *
 * Alexander (2026-09-06, Image #2): "when entering through a door, the user goes over the roof instead of
 * inside the house … instead of going inside, it went over the tiles, which is wrong" + "roof should have
 * collissions, so this shouldn't be a posssible bug".
 *
 * The reproduced defect (live town, door cell 27,4 — `blocked=false`, cellStackTop=8):
 *   L0 path_stone | L1 door | L3 wall_stone_c | L4 window | L5 wall_stone_c | L6 window | L7 roof_top_slate
 * The renderer lifted the hero by `cellStackTop` — the top of EVERYTHING in the cell — so a hero standing in
 * the doorway was drawn 8 blocks up, on the roof.
 *
 * The rule: a unit stands on the cell's GROUND surface. Walls / doors / windows / roofs are structure — you
 * pass through them (the cell is walkable) or they block the cell; they are never something a unit is lifted
 * onto. Raising the GROUND still lifts the unit, exactly like it lifts a stacked tile.
 */
import { unitStandLevel } from '@/engine/cellStack'
import { FLOOR_TYPE, IsometricGrid } from '@/engine/IsometricGrid'

const grid = (): IsometricGrid => new IsometricGrid({ cols: 8, rows: 8, cellSize: 32, isoScale: 1.4 })

/** Place the cell's GROUND tile (the floor asset the whole map is paved with). */
const ground = (g: IsometricGrid, col: number, row: number, slug = 'path_stone', level = 0): void => {
  const a = g.placeAsset(['.'], col, row, { type: FLOOR_TYPE, tileKey: slug, heightLevel: level })
  a.height = 1
}

/** Place one STRUCTURE block (a composition cell: wall / door / window / roof) at an explicit level. */
const block = (g: IsometricGrid, col: number, row: number, label: string, level: number, blocking = false): void => {
  const a = g.placeAsset(['#'], col, row, { type: 'house_4', heightLevel: level, blocking })
  a.label = label
  a.height = 1
}

describe('unitStandLevel — a unit stands on the ground, never on the structure above it', () => {
  test('a BARE cell (its ground cleared) has nothing to stand on → level 0', () => {
    const g = grid()
    g.removeFloor(1, 1)
    expect(unitStandLevel(g, 1, 1)).toBe(0)
  })

  test('a plain paved cell → the top of its ground tile', () => {
    const g = grid()
    ground(g, 1, 1)
    expect(unitStandLevel(g, 1, 1)).toBe(1)
  })

  test('THE BUG: a doorway column (door + walls + windows + roof stacked over the ground) still stands the unit on the ground', () => {
    const g = grid()
    ground(g, 2, 2)
    block(g, 2, 2, 'door', 1)
    block(g, 2, 2, 'wall_stone_c', 3)
    block(g, 2, 2, 'window', 4)
    block(g, 2, 2, 'wall_stone_c', 5)
    block(g, 2, 2, 'window', 6)
    block(g, 2, 2, 'roof_top_slate', 7)
    expect(unitStandLevel(g, 2, 2)).toBe(1)
  })

  test('a RAISED ground tile still lifts the unit (raising the floor lifts what stands on it)', () => {
    const g = grid()
    ground(g, 3, 3, 'meadow', 1)
    expect(unitStandLevel(g, 3, 3)).toBe(2)
  })

  test('a roof block overhead never lifts the unit off the ground it is standing on', () => {
    const g = grid()
    block(g, 4, 4, 'roof', 5)
    expect(unitStandLevel(g, 4, 4)).toBe(1) // the cell's own grass paving, not the roof five blocks up
  })
})
