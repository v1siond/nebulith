/**
 * A REGION BELONGS TO ITS PLACE.
 *
 * `open` and `dense` are one shared pair reused by every jungle variant, so a SWAMP's open patch was, literally,
 * the rainforest's open patch: palms under summer's near-white daisy. A variant overrides the regions it
 * borrows now, and anything it does not name is inherited unchanged.
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

describe('a swamp jungle grows swamp things in every region', () => {
  it.each(['open', 'dense', 'swamp'])('the %s region states its own blooms, so none falls back to the season', name => {
    expect(region('forest_jungle_swamp', name).flowers ?? []).not.toHaveLength(0)
  })

  it('no region anywhere in it plants the near-white the season carries', () => {
    // #f4f4ec is summer's daisy, the exact colour that was rejected.
    for (const z of regions('forest_jungle_swamp')) {
      const whites = (z.flowers ?? []).filter(f => f.color?.toLowerCase() === '#f4f4ec')
      expect({ region: z.key, whites: whites.length }).toEqual({ region: z.key, whites: 0 })
    }
  })

  it('the CYPRESS runs through it, because that is what stands in this water', () => {
    for (const name of ['open', 'dense', 'swamp']) {
      expect({ name, cypress: species('forest_jungle_swamp', name).includes('tree_cypress') })
        .toEqual({ name, cypress: true })
    }
  })
})

describe('an island jungle grows coastal things', () => {
  it.each(['open', 'dense'])('the %s region states its own blooms', name => {
    expect(region('forest_jungle_island', name).flowers ?? []).not.toHaveLength(0)
  })

  it('grows TROPICAL species, not a temperate wood with palms dropped in', () => {
    // and, when I called it blocked on art,
    // That was right: a species is proportions on the shared two-tile tree.
    const tropical = ['tree_coconut', 'tree_banana', 'tree_mangrove', 'tree_palm']
    for (const name of ['open', 'dense']) {
      const grown = species('forest_jungle_island', name)
      expect({ name, tropical: grown.filter(k => tropical.includes(k)).length }).toEqual({ name, tropical: 3 })
      expect({ name, giant: grown.includes('tree_giant') }).toEqual({ name, giant: false })
    }
  })

  it('the coast keeps its WATER species, which is what he meant by water nature', () => {
    expect(species('forest_jungle_island', 'dense')).toContain('tree_mangrove')
    expect(species('forest_jungle_swamp', 'open')).toContain('tree_mangrove')
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

describe('NO jungle anywhere falls through to the season', () => {
  /**
   * Measured 2026-09-13, and it is why the map showed the daisies again after the swamp was fixed: giving the SWAMP
   * variant its own regions did nothing for the plain jungle, whose shared `open`, `dense` and `ruins` still
   * stated no blooms and so planted summer's near-white. A rainforest floor is not a daisy meadow.
   */
  it.each(['open', 'dense', 'ruins', 'swamp'])('the shared %s region states its own blooms', name => {
    expect(region('forest_jungle', name).flowers ?? []).not.toHaveLength(0)
  })

  it('every region of every jungle variant, with none left on the season', () => {
    for (const key of ['forest_jungle', 'forest_jungle_swamp', 'forest_jungle_island', 'forest_jungle_dense', 'forest_jungle_ruins']) {
      const bare = regions(key).filter(z => (z.flowers ?? []).length === 0).map(z => z.key)
      expect({ key, bare }).toEqual({ key, bare: [] })
    }
  })

  it('the SPECIES still differ per variant, so shared blooms did not flatten them', () => {
    // The blooms are shared; the trees are not. Island is palms, swamp is cypress, plain is the giant.
    expect(species('forest_jungle_island', 'open')).toContain('tree_palm')
    expect(species('forest_jungle_swamp', 'open')).toContain('tree_cypress')
    expect(species('forest_jungle', 'dense')).toContain('tree_giant')
  })
})
