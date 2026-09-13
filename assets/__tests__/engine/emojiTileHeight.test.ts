/**
 * A TILE'S HEIGHT IS ITS OWN SETTING — served by the backend, saved with it, read by the engine.
 *
 * Alexander, 2026-09-10: *"the height setting from the floor tile is 0, which allow us to save it in the
 * backend … floor are regular fucking tiles, nothing more nothing less."*
 *
 * This file has been on both sides of that. It first asserted per-tile heights, then asserted the opposite
 * (that no tile carries one) when the engine stopped reading the column. It stopped reading it because the
 * DATA was inconsistent — `grass` and `road` said 0 while `meadow`, `water` and `path_stone` said 1, so a
 * road sank below the grass beside it and cut a trench. Ignoring the column hid that and cost the setting:
 * a floor could never be laid flat and no chosen height could be saved. Data migration 0008 made the column
 * consistent instead, so the engine reads it again.
 *
 * The contract now, in one line: **placement height ?? the tile's height ?? one block.**
 */
import { styleTile, styleTiles } from '@/engine/tileset/styleTiles'
import '@/__tests__/helpers/installTilesetSeed' // the catalog comes from the loaded backend fixture; the frontend ships none
import { resolveTileHeight } from '@/engine/tileset/tileHeight'

/** The categories that ARE the ground — the surface a unit stands on (data migration 0008). */
const GROUND = new Set(['terrain', 'floors', 'roads'])

describe("a tile's served height is what it is by default", () => {
  test('THE GROUND IS FLAT — every terrain / floor / road tile is 0 blocks', () => {
    const ground = Object.entries(styleTiles('emoji')).filter(([, t]) => GROUND.has(t.category ?? ''))
    expect(ground.length).toBeGreaterThan(20) // a fixture that failed to load would pass this vacuously

    // A flat tile has no side faces, so it occludes nothing and needs no turn in the depth sort — which is
    // what lets ground merge into z-width runs at all. A single 1-block floor here brings back the trench.
    //
    // THE WATER SURFACES BREAK THIS, AND THEY ALWAYS HAVE. `seed_water_color` gives `water` a height of 0.5 on
    // purpose, so a river sits under its own bank rim, and the two bands join it: Alexander, 2026-09-11, *"we
    // need the river without water, which is negative height compared to walking floor / then inside that we
    // put water with X height it can be < 1"*. That is his design and it is not going away.
    //
    // This test was GREEN on a stale fixture that carried `water` at height 0 with no frames. It was never
    // true of the live catalog. Naming the four here rather than deleting the assertion, because the conflict
    // is real and it is evidence for the perspective work: a non-flat ground tile is exactly the shape of
    // *"the floor is height 0, but it's showing on top of the tall grass which has height 1"*. When that lands,
    // this list should shrink to nothing or the rule should change on purpose.
    const KNOWN_NOT_FLAT = ['water', 'water_deep', 'water_shallow']
    const standing = ground.filter(([, t]) => resolveTileHeight(t, undefined) !== 0)
    expect(standing.map(([label]) => label).sort()).toEqual(KNOWN_NOT_FLAT)
  })

  test('…and everything that STANDS is still a block — walls, roofs, nature, props', () => {
    // "all tiles/blocks are height 1 by default. GLOBAL" still holds for anything that is not the ground.
    for (const label of ['wall_stone_c', 'wall_brick_c', 'roof', 'door', 'window'] as const) {
      const tile = styleTile('emoji', label)
      if (!tile) continue // a label this fixture does not carry is a bake gap, not a height claim
      expect(resolveTileHeight(tile, undefined)).toBeGreaterThanOrEqual(1)
    }
  })

  test('ground and structure resolve DIFFERENTLY — that difference is the whole point', () => {
    // They used to be forced identical, which is exactly what made a road indistinguishable from a wall to
    // the renderer and put a cube under every blade of grass.
    // `meadow`, not `water`. A water SURFACE is deliberately 0.5 so a river sits under its own bank rim, which
    // is the one documented exception to the flat-ground rule above and is his design, not a slip. Using it as
    // the flat example only worked while the fixture carried a stale height of 0.
    expect(resolveTileHeight(styleTiles('emoji').meadow, undefined)).toBe(0)
    expect(resolveTileHeight(styleTiles('emoji').grass, undefined)).toBe(0)
    expect(resolveTileHeight(styleTiles('emoji').wall_stone_c, undefined)).toBeGreaterThanOrEqual(1)
  })

  test('a PLACEMENT still overrides the tile — that is the editor Z control and an authored pier', () => {
    // The tile says what the thing IS; a placement says what THIS block is. Neither invents anything.
    expect(resolveTileHeight(styleTiles('emoji').water, { height: 3 })).toBe(3) // a raised weir
    expect(resolveTileHeight(styleTiles('emoji').wall_stone_c, { height: 4 })).toBe(4) // a four-storey pier
    expect(resolveTileHeight(styleTiles('emoji').wall_stone_c, { height: 0 })).toBe(0) // deliberately laid flat
  })

  test('the two art styles agree — the same LABEL is the same height in ascii and emoji', () => {
    // ONE engine, N art styles: a style is only a different picture for the same label, so a height that
    // differed between them would mean the label owned two sets of facts.
    for (const label of Object.keys(styleTiles('emoji'))) {
      const ascii = styleTile('ascii', label)
      if (!ascii) continue // a label one style has not been drawn for yet is a bake gap, not a height drift
      expect(resolveTileHeight(ascii, undefined)).toBe(resolveTileHeight(styleTile('emoji', label), undefined))
    }
  })
})
