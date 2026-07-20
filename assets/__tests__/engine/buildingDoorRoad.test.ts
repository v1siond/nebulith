/**
 * GRID-validate the door on a stamped building COMPOSITION: the door TILE must land on the road-FACING edge
 * of the footprint (so a rotated building fronts its street), seat on the ground (level 0), and stay WALKABLE
 * (the way in). Pure grid assertions, no rendering. Buildings are stamped compositions now — no facade unit.
 */
import '@/__tests__/helpers/installTilesetSeed' // the house_4 composition + wall tile come from the loaded backend tileset fixture
import { IsometricGrid } from '@/engine/IsometricGrid'
import type { Facing } from '@/engine/villageLayout'
import { stampBuildingComposition } from '@/game/runtime/composition'
import { setAsciiTileset, ASCII_TILESET } from '@/engine/tileset/asciiTileset'

const mkGrid = () => new IsometricGrid({ cols: 24, rows: 24, cellSize: 16, isoScale: 1.4 })
// A square 4×4 footprint (house_4) at this top-left, so a 90° rotation keeps the same footprint rect.
const ANCHOR = 10
const SIZE = 4 // house_4 footprint w == h

// The row/col of the footprint edge the door must sit on, per facing (south=bottom, north=top, …).
const doorOnEdge: Record<Facing, (col: number, row: number) => boolean> = {
  south: (_c, r) => r === ANCHOR + SIZE - 1,
  north: (_c, r) => r === ANCHOR,
  east: (c, _r) => c === ANCHOR + SIZE - 1,
  west: (c, _r) => c === ANCHOR,
}

describe('a stamped building composition fronts its road (door on the facing edge, walkable, on the ground)', () => {
  for (const facing of ['south', 'north', 'east', 'west'] as Facing[]) {
    test(`facing ${facing}: the door column sits on the road-facing edge, its ground cell level 0, walkable`, () => {
      const grid = mkGrid()
      stampBuildingComposition(grid, 'house', SIZE, ANCHOR, ANCHOR, 'spring', facing)
      const doorTiles = grid.assets.filter(a => a.label === 'door')
      // house_4 is EVEN-width → a centred 2-WIDE door (2 columns). Each 2-tall column is ONE collapsed
      // scaleY block seated on the ground (heightLevel 0) — the minimal-cell rebuild (#30).
      expect(doorTiles.length).toBeGreaterThanOrEqual(1)
      expect(doorTiles.every(d => (d.heightLevel ?? 0) === 0)).toBe(true) // every door column is one ground block
      const cols = new Set(doorTiles.map(d => `${d.col},${d.row}`))
      expect(cols.size).toBeGreaterThanOrEqual(1)
      expect(cols.size).toBeLessThanOrEqual(2) // 1 (odd width) or 2 (even width, centred) door columns
      for (const door of doorTiles) {
        expect(doorOnEdge[facing](door.col, door.row)).toBe(true) // on the correct road-facing edge
        expect(grid.collision[door.row]?.[door.col]).toBeFalsy() // the door cell stays WALKABLE (the way in)
      }
    })
  }
})

describe('building tiles come from the LOADED ascii tileset, not a hardcoded glyph', () => {
  const original = ASCII_TILESET
  afterEach(() => setAsciiTileset(original))

  test('a wall glyph swapped in the loaded DB tileset drives the stamped wall block', () => {
    // Swap the wall glyph in the loaded tileset — a stamp that read a frontend constant ('█') would ignore
    // this; a stamp that reads the DB tileset picks it up. Proves the live stamp is DB-driven (MAP-MODEL §8).
    // house_4's walls resolve to its wood MATERIAL center piece (wall_wood_c) — swap THAT glyph.
    setAsciiTileset({ ...original, tiles: { ...original.tiles, wall_wood_c: { ...original.tiles.wall_wood_c, glyph: '✚' } } })
    const grid = mkGrid()
    stampBuildingComposition(grid, 'house', SIZE, ANCHOR, ANCHOR, 'spring', 'south')
    const wall = grid.assets.find(a => a.label === 'wall_wood_c')
    expect(wall).toBeDefined()
    expect(wall!.art[0]).toBe('✚')
  })
})
