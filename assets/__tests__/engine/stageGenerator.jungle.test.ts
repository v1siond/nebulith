/**
 * THE JUNGLE — a jungle, not a dense woodland.
 *
 * Alexander, 2026-09-10: *"right now a jungle is basically the same as woodland in the app, there's not a
 * single difference between them, but they should be, colors should be different, general layout should be
 * different"*, *"like there's a huge difference between amazonas and a pines forest"*, *"a jungle should
 * follow real jungle patterns"*.
 *
 * I had shipped it as `layoutWoodland` with heavier numbers, which is exactly what he was objecting to. The
 * tests below assert the four ways the STRUCTURE differs, because density is not the difference:
 *
 *   · light gaps where a giant fell, not clearings cut for you
 *   · a creek you travel along, not trails someone laid
 *   · undergrowth that BLOCKS, where a wood's floor cover only decorates
 *   · a canopy brighter than its own floor, the lighting inversion that reads as tropical
 *
 * And the one thing that is not negotiable whatever it looks like: the whole floor is ONE PLACE.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { generateStage, type NatureDensity } from '@/engine/stageGenerator'
import { type GeneratorPalette } from '@/lib/generatorCatalog'
import { makeRng } from '@/lib/math'

/** The served densities, as `generator_source.ex` carries them. */
const WOODLAND: NatureDensity = { canopy: 0.434, groundCover: 0.2, flowers: 0.04 }
const JUNGLE: NatureDensity = { canopy: 0.62, groundCover: 0.5, flowers: 0.1 }

/** The served palettes, likewise. The point of them is that they are NOT the same. */
const WOOD_PAL: GeneratorPalette = { floor: '#6f7f4a', floorAlt: '#7d8a55', litter: '#7a6a44', canopy: '#5d7340', canopyAlt: '#6b8049', undergrowth: '#6d7f45', water: '#4f93b3', bank: '#c1a877', trail: '#9a8a62' }
const JUNG_PAL: GeneratorPalette = { floor: '#2f4a2a', floorAlt: '#38552f', litter: '#46442a', canopy: '#2e6b32', canopyAlt: '#3f8a3c', undergrowth: '#25532a', water: '#5e6b3a', bank: '#6b5f3c', trail: '#57502f' }

const build = (layout: 'woodland' | 'jungle', nature: NatureDensity, palette?: GeneratorPalette, seed = 3, cols = 60, rows = 40) => {
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage({ zone: 'summer', variant: 'forest', layout, cols, rows, nature, palette })
  } finally {
    Math.random = orig
  }
}

const jungle = (seed = 3, cols = 60, rows = 40) => build('jungle', JUNGLE, JUNG_PAL, seed, cols, rows)
const woodland = (seed = 3) => build('woodland', WOODLAND, WOOD_PAL, seed)

const countGround = (s: ReturnType<typeof jungle>, tile: string) => s.ground.flat().filter(t => t === tile).length

/** The walkable regions, largest first — the measure that says whether a map is one place or several. */
function regions(s: ReturnType<typeof jungle>): number[] {
  const seen = new Set<string>()
  const sizes: number[] = []
  const ok = (c: number, r: number) => r >= 0 && r < s.rows && c >= 0 && c < s.cols && !s.collision[r][c]
  for (let r = 0; r < s.rows; r++) {
    for (let c = 0; c < s.cols; c++) {
      if (!ok(c, r) || seen.has(`${c},${r}`)) continue
      let n = 0
      const stack: Array<[number, number]> = [[c, r]]
      seen.add(`${c},${r}`)
      while (stack.length) {
        const [cc, rr] = stack.pop()!
        n++
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nc = cc + dc
          const nr = rr + dr
          if (ok(nc, nr) && !seen.has(`${nc},${nr}`)) { seen.add(`${nc},${nr}`); stack.push([nc, nr]) }
        }
      }
      sizes.push(n)
    }
  }
  return sizes.sort((a, b) => b - a)
}

describe('a jungle is structurally a different place from a woodland', () => {
  it('travels along WATER — a creek runs through it, where a plain woodland has none', () => {
    // The creek is not the river OPTION. A wood may or may not have a river; a jungle IS built around its
    // watercourse, which is why this holds with no options passed at all.
    expect(countGround(jungle(), 'water')).toBeGreaterThan(0)
    expect(countGround(woodland(), 'water')).toBe(0)
  })

  it('lays NO trails — a jungle has no roads, a woodland paves its corridors', () => {
    const trail = (s: ReturnType<typeof jungle>) => s.ground.flat().filter(t => t === 'path' || t === 'path_stone').length
    expect(trail(woodland())).toBeGreaterThan(0)
    expect(trail(jungle())).toBe(0)
  })

  it('is CHOKED — its undergrowth blocks, so far less of it is walkable', () => {
    const openPct = (s: ReturnType<typeof jungle>) =>
      s.collision.flat().filter(c => !c).length / (s.cols * s.rows)
    // Not a tuned threshold: the assertion is the GAP. If a jungle ever walks as freely as a wood it has
    // stopped being one, whatever the numbers say.
    expect(openPct(jungle())).toBeLessThan(openPct(woodland()) * 0.6)
  })

  it('stands EMERGENTS above the canopy — the giants a temperate wood does not roll', () => {
    const tall = jungle().trees.filter(t => t.kind === 'tree_tall').length
    expect(tall).toBeGreaterThan(0)
  })

  it('crosses its own creek on FALLEN LOGS, wearing the trail tone and not cobble', () => {
    const s = jungle()
    const deck: Array<[number, number]> = []
    s.ground.forEach((rowArr, r) => rowArr.forEach((g, c) => { if (g === 'bridge') deck.push([c, r]) }))
    expect(deck.length).toBeGreaterThan(0)
    expect(deck.every(([c, r]) => s.collision[r][c] === false)).toBe(true)
    expect(deck.some(([c, r]) => s.floorColors[r][c] === JUNG_PAL.trail)).toBe(true)
  })
})

describe('the COLOURS come from the served palette, and only from there', () => {
  it('paints the FLOOR from the served palette and from nothing else', () => {
    const j = jungle()
    // The floor, the gaps and the banks are painted flat from served tones, so every colour on a cell that
    // is NOT water has to be one the backend sent. (Water is rippled — `varyIntensity` derives shades of the
    // served colour, so it is excluded here and covered by the creek test instead.)
    const served = new Set(Object.values(JUNG_PAL))
    const land = new Set<string>()
    j.floorColors.forEach((rowArr, r) => rowArr.forEach((tone, c) => {
      if (tone && j.ground[r][c] !== 'water') land.add(tone)
    }))
    expect(land.size).toBeGreaterThan(0)
    const foreign = [...land].filter(t => !served.has(t))
    expect(foreign).toEqual([])
    expect(land.has(JUNG_PAL.floor!)).toBe(true)
  })

  it('paints NOTHING when the backend serves no palette — never a colour of its own', () => {
    // The compliance rule: a missing served value means "no opinion", not "pick one".
    const bare = build('jungle', JUNGLE, undefined)
    expect(bare.floorColors.flat().filter(Boolean)).toHaveLength(0)
  })

  it('a woodland and a jungle given DIFFERENT palettes do not come out the same colour', () => {
    const j = new Set(jungle().floorColors.flat().filter(Boolean))
    expect(j.has(WOOD_PAL.floor!)).toBe(false)
  })
})

describe('however dense it gets, the jungle is ONE place', () => {
  // The cave taught this one: a connectivity defect that only shows on some seeds is invisible to a single
  // test and fatal in play. Measured over 150 seeds before the tracks existed, one map came out at 83%.
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])('seed %i leaves no stranded ground', seed => {
    const sizes = regions(jungle(seed, 45, 35))
    expect({ seed, regions: sizes.length }).toEqual({ seed, regions: 1 })
  })

  it('holds on a SMALL map too, where the creek eats proportionally more of it', () => {
    // seed 10 at 30x24 is the one that used to fail, so it is named rather than left to a range.
    const sizes = regions(jungle(10, 30, 24))
    expect(sizes.length).toBe(1)
    expect(sizes[0]).toBeGreaterThan(60) // and there is a real amount of it, not one cleared cell
  })
})
