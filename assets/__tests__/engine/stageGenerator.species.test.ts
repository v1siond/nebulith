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
    expect(k.has('tree_column')).toBe(false)
    expect(k.has('tree_gnarled')).toBe(false)
  })

  it('the jungle LAKESIDE grows cypress, so a region rolls its own species inside the row', () => {
    // Same seed, same jungle, regions on and off. The cypress exists ONLY because the lakeside states it: the
    // row's own mix carries none.
    expect(kinds(grow('forest_jungle', 7, true)).has('tree_cypress')).toBe(true)
    expect(kinds(grow('forest_jungle', 7, false)).has('tree_cypress')).toBe(false)
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
  it('a jungle led by its lakeside grows more cypress than one led by its glade', () => {
    const config = findGenerator(CATALOG, 'wilderness', 'forest_jungle')!.config
    const build = (options: Record<string, string>) => {
      const orig = Math.random
      Math.random = makeRng(7)
      try {
        return generateStage({ zone: 'summer', variant: 'forest', layout: 'jungle', cols: 60, rows: 40, nature: config.nature,
          palette: config.palette, formation: config.formation, subZones: config.subZones, treeMix: config.trees, options })
      } finally {
        Math.random = orig
      }
    }
    const cypress = (options: Record<string, string>) => build(options).trees.filter(t => t.kind === 'tree_cypress').length

    expect(cypress({})).toBeGreaterThan(0) // the served weights already carry a lakeside
    expect(cypress({ region: 'lakeside' })).toBeGreaterThan(cypress({ region: 'glade' }))
    // and the lakeside is still THERE when another region leads: a lead is a weight, not an exclusion
    expect(cypress({ region: 'glade' })).toBeGreaterThan(0)
  })
})
