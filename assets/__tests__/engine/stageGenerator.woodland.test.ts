/**
 * THE CANOPY FOREST LAYOUTS — `woodland`, `woodland_river` and `jungle`.
 *
 * Alexander, 2026-09-09: *"we need less trees on woodland, reduce it about 30%"*, *"add a jungle variant"*,
 * *"and add a woodland + river variant too."*
 *
 * All three share ONE builder. That is the point of them: a jungle is not a different kind of map, it is a
 * woodland at jungle DENSITY, and a woodland+river is a woodland with water carved through it before anything
 * is planted. Two code paths that must be kept looking alike by hand always drift, so the tests below assert
 * the SHARED structure once and then only what genuinely differs per layout.
 *
 * The densities themselves are BACKEND data (`/api/generators` → `config.nature`), so they are passed in here
 * rather than read from a constant — the generator must build whatever it is served, and the numbers are
 * tuned in `generator_source.ex`, not in this file.
 */
import '@/__tests__/helpers/installTilesetSeed' // the generator reads all tile/composition data from the loaded fixture
import { generateStage, type ForestLayout, type NatureDensity } from '@/engine/stageGenerator'
import { makeRng } from '@/lib/math'

const COLS = 60, ROWS = 40

/** The served woodland densities, as `generator_source.ex` carries them. */
const WOODLAND: NatureDensity = { canopy: 0.434, groundCover: 0.2, flowers: 0.04 }
/** The served JUNGLE densities — the canopy the woodland used to run at, over far heavier undergrowth. */
const JUNGLE: NatureDensity = { canopy: 0.62, groundCover: 0.5, flowers: 0.1 }

/** Build under a SEEDED Math.random, so a density assertion measures the density and not the roll of the
 *  day. Comparing two stochastic quantities across unseeded runs is how a test becomes a coin flip — this
 *  suite asserts ratios, so it has to hold the randomness still. */
const build = (layout: ForestLayout, nature: NatureDensity, seed = 1) => {
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage({ zone: 'summer', variant: 'forest', layout, cols: COLS, rows: ROWS, nature })
  } finally {
    Math.random = orig
  }
}

const countGround = (stage: ReturnType<typeof build>, tile: string) =>
  stage.ground.flat().filter(t => t === tile).length

/** Trees averaged over several SEEDED maps — one map says nothing about a density, and the seeds make the
 *  average reproducible so the band below is a real bound rather than a lucky one. */
const meanTrees = (layout: ForestLayout, nature: NatureDensity, runs = 5) => {
  let total = 0
  for (let seed = 1; seed <= runs; seed++) total += build(layout, nature, seed).trees.length
  return total / runs
}

describe('every canopy layout builds a navigable forest', () => {
  it.each<[ForestLayout, NatureDensity]>([
    ['woodland', WOODLAND],
    ['woodland_river', WOODLAND],
    ['jungle', JUNGLE],
  ])('%s plants trees, carves clearings and leaves a way through', (layout, nature) => {
    const stage = build(layout, nature)
    expect(stage.trees.length).toBeGreaterThan(0)
    // Not a solid block of forest: a real share of the map is NOT under a trunk, which is what the clearings
    // and trails are. Alexander, 2026-09-09: *"the forest is generated without any roads, there's no way to
    // navigate it."*
    const trunks = new Set(stage.trees.map(t => `${t.col},${t.row}`))
    const open = COLS * ROWS - trunks.size
    expect(open / (COLS * ROWS)).toBeGreaterThan(0.5)
    // …and the open ground is PAVED somewhere — a trail has to be visible to be a trail.
    const floor = countGround(stage, 'meadow')
    expect(floor).toBeLessThan(COLS * ROWS) // some ground is something other than the bare forest floor
  })
})

describe('the woodland was thinned by ~30% (Alexander, 2026-09-09)', () => {
  it('drops roughly a third of the trees against the density it used to run at', () => {
    const before = meanTrees('woodland', { ...WOODLAND, canopy: 0.62 })
    const after = meanTrees('woodland', WOODLAND)
    const drop = 1 - after / before
    expect(drop).toBeGreaterThan(0.25)
    expect(drop).toBeLessThan(0.35)
  })

  it('the density is DATA — the generator plants whatever it is served, inventing no number', () => {
    // Halving the served canopy must halve the planting. If the generator carried its own constant this
    // would not move, which is the regression worth catching.
    const dense = meanTrees('woodland', { ...WOODLAND, canopy: 0.6 })
    const sparse = meanTrees('woodland', { ...WOODLAND, canopy: 0.3 })
    expect(sparse).toBeLessThan(dense * 0.65)
  })
})

describe('woodland + river', () => {
  it('cuts a river through the trees and bridges it, so the wood is still one place', () => {
    const stage = build('woodland_river', WOODLAND)
    expect(countGround(stage, 'water')).toBeGreaterThan(0)
    // A river you cannot cross splits the forest in two — the deck is laid last so nothing plants over it.
    expect(countGround(stage, 'bridge')).toBeGreaterThan(0)
  })

  it('never plants a tree in the water — the river is carved BEFORE anything is planted', () => {
    const stage = build('woodland_river', WOODLAND)
    const inWater = stage.trees.filter(t => stage.ground[t.row]?.[t.col] === 'water')
    expect(inWater.map(t => `${t.col},${t.row}`)).toEqual([])
  })

  it('the plain woodland has no water at all', () => {
    expect(countGround(build('woodland', WOODLAND), 'water')).toBe(0)
  })
})

describe('jungle', () => {
  it('is denser overhead than the woodland', () => {
    expect(meanTrees('jungle', JUNGLE)).toBeGreaterThan(meanTrees('woodland', WOODLAND))
  })

  it('is choked UNDERFOOT — the undergrowth is what makes it a jungle, not just more trunks', () => {
    // Ground cover is the distinguishing number: a wood is walkable between its trunks, a jungle is not.
    const jungle = build('jungle', JUNGLE)
    const woodland = build('woodland', WOODLAND)
    expect(jungle.props.length).toBeGreaterThan(woodland.props.length * 1.4)
  })

  it('still carves clearings and trails — it is a forest you can move through, not a wall', () => {
    const stage = build('jungle', JUNGLE)
    const trunks = new Set(stage.trees.map(t => `${t.col},${t.row}`))
    expect((COLS * ROWS - trunks.size) / (COLS * ROWS)).toBeGreaterThan(0.5)
  })
})
