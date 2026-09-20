/**
 * EACH FOREST GROWS ITS OWN SPECIES.
 *
 * Every forest rolled one global weighted table, so a jungle grew exactly what a meadow grew. The new shapes
 * are `tree_comp` with different proportions (backend), and each template serves its own mix. Built from the
 * REAL served catalog in the fixture, not numbers retyped here, so the test breaks if the data and the
 * generator ever stop agreeing.
 *
 * A row is picked by its KEY and runs the builder its own `layout` names. Nine wilderness environments share
 * three builders between them, so a builder cannot say which world this is.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { generateStage } from '@/engine/stageGenerator'
import { findGenerator, parseGeneratorCatalog } from '@/lib/generatorCatalog'
import { makeRng } from '@/lib/math'
import liveBody from '@/__tests__/fixtures/generators.json'

const CATALOG = parseGeneratorCatalog(liveBody)

/** Build a wilderness row exactly as the editor would, from its served config. */
function grow(key: string, seed = 7, withRegions = true) {
  const gen = findGenerator(CATALOG, 'wilderness', key)!
  const config = gen.config
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage({
      zone: 'summer', variant: 'forest', layout: gen.layout as never, cols: 60, rows: 40,
      nature: config.nature, palette: config.palette, formation: config.formation,
      subZones: withRegions ? config.subZones : undefined, treeMix: config.trees,
      // …and how much of what the map holds, which is what the framing and understory planters measure
      // themselves against. Without it a meadow plants no framing trees at all and this suite was counting
      // the species of a map with almost nothing on it.
      terrain: config.terrain, regionLayout: config.regionLayout,
    })
  } finally {
    Math.random = orig
  }
}

const kinds = (s: ReturnType<typeof grow>) => new Set(s.trees.map(t => t.kind))

describe('the new shapes come from the existing base, and each forest grows its own', () => {
  it('a woodland grows COLUMN trunks, the tall straight beech stand, and none of the tropical shapes', () => {
    const k = kinds(grow('forest_woodland'))
    expect(k.has('tree_column')).toBe(true)
    // The whole tropical set, which is what the title says. The gnarled tree is temperate and the woodland's
    // own edge and glade regions grow it, so listing it here described a wood nobody serves.
    for (const foreign of ['tree_palm', 'tree_cypress', 'tree_coconut', 'tree_banana', 'tree_mangrove', 'tree_giant']) {
      expect({ foreign, grown: k.has(foreign as never) }).toEqual({ foreign, grown: false })
    }
  })

  it('a meadow grows lone GNARLED trees, the wood pasture, and no forest columns', () => {
    const k = kinds(grow('forest_meadow'))
    expect(k.has('tree_gnarled')).toBe(true)
    expect(k.has('tree_column')).toBe(false)
    expect(k.has('tree_palm')).toBe(false)
  })

  it('a jungle grows PALMS and GIANTS, and nothing from the temperate wood', () => {
    const k = kinds(grow('forest_jungle'))
    expect(k.has('tree_giant')).toBe(true) // the emergents stand above the canopy as their own shape now
    expect(k.has('tree_palm')).toBe(true)
    expect(k.has('tree_gnarled')).toBe(false)
  })

  it('the jungle BAMBOO stand grows columns, so a region rolls its own species inside the row', () => {
    // Same seed, same jungle, regions on and off. The column exists ONLY because the bamboo stand states it:
    // the row's own mix carries none. It was the cypress and the `lakeside`, back when every biome was served
    // the same five regions and a rainforest had a lakeside in it.
    expect(kinds(grow('forest_jungle', 7, true)).has('tree_column')).toBe(true)
    expect(kinds(grow('forest_jungle', 7, false)).has('tree_column')).toBe(false)
  })

  it('no two forests share their dominant species', () => {
    const top = (s: ReturnType<typeof grow>) => {
      const counts = new Map<string, number>()
      for (const t of s.trees) if (t.kind !== 'tree_dead') counts.set(t.kind, (counts.get(t.kind) ?? 0) + 1)
      return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
    }
    const dominant = new Set([top(grow('forest_woodland')), top(grow('forest_meadow')), top(grow('forest_jungle'))])
    expect(dominant.size).toBe(3)
  })
})

describe('a template that serves no mix keeps the old shared table', () => {
  it('rolls none of the new-only shapes', () => {
    // The compliance rule both pathways: served data is honoured, missing data invents nothing.
    const orig = Math.random
    Math.random = makeRng(7)
    try {
      const s = generateStage({ zone: 'summer', variant: 'forest', layout: 'woodland', cols: 60, rows: 40, nature: { canopy: 0.45, groundCover: 0.2, flowers: 0.04 } })
      const k = new Set(s.trees.map(t => t.kind))
      for (const newOnly of ['tree_column', 'tree_gnarled', 'tree_palm', 'tree_cypress', 'tree_giant', 'tree_conifer']) {
        expect({ newOnly, grown: k.has(newOnly as never) }).toEqual({ newOnly, grown: false })
      }
    } finally {
      Math.random = orig
    }
  })
})

describe('the region you PICK leads the map', () => {
  // Ticking a region OUT is gone, so what there is to measure is EMPHASIS: the region you pick dominates, and
  // the others are still in there. The cypress is the jungle's lakeside tree and grows nowhere else in it,
  // which makes it the thing to count.
  it('a jungle led by its bamboo stand grows more columns than one led by its emergents', () => {
    const config = findGenerator(CATALOG, 'wilderness', 'forest_jungle')!.config
    const build = (options: Record<string, string>) => {
      const orig = Math.random
      Math.random = makeRng(7)
      try {
        return generateStage({ zone: 'summer', variant: 'forest', layout: 'jungle', cols: 60, rows: 40, nature: config.nature,
          palette: config.palette, formation: config.formation, subZones: config.subZones, terrain: config.terrain, regionLayout: config.regionLayout, treeMix: config.trees, options })
      } finally {
        Math.random = orig
      }
    }
    const columns = (options: Record<string, string>) => build(options).trees.filter(t => t.kind === 'tree_column').length

    // ASKED FOR, first: whether an unled map happens to roll a bamboo stand at one seed is the scatter's
    // business, and the thing being tested is what picking one does.
    expect(columns({ region: 'bamboo' })).toBeGreaterThan(0)
    expect(columns({ region: 'bamboo' })).toBeGreaterThan(columns({ region: 'emergent' }))

    // …and the map you asked for is made of THAT region and nothing else, which is the other half of the
    // promise and the reason the count above can go to zero: an emergent-led jungle has no bamboo in it.
    const only = (region: string) =>
      [...new Set((build({ region }).regions ?? []).flat().filter(Boolean))]

    expect(only('bamboo')).toEqual(['bamboo'])
    expect(only('emergent')).toEqual(['emergent'])
  })
})

/**
 * *"AND THERE'S NOT A SINGLE DIFFERENCE BETWEEN THE FOREST REGIONS, THEY'RE EXACTLY THE SAME"* (2026-09-15).
 *
 * The case above counts the CYPRESS, which only the jungle's lakeside grows, so it moves whenever a single
 * region-aware planter runs. It passed while the regions were making almost no difference to the map: measured
 * on a 40x40 woodland, 290 of 343 trees stand in the two-cell border treeline, and that planter rolled the
 * TEMPLATE's global mix wherever it stood. So asking for the thicket, whose served species are bushes and
 * saplings, and asking for the deep wood both produced the same five species in the same order, led by the
 * `tree_column` the template serves and the thicket does not grow at all.
 *
 * What the eye reads is the DOMINANT species, so that is what is asserted.
 */
describe('the region you pick decides what the wood is MADE of, not just its rare tree', () => {
  const woodland = findGenerator(CATALOG, 'wilderness', 'forest_woodland')!
  const regionOf = (key: string) => woodland.config.subZones!.find(z => z.key === key)!

  /** Every tree a woodland grows when the given region leads it, tallied over three seeds. Three, because a
   *  lead is a WEIGHT: on any one seed the ten region seeds can fall so that two leads partition the map
   *  identically, and that is the dice rather than the generator. */
  const grown = (region: string) => {
    const config = woodland.config
    const counts = new Map<string, number>()
    for (const seed of [4, 9, 17]) {
      const orig = Math.random
      Math.random = makeRng(seed)
      try {
        const stage = generateStage({
          zone: 'summer', variant: 'forest', layout: 'woodland', cols: 40, rows: 40,
          options: { exits: '2', pathways: '3', region },
          nature: config.nature, palette: config.palette, formation: config.formation, pathway: config.pathway,
          subZones: config.subZones, terrain: config.terrain, regionLayout: config.regionLayout, treeMix: config.trees,
        })
        for (const t of stage.trees) if (t.kind !== 'tree_dead') counts.set(t.kind, (counts.get(t.kind) ?? 0) + 1)
      } finally {
        Math.random = orig
      }
    }
    return counts
  }

  const share = (counts: Map<string, number>, kinds: readonly string[]) => {
    const total = [...counts.values()].reduce((a, b) => a + b, 0)
    return kinds.reduce((n, k) => n + (counts.get(k) ?? 0), 0) / total
  }

  // The woodland's EDGE and its GLADE are served the same three species, so no map can tell those two apart
  // by species and there is nothing here to assert about them. Every region with a set of its own is tested.
  const ownSpecies = (key: string) => regionOf(key).trees!.map(t => t.kind).join(',')
  const ALL = woodland.config.subZones!.map(z => z.key)
  const DISTINCT = ALL.filter(key => ALL.filter(other => ownSpecies(other) === ownSpecies(key)).length === 1)

  it.each(DISTINCT)('a woodland led by its %s grows more of that region\'s species than any other lead does', key => {
    const served = regionOf(key).trees!.map(t => t.kind)
    const mine = share(grown(key), served)
    expect([...grown(key).values()].reduce((a, b) => a + b, 0)).toBeGreaterThan(50) // a wood to measure at all
    // A comparison, not a tuned number: whichever region you ask for, its own species must come out ahead of
    // where they land when you ask for a different one. That is the whole of what picking a region means.
    for (const other of ALL) {
      if (ownSpecies(other) === ownSpecies(key)) continue
      expect({ key, other, leads: mine > share(grown(other), served) }).toEqual({ key, other, leads: true })
    }
  })

  it('the COPPICE is bushes and the HIGH FOREST is trunks, so two regions do not read alike', () => {
    const bushes = (region: string) => share(grown(region), ['bush', 'bush_round'])
    // A coppice is cut back to the stool, so it is saplings and bush; a high forest is columns, tall trunks
    // and standards. The two have to come apart by a margin you can see rather than a count you squint at.
    expect(bushes('coppice')).toBeGreaterThan(bushes('high_forest') * 1.5)
  })

  /**
   * THE BORDER TREELINE IS MOST OF THE WOOD, so it is most of what a region decides.
   *
   * Measured on a 40x40: 287 of a woodland's trees stand in the two-cell band and 53 anywhere else. It rolled
   * the template's global mix, so the species only the REGIONS serve were 2.8% of that band on a woodland and
   * 1.6% on a jungle. A wood whose regions could not be seen, because the thing filling it was not asking.
   */
  describe.each(['forest_woodland', 'forest_jungle'])('%s: the treeline grows what the region under it grows', key => {
    const gen = findGenerator(CATALOG, 'wilderness', key)!

    /** The species a REGION serves and the template does not, derived from the served catalog rather than
     *  retyped, so this breaks if the data changes rather than quietly measuring nothing. */
    const regionOnly = (() => {
      const template = new Set((gen.config.trees ?? []).map(t => t.kind))
      const only = new Set<string>()
      for (const zone of gen.config.subZones ?? []) {
        for (const t of zone.trees ?? []) if (!template.has(t.kind)) only.add(t.kind)
      }
      return only
    })()

    it.each([4, 9, 17])('seed %i', seed => {
      const config = gen.config
      const orig = Math.random
      Math.random = makeRng(seed)
      let stage
      try {
        stage = generateStage({
          zone: 'summer', variant: 'forest', layout: gen.layout as never, cols: 40, rows: 40,
          options: { exits: '2', pathways: '3' },
          nature: config.nature, palette: config.palette, formation: config.formation, pathway: config.pathway,
          subZones: config.subZones, terrain: config.terrain, regionLayout: config.regionLayout, treeMix: config.trees,
        })
      } finally {
        Math.random = orig
      }
      expect(regionOnly.size).toBeGreaterThan(0) // the row has regions that differ from it, or nothing is being tested
      const inBand = (t: { col: number; row: number }) =>
        Math.min(t.col, t.row, stage!.cols - 1 - t.col, stage!.rows - 1 - t.row) < 2
      const band = stage.trees.filter(inBand)
      const field = stage.trees.filter(t => !inBand(t))
      expect(band.length).toBeGreaterThan(50) // there IS a treeline
      const regional = (list: typeof band) => list.filter(t => regionOnly.has(t.kind)).length / list.length
      // THE FIELD IS THE YARDSTICK, not a number typed in here. The canopy has read the regions all along, so
      // whatever share of region-only species the field carries is what this map's regions are worth, and the
      // treeline has to be in the same country. It was at a twentieth of it: 0.028 against 0.466 on a
      // woodland, 0.016 against 0.310 on a jungle.
      expect(regional(field)).toBeGreaterThan(0) // the regions are live at all, or there is nothing to compare
      expect({ seed, treeline: regional(band) >= regional(field) * 0.5 }).toEqual({ seed, treeline: true })
    })
  })

  it('a template that serves regions with no species still grows its own mix', () => {
    // The fallback, which is the compliance half: a cell no region claims, or a region stating no species,
    // takes the template's mix exactly as it always did.
    const config = woodland.config
    const orig = Math.random
    Math.random = makeRng(4)
    try {
      const stage = generateStage({
        zone: 'summer', variant: 'forest', layout: 'woodland', cols: 40, rows: 40,
        nature: config.nature, palette: config.palette, treeMix: config.trees,
        // NO REGIONS is the subject here, and everything else the row serves still arrives: without the
        // formation there is no grouping to plant a stand with, and this measured the species of a wood
        // with no trees in it at all.
        formation: config.formation, terrain: config.terrain,
      })
      const kinds = new Set(stage.trees.map(t => t.kind))
      expect(kinds.has('tree_column')).toBe(true) // the template's own leading species, with no regions served
      expect(kinds.has('tree_gnarled')).toBe(false) // and none of the region-only ones
    } finally {
      Math.random = orig
    }
  })
})
