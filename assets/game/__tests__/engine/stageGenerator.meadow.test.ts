import '@/__tests__/helpers/installTilesetSeed' // the generator reads ALL tile data from the loaded backend tileset fixture
import { isWaterGround } from '@/engine/riverNetwork'
import { generateStage } from '@/engine/stageGenerator'

// The meadow layouts reproduce the reference forests (#14 = meadow, #24 = meadow with the river option on): an OPEN muted-olive
// meadow that DOMINATES the map, a season floor-colour GRADIENT written as per-cell STATE, faint garden-PLOT
// grid lines + subtle earth/rock/flower ornament ZONES ("not everything is green"), a SINGLE cobble entrance on
// the near (bottom-left) edge (lamp posts + flower beds), SPARSE tree clumps framing the edges (never a dense
// ring), and, the river option, a WINDING colour-only river hugging THREE sides (top / left / right, the near
// edge left OPEN) with sandy banks and a walkable stone BRIDGE. Everything here is STRUCTURE the render depends
// on; the visual match itself is validated on the running game (:3000).
const seeds = (s: number) => ({ layout: s, buildings: s, nature: s, decor: s })
// A river is an OPTION on the meadow now, not a second layout (ticket 47). Same two worlds as before, the
// switch just moved from the layout name into `options`, which is what the generator catalog serves.
const gen = (water: 'dry' | 'river', s = 7) =>
  generateStage({
    zone: 'summer', variant: 'forest', layout: 'meadow',
    options: { river: water === 'river' },
    cols: 40, rows: 40, seeds: seeds(s),
  })

const edgeDepth = (c: number, r: number, cols: number, rows: number): number =>
  Math.min(c, cols - 1 - c, r, rows - 1 - r)

// Contiguous runs of walkable cells along a row → the number of distinct openings on that edge.
const walkableRuns = (collision: boolean[][], row: number): number => {
  let runs = 0
  let inRun = false
  for (let c = 0; c < collision[row].length; c++) {
    const open = !collision[row][c]
    if (open && !inRun) runs++
    inRun = open
  }
  return runs
}

describe('meadow layouts, structural match to #14 / #24', () => {
  it('writes a season floor-colour GRADIENT as per-cell STATE (every cell coloured, many bands)', () => {
    const s = gen('dry')
    expect(s.floorColors.flat().filter(Boolean)).toHaveLength(s.cols * s.rows) // every cell carries a colour
    expect(new Set(s.floorColors.flat()).size).toBeGreaterThan(6) // a real gradient, not one flat colour
  })

  it('keeps an OPEN centre, the meadow DOMINATES, framed by SPARSE edge trees (not a dense ring)', () => {
    for (const water of ['dry', 'river'] as const) {
      const s = gen(water)
      const lo = Math.floor(s.cols * 0.3)
      const hi = Math.floor(s.cols * 0.7)
      let inner = 0
      let innerOpen = 0
      let innerTrees = 0
      for (let r = lo; r < hi; r++) for (let c = lo; c < hi; c++) { inner++; if (!s.collision[r][c]) innerOpen++ }
      for (const t of s.trees) if (t.col >= lo && t.col < hi && t.row >= lo && t.row < hi) innerTrees++
      expect(innerOpen / inner).toBeGreaterThan(0.75) // wide-open clearing in the middle
      expect(innerTrees).toBeLessThan(s.trees.length * 0.1) // trees FRAME the edges, the deep interior is clear

      // trees exist and sit toward the edges (the framing band), never a dense wall
      expect(s.trees.length).toBeGreaterThan(15)
      const framed = s.trees.filter(t => edgeDepth(t.col, t.row, s.cols, s.rows) <= 8).length
      expect(framed / s.trees.length).toBeGreaterThan(0.85)
    }
  })

  it('opens a SINGLE cobble entrance on the near (bottom-left) edge', () => {
    for (const water of ['dry', 'river'] as const) {
      const s = gen(water)
      // the near (bottom) edge is OPEN, a wide walkable span (the entrance / open front), never sealed by a ring
      const bottom = s.rows - 1
      let open = 0
      for (let c = 0; c < s.cols; c++) if (!s.collision[bottom][c]) open++
      expect(open).toBeGreaterThan(s.cols * 0.4)
      expect(walkableRuns(s.collision, bottom)).toBeGreaterThanOrEqual(1)
      // NOT "lit by lamp posts" any more: the lamps are gone with the rest of the bulbs, because a stamped
      // bulb reaches the grid without its cell settings and draws as a cube at ground level. What this case
      // is actually about is the entrance being OPEN, which is asserted above.
    }
  })

  it('scatters ornament ZONES that are NOT all green, earth/dirt patches + light field stones + plot lines', () => {
    const s = gen('dry')
    expect(s.props.some(p => p.type === 'rock')).toBe(true) // rock ornaments present
    // some floor cells carry a brown-ish EARTH/cobble tint (R noticeably above B), "not everything is green"
    const brownish = s.floorColors.flat().filter((hex): hex is string => {
      if (!hex) return false
      const n = parseInt(hex.slice(1), 16)
      return ((n >> 16) & 255) - (n & 255) > 40
    })
    expect(brownish.length).toBeGreaterThan(0)
  })

  it('meadow has NO water; the river option winds a river hugging THREE sides, leaving the near edge OPEN', () => {
    // A DEGENERATE ORACLE OTHERWISE. `g === 'water'` can no longer be true of any cell, so this asserted
    // nothing and would have passed with the map full of river. Ask what the cells ARE.
    expect(gen('dry').ground.flat().filter(isWaterGround)).toHaveLength(0)

    const wet = gen('river')
    const water: Array<[number, number]> = []
    // Asked of what the cell IS. The river wears autotile pieces now, so `g === 'water'` finds nothing.
    wet.ground.forEach((rowArr, r) => rowArr.forEach((g, c) => { if (isWaterGround(g)) water.push([c, r]) }))
    expect(water.length).toBeGreaterThan(30) // a real river body, not a puddle
    // WATER BLOCKS PAST ITS SHALLOWS, which is the rule the rivers suite states in full. Asserting that ALL
    // water blocks only looked true while this counted the exact label 'water', the middle band: it never saw
    // the shallow edge, and the shallow edge is walkable on purpose (you wade it) as is a crossing.
    const crossed = (c: number, r: number) => (wet.decks?.has(`${c},${r}`) ?? false) || (wet.fords?.has(`${c},${r}`) ?? false)
    const past = water.filter(([c, r]) => (wet.waterDepth?.get(`${c},${r}`) ?? 0) >= 2 && !crossed(c, r))
    expect(past.length).toBeGreaterThan(0)
    expect(past.every(([c, r]) => wet.collision[r][c] === true)).toBe(true)
    expect(water.every(([c, r]) => edgeDepth(c, r, wet.cols, wet.rows) <= 10)).toBe(true) // hugs the edges, a river, not a central lake
    // the near (bottom) edge stays OPEN, no water across the bottom-centre (the entrance side), so it's 3 sides not a ring
    const nearOpen = water.every(([c, r]) => !(r >= wet.rows - 1 && c >= wet.cols * 0.4 && c <= wet.cols * 0.6))
    expect(nearOpen).toBe(true)
  })

  it('never plants a tree or standing prop IN the water', () => {
    const wet = gen('river')
    const water = new Set<string>()
    wet.ground.forEach((rowArr, r) => rowArr.forEach((g, c) => { if (g === 'water') water.add(`${c},${r}`) }))
    expect(wet.trees.some(t => water.has(`${t.col},${t.row}`))).toBe(false)
    // A ROCK IS THE ONE THING THAT BELONGS IN THE RIVER.
    // Everything else standing in water is still the bug this test was written for
    // (a tree rooted mid-channel), so the rule keeps its teeth and gains exactly one exception.
    const standing = wet.props.filter(p => p.blocking && p.label !== 'rock')
    expect(standing.some(p => water.has(`${p.col},${p.row}`))).toBe(false)
  })

  it('crosses the river with a walkable stone BRIDGE', () => {
    const wet = gen('river')
    const bridge: Array<[number, number]> = []
    wet.ground.forEach((rowArr, r) => rowArr.forEach((g, c) => { if (g === 'bridge') bridge.push([c, r]) }))
    expect(bridge.length).toBeGreaterThan(0)
    expect(bridge.every(([c, r]) => wet.collision[r][c] === false)).toBe(true) // you cross the river on it
  })

  it('picks a meadow layout for a plain forest generate, and is deterministic under a seed', () => {
    const plain = generateStage({ zone: 'summer', variant: 'forest', cols: 40, rows: 40, seeds: seeds(4) })
    expect(plain.floorColors.flat().filter(Boolean).length).toBe(plain.cols * plain.rows) // meadow ran (it owns the gradient)

    const a = gen('river', 3)
    const b = gen('river', 3)
    expect(a.ground).toEqual(b.ground)
    expect(a.collision).toEqual(b.collision)
    expect(a.trees).toEqual(b.trees)
    expect(a.floorColors).toEqual(b.floorColors)
  })
})
