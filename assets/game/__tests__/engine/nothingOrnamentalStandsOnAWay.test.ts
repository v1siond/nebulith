/**
 * AN ORNAMENT GOES AROUND THE WAY, NEVER ON IT.
 *
 * *"I DON'T WANT TO HVE ANY FUCKING FLOWERS ON TOP OF ROADS NOR APTHWAYS, THEY'RE ORNAMENTS THAT SHOULD BE
 * AROUND THE THING, NOT ON IT. AND THIS HAPPENS IN ALL FUCKING SECTIONS"* (2026-09-15).
 *
 * `nothingGrowsOnThePathway` asserts the same rule against `routes.cells`, which is the PLAN: the centreline
 * a layout is cut from. What the map publishes as its ways is `stage.pathways`, and the two are not the same
 * set. A forest's gate LANES are published and never planned, and a settlement's streets are published from
 * `layout.roads`. So the rule was being checked on a set that did not contain the cells it was failing on.
 *
 * Measured on the served catalog at seed 4, 40x40, before the fix: 7 trees standing on a woodland's ways, 4 on
 * a jungle, 8 on a meadow, 12 on a village, 18 on a town, 16 on a city. Every one was in the two-cell border
 * band, where the treeline is what holds the map's edge shut, so the answer is not to pull the trees out: it
 * is that a cell the wood closed is not a way, and the map had gone on publishing it as one.
 *
 * THE WAY'S OWN SCATTER IS NOT AN ORNAMENT. A template serves `pathway.scatter` (the pebbles down a forest
 * track) and that is the backend saying what lies on that kind of way, so it is named here and allowed.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { generateStage, type StageData } from '@/engine/stageGenerator'
import { parseGeneratorCatalog, type GeneratorDef } from '@/lib/generatorCatalog'
import { makeRng } from '@/lib/math'
import liveBody from '@/__tests__/fixtures/generators.json'

const CATALOG = parseGeneratorCatalog(liveBody)

/** Every wilderness row, plus one village, one town and one city. *"ALL FUCKING SECTIONS"*. */
const ROWS = [
  'forest_woodland', 'forest_jungle', 'forest_meadow', 'forest_swamp', 'forest_mountain',
  'forest_beach', 'forest_ruins', 'forest_desert', 'forest_volcanic',
  'village_woodland', 'town', 'city',
]

function row(key: string): GeneratorDef {
  const hit = CATALOG.flatMap(c => c.generators).find(g => g.key === key)
  if (!hit) throw new Error(`${key} is not served`)
  return hit
}

/** Build a row exactly as the editor would, from its own served config. */
function build(key: string, seed: number): StageData {
  const gen = row(key)
  const config = gen.config
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage({
      zone: 'spring', variant: gen.variant as never, layout: gen.layout as never, cols: 40, rows: 40,
      options: { exits: '2', pathways: '3', river: 'through' },
      nature: config.nature, palette: config.palette, formation: config.formation, pathway: config.pathway,
      treeMix: config.trees, subZones: config.subZones, terrain: config.terrain, regionLayout: config.regionLayout, crossings: config.crossings, entrance: config.entrance,
      settlement: config.settlement,
    })
  } finally {
    Math.random = orig
  }
}

/** What the backend says lies ON this kind of way, which is the one thing allowed to stand there. */
function servedScatter(key: string): Set<string> {
  return new Set((row(key).config.pathway?.scatter ?? []).map(s => s.tile))
}

/** Where a prop is, and what it is, for a failure message you can act on. */
const name = (p: { col: number; row: number; type: string; label?: string }) =>
  `${p.col},${p.row} ${p.label ?? p.type}`

describe.each(ROWS)('%s', key => {
  it.each([4, 9, 17])('has no TREE standing on a published way, seed %i', seed => {
    const stage = build(key, seed)
    const ways = stage.pathways ?? new Set<string>()
    // THERE HAS TO BE SOMETHING TO GET WRONG. A map with no ways, or no trees, satisfies the rule below
    // without the rule ever running, which is a test that passes whatever the generator does.
    expect(ways.size).toBeGreaterThan(0)
    expect(stage.trees.length).toBeGreaterThan(0)
    const standing = stage.trees.filter(t => ways.has(`${t.col},${t.row}`))
    expect(standing.map(t => `${t.col},${t.row} ${t.kind}`)).toEqual([])
  })

  it.each([4, 9, 17])('has no bloom or ground cover on a published way, seed %i', seed => {
    const stage = build(key, seed)
    const ways = stage.pathways ?? new Set<string>()
    expect(ways.size).toBeGreaterThan(0)
    expect(stage.props.some(p => p.grows === true)).toBe(true) // something grew somewhere, or there is nothing to keep off
    // WHAT GREW. The surface pieces that carry the dirt-to-grass boundary are laid as flat ground overlays
    // and marked `grows: false`: those ARE the way, not something growing out of it.
    const growing = stage.props.filter(p => p.grows === true && ways.has(`${p.col},${p.row}`))
    expect(growing.map(name)).toEqual([])
  })

  it('and what does stand on its way is the way itself', () => {
    const stage = build(key, 4)
    const ways = stage.pathways ?? new Set<string>()
    const scatter = servedScatter(key)
    const strangers = stage.props.filter(p => {
      if (!ways.has(`${p.col},${p.row}`)) return false
      if (scatter.has(p.label ?? p.type)) return false // the way's own served dressing
      return p.grows !== false // the surface overlay is the way; anything else is a stranger
    })
    expect(strangers.map(name)).toEqual([])
  })

  it('still dresses the map: pulling things off the ways costs only a share of what grows', () => {
    const stage = build(key, 4)
    // The wood is KEPT. A fix that emptied the map would pass every assertion above and be the wrong one.
    expect(stage.trees.length + stage.props.length).toBeGreaterThan(40)
  })
})

describe('a bloom beside a way is right, and there are some', () => {
  it('a town still has blooms, and they sit off the street rather than on it', () => {
    const stage = build('town', 4)
    const ways = stage.pathways ?? new Set<string>()
    const blooms = stage.props.filter(p => p.type === 'flower')
    const beside = blooms.filter(b =>
      [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dc, dr]) => ways.has(`${b.col + dc},${b.row + dr}`)))
    expect(blooms.length).toBeGreaterThan(0)
    expect(beside.length).toBeGreaterThan(0) // *"AROUND the thing"* is the placement that is wanted
    expect(blooms.filter(b => ways.has(`${b.col},${b.row}`))).toEqual([]) // and never on it
  })
})
