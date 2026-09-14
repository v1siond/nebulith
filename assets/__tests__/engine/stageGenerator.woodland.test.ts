/**
 * THE CANOPY FOREST LAYOUTS — `woodland`, `jungle`, and the river OPTION either can carry.
 *
 * *"add a jungle variant"*, *"and add a woodland + river variant too."*
 *
 * All three share ONE builder. That is the point of them: a jungle is not a different kind of map, it is a woodland
 * at jungle DENSITY, and a woodland+river is a woodland with water carved through it before anything is planted. Two
 * code paths that must be kept looking alike by hand always drift, so the tests below assert the SHARED structure
 * once and then only what genuinely differs per layout.
 *
 * The densities themselves are BACKEND data (`/api/generators` → `config.nature`), so they are passed in here rather
 * than read from a constant — the generator must build whatever it is served, and the numbers are tuned in
 * `generator_source.ex`, not in this file.
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
const build = (layout: ForestLayout, nature: NatureDensity, seed = 1, options?: Record<string, boolean>) => {
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage({ zone: 'summer', variant: 'forest', layout, cols: COLS, rows: ROWS, nature, options })
  } finally {
    Math.random = orig
  }
}

const countGround = (stage: ReturnType<typeof build>, tile: string) =>
  stage.ground.flat().filter(t => t === tile).length

/** Every cell carrying `tile`, as [col, row] pairs. */
const cellsOf = (stage: ReturnType<typeof build>, tile: string): Array<[number, number]> => {
  const out: Array<[number, number]> = []
  stage.ground.forEach((rowArr, r) => rowArr.forEach((g, c) => { if (g === tile) out.push([c, r]) }))
  return out
}

/** The tile this stage's trails are paved with — read off the map rather than hardcoded, because the trail
 *  tile comes from the zone's palette and a season is free to pave differently. It is the commonest ground
 *  tile that is neither the floor nor the water nor the deck. */
const trailTile = (stage: ReturnType<typeof build>): string => {
  const tally = new Map<string, number>()
  for (const t of stage.ground.flat()) tally.set(t, (tally.get(t) ?? 0) + 1)
  const floor = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0]
  const rest = [...tally.entries()].filter(([t]) => t !== floor && t !== 'water' && t !== 'bridge')
  return rest.sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
}

/** Trees averaged over several SEEDED maps — one map says nothing about a density, and the seeds make the
 *  average reproducible so the band below is a real bound rather than a lucky one. */
const meanTrees = (layout: ForestLayout, nature: NatureDensity, runs = 5) => {
  let total = 0
  for (let seed = 1; seed <= runs; seed++) total += build(layout, nature, seed).trees.length
  return total / runs
}

describe('every canopy layout builds a navigable forest', () => {
  // A river is an OPTION on a canopy layout, not a layout of its own (ticket 47) — so the wet woodland is
  // the SAME row with `river` switched on, which is exactly how the editor asks for it.
  it.each<[string, ForestLayout, NatureDensity, Record<string, boolean> | undefined]>([
    ['woodland', 'woodland', WOODLAND, undefined],
    ['woodland + river', 'woodland', WOODLAND, { river: true }],
    ['jungle', 'jungle', JUNGLE, undefined],
  ])('%s plants trees, carves clearings and leaves a way through', (_label, layout, nature, options) => {
    const stage = build(layout, nature, 1, options)
    expect(stage.trees.length).toBeGreaterThan(0)
    // Not a solid block of forest: a real share of the map is NOT under a trunk, which is what the clearings and
    // trails are.
    const trunks = new Set(stage.trees.map(t => `${t.col},${t.row}`))
    const open = COLS * ROWS - trunks.size
    expect(open / (COLS * ROWS)).toBeGreaterThan(0.5)
    // …and the open ground is PAVED somewhere — a trail has to be visible to be a trail.
    const floor = countGround(stage, 'meadow')
    expect(floor).toBeLessThan(COLS * ROWS) // some ground is something other than the bare forest floor
  })
})

describe('the woodland was thinned by ~30%', () => {
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

describe('a path is wide enough to walk down', () => {
  // They were 2, the bottom of that range, and a 2-wide corridor with a trunk leaning into it walks like a 1-wide
  // one.

  /** For every trail cell, the narrower of its horizontal and vertical trail run — the local corridor width.
   *  Reported as the tightest PINCH on the map, because the narrowest point is what decides if you get through. */
  const trailPinch = (stage: ReturnType<typeof build>): number => {
    const tile = trailTile(stage)
    const isTrail = (c: number, r: number) =>
      r >= 0 && r < stage.rows && c >= 0 && c < stage.cols && stage.ground[r][c] === tile
    const run = (c: number, r: number, dc: number, dr: number) => {
      let n = 1
      for (let k = 1; isTrail(c + dc * k, r + dr * k); k++) n++
      for (let k = 1; isTrail(c - dc * k, r - dr * k); k++) n++
      return n
    }
    let min = Infinity
    for (let r = 0; r < stage.rows; r++) {
      for (let c = 0; c < stage.cols; c++) {
        if (!isTrail(c, r)) continue
        min = Math.min(min, Math.min(run(c, r, 1, 0), run(c, r, 0, 1)))
      }
    }
    return min
  }

  it.each([1, 2, 3, 4, 5])('seed %i never pinches a trail below 3 cells', seed => {
    expect({ seed, pinch: trailPinch(build('woodland', WOODLAND, seed)) }).toEqual({ seed, pinch: 3 })
  })
})

describe('woodland + river', () => {
  it('cuts a river through the trees and bridges it, so the wood is still one place', () => {
    const stage = build('woodland', WOODLAND, 1, { river: true })
    expect(countGround(stage, 'water')).toBeGreaterThan(0)
    // A river you cannot cross splits the forest in two — the deck is laid last so nothing plants over it.
    expect(countGround(stage, 'bridge')).toBeGreaterThan(0)
  })

  it('never plants a tree in the water — the river is carved BEFORE anything is planted', () => {
    const stage = build('woodland', WOODLAND, 1, { river: true })
    // ANY water-ground, never the single spelling. A pool lays `water_shallow` now, so an exact `=== 'water'`
    // test would have stopped catching a tree planted in a PUDDLE, which is exactly the defect this case was
    // written to catch. A guard that quietly narrows is worse than one that fails, because nothing tells you.
    const inWater = stage.trees.filter(t => (stage.ground[t.row]?.[t.col] ?? '').includes('water'))
    expect(inWater.map(t => `${t.col},${t.row}`)).toEqual([])
  })

  it('never leaves the crossing stranded — the deck is walkable whichever way it was placed', () => {
    for (const crossing of [false, true]) {
      const stage = build('woodland', WOODLAND, 4, { river: true, crossing })
      const deck = cellsOf(stage, 'bridge')
      expect(deck.length).toBeGreaterThan(0) // a river with no way over it is two maps
      expect(deck.every(([c, r]) => stage.collision[r][c] === false)).toBe(true)
    }
  })

  it('JOINS the crossing to a trail when asked — the deck touches the path network, not the trees', () => {
    // Ticket 36, his words: *"rivers need crossings connected to the paths"*. The plain bridge spans at a
    // fixed column and lands wherever that is, which in a wood is usually nowhere. With the option on, the
    // span is chosen AGAINST the trails and paved back to them, so a deck cell is always next to paving.
    //
    // These five seeds DISCRIMINATE, which is the only reason the loop is here: measured with the option
    // off, seeds 1 and 3 leave the deck stranded in the trees and 2/4/5 happen to land near a trail anyway.
    // A single seed would have passed either way and proved nothing.
    for (const seed of [1, 2, 3, 4, 5]) {
      const stage = build('woodland', WOODLAND, seed, { river: true, crossing: true })
      const deck = cellsOf(stage, 'bridge')
      const paved = new Set(cellsOf(stage, trailTile(stage)).map(([c, r]) => `${c},${r}`))
      const touching = deck.some(([c, r]) =>
        [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => paved.has(`${c + dc},${r + dr}`)))
      expect({ seed, touching }).toEqual({ seed, touching: true })
    }
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
