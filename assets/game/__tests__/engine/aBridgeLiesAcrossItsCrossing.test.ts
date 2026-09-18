/**
 * A BRIDGE LIES ACROSS THE THING IT CROSSES.
 *
 * *"they aren't even in the correct direction, some of them are blocking pass instead of providing it"*
 * (2026-09-16). Those are one defect, not two. A bridge composition is authored span x 4: a side, two walking
 * rows, a side. Turn it a quarter and the two SIDES lie across the way, so the crossing you built is a wall.
 *
 * The cause was a guess. `recordCrossingStructure` read the span axis off the deck's bounding box, asking
 * which side was longer, and a crossing band is CROSSING_ROWS wide: as soon as the span matches that width
 * the run is square and the question has no answer. Measured before the fix, 13 of 20 generated bridges came
 * out turned. The pass that CUTS the crossing knows the direction exactly (`straightThrough` returns the step
 * it walked), so it records it now and nothing re-derives it.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { generateStage, type StageData } from '@/engine/stageGenerator'
import { parseGeneratorCatalog } from '@/lib/generatorCatalog'
import { makeRng } from '@/lib/math'
import liveBody from '@/__tests__/fixtures/generators.json'

const CATALOG = parseGeneratorCatalog(liveBody)
type Node = { key?: string; layout?: string; variant?: string; config?: Record<string, never>; children?: Node[] }

function served(key: string): Node {
  const stack: Node[] = [...CATALOG.flatMap(c => (c as unknown as { generators?: Node[] }).generators ?? [])]
  while (stack.length) { const n = stack.pop()!; if (n.key === key) return n; stack.push(...(n.children ?? [])) }
  throw new Error(`no served generator ${key}`)
}

function build(key: string, bridge: string, river: string, seed: number): StageData {
  const node = served(key)
  const c = node.config ?? ({} as Record<string, never>)
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage({
      zone: 'summer', variant: (node.variant ?? 'forest') as never, layout: (node.layout ?? 'woodland') as never,
      cols: 60, rows: 40, options: { exits: '2', pathways: '2', river, depth: '1', bridge },
      nature: c.nature, palette: c.palette, formation: c.formation, pathway: c.pathway, treeMix: c.trees,
      subZones: c.subZones, crossings: c.crossings, entrance: c.entrance,
    })
  } finally { Math.random = orig }
}

/** The deck cells around this bridge, which is the crossing it was put on. */
const runAround = (s: StageData, col: number, row: number): Array<[number, number]> =>
  [...(s.decks ?? [])].map(k => k.split(',').map(Number) as [number, number])
    .filter(([c, r]) => Math.abs(c - col) <= 9 && Math.abs(r - row) <= 9)

describe('every generated bridge lies along its own crossing', () => {
  const TEMPLATES = ['forest_woodland', 'forest_jungle', 'forest_meadow']
  const STYLES = ['stone', 'wood', 'planks']

  it('and never a quarter turn out of it, which is what walls a crossing shut', () => {
    const turned: string[] = []
    let checked = 0
    for (const key of TEMPLATES) {
      for (const bridge of STYLES) {
        for (const river of ['through', 'divides']) {
          for (const seed of [4, 5, 9]) {
            const s = build(key, bridge, river, seed)
            for (const comp of (s.compositions ?? []).filter(x => x.kind.startsWith('bridge'))) {
              const run = runAround(s, comp.col, comp.row)
              if (run.length === 0) continue
              const cols = new Set(run.map(x => x[0])).size
              const rows = new Set(run.map(x => x[1])).size
              const span = Number(comp.kind.split('_').pop())
              // THE SPAN AXIS IS THE ONE WHOSE EXTENT IS THE SPAN, not the one that happens to be longer.
              // A band CROSSING_ROWS wide can be wider than the span it carries.
              const alongCol = cols === span && rows !== span ? true : rows === span && cols !== span ? false : undefined
              if (alongCol === undefined) continue // genuinely square, the axis is unreadable from here
              checked++
              const says = (comp.rotation ?? 0) === 0
              if (says !== alongCol) turned.push(`${key}/${bridge}/${river}/seed${seed} ${comp.kind} rot=${comp.rotation} run=${cols}x${rows}`)
            }
          }
        }
      }
    }
    // Never let this go quiet: an empty sweep would pass while placing no bridge at all, which is the state
    // the generator was actually in before `deckRoutes` started recording them. Six of the twenty-two bridges
    // this sweep places have a run whose axis is readable from the outside; the rest are square, which is the
    // whole reason the axis has to be recorded rather than measured.
    expect(checked).toBeGreaterThanOrEqual(5)
    expect(turned).toEqual([])
  })
})
