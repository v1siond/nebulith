/**
 * PATHS FIRST, IN THE MAPS THEMSELVES.
 *
 * Alexander, 2026-09-11, on a generated forest: *"there's no clear pathway at all, nothing that indicates
 * potential connection with other place"*, and *"these paths aren't NOT considered when making the forests, we
 * should always have paths firsts, and ensure the rest is build around it"*. His model is two numbers: *"I expect
 * maps to have an entrance and exit, sometimes it'll be the same place to enter and leave, others we must have
 * multiple pathways with different exists"*, and for a cave, *"1 exit and 3 pathways"*.
 *
 * `pathNetwork.test.ts` pins the PLAN. These pin what the three forest layouts do with it: a way out you can
 * stand on, walk to, and SEE, and a map that is unchanged when the generator serves no ways at all.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { FLAT_FLOOR, generateStage, type ForestLayout, type StageData } from '@/engine/stageGenerator'
import { groundTileColor } from '@/engine/tileset/groundColor'
import { zonePalette } from '@/engine/zones'
import { findGenerator, parseGeneratorCatalog } from '@/lib/generatorCatalog'
import { makeRng } from '@/lib/math'
import liveBody from '@/__tests__/fixtures/generators.json'

const CATALOG = parseGeneratorCatalog(liveBody)
const COLS = 40
const ROWS = 30
const ZONE = 'summer' as const
const LAYOUTS: Array<[ForestLayout]> = [['woodland'], ['jungle'], ['meadow']]
const key = (c: { col: number; row: number }) => `${c.col},${c.row}`

/** What a layout PAINTS its trails with: the colour its template serves, else the trail tile's own.
 *  The same precedence `layoutWoodland` uses, read from the same served config, so the test cannot drift
 *  from the generator the way the old oracle did (it compared against a fallback that returned GRASS, so it
 *  passed while the woodland had no visible path at all). */
const trailPaint = (layout: ForestLayout, col: number, row: number): string =>
  findGenerator(CATALOG, 'forest', layout)?.config.palette?.trail
  ?? groundTileColor(zonePalette(ZONE)!.trail, col, row)

/** A forest built from its served template, the way the editor builds it, with the ways the person picked. */
function grow(layout: ForestLayout, ways: Record<string, string> | undefined, seed = 7): StageData {
  const config = findGenerator(CATALOG, 'forest', layout)?.config
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage({
      zone: ZONE, variant: 'forest', layout, cols: COLS, rows: ROWS,
      options: ways,
      nature: config?.nature, palette: config?.palette, formation: config?.formation,
      treeMix: config?.trees, subZones: config?.subZones, crossings: config?.crossings,
    })
  } finally {
    Math.random = orig
  }
}

/** Every walkable cell you can reach from where the map puts you. */
function reachable(stage: StageData): Set<string> {
  const seen = new Set<string>()
  const start = key(stage.spawn)
  const open = (c: number, r: number) => c >= 0 && r >= 0 && c < stage.cols && r < stage.rows && !stage.collision[r][c]
  if (!open(stage.spawn.col, stage.spawn.row)) return seen
  const stack = [start]
  seen.add(start)
  while (stack.length) {
    const [c, r] = stack.pop()!.split(',').map(Number)
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${c + dc},${r + dr}`
      if (open(c + dc, r + dr) && !seen.has(k)) { seen.add(k); stack.push(k) }
    }
  }
  return seen
}

describe('the ways the generator serves reach the map it builds', () => {
  it.each(LAYOUTS)('%s: a gate per exit, and a stop for the pathway no exit accounts for', layout => {
    const s = grow(layout, { exits: '3', pathways: '4' })
    expect(s.routes).toBeTruthy()
    expect(s.routes!.gates).toHaveLength(3)
    expect(s.routes!.deadEnds).toHaveLength(1)
  })

  it.each(LAYOUTS)('%s: you come in AT the entrance', layout => {
    for (let seed = 1; seed <= 8; seed++) {
      const s = grow(layout, { exits: '2', pathways: '3' }, seed)
      expect(s.spawn).toEqual(s.routes!.entrance.inside)
      expect(s.collision[s.spawn.row][s.spawn.col]).toBe(false)
    }
  })

  it.each(LAYOUTS)('%s: every gate can be stood on and walked to from the spawn', layout => {
    for (let seed = 1; seed <= 8; seed++) {
      const s = grow(layout, { exits: '4', pathways: '4' }, seed)
      const walked = reachable(s)
      for (const gate of s.routes!.gates) {
        for (const c of gate.cells) {
          expect(s.collision[c.row][c.col]).toBe(false) // a way out you cannot stand on is not a way out
          expect(walked.has(key(c))).toBe(true)
        }
      }
    }
  })

  it.each(LAYOUTS)('%s: every stop can be walked to as well', layout => {
    for (let seed = 1; seed <= 8; seed++) {
      const s = grow(layout, { exits: '1', pathways: '4' }, seed)
      const walked = reachable(s)
      for (const stop of s.routes!.deadEnds) expect(walked.has(key(stop))).toBe(true)
    }
  })
})

describe('a path is something you can SEE, not just walk', () => {
  it('a woodland paves its ways with the trail the season serves', () => {
    const s = grow('woodland', { exits: '3', pathways: '3' })
    for (const gate of s.routes!.gates) {
      const { col, row } = gate.inside
      expect(s.ground[row][col]).toBe(FLAT_FLOOR)
      expect(s.floorColors[row][col]).toBe(trailPaint('woodland', col, row))
    }
  })

  it('a jungle track wears the template\'s own trail tone, the whole way through', () => {
    const trail = findGenerator(CATALOG, 'forest', 'jungle')!.config.palette!.trail
    expect(trail).toBeTruthy()
    const s = grow('jungle', { exits: '2', pathways: '3' })
    const water = new Set<string>()
    s.ground.forEach((row, r) => row.forEach((g, c) => { if (g.includes('water') || g === 'swamp') water.add(`${c},${r}`) }))
    const tones = new Set<string | undefined>()
    for (const k of s.routes!.cells) {
      if (water.has(k)) continue
      const [c, r] = k.split(',').map(Number)
      tones.add(s.floorColors[r][c])
    }
    expect([...tones]).toEqual([trail])
  })

  it('a meadow lays every way in cobble, one tone against a floor that changes by row', () => {
    const s = grow('meadow', { exits: '3', pathways: '3' })
    const tones = new Set<string | undefined>()
    for (const k of s.routes!.cells) {
      const [c, r] = k.split(',').map(Number)
      if (s.ground[r][c] !== 'meadow') continue // a crossing deck is not the lane
      tones.add(s.floorColors[r][c])
    }
    expect(tones.size).toBe(1) // the cobble way is one colour all the way across
    // and the season gradient it crosses is NOT that colour, so the way reads as a way
    const gradient = new Set<string | undefined>()
    s.floorColors.forEach((row, r) => row.forEach((tone, c) => { if (!s.routes!.cells.has(`${c},${r}`)) gradient.add(tone) }))
    expect(gradient.size).toBeGreaterThan(1)
    expect([...tones].every(t => t !== undefined)).toBe(true)
  })
})

describe('a generator that serves no ways builds exactly the map it always did', () => {
  const shape = (s: StageData) => JSON.stringify({ g: s.ground, c: s.collision, f: s.floorColors, t: s.trees, p: s.props })

  it.each(LAYOUTS)('%s: no plan, and nothing moves', layout => {
    const before = grow(layout, undefined, 5)
    const after = grow(layout, {}, 5)
    expect(before.routes).toBeNull()
    expect(after.routes).toBeNull()
    expect(shape(after)).toBe(shape(before))
    // and the spawn still comes from the old chain, not from an entrance that was never planned
    expect(before.collision[before.spawn.row][before.spawn.col]).toBe(false)
  })
})
