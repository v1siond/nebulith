/**
 * A BRIDGE MUST NOT LOOK LIKE WATER.
 *
 * That was right. The cause was a single `else if`. A crossing cell is river a moment before the deck is
 * laid, so `floorColors` is holding the river's blue when `layDeck` runs. `layDeck` wrote the tile (`bridge`)
 * and the elevation, then reached `else if (tone) floorColors[…] = tone` and, with no served tone, LEFT THE
 * BLUE THERE. The tile said bridge and the colour said water, so you got a blue walkway over a blue river.
 *
 * The old code carried a comment defending it ("a default here would be a hardcoded fallback for a SERVED
 * value"), which is the compliance rule pointed at the wrong thing. Clearing a STALE override is not
 * inventing a value: an undefined override means "no override", so the bridge tile's own served colour
 * shows. Inventing a brown would have been the violation.
 *
 * The oracle is the requirement, measured: no cell you can walk on may wear a colour the water wears.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { generateStage } from '@/engine/stageGenerator'
import { findGenerator, parseGeneratorCatalog } from '@/lib/generatorCatalog'
import { makeRng } from '@/lib/math'
import liveBody from '@/__tests__/fixtures/generators.json'

const CATALOG = parseGeneratorCatalog(liveBody)

function forest(course: string, seed: number) {
  const cfg = findGenerator(CATALOG, 'wilderness', 'woodland')!.config
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage({
      zone: 'summer', variant: 'forest', layout: 'woodland', cols: 60, rows: 40,
      nature: cfg.nature, palette: cfg.palette, formation: cfg.formation, treeMix: cfg.trees,
      options: { river: course, crossing: true },
    })
  } finally { Math.random = orig }
}

/** Every colour this template paints water with, lower-cased for comparison. */
const waterColours = (s: ReturnType<typeof forest>): Set<string> => {
  const pal = s.palette ?? {}
  return new Set([pal.water, pal.waterShallow, pal.waterDeep, pal.swamp]
    .filter((c): c is string => typeof c === 'string').map(c => c.toLowerCase()))
}

/** Cells whose GROUND is a crossing you walk over, not water. */
const crossingCells = (s: ReturnType<typeof forest>): Array<[number, number]> => {
  const out: Array<[number, number]> = []
  s.ground.forEach((row, r) => row.forEach((g, c) => {
    if (/bridge|plank|deck|boardwalk|log/.test(g) && !s.collision[r][c]) out.push([c, r])
  }))
  return out
}

describe('nothing you walk on wears the water it crosses', () => {
  it.each(['divides', 'through', 'around'])('%s: not one crossing cell keeps the river colour', course => {
    // Several seeds, because a crossing is placed stochastically and one map proves very little.
    const offenders: string[] = []
    let crossings = 0
    for (const seed of [1, 2, 3, 5, 8, 13]) {
      const stage = forest(course, seed)
      const wet = waterColours(stage)
      for (const [col, row] of crossingCells(stage)) {
        crossings++
        const worn = stage.floorColors?.[row]?.[col]?.toLowerCase()
        if (worn && wet.has(worn)) offenders.push(`${course} seed=${seed} (${col},${row}) wears ${worn}`)
      }
    }
    expect({ course, sawACrossing: crossings > 0, offenders }).toEqual({ course, sawACrossing: true, offenders: [] })
  })

  it('a crossing cell is left with NO colour override when none is served, so the tile decides', () => {
    // The positive half: clearing is what lets the bridge tile's own served colour through. If a later change
    // starts stamping a colour here, that is a hardcoded fallback and this test says so.
    const stage = forest('divides', 3)
    const cells = crossingCells(stage)
    expect(cells.length).toBeGreaterThan(0)
    const wet = waterColours(stage)
    for (const [col, row] of cells) {
      const worn = stage.floorColors?.[row]?.[col]
      expect({ cell: `${col},${row}`, wearsWater: !!worn && wet.has(worn.toLowerCase()) })
        .toEqual({ cell: `${col},${row}`, wearsWater: false })
    }
  })
})

/**
 * THE ONE THAT ACTUALLY CAUGHT IT.
 *
 * The suite above passes against the old code too, because the woodland always serves a `trail` tone so the
 * `else if (tone)` branch was never the one taken there. Keeping it, because the deck bug was real and this
 * is the regression guard for it, but it is not evidence, and saying so is the point.
 *
 * The cell actually at fault was a SWAMP PUDDLE. The pool pass wrote `floorColors[…] = pal.water`,
 * so the ground itself was a walkable meadow wearing the river's blue. Measured on a swamp jungle at seed 7:
 * 48 cells, before and 0 after, with the 48 puddle FILMS still there (the puddle became its own layer instead
 * of a paint job on the floor).
 *
 * The oracle is by HUE, not by palette key, because "looks like water" is a thing you see, and reading the
 * palette would only have re-asked the question using the same names the bug was hiding behind.
 */
describe('a walkable floor never wears water, whatever painted it', () => {
  /** Blue clearly dominates red: what "looks like water" means at a glance. */
  const blueish = (hex?: string): boolean => {
    if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return false
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
    return b > r + 30 && b >= g
  }
  /** Wadeable water is ALLOWED to be walkable and blue: */
  const isWaterTile = (label: string) => label.includes('water')

  function swampJungle(seed: number) {
    const cfg = findGenerator(CATALOG, 'wilderness', 'jungle')!.config
    const orig = Math.random
    Math.random = makeRng(seed)
    try {
      return generateStage({
        zone: 'spring', variant: 'forest', layout: 'jungle', cols: 40, rows: 40,
        nature: cfg.nature, palette: cfg.palette, formation: cfg.formation, treeMix: cfg.trees,
        subZones: cfg.subZones, crossings: cfg.crossings,
        options: { river: 'divides', jungle: 'swamp', crossing: true },
      })
    } finally { Math.random = orig }
  }

  it.each([7, 11, 21])('swamp jungle seed %i: no walkable GROUND tile is painted blue', seed => {
    const stage = swampJungle(seed)
    const offenders: string[] = []
    stage.ground.forEach((row, r) => row.forEach((label, c) => {
      if (stage.collision[r][c] || isWaterTile(label)) return
      const worn = stage.floorColors?.[r]?.[c]
      if (blueish(worn)) offenders.push(`${label} at ${c},${r} wears ${worn}`)
    }))
    expect({ seed, offenders: offenders.slice(0, 5), count: offenders.length })
      .toEqual({ seed, offenders: [], count: 0 })
  })

  it('the puddles are still there, as a stacked film rather than a painted floor', () => {
    // The other half: the fix must not have deleted the water, only moved it off the floor and onto its own
    // layer. A green test with no puddles left would be the worst possible outcome.
    const films = swampJungle(7).props.filter(p => p.label === 'water_still')
    expect(films.length).toBeGreaterThan(20)
    expect(films.every(f => !f.blocking)).toBe(true) // you wade a puddle
  })
})
