/**
 * EACH FOREST GROWS ITS OWN SPECIES.
 *
 * Alexander, 2026-09-11: *"we need to have more variance of trees, like we're using the same for all forest
 * variations, but that's not good, existing trees serves as a great starting point, let's use that base to
 * generate more variants"*.
 *
 * Every forest rolled one global weighted table, so a jungle grew exactly what a meadow grew. The new shapes
 * are `tree_comp` with different proportions (backend), and each template serves its own mix. Built from the
 * REAL served catalog in the fixture, not numbers retyped here, so the test breaks if the data and the
 * generator ever stop agreeing.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { generateStage } from '@/engine/stageGenerator'
import { findGenerator, parseGeneratorCatalog } from '@/lib/generatorCatalog'
import { makeRng } from '@/lib/math'
import liveBody from '@/__tests__/fixtures/generators.json'

const CATALOG = parseGeneratorCatalog(liveBody)

/** Build a forest exactly as the editor would, from its served config. */
function grow(layout: 'woodland' | 'jungle' | 'meadow', seed = 7, withRegions = true) {
  const config = findGenerator(CATALOG, 'forest', layout)!.config
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage({
      zone: 'summer', variant: 'forest', layout, cols: 60, rows: 40,
      nature: config.nature, palette: config.palette, formation: config.formation,
      subZones: withRegions ? config.subZones : undefined, treeMix: config.trees,
    })
  } finally {
    Math.random = orig
  }
}

const kinds = (s: ReturnType<typeof grow>) => new Set(s.trees.map(t => t.kind))

describe('the new shapes come from the existing base, and each forest grows its own', () => {
  it('a woodland grows COLUMN trunks — the tall straight beech stand — and none of the tropical shapes', () => {
    const k = kinds(grow('woodland'))
    expect(k.has('tree_column')).toBe(true)
    for (const foreign of ['tree_palm', 'tree_cypress', 'tree_gnarled']) expect({ foreign, grown: k.has(foreign as never) }).toEqual({ foreign, grown: false })
  })

  it('a meadow grows lone GNARLED trees — the wood pasture — and no forest columns', () => {
    const k = kinds(grow('meadow'))
    expect(k.has('tree_gnarled')).toBe(true)
    expect(k.has('tree_column')).toBe(false)
    expect(k.has('tree_palm')).toBe(false)
  })

  it('a jungle grows PALMS and GIANTS, and nothing from the temperate wood', () => {
    const k = kinds(grow('jungle'))
    expect(k.has('tree_giant')).toBe(true) // the emergents stand above the canopy as their own shape now
    expect(k.has('tree_palm')).toBe(true)
    expect(k.has('tree_column')).toBe(false)
    expect(k.has('tree_gnarled')).toBe(false)
  })

  it('the jungle SWAMP grows cypress — a region rolls its own species inside the jungle', () => {
    // Same seed, same jungle, regions on and off. The cypress exists ONLY because the swamp region states it.
    expect(kinds(grow('jungle', 7, true)).has('tree_cypress')).toBe(true)
    expect(kinds(grow('jungle', 7, false)).has('tree_cypress')).toBe(false)
  })

  it('no two forests share their dominant species', () => {
    const top = (s: ReturnType<typeof grow>) => {
      const counts = new Map<string, number>()
      for (const t of s.trees) if (t.kind !== 'tree_dead') counts.set(t.kind, (counts.get(t.kind) ?? 0) + 1)
      return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
    }
    const dominant = new Set([top(grow('woodland')), top(grow('meadow')), top(grow('jungle'))])
    expect(dominant.size).toBe(3)
  })
})

describe('a template that serves no mix keeps the old shared table', () => {
  it('rolls none of the new-only shapes', () => {
    // The compliance rule both ways: served data is honoured, missing data invents nothing.
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
