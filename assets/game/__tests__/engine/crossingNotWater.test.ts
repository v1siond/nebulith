/**
 * THE RIVER RUNS UNDER THE CROSSING, because a bridge is an OBJECT and the river is a LAYER.
 *
 * *"it looks like we're trying to replace the river section with the bridge, but that's NOT what we should be
 * doing, a bridge is just an object, a composition of tiles. the river is a layer, we just draw the river
 * regularly, then we add the bridge as needed... they don't overwrite any of the terrain"* (2026-09-16).
 *
 * This file used to assert the opposite, and it was written in good faith against the model of the day: a
 * crossing cell had its ground SWAPPED for the bridge tile, its elevation forced to 0 and its colour
 * repainted, so "a crossing must not wear the water's colour" was the right question to ask about it. Three
 * writes to the TERRAIN to express an OBJECT, and each one was visible on the map: the river stopped dead
 * under every bridge, and the raised cells stood a block proud of the channel as rectangles behind and beside
 * it, which is what got reported.
 *
 * So the contract is inverted, and it is the stronger one. A crossing cell keeps EVERYTHING the river layer
 * gave it, its label, its colour and its cut, and the only marks of a crossing are that you can walk there
 * and that a composition stands over it lifted clear of the channel.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { generateStage } from '@/engine/stageGenerator'
import { findGenerator, parseGeneratorCatalog } from '@/lib/generatorCatalog'
import { makeRng } from '@/lib/math'
import liveBody from '@/__tests__/fixtures/generators.json'

const CATALOG = parseGeneratorCatalog(liveBody)

function forest(course: string, seed: number, bridge = 'stone') {
  const cfg = findGenerator(CATALOG, 'wilderness', 'woodland')!.config
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage({
      zone: 'summer', variant: 'forest', layout: 'woodland', cols: 60, rows: 40,
      nature: cfg.nature, palette: cfg.palette, formation: cfg.formation, treeMix: cfg.trees,
      crossings: cfg.crossings,
      // EXITS AND PATHWAYS, the way the editor builds. A crossing is placed where a WAY meets the water, so a
      // map with no route network has nothing for one to land on: without these the sweep found decks on dry
      // landings only and not one bridge across twenty-one maps.
      options: { river: course, depth: '1', bridge, exits: '2', pathways: '2' },
    })
  } finally { Math.random = orig }
}

const isWater = (label: string) => label.includes('water')

/** The map's sealed edge, where a blocked cell is the border doing its job rather than a broken crossing. */
const BAND = 2
const inBorderBand = (s: ReturnType<typeof forest>, col: number, row: number): boolean =>
  Math.min(col, row, s.cols - 1 - col, s.rows - 1 - row) < BAND

/** The elevation of a river cell beside this one that no crossing covers, or undefined if there is none. */
function neighbourRiver(s: ReturnType<typeof forest>, col: number, row: number): number | undefined {
  for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const c = col + dc
    const r = row + dr
    if (c < 0 || r < 0 || c >= s.cols || r >= s.rows) continue
    if (!isWater(s.ground[r][c])) continue
    if (s.decks?.has(`${c},${r}`) || s.fords?.has(`${c},${r}`)) continue
    return s.elevation?.[r]?.[c] ?? 0
  }
  return undefined
}

describe('the river runs under the crossing', () => {
  it.each(['divides', 'through', 'around'])('%s: a decked cell is still river in every respect', course => {
    const notWater: string[] = []
    const filledIn: string[] = []
    const blocked: string[] = []
    let decked = 0
    for (const seed of [1, 2, 3, 5, 8, 13]) {
      const s = forest(course, seed)
      // WHICH DECK CELLS THE RIVER EVER OWNED, asked of the water itself rather than assumed.
      const wasRiver = new Set([...(s.decks ?? [])].filter(k => {
        const [c, r] = k.split(',').map(Number)
        return isWater(s.ground[r][c]) || (s.elevation?.[r]?.[c] ?? 0) < 0
      }))
      for (const key of s.decks ?? []) {
        const [col, row] = key.split(',').map(Number)
        // The one thing a crossing changes ANYWHERE it covers: you can get across it.
        //
        // The border BAND is exempt, and for the same reason it is exempt everywhere else: the map's edge is
        // sealed on purpose, and a crossing that happens to reach into it does not get to open a way out.
        if (s.collision[row][col] && !inBorderBand(s, col, row)) blocked.push(`${course} s${seed} ${key}`)
        // A crossing band reaches a cell of BANK at each end on purpose, so it has something to land on.
        // Those were never river and the river layer owes them nothing; the rest is what this is about.
        if (!wasRiver.has(key)) continue
        // A FORD is raised out of the cut on purpose, that being what a ford is, so it is not evidence of a
        // bridge filling the channel in. Only a BUILT crossing is under test here.
        if (s.fords?.has(key)) continue
        decked++
        // The LABEL the river layer wrote, untouched. A crossing lays no tile of its own any more.
        if (!isWater(s.ground[row][col])) notWater.push(`${course} s${seed} ${key} is ${s.ground[row][col]}`)
        // And the CUT it was given, asked as "is it level with the river beside it" rather than "is it below
        // zero". Not every water cell was dug (a map can turn ground wet after the channel is carved), so the
        // absolute test flags cells no bridge ever touched. The property is that a crossing changes the
        // river's profile NOWHERE: forcing its cells back up to 0 is what stood them proud of the channel and
        // made the rectangles beside every bridge.
        // NEVER HIGHER than the river beside it. Lower is fine, that is the channel; a river's own bed is not
        // flat end to end, so demanding equality measures the river rather than the bridge.
        const beside = neighbourRiver(s, col, row)
        if (beside !== undefined && (s.elevation?.[row]?.[col] ?? 0) > beside) {
          filledIn.push(`${course} s${seed} ${key} stands at ${s.elevation?.[row]?.[col]} over river at ${beside}`)
        }
      }
    }
    expect({ course, sawACrossing: decked > 0 }).toEqual({ course, sawACrossing: true })
    expect({ notWater: notWater.slice(0, 4), filledIn: filledIn.slice(0, 4), blocked: blocked.slice(0, 4) })
      .toEqual({ notWater: [], filledIn: [], blocked: [] })
  })

  it('and it keeps the river COLOUR, because the river does not stop to go under a bridge', () => {
    // The old contract was that this colour must be cleared. It was cleared because the ground had been
    // replaced and a bridge wearing the water's blue looked wrong; with the water still there it is right.
    const strangers: string[] = []
    let checked = 0
    // Across seeds and courses: whether a given map's crossing lands on water at all is geometry, so one map
    // would be testing the seed.
    for (const course of ['divides', 'through', 'around']) {
      for (const seed of [1, 2, 3, 5, 8, 13]) {
        const s = forest(course, seed)
        // THE SERVED palette, not the stage's echo of it. Reading `s.palette` made the whole sweep vacuous:
        // the stage does not carry one, so every map was skipped and the test passed having checked nothing.
        const pal = findGenerator(CATALOG, 'wilderness', 'woodland')!.config.palette ?? {}
        const wet = new Set([pal.water, pal.waterShallow, pal.waterDeep]
          .filter((c): c is string => typeof c === 'string').map(c => c.toLowerCase()))
        expect(wet.size).toBeGreaterThan(0)
        for (const key of s.decks ?? []) {
          const [col, row] = key.split(',').map(Number)
          if (!isWater(s.ground[row][col])) continue
          checked++
          const worn = s.floorColors?.[row]?.[col]?.toLowerCase()
          if (worn !== undefined && !wet.has(worn)) strangers.push(`${course} s${seed} ${key} wears ${worn}`)
        }
      }
    }
    expect(checked).toBeGreaterThan(0)
    expect(strangers.slice(0, 5)).toEqual([])
  })

  it('what you actually walk on is a COMPOSITION, standing clear of the channel', () => {
    // A built crossing is expressed entirely as an object now, so if the stamp stopped happening there would
    // be nothing over the water at all and the map would look bridgeless while still being crossable.
    // Across seeds: whether a span FITS a given river is the geometry's business, so pinning one map would be
    // testing the seed rather than the rule.
    const bridges = ['divides', 'through', 'around'].flatMap(course =>
      [1, 2, 3, 4, 5, 8, 13].flatMap(seed =>
        (forest(course, seed).compositions ?? []).filter(c => c.kind.startsWith('bridge_'))))
    expect(bridges.length).toBeGreaterThan(0)
    // AT ITS BANKS' LEVEL, stated outright. Resting on the anchor cell's stack is how the same bridge came out
    // at levels 4 to 7 on one seed and 0.5 to 3.5 on another.
    for (const b of bridges) expect({ kind: b.kind, baseLevel: b.baseLevel }).toEqual({ kind: b.kind, baseLevel: 0 })
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
    expect(films.every(f => !f.occupies)).toBe(true) // you wade a puddle
  })
})
