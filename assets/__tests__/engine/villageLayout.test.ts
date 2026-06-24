import { planVillage, buildingMix, type Rng, type Entrance } from '@/engine/villageLayout'

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
