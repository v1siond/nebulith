/**
 * GRID-validate the door — the check the user asked for: the door TILE must sit on the walkable ENTRANCE
 * cell, and we log the door block's stack level (its lift). Pure grid assertions, no rendering.
 */
import { IsometricGrid } from '@/engine/IsometricGrid'
import { makeBuilding, buildingDoorCells, facadeToFootprint, buildingCellTiles } from '@/engine/buildingEditor'
import { isoStackLift } from '@/engine/render/iso'
import type { Facing } from '@/engine/villageLayout'
import { stampBuildingCells } from '@/game/runtime/buildings'
import { setAsciiTileset, ASCII_TILESET } from '@/engine/tileset/asciiTileset'

const mkGrid = () => new IsometricGrid({ cols: 24, rows: 24, cellSize: 16, isoScale: 1.4 })

describe('door tile vs walkable entrance (grid truth)', () => {
  for (const facing of ['south', 'north', 'east', 'west'] as Facing[]) {
    test(`facing ${facing}: door TILE cell == walkable ENTRANCE cell`, () => {
      const grid = mkGrid()
      const b = makeBuilding('house', facing, 10, 10)
      stampBuildingCells(grid, b, 'spring')
      const doorTiles = grid.assets.filter(a => a.type === 'structure' && a.label === 'door')
      const doorCells = doorTiles.map(a => `${a.col},${a.row}`).sort()
      const entrance = buildingDoorCells(b).map(d => `${d.col},${d.row}`).sort()
      // eslint-disable-next-line no-console
      console.log(`[${facing}] door tile cells:`, doorCells, 'heightLevels:', doorTiles.map(a => a.heightLevel), '| walkable entrance:', entrance)
      expect(doorCells).toEqual(entrance)
    })
  }

  test('a building SITS ON THE GROUND: lowest block is level 0 (lift 0), like a hand-stacked block', () => {
    const b = makeBuilding('house', 'south', 10, 10)
    const wallCell = facadeToFootprint(b).find(c => c.kind === 'wall')!
    const tiles = buildingCellTiles(b, wallCell.col, wallCell.row)
    const lowest = Math.min(...tiles.map(t => t.level))
    expect(lowest).toBe(0)                   // 0-based — the SAME numbering pushTile gives a hand-stacked block
    expect(isoStackLift(71, lowest)).toBe(0) // lift 0 = base on the floor, NOT a block up (fixes "everything 1 up")
  })

  test('door block also seats on the ground (level 0), so the door meets the entrance', () => {
    const grid = mkGrid()
    const b = makeBuilding('house', 'south', 10, 10)
    stampBuildingCells(grid, b, 'spring')
    const doorBlocks = grid.assets.filter(a => a.type === 'structure' && a.label === 'door')
    expect(doorBlocks.length).toBeGreaterThan(0)
    expect(doorBlocks.every(a => (a.heightLevel ?? 0) === 0)).toBe(true)
  })
})

describe('building tiles come from the LOADED ascii tileset, not hardcoded cellTile', () => {
  const original = ASCII_TILESET
  afterEach(() => setAsciiTileset(original))

  test('a wall glyph swapped in the loaded DB tileset drives the stamped wall block', () => {
    // swap the wall glyph in the loaded tileset — a stamp that read the frontend cellTile ('█') would ignore
    // this; a stamp that reads the DB tileset picks it up. Proves the live stamp is DB-driven (MAP-MODEL §8).
    setAsciiTileset({ ...original, tiles: { ...original.tiles, wall: { ...original.tiles.wall, glyph: '✚' } } })
    const grid = mkGrid()
    const b = makeBuilding('house', 'south', 10, 10)
    stampBuildingCells(grid, b, 'spring')
    const wall = grid.assets.find(a => a.type === 'structure' && a.label === 'wall')
    expect(wall).toBeDefined()
    expect(wall!.art[0]).toBe('✚')
  })
})
