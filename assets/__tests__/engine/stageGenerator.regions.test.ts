/**
 * A WOODLAND HAS REGIONS TOO, and a region can stand higher than the map around it.
 *
 * This sits BESIDE `stageGenerator.woodland.test.ts`, which owns the thinning, the path widths and the river
 * crossings. This file owns only the regions inside one woodland map, and their elevation.
 *
 * Alexander, 2026-09-11: *"woodland with meadow is the same as mountain forest..."*, *"mountain forest is not a
 * real mountain forest, I mean it doesn't even have mountain nor relieve sections, when we can construct them
 * withn cells easily... it doesn't have cliff, nor anything, it's basically just a meadow"*.
 *
 * WHY THIS FILE EXISTS, and it is not a flattering reason. I "fixed" glades by serving it a stand region and a
 * meadow region, and I reported the ticket done. It did nothing on screen: only `layoutJungle` ever called
 * `partitionSubZones`, so a woodland's regions were served, parsed, and dropped on the floor. Served and
 * ignored, the exact defect I keep finding in other code, this time mine. He caught it: *"fix 105 properly"*.
 *
 * So these tests do not assert that the data parses. Parsing is what fooled me. They assert what the finished
 * map CONTAINS: both region tones present, a stand measurably thicker than the meadow beside it, and, for
 * *"different levels of terrain, relieve in spanish"*, a raised region actually sitting above the ground with
 * the river cutting relative to whatever it flows through.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { generateStage, type StageData, type NatureDensity } from '@/engine/stageGenerator'
import { parseGeneratorCatalog, type GeneratorDef, type GeneratorSubZone } from '@/lib/generatorCatalog'
import { makeRng } from '@/lib/math'
import liveBody from '@/__tests__/fixtures/generators.json'

const CATALOG = parseGeneratorCatalog(liveBody)

function byKey(key: string): GeneratorDef {
  const walk = (gs: readonly GeneratorDef[]): GeneratorDef | undefined => {
    for (const g of gs) {
      if (g.key === key) return g
      const hit = g.children ? walk(g.children) : undefined
      if (hit) return hit
    }
    return undefined
  }
  const hit = walk(CATALOG.flatMap(c => c.generators))
  if (!hit) throw new Error(`the backend no longer serves ${key}`)
  return hit
}

/** Glades, exactly as the live backend serves it. Transcribing the numbers here would let the real row rot. */
const GLADES = byKey('forest_woodland_glades')

type Opts = {
  /** The generator row to grow. Its served config is used whole, so a test cannot quietly invent a number. */
  def?: GeneratorDef
  subZones?: readonly GeneratorSubZone[]
  options?: Record<string, string | boolean>
  seed?: number
  nature?: NatureDensity
}

function grow(o: Opts = {}): StageData {
  // `in`, NOT a default parameter. `grow({ subZones: undefined })` has to mean "the backend serves no regions",
  // and a default parameter silently puts glades' own regions back, so the no-regions test grew the regions it
  // was asserting the absence of and the failure read like a bug in the generator.
  const def = o.def ?? GLADES
  const subZones = 'subZones' in o ? o.subZones : def.config.subZones
  const { options, seed = 7 } = o
  const nature = o.nature ?? def.config.nature
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage({
      zone: 'summer', variant: 'forest', layout: 'woodland', cols: 60, rows: 40,
      nature, palette: def.config.palette, formation: def.config.formation,
      treeMix: def.config.trees, subZones, options,
    })
  } finally {
    Math.random = orig
  }
}

/** The share of a region's cells carrying a trunk. Density you can SEE, not density that was configured. */
function canopyRate(s: StageData, tone: string): number {
  const trunks = new Set(s.trees.map(t => `${t.col},${t.row}`))
  let cells = 0
  let trees = 0
  s.floorColors.forEach((row, r) => row.forEach((c, col) => {
    if (c !== tone) return
    cells++
    if (trunks.has(`${col},${r}`)) trees++
  }))
  return cells === 0 ? 0 : trees / cells
}

const zone = (key: string): GeneratorSubZone => {
  const hit = GLADES.config.subZones?.find(z => z.key === key)
  if (!hit) throw new Error(`glades no longer serves the ${key} region`)
  return hit
}

describe('a woodland is PARTITIONED into regions, the same as a jungle', () => {
  it('serves glades two regions in the first place, or there is nothing to render', () => {
    expect(GLADES.config.subZones?.map(z => z.key)).toEqual(['stand', 'meadow'])
  })

  it('puts BOTH region tones on the finished map, not just the template floor', () => {
    const tones = new Set(grow().floorColors.flat().filter(Boolean))
    for (const z of GLADES.config.subZones ?? []) {
      expect({ region: z.key, painted: tones.has(z.floor!) }).toEqual({ region: z.key, painted: true })
    }
  })

  it('grows a STAND measurably thicker than the MEADOW beside it, on the same map', () => {
    const s = grow()
    const stand = canopyRate(s, zone('stand').floor!)
    const meadow = canopyRate(s, zone('meadow').floor!)
    // his complaint was that the two read identically. Thicker is not enough, it has to be obvious.
    expect(stand).toBeGreaterThan(meadow * 3)
  })

  it('still grows a plain woodland when the backend serves NO regions', () => {
    const bare = grow({ subZones: undefined })
    expect(bare.trees.length).toBeGreaterThan(0)
    expect(new Set(bare.floorColors.flat().filter(Boolean)).has(zone('stand').floor!)).toBe(false)
  })
})

describe('RELIEF: a region can stand above the rest of the map', () => {
  const raised: readonly GeneratorSubZone[] = [{ ...zone('stand'), level: 2 }, zone('meadow')]

  it('lifts every cell of a region that states a level, and lifts nothing else', () => {
    const s = grow({ subZones: raised })
    const byTone = (tone: string) => {
      const out = new Set<number>()
      s.floorColors.forEach((row, r) => row.forEach((c, col) => { if (c === tone) out.add(s.elevation![r][col]) }))
      return out
    }
    expect([...byTone(zone('stand').floor!)]).toEqual([2])
    expect([...byTone(zone('meadow').floor!)]).toEqual([0])
  })

  it('leaves the whole map FLAT when no region asks for a level, so every old template is unmoved', () => {
    expect(new Set(grow().elevation!.flat())).toEqual(new Set([0]))
  })

  it('cuts the river RELATIVE to the ground it runs through, not to an absolute depth', () => {
    const cut = grow({ subZones: raised, options: { river: 'divides', depth: '1' } })
    const dry = grow({ subZones: raised, options: { river: 'divides', depth: 'none' } })

    const bed: Array<[number, number]> = []
    cut.ground.forEach((row, r) => row.forEach((t, col) => { if (t?.includes('water')) bed.push([col, r]) }))
    expect(bed.length).toBeGreaterThan(0) // with no river on the map this test would prove nothing

    // Every bed cell sits ONE step below where that same cell stood undug. On flat ground that is -1, which is
    // the old behaviour and its committed tests. Through a region standing at 2 it is 1.
    for (const [col, r] of bed) expect(cut.elevation![r][col]).toBe(dry.elevation![r][col] - 1)

    // and the course really does cross the raised ground, or the line above only re-proves the flat case.
    expect(new Set(bed.map(([col, r]) => cut.elevation![r][col]))).toContain(1)
  })
})

describe('the MOUNTAIN FOREST is the template that actually climbs', () => {
  const MOUNTAIN = byKey('forest_woodland_mountain')
  const mountain = (seed = 7) => grow({ def: MOUNTAIN, seed })
  const region = (key: string) => {
    const hit = MOUNTAIN.config.subZones?.find(z => z.key === key)
    if (!hit) throw new Error(`the mountain forest no longer serves the ${key} region`)
    return hit
  }

  it('is served three regions at three distinct levels', () => {
    expect(MOUNTAIN.config.subZones?.map(z => [z.key, z.level])).toEqual([['ridge', 3], ['slope', 1], ['vale', 0]])
  })

  it('RAISES REAL GROUND when grown, which is the whole difference from a meadow', () => {
    const levels = [...new Set(mountain().elevation!.flat())].sort((a, b) => a - b)
    expect(levels).toEqual([0, 1, 3])
  })

  it('steps between regions by more than one level somewhere, so there is a cliff to see', () => {
    const s = mountain()
    const steps = new Set<number>()
    for (let row = 0; row < s.rows - 1; row++) {
      for (let col = 0; col < s.cols - 1; col++) {
        const here = s.elevation![row][col]
        steps.add(Math.abs(here - s.elevation![row][col + 1]))
        steps.add(Math.abs(here - s.elevation![row + 1][col]))
      }
    }
    expect(Math.max(...steps)).toBeGreaterThanOrEqual(2) // a ridge over a slope, drawn as a two-level face
    expect(steps.has(0)).toBe(true) // and the inside of a region is level, not a staircase
  })

  it('grows the VALE thick and leaves the RIDGE bare, counting trunks and not settings', () => {
    const s = mountain()
    expect(canopyRate(s, region('vale').floor!)).toBeGreaterThan(canopyRate(s, region('ridge').floor!) * 2)
  })

  it('holds on ANOTHER seed too, so this is the template and not one lucky map', () => {
    expect([...new Set(mountain(21).elevation!.flat())].sort((a, b) => a - b)).toEqual([0, 1, 3])
  })
})
