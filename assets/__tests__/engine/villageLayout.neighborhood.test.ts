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
    for (const settlement of ['village', 'town', 'city'] as const) {
      const { roads } = planRoads(COLS, ROWS, seeded(11), settlement)
      expect(bands(horizStreetRows(roads))).toBeGreaterThanOrEqual(2)
      expect(bands(vertStreetCols(roads))).toBeGreaterThanOrEqual(2)
    }
  })

  test('houses line BOTH sides of streets (all four facings appear)', () => {
    const { plots } = planVillage(COLS, ROWS, seeded(12), 'town')
    for (const f of ['south', 'north', 'east', 'west'] as const) {
      expect(plots.some(p => p.facing === f)).toBe(true)
    }
  })

  test('houses form ROWS: a frontage has a contiguous run of ≥3 tightly-spaced houses', () => {
    const { plots } = planVillage(COLS, ROWS, seeded(13), 'town')
    // group plots by the frontage LINE they share (same road-facing edge), recording their position
    // ALONG the street.
    const groups = new Map<string, number[]>()
    for (const p of plots) {
      const horiz = p.facing === 'south' || p.facing === 'north'
      const line = horiz ? `H${p.row}${p.facing}` : `V${p.col}${p.facing}`
      const along = horiz ? p.col : p.row
      ;(groups.get(line) ?? groups.set(line, []).get(line)!).push(along)
    }
    // A tidy row = a CONTIGUOUS run of ≥3 houses with small gaps (a block before an intersection;
    // big gaps across cross-streets correctly break the run).
    const MAX_TIDY_GAP = 9 // max house width(5) + max side-yard gap(2) + slack
    let bestRun = 0
    for (const along of groups.values()) {
      along.sort((a, b) => a - b)
      let run = 1
      for (let i = 1; i < along.length; i++) {
        run = along[i] - along[i - 1] <= MAX_TIDY_GAP ? run + 1 : 1
        bestRun = Math.max(bestRun, run)
      }
    }
    expect(bestRun).toBeGreaterThanOrEqual(3)
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

  test('coverage: every settlement is a populated neighborhood, and the GRID densifies village→city', () => {
    for (const s of ['village', 'town', 'city'] as const) {
      expect(planVillage(COLS, ROWS, seeded(21), s).plots.length).toBeGreaterThanOrEqual(12)
    }
    // What scales with settlement is the street GRID density (more blocks), not raw house count
    // (a denser grid uses more land for roads). City has at least as many streets as a village.
    const streets = (s: 'village' | 'town' | 'city') => {
      const { roads } = planRoads(COLS, ROWS, seeded(21), s)
      return bands(horizStreetRows(roads)) + bands(vertStreetCols(roads))
    }
    expect(streets('city')).toBeGreaterThanOrEqual(streets('village'))
  })
})
