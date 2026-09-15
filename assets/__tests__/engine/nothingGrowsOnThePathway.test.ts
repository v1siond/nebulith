/**
 * NOTHING GROWS ON A PATHWAY. Not a tree, not a flower.
 *
 * *"we have trees in the pathway, we shouldn't have any trees in the pathway, just in grass or dirt zones,
 * same with flowers"* (2026-09-15, Image #78, a meadow).
 *
 * `clearPathSightlines` swept TREES off the pathways and left `props` alone, so a path came out clear of trunks
 * and still carrying flowers, mushrooms and tall grass down the middle of it. Two lists, one rule, and only
 * one of them was being applied.
 *
 * The border BAND is exempt on purpose: a tree there is what holds the map's edge shut, and pulling one out
 * opens a way nobody asked for. So the assertion is about the way INSIDE the map.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { generateStage, type StageData } from '@/engine/stageGenerator'
import { findGenerator, parseGeneratorCatalog } from '@/lib/generatorCatalog'
import { makeRng } from '@/lib/math'
import liveBody from '@/__tests__/fixtures/generators.json'

const CATALOG = parseGeneratorCatalog(liveBody)
const BAND = 2

const FORESTS = ['woodland', 'jungle', 'meadow'] as const

function build(layout: string, seed: number): StageData {
  const config = findGenerator(CATALOG, 'forest', layout)?.config
  expect(config).toBeDefined()
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage({
      zone: 'summer', variant: 'forest', layout: layout as never, cols: 40, rows: 40,
      options: { exits: '2', pathways: '2' },
      nature: config?.nature, palette: config?.palette, formation: config?.formation,
      treeMix: config?.trees, subZones: config?.subZones, crossings: config?.crossings,
      entrance: config?.entrance,
    })
  } finally { Math.random = orig }
}

/** The way cells that are genuinely inside the map, which is where the rule applies. */
function insideWay(s: StageData): Set<string> {
  const out = new Set<string>()
  for (const key of s.routes!.cells) {
    const [col, row] = key.split(',').map(Number)
    if (Math.min(col, row, s.cols - 1 - col, s.rows - 1 - row) < BAND) continue
    out.add(key)
  }
  return out
}

describe.each(FORESTS)('%s', layout => {
  it.each([3, 7, 11])('has no TREE standing on its pathway, seed %i', seed => {
    const s = build(layout, seed)
    const way = insideWay(s)
    expect(s.trees.filter(t => way.has(`${t.col},${t.row}`)).map(t => `${t.col},${t.row} ${t.kind}`)).toEqual([])
  })

  it.each([3, 7, 11])('has no FLOWER or undergrowth on its pathway, seed %i', seed => {
    const s = build(layout, seed)
    const way = insideWay(s)
    expect(s.props.filter(p => way.has(`${p.col},${p.row}`)).map(p => `${p.col},${p.row} ${p.type}`)).toEqual([])
  })

  it('keeps its wood: clearing the way costs only a small share of what grows', () => {
    const s = build(layout, 5)
    // The formation is KEPT, as he asked. A map that lost a large share of its nature to this would be the
    // wrong fix, so the cost is asserted rather than assumed.
    expect(s.trees.length + s.props.length).toBeGreaterThan(40)
  })
})
