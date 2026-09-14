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
 * WHAT THIS DOES NOT COVER: a FOREST. Its border is 100% walkable, all 156 cells, so you leave wherever you
 * like and the count can never mean anything. Closing it is a design decision about what a forest's edge looks
 * like, and that is his to make.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { generateStage, type StageData } from '@/engine/stageGenerator'
import { findGenerator, parseGeneratorCatalog } from '@/lib/generatorCatalog'
import { makeRng } from '@/lib/math'
import liveBody from '@/__tests__/fixtures/generators.json'

const CATALOG = parseGeneratorCatalog(liveBody)
const COLS = 40, ROWS = 40
const ENCLOSED = [
  { cat: 'cave', gen: 'cave_default', variant: 'cave' as const },
  { cat: 'temple', gen: 'temple_default', variant: 'temple' as const },
]

function build(c: (typeof ENCLOSED)[number], exits: number, pathways: number, seed: number): StageData {
  const config = findGenerator(CATALOG, c.cat, c.gen)?.config
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage({
      zone: 'summer', variant: c.variant, cols: COLS, rows: ROWS,
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

  it('opens the border ONLY at its gates, never the whole ring', () => {
    const one = openBorderCells(build(c, 1, 2, 7))
    const four = openBorderCells(build(c, 4, 2, 7))
    expect(one).toBeGreaterThan(0)          // there IS a way out — it used to be 0
    expect(four).toBeGreaterThan(one)       // …and asking for more opens more
    expect(four).toBeLessThan(COLS)         // …while the rest of the border stays solid
  })
})
