import { IsometricGrid } from '@/engine/IsometricGrid'
import { deserializeToGrid } from '@/lib/api'

/**
 * THE MAP'S OWN SHAPE SURVIVES A LOAD.
 *
 * `cellSize`, `isoScale` and `slabBlocks` describe the map and save with it. A load only applied them
 * when it had to BUILD the grid, and the editor always hands in the grid it already has, so every
 * saved map opened at whatever the editor happened to be holding and the numbers it had written
 * travelled nowhere.
 *
 * Measured before this: a map authored at cellSize 32 / isoScale 3.25 / slabBlocks 4 opened at
 * 16 / 2.5 / 1, every time.
 *
 * docs/SPEC.md §8 phase 3: "the map's own cell size, iso scale and body thickness, written on every
 * save and never read back".
 */

const saved = (over: Record<string, unknown> = {}) =>
  ({
    cols: 4,
    rows: 4,
    cellSize: 32,
    isoScale: 3.25,
    slabBlocks: 4,
    groundData: [[], [], [], []],
    heightData: [[], [], [], []],
    assetsData: [],
    ...over,
  }) as unknown as Parameters<typeof deserializeToGrid>[0]

describe('a saved map carries its own shape back', () => {
  it('applies the saved numbers onto the grid the editor already has', () => {
    const open = new IsometricGrid({ cols: 4, rows: 4, cellSize: 16, isoScale: 2.5, slabBlocks: 1 })

    deserializeToGrid(saved(), open)

    expect(open.cellSize).toBe(32)
    expect(open.isoScale).toBe(3.25)
    expect(open.slabBlocks).toBe(4)
  })

  it('still applies them when it builds the grid itself', () => {
    const built = deserializeToGrid(saved())

    expect(built.cellSize).toBe(32)
    expect(built.isoScale).toBe(3.25)
    expect(built.slabBlocks).toBe(4)
  })

  it('a row that states no thickness keeps the grid\'s, rather than resetting to a number nobody chose', () => {
    const open = new IsometricGrid({ cols: 4, rows: 4, cellSize: 16, isoScale: 2.5, slabBlocks: 7 })

    deserializeToGrid(saved({ slabBlocks: undefined }), open)

    expect(open.slabBlocks).toBe(7)
    expect(open.cellSize).toBe(32) // the ones it DID state still apply
  })
})
