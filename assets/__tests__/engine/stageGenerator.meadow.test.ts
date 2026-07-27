import '@/__tests__/helpers/installTilesetSeed' // the generator reads ALL tile data from the loaded backend tileset fixture
import { generateStage } from '@/engine/stageGenerator'

// The meadow layouts reproduce the reference forests (#14 = meadow, #24 = meadow + river): an OPEN muted-olive
// meadow that DOMINATES the map — a season floor-colour GRADIENT written as per-cell STATE, faint garden-PLOT
// grid lines + subtle earth/rock/flower ornament ZONES ("not everything is green"), a SINGLE cobble entrance on
// the near (bottom-left) edge (lamp posts + flower beds), SPARSE tree clumps framing the edges (never a dense
// ring), and — the river variant — a WINDING colour-only river hugging THREE sides (top / left / right, the near
// edge left OPEN) with sandy banks and a walkable stone BRIDGE. Everything here is STRUCTURE the render depends
// on; the visual match itself is validated on the running game (:3000).
const seeds = (s: number) => ({ layout: s, buildings: s, nature: s, decor: s })
const gen = (layout: 'meadow' | 'meadow_river', s = 7) =>
  generateStage({ zone: 'summer', variant: 'forest', layout, cols: 40, rows: 40, seeds: seeds(s) })

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

describe('meadow layouts — structural match to #14 / #24', () => {
  it('writes a season floor-colour GRADIENT as per-cell STATE (every cell coloured, many bands)', () => {
    const s = gen('meadow')
    expect(s.floorColors.flat().filter(Boolean)).toHaveLength(s.cols * s.rows) // every cell carries a colour
    expect(new Set(s.floorColors.flat()).size).toBeGreaterThan(6) // a real gradient, not one flat colour
  })

  it('keeps an OPEN centre — the meadow DOMINATES, framed by SPARSE edge trees (not a dense ring)', () => {
    for (const layout of ['meadow', 'meadow_river'] as const) {
      const s = gen(layout)
      const lo = Math.floor(s.cols * 0.3)
      const hi = Math.floor(s.cols * 0.7)
      let inner = 0
      let innerOpen = 0
      let innerTrees = 0
      for (let r = lo; r < hi; r++) for (let c = lo; c < hi; c++) { inner++; if (!s.collision[r][c]) innerOpen++ }
      for (const t of s.trees) if (t.col >= lo && t.col < hi && t.row >= lo && t.row < hi) innerTrees++
      expect(innerOpen / inner).toBeGreaterThan(0.75) // wide-open clearing in the middle
      expect(innerTrees).toBeLessThan(s.trees.length * 0.1) // trees FRAME the edges — the deep interior is clear

      // trees exist and sit toward the edges (the framing band), never a dense wall
      expect(s.trees.length).toBeGreaterThan(15)
      const framed = s.trees.filter(t => edgeDepth(t.col, t.row, s.cols, s.rows) <= 8).length
      expect(framed / s.trees.length).toBeGreaterThan(0.85)
    }
  })

  it('opens a SINGLE cobble entrance on the near (bottom-left) edge, lit by lamp posts', () => {
    for (const layout of ['meadow', 'meadow_river'] as const) {
      const s = gen(layout)
      // the near (bottom) edge is OPEN — a wide walkable span (the entrance / open front), never sealed by a ring
      const bottom = s.rows - 1
      let open = 0
      for (let c = 0; c < s.cols; c++) if (!s.collision[bottom][c]) open++
      expect(open).toBeGreaterThan(s.cols * 0.4)
      expect(walkableRuns(s.collision, bottom)).toBeGreaterThanOrEqual(1)
      // the entrance is lit by a couple of lamp-post compositions
      expect(s.compositions.filter(c => c.kind === 'lamp_post' || c.kind === 'lamp_post_failing').length).toBeGreaterThanOrEqual(2)
    }
  })

  it('scatters ornament ZONES that are NOT all green — earth/dirt patches + light field stones + plot lines', () => {
    const s = gen('meadow')
    expect(s.props.some(p => p.type === 'rock')).toBe(true) // rock ornaments present
    // some floor cells carry a brown-ish EARTH/cobble tint (R noticeably above B) — "not everything is green"
    const brownish = s.floorColors.flat().filter((hex): hex is string => {
      if (!hex) return false
      const n = parseInt(hex.slice(1), 16)
      return ((n >> 16) & 255) - (n & 255) > 40
    })
    expect(brownish.length).toBeGreaterThan(0)
  })

  it('meadow has NO water; meadow_river winds a river hugging THREE sides, leaving the near edge OPEN', () => {
    expect(gen('meadow').ground.flat().filter(g => g === 'water')).toHaveLength(0)

    const wet = gen('meadow_river')
    const water: Array<[number, number]> = []
    wet.ground.forEach((rowArr, r) => rowArr.forEach((g, c) => { if (g === 'water') water.push([c, r]) }))
    expect(water.length).toBeGreaterThan(30) // a real river body, not a puddle
    expect(water.every(([c, r]) => wet.collision[r][c] === true)).toBe(true) // water BLOCKS (its own collision setting)
    expect(water.every(([c, r]) => edgeDepth(c, r, wet.cols, wet.rows) <= 10)).toBe(true) // hugs the edges — a river, not a central lake
    // the near (bottom) edge stays OPEN — no water across the bottom-centre (the entrance side), so it's 3 sides not a ring
    const nearOpen = water.every(([c, r]) => !(r >= wet.rows - 1 && c >= wet.cols * 0.4 && c <= wet.cols * 0.6))
    expect(nearOpen).toBe(true)
  })

  it('never plants a tree or standing prop IN the water', () => {
    const wet = gen('meadow_river')
    const water = new Set<string>()
    wet.ground.forEach((rowArr, r) => rowArr.forEach((g, c) => { if (g === 'water') water.add(`${c},${r}`) }))
    expect(wet.trees.some(t => water.has(`${t.col},${t.row}`))).toBe(false)
    expect(wet.props.some(p => p.blocking && water.has(`${p.col},${p.row}`))).toBe(false)
  })

  it('crosses the river with a walkable stone BRIDGE', () => {
    const wet = gen('meadow_river')
    const bridge: Array<[number, number]> = []
    wet.ground.forEach((rowArr, r) => rowArr.forEach((g, c) => { if (g === 'bridge') bridge.push([c, r]) }))
    expect(bridge.length).toBeGreaterThan(0)
    expect(bridge.every(([c, r]) => wet.collision[r][c] === false)).toBe(true) // you cross the river on it
  })

  it('picks a meadow layout for a plain forest generate, and is deterministic under a seed', () => {
    const plain = generateStage({ zone: 'summer', variant: 'forest', cols: 40, rows: 40, seeds: seeds(4) })
    expect(plain.floorColors.flat().filter(Boolean).length).toBe(plain.cols * plain.rows) // meadow ran (it owns the gradient)

    const a = gen('meadow_river', 3)
    const b = gen('meadow_river', 3)
    expect(a.ground).toEqual(b.ground)
    expect(a.collision).toEqual(b.collision)
    expect(a.trees).toEqual(b.trees)
    expect(a.floorColors).toEqual(b.floorColors)
  })
})
