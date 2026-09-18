/**
 * A NEW MAP IS A PLAIN COLOUR.
 *
 * The `?new=1` route used to generate a whole town.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { blankStage, FLAT_FLOOR } from '@/engine/stageGenerator'
import { groundTileColor } from '@/engine/tileset/groundColor'

describe('a blank map', () => {
  it('is the flat floor in every cell, in ONE colour', () => {
    const s = blankStage('summer', 12, 9)
    expect(s.ground.flat().every(g => g === FLAT_FLOOR)).toBe(true)
    const tones = new Set(s.floorColors.flat())
    expect(tones.size).toBe(1) // a plain colour, not a gradient and not a scatter
    expect([...tones][0]).toBe(groundTileColor(FLAT_FLOOR, 0, 0)) // the floor tile's OWN served colour
  })

  it('holds nothing at all, and nothing blocks', () => {
    const s = blankStage('winter', 20, 16)
    expect(s.props).toEqual([])
    expect(s.trees).toEqual([])
    expect(s.buildings).toEqual([])
    expect(s.compositions).toEqual([])
    expect(s.connectors).toEqual([])
    expect(s.routes).toBeNull()
    expect(s.collision.flat().some(Boolean)).toBe(false)
  })

  it('puts you in the middle of it, on a cell you can stand on', () => {
    const s = blankStage('summer', 21, 11)
    expect(s.spawn).toEqual({ col: 10, row: 5 })
    expect(s.collision[s.spawn.row][s.spawn.col]).toBe(false)
    expect(s.ground[s.spawn.row][s.spawn.col]).toBe(FLAT_FLOOR)
  })

  it('is the size the grid asked for', () => {
    const s = blankStage('desert', 7, 5)
    expect(s.cols).toBe(7)
    expect(s.rows).toBe(5)
    expect(s.ground).toHaveLength(5)
    expect(s.ground[0]).toHaveLength(7)
  })
})
