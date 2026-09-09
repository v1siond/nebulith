/**
 * ART CARRIES NO HEIGHT — the tileset half of "all tiles/blocks are height 1, GLOBAL, no exceptions"
 * (Alexander, 2026-07-27).
 *
 * This file used to assert the opposite: that the emoji tileset carried a per-tile DEFAULT block height, so
 * `wall` extruded and `grass` stayed flat. That model is gone. A tile is pure ART; height is a property of
 * the PLACED BLOCK, assigned by whatever put it there. So the guard inverts — instead of proving the art's
 * heights survive a reseed, it proves no art tile can smuggle a height in at all.
 *
 * That inversion is the whole point of keeping the file. A reseed that re-attached heights to the pictures
 * would silently bring back the trench (a `height: 0` road art sinking below the height-1 grass beside it),
 * and nothing else in the suite would notice.
 */
import { styleTile, styleTiles } from '@/engine/tileset/styleTiles'
import '@/__tests__/helpers/installTilesetSeed' // the catalog comes from the loaded backend fixture; the frontend ships none
import { resolveTileHeight } from '@/engine/tileset/tileHeight'

describe('the emoji tileset carries pictures, not heights', () => {
  test('EVERY tile in the catalog places as one block — no picture carries a height of its own', () => {
    const tiles = Object.entries(styleTiles('emoji'))
    expect(tiles.length).toBeGreaterThan(0) // a fixture that failed to load would pass this suite vacuously

    const smuggled = tiles.filter(([, tile]) => resolveTileHeight(tile, undefined) !== 1)
    expect(smuggled.map(([label]) => label)).toEqual([])
  })

  test('ground and structure resolve IDENTICALLY — there is no flat-terrain branch left', () => {
    // The old model split these: `wall`/`crate`/`rock` were a block, `grass`/`water`/`path` were flat. One
    // rule now covers both, which is what lets a house stack ON the grass instead of inside it.
    for (const label of ['wall', 'crate', 'rock', 'grass', 'water', 'path', 'sand', 'plaza'] as const) {
      expect(resolveTileHeight(styleTile('emoji', label), undefined)).toBe(1)
    }
  })

  test('the PLACEMENT sets the height, for a ground tile exactly as for a wall', () => {
    expect(resolveTileHeight(styleTiles('emoji').grass, { height: 3 })).toBe(3) // a raised patch of ground
    expect(resolveTileHeight(styleTiles('emoji').wall, { height: 3 })).toBe(3) // a three-storey wall pier
    // …and neither can be flattened away: one block is the floor of the model.
    expect(resolveTileHeight(styleTiles('emoji').grass, { height: 0 })).toBe(1)
    expect(resolveTileHeight(styleTiles('emoji').wall, { height: 0 })).toBe(1)
  })

  test('the two art styles agree — the same LABEL is the same block in ascii and emoji', () => {
    // ONE engine, N art styles: a style is only a different picture for the same label, so a height that
    // differed between them would mean the label owned two sets of facts.
    for (const label of Object.keys(styleTiles('emoji'))) {
      const ascii = styleTile('ascii', label)
      if (!ascii) continue // a label one style has not been drawn for yet is a bake gap, not a height drift
      expect(resolveTileHeight(ascii, undefined)).toBe(resolveTileHeight(styleTile('emoji', label), undefined))
    }
  })
})
