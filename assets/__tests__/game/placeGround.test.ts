/**
 * placeGround — the ONE ground-placement helper every map-builder (generator apply + editor paint + fills)
 * routes through, so a floor is ALWAYS born with its colour as STATE. Alexander: "the generator should put the
 * color on the tile … if we don't [have a value], empty grid." The grid itself stays pure (it only stores what
 * it's handed); this helper PICKS the ground tile's DB colour (groundTileColor) and writes it — so no floor can
 * ever be placed colourless, and every view just READS floor.color (no render-time derivation, no fallback).
 */
import { placeGround } from '@/game/editor/tileBrush'
import { IsometricGrid } from '@/engine/IsometricGrid'
import { groundTileColor } from '@/engine/render/shared'
import { useSeedTileset } from '@/__tests__/helpers/tilesetSeed'

describe('placeGround — writes the floor slug AND its DB colour as state', () => {
  useSeedTileset()

  it('a placed floor carries its ground tile colour (state), matching groundTileColor', () => {
    const grid = new IsometricGrid({ cols: 6, rows: 6, cellSize: 40 })
    placeGround(grid, 1, 2, 'grass')
    const floor = grid.floorAt(1, 2)
    expect(floor?.tileKey).toBe('grass')
    expect(floor?.color).toBe(groundTileColor('grass', 1, 2))
    expect(floor?.color).toBeTruthy() // never placed colourless
  })

  it('re-placing a different ground kind updates the colour to that kind (state stays in sync)', () => {
    const grid = new IsometricGrid({ cols: 6, rows: 6, cellSize: 40 })
    placeGround(grid, 3, 3, 'grass')
    placeGround(grid, 3, 3, 'road')
    const floor = grid.floorAt(3, 3)
    expect(floor?.tileKey).toBe('road')
    expect(floor?.color).toBe(groundTileColor('road', 3, 3))
  })
})
