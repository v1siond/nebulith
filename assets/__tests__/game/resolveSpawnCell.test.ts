/**
 * #87/#88 — where the player lands on a template LOAD.
 *   #87: reloading the map you're already in keeps your CURRENT position (keptCell), not the spawn.
 *   #88: a stale/out-of-bounds spawn (e.g. a legacy fixed 25,25 on a smaller map) is CLAMPED in.
 */
import { resolveSpawnCell } from '@/game/runtime/player'

const SPAWN = { col: 3, row: 4 }

describe('resolveSpawnCell — priority + clamp', () => {
  test('a teleport override wins over everything', () => {
    const r = resolveSpawnCell(
      { override: { col: 9, row: 2 }, keptCell: { col: 1, row: 1 }, playerMarker: { col: 5, row: 5 }, templateSpawn: SPAWN },
      30, 30,
    )
    expect(r).toEqual({ col: 9, row: 2 })
  })

  test('#87: no override → keptCell (current position on a reload) beats the saved spawn/marker', () => {
    const r = resolveSpawnCell(
      { override: null, keptCell: { col: 12, row: 7 }, playerMarker: { col: 5, row: 5 }, templateSpawn: SPAWN },
      30, 30,
    )
    expect(r).toEqual({ col: 12, row: 7 })
  })

  test('fresh load (no override, no keptCell) → the saved player marker, else the template spawn', () => {
    expect(resolveSpawnCell({ override: null, keptCell: null, playerMarker: { col: 5, row: 6 }, templateSpawn: SPAWN }, 30, 30)).toEqual({ col: 5, row: 6 })
    expect(resolveSpawnCell({ override: null, keptCell: null, playerMarker: null, templateSpawn: SPAWN }, 30, 30)).toEqual(SPAWN)
  })

  test('#88: an out-of-bounds spawn is clamped into the target grid (25,25 on a 20×18 map)', () => {
    const r = resolveSpawnCell({ override: { col: 25, row: 25 }, templateSpawn: SPAWN }, 20, 18)
    expect(r).toEqual({ col: 19, row: 17 }) // clamped to the last col/row, then the caller snaps to walkable
  })

  test('#88: negative coords clamp to 0', () => {
    expect(resolveSpawnCell({ override: { col: -4, row: -1 }, templateSpawn: SPAWN }, 10, 10)).toEqual({ col: 0, row: 0 })
  })
})
