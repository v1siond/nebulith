/**
 * EVERY REGION, IN EVERY TEMPLATE, IS A DIFFERENT PLACE FROM ITS SIBLINGS.
 *
 * His instruction, 2026-09-17:
 *
 *   "LIKE WHAT'S THE DIFFERENCE BETWEEN A THIKET JUNGLE AND A DENSE JUNGLE?? I'LL ANSWER, NOTHING, THERE'S
 *    NOT A SINGLE THING THAT'S REALLY DIFFERENT ... AND WE SHOULD HAVE SPECIFIC TEST FOR EACH SINGLE ONE,
 *    JUNGLE x, JUNGLE y, ETC ... THE SAME WITH ALL VARIATIONS ALL TEMPLATE GENERATORS, INCLUDING VILLAGES,
 *    TOWNS, CITIES AND OF COURSE ALL WIDLERNESS"
 *
 * So there is one named test per region of every generator that serves regions, and each one asks the only
 * question that matters: is this place TELLABLE APART from every other place in its own set?
 *
 * A region passes against a sibling when the two differ on at least one axis a person can see on the map:
 *
 *   ground      what grows at knee height, by PLANT and not by amount. Two regions running the same plant at
 *               two densities are one place at two settings, which is exactly what he is objecting to.
 *   canopy      how many trunks stand in it
 *   walkable    how much of it you can actually cross
 *   water       how much of it is wet
 *   stone       how much of it is built or fallen
 *   relief      how high it stands
 *
 * The map is PINNED while this runs (`REGIONS.md` §0b): no river, no crossing, fixed exits and pathways, so
 * the only thing varying between two regions is the two regions.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { generateStage, type StageData, type VariantId } from '@/engine/stageGenerator'
import { findGenerator, parseGeneratorCatalog, type GeneratorConfig } from '@/lib/generatorCatalog'
import { makeRng } from '@/lib/math'
import liveBody from '@/__tests__/fixtures/generators.json'

const CATALOG = parseGeneratorCatalog(liveBody)

/** Every (category, generator) that serves regions, which is what "all template generators" means. */
const WITH_REGIONS: Array<{ category: string; key: string; config: GeneratorConfig }> = CATALOG.flatMap(cat =>
  cat.generators
    .filter(g => (g.config.subZones?.length ?? 0) > 1)
    .map(g => ({ category: cat.key, key: g.key, config: g.config })),
)

/**
 * WHICH BUILDER A CATEGORY RUNS. A village is not a variant: it is the `town` builder with a village's own
 * settlement tuning, and `VariantId` has no 'village' in it. Passing one produced no phases at all, so the
 * map came back with no regions and every settlement test failed for the wrong reason.
 */
const VARIANT: Record<string, VariantId> = { city: 'city', town: 'town', village: 'town', wilderness: 'forest' }

/** Build one map with everything except the region pinned off. */
function grow(category: string, config: GeneratorConfig, region: string, seed: number): StageData {
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage({
      zone: 'summer',
      variant: VARIANT[category] ?? 'forest',
      layout: undefined,
      cols: 48, rows: 36,
      nature: config.nature,
      palette: config.palette,
      formation: config.formation,
      treeMix: config.trees,
      subZones: config.subZones,
      regionLayout: config.regionLayout,
      settlement: config.settlement,
      buildingSizes: config.buildingSizes,
      crossings: config.crossings,
      options: { region, river: 'none', bridge: 'none', exits: '2', pathways: '2' },
    })
  } finally {
    Math.random = orig
  }
}

interface Profile {
  cells: number
  ground: string
  canopy: number
  walkable: number
  water: number
  stone: number
  relief: number
  /** How much of it is BUILT. For a settlement this is the whole difference between a park and a terrace. */
  built: number
  /** WHAT it is built of, as the buildings this neighbourhood actually stamps. A city's wealth tiers are told
   *  apart by their architecture before anything else: stone under slate against timber under a flat roof. */
  architecture: string
}

/** What each region of a built map actually came out as. */
function profiles(stage: StageData): Map<string, Profile> {
  const regions = stage.regions
  if (!regions) return new Map()
  const raw = new Map<string, { cells: number; trees: number; open: number; wet: number; rock: number; level: number; houses: number; plants: Map<string, number>; kinds: Map<string, number> }>()
  const at = (col: number, row: number): string | undefined => regions[row]?.[col]

  for (let row = 0; row < stage.rows; row++) {
    for (let col = 0; col < stage.cols; col++) {
      const key = at(col, row)
      if (!key) continue
      const rec = raw.get(key) ?? { cells: 0, trees: 0, open: 0, wet: 0, rock: 0, level: 0, houses: 0, plants: new Map(), kinds: new Map<string, number>() }
      rec.cells += 1
      if (!stage.collision[row][col]) rec.open += 1
      const g = stage.ground[row][col]
      if (/water/.test(g)) rec.wet += 1
      if (g === 'ancient_stone') rec.rock += 1
      rec.level = Math.max(rec.level, stage.elevation?.[row]?.[col] ?? 0)
      raw.set(key, rec)
    }
  }
  // WHAT EACH NEIGHBOURHOOD BUILDS, by the region the generator recorded on the building itself.
  for (const b of stage.buildings ?? []) {
    const rec = b.region && raw.get(b.region)
    // The KIND is the footprint it stamps; the roof and the wall are what the neighbourhood is made OF, and
    // between them they are the architecture a person sees from above.
    if (rec) {
      const built = [b.kind, b.roof, b.material].filter(Boolean).join('/')
      rec.kinds.set(built, (rec.kinds.get(built) ?? 0) + 1)
    }
  }
  // EVERY CELL A BUILDING COVERS, by the region its own footprint sits in.
  for (const b of stage.buildings ?? []) {
    for (let r = b.row - b.height + 1; r <= b.row; r++) {
      for (let c = b.col; c < b.col + b.length; c++) {
        const key = at(c, r)
        const rec = key && raw.get(key)
        if (rec) rec.houses += 1
      }
    }
  }
  for (const tree of stage.trees) {
    const key = at(tree.col, tree.row)
    const rec = key && raw.get(key)
    if (rec) rec.trees += 1
  }
  // WHAT GROWS AT KNEE HEIGHT. A prop that grows is vegetation; the water film and the ornaments are not.
  for (const prop of stage.props) {
    if (prop.grows === false) continue
    const key = at(prop.col, prop.row)
    const rec = key && raw.get(key)
    if (!rec || !prop.label) continue
    // WHAT GROWS, not what lies about. A meadow scatters field stones over everything, and they outvoted the
    // vegetation in the tally: two regions with different undergrowth both reported `rock` and read as the
    // same place. A stone is not something growing at knee height.
    if (!MINERAL.has(prop.label)) rec.plants.set(prop.label, (rec.plants.get(prop.label) ?? 0) + 1)
    if (/water/.test(prop.label)) rec.wet += 1
  }

  const out = new Map<string, Profile>()
  for (const [key, r] of raw) {
    const top = [...r.plants].sort((a, b) => b[1] - a[1])[0]
    out.set(key, {
      cells: r.cells,
      ground: top?.[0] ?? 'bare',
      canopy: r.trees / r.cells,
      walkable: r.open / r.cells,
      water: r.wet / r.cells,
      stone: r.rock / r.cells,
      relief: r.level,
      built: r.houses / r.cells,
      architecture: [...r.kinds].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'none',
    })
  }
  return out
}

/** The axes on which two places are told apart, and by how much they have to differ to count. */
function differences(a: Profile, b: Profile): string[] {
  const out: string[] = []
  if (a.ground !== b.ground) out.push(`ground ${a.ground} vs ${b.ground}`)
  if (Math.abs(a.canopy - b.canopy) >= 0.05) out.push(`canopy ${a.canopy.toFixed(2)} vs ${b.canopy.toFixed(2)}`)
  if (Math.abs(a.walkable - b.walkable) >= 0.12) out.push(`walkable ${a.walkable.toFixed(2)} vs ${b.walkable.toFixed(2)}`)
  if (Math.abs(a.water - b.water) >= 0.06) out.push(`water ${a.water.toFixed(2)} vs ${b.water.toFixed(2)}`)
  if (Math.abs(a.stone - b.stone) >= 0.06) out.push(`stone ${a.stone.toFixed(2)} vs ${b.stone.toFixed(2)}`)
  if (a.relief !== b.relief) out.push(`relief ${a.relief} vs ${b.relief}`)
  if (Math.abs(a.built - b.built) >= 0.05) out.push(`built ${a.built.toFixed(2)} vs ${b.built.toFixed(2)}`)
  if (a.architecture !== b.architecture) out.push(`builds ${a.architecture} vs ${b.architecture}`)
  return out
}

/** Scattered ornaments, which are not vegetation however many of them there are. */
const MINERAL: ReadonlySet<string> = new Set(['rock', 'stone', 'ancient_stone', 'boulder', 'dirt', 'dirt_patch'])

/** A region too small to measure says nothing either way, so it is not evidence of sameness. */
const MEASURABLE = 40

describe.each(WITH_REGIONS)('$key', ({ category, config }) => {
  const regions = config.subZones ?? []

  it.each(regions.map(z => z.key))('%s is a different place from every other region in its set', region => {
    // Two seeds, because one partition can hand a sibling too few cells to measure.
    const seen = new Map<string, Profile>()
    for (const seed of [3, 11]) {
      for (const [key, profile] of profiles(grow(category, config, region, seed))) {
        const best = seen.get(key)
        if (!best || profile.cells > best.cells) seen.set(key, profile)
      }
    }

    const mine = seen.get(region)
    expect(mine).toBeDefined()
    if (!mine || mine.cells < MEASURABLE) return

    const show = (p: Profile): string =>
      `ground ${p.ground} canopy ${p.canopy.toFixed(2)} walk ${p.walkable.toFixed(2)} water ${p.water.toFixed(2)} stone ${p.stone.toFixed(2)} built ${p.built.toFixed(2)} builds ${p.architecture} relief ${p.relief}`

    const same: string[] = []
    for (const [key, other] of seen) {
      if (key === region || other.cells < MEASURABLE) continue
      // The failure has to say WHY two places read alike, or the next person measures it all over again.
      if (differences(mine, other).length === 0) same.push(`${key} [${show(other)}]`)
    }
    expect({ region: `${region} [${show(mine)}]`, indistinguishableFrom: same })
      .toEqual({ region: `${region} [${show(mine)}]`, indistinguishableFrom: [] })
  })
})
