/**
 * ONLY GROUND-LEVEL BLOCKS BLOCK THE FLOOR.
 *
 * The grid's collision map is 2D — one flag per (col,row) — while a composition is 3D: a wall at level 0, a
 * window at level 3, a roof at level 5, a rooftop AC unit above that. If EVERY non-walkable cell wrote into
 * that flat map, anything overhead would seal the floor underneath it.
 *
 * That is exactly what a flat-roof shop did: its crown (`rooftop_unit` / the sign) is authored at the centre of
 * the footprint, above the room, and it punched a blocked hole in the middle of the shop floor:
 *     #####
 *     #.#.#   ← the crown, five levels up, blocking the floor
 *     #...#
 *     ##d##
 *
 * A unit walks at ground level, so ground level is what the 2D map means. A roof still BLOCKS as a block
 * (Alexander: "roof should have collissions") — it is authored `walkable: false` and nothing stands on it —
 * it just does not seal the room beneath it.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { IsometricGrid } from '@/engine/IsometricGrid'
import { stampComposition } from '@/game/runtime/composition'

const ANCHOR = 6
const mkGrid = () => new IsometricGrid({ cols: 30, rows: 30, cellSize: 16, isoScale: 1.4 })

/** The interior cells of a stamped composition's footprint (the rect minus its outer ring). */
const interiorOf = (col: number, row: number, w: number, h: number): [number, number][] => {
  const out: [number, number][] = []
  for (let r = row + 1; r < row + h - 1; r++) for (let c = col + 1; c < col + w - 1; c++) out.push([c, r])
  return out
}

describe('a stamped building leaves its FLOOR walkable under overhead blocks', () => {
  test('the flat-roof crown (a rooftop unit, five levels up) does not block the shop floor', () => {
    const grid = mkGrid()
    const placed = stampComposition(grid, 'store_5', ANCHOR, ANCHOR, 'spring')
    expect(placed).toBeGreaterThan(0)

    const blockedInterior = interiorOf(ANCHOR, ANCHOR, 5, 4).filter(([c, r]) => grid.isBlocked(c, r))
    expect(blockedInterior).toEqual([])
  })

  test('the SHELL still blocks — ground-level walls are solid', () => {
    const grid = mkGrid()
    stampComposition(grid, 'store_5', ANCHOR, ANCHOR, 'spring')

    // the back-row corners are wall columns at level 0
    expect(grid.isBlocked(ANCHOR, ANCHOR)).toBe(true)
    expect(grid.isBlocked(ANCHOR + 4, ANCHOR)).toBe(true)
  })

  test('a gable house keeps its interior clear too', () => {
    const grid = mkGrid()
    stampComposition(grid, 'house_5', ANCHOR, ANCHOR, 'spring')

    const blockedInterior = interiorOf(ANCHOR, ANCHOR, 5, 4).filter(([c, r]) => grid.isBlocked(c, r))
    expect(blockedInterior).toEqual([])
  })
})
