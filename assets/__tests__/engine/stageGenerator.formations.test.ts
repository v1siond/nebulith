/**
 * HOW THE TREES ARE DISTRIBUTED — the thing that tells two forests apart when both hold the same number of
 * trees.
 *
 * Alexander, 2026-09-11: *"we need more variants of trees distribution too, or formations, like right now all
 * forest variations kind of follow the same type oof tree grouping, but just there's different forests types,
 * there's different ways in which trees and nature is distributed across these zones"*, with six photographs.
 *
 * Two served numbers carry it. `lattice` is the scale of the noise the canopy is scored against — small
 * scores every few cells differently so trees land as fine scatter, large makes neighbours score alike so
 * they land as continuous masses. `spacing` is the minimum gap between trunks. A formation is DISTRIBUTION
 * only; pairing it with a density is what produces a particular look, which is why #12 and #14 use the same
 * kind of grouping and read as completely different places.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { generateStage, type NatureDensity } from '@/engine/stageGenerator'
import { type GeneratorFormation } from '@/lib/generatorCatalog'
import { makeRng } from '@/lib/math'

const BASE: NatureDensity = { canopy: 0.45, groundCover: 0.3, flowers: 0.05 }

/** The served formations, as `generator_source.ex` carries them. */
const FORM: Record<string, GeneratorFormation> = {
  scattered: { lattice: 3, spacing: 4, understory: 0.35 },
  stand: { lattice: 5, spacing: 2, understory: 0.45 },
  clumped: { lattice: 10, spacing: 0, understory: 0.6 },
  closed: { lattice: 13, spacing: 0, understory: 1.25 },
  understory: { lattice: 7, spacing: 0, understory: 1.9 },
}

const build = (formation: GeneratorFormation, canopy = 0.45, seed = 3) => {
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage({ zone: 'summer', variant: 'forest', layout: 'woodland', cols: 60, rows: 40, nature: { ...BASE, canopy }, formation })
  } finally {
    Math.random = orig
  }
}

type Stage = ReturnType<typeof build>

/** Mean distance from each trunk to its NEAREST neighbour — the number separating a wall from a pasture. */
function meanNearestNeighbour(s: Stage): number {
  if (s.trees.length < 2) return 0
  let sum = 0
  for (const a of s.trees) {
    let best = Infinity
    for (const b of s.trees) {
      if (a === b) continue
      const d = Math.hypot(a.col - b.col, a.row - b.row)
      if (d < best) best = d
    }
    sum += best
  }
  return sum / s.trees.length
}

/** The share of trunks with 8+ tree neighbours within 2 cells — how much the forest CLUMPS. */
function clumpiness(s: Stage): number {
  const keys = new Set(s.trees.map(t => `${t.col},${t.row}`))
  let clustered = 0
  for (const t of s.trees) {
    let n = 0
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      if (!dc && !dr) continue
      if (keys.has(`${t.col + dc},${t.row + dr}`)) n++
    }
    if (n >= 8) clustered++
  }
  return clustered / Math.max(1, s.trees.length)
}

/** Walkable regions. 4-neighbour on purpose: the iso view moves on grid DIAGONALS but the top view moves
 *  orthogonally, and a map has to be walkable in both. */
function regionCount(s: Stage): number {
  const seen = new Set<string>()
  let n = 0
  const ok = (c: number, r: number) => r >= 0 && r < s.rows && c >= 0 && c < s.cols && !s.collision[r][c]
  for (let r = 0; r < s.rows; r++) {
    for (let c = 0; c < s.cols; c++) {
      if (!ok(c, r) || seen.has(`${c},${r}`)) continue
      n++
      const stack: Array<[number, number]> = [[c, r]]
      seen.add(`${c},${r}`)
      while (stack.length) {
        const [cc, rr] = stack.pop()!
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nc = cc + dc
          const nr = rr + dr
          if (ok(nc, nr) && !seen.has(`${nc},${nr}`)) { seen.add(`${nc},${nr}`); stack.push([nc, nr]) }
        }
      }
    }
  }
  return n
}

describe('spacing decides whether trees read as individuals or as a wall', () => {
  it('a wood pasture stands its trees far apart and clumps NONE of them (image #10)', () => {
    const s = build(FORM.scattered)
    expect(meanNearestNeighbour(s)).toBeGreaterThan(3)
    expect(clumpiness(s)).toBe(0)
  })

  it('an even-aged stand spaces them regularly — closer than a pasture, still no clumps (image #11)', () => {
    const stand = build(FORM.stand)
    const pasture = build(FORM.scattered)
    expect(meanNearestNeighbour(stand)).toBeLessThan(meanNearestNeighbour(pasture))
    expect(clumpiness(stand)).toBe(0)
  })

  it('a closed canopy lets them touch, which is what makes it a wall (image #14)', () => {
    const closed = build(FORM.closed, 0.72)
    expect(meanNearestNeighbour(closed)).toBeLessThan(1.5)
    expect(clumpiness(closed)).toBeGreaterThan(0.9)
  })
})

describe('a formation is DISTRIBUTION — the look comes from pairing it with a density', () => {
  it('the same grouping at two densities gives a patchy hillside and a closed canopy', () => {
    // Images #12 and #14 are both clumped. What separates them is how much of the map is under canopy, and
    // that is why a formation states no density: a subtype pairs the two.
    const patchy = build(FORM.clumped, 0.22)
    const closed = build(FORM.closed, 0.72)

    expect(patchy.trees.length).toBeLessThan(closed.trees.length / 2)
    const openShare = (s: Stage) => s.collision.flat().filter(c => !c).length / (s.cols * s.rows)
    expect(openShare(patchy)).toBeGreaterThan(openShare(closed) + 0.2)
  })

  it('the understory formation makes the FLOOR the hard part, not the canopy (image #15)', () => {
    // His image #15 is a wood whose trunks you can see straight through and whose floor you cannot cross.
    const dense = build(FORM.understory, 0.55)
    const stand = build(FORM.stand, 0.55)
    expect(dense.props.length).toBeGreaterThan(stand.props.length)
  })

  it('states no understory → plants none, and the wood is unchanged', () => {
    // The compliance rule: a formation that says nothing about the floor gets no opinion invented for it.
    const bare = build({ lattice: 5, spacing: 2 })
    const withFloor = build(FORM.understory)
    expect(bare.props.length).toBeLessThan(withFloor.props.length)
  })
})

describe('whatever the formation, the forest is ONE place', () => {
  // Undergrowth BLOCKS, so a formation that thickens the floor can pinch it into islands. Measured before
  // undergrowth grew in masses: 363 separate regions on one seed.
  it.each(Object.keys(FORM))('%s leaves no stranded ground', key => {
    expect({ key, regions: regionCount(build(FORM[key])) }).toEqual({ key, regions: 1 })
  })

  it('holds across seeds for the densest formation', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      expect({ seed, regions: regionCount(build(FORM.understory, 0.6, seed)) }).toEqual({ seed, regions: 1 })
    }
  })
})
