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
import { CROSSING_ROWS } from '@/engine/riverNetwork'
import { parseGeneratorCatalog } from '@/lib/generatorCatalog'
import { makeRng } from '@/lib/math'
import liveBody from '@/__tests__/fixtures/generators.json'

const CATALOG = parseGeneratorCatalog(liveBody)

/** A ground label that IS water, in the same terms the rest of the engine asks the question. */
const isWaterLabel = (label: string | undefined): boolean => !!label && /water|oasis|koi_pond/.test(label)
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
              const span = Number(comp.kind.split('_').pop())
              if (!Number.isFinite(span)) continue
              // ASK THE WATER, NOT THE BOUNDING BOX.
              //
              // This read the axis off the deck's bounding box, taking whichever side measured exactly the
              // span. That is the same guess the doc above says cannot work, one step removed: a crossing
              // band is CROSSING_ROWS wide and a deck cut on a diagonal has a box that matches the span on
              // the WRONG side, so correctly turned bridges were reported as turned. Measured on the case
              // that flagged: `bridge_stone_6` covered 5 of its 6 cells with water as placed and would have
              // covered 4 the other way, so the placement was right and the proxy was wrong.
              //
              // The property the title states is "a bridge lies ACROSS the thing it crosses", and that is
              // answerable directly: the span, walked from its anchor, must cover at least as much water as
              // it would turned a quarter. A bridge laid ALONG a river covers less.
              // WHAT CROSSING MEANS: the span starts on dry ground, ends on dry ground, and has water in
              // between. That is answerable from the map and it cannot be gamed, unlike "covers more water",
              // which a bridge lying ALONG a river wins outright, or the bounding box, which the doc above
              // already says cannot work.
              //
              // Read along a WALKING row rather than the anchor's, because a bridge is authored
              // rail / deck / deck / rail and the anchor line is a rail.
              const crossesWater = (alongCol: boolean): boolean => {
                const lane = Math.floor(CROSSING_ROWS / 2)
                const at = (i: number) => {
                  const col = alongCol ? comp.col + i : comp.col + lane
                  const row = alongCol ? comp.row + lane : comp.row + i
                  return s.ground[row]?.[col]
                }
                const ends = !isWaterLabel(at(0)) && !isWaterLabel(at(span - 1))
                let middle = false
                for (let i = 1; i < span - 1; i++) if (isWaterLabel(at(i))) middle = true
                return ends && middle
              }
              const asPlaced = (comp.rotation ?? 0) === 0
              // Judge only where the question HAS an answer: one orientation crosses and the other does not.
              const here = crossesWater(asPlaced)
              const other = crossesWater(!asPlaced)
              if (here === other) continue
              checked++
              if (!here) {
                turned.push(`${key}/${bridge}/${river}/seed${seed} ${comp.kind} rot=${comp.rotation} does not reach bank to bank, turned it would`)
              }
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
