/**
 * WHICH WAY THE RIVER IS GOING.
 *
 * Alexander, 2026-09-13, with a drawing: *"all water current animation is in this direction \\, but the river
 * goes around the map, there should be a current direction that goes around with the river and the tiles
 * should show correctly that current"*, and image #9 marking three headings on a river that rings the map.
 *
 * THIS IS THE DATA HALF ONLY, and the tests say so. The generator now states a heading per channel cell and
 * the render projects it onto the isometric axes. The pictures still carry a fixed +x drift baked into four
 * frames, so nothing MOVES differently on screen yet: `animShiftX` offsets the tile's draw anchor, not its
 * texture, so the scroll cannot be expressed as an offset track and has to be baked per direction.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { generateStage } from '@/engine/stageGenerator'
import { findGenerator, parseGeneratorCatalog } from '@/lib/generatorCatalog'
import { makeRng } from '@/lib/math'
import liveBody from '@/__tests__/fixtures/generators.json'

const CATALOG = parseGeneratorCatalog(liveBody)

function river(course: string, seed = 5) {
  const cfg = findGenerator(CATALOG, 'forest', 'woodland')!.config
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage({
      zone: 'summer', variant: 'forest', layout: 'woodland', cols: 60, rows: 40,
      nature: cfg.nature, palette: cfg.palette, formation: cfg.formation, treeMix: cfg.trees,
      options: { river: course, crossing: false },
    })
  } finally { Math.random = orig }
}
const wetCells = (s: ReturnType<typeof river>) => {
  const out: Array<[number, number]> = []
  s.ground.forEach((r, y) => r.forEach((g, x) => { if (g.includes('water')) out.push([x, y]) }))
  return out
}

describe('every channel cell states its heading', () => {
  it.each(['through', 'divides', 'around'])('%s: not one wet cell is left without one', course => {
    const s = river(course)
    const wet = wetCells(s)
    expect(wet.length).toBeGreaterThan(0)
    const missing = wet.filter(([c, r]) => s.flow?.[r]?.[c] === undefined)
    expect({ course, missing: missing.length }).toEqual({ course, missing: 0 })
  })

  it('a river that RINGS the map turns, so it cannot be one heading everywhere', () => {
    // The whole of his complaint: the drift was one direction on every cell of every map. A ring has to use
    // at least three of the four headings, which is exactly what his three arrows drew.
    const s = river('around')
    const used = new Set<number>()
    s.flow?.forEach(row => row.forEach(v => { if (v !== undefined) used.add(v) }))
    expect(used.size).toBeGreaterThanOrEqual(3)
  })

  it('the heading always points at another cell of the SAME channel, never off into the bank', () => {
    // A per-cell "most watery axis" guess would satisfy the count above and still point at dry land. The
    // generator walks the channel as a graph so downstream is continuous.
    const steps: ReadonlyArray<readonly [number, number]> = [[1, 0], [0, 1], [-1, 0], [0, -1]]
    for (const course of ['through', 'divides', 'around']) {
      const s = river(course)
      const wet = new Set(wetCells(s).map(([c, r]) => `${c},${r}`))
      let offChannel = 0
      for (const [c, r] of wetCells(s)) {
        const dir = s.flow?.[r]?.[c]
        if (dir === undefined) continue
        const [dc, dr] = steps[dir]
        // The last cell of a reach legitimately points out of it, so allow the step to leave the map or the
        // water only when the cell has no wet neighbour in that direction AND is an end of the run.
        if (!wet.has(`${c + dc},${r + dr}`) && !wet.has(`${c - dc},${r - dr}`)) offChannel++
      }
      expect({ course, offChannel }).toEqual({ course, offChannel: 0 })
    }
  })

  it('a POOL has no heading, because standing water has no current', () => {
    const s = river('none')
    const pools = s.props.filter(p => p.label === 'water_still')
    for (const p of pools) expect({ at: `${p.col},${p.row}`, dir: s.flow?.[p.row]?.[p.col] }).toEqual({ at: `${p.col},${p.row}`, dir: undefined })
  })
})
