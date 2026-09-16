/**
 * A RIVER IS CUT BELOW THE WALKING FLOOR.
 *
 * The first version of this file asserted that the dug count EQUALLED the count of cells whose ground is
 * `water`, and it failed at 158 against 60. The code was right and the ruler was wrong: one river is painted
 * in THREE labels (`water`, `water_shallow`, `water_deep`) by the depth bands, so counting one of them measures
 * a third of the bed. What matters is the relation, not a count: every water cell is inside the channel.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { generateStage, type StageData } from '@/engine/stageGenerator'
import { makeRng } from '@/lib/math'

const NATURE = { canopy: 0.434, groundCover: 0.2, flowers: 0.04 }
const PAL = { floor: '#6f7f4a', canopy: '#5d7340', water: '#4f93b3', waterShallow: '#8ccbe8', waterDeep: '#2a5f8a', bank: '#c1a877', trail: '#9a8a62' }

const build = (options: Record<string, string>, seed = 3) => {
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage({ zone: 'summer', variant: 'forest', layout: 'woodland', cols: 50, rows: 40, nature: NATURE, palette: PAL, options })
  } finally {
    Math.random = orig
  }
}

const dugCells = (s: StageData): Set<string> => {
  const out = new Set<string>()
  ;(s.elevation ?? []).forEach((r, row) => r.forEach((v, col) => { if (v < 0) out.add(`${col},${row}`) }))
  return out
}
const cellsWhere = (s: StageData, hit: (tile: string) => boolean): string[] => {
  const out: string[] = []
  s.ground.forEach((r, row) => r.forEach((t, col) => { if (hit(t)) out.push(`${col},${row}`) }))
  return out
}
const floor = (s: StageData): number => Math.min(...(s.elevation ?? [[0]]).flat())

describe('the river is cut below the walking floor', () => {
  it.each(['through', 'divides', 'around'])('%s: every water cell is inside the channel', course => {
    const s = build({ river: course, depth: '1' })
    const dug = dugCells(s)
    const water = cellsWhere(s, t => t.includes('water'))

    expect(water.length).toBeGreaterThan(0)
    expect(dug.size).toBeGreaterThan(0)
    // EXCEPT AT A FORD. A ford is the one stretch a river is deliberately NOT cut through: it is raised back
    // level with its banks so it can be waded, which is the definition of the word rather than an exception
    // slipped into the rule. Everything else wet stays in the channel.
    const ford = s.fords ?? new Set<string>()
    expect(water.filter(k => !dug.has(k) && !ford.has(k))).toEqual([])
    expect(floor(s)).toBe(-1)
  })

  it('the bed is painted in all three depth bands, and all three are cut', () => {
    const s = build({ river: 'divides', depth: '1' })
    const dug = dugCells(s)
    for (const label of ['water', 'water_shallow', 'water_deep']) {
      const band = cellsWhere(s, t => t === label)
      expect({ label, count: band.length > 0 }).toEqual({ label, count: true })
      expect({ label, uncut: band.filter(k => !dug.has(k)).length }).toEqual({ label, uncut: 0 })
    }
  })

  it('a CROSSING spans the channel instead of lying in it', () => {
    // The dig happens in carveChannel, before any deck is laid, so a deck cell used to keep the bed's
    // elevation and the bridge came out sunk in the water.
    const s = build({ river: 'divides', depth: '2', crossing: 'true', bridge: 'stone' })
    const dug = dugCells(s)
    const decks = cellsWhere(s, t => t === 'bridge' || t === 'wooden_planks' || t === 'path_stone' || t === 'path_dirt')
    expect(decks.filter(k => dug.has(k))).toEqual([])
  })

  it('depth 2 cuts the same bed twice as deep', () => {
    const one = build({ river: 'divides', depth: '1' })
    const two = build({ river: 'divides', depth: '2' })
    expect(dugCells(two).size).toBe(dugCells(one).size)
    expect(floor(two)).toBe(-2)
  })

  it('no river, or no depth served, is not cut at all', () => {
    expect(dugCells(build({ river: 'divides', depth: 'none' })).size).toBe(0)
    expect(dugCells(build({ river: 'none' })).size).toBe(0)
    expect(dugCells(build({})).size).toBe(0)
  })
})
