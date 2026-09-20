/**
 * YOU CAN ACTUALLY WALK OUT THROUGH THE GATE.
 *
 * *"there's a black square, and there's a small tree and something like a mnushroom, all of which have
 * collissions and don't allow me to move forward"* (2026-09-15, Image #79, a meadow).
 *
 * Every one of those three was `forest_entrance`: a `path_dirt` tile recoloured near black, a `dead-tree`
 * with a `boulder` on it, and two mushrooms. It stamped at cols 14 to 16 on a gate at 12 to 14, so it sat
 * ON the way out and off to one side of it, and its pieces block.
 *
 * *"stop using tiles wrong. tiles are just like lego pieces, they're not meant to be used as standalone
 * things"*. That object was six standalone tiles dropped on a gate, which is the misuse exactly, so the
 * forests no longer name it.
 *
 * The earlier exit tests assert the COUNT of reachable sides. This one walks the map and asserts that each
 * open border cell can actually be reached, which is what he was reporting: the exit existed and he could
 * not get to it.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { generateStage, type StageData } from '@/engine/stageGenerator'
import { findGenerator, parseGeneratorCatalog } from '@/lib/generatorCatalog'
import { makeRng } from '@/lib/math'
import liveBody from '@/__tests__/fixtures/generators.json'

const CATALOG = parseGeneratorCatalog(liveBody)
const FORESTS = ['woodland', 'jungle', 'meadow'] as const

function build(layout: string, seed: number): StageData {
  const config = findGenerator(CATALOG, 'wilderness', layout)?.config
  expect(config).toBeDefined()
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage({
      zone: 'summer', variant: 'forest', layout: layout as never, cols: 40, rows: 40,
      options: { exits: '2', pathways: '2' },
      nature: config?.nature, palette: config?.palette, formation: config?.formation,
      treeMix: config?.trees, subZones: config?.subZones, terrain: config?.terrain, regionLayout: config?.regionLayout, crossings: config?.crossings,
    })
  } finally { Math.random = orig }
}

/** Every cell you can stand on, walking from the spawn. */
function reachable(s: StageData): Set<string> {
  const seen = new Set<string>()
  const start = s.spawn ?? { col: Math.floor(s.cols / 2), row: Math.floor(s.rows / 2) }
  const stack: Array<[number, number]> = [[start.col, start.row]]
  while (stack.length) {
    const [c, r] = stack.pop()!
    if (c < 0 || r < 0 || c >= s.cols || r >= s.rows) continue
    const k = `${c},${r}`
    if (seen.has(k) || s.collision[r]?.[c]) continue
    seen.add(k)
    stack.push([c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1])
  }
  return seen
}

/** The walkable cells on the border ring: the map's openings. */
function openings(s: StageData): string[] {
  const out: string[] = []
  for (let c = 0; c < s.cols; c++) {
    if (!s.collision[0][c]) out.push(`${c},0`)
    if (!s.collision[s.rows - 1][c]) out.push(`${c},${s.rows - 1}`)
  }
  for (let r = 0; r < s.rows; r++) {
    if (!s.collision[r][0]) out.push(`0,${r}`)
    if (!s.collision[r][s.cols - 1]) out.push(`${s.cols - 1},${r}`)
  }
  return out
}

describe.each(FORESTS)('%s', layout => {
  it.each([3, 7, 11])('can walk to every opening in its border, seed %i', seed => {
    const s = build(layout, seed)
    const walkable = reachable(s)
    const stranded = openings(s).filter(k => !walkable.has(k))
    expect(stranded).toEqual([])
  })

  it.each([3, 7, 11])('stamps no standalone entrance tiles on its gates, seed %i', seed => {
    const s = build(layout, seed)
    // The six tiles that object dropped on a gate. A wood grows trees and mushrooms all over, so this checks
    // the gate CELLS specifically, which is where they were standing.
    //
    // THE RIVER IS NOT A THING SOMEBODY PUT THERE. A creek that runs off the map can leave through the same
    // cells a gate was cut in, and the water layer paints its film over them. That film is the terrain, it is
    // flat and it blocks nothing, and `sealMapEdge` already states that a river mouth is not a way out. The
    // subject here is an OBJECT dropped on a gate, so the water is named and skipped rather than counted as
    // one. Whether you can walk out of such a gate is the sibling case above, which walks the map.
    const gateCells = new Set((s.routes?.gates ?? []).flatMap(g => g.cells.map(c => `${c.col},${c.row}`)))
    const laidByTheWater = (label: string | undefined): boolean => (label ?? '').includes('water')
    const onGate = [
      ...s.trees.filter(t => gateCells.has(`${t.col},${t.row}`)).map(t => `tree ${t.col},${t.row}`),
      ...s.props
        .filter(p => gateCells.has(`${p.col},${p.row}`) && !laidByTheWater(p.label))
        .map(p => `${p.type} ${p.label ?? ''} ${p.col},${p.row}`),
    ]
    expect(onGate).toEqual([])
  })
})
