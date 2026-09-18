/**
 * THE WAY OUT GOES DARK, AND THE DARK SITS ON THE GATE.
 *
 * *"all we want is to obscure the WAY of the pathway"* (2026-09-15), with his reference showing a path that
 * does not end: it disappears into blackness under the trees. That is the feature, and it is the same thing
 * the cave's black mouth does, so it is built the same way: a TALL dark block you walk into, never a flat
 * square painted on the ground, because a floor slab shows its own dark sides and reads as a pit.
 *
 * And it has to land ON the pathway. The entrance is anchored by its MOUTH, the middle of the front edge, so
 * the dark cells and the gate cells are the same cells. This is what the screenshots kept failing to settle,
 * so it is asserted on the grid instead of judged by eye.
 *
 * WHICH entrance a row gets is BACKEND DATA, on the row's own config. So the rows are walked rather than
 * listed: one per kind of place that serves an entrance at all, found by its KEY. A layout names the engine
 * BUILDER and several rows share one, so a layout can never say which row this is.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { generateStage } from '@/engine/stageGenerator'
import { parseGeneratorCatalog, type GeneratorDef } from '@/lib/generatorCatalog'
import { compositionFootprint } from '@/engine/buildingCatalog'
import { rotateFootprintOffset } from '@/engine/buildingCatalog'
import { makeRng } from '@/lib/math'
import liveBody from '@/__tests__/fixtures/generators.json'

const CATALOG = parseGeneratorCatalog(liveBody)
const TURN: Record<string, number> = { south: 0, west: 1, north: 2, east: 3 }

/** The first row of each kind of place that the backend serves an entrance for. */
const ENTRANCES: GeneratorDef[] = CATALOG
  .map(c => c.generators.find(g => g.config.entrance !== undefined))
  .filter((g): g is GeneratorDef => g !== undefined)

function build(row: GeneratorDef, seed: number) {
  const config = row.config
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage({
      zone: 'summer', variant: (row.variant ?? 'forest') as never, layout: row.layout as never, cols: 40, rows: 40,
      options: { exits: '2', pathways: '2' },
      nature: config.nature, palette: config.palette, formation: config.formation,
      treeMix: config.trees, subZones: config.subZones, crossings: config.crossings,
      settlement: config.settlement, buildings: config.buildings, entrance: config.entrance,
    })
  } finally { Math.random = orig }
}

describe.each(ENTRANCES.map(row => [row.key, row] as const))('%s', (_key, row) => {
  it.each([3, 7, 11])('puts its mouth on the gate, seed %i', seed => {
    const s = build(row, seed)
    const placed = (s.compositions ?? []).filter(c => /entrance/.test(c.kind))
    expect(placed.length).toBe(s.routes!.gates.length)

    for (const gate of s.routes!.gates) {
      const middle = gate.cells[Math.floor(gate.cells.length / 2)]
      // The entrance for this gate is the one whose MOUTH cell is the gate's middle cell.
      const found = placed.some(c => {
        const foot = compositionFootprint(c.kind)
        if (!foot) return false
        const o = rotateFootprintOffset(Math.floor((foot.w - 1) / 2), foot.h - 1, foot.w, foot.h, c.rotation ?? 0)
        return c.col + o.dx === middle.col && c.row + o.dy === middle.row
      })
      expect(found).toBe(true)
    }
  })

  it.each([3, 7, 11])('stays on the map, seed %i', seed => {
    const s = build(row, seed)
    const placed = (s.compositions ?? []).filter(x => /entrance/.test(x.kind))
    expect(placed.length).toBeGreaterThan(0) // an empty list would pass the loop below for free
    for (const c of placed) {
      const foot = compositionFootprint(c.kind)!
      // Every covered cell must be a real cell. Anchoring on the BACK edge grew a 5-deep entrance off the
      // south border, rows 39 to 43 of 40, and four fifths of the object was simply not on the world.
      for (let dx = 0; dx < foot.w; dx++) {
        for (let dy = 0; dy < foot.h; dy++) {
          const o = rotateFootprintOffset(dx, dy, foot.w, foot.h, c.rotation ?? 0)
          expect(c.col + o.dx).toBeGreaterThanOrEqual(0)
          expect(c.row + o.dy).toBeGreaterThanOrEqual(0)
          expect(c.col + o.dx).toBeLessThan(s.cols)
          expect(c.row + o.dy).toBeLessThan(s.rows)
        }
      }
    }
  })

  it('turns each entrance to its gate', () => {
    const s = build(row, 5)
    const turns = (s.compositions ?? []).filter(c => /entrance/.test(c.kind)).map(c => c.rotation ?? 0).sort()
    expect(turns).toEqual(s.routes!.gates.map(g => TURN[g.side]).sort())
  })
})
