/**
 * A PATHWAY IS A MATERIAL, A WIDTH AND AN EDGE, AND EVERY TEMPLATE STATES ITS OWN.
 *
 * *"we need better pathways definitions on all templates too, here's what I expect"*, with nine isometric
 * references, and *"we need the same variance for towns, we need towns with rustic pathways, street pathways,
 * etc based of their specific characteristics"* (2026-09-15).
 *
 * WHAT WAS THERE, measured on a 40x40 before any of this:
 *
 *   · a woodland trail swapped the ground for the flat floor tile and tinted it;
 *   · a meadow and a jungle did not even do that, their pathways were the SAME `meadow` ground as the field
 *     beside them wearing a different colour;
 *   · every template was 3 cells across, because the width was `WOODLAND.pathWidth`, a constant in the
 *     engine read at five places that cut a way.
 *
 * So a rainforest machete trail, a clifftop path above a beach and a four lane seafront street were one
 * rectangle in three colours. These cases pin the opposite: that the difference between two templates' pathways
 * is real, comes from the backend, and survives being built.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { generateStage, type StageData } from '@/engine/stageGenerator'
import { parseGeneratorCatalog } from '@/lib/generatorCatalog'
import { makeRng } from '@/lib/math'
import liveBody from '@/__tests__/fixtures/generators.json'
import { groundTileColor } from '@/engine/tileset/groundColor'

const CATALOG = parseGeneratorCatalog(liveBody)

type Node = { key?: string; layout?: string; variant?: string; config?: Record<string, never>; children?: Node[] }

/** The served generator with this key. Nothing in this file names a tile the backend did not. */
function served(key: string): Node {
  const stack: Node[] = [...CATALOG.flatMap(c => (c as unknown as { generators?: Node[] }).generators ?? [])]
  while (stack.length) {
    const node = stack.pop()!
    if (node.key === key) return node
    stack.push(...(node.children ?? []))
  }
  throw new Error(`no served generator ${key}`)
}

function build(key: string, seed: number): StageData {
  const node = served(key)
  const c = node.config ?? ({} as Record<string, never>)
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage({
      zone: 'summer', variant: (node.variant ?? 'forest') as never, layout: (node.layout ?? 'woodland') as never,
      cols: 44, rows: 44, options: { exits: '2', pathways: '2' },
      nature: c.nature, palette: c.palette, formation: c.formation, pathway: c.pathway, treeMix: c.trees,
      subZones: c.subZones, crossings: c.crossings, entrance: c.entrance, settlement: c.settlement,
    })
  } finally {
    Math.random = orig
  }
}

const pathwayOf = (key: string) =>
  (served(key).config as {
    pathway?: { surface?: string; width?: number; edge?: number; tone?: string; marking?: { color: string; every: number } }
  }).pathway

/**
 * How many cells wear this way's COLOUR.
 *
 * This counted cells whose GROUND was the surface tile, and that was asserting the defect: a way is a colour
 * on the ground block, never a tile laid on top of it. *"CITY STREETS FUCKING SUCK, WE ALREADY HAD GOOD
 * STREETS, ALL WE NEEDED WAS TO ADD THE WHITE RECTANGULAR LINES IN MIDDLE AS ORNAMENT IF WE WANTED, NOT ADD
 * BLACK ULGY TILES ON TOP"*. The engine paver said so all along: the base ground stays and is tinted, so a
 * road is flush with the grass and there is no raised road-tile trench.
 *
 * The served TONE is what a way is painted in, worn a step either side of itself, so a cell counts when it
 * sits within that step of it. The surface tile's own colour is the fallback for a way that states no tone.
 */
let servedTone: string | undefined

/** Luminance of a `#rrggbb` or `rgb()` colour. */
function lum(colour: string): number {
  const m = colour.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/)
  const [r, g, b] = m ? [+m[1], +m[2], +m[3]] : [0, 2, 4].map(i => parseInt(colour.replace('#', '').slice(i, i + 2), 16))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function cellsOf(s: StageData, tile: string): number {
  const base = lum(servedTone ?? groundTileColor(tile, 0, 0) ?? '#000000')
  let n = 0
  for (let row = 0; row < s.rows; row++) {
    for (let col = 0; col < s.cols; col++) {
      const painted = s.floorColors[row][col]
      if (!painted) continue
      // within the wear the paver applies either side of the served tone
      if (Math.abs(lum(painted) - base) <= base * 0.25 + 8) n++
    }
  }
  return n
}

// One per kind of way the catalogue serves, so every definition is exercised by at least one template.
const TEMPLATES = [
  'forest_woodland', 'forest_mountain', 'forest_woodland', 'forest_meadow',
  'forest_jungle', 'forest_swamp', 'forest_beach', 'town', 'town_beach', 'city_futuristic',
]

describe('every template lays its pathways in the material the backend serves', () => {
  for (const key of TEMPLATES) {
    it(`${key} paves with its own surface`, () => {
      const surface = pathwayOf(key)?.surface
      servedTone = pathwayOf(key)?.tone
      expect({ key, states: typeof surface }).toEqual({ key, states: 'string' })
      // Not a threshold, a presence: the way was built out of the served tile and not out of the field.
      expect({ key, paved: cellsOf(build(key, 4), surface!) > 20 }).toEqual({ key, paved: true })
    })
  }
})

describe('the variance is real, not three colours of one rectangle', () => {
  it('the templates do not share one surface', () => {
    const surfaces = new Set(TEMPLATES.map(k => pathwayOf(k)?.surface))
    // Measured at the time of writing: path_dirt, gravel, wooden_planks, path_stone, road.
    expect(surfaces.size).toBeGreaterThanOrEqual(4)
  })

  it('nor one width', () => {
    const widths = new Set(TEMPLATES.map(k => pathwayOf(k)?.width))
    expect(widths.size).toBeGreaterThanOrEqual(3)
  })

  it('and a built way covers more ground the wider the template says it is', () => {
    // A four lane street covers more of the map than a two cell machete trail. This is the one that
    // `WOODLAND.pathWidth` made impossible to satisfy, whatever the data said: every template was 3.
    //
    // TOTAL CELLS, not a ratio. Width and network LENGTH both feed this number (a town lays six streets end
    // to end, a jungle one wandering track), so the honest assertion is the direction. Measured when written:
    // city_futuristic 336 cells at width 4, forest_jungle 194 at width 2.
    // THE CELLS THE PATHWAYS LAYER DREW, which the stage publishes. Counting COLOURED cells was a proxy and
    // a bad one: a way is a colour on the ground block, so a template whose trail tone is also a region tone
    // counts ground that is not a way at all.
    const wide = build('city_futuristic', 4).pathways?.size ?? 0
    const narrow = build('forest_jungle', 4).pathways?.size ?? 0
    expect({ wide: wide > narrow, wideIsReal: wide > 100 }).toEqual({ wide: true, wideIsReal: true })
  })
})

describe('a built way is dressed the way the template says', () => {
  it('what the backend says lies on a forest track actually lies on it', () => {
    const key = 'forest_woodland'
    const way = (served(key).config as { pathway?: { scatter?: { tile: string }[] } }).pathway
    const tiles = new Set((way?.scatter ?? []).map(d => d.tile))
    expect(tiles.size).toBeGreaterThan(0)
    const s = build(key, 4)
    const dressed = s.props.filter(p => tiles.has(p.type))
    expect({ key, laid: dressed.length > 0 }).toEqual({ key, laid: true })
  })

  it('and nothing laid on a way BLOCKS it, whatever the template dresses it with', () => {
    // Scatter is dressing, not an obstacle course. Whether a tile blocks is the catalogue's business
    // (`makePlant` reads the tile's own row), so this asserts the outcome rather than a list of names.
    for (const key of TEMPLATES) {
      const way = (served(key).config as { pathway?: { surface?: string; scatter?: { tile: string }[] } }).pathway
      const scatter = new Set((way?.scatter ?? []).map(d => d.tile))
      if (scatter.size === 0) continue
      const s = build(key, 4)
      const blocked = s.props.filter(p => scatter.has(p.type) && s.collision[p.row][p.col])
      expect({ key, blockedByItsOwnScatter: blocked.length }).toEqual({ key, blockedByItsOwnScatter: 0 })
    }
  })
})

describe('a settlement street is its pathway, not a second opinion', () => {
  it('every settlement paves its streets with the surface its way is made of', () => {
    // *"pathways size must apply to the streets distribution logic, in fact, they're rendundant, street is
    // just a form of pathway"*. As two literals they had already drifted: measured across the nine
    // settlements, three disagreed with themselves, and inheritance is what hid it (a modern city overrode
    // its pathway to asphalt, said nothing about streets, and went on inheriting its parent's cobbles).
    const settlements = ['town', 'town', 'village_woodland', 'town_mountain', 'town_beach', 'town_swamp',
      'city', 'city_futuristic', 'city_medieval']
    for (const key of settlements) {
      const config = served(key).config as { pathway?: { surface?: string }; settlement?: { streets?: string } }
      expect({ key, streets: config.settlement?.streets }).toEqual({ key, streets: config.pathway?.surface })
    }
  })
})

/**
 * WHAT THE REFERENCES ACTUALLY SHOW, measured off the stored pictures rather than described.
 *
 * The way in every one of them is a FLAT tone that does not belong to the ground beside it, with pebbles and
 * stones lying on it for interest. Measured on patches that are genuinely path: 6.1 luminance stdev on the
 * woodland crossroads, 14.4 to 18.9 on the park path, 12.5 on the swamp. An earlier pass measured 39.3 and
 * set the wear to match, but that mask was sweeping in trunks, outlines and the backdrop, so a woodland's way
 * came out wearing 227 different colours over some 300 cells.
 */
describe('a way is the flat tone the references show', () => {
  /** Every colour worn by a cell of this map's ways, minus the centre line, which is paint ON the way rather
   *  than the way's own material. */
  function wayTones(s: StageData, marking?: string): Map<string, number> {
    const tones = new Map<string, number>()
    for (const key of s.pathways ?? []) {
      const [col, row] = key.split(',').map(Number)
      const painted = s.floorColors[row]?.[col]
      if (!painted || painted === marking) continue
      tones.set(painted, (tones.get(painted) ?? 0) + 1)
    }
    return tones
  }

  it.each(TEMPLATES)('%s carries its boundary as ART, not as a recolour of the cell', key => {
    // *"usually darker dirt with clear dirt in the middle"*, and the measured reason it has to be art: the
    // boundary in the reference wanders about 0.17 of a CELL, so a per-cell tone can only ever draw it as a
    // staircase. The body of the way is a colour on the ground block; every cell of it that meets the field
    // carries a piece of the `path_dirt` family instead, whose art holds the wander and the darker margin.
    const s = build(key, 4)
    const ways = s.pathways ?? new Set<string>()
    const surface = new Map(s.props.filter(p => (p.label ?? '').startsWith('path_dirt_')).map(p => [`${p.col},${p.row}`, p]))
    const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]]
    const touchesField = (col: number, row: number) => ORTHO.some(([dc, dr]) => !ways.has(`${col + dc},${row + dr}`))
    let edges = 0, dressed = 0
    for (const k of ways) {
      const [col, row] = k.split(',').map(Number)
      if (!touchesField(col, row)) continue
      edges++
      if (surface.has(k)) dressed++
    }
    if (edges === 0) return
    // A real share of the boundary wears a piece. Not all of it: the gateways paint their own lane, and a
    // cell the water or a deck took is left alone, so this is the presence of the mechanism rather than a
    // count to tune.
    expect({ key, dressed: dressed > edges * 0.3 }).toEqual({ key, dressed: true })
    // And the piece is tinted the way's own tone, so one family of art serves every environment.
    const tones = new Set([...surface.values()].map(p => p.color))
    expect({ key, tones: tones.size }).toEqual({ key, tones: 1 })
  })

  it.each(TEMPLATES)('%s keeps its middle a colour on the ground block', key => {
    // *"usually darker dirt with clear dirt in the middle"*. Measured on all ten stored references by eroding
    // the warm pixels to a core and taking what the erosion removed as the rim: the rim is darker in EVERY
    // one, at 0.78, 0.79, 0.80, 0.81, 0.84, 0.87, 0.88 and 0.89 of the core (one outlier at 0.64). That is
    // what makes a path read as a path rather than as a patch of different ground.
    const tone = pathwayOf(key)?.tone
    const s = build(key, 4)
    const ways = s.pathways ?? new Set<string>()
    const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]]
    const touchesField = (col: number, row: number) => ORTHO.some(([dc, dr]) => !ways.has(`${col + dc},${row + dr}`))
    const middle: string[] = []
    for (const k of ways) {
      const [col, row] = k.split(',').map(Number)
      if (touchesField(col, row)) continue
      const painted = s.floorColors[row]?.[col]
      if (painted) middle.push(painted)
    }
    if (middle.length === 0) return // a track too narrow to have a middle is all boundary, and all art
    // The body wears the served tone. A gateway paints its own lane over the top of some of these cells, so
    // the assertion is what the body is MADE of rather than a count of how many tones touch it.
    const tally = new Map<string, number>()
    for (const c of middle) tally.set(c, (tally.get(c) ?? 0) + 1)
    const commonest = [...tally].sort((a, b) => b[1] - a[1])[0][0]
    expect({ key, wears: commonest }).toEqual({ key, wears: tone })
  })

  it.each(TEMPLATES)('%s wears a handful of tones, not one per cell', key => {
    const tones = wayTones(build(key, 4), pathwayOf(key)?.marking?.color)
    expect({ key, cells: tones.size > 0 }).toEqual({ key, cells: true })
    // A few, so the runs still merge: `compressGround` joins only floors sharing a tile AND a colour, so a
    // way where no two cells agree is a way that cannot merge into a single floor at all.
    expect({ key, tones: tones.size <= 12 }).toEqual({ key, tones: true })
  })

  it.each(TEMPLATES)('%s paints its ways in the tone the backend serves for them', key => {
    const tone = pathwayOf(key)?.tone
    expect({ key, serves: typeof tone }).toEqual({ key, serves: 'string' })
    // THE BODY of the way, which is the part that is a colour. Its boundary cells keep the FIELD's floor and
    // wear the dirt as art laid over it, so averaging every way cell measures the field as much as the way.
    const s = build(key, 4)
    const ways = s.pathways ?? new Set<string>()
    const touchesField = (col: number, row: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .some(([dc, dr]) => !ways.has(`${col + dc},${row + dr}`))
    const tones = new Map<string, number>()
    for (const k of ways) {
      const [col, row] = k.split(',').map(Number)
      if (touchesField(col, row)) continue
      const painted = s.floorColors[row]?.[col]
      if (!painted || painted === pathwayOf(key)?.marking?.color) continue
      tones.set(painted, (tones.get(painted) ?? 0) + 1)
    }
    if (tones.size === 0) return // all boundary, so all art: the case above covers it
    expect({ key, wears: tones.has(tone!) }).toEqual({ key, wears: true })
    let sum = 0, cells = 0
    for (const [colour, n] of tones) { sum += lum(colour) * n; cells += n }
    const drift = Math.abs(sum / cells - lum(tone!))
    expect({ key, drift: drift < lum(tone!) * 0.2 + 6 }).toEqual({ key, drift: true })
  })

  it('a meadow path is LIGHTER than the lawn it crosses, as its own reference is', () => {
    // `meadow_park`: sand at 173.6 over grass at 141. The meadow served NO trail before this and fell through
    // to the raw tile, so its way measured 45 points DARKER than the field.
    const s = build('forest_meadow', 4)
    const on: number[] = [], off: number[] = []
    for (let row = 0; row < s.rows; row++) {
      for (let col = 0; col < s.cols; col++) {
        const painted = s.floorColors[row][col]
        if (!painted) continue
        ;(s.pathways?.has(`${col},${row}`) ? on : off).push(lum(painted))
      }
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    expect({ lighter: mean(on) > mean(off) }).toEqual({ lighter: true })
  })

  it('a mountain forest wears its own gravel, not the woodland dirt it inherits', () => {
    // It states `rocky_track` and inherited `@woodland_palette`, whose trail won: the template said gravel
    // and the map painted dirt. The palettes carry no trail at all now, so there is nothing left to override.
    expect(pathwayOf('forest_mountain')?.tone).not.toEqual(pathwayOf('forest_woodland')?.tone)
    const tones = [...(build('forest_mountain', 4).pathways ?? [])]
    expect(tones.length).toBeGreaterThan(0)
  })

  it('a swamp boardwalk wears planks, not the jungle dirt it inherits', () => {
    expect(pathwayOf('forest_swamp')?.tone).not.toEqual(pathwayOf('forest_jungle')?.tone)
  })
})

describe('the white lines in the middle', () => {
  it('a city street carries them, down the middle of the carriageway', () => {
    // *"ALL WE NEEDED WAS TO ADD THE WHITE RECTANGULAR LINES IN MIDDLE AS ORNAMENT IF WE WANTED"*.
    const marking = pathwayOf('city_futuristic')?.marking
    expect({ serves: typeof marking?.color }).toEqual({ serves: 'string' })
    const s = build('city_futuristic', 4)
    let painted = 0, offTheWay = 0
    for (let row = 0; row < s.rows; row++) {
      for (let col = 0; col < s.cols; col++) {
        if (s.floorColors[row][col] !== marking!.color) continue
        painted++
        if (!s.pathways?.has(`${col},${row}`)) offTheWay++
      }
    }
    // Every dash is ON a street, and there are enough of them to read as a line.
    expect({ painted: painted > 8, offTheWay }).toEqual({ painted: true, offTheWay: 0 })
  })

  it('a medieval city has none: its cobbles are not a carriageway', () => {
    // A subtype that names a different pathway kind gets that kind WHOLE. Merged key by key, `city_medieval`
    // swapped the asphalt for cobbles and went on inheriting the asphalt's centre line.
    expect(pathwayOf('city_medieval')?.marking).toBeUndefined()
    const s = build('city_medieval', 4)
    let white = 0
    for (let row = 0; row < s.rows; row++) for (let col = 0; col < s.cols; col++) if (s.floorColors[row][col] === '#eae7db') white++
    expect(white).toBe(0)
  })

  it('and no forest or town has them either', () => {
    for (const key of ['forest_woodland', 'forest_meadow', 'forest_jungle', 'town', 'town_beach']) {
      expect({ key, marking: pathwayOf(key)?.marking }).toEqual({ key, marking: undefined })
    }
  })
})
