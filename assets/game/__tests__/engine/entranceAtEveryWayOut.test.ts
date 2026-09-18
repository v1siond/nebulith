/**
 * A WAY OUT LOOKS LIKE A WAY SOMEWHERE ELSE.
 *
 * *"we need a better visual indicator that 'going through this pathway goes to somewhere else', like a whuite
 * or dark light right in the exit cells … a forest entrance, a cave entrance, a town/city entrance, a park
 * entrance"* (2026-09-14, modelled against Image #62).
 *
 * WHICH entrance is BACKEND DATA, on the generator's own config beside its crossings and its trees: *"this
 * should be backend data, we receive the existing objects from backend and are correctly processed by the
 * frontend methods"*. So these assert that the engine stamps WHAT IT WAS SERVED, not a name this repo keeps.
 *
 * The rows are WALKED, not listed: one per kind of place that serves an entrance at all. A row is found by its
 * KEY, because a layout names the engine BUILDER and several rows share one.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { generateStage, type StageData } from '@/engine/stageGenerator'
import { parseGeneratorCatalog, type GeneratorDef } from '@/lib/generatorCatalog'
import { makeRng } from '@/lib/math'
import liveBody from '@/__tests__/fixtures/generators.json'

const CATALOG = parseGeneratorCatalog(liveBody)
/** The first row of each kind of place that the backend serves an entrance for. */
const CASES: GeneratorDef[] = CATALOG
  .map(c => c.generators.find(g => g.config.entrance !== undefined))
  .filter((g): g is GeneratorDef => g !== undefined)

function build(row: GeneratorDef, exits: number, entrance?: string | null): StageData {
  const config = row.config
  const orig = Math.random
  Math.random = makeRng(7)
  try {
    return generateStage({
      zone: 'summer', variant: (row.variant ?? 'forest') as never, layout: row.layout as never, cols: 40, rows: 40,
      options: { exits: String(exits), pathways: '2', river: 'through', crossing: 'bridge' },
      nature: config.nature, palette: config.palette, formation: config.formation,
      treeMix: config.trees, subZones: config.subZones, crossings: config.crossings,
      settlement: config.settlement, buildings: config.buildings,
      entrance: entrance === null ? undefined : entrance ?? config.entrance,
    })
  } finally { Math.random = orig }
}

const entrances = (s: StageData) => s.compositions.filter(c => c.kind.endsWith('_entrance'))

describe.each(CASES.map(row => [row.key, row] as const))('%s', (_key, c) => {
  it('carries the entrance its generator was SERVED, not one the engine chose', () => {
    const served = c.config.entrance
    expect(served).toBeDefined() // the backend really does say which one
    const stamped = entrances(build(c, 2))
    expect(stamped.length).toBeGreaterThan(0)
    for (const e of stamped) expect(e.kind).toBe(served)
  })

  it.each([1, 2, 3, 4])('puts exactly one at each of its %i pathways out', exits => {
    const s = build(c, exits)
    expect(entrances(s)).toHaveLength(s.routes!.gates.length)
  })

  it('turns each one to face the side its gate is on', () => {
    const s = build(c, 4)
    const TURN: Record<string, number> = { south: 0, west: 1, north: 2, east: 3 }
    // MATCHED BY ROTATION, NOT BY POSITION. This used to find each entrance by asking which one was anchored
    // ON the gate's middle cell, which assumed the anchor IS that cell. That assumption was the bug: a
    // composition anchors at its top-left, so anchoring it on the gate middle put a 7-wide entrance three
    // columns to the side and grew it off the map. The turns are what this case is about, so it compares the
    // turns, and `entranceSitsOnThePathway` is where the anchor arithmetic is pinned.
    const turned = entrances(s).map(e => e.rotation ?? 0).sort()
    expect(turned).toEqual(s.routes!.gates.map(g => TURN[g.side]).sort())
  })

  it('serves no entrance → stamps none, and the opening is simply bare', () => {
    expect(entrances(build(c, 2, null))).toEqual([])
  })
})
