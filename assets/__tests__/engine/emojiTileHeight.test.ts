/**
 * The DATA half of item 3: the emoji tileset carries a per-tile default iso block height, and the
 * placed-instance override (GridAsset.height) wins over it — the colour-as-data rule applied to the
 * 3D form. Locks in that block-like tiles extrude and flat terrain stays flat, so a reseed can't
 * silently drop the defaults.
 */
import '@/__tests__/helpers/installTilesetSeed' // tile heights come from the loaded backend tileset fixture; the frontend ships no bundled default
import { EMOJI_TILESET } from '@/engine/tileset/emojiTileset'
import { resolveTileHeight } from '@/engine/tileset/tileHeight'

describe('emoji tileset — data-driven default iso block height', () => {
  test('block-like tiles default to one cube tall', () => {
    for (const kind of ['wall', 'crate', 'rock'] as const) {
      expect(resolveTileHeight(EMOJI_TILESET[kind], undefined)).toBe(1)
    }
  })

  test('flat terrain/ground tiles are a thin slab (DB height 0.1), not a full block', () => {
    // The minimal flat height (0.1) is DATA in the DB (nebulith data migration), read here — never invented.
    for (const kind of ['grass', 'water', 'path', 'sand', 'plaza'] as const) {
      expect(resolveTileHeight(EMOJI_TILESET[kind], undefined)).toBe(0.1)
    }
  })

  test('a placed instance height overrides the tile default (editor Z control)', () => {
    expect(resolveTileHeight(EMOJI_TILESET.grass, { height: 3 })).toBe(3) // lift a flat tile into a block
    expect(resolveTileHeight(EMOJI_TILESET.wall, { height: 0 })).toBe(0) // explicit 0 flattens a block tile
  })
})
