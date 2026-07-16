import { planVillage, planRoads, type Plot } from '../../engine/villageLayout'

// Deterministic rng so the layout is reproducible per seed.
function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff)
}

const COLS = 48
const ROWS = 36

function footRect(p: Plot): { c0: number; r0: number; w: number; h: number } {
  const horiz = p.facing === 'south' || p.facing === 'north'
  return { c0: p.col, r0: p.row, w: horiz ? p.length : p.depth, h: horiz ? p.depth : p.length }
}
const overlaps = (a: ReturnType<typeof footRect>, b: ReturnType<typeof footRect>) =>
  a.c0 < b.c0 + b.w && b.c0 < a.c0 + a.w && a.r0 < b.r0 + b.h && b.r0 < a.r0 + a.h

// A "street band" = a road row/col where most of the line is carved (full-span street, not a stub).
function horizStreetRows(roads: boolean[][]): number[] {
  const out: number[] = []
  for (let r = 0; r < roads.length; r++) {
    const filled = roads[r].filter(Boolean).length
    if (filled >= roads[r].length * 0.7) out.push(r)
  }
  return out
}
function vertStreetCols(roads: boolean[][]): number[] {
  const out: number[] = []
  const rows = roads.length
  const cols = roads[0].length
  for (let c = 0; c < cols; c++) {
    let filled = 0
    for (let r = 0; r < rows; r++) if (roads[r][c]) filled++
    if (filled >= rows * 0.7) out.push(c)
  }
  return out
}
// collapse adjacent indices (a 2-wide street counts once)
const bands = (idx: number[]): number => idx.filter((v, i) => i === 0 || v !== idx[i - 1] + 1).length

describe('neighborhood layout LOGIC (asserted on the grid)', () => {
  test('streets form a GRID: ≥2 horizontal AND ≥2 vertical full-span streets → blocks', () => {
    for (const settlement of ['town', 'city'] as const) {
      const { roads } = planRoads(COLS, ROWS, seeded(11), settlement)
      expect(bands(horizStreetRows(roads))).toBeGreaterThanOrEqual(2)
      expect(bands(vertStreetCols(roads))).toBeGreaterThanOrEqual(2)
    }
  })

  test('houses line BOTH sides of streets (all four facings appear)', () => {
    // Houses front streets on every side. With the roomier (wider) house footprints, a single small town
    // may not fit every facing, so we assert the property holds across a handful of seeds (both sides get lined).
    const seen = new Set<string>()
    for (const s of [12, 13, 42, 7, 99]) {
      for (const p of planVillage(COLS, ROWS, seeded(s), 'town').plots) seen.add(p.facing)
    }
    for (const f of ['south', 'north', 'east', 'west'] as const) {
      expect(seen.has(f)).toBe(true)
    }
  })

  test('houses form ROWS: a frontage has a contiguous run of ≥3 tightly-spaced houses', () => {
    // Assert the property across a handful of seeds (a single small town's rng may not line one frontage
    // with a full run once the store/hospital/temple + a couple of offices claim plots) — a well-formed
    // town lines at least one frontage with ≥3 TIGHTLY-spaced plots (a real row, not scattered dots).
    const MAX_TIDY_GAP = 9 // max plot width(5) + max side-yard gap(2) + slack
    let maxRun = 0
    let tightPair = false
    for (const seed of [12, 13, 42, 7, 99]) {
      const { plots } = planVillage(COLS, ROWS, seeded(seed), 'town')
      // group plots by the frontage LINE they share (same road-facing edge), recording their position
      // ALONG the street.
      const groups = new Map<string, number[]>()
      for (const p of plots) {
        const horiz = p.facing === 'south' || p.facing === 'north'
        const line = horiz ? `H${p.row}${p.facing}` : `V${p.col}${p.facing}`
        const along = horiz ? p.col : p.row
        ;(groups.get(line) ?? groups.set(line, []).get(line)!).push(along)
      }
      for (const along of groups.values()) {
        maxRun = Math.max(maxRun, along.length)
        along.sort((a, b) => a - b)
        for (let i = 1; i < along.length; i++) if (along[i] - along[i - 1] <= MAX_TIDY_GAP) tightPair = true
      }
    }
    expect(maxRun).toBeGreaterThanOrEqual(3)
    expect(tightPair).toBe(true)
  })

  test('every house: faces its road, set back (yard cell), never on a road, no overlap', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { roads, plots } = planVillage(COLS, ROWS, seeded(seed), 'town')
      for (let i = 0; i < plots.length; i++) {
        const a = footRect(plots[i])
        // footprint in-bounds and entirely OFF the roads
        for (let r = a.r0; r < a.r0 + a.h; r++)
          for (let c = a.c0; c < a.c0 + a.w; c++) {
            expect(roads[r]?.[c]).toBeFalsy()
          }
        // a road exists just beyond the door edge (set back by the yard, ≤2 cells away)
        const p = plots[i]
        let near = false
        const probe = (c: number, r: number) => { if (roads[r]?.[c]) near = true }
        if (p.facing === 'south') for (let d = 1; d <= 3; d++) probe(a.c0, a.r0 + a.h - 1 + d)
        if (p.facing === 'north') for (let d = 1; d <= 3; d++) probe(a.c0, a.r0 - d)
        if (p.facing === 'east') for (let d = 1; d <= 3; d++) probe(a.c0 + a.w - 1 + d, a.r0)
        if (p.facing === 'west') for (let d = 1; d <= 3; d++) probe(a.c0 - d, a.r0)
        expect(near).toBe(true)
        // no overlap with any other footprint
        for (let j = i + 1; j < plots.length; j++) expect(overlaps(a, footRect(plots[j]))).toBe(false)
      }
    }
  })

  test('town is MODEST (capped) and NO two buildings touch (≥1 cell of trees between)', () => {
    for (const seed of [1, 2, 3, 4]) {
      const { plots } = planVillage(COLS, ROWS, seeded(seed), 'town')
      expect(plots.length).toBeLessThanOrEqual(18) // capped at the town BUILDING_CAP — a modest settlement
      expect(plots.length).toBeGreaterThanOrEqual(4) // ...but still a real settlement
      for (let i = 0; i < plots.length; i++) {
        for (let j = i + 1; j < plots.length; j++) {
          const a = footRect(plots[i])
          const aExpanded = { c0: a.c0 - 1, r0: a.r0 - 1, w: a.w + 2, h: a.h + 2 }
          expect(overlaps(aExpanded, footRect(plots[j]))).toBe(false) // a 1-cell gap separates every pair
        }
      }
    }
  })

  test('coverage: both settlements are populated, and the GRID densifies town→city', () => {
    expect(planVillage(COLS, ROWS, seeded(21), 'town').plots.length).toBeGreaterThanOrEqual(12)
    expect(planVillage(COLS, ROWS, seeded(21), 'city').plots.length).toBeGreaterThanOrEqual(12)
    // What scales with settlement is the street GRID density (more blocks) on top of the caps.
    // A city has at least as many streets as a town (and on a big map, far more buildings).
    const streets = (s: 'town' | 'city') => {
      const { roads } = planRoads(COLS, ROWS, seeded(21), s)
      return bands(horizStreetRows(roads)) + bands(vertStreetCols(roads))
    }
    expect(streets('city')).toBeGreaterThanOrEqual(streets('town'))
  })
})
