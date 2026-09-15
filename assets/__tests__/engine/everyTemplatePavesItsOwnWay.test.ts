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
  (served(key).config as { pathway?: { surface?: string; width?: number; edge?: number } }).pathway

function cellsOf(s: StageData, tile: string): number {
  let n = 0
  for (let row = 0; row < s.rows; row++) {
    for (let col = 0; col < s.cols; col++) if (s.ground[row][col] === tile) n++
  }
  return n
}

// One per kind of way the catalogue serves, so every definition is exercised by at least one template.
const TEMPLATES = [
  'forest_woodland', 'forest_woodland_mountain', 'forest_woodland_dense', 'forest_meadow',
  'forest_jungle', 'forest_jungle_swamp', 'forest_jungle_island', 'town_small', 'town_beach', 'city_modern',
]

describe('every template lays its pathways in the material the backend serves', () => {
  for (const key of TEMPLATES) {
    it(`${key} paves with its own surface`, () => {
      const surface = pathwayOf(key)?.surface
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

  it('and a built way is only as wide as the template says', () => {
    // A four lane street has to come out broader than a machete trail on the same size of map. This is the
    // one that `WOODLAND.pathWidth` made impossible to satisfy, whatever the data said.
    const wide = cellsOf(build('city_modern', 4), pathwayOf('city_modern')!.surface!)
    const narrow = cellsOf(build('forest_jungle', 4), pathwayOf('forest_jungle')!.surface!)
    expect(wide).toBeGreaterThan(narrow * 2)
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
    const settlements = ['town', 'town_small', 'town_forest', 'town_mountain', 'town_beach', 'town_swamp',
      'city', 'city_modern', 'city_medieval']
    for (const key of settlements) {
      const config = served(key).config as { pathway?: { surface?: string }; settlement?: { streets?: string } }
      expect({ key, streets: config.settlement?.streets }).toEqual({ key, streets: config.pathway?.surface })
    }
  })
})
