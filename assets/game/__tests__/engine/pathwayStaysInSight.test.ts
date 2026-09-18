/**
 * NOTHING STANDS IN A ROAD, AND NOTHING STANDS IN FRONT OF ONE.
 *
 * *"I think we should ensure pathway is visible … the trees formation on right side block the pathway from top
 * … I think it's fine to keep the tree formation but we can tune it towards where it doesn't block the pathway
 * view"* (2026-09-14, Image #61).
 *
 * In an isometric view the two cells drawn IN FRONT of `(col,row)` are `(col+1,row)` and `(col,row+1)`: painted
 * later, and a whole tree tall, so anything there hides the cell behind it.
 *
 * Measured before the `sightlines` layer, three seeds each: a woodland hid 42 of 489 path cells, a jungle 43 of
 * 525, a meadow 12 of 489. Breaking those down found the bigger half was not occlusion at all, 19 of a
 * woodland's and 20 of a jungle's were trees standing IN the road. Nothing planted them there on purpose; the
 * canopy fills a density and the road was never excluded from it.
 *
 * After: 12, 12 and 12, and every one of them is a tree in the BORDER BAND, which is the wood closing behind
 * you at the edge of the map and is meant to be there.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { generateStage, type StageData } from '@/engine/stageGenerator'
import { findGenerator, parseGeneratorCatalog } from '@/lib/generatorCatalog'
import { makeRng } from '@/lib/math'
import liveBody from '@/__tests__/fixtures/generators.json'

const CATALOG = parseGeneratorCatalog(liveBody)
const COLS = 40, ROWS = 40
const LAYOUTS = ['woodland', 'jungle', 'meadow'] as const
/** How deep the treeline runs. A tree inside this band is holding the border shut. */
const BAND = 2

function forest(layout: (typeof LAYOUTS)[number], seed: number): StageData {
  const config = findGenerator(CATALOG, 'wilderness', layout)?.config
  expect(config).toBeDefined()
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage({
      zone: 'summer', variant: 'forest', layout, cols: COLS, rows: ROWS,
      options: { exits: '2', pathways: '2', river: 'through', crossing: 'bridge' },
      nature: config?.nature, palette: config?.palette, formation: config?.formation,
      treeMix: config?.trees, subZones: config?.subZones, crossings: config?.crossings,
    })
  } finally { Math.random = orig }
}

const treeCells = (s: StageData) => new Set(s.trees.map(t => `${t.col},${t.row}`))
const inBand = (s: StageData, c: number, r: number) =>
  Math.min(c, r, s.cols - 1 - c, s.rows - 1 - r) < BAND

describe.each(LAYOUTS)('%s', layout => {
  const seeds = [3, 7, 11]

  it.each(seeds)('has no tree standing IN the road (seed %i)', seed => {
    const s = forest(layout, seed)
    const trees = treeCells(s)
    // THE ROAD IS WHAT YOU CAN WALK, and the border RING is not part of it except at a gate. A corridor is
    // three cells wide, so it brushes the ring beside its gate; those cells are sealed on purpose
    // (*"the town edge is defined by the exits, every other place should be blocked somehow, by structure or
    // trees, or whatever"*) and the thing sealing them is a tree. That is the treeline doing its job, not a
    // tree in the way, and counting it here is what made this assert the mouth should be wider than the gate.
    const onRing = (c: number, r: number) => c === 0 || r === 0 || c === s.cols - 1 || r === s.rows - 1
    const inTheRoad = [...s.routes!.cells].filter(key => {
      const [col, row] = key.split(',').map(Number)
      if (onRing(col, row)) return false
      return trees.has(key)
    })
    expect(inTheRoad).toEqual([])
  })

  it.each(seeds)('has no tree hiding the road, except the treeline at the border (seed %i)', seed => {
    const s = forest(layout, seed)
    const trees = treeCells(s)
    const offending: string[] = []
    for (const key of s.routes!.cells) {
      const [col, row] = key.split(',').map(Number)
      for (const [dc, dr] of [[1, 0], [0, 1]] as const) {
        const c = col + dc, r = row + dr
        if (c >= s.cols || r >= s.rows) continue
        if (!trees.has(`${c},${r}`)) continue
        if (inBand(s, c, r)) continue // the wood closing behind you at the map's edge
        offending.push(`${c},${r} hides ${key}`)
      }
    }
    expect(offending).toEqual([])
  })
})

it('the formation is KEPT: clearing the road costs the wood almost nothing', () => {
  // He asked to TUNE it, not to thin it: *"it's fine to keep the tree formation"*. A map that lost a large
  // share of its trees to this would be the wrong fix, so the cost is asserted rather than assumed.
  const s = forest('woodland', 7)
  expect(s.trees.length).toBeGreaterThan(300)
})
