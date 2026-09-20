/**
 * THE JUNGLE, a jungle, not a dense woodland.
 *
 * I had shipped it as `layoutWoodland` with heavier numbers, which is exactly what was rejected. The
 * tests below assert the four pathways the STRUCTURE differs, because density is not the difference:
 *
 *   · light gaps where a giant fell, not clearings cut for you
 *   · a creek you travel along, not trails someone laid
 *   · undergrowth that BLOCKS, where a wood's floor cover only decorates
 *   · a canopy brighter than its own floor, the lighting inversion that reads as tropical
 *
 * And the one thing that is not negotiable whatever it looks like: the whole floor is ONE PLACE.
 */
import { isWaterGround } from '@/engine/riverNetwork'
import '@/__tests__/helpers/installTilesetSeed'
import { FLAT_FLOOR, generateStage, RUIN_MIN_SITE, type NatureDensity } from '@/engine/stageGenerator'
import { groundTileColor } from '@/engine/tileset/groundColor'
import { zonePalette } from '@/engine/zones'
import { type GeneratorPalette, type GeneratorSubZone } from '@/lib/generatorCatalog'
import { makeRng } from '@/lib/math'
import { servedWild } from '@/__tests__/helpers/servedGenerator'

/** The served densities, as `generator_source.ex` carries them. */
const WOODLAND: NatureDensity = { canopy: 0.434, groundCover: 0.2, flowers: 0.04 }
const JUNGLE: NatureDensity = { canopy: 0.62, groundCover: 0.5, flowers: 0.1 }

/** The served palettes, likewise. The point of them is that they are NOT the same. */
const WOOD_PAL: GeneratorPalette = { floor: '#6f7f4a', floorAlt: '#7d8a55', litter: '#7a6a44', canopy: '#5d7340', canopyAlt: '#6b8049', undergrowth: '#6d7f45', water: '#4f93b3', bank: '#c1a877', trail: '#9a8a62' }
const JUNG_PAL: GeneratorPalette = { floor: '#2f4a2a', floorAlt: '#38552f', litter: '#46442a', canopy: '#2e6b32', canopyAlt: '#3f8a3c', undergrowth: '#25532a', water: '#5e6b3a', bank: '#6b5f3c', trail: '#57502f' }

/** The served sub-zones, as `generator_source.ex` carries them. Regions inside ONE map, *  2026-09-11, choosing between that and separate templates. */
const ZONES: readonly GeneratorSubZone[] = [
  { key: 'open', weight: 3, canopy: 0.45, undergrowth: 0.5, floor: '#3f5f33' },
  { key: 'dense', weight: 4, canopy: 1.3, undergrowth: 1.45, floor: '#24381f' },
  { key: 'swamp', weight: 2, canopy: 0.85, undergrowth: 1.1, floor: '#3b4a2e', pools: 0.22 },
  { key: 'ruins', weight: 2, canopy: 0.55, undergrowth: 0.65, floor: '#4a4a3c', stone: 0.16 },
]

const build = (layout: 'woodland' | 'jungle', nature: NatureDensity, palette?: GeneratorPalette, seed = 3, cols = 60, rows = 40, subZones?: readonly GeneratorSubZone[]) => {
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    // Spread the served row FIRST, then only what this case is actually testing: a key written explicitly
    // with an `undefined` value REPLACES the served one, which is how passing no palette quietly stripped
    // the template's colours back off again.
    return generateStage({
      ...servedWild(layout),
      zone: 'summer', variant: 'forest', layout, cols, rows, nature,
      ...(palette ? { palette } : {}),
      ...(subZones ? { subZones } : {}),
    })
  } finally {
    Math.random = orig
  }
}

const zoned = (seed = 5, cols = 60, rows = 40) => build('jungle', JUNGLE, JUNG_PAL, seed, cols, rows, ZONES)

const jungle = (seed = 3, cols = 60, rows = 40) => build('jungle', JUNGLE, JUNG_PAL, seed, cols, rows)
const woodland = (seed = 3) => build('woodland', WOODLAND, WOOD_PAL, seed)

const countGround = (s: ReturnType<typeof jungle>, tile: string) => s.ground.flat().filter(t => t === tile).length
// WATER IS A FAMILY now, not one label: a creek's cells wear their autotile piece (`water_smooth_c`,
// `water_smooth_tl`, ...). Counting the exact string 'water' answers zero on every map, which would have
// made the woodland half of this pair pass for the wrong reason.
const countWater = (s: ReturnType<typeof jungle>) => s.ground.flat().filter(isWaterGround).length

/** The walkable regions, largest first, the measure that says whether a map is one place or several. */
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
  it('travels along WATER, a creek runs through it, where a plain woodland has none', () => {
    // The creek is not the river OPTION. A wood may or may not have a river; a jungle IS built around its
    // watercourse, which is why this holds with no options passed at all.
    //
    // A WOOD HAS WATER TOO NOW, and the difference is its KIND. Its `streamside` region states `pools`, so a
    // woodland carries STANDING water where that region falls, and asking for "no water at all" would now be
    // asking a wood to stop having the one region named for it. A creek is water that RUNS: cells the
    // generator did not file as standing.
    const channel = (s: ReturnType<typeof jungle>) =>
      s.ground.flatMap((row, r) => row.map((g, c) => (isWaterGround(g) && !s.standing?.has(`${c},${r}`) ? 1 : 0) as number)).reduce((a: number, b: number) => a + b, 0)

    expect(channel(jungle())).toBeGreaterThan(0)
    expect(channel(woodland())).toBe(0)
  })

  it('lays NO trails, a jungle has no roads, a woodland paves its corridors', () => {
    // A DEGENERATE ORACLE LIVED HERE, and it is why the map came out as a woodland with no visible paths.
    //
    // It counted cells whose colour equalled `groundTileColor(zonePalette(zone).trail)`, and that call falls
    // back to the season's GROUND colour when it cannot resolve the label. So both sides of the comparison
    // were the grass colour and this counted GRASS, reporting hundreds of trails on a map that had none you
    // could see. The test passed for years while the feature did not exist.
    //
    // A trail is now found the way an eye finds one: flat floor wearing the SERVED trail colour, which is a
    // different colour from the field around it. If the two are ever equal again there is no path, and this
    // says so instead of counting the field.
    const trail = (s: ReturnType<typeof jungle>) => {
      // The template's served trail colour, else the trail TILE's own: the SAME precedence the generator
      // uses. `s.palette` is not echoed back on the stage, so the served value is read from the config the
      // stage was grown from, exactly like the generator read it.
      // The SAME precedence the generator uses (`wayTone`): the served pathway's own tone first, the
      // template's trail colour next. This read only the second, so the day a template served a pathway the
      // way was painted in a tone this test was not looking for and it measured zero paths on a paved map.
      const paint = servedWild('woodland').pathway?.tone ?? WOOD_PAL.trail ?? groundTileColor(zonePalette(s.zone)?.trail ?? '', 0, 0)
      if (!paint) return 0
      let n = 0
      // THE COLOUR, WHATEVER TILE IT IS ON. This also required the ground to be the flat floor, which held
      // only while a way SWAPPED the tile under it for a trail tile and the flatten swapped it back. A way
      // is a colour on the ground block it crosses, so the tile under it is the field's own.
      s.floorColors.forEach(row => row.forEach(tone => { if (tone === paint) n++ }))
      return n
    }
    expect(trail(woodland())).toBeGreaterThan(0)
    expect(trail(jungle())).toBe(0)
  })

  it('is CHOKED, its undergrowth blocks, so far less of it is walkable', () => {
    const openPct = (s: ReturnType<typeof jungle>) =>
      s.collision.flat().filter(c => !c).length / (s.cols * s.rows)

    // Not a tuned threshold: the assertion is the GAP. If a jungle ever walks as freely as a wood it has
    // stopped being one, whatever the numbers say.
    expect(openPct(jungle())).toBeLessThan(openPct(woodland()))

    // CHOKED MEANS THICK, NOT SEALED, and that is a decision rather than a measurement drifting.
    // *"the density of trees is conflicting with the functionality of the map, user can't move, we can't put
    // any treasures nor units around"*, so every ground plant became something you walk THROUGH
    // (`ensure_ground_plants/0` writes `occupies: false` on all nineteen of them, the thicket included).
    // A jungle is told from a wood by how much stands between the trunks, and `aJungleYouCanWalkAcross`
    // owns the other half, that you can still cross it and put things down.
    const plants = (s: ReturnType<typeof jungle>) => s.props.filter(p => p.label === 'thicket').length
    expect(plants(jungle())).toBeGreaterThan(plants(woodland()) * 2)

    // …and it is thick WHERE THE MAP SAYS IT IS. Five regions exist so a rainforest is not one texture: the
    // floor under the emergents is dark and open, the `understory` is the wall of bush.
    const s = jungle()
    const perRegion = (key: string) => {
      let cells = 0, grown = 0
      const plantAt = new Set(s.props.filter(p => p.label === 'thicket').map(p => `${p.col},${p.row}`))
      s.regions?.forEach((row, r) => row.forEach((k, c) => {
        if (k !== key) return
        cells++
        if (plantAt.has(`${c},${r}`)) grown++
      }))
      return cells === 0 ? undefined : grown / cells
    }
    const wall = perRegion('understory')
    const open = perRegion('emergent')
    expect(wall).toBeDefined()
    expect(open).toBeDefined()
    expect(wall!).toBeGreaterThan(open!)
  })

  it('stands EMERGENTS above the canopy, the giants a temperate wood does not roll', () => {
    const giants = jungle().trees.filter(t => t.kind === 'tree_giant' || t.kind === 'tree_tall').length
    expect(giants).toBeGreaterThan(0)
  })

  it('crosses its own creek by WADING it, and builds nothing to do it', () => {
    // THIS USED TO ASSERT PLANKING, and planking is what was removed. A jungle creek is crossed at a FORD: a
    // stretch of river shallow enough to walk through, level with its banks, laying no structure at all. The
    // property is the same one either way, you can get over the creek, so the test keeps it and drops the
    // implementation it happened to be written against.
    const s = jungle()
    const ford = [...(s.fords ?? [])].map(k => k.split(',').map(Number) as [number, number])
    expect(ford.length).toBeGreaterThan(0)
    // Wadeable: nothing stops you, and it is flush with the bank rather than a block down in the cut.
    expect(ford.every(([c, r]) => s.collision[r][c] === false)).toBe(true)
    expect(ford.every(([c, r]) => (s.elevation?.[r]?.[c] ?? 0) === 0)).toBe(true)
    // And it is still the RIVER, not a path laid over it: the water keeps its own ground and its own colour.
    expect(ford.every(([c, r]) => s.ground[r][c].includes('water'))).toBe(true)
    expect(ford.some(([c, r]) => s.floorColors[r][c] === JUNG_PAL.trail)).toBe(false)
    // Nothing anywhere on the map is decked, because the jungle's only crossing is the ford.
    const planking = s.ground.flat().filter(g => g === 'bridge').length
    expect(planking).toBe(0)
  })
})

describe('the COLOURS come from the served palette, and only from there', () => {
  it('paints the FLOOR from the served palette and from nothing else', () => {
    const j = jungle()
    // The floor, the gaps and the banks are painted flat from served tones, so every colour on a cell that
    // is NOT water has to be one the backend sent. (Water is rippled, `varyIntensity` derives shades of the
    // served colour, so it is excluded here and covered by the creek test instead.)
    const served = new Set(Object.values(JUNG_PAL))
    const land = new Set<string>()
    j.floorColors.forEach((rowArr, r) => rowArr.forEach((tone, c) => {
      if (tone && !['water', 'water_shallow', 'water_deep'].includes(j.ground[r][c])) land.add(tone)
    }))
    expect(land.size).toBeGreaterThan(0)
    const foreign = [...land].filter(t => !served.has(t))
    expect(foreign).toEqual([])
    expect(land.has(JUNG_PAL.floor!)).toBe(true)
  })

  it('paints NOTHING when the backend serves no palette, never a colour of its own', () => {
    // The compliance rule: a missing served value means "no opinion", not "pick one".
    // BUILT WITH NOTHING SERVED, which is what the rule is about. Every other case here spreads the row the
    // backend actually serves, and this one must not: a palette that arrives through the served config is
    // still a served palette, and the question is what happens when none arrives at all.
    const orig = Math.random
    Math.random = makeRng(3)
    let bare
    try {
      bare = generateStage({ zone: 'summer', variant: 'forest', layout: 'jungle', cols: 60, rows: 40, nature: JUNGLE })
    } finally { Math.random = orig }
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

describe('the jungle is PARTITIONED into sub-zones, regions inside one map', () => {
  // On 2026-09-11 it chose the shape: regions inside ONE map, so you walk out of the open canopy
  // into dense growth without loading anything, and the template list stays at three forests.

  const floorCells = (s: ReturnType<typeof zoned>, tone: string) =>
    s.floorColors.flat().filter(t => t === tone).length

  it('puts EVERY served region on the map, none is quietly dropped', () => {
    const s = zoned()
    for (const z of ZONES) {
      // The swamp is mostly under its own pools, so it is asserted as present rather than at a size.
      const present = floorCells(s, z.floor!) > 0 || z.key === 'swamp'
      expect({ zone: z.key, present }).toEqual({ zone: z.key, present: true })
    }
  })

  it('a DENSE region is genuinely denser than an OPEN one on the SAME map', () => {
    // The point of the whole thing. Before this the canopy took one target over the whole map, so averaging
    // a dense region and an open one gave you neither, just a uniform middle everywhere.
    const s = zoned()
    const dense = ZONES.find(z => z.key === 'dense')!
    const open = ZONES.find(z => z.key === 'open')!
    const rate = (tone: string) => {
      let cells = 0
      let blocked = 0
      s.floorColors.forEach((rowArr, r) => rowArr.forEach((t, c) => {
        if (t !== tone) return
        cells++
        if (s.collision[r][c]) blocked++
      }))
      return cells > 0 ? blocked / cells : 0
    }
    expect(rate(dense.floor!)).toBeGreaterThan(rate(open.floor!))
  })

  it('floods the SWAMP with standing pools, not a channel', () => {
    const s = zoned()
    // THE SAME SEED WITH NO REGIONS AT ALL, which is what this case compares against. It used to be
    // `build(...)` with the sub-zones argument left off, and that stopped meaning "no regions" the day the
    // helper began spreading the served row: a jungle serves five of its own, two of which carry water, so
    // the "dry" map was wetter than the regioned one it was supposed to lose to.
    const orig = Math.random
    Math.random = makeRng(5)
    let dry
    try {
      dry = generateStage({ zone: 'summer', variant: 'forest', layout: 'jungle', cols: 60, rows: 40, nature: JUNGLE, palette: JUNG_PAL })
    } finally { Math.random = orig }
    // WATER-GROUND, not one spelling of it. A pool lays `water_shallow` since 2026-09-12, because that label
    // is height 0.0 and a puddle has to sit LEVEL with the floor, while `water` is 0.5 so a
    // RIVER surface sits under its bank. Counting the literal 'water' label therefore measured the CREEK only
    // and the swamp's pools dropped out of the tally: 39 against the dry map's 77.
    //
    // The intent of this case is unchanged: a regioned swamp holds MORE standing water than a region-less
    // jungle. Only the ruler was wrong, and it was wrong in the same way four places in the generator were.
    // WET WHEREVER IT LIVES. A pool stopped being a ground tile on 2026-09-13 and became a FILM stacked over
    // the ground, because as a ground tile its height could never match the floor it landed on, so a walker
    // dropped into every puddle. The channel is still in the ground and the pools are in the props, so
    // counting only one of them measures half the water.
    //
    // Same lesson as the comment above, one layer further out: the intent of this case has not changed, only
    // where the answer is kept.
    const wet = (stage: { ground: string[][]; props: Array<{ label?: string }> }) =>
      stage.ground.flat().filter(t => t.includes('water')).length +
      stage.props.filter(p => p.label === 'water_still').length
    expect(wet(s)).toBeGreaterThan(wet(dry))
  })

  /**
   * THIS TEST USED TO PASS WHILE THE FEATURE WAS WRONG. It asserted only that SOME rock prop existed, and scattered
    * boulders satisfied that happily.
   * What makes a ruin a ruin is that it was built: a platform, and uprights at a regular interval on it.
   */
  it('BUILDS ruins: a stone platform with columns standing on it, not a scatter of rocks', () => {
    const s = zoned()
    const platform = s.ground.flat().filter(t => t === 'ancient_stone').length
    const columns = s.props.filter(p => p.type === 'pillar').length

    expect(platform).toBeGreaterThan(RUIN_MIN_SITE) // a footprint, not a cell
    expect(columns).toBeGreaterThan(2) // standing masonry, at a fixed step around the edge
    expect(s.props.filter(p => p.type === 'rock').length).toBeGreaterThan(0) // and what fell off them
  })

  /**
   * A ROCK IN THE RIVER IS NOT MASONRY. This counted every `rock` prop on the map, which was a sound proxy
   * for rubble only while nothing else on a jungle made one. `strewRiverRocks` does: a few boulders standing
   * midstream, and it needs water on all four sides, so it only ever fires where the channel has an interior.
   * The creek had almost none while its width was measured along the scanline rather than across the current,
   * so the pass was dead and the proxy held by accident.
   *
   * Rubble is masonry because it lies on the PLATFORM. So the question is asked about dry ground, which is
   * where a ruin would be and where the river's rocks by definition are not.
   */
  it('puts no masonry anywhere without a ruins region', () => {
    const plain = build('jungle', JUNGLE, JUNG_PAL, 5)
    expect(plain.ground.flat().filter(t => t === 'ancient_stone').length).toBe(0)
    expect(plain.props.filter(p => p.type === 'pillar').length).toBe(0)
    const onLand = plain.props.filter(p => p.type === 'rock' && !isWaterGround(plain.ground[p.row][p.col]))
    expect(onLand.map(p => `${p.col},${p.row}`)).toEqual([])
  })

  it('is STILL one place, regions and all', () => {
    // Everything above adds blocking ground. None of it may cut the map up.
    for (const seed of [1, 2, 3, 4, 5]) {
      expect({ seed, regions: regions(zoned(seed, 45, 35)).length }).toEqual({ seed, regions: 1 })
    }
  })

  it('serves NO regions → one uniform jungle, exactly as before', () => {
    // A template that states no sub-zones must not have any invented for it.
    const plain = build('jungle', JUNGLE, JUNG_PAL, 5)
    for (const z of ZONES) expect(floorCells(plain, z.floor!)).toBe(0)
  })
})
