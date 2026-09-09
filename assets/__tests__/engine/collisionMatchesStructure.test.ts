/**
 * COLLISION MUST MATCH THE STRUCTURE (Alexander, Image #5: "collissions don't match structures").
 *
 * The collision overlay tints `grid.isBlocked(col,row)`. The grid's collision map is 2D — one flag per cell —
 * and it means "a unit standing on the ground here is stopped". So the flag has exactly one truthful source:
 *
 *     a cell is blocked  ⟺  a GROUND-COURSE tile in it is non-walkable
 *
 * Anything else is a visible lie: a blocked cell with nothing standing in it paints red on bare grass, and a
 * walled cell left unblocked lets the player walk through the wall. This file pins that equivalence over the
 * REAL backend compositions (the fixture tileset), in every rotation, because a rotation is where an offset
 * bug hides.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { IsometricGrid } from '@/engine/IsometricGrid'
import type { Facing } from '@/engine/villageLayout'
import { stampBuildingComposition, stampComposition } from '@/game/runtime/composition'
import { unitStandLevel } from '@/engine/cellStack'

const mkGrid = () => new IsometricGrid({ cols: 24, rows: 24, cellSize: 16, isoScale: 1.4 })
const ANCHOR = 10

/** Cells the grid says are blocked. */
function blockedCells(grid: IsometricGrid): Set<string> {
  const out = new Set<string>()
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) if (grid.isBlocked(col, row)) out.add(`${col},${row}`)
  }
  return out
}

/**
 * Cells that genuinely hold a blocking tile ON THE SURFACE A UNIT WALKS — the only thing a 2D collision flag
 * can mean. NOT `heightLevel === 0`: every cell carries a floor slab at level 0, so a building's ground course
 * sits at level 1. `unitStandLevel` is the shared answer to "what level does a unit stand at here", and the
 * load path (`lib/api.ts`) already rebuilds collision with exactly this rule — a roof five levels up must not
 * seal the floor under it.
 */
function groundBlockingCells(grid: IsometricGrid): Set<string> {
  const out = new Set<string>()
  for (const a of grid.assets) {
    if (a.blocking && (a.heightLevel ?? 0) <= unitStandLevel(grid, a.col, a.row)) out.add(`${a.col},${a.row}`)
  }
  return out
}

const sorted = (s: Set<string>) => [...s].sort()

describe.each<Facing>(['south', 'north', 'east', 'west'])('a stamped house facing %s', facing => {
  const build = () => {
    const grid = mkGrid()
    stampBuildingComposition(grid, 'house', 4, ANCHOR, ANCHOR, 'spring', facing)
    return grid
  }

  it('blocks exactly the cells that hold a blocking ground tile — no more, no less', () => {
    const grid = build()
    expect(sorted(blockedCells(grid))).toEqual(sorted(groundBlockingCells(grid)))
  })

  it('never blocks a cell the building does not stand in — that is red paint on bare grass', () => {
    const grid = build()
    const occupied = new Set(grid.assets.map(a => `${a.col},${a.row}`))
    const strays = [...blockedCells(grid)].filter(cell => !occupied.has(cell))
    expect(strays).toEqual([])
  })

  it('leaves the doorway walkable — the way in', () => {
    const grid = build()
    // The door's ground course sits at the stand level (above the floor slab), not at heightLevel 0.
    const doors = grid.assets.filter(a => a.label === 'door' && (a.heightLevel ?? 0) <= unitStandLevel(grid, a.col, a.row))
    expect(doors.length).toBeGreaterThan(0)
    for (const door of doors) expect(grid.isBlocked(door.col, door.row)).toBe(false)
  })
})

describe.each([0, 1, 2, 3])('a composition stamped at rotation %i', rotation => {
  it('keeps collision and structure in the same cells', () => {
    const grid = mkGrid()
    stampComposition(grid, 'house_4', ANCHOR, ANCHOR, 'spring', 0, rotation)
    expect(sorted(blockedCells(grid))).toEqual(sorted(groundBlockingCells(grid)))
  })
})

describe('a z-width tile blocks the cells it actually lies across', () => {
  it('does not block a diagonal trail of cells it never covers', () => {
    const grid = mkGrid()
    stampComposition(grid, 'house_4', ANCHOR, ANCHOR, 'spring', 0, 0)
    // Every blocked cell must be inside the footprint the stamp reported occupying.
    const occupied = new Set(grid.assets.map(a => `${a.col},${a.row}`))
    for (const cell of blockedCells(grid)) expect(occupied.has(cell)).toBe(true)
  })
})
