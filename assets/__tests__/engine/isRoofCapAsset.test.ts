// The ONE fact iso SELECTION hinges on: a building's ROOF is drawn as the whole-footprint CAP, never as a
// per-cell block — so the iso render SKIPS the per-cell roof asset and the block picker must EXCLUDE it.
// Both read this same predicate, so a click can never land on a roof block that isn't on screen ("click the
// wall, select the roof"). When roofs become per-cell tiles this predicate is deleted — roofs pick like any block.
import { isRoofCapAsset } from '@/engine/render/iso'

describe('isRoofCapAsset — the roof is the cap, not a per-cell block', () => {
  test('a building ROOF asset is the cap (render skips it; pick excludes it)', () => {
    expect(isRoofCapAsset({ type: 'building', label: 'roof' })).toBe(true)
  })

  test('a building WALL / WINDOW / DOOR is a real per-cell block (not the cap)', () => {
    expect(isRoofCapAsset({ type: 'building', label: 'wall' })).toBe(false)
    expect(isRoofCapAsset({ type: 'building', label: 'window' })).toBe(false)
    expect(isRoofCapAsset({ type: 'building', label: 'door' })).toBe(false)
  })

  test('a non-building tile (tree / rock / bare) is never the cap', () => {
    expect(isRoofCapAsset({ type: 'rock' })).toBe(false)
    expect(isRoofCapAsset({ type: 'tree', label: 'roof' })).toBe(false) // "roof" label only counts on a building
    expect(isRoofCapAsset({})).toBe(false)
  })
})
