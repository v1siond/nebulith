/**
 * A REGION BELONGS TO ITS PLACE.
 *
 * Every wild environment serves the SAME five regions now: the edge of the wood, the deep wood, a glade, a
 * thicket and a lakeside. What differs between a swamp and a beach is not which regions they have, it is what
 * each region is made of, so a region that stated no blooms of its own planted the season's near-white daisy
 * into a rainforest. A row states its own, and nothing falls back to the season.
 *
 * These iterate the regions a row actually SERVES rather than naming them. The backend decides what regions
 * exist, and a test that keeps its own list of them breaks the day the catalog describes them better, which
 * is exactly how the old `open` / `dense` / `swamp` / `ruins` set died: swamp and ruins were promoted to
 * environments of their own.
 *
 * These assert the DATA rather than a rendered map, because that is where the answer lives and because a
 * generated map only samples it.
 */
import { findGeneratorByKey, parseGeneratorCatalog, type GeneratorSubZone } from '@/lib/generatorCatalog'
import liveBody from '@/__tests__/fixtures/generators.json'
import '@/__tests__/helpers/installTilesetSeed'
import { styleCatalog } from '@/engine/tileset/styleTiles'
import { resolveComposition } from '@/engine/tileset/tileset'
import { buildCompositionPalette } from '@/engine/compositionCatalog'

const CATALOG = parseGeneratorCatalog(liveBody)

const regions = (key: string): readonly GeneratorSubZone[] => {
  const zones = findGeneratorByKey(CATALOG, key)?.config.subZones
  if (!zones || zones.length === 0) throw new Error(`no served regions for ${key}`)
  return zones
}
const region = (key: string, name: string): GeneratorSubZone => {
  const hit = regions(key).find(z => z.key === name)
  if (!hit) throw new Error(`${key} serves no ${name} region`)
  return hit
}
const species = (key: string, name: string) => (region(key, name).trees ?? []).map(t => t.kind)

/** Bushes and saplings, the ground cover every environment shares. What is left is a row's own canopy. */
const UNDERGROWTH = ['bush', 'bush_round', 'tree_sapling']
const canopyOf = (key: string, name: string) => species(key, name).filter(k => !UNDERGROWTH.includes(k))

describe('a swamp grows swamp things in every region', () => {
  it.each(regions('forest_swamp').map(z => z.key))('the %s region states its own blooms, so none falls back to the season', name => {
    expect(region('forest_swamp', name).flowers ?? []).not.toHaveLength(0)
  })

  it('no region anywhere in it plants the near-white the season carries', () => {
    // #f4f4ec is summer's daisy, the exact colour that was rejected.
    for (const z of regions('forest_swamp')) {
      const whites = (z.flowers ?? []).filter(f => f.color?.toLowerCase() === '#f4f4ec')
      expect({ region: z.key, whites: whites.length }).toEqual({ region: z.key, whites: 0 })
    }
  })

  it('the CYPRESS runs through every region that grows a canopy, because that is what stands in this water', () => {
    // The thicket is bramble in every environment, so it grows no canopy to put a cypress in. Every region
    // that DOES grow one has to carry the swamp's own tree, or the map reads as some other wood.
    const wooded = regions('forest_swamp').filter(z => canopyOf('forest_swamp', z.key).length > 0)
    expect(wooded.length).toBeGreaterThan(2) // and the filter never silently empties the case
    for (const z of wooded) {
      expect({ region: z.key, cypress: species('forest_swamp', z.key).includes('tree_cypress') })
        .toEqual({ region: z.key, cypress: true })
    }
  })
})

describe('a beach grows coastal things', () => {
  it.each(regions('forest_beach').map(z => z.key))('the %s region states its own blooms', name => {
    expect(region('forest_beach', name).flowers ?? []).not.toHaveLength(0)
  })

  it('grows TROPICAL species, not a temperate wood with palms dropped in', () => {
    // A species is proportions on the shared two-tile tree, so the whole of the coast's canopy has to come
    // out of the tropical set. One temperate trunk anywhere in it is the defect this case is named for.
    const tropical = ['tree_coconut', 'tree_banana', 'tree_mangrove', 'tree_palm']
    for (const z of regions('forest_beach')) {
      const foreign = canopyOf('forest_beach', z.key).filter(k => !tropical.includes(k))
      expect({ region: z.key, foreign }).toEqual({ region: z.key, foreign: [] })
      expect({ region: z.key, giant: species('forest_beach', z.key).includes('tree_giant') })
        .toEqual({ region: z.key, giant: false })
    }
    // and it really is a canopy, not five regions of bare bramble that pass the line above for free
    expect(regions('forest_beach').filter(z => canopyOf('forest_beach', z.key).length > 0).length).toBeGreaterThan(2)
  })

  it('the coast keeps its WATER species, which is what he meant by water nature', () => {
    // NAMED FOR THE REGIONS THAT EXIST. This asked a beach for its `deep` and a swamp for its `glade`, which
    // are the WOODLAND's region names: both sets were replaced when each biome got its own, and the case went
    // on passing because it reads a captured fixture that still held the old ones. The property is unchanged,
    // it is asked of the region that actually stands in the water now.
    expect(species('forest_beach', 'shore')).toContain('tree_mangrove')
    expect(species('forest_swamp', 'open_water')).toContain('tree_mangrove')
  })

  it('each tropical species is BROWSEABLE, so it shows in the objects list', () => {
    // The palette lists a composition
    // when its served `category` is a browseable bucket and never by a name heuristic, so this asserts the
    // bucket rather than the rendering: a species authored without one draws on the map and can never be
    // placed by hand.
    const nature = buildCompositionPalette(styleCatalog('ascii')).find(g => g.category === 'nature')
    const kinds = (nature?.items ?? []).map(i => i.kind)
    for (const kind of ['tree_coconut', 'tree_banana', 'tree_mangrove']) {
      expect({ kind, listed: kinds.includes(kind) }).toEqual({ kind, listed: true })
    }
  })

  it('each tropical species is a real composition the backend serves, not a name', () => {
    // A tree mix naming a composition that does not exist plants nothing and says nothing about it.
    for (const kind of ['tree_coconut', 'tree_banana', 'tree_mangrove']) {
      const comp = resolveComposition(styleCatalog('ascii'), kind)
      expect({ kind, cells: comp?.cells.length ?? 0 }).toEqual({ kind, cells: 2 })
    }
  })
})

describe('NO tropical row anywhere falls through to the season', () => {
  /**
   * Measured 2026-09-13, and it is why the map showed the daisies again after the swamp was fixed: giving the
   * SWAMP its own regions did nothing for the plain jungle, whose regions still stated no blooms and so
   * planted summer's near-white. A rainforest floor is not a daisy meadow.
   */
  const TROPICAL = ['forest_jungle', 'forest_swamp', 'forest_beach', 'forest_ruins', 'forest_desert']

  it.each(regions('forest_jungle').map(z => z.key))('the jungle\'s %s region states its own blooms', name => {
    expect(region('forest_jungle', name).flowers ?? []).not.toHaveLength(0)
  })

  it('every region of every tropical row, with none left on the season', () => {
    for (const key of TROPICAL) {
      const bare = regions(key).filter(z => (z.flowers ?? []).length === 0).map(z => z.key)
      expect({ key, bare }).toEqual({ key, bare: [] })
    }
  })

  it('the SPECIES still differ per row, so shared blooms did not flatten them', () => {
    // The blooms are shared; the trees are not. The beach is palms, the swamp is cypress, the jungle is the giant.
    // The regions each of these templates actually serves: a beach's palm stand and a swamp's mire, not the
    // woodland's `glade` both of them were asked for before every biome got its own set.
    expect(species('forest_beach', 'palms')).toContain('tree_palm')
    expect(species('forest_swamp', 'mire')).toContain('tree_cypress')
    // The jungle's giants stand in its `emergent` region: it was `deep`, one of the generic five every
    // biome used to be served, and a rainforest has no "deep wood" in it.
    expect(species('forest_jungle', 'emergent')).toContain('tree_giant')
  })
})
