import { planVillage, planRoads, placePlots, buildingMix, type Rng, type Entrance, type Plot } from '@/engine/villageLayout'
import { BUILDING_DEPTH } from '@/engine/buildingCatalog'

// A tiny deterministic LCG so layouts are reproducible in tests.
function seededRng(seed: number): Rng {
  let s = (seed >>> 0) || 1
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

// The oriented GROUND footprint rect of a plot: south/north run length×DEPTH (cols×rows); east/west
// swap to depth×length. Mirrors villageLayout's `footprint` — DEPTH (small), not the facade height.
function plotRect(p: Plot): { c0: number; r0: number; w: number; h: number } {
  const horizontal = p.facing === 'south' || p.facing === 'north'
  return { c0: p.col, r0: p.row, w: horizontal ? p.length : p.depth, h: horizontal ? p.depth : p.length }
}

// The door cell — centre of the footprint's ROAD-FACING edge (mirrors stageGenerator's doorCell).
const STEP: Record<Plot['facing'], readonly [number, number]> = {
  south: [0, 1], north: [0, -1], east: [1, 0], west: [-1, 0],
}
function doorOf(p: Plot): { col: number; row: number } {
  const r = plotRect(p)
  const midCol = r.c0 + Math.floor(r.w / 2)
  const midRow = r.r0 + Math.floor(r.h / 2)
  if (p.facing === 'south') return { col: midCol, row: r.r0 + r.h - 1 }
  if (p.facing === 'north') return { col: midCol, row: r.r0 }
  if (p.facing === 'east') return { col: r.c0 + r.w - 1, row: midRow }
  return { col: r.c0, row: midRow }
}

// 4-neighbour flood fill over ROAD cells from a start — proves the streets are one network.
function floodRoads(roads: boolean[][], start: Entrance): Set<string> {
  const seen = new Set<string>()
  const stack = [{ col: start.col, row: start.row }]
  seen.add(`${start.col},${start.row}`)
  while (stack.length) {
    const { col, row } = stack.pop()!
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const c = col + dc
      const r = row + dr
      if (r < 0 || r >= roads.length || c < 0 || c >= roads[0].length) continue
      if (!roads[r][c] || seen.has(`${c},${r}`)) continue
      seen.add(`${c},${r}`)
      stack.push({ col: c, row: r })
    }
  }
  return seen
}

describe('villageLayout — buildingMix scales by settlement', () => {
  it('always includes exactly one store + one hospital, plus houses', () => {
    const mix = buildingMix('town', seededRng(1))
    expect(mix.filter(t => t === 'store')).toHaveLength(1)
    expect(mix.filter(t => t === 'hospital')).toHaveLength(1)
    expect(mix.filter(t => t === 'house').length).toBeGreaterThanOrEqual(2)
  })

  it('cities have more buildings than towns', () => {
    const t = buildingMix('town', seededRng(5)).length
    const c = buildingMix('city', seededRng(5)).length
    expect(c).toBeGreaterThan(t)
  })
})

describe('villageLayout — planVillage', () => {
  it('is deterministic for the same seed', () => {
    expect(planVillage(40, 30, seededRng(7))).toEqual(planVillage(40, 30, seededRng(7)))
  })

  it('connects EVERY entrance through one road network (flood fill)', () => {
    const layout = planVillage(44, 34, seededRng(3))
    const reached = floodRoads(layout.roads, layout.entrances[0])
    for (const e of layout.entrances) {
      expect(reached.has(`${e.col},${e.row}`)).toBe(true) // logical: you can walk between exits
    }
  })

  it('always has left + right entrances', () => {
    const layout = planVillage(40, 30, seededRng(9))
    expect(layout.entrances.some(e => e.side === 'left')).toBe(true)
    expect(layout.entrances.some(e => e.side === 'right')).toBe(true)
  })

  it('NO plot footprint (oriented by facing) touches a road, and all stay in bounds', () => {
    for (const seed of [11, 12, 13, 14, 15]) {
      const layout = planVillage(48, 36, seededRng(seed))
      expect(layout.plots.length).toBeGreaterThan(0)
      for (const p of layout.plots) {
        const r = plotRect(p)
        expect(r.c0).toBeGreaterThanOrEqual(0)
        expect(r.r0).toBeGreaterThanOrEqual(0)
        expect(r.c0 + r.w).toBeLessThanOrEqual(48)
        expect(r.r0 + r.h).toBeLessThanOrEqual(36)
        for (let row = r.r0; row < r.r0 + r.h; row++) {
          for (let col = r.c0; col < r.c0 + r.w; col++) {
            expect(layout.roads[row][col]).toBe(false)
          }
        }
      }
    }
  })

  it('NO two plot footprints overlap', () => {
    const layout = planVillage(60, 44, seededRng(17))
    const seen = new Set<string>()
    for (const p of layout.plots) {
      const r = plotRect(p)
      for (let row = r.r0; row < r.r0 + r.h; row++) {
        for (let col = r.c0; col < r.c0 + r.w; col++) {
          const key = `${col},${row}`
          expect(seen.has(key)).toBe(false)
          seen.add(key)
        }
      }
    }
  })

  it('SETS BACK each building, door facing the road (a road within setback+1 of the door edge)', () => {
    for (const seed of [11, 12, 13, 14, 15]) {
      const layout = planVillage(48, 36, seededRng(seed))
      expect(layout.plots.length).toBeGreaterThan(0)
      for (const p of layout.plots) {
        const d = doorOf(p)
        const [dc, dr] = STEP[p.facing]
        // the door edge itself is OFF the road (set back), and a road sits within 2 cells on the
        // facing side (a front-yard / driveway cell between the door and the street).
        expect(layout.roads[d.row]?.[d.col]).toBe(false)
        const roadNear =
          layout.roads[d.row + dr]?.[d.col + dc] === true ||
          layout.roads[d.row + 2 * dr]?.[d.col + 2 * dc] === true
        expect(roadNear).toBe(true)
      }
    }
  })

  it('footprint DEPTH matches the baked composition depth — a small ground footprint', () => {
    const layout = planVillage(60, 44, seededRng(31))
    expect(layout.plots.length).toBeGreaterThan(0)
    for (const p of layout.plots) {
      expect(p.depth).toBe(BUILDING_DEPTH[p.type]) // footprint depth = the composition's south-facing footprint_h
      expect(p.depth).toBeLessThanOrEqual(6) // small + roughly square — never a tall facade elevation
    }
  })

  it('DISTRIBUTES buildings across roads — not all on one frontage/facing', () => {
    const layout = planVillage(60, 44, seededRng(23))
    const facings = new Set(layout.plots.map(p => p.facing))
    expect(facings.size).toBeGreaterThan(1) // buildings face more than one direction → multiple roads used
  })

  it('a CITY is ~3-5× a TOWN — on a large map (same seed) a city has ≥3× the plots', () => {
    // On a large map the town stays capped (a modest settlement) while the city fills its much
    // denser grid up to its big cap → ~4× the buildings. ≥3× is the contract ("3-5× a town"). Sized
    // large enough (110×84) that the city SATURATES its cap, so the central plaza's one reserved lot
    // leaves the contract real headroom (a 90×70 city is frontage-pinned at exactly 3.0× — a knife-edge).
    const town = planVillage(110, 84, seededRng(21), 'town')
    const city = planVillage(110, 84, seededRng(21), 'city')
    expect(city.plots.length).toBeGreaterThanOrEqual(3 * town.plots.length)
  })
})

describe('villageLayout — planRoads (street skeleton step)', () => {
  it('produces a frontage on BOTH sides of every street (+ both sides of connectors)', () => {
    const plan = planRoads(40, 30, seededRng(2), 'town')
    // 2 streets × 2 sides = 4, plus 1 connector × 2 sides = 2 → at least 6, all facing inward.
    expect(plan.frontages.length).toBeGreaterThanOrEqual(4)
    expect(plan.frontages.some(f => f.facing === 'south')).toBe(true)
    expect(plan.frontages.some(f => f.facing === 'north')).toBe(true)
    expect(plan.entrances.some(e => e.side === 'left')).toBe(true)
    expect(plan.entrances.some(e => e.side === 'right')).toBe(true)
  })

  it('a doorLine sits one cell off its road, not on it', () => {
    const plan = planRoads(40, 30, seededRng(4), 'town')
    for (const f of plan.frontages) {
      // most of the door line is open ground (a crossing road can clip only a couple cells)
      const open = f.axis === 'col'
        ? plan.roads[f.doorLine].filter(r => !r).length
        : plan.roads.filter(row => !row[f.doorLine]).length
      expect(open).toBeGreaterThan(20)
    }
  })
})

describe('villageLayout — placePlots (distribution step)', () => {
  it('FILLS frontages into rows of lots (a populated neighborhood, with the essentials)', () => {
    const plan = planRoads(72, 48, seededRng(8), 'town')
    const plots = placePlots(plan.roads, plan.frontages, 72, 48, seededRng(9), 'town')
    expect(plots.length).toBeGreaterThanOrEqual(8) // a modest town — capped + spread, with trees between
    expect(plots.some(p => p.type === 'store')).toBe(true)
    expect(plots.some(p => p.type === 'hospital')).toBe(true)
  })

  it('never lands a plot footprint on a road cell', () => {
    const plan = planRoads(50, 36, seededRng(12), 'town')
    const plots = placePlots(plan.roads, plan.frontages, 50, 36, seededRng(13), 'town')
    for (const p of plots) {
      const r = plotRect(p)
      for (let row = r.r0; row < r.r0 + r.h; row++) {
        for (let col = r.c0; col < r.c0 + r.w; col++) expect(plan.roads[row][col]).toBe(false)
      }
    }
  })
})

describe('villageLayout — planVillage GUARANTEES the essentials', () => {
  it('every settlement gets at least one store + one hospital + a house, across seeds', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const layout = planVillage(48, 34, seededRng(seed), 'town')
      expect(layout.plots.some(p => p.type === 'store')).toBe(true)
      expect(layout.plots.some(p => p.type === 'hospital')).toBe(true)
      expect(layout.plots.filter(p => p.type === 'house').length).toBeGreaterThanOrEqual(1)
    }
  })

  it('puts the store + hospital on the TOP horizontal street, facing FRONT (south)', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const layout = planVillage(48, 36, seededRng(seed), 'town')
      const store = layout.plots.find(p => p.type === 'store')
      const hospital = layout.plots.find(p => p.type === 'hospital')
      expect(store?.facing).toBe('south') // door toward the viewer (front shows in 2D)
      expect(hospital?.facing).toBe('south')
      // both sit on the TOPMOST south frontage → no south-facing building has a smaller door line
      const southDoorLines = layout.plots.filter(p => p.facing === 'south').map(p => p.row + p.depth - 1)
      const topLine = Math.min(...southDoorLines)
      expect(store!.row + store!.depth - 1).toBe(topLine)
      expect(hospital!.row + hospital!.depth - 1).toBe(topLine)
    }
  })
})

describe('villageLayout — settlement scale (town/city)', () => {
  it('a city gets more frontages than a town (capacity scales)', () => {
    const t = planRoads(50, 44, seededRng(2), 'town')
    const c = planRoads(50, 44, seededRng(2), 'city')
    expect(c.frontages.length).toBeGreaterThan(t.frontages.length)
  })

  it('connects all streets in a multi-street city plan', () => {
    const plan = planRoads(50, 50, seededRng(5), 'city')
    const reached = floodRoads(plan.roads, plan.entrances[0])
    for (const e of plan.entrances) expect(reached.has(`${e.col},${e.row}`)).toBe(true)
  })
})

describe('villageLayout — reserves a central town SQUARE before houses', () => {
  it('returns a road-free plaza near the map centre, and NO plot footprint overlaps it', () => {
    for (const settlement of ['town', 'city'] as const) {
      for (const seed of [11, 12, 13, 14, 15]) {
        const layout = planVillage(56, 44, seededRng(seed), settlement)
        const plaza = layout.plaza
        expect(plaza).not.toBeNull()
        if (!plaza) continue

        // road-free + in bounds
        for (let r = plaza.r0; r < plaza.r0 + plaza.size; r++) {
          for (let c = plaza.c0; c < plaza.c0 + plaza.size; c++) {
            expect(c).toBeGreaterThanOrEqual(0)
            expect(r).toBeGreaterThanOrEqual(0)
            expect(c).toBeLessThan(56)
            expect(r).toBeLessThan(44)
            expect(layout.roads[r][c]).toBe(false)
          }
        }
        // central — the square sits in the middle of the map, not shoved to an edge
        expect(Math.abs(plaza.c0 + plaza.size / 2 - 28)).toBeLessThanOrEqual(56 * 0.3)
        expect(Math.abs(plaza.r0 + plaza.size / 2 - 22)).toBeLessThanOrEqual(44 * 0.3)

        // houses build AROUND it — no plot footprint lands on the reserved square
        for (const p of layout.plots) {
          const r = plotRect(p)
          for (let row = r.r0; row < r.r0 + r.h; row++) {
            for (let col = r.c0; col < r.c0 + r.w; col++) {
              const inPlaza =
                col >= plaza.c0 && col < plaza.c0 + plaza.size && row >= plaza.r0 && row < plaza.r0 + plaza.size
              expect(inPlaza).toBe(false)
            }
          }
        }
      }
    }
  })

  it('is deterministic (same plaza for the same seed)', () => {
    expect(planVillage(50, 40, seededRng(3)).plaza).toEqual(planVillage(50, 40, seededRng(3)).plaza)
  })
})

describe('villageLayout — house footprints vary in size', () => {
  it('gives houses varied widths (2..n blocks), including small cottages', () => {
    const widths = new Set<number>()
    for (let s = 1; s <= 20; s++) {
      const layout = planVillage(60, 44, seededRng(s), 'town')
      for (const p of layout.plots) if (p.type === 'house') widths.add(p.length)
    }
    expect(widths.size).toBeGreaterThan(1) // not all the same width
    expect(Math.min(...[...widths])).toBeLessThanOrEqual(3) // small cottages exist
  })
})
