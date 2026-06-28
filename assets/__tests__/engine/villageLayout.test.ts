import { planVillage, planRoads, placePlots, buildingMix, type Rng, type Entrance, type Plot } from '@/engine/villageLayout'
import { composeBuilding } from '@/engine/buildingComposer'

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
    const mix = buildingMix('village', seededRng(1))
    expect(mix.filter(t => t === 'store')).toHaveLength(1)
    expect(mix.filter(t => t === 'hospital')).toHaveLength(1)
    expect(mix.filter(t => t === 'house').length).toBeGreaterThanOrEqual(2)
  })

  it('cities have more buildings than towns than villages', () => {
    const v = buildingMix('village', seededRng(5)).length
    const t = buildingMix('town', seededRng(5)).length
    const c = buildingMix('city', seededRng(5)).length
    expect(t).toBeGreaterThan(v)
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

  it('footprint DEPTH equals composeBuilding(type).depth — small ground, NOT facade height', () => {
    const layout = planVillage(60, 44, seededRng(31))
    expect(layout.plots.length).toBeGreaterThan(0)
    for (const p of layout.plots) {
      const composed = composeBuilding({ type: p.type, length: p.length })
      expect(p.depth).toBe(composed.depth) // footprint depth is the composer's small ground depth…
      expect(p.depth).toBeLessThan(composed.height) // …decoupled from (and smaller than) the facade elevation
    }
  })

  it('DISTRIBUTES buildings across roads — not all on one frontage/facing', () => {
    const layout = planVillage(60, 44, seededRng(23))
    const facings = new Set(layout.plots.map(p => p.facing))
    expect(facings.size).toBeGreaterThan(1) // buildings face more than one direction → multiple roads used
  })

  it('a city plan has more plots than a village plan', () => {
    const village = planVillage(60, 40, seededRng(21), 'village')
    const city = planVillage(60, 40, seededRng(21), 'city')
    expect(city.plots.length).toBeGreaterThanOrEqual(village.plots.length)
  })
})

describe('villageLayout — planRoads (street skeleton step)', () => {
  it('produces a frontage on BOTH sides of every street (+ both sides of connectors)', () => {
    const plan = planRoads(40, 30, seededRng(2), 'village')
    // 2 streets × 2 sides = 4, plus 1 connector × 2 sides = 2 → at least 6, all facing inward.
    expect(plan.frontages.length).toBeGreaterThanOrEqual(4)
    expect(plan.frontages.some(f => f.facing === 'south')).toBe(true)
    expect(plan.frontages.some(f => f.facing === 'north')).toBe(true)
    expect(plan.entrances.some(e => e.side === 'left')).toBe(true)
    expect(plan.entrances.some(e => e.side === 'right')).toBe(true)
  })

  it('a doorLine sits one cell off its road, not on it', () => {
    const plan = planRoads(40, 30, seededRng(4), 'village')
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
    const plan = planRoads(72, 48, seededRng(8), 'village')
    const plots = placePlots(plan.roads, plan.frontages, 72, 48, seededRng(9), 'village')
    expect(plots.length).toBeGreaterThanOrEqual(10) // rows lining the streets, not a handful
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
  it('every village gets at least one store + one hospital + a house, across seeds', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const layout = planVillage(48, 34, seededRng(seed), 'village')
      expect(layout.plots.some(p => p.type === 'store')).toBe(true)
      expect(layout.plots.some(p => p.type === 'hospital')).toBe(true)
      expect(layout.plots.filter(p => p.type === 'house').length).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('villageLayout — settlement scale (town/city)', () => {
  it('a city gets more frontages than a village (capacity scales)', () => {
    const v = planRoads(50, 44, seededRng(2), 'village')
    const c = planRoads(50, 44, seededRng(2), 'city')
    expect(c.frontages.length).toBeGreaterThan(v.frontages.length)
  })

  it('connects all streets in a multi-street city plan', () => {
    const plan = planRoads(50, 50, seededRng(5), 'city')
    const reached = floodRoads(plan.roads, plan.entrances[0])
    for (const e of plan.entrances) expect(reached.has(`${e.col},${e.row}`)).toBe(true)
  })
})

describe('villageLayout — house footprints vary in size', () => {
  it('gives houses varied widths (2..n blocks), including small cottages', () => {
    const widths = new Set<number>()
    for (let s = 1; s <= 20; s++) {
      const layout = planVillage(60, 44, seededRng(s), 'village')
      for (const p of layout.plots) if (p.type === 'house') widths.add(p.length)
    }
    expect(widths.size).toBeGreaterThan(1) // not all the same width
    expect(Math.min(...[...widths])).toBeLessThanOrEqual(3) // small cottages exist
  })
})
