/**
 * AN EXIT IS A HOLE IN THE BORDER YOU CAN WALK OUT OF.
 *
 * *"pathways don't apply correctly on none of the template generators … we get swamp forests that don't contain
 * the number of pathways and exits specified"* (2026-09-14).
 *
 * Measured before the fix, across 5 generators × 4 exits × 4 pathways × 3 seeds, 240 builds: **204 did not
 * carry the number of exits asked for.** A cave and a temple had **0 of 156 border cells walkable**, so there
 * was no way out at all and the `exits` option had never once changed a map. Two passes were the reason, both
 * running AFTER the ways were planned: the temple's *"seal the map border so the dungeon is fully enclosed"*
 * walls the whole ring, and every cave carve is guarded with `!isEdge(...)` so it stops one cell short.
 *
 * `openGates` cuts them as a LAYER in `generateStage`, after the archetype has sealed whatever it seals, so no
 * later pass can take them back and no archetype has to remember to ask.
 *
 * A FOREST had the same symptom for the opposite reason: its border was 100% walkable, all 156 cells, so you
 * left wherever you liked. His call on what closes it was a dense treeline, and `sealForestEdge` plants one
 * from the template's OWN species, broken only where a way runs through. Measured after both fixes, over every
 * combination the `E <= 2P` rule allows: **0 of 210 builds carry the wrong number of exits.**
 */
import '@/__tests__/helpers/installTilesetSeed'
import { generateStage, type StageData } from '@/engine/stageGenerator'
import { findGenerator, parseGeneratorCatalog } from '@/lib/generatorCatalog'
import { makeRng } from '@/lib/math'
import liveBody from '@/__tests__/fixtures/generators.json'

const CATALOG = parseGeneratorCatalog(liveBody)
const COLS = 40, ROWS = 40
const ENCLOSED = [
  { cat: 'forest', gen: 'forest_woodland', variant: 'forest' as const, layout: 'woodland' },
  { cat: 'forest', gen: 'forest_jungle', variant: 'forest' as const, layout: 'jungle' },
  { cat: 'forest', gen: 'forest_meadow', variant: 'forest' as const, layout: 'meadow' },
  { cat: 'cave', gen: 'cave_default', variant: 'cave' as const, layout: undefined },
  { cat: 'temple', gen: 'temple_default', variant: 'temple' as const, layout: undefined },
]

function build(c: (typeof ENCLOSED)[number], exits: number, pathways: number, seed: number): StageData {
  // `findGenerator` matches on LAYOUT. A forest is found by its layout; a cave and a temple have none and
  // take their category's only generator. Passing the generator KEY here found nothing, and every build ran
  // with no served config: no tree mix for the treeline to plant from, no nature, no sub-zones.
  const config = findGenerator(CATALOG, c.cat, c.layout)?.config
  expect(config).toBeDefined() // the fixture really does serve this one — an undefined config proves nothing
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage({
      zone: 'summer', variant: c.variant, layout: c.layout as never, cols: COLS, rows: ROWS,
      options: { exits: String(exits), pathways: String(pathways) },
      nature: config?.nature, palette: config?.palette, formation: config?.formation,
      treeMix: config?.trees, subZones: config?.subZones, crossings: config?.crossings,
    })
  } finally { Math.random = orig }
}

/** The map EDGES you can actually reach on foot from where the player starts. That is what an exit IS: the
 *  planner's gate list is what the map INTENDED, and walking it is what the player gets. */
function reachableSides(stage: StageData): Set<string> {
  const { collision, cols, rows, spawn } = stage
  const seen = new Set<string>(), sides = new Set<string>()
  const start = spawn ?? { col: Math.floor(cols / 2), row: Math.floor(rows / 2) }
  const st: Array<[number, number]> = [[start.col, start.row]]
  while (st.length) {
    const [c, r] = st.pop()!
    if (c < 0 || r < 0 || c >= cols || r >= rows) continue
    const k = `${c},${r}`
    if (seen.has(k) || collision[r]?.[c]) continue
    seen.add(k)
    if (r === 0) sides.add('north')
    if (r === rows - 1) sides.add('south')
    if (c === 0) sides.add('west')
    if (c === cols - 1) sides.add('east')
    st.push([c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1])
  }
  return sides
}

/** Walkable cells on the border ring. */
function openBorderCells(stage: StageData): number {
  const { collision, cols, rows } = stage
  let open = 0
  for (let c = 0; c < cols; c++) for (const r of [0, rows - 1]) if (!collision[r]?.[c]) open++
  for (let r = 1; r < rows - 1; r++) for (const c of [0, cols - 1]) if (!collision[r]?.[c]) open++
  return open
}

describe.each(ENCLOSED)('$gen, a map with a real border', c => {
  // A pathway spends one or two exits, so E <= 2P is the planner's own rule and 1 pathway cannot carry 4 ways
  // out. Only the combinations the model actually allows are asserted; the rest are the UI offering something
  // the model forbids, which is its own ticket.
  const allowed: Array<[number, number]> = []
  for (const e of [1, 2, 3, 4]) for (const p of [1, 2, 3, 4]) if (e <= 2 * p) allowed.push([e, p])

  it.each(allowed)('carries the %i exits asked for, on %i pathways', (exits, pathways) => {
    for (const seed of [3, 7, 11]) {
      const stage = build(c, exits, pathways, seed)
      expect(reachableSides(stage).size).toBe(exits)
    }
  })

  it('opens the border only where a way runs through, never the whole ring', () => {
    const one = openBorderCells(build(c, 1, 2, 7))
    const four = openBorderCells(build(c, 4, 2, 7))
    expect(one).toBeGreaterThan(0)          // there IS a way out — a forest used to be 156, a cave 0
    expect(four).toBeGreaterThan(one)       // …and asking for more opens more
    expect(four).toBeLessThan(COLS)         // …while the rest of the border holds
  })

  // The mouth is as wide as the PATH that runs through it, which is wider than the planner's 3-cell gate and
  // is the point: you walk out along the road. What must never happen is an opening somewhere no way goes.
  it('every reachable hole in the border belongs to a way, none of it is somewhere else', () => {
    const stage = build(c, 2, 2, 7)
    const { collision, cols, rows, spawn } = stage
    const onWay = new Set<string>(stage.routes!.cells)
    for (const g of stage.routes!.gates) {
      onWay.add(`${g.inside.col},${g.inside.row}`)
      for (const cell of g.cells) onWay.add(`${cell.col},${cell.row}`)
    }
    const seen = new Set<string>()
    const st: Array<[number, number]> = [[spawn!.col, spawn!.row]]
    while (st.length) {
      const [cc, rr] = st.pop()!
      if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue
      const k = `${cc},${rr}`
      if (seen.has(k) || collision[rr]?.[cc]) continue
      seen.add(k)
      st.push([cc + 1, rr], [cc - 1, rr], [cc, rr + 1], [cc, rr - 1])
    }
    const strays = [...seen].filter(k => {
      const [col, row] = k.split(',').map(Number)
      const border = col === 0 || row === 0 || col === cols - 1 || row === rows - 1
      return border && !onWay.has(k)
    })
    expect(strays).toEqual([])
  })
})

/**
 * A RIVER MOUTH IS NOT AN EXIT.
 *
 * *"pathway exits aren't good, I think we're counting river exits as exits, vbut they don't count towards
 * pathways exits. issue happens across all templates all variants"* (2026-09-14).
 *
 * Measured then: on every forest and every river course, asking for 2 exits gave a border with FOUR openings,
 * two gates and two places the river ran off the map. The water was already impassable, so it was never a way
 * out you could use; it was a hole in the treeline that read as one. Two causes, both fixed:
 *   · the treeline skipped a cell something already blocked, and the river channel blocks, so the band stopped
 *     at the water instead of closing over it;
 *   · the route network was spared everywhere including where it TOUCHED the border, which left a lone cell
 *     here and a three-cell run there, each counting as one more opening than was asked for.
 *
 * The rule now: inside the map the whole network is spared, and on the ring only the gates are.
 */
describe('the border shows exactly the openings that were asked for', () => {
  const FORESTS = ['woodland', 'jungle', 'meadow'] as const
  const RIVERS = ['none', 'through', 'divides', 'around'] as const

  /** A gap is a cell you can see and walk through. Water with a tree standing in it is closed: the tree blocks
   *  it and hides it, so counting water as a gap regardless of what stands on it measures nothing. */
  function openingsOn(stage: StageData): Array<{ cells: string[]; gate: boolean }> {
    const { collision, cols, rows } = stage
    const treeAt = new Set(stage.trees.map(t => `${t.col},${t.row}`))
    const gate = new Set(stage.routes!.gates.flatMap(g => g.cells.map(c => `${c.col},${c.row}`)))
    const ring: Array<[number, number]> = []
    for (let c = 0; c < cols; c++) ring.push([c, 0])
    for (let r = 1; r < rows; r++) ring.push([cols - 1, r])
    for (let c = cols - 2; c >= 0; c--) ring.push([c, rows - 1])
    for (let r = rows - 2; r > 0; r--) ring.push([0, r])

    const isGap = (c: number, r: number) => !collision[r][c] && !treeAt.has(`${c},${r}`)
    const runs: Array<{ cells: string[]; gate: boolean }> = []
    let cur: string[] = []
    for (const [c, r] of ring) {
      if (isGap(c, r)) { cur.push(`${c},${r}`); continue }
      if (cur.length) { runs.push({ cells: cur, gate: cur.some(k => gate.has(k)) }); cur = [] }
    }
    if (cur.length) runs.push({ cells: cur, gate: cur.some(k => gate.has(k)) })
    return runs
  }

  function forest(layout: (typeof FORESTS)[number], river: string, exits: number, seed = 7): StageData {
    const config = findGenerator(CATALOG, 'forest', layout)?.config
    expect(config).toBeDefined()
    const orig = Math.random
    Math.random = makeRng(seed)
    try {
      return generateStage({
        zone: 'summer', variant: 'forest', layout, cols: COLS, rows: ROWS,
        options: { exits: String(exits), pathways: '2', river, crossing: 'bridge' },
        nature: config?.nature, palette: config?.palette, formation: config?.formation,
        treeMix: config?.trees, subZones: config?.subZones, crossings: config?.crossings,
      })
    } finally { Math.random = orig }
  }

  const cases = FORESTS.flatMap(l => RIVERS.flatMap(r => [1, 2, 3, 4].map(e => [l, r, e] as const)))

  it.each(cases)('%s with a %s river, %i exits: that many openings, no more', (layout, river, exits) => {
    const openings = openingsOn(forest(layout, river, exits))
    expect(openings).toHaveLength(exits)
    // …and every one of them is a gate. A river mouth is not an opening at all any more.
    expect(openings.filter(o => !o.gate)).toEqual([])
  })

  it('a river changes nothing about how many openings a map has', () => {
    const counts = RIVERS.map(river => openingsOn(forest('woodland', river, 2)).length)
    expect(counts).toEqual([2, 2, 2, 2])
  })

  it('the treeline closes over the river where it runs off the map', () => {
    const stage = forest('woodland', 'through', 2)
    const treeAt = new Set(stage.trees.map(t => `${t.col},${t.row}`))
    const borderWater: string[] = []
    for (let c = 0; c < stage.cols; c++) for (const r of [0, stage.rows - 1]) {
      if (/water|swamp/.test(stage.ground[r][c])) borderWater.push(`${c},${r}`)
    }
    for (let r = 1; r < stage.rows - 1; r++) for (const c of [0, stage.cols - 1]) {
      if (/water|swamp/.test(stage.ground[r][c])) borderWater.push(`${c},${r}`)
    }
    expect(borderWater.length).toBeGreaterThan(0) // this seed really does run its river off the map
    for (const k of borderWater) expect(treeAt.has(k)).toBe(true)
  })
})

/**
 * EVERY MAP TYPE, not just the ones that had an edge already.
 *
 * *"the town edge is defined by the exits, every other place should be blocked somehow, by structure or trees,
 * or whatever"* (2026-09-14), after he found that *"pathways is good in forests ... is not working on towns
 * nor cities"*.
 *
 * Measured then: a 50x50 town had 196 of 196 border cells walkable and read 4 ways out whatever was asked for,
 * exactly as a forest did before its treeline. Its generator also served NO way options at all, so there was
 * nothing to ask for in the first place.
 */
describe('a town and a city carry their ways like everything else', () => {
  const SETTLEMENTS = ['town', 'city'] as const

  function settle(variant: (typeof SETTLEMENTS)[number], exits: number, pathways: number, seed: number): StageData {
    const orig = Math.random
    Math.random = makeRng(seed)
    try {
      return generateStage({
        zone: 'summer', variant, cols: 50, rows: 50,
        options: { exits: String(exits), pathways: String(pathways) },
      })
    } finally { Math.random = orig }
  }

  const walkableBorder = (s: StageData) => {
    let open = 0
    for (let c = 0; c < s.cols; c++) for (const r of [0, s.rows - 1]) if (!s.collision[r][c]) open++
    for (let r = 1; r < s.rows - 1; r++) for (const c of [0, s.cols - 1]) if (!s.collision[r][c]) open++
    return open
  }

  describe.each(SETTLEMENTS)('%s', variant => {
    it.each([1, 2, 3, 4])('carries the %i ways out it was asked for', exits => {
      for (const seed of [3, 7, 11]) {
        expect(reachableSides(settle(variant, exits, 3, seed)).size).toBe(exits)
      }
    })

    it('closes the rest of its border: it was 196 of 196 open', () => {
      const open = walkableBorder(settle(variant, 2, 3, 7))
      expect(open).toBeGreaterThan(0)   // the ways are still there
      expect(open).toBeLessThan(40)     // …and the rest of the edge is not
    })

    // The ceiling is measured off the map, not fixed at four: *"pathways in towns has higher ceiling (not
    // limited to 4, we should determine the limit from the grid size"*.
    it('takes more streets than a forest takes trails, and scales with the ask', () => {
      const few = settle(variant, 2, 2, 7).routes!.cells.size
      const many = settle(variant, 2, 6, 7).routes!.cells.size
      expect(many).toBeGreaterThan(few)
    })
  })
})
