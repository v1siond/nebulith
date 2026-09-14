/**
 * The map-generator CATALOG client (`GET /api/generators`, T-113 / games-page UX §3.14b Tier-1 #1).
 *
 * The catalog is what replaces the frontend's hand-kept generator constants, so these tests are about
 * ONE promise: **what the editor offers is exactly what the backend serves, and nothing else.**
 *
 *   - the happy path runs against `fixtures/generators.json` — a VERBATIM capture of the live
 *     `/api/generators` body — so a seed change that breaks the client fails here rather than in the UI;
 *   - the negative paths prove the client never fills a gap in: a category the backend does not serve
 *     does not exist, a config section it omits reads `undefined`, and a malformed row is dropped, not
 *     defaulted (the no-fallback law, MAP-MODEL §8).
 */
import { EMPTY_GENERATOR_CATALOG, catalogZones, categoryLayouts, fetchGeneratorCatalog, findCategory, findGenerator, parseGeneratorCatalog, rollGridSize, findGeneratorByKey, findGeneratorForVariant} from '@/lib/generatorCatalog'
import { makeRng } from '@/lib/math'
import liveBody from '@/__tests__/fixtures/generators.json'

const LIVE = parseGeneratorCatalog(liveBody)

describe('parseGeneratorCatalog — the live /api/generators body', () => {
  it('reads every category the backend serves, in menu order', () => {
    expect(LIVE.map(c => c.key)).toEqual(['forest', 'settlement', 'cave', 'temple'])
    expect(LIVE.map(c => c.name)).toEqual(['Forest', 'Settlement', 'Cave', 'Temple'])
  })

  it('reads each category\'s generators, in menu order', () => {
    expect(findCategory(LIVE, 'forest')!.generators.map(g => g.key)).toEqual(['forest_woodland', 'forest_jungle', 'forest_meadow'])
    expect(findCategory(LIVE, 'settlement')!.generators.map(g => g.key)).toEqual(['town', 'city'])
  })

  it('reads the grid range the town rolls — the numbers templates.tsx used to hardcode', () => {
    expect(findGenerator(LIVE, 'settlement', 'town')!.config.grid).toEqual({
      cols: { min: 30, max: 45 }, rows: { min: 24, max: 35 }, cellSize: 16, isoScale: 2.5,
    })
  })

  it('reads the CITY\'s bigger grid — the `variant === city` branch is data now', () => {
    expect(findGenerator(LIVE, 'settlement', 'city')!.config.grid).toEqual({
      cols: { min: 52, max: 71 }, rows: { min: 42, max: 57 }, cellSize: 16, isoScale: 2.5,
    })
  })

  it('reads the townsfolk counts the editor scattered from a 14/8/5 ternary', () => {
    expect(findGenerator(LIVE, 'settlement', 'city')!.config.units!.townsfolk).toBe(14)
    expect(findGenerator(LIVE, 'settlement', 'town')!.config.units!.townsfolk).toBe(8)
    // The forest's FIRST row is the woodland now, and a wood scatters fewer people than an open meadow.
    expect(findGenerator(LIVE, 'forest')!.config.units!.townsfolk).toBe(3)
    expect(findGenerator(LIVE, 'forest', 'meadow')!.config.units!.townsfolk).toBe(5)
  })

  it('reads the dungeon enemy rosters — CAVE_ENEMY_TYPES / TEMPLE_ENEMY_TYPES as data', () => {
    expect(findGenerator(LIVE, 'cave')!.config.units).toEqual({ townsfolk: 0, enemies: 10, enemyTypes: ['bat', 'spider', 'skeleton'] })
    expect(findGenerator(LIVE, 'temple')!.config.units).toEqual({ townsfolk: 0, enemies: 10, enemyTypes: ['skeleton', 'guardian', 'wraith'] })
  })

  it('reads the building material + colour palette the page declared as five consts', () => {
    // A LOOK'S OWN PALETTE. Since 2026-09-11 the settlement presets ARE the looks, so this reads Traditional
    // town's: brick and timber under warm gables, and the roof TILE it lays, which is the half that colours
    // alone could never express ().
    expect(findGenerator(LIVE, 'settlement', 'town')!.config.buildings).toEqual({
      roof: 'roof',
      materials: ['wall_brick', 'wall_wood'],
      roofColors: ['#8a4b2f', '#7a4326', '#6b4a2b'],
      wallColors: ['#c9a66b', '#b08d5b', '#d8c79a'],
      storeRoof: '#235a96', hospitalRoof: '#2f7e50', fixedWall: '#f0f0ea',
    })
  })

  it("reads the settlement tuning that lives in villageLayout as consts, and the MIX that makes a place itself", () => {
    expect(findGenerator(LIVE, 'settlement', 'town')!.config.settlement).toEqual({
      plazaSize: 5, roadWidth: 4, setback: 1, lotGap: [1, 2], maxPerFrontage: 6,
      buildingCap: 18, houseRange: [4, 6],
      houseWidths: [3, 3, 4, 4, 4, 5, 6], natureMultiplier: 1.3,
      streets: 'path_stone',
      mix: [
        { type: 'store', count: [1, 1] },
        { type: 'hospital', count: [1, 1] },
        { type: 'temple', count: [1, 1] },
        { type: 'church', count: [1, 1] },
        { type: 'stable', count: [1, 2] },
        { type: 'barn', count: [1, 2] },
        { type: 'smithy', count: [1, 1] },
        // LAST, where the deleted big-house entry sat. Each entry costs one rng draw, so any other position
        // shifts every later draw and moves generated maps for nothing.
        { type: 'house', count: [1, 3] },
      ],
    })
    expect(findGenerator(LIVE, 'settlement', 'city')!.config.settlement).toMatchObject({
      plazaSize: 7, maxPerFrontage: 99, buildingCap: 72, natureMultiplier: 0.5,
    })
  })

  /**
   * The mix is the served answer,
   * so this asserts it SURVIVES the parse: a dropped key here would put every place back to the same buildings.
   */
  it('a town and a city are served DIFFERENT buildings, and the parse keeps them', () => {
    const town = findGenerator(LIVE, 'settlement', 'town')!.config.settlement!.mix!.map(e => e.type)
    const city = findGenerator(LIVE, 'settlement', 'city')!.config.settlement!.mix!.map(e => e.type)

    expect(town).toContain('stable')
    expect(town).not.toContain('tower')
    expect(city).toContain('tower')
    expect(city).toContain('apartment')
    expect(city).not.toContain('stable')
    expect(town).not.toEqual(city)
  })

  it('leaves a config section the backend omits UNDEFINED — a cave has no settlement or buildings', () => {
    const cave = findGenerator(LIVE, 'cave')!.config
    expect(cave.settlement).toBeUndefined()
    expect(cave.buildings).toBeUndefined()
    expect(cave.nature).toBeUndefined()
  })
})

describe('catalogZones — the season chips are the union of what generators run in', () => {
  it('lists every season the live catalog offers, once, in first-seen order', () => {
    expect(catalogZones(LIVE)).toEqual(['spring', 'summer', 'autumn', 'winter', 'desert'])
  })

  it('offers NO seasons for an empty catalog — never a stand-in list', () => {
    expect(catalogZones(EMPTY_GENERATOR_CATALOG)).toEqual([])
  })

  it('offers only the seasons actually served, even when generators disagree', () => {
    const catalog = parseGeneratorCatalog({
      data: [
        { key: 'a', name: 'A', position: 0, generators: [{ key: 'a1', name: 'A1', zones: ['spring', 'winter'], position: 0 }] },
        { key: 'b', name: 'B', position: 1, generators: [{ key: 'b1', name: 'B1', zones: ['winter', 'lava'], position: 0 }] },
      ],
    })
    expect(catalogZones(catalog)).toEqual(['spring', 'winter', 'lava'])
  })
})

describe('categoryLayouts — a map type\'s shapes are DATA, not a `key === forest` branch', () => {
  it('lists the forest\'s three KINDS of forest with their display names', () => {
    // Three, not five. A river is an OPTION on each of these now, so it is not a layout and never shows up
    // here — which is the whole of ticket 47: the list stopped growing when a variation stopped being a row.
    expect(categoryLayouts(LIVE, 'forest')).toEqual([
      { id: 'woodland', label: 'Woodland' },
      { id: 'jungle', label: 'Jungle' },
      { id: 'meadow', label: 'Meadow' },
    ])
  })

  it('lists NO layouts for a map type whose generator names no shape', () => {
    expect(categoryLayouts(LIVE, 'settlement')).toEqual([
      { id: 'town', label: 'Town' },
      { id: 'city', label: 'City' },
    ])
    expect(categoryLayouts(LIVE, 'cave')).toEqual([])
  })

  it('lists no layouts for a map type the backend does not serve', () => {
    expect(categoryLayouts(LIVE, 'atlantis')).toEqual([])
  })
})

describe('findGenerator — the editor runs exactly the world the user asked for', () => {
  it('picks the generator whose layout was chosen', () => {
    expect(findGenerator(LIVE, 'forest', 'jungle')!.key).toBe('forest_jungle')
    expect(findGenerator(LIVE, 'forest', 'meadow')!.key).toBe('forest_meadow')
  })

  it('picks the first generator when no layout is chosen', () => {
    expect(findGenerator(LIVE, 'forest')!.key).toBe('forest_woodland')
  })

  it('finds NOTHING for a layout the category does not carry — never a silent substitution', () => {
    expect(findGenerator(LIVE, 'forest', 'swamp')).toBeUndefined()
    expect(findGenerator(LIVE, 'town', 'meadow')).toBeUndefined()
  })

  it('finds nothing for a map type the backend does not serve', () => {
    expect(findGenerator(LIVE, 'atlantis')).toBeUndefined()
  })
})

describe('rollGridSize — the size comes from the served range', () => {
  const town = findGenerator(LIVE, 'settlement', 'town')
  const city = findGenerator(LIVE, 'settlement', 'city')

  it('rolls the range MINIMUM at rand 0 and the MAXIMUM just under 1', () => {
    expect(rollGridSize(town, () => 0)).toEqual({ cols: 30, rows: 24 })
    expect(rollGridSize(town, () => 0.999999)).toEqual({ cols: 45, rows: 35 })
    expect(rollGridSize(city, () => 0)).toEqual({ cols: 52, rows: 42 })
    expect(rollGridSize(city, () => 0.999999)).toEqual({ cols: 71, rows: 57 })
  })

  it('never leaves the served range across the whole rng domain', () => {
    for (const r of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99, 0.999999]) {
      const size = rollGridSize(city, () => r)!
      expect(size.cols).toBeGreaterThanOrEqual(52)
      expect(size.cols).toBeLessThanOrEqual(71)
      expect(size.rows).toBeGreaterThanOrEqual(42)
      expect(size.rows).toBeLessThanOrEqual(57)
    }
  })

  it('rolls cols and rows from SEPARATE draws (a single-draw bug would lock them together)', () => {
    const draws = [0, 0.999999]
    let i = 0
    expect(rollGridSize(town, () => draws[i++])).toEqual({ cols: 30, rows: 35 })
  })

  it('is reproducible under a seeded rng — the same seed rolls the same size', () => {
    const seeded = () => makeRng(4242)
    expect(rollGridSize(town, seeded())).toEqual(rollGridSize(town, seeded()))
    expect(rollGridSize(city, seeded())).toEqual(rollGridSize(city, seeded()))
  })

  it('yields NO size when the generator carries no grid — the caller keeps the grid it has', () => {
    const [noGrid] = parseGeneratorCatalog({
      data: [{ key: 'a', name: 'A', position: 0, generators: [{ key: 'a1', name: 'A1', position: 0, config: {} }] }],
    })
    expect(rollGridSize(noGrid.generators[0], () => 0.5)).toBeUndefined()
    expect(rollGridSize(undefined, () => 0.5)).toBeUndefined()
  })
})

describe('parseGeneratorCatalog — malformed rows are DROPPED, never defaulted', () => {
  let warn: jest.SpyInstance

  beforeEach(() => { warn = jest.spyOn(console, 'warn').mockImplementation(() => {}) })
  afterEach(() => { warn.mockRestore() })

  it('drops a category with no key, and says so', () => {
    const catalog = parseGeneratorCatalog({
      data: [{ name: 'Nameless', position: 0, generators: [] }, { key: 'ok', name: 'Ok', position: 1, generators: [] }],
    })
    expect(catalog.map(c => c.key)).toEqual(['ok'])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('dropped 1'))
  })

  it('drops a generator with no name but keeps its siblings', () => {
    const catalog = parseGeneratorCatalog({
      data: [{ key: 'c', name: 'C', position: 0, generators: [{ key: 'bad', position: 0 }, { key: 'good', name: 'Good', position: 1 }] }],
    })
    expect(catalog[0].generators.map(g => g.key)).toEqual(['good'])
  })

  it('drops an INCOMPLETE grid rather than half-reading it — a partial size is worse than none', () => {
    const catalog = parseGeneratorCatalog({
      data: [{ key: 'c', name: 'C', position: 0, generators: [{ key: 'g', name: 'G', position: 0, config: { grid: { cols: { min: 10, max: 20 } } } }] }],
    })
    expect(catalog[0].generators[0].config.grid).toBeUndefined()
  })

  it('drops a settlement block missing a knob rather than substituting one', () => {
    const catalog = parseGeneratorCatalog({
      data: [{ key: 'c', name: 'C', position: 0, generators: [{ key: 'g', name: 'G', position: 0, config: { settlement: { plazaSize: 5 } } }] }],
    })
    expect(catalog[0].generators[0].config.settlement).toBeUndefined()
  })

  it('keeps the sections it CAN read when a sibling section is broken', () => {
    const catalog = parseGeneratorCatalog({
      data: [{
        key: 'c', name: 'C', position: 0,
        generators: [{ key: 'g', name: 'G', position: 0, config: { grid: { cols: { min: 1, max: 2 }, rows: { min: 3, max: 4 }, cellSize: 16, isoScale: 2.5 }, settlement: 'nonsense' } }],
      }],
    })
    expect(catalog[0].generators[0].config.grid).toEqual({ cols: { min: 1, max: 2 }, rows: { min: 3, max: 4 }, cellSize: 16, isoScale: 2.5 })
    expect(catalog[0].generators[0].config.settlement).toBeUndefined()
  })

  it('reads a body with no data key as an EMPTY catalog', () => {
    expect(parseGeneratorCatalog({})).toEqual([])
    expect(parseGeneratorCatalog(null)).toEqual([])
    expect(parseGeneratorCatalog('nope')).toEqual([])
  })

  it('sorts categories and generators by position regardless of wire order', () => {
    const catalog = parseGeneratorCatalog({
      data: [
        { key: 'b', name: 'B', position: 5, generators: [{ key: 'b2', name: 'B2', position: 9 }, { key: 'b1', name: 'B1', position: 1 }] },
        { key: 'a', name: 'A', position: 1, generators: [] },
      ],
    })
    expect(catalog.map(c => c.key)).toEqual(['a', 'b'])
    expect(catalog[1].generators.map(g => g.key)).toEqual(['b1', 'b2'])
  })
})

describe('fetchGeneratorCatalog — the wire', () => {
  const origFetch = global.fetch
  afterEach(() => { global.fetch = origFetch; jest.restoreAllMocks() })

  it('GETs /generators and parses the body', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => liveBody })
    global.fetch = fetchMock as unknown as typeof fetch

    const catalog = await fetchGeneratorCatalog()
    expect(catalog.map(c => c.key)).toEqual(['forest', 'settlement', 'cave', 'temple'])
    expect(fetchMock.mock.calls[0][0]).toContain('/generators')
  })

  it('throws a NAMED error on a non-ok response — the editor must show the failure, not a fake menu', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, statusText: 'Service Unavailable' }) as unknown as typeof fetch
    await expect(fetchGeneratorCatalog()).rejects.toThrow(/Failed to load the generator catalog/)
  })
})

describe('the catalog is a TREE — forest > type > subtype', () => {
  it('parses each type\'s subtypes, in menu order', () => {
    expect(findGenerator(LIVE, 'forest', 'woodland')!.children?.map(c => c.key)).toEqual([
      'forest_woodland_beech', 'forest_woodland_dense', 'forest_woodland_mountain', 'forest_woodland_glades',
    ])
  })

  it('finds a subtype by key at any depth, and nothing for a key that is not there', () => {
    expect(findGeneratorByKey(LIVE, 'forest_jungle_island')?.name).toBe('Island jungle')
    expect(findGeneratorByKey(LIVE, 'forest_woodland')?.name).toBe('Woodland')
    expect(findGeneratorByKey(LIVE, 'no_such_thing')).toBeUndefined()
  })

  it('a subtype arrives with its parent\'s config merged under its own, ready to run', () => {
    const woodland = findGenerator(LIVE, 'forest', 'woodland')!
    const mountain = findGeneratorByKey(LIVE, 'forest_woodland_mountain')!
    expect(mountain.config.nature?.canopy).toBe(0.28)
    expect(mountain.config.nature?.groundCover).toBe(woodland.config.nature?.groundCover)
    expect(mountain.config.grid).toEqual(woodland.config.grid)
  })
})

describe('a generator is found by the ARCHETYPE it runs, not by where it sits', () => {
  // A
  // programmatic generate still asks for "town", and a town lives in the settlement category now.
  const MERGED = parseGeneratorCatalog({
    data: [{
      key: 'settlement', name: 'Settlement', position: 1, generators: [
        { key: 'town_default', name: 'Town', layout: 'town', variant: 'town', position: 0, config: {} },
        { key: 'city_default', name: 'City', layout: 'city', variant: 'city', position: 1, config: {} },
      ],
    }],
  })

  it('finds the town in a category that is not called town', () => {
    expect(findGeneratorForVariant(MERGED, 'town')?.key).toBe('town_default')
    expect(findGeneratorForVariant(MERGED, 'city')?.key).toBe('city_default')
  })

  it('narrows by shape when the archetype has shapes', () => {
    expect(findGeneratorForVariant(MERGED, 'town', 'town')?.key).toBe('town_default')
    // a shape the archetype does not carry falls back to the archetype's own row rather than to nothing
    expect(findGeneratorForVariant(MERGED, 'town', 'nonsense')?.key).toBe('town_default')
  })

  it('an archetype nobody serves resolves to nothing', () => {
    expect(findGeneratorForVariant(MERGED, 'temple')).toBeUndefined()
  })

  it('a catalog served before variants existed keeps the old category lookup', () => {
    const OLD = parseGeneratorCatalog({
      data: [{ key: 'town', name: 'Town', position: 1, generators: [{ key: 'town_default', name: 'Town', position: 0, config: {} }] }],
    })
    expect(findGeneratorForVariant(OLD, 'town')?.key).toBe('town_default')
  })
})
