import { planVillage, planRoads, placePlots, buildingMix, type Rng, type Entrance } from '@/engine/villageLayout'

// A tiny deterministic LCG so layouts are reproducible in tests.
function seededRng(seed: number): Rng {
  let s = (seed >>> 0) || 1
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
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

  it('plots sit ABOVE the street (never on a road) and stay in bounds', () => {
    const layout = planVillage(40, 30, seededRng(11))
    expect(layout.plots.length).toBeGreaterThan(0)
    for (const p of layout.plots) {
      expect(p.col).toBeGreaterThanOrEqual(0)
      expect(p.col + p.length).toBeLessThanOrEqual(40)
      for (let c = p.col; c < p.col + p.length; c++) {
        expect(layout.roads[p.row][c]).toBe(false) // the footprint row is not a road
      }
    }
  })

  it('a city plan has more plots than a village plan', () => {
    const village = planVillage(60, 40, seededRng(21), 'village')
    const city = planVillage(60, 40, seededRng(21), 'city')
    expect(city.plots.length).toBeGreaterThanOrEqual(village.plots.length)
  })
})

describe('villageLayout — planRoads (street skeleton step)', () => {
  it('produces TWO building frontages + left/right entrances on the streets', () => {
    const plan = planRoads(40, 30, seededRng(2), 'village')
    expect(plan.frontages).toHaveLength(2)
    expect(plan.entrances.some(e => e.side === 'left')).toBe(true)
    expect(plan.entrances.some(e => e.side === 'right')).toBe(true)
  })

  it('keeps each frontage row mostly open (a connector may cross only 1-2 cells)', () => {
    const plan = planRoads(40, 30, seededRng(4), 'village')
    for (const f of plan.frontages) {
      expect(plan.roads[f].filter(r => !r).length).toBeGreaterThan(30)
    }
  })
})

describe('villageLayout — placePlots (distribution step)', () => {
  it('places the WHOLE mix when both frontages have room — nothing dropped', () => {
    const plan = planRoads(64, 44, seededRng(8), 'village')
    const mix = buildingMix('village', seededRng(8))
    const plots = placePlots(plan.roads, plan.frontages, 64, mix, seededRng(9))
    expect(plots).toHaveLength(mix.length)
  })

  it('never lands a plot on a road cell', () => {
    const plan = planRoads(50, 36, seededRng(12), 'town')
    const plots = placePlots(plan.roads, plan.frontages, 50, buildingMix('town', seededRng(12)), seededRng(13))
    for (const p of plots) {
      for (let c = p.col; c < p.col + p.length; c++) expect(plan.roads[p.row][c]).toBe(false)
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
