/**
 * BUILDING SIZES COME FROM THE BACKEND — they are not copied into the frontend.
 *
 * Alexander (2026-09-06): *"anything that is data should be migrated to the backend, in fact, we'll migrate
 * pretty much every bit of hardcoded data, even the generators and the footprints they use"* — and, on the
 * lockstep this replaces: *"generating bigger houses, just mean we'll store bigger houses in the backend"*.
 *
 * The same truth used to live in THREE places: `buildingCatalog.BUILDING_DEPTH`,
 * `buildingCatalog.BUILDING_PLACE_LENGTH`, and a second pair inside `villageLayout`. All three were
 * hand-maintained against `Nebulith.Catalog.BuildingCompositions` with nothing enforcing the match — so raising
 * a building's depth in Elixir silently desynced the plot planner from what the stamp actually fills.
 *
 * Now they RESOLVE from the loaded compositions. These tests prove derivation, not agreement: they change the
 * loaded footprint and assert the answer moves with it. A copied constant cannot pass that.
 */
import { styleCatalog } from '@/engine/tileset/styleTiles'
import { useSeedTileset } from '@/__tests__/helpers/tilesetSeed'
import { BACKEND_BUILDING_SIZES, buildingDepth, buildingPlaceLength } from '@/engine/buildingCatalog'

describe('building sizes resolve from the loaded backend compositions', () => {
  useSeedTileset()

  test('DEPTH is the composition\'s own south-facing footprint_h', () => {
    const house = styleCatalog('ascii').compositions?.house_4
    expect(house).toBeDefined()
    expect(buildingDepth('house', 4)).toBe(house!.footprint.h)
  })

  test('DERIVED, not copied: deepen the loaded composition and the planner depth follows', () => {
    const house = styleCatalog('ascii').compositions!.house_4
    const original = house.footprint.h
    try {
      house.footprint.h = original + 3
      expect(buildingDepth('house', 4)).toBe(original + 3)
    } finally {
      house.footprint.h = original
    }
  })

  test('depth is per baked SIZE, not per type — deepening house_5 leaves house_3 alone', () => {
    const wide = styleCatalog('ascii').compositions!.house_5
    const original = wide.footprint.h
    try {
      wide.footprint.h = original + 2
      expect(buildingDepth('house', 5)).toBe(original + 2)
      expect(buildingDepth('house', 3)).toBe(styleCatalog('ascii').compositions!.house_3.footprint.h)
      expect(buildingDepth('house', 3)).not.toBe(buildingDepth('house', 5))
    } finally {
      wide.footprint.h = original
    }
  })

  test('a size that is not baked yields null — the planner skips it instead of reserving a guess', () => {
    expect(buildingDepth('house', 99)).toBeNull()
  })

  test('PLACE LENGTH is a real baked facade width for that type', () => {
    const length = buildingPlaceLength('store')
    expect(length).not.toBeNull()
    expect(styleCatalog('ascii').compositions?.[`store_${length}`]).toBeDefined()
  })

  test('a type with several baked widths resolves to one of them, deterministically', () => {
    const first = buildingPlaceLength('house')
    expect(styleCatalog('ascii').compositions?.[`house_${first}`]).toBeDefined()
    expect(buildingPlaceLength('house')).toBe(first) // stable across calls
  })

  test('an unloaded composition yields null — no invented default', () => {
    const saved = styleCatalog('ascii').compositions
    try {
      styleCatalog('ascii').compositions = {}
      expect(buildingDepth('house', 4)).toBeNull()
      expect(buildingPlaceLength('house')).toBeNull()
    } finally {
      styleCatalog('ascii').compositions = saved
    }
  })

  test('the planner adapter is exactly those resolvers — one source, no second copy', () => {
    const length = buildingPlaceLength('store')!
    expect(BACKEND_BUILDING_SIZES.lengthOf('store')).toBe(length)
    expect(BACKEND_BUILDING_SIZES.depthOf('store', length)).toBe(buildingDepth('store', length))
  })
})
