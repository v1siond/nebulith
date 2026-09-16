/**
 * PATHS FIRST, IN THE MAPS THEMSELVES.
 *
 * The model is two numbers: and for a cave,
 *
 * `pathNetwork.test.ts` pins the PLAN. These pin what the three forest layouts do with it: a way out you can
 * stand on, walk to, and SEE, and a map that is unchanged when the generator serves no pathways at all.
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

/** What a layout PAINTS its ways with: the tone its own PATHWAY serves.
 *
 *  It read `palette.trail` and fell back to the season's trail tile, which is the model this replaced: a
 *  mountain forest asked for gravel and the woodland palette it inherits painted dirt, and a meadow served
 *  no trail at all so its park path fell through to the raw tile and came out darker than the lawn. The
 *  pathway kind carries the colour now, so the oracle reads it from the same place the generator does. */
const trailPaint = (layout: ForestLayout): string | undefined =>
  (findGenerator(CATALOG, 'forest', layout)?.config as { pathway?: { tone?: string } } | undefined)?.pathway?.tone

/** A forest built from its served template, the way the editor builds it, with the pathways the person picked. */
function grow(layout: ForestLayout, pathways: Record<string, string> | undefined, seed = 7): StageData {
  const config = findGenerator(CATALOG, 'forest', layout)?.config
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage({
      zone: ZONE, variant: 'forest', layout, cols: COLS, rows: ROWS,
      options: pathways,
      // THE PATHWAY TOO, which the editor passes and this omitted: every case below was building a forest
      // with no served way, so what it measured was the fallback rather than the map the app makes.
      nature: config?.nature, palette: config?.palette, formation: config?.formation, pathway: config?.pathway,
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

describe('the pathways the generator serves reach the map it builds', () => {
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

/** Luminance of a `#rrggbb` or `rgb()` colour. */
function lum(colour: string): number {
  const m = colour.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/)
  const [r, g, b] = m ? [+m[1], +m[2], +m[3]] : [0, 2, 4].map(i => parseInt(colour.replace('#', '').slice(i, i + 2), 16))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Is this colour the way's tone, or one of the steps the paver wears either side of it? */
const near = (painted: string | undefined, tone: string): boolean =>
  painted !== undefined && Math.abs(lum(painted) - lum(tone)) <= lum(tone) * 0.25 + 8

describe('a path is something you can SEE, not just walk', () => {
  it('a woodland paves its pathways with the tone its own template serves', () => {
    const tone = trailPaint('woodland')
    expect(typeof tone).toBe('string')
    const s = grow('woodland', { exits: '3', pathways: '3' })
    for (const gate of s.routes!.gates) {
      const { col, row } = gate.inside
      expect(s.ground[row][col]).toBe(FLAT_FLOOR)
      // The way is worn a step either side of its tone, so a gateway cell carries the tone or one of its
      // steps. What it must never be is the field's colour, which is what "a path you can SEE" means.
      expect(near(s.floorColors[row][col], tone!)).toBe(true)
    }
  })

  it('a jungle track wears the template\'s own trail tone, the whole way through', () => {
    const trail = trailPaint('jungle')
    expect(trail).toBeTruthy()
    const s = grow('jungle', { exits: '2', pathways: '3' })
    const water = new Set<string>()
    s.ground.forEach((row, r) => row.forEach((g, c) => { if (g.includes('water') || g === 'swamp') water.add(`${c},${r}`) }))
    // THE BODY of the track. Its boundary cells keep the field's floor and carry the dirt as a piece of art
    // laid over it, so reading the floor colour there measures the field, not the track.
    const ways = s.pathways ?? new Set<string>()
    const touchesField = (c: number, r: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .some(([dc, dr]) => !ways.has(`${c + dc},${r + dr}`))
    const tones = new Set<string | undefined>()
    for (const k of s.routes!.cells) {
      if (water.has(k)) continue
      const [c, r] = k.split(',').map(Number)
      if (touchesField(c, r)) continue
      tones.add(s.floorColors[r][c])
    }
    expect(tones.size).toBeGreaterThan(0)
    // Its own tone and the two steps either side of it, and nothing else: a track that wandered off its
    // material half way along is not one track.
    expect([...tones].every(t => near(t, trail!))).toBe(true)
    expect(tones.size).toBeLessThanOrEqual(4)
  })

  it('a meadow lays every way in its own tone, against a floor that changes by row', () => {
    const s = grow('meadow', { exits: '3', pathways: '3' })
    const tone = trailPaint('meadow')
    const ways = s.pathways ?? new Set<string>()
    const touchesField = (c: number, r: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .some(([dc, dr]) => !ways.has(`${c + dc},${r + dr}`))
    const tones = new Set<string | undefined>()
    for (const k of s.routes!.cells) {
      const [c, r] = k.split(',').map(Number)
      if (s.ground[r][c] !== 'meadow') continue // a crossing deck is not the lane
      if (touchesField(c, r)) continue          // the boundary is art over the field, not a floor colour
      tones.add(s.floorColors[r][c])
    }
    // A FEW tones, not one and not one per cell. It asserted exactly one, which was true of the flat cobble
    // it used to lay; measured on the references, a way is nearly flat but not dead flat (6.1 luminance
    // stdev on the woodland crossroads, 14.4 to 18.9 on the park path), so it wears its tone in steps.
    expect(tones.size).toBeGreaterThan(0)
    expect(tones.size).toBeLessThanOrEqual(4)
    expect([...tones].every(t => near(t, tone!))).toBe(true)
    // and the season gradient it crosses is NOT that colour, so the way reads as a way
    const gradient = new Set<string | undefined>()
    s.floorColors.forEach((row, r) => row.forEach((tone, c) => { if (!s.routes!.cells.has(`${c},${r}`)) gradient.add(tone) }))
    expect(gradient.size).toBeGreaterThan(1)
    expect([...tones].every(t => t !== undefined)).toBe(true)
  })
})

describe('a generator that serves no pathways builds exactly the map it always did', () => {
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
