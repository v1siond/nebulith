/**
 * The DATA half of item 3: the emoji tileset carries a per-tile default iso block height, and the
 * placed-instance override (GridAsset.height) wins over it — the colour-as-data rule applied to the
 * 3D form. Locks in that block-like tiles extrude and flat terrain stays flat, so a reseed can't
 * silently drop the defaults.
 */
import { styleTile, styleTiles } from '@/engine/tileset/styleTiles'
import '@/__tests__/helpers/installTilesetSeed' // tile heights come from the loaded backend tileset fixture; the frontend ships no bundled default
import { resolveTileHeight } from '@/engine/tileset/tileHeight'

describe('emoji tileset — data-driven default iso block height', () => {
  test('block-like tiles default to one cube tall', () => {
    for (const kind of ['wall', 'crate', 'rock'] as const) {
      expect(resolveTileHeight(styleTile('emoji', kind), undefined)).toBe(1)
    }
  })

  test('flat terrain/ground tiles are FLAT — 0 blocks tall, not a full block', () => {
    // The flat height is DATA in the DB (nebulith data migration 0005, "GET THE TILES OF 0.1 DOWN TO 0"),
    // read here — never invented. A flat tile takes up no vertical room, so tiles stacked on it start on the
    // grid and there is no slab to special-case.
    for (const kind of ['grass', 'water', 'path', 'sand', 'plaza'] as const) {
      expect(resolveTileHeight(styleTile('emoji', kind), undefined)).toBe(0)
    }
  })

  test('a placed instance height overrides the tile default (editor Z control)', () => {
    expect(resolveTileHeight(styleTiles('emoji').grass, { height: 3 })).toBe(3) // lift a flat tile into a block
    expect(resolveTileHeight(styleTiles('emoji').wall, { height: 0 })).toBe(0) // explicit 0 flattens a block tile
  })
})
