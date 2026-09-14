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
 */
import '@/__tests__/helpers/installTilesetSeed'
import { generateStage, type StageData } from '@/engine/stageGenerator'
import { findGenerator, parseGeneratorCatalog } from '@/lib/generatorCatalog'
import { makeRng } from '@/lib/math'
import liveBody from '@/__tests__/fixtures/generators.json'

const CATALOG = parseGeneratorCatalog(liveBody)
const CASES = [
  { cat: 'forest', layout: 'woodland' as const, variant: 'forest' as const },
  { cat: 'forest', layout: 'jungle' as const, variant: 'forest' as const },
  { cat: 'forest', layout: 'meadow' as const, variant: 'forest' as const },
  { cat: 'cave', layout: undefined, variant: 'cave' as const },
  { cat: 'temple', layout: undefined, variant: 'temple' as const },
]

function build(c: (typeof CASES)[number], exits: number, entrance?: string | null): StageData {
  const config = findGenerator(CATALOG, c.cat, c.layout)?.config
  expect(config).toBeDefined()
  const orig = Math.random
  Math.random = makeRng(7)
  try {
    return generateStage({
      zone: 'summer', variant: c.variant, layout: c.layout as never, cols: 40, rows: 40,
      options: { exits: String(exits), pathways: '2', river: 'through', crossing: 'bridge' },
      nature: config?.nature, palette: config?.palette, formation: config?.formation,
      treeMix: config?.trees, subZones: config?.subZones, crossings: config?.crossings,
      entrance: entrance === null ? undefined : entrance ?? config?.entrance,
    })
  } finally { Math.random = orig }
}

const entrances = (s: StageData) => s.compositions.filter(c => c.kind.endsWith('_entrance'))

describe.each(CASES)('$cat $layout', c => {
  it('carries the entrance its generator was SERVED, not one the engine chose', () => {
    const served = findGenerator(CATALOG, c.cat, c.layout)?.config.entrance
    expect(served).toBeDefined() // the backend really does say which one
    const stamped = entrances(build(c, 2))
    expect(stamped.length).toBeGreaterThan(0)
    for (const e of stamped) expect(e.kind).toBe(served)
  })

  it.each([1, 2, 3, 4])('puts exactly one at each of its %i ways out', exits => {
    const s = build(c, exits)
    expect(entrances(s)).toHaveLength(s.routes!.gates.length)
  })

  it('turns each one to face the side its gate is on', () => {
    const s = build(c, 4)
    const TURN: Record<string, number> = { south: 0, west: 1, north: 2, east: 3 }
    for (const gate of s.routes!.gates) {
      const middle = gate.cells[Math.floor(gate.cells.length / 2)]
      const at = entrances(s).find(e => e.col === middle.col && e.row === middle.row)
      expect(at).toBeDefined()
      expect(at!.rotation ?? 0).toBe(TURN[gate.side])
    }
  })

  it('serves no entrance → stamps none, and the opening is simply bare', () => {
    expect(entrances(build(c, 2, null))).toEqual([])
  })
})
