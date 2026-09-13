/**
 * A REGION BELONGS TO ITS PLACE.
 *
 * Alexander, 2026-09-12: *"the swamps still look fucking terrible because they have nature and flowers that
 * don't match the swamp context"*, and *"same with island forest, which is better, but still not good enough,
 * needs to be more closely related to beaches nature"*.
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
    // #f4f4ec is summer's daisy, the exact colour he objected to.
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

  it('the PALM leads every region, and the rainforest giant is nowhere in it', () => {
    for (const name of ['open', 'dense']) {
      expect({ name, palm: species('forest_jungle_island', name).includes('tree_palm') }).toEqual({ name, palm: true })
      expect({ name, giant: species('forest_jungle_island', name).includes('tree_giant') }).toEqual({ name, giant: false })
    }
  })
})

describe('the variants that said nothing are untouched', () => {
  it('a plain jungle keeps the shared regions exactly as they were', () => {
    // The override is per variant. If this ever gains blooms, the shared list was edited by mistake and every
    // jungle changed with it.
    expect(region('forest_jungle', 'open').flowers).toBeUndefined()
    expect(region('forest_jungle', 'dense').flowers).toBeUndefined()
    expect(species('forest_jungle', 'open')).toContain('tree_palm')
    expect(species('forest_jungle', 'dense')).toContain('tree_giant')
  })

  it('the plain jungle STILL carries the swamp region it always had', () => {
    expect(region('forest_jungle', 'swamp').flowers ?? []).not.toHaveLength(0)
  })
})
