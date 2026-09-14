/**
 * THE GENERATION PIPELINE: a main module that runs a list of layers.
 *
 * *"we'll add more layers as things get more complicated, for example, we can apply shadow and lightning as
 * extra layers, we'll also add fog layer, then we probably will add some reprocess layer too, we'll add water
 * reflection layer, the point is: the main reason why we want a main module that runs a bunch of other layers,
 * everything optimized On is to have top performance plus clean code plus clear subsystem to manage"*
 * (2026-09-14).
 *
 * Three goals, three things asserted here:
 *
 *   · CLEAR SUBSYSTEM — the order is a list, and it runs in that order.
 *   · ADDING ONE CHANGES NOTHING ELSE — a layer appended runs, in place, without `runLayers` knowing anything
 *     about it. That is the property every future layer depends on, so it is pinned rather than assumed.
 *   · TOP PERFORMANCE — a guard that says no costs ONE call, not a pass over the map discovering it; and every
 *     layer's cost is visible instead of being absorbed into "generation is slow".
 */
import { runLayers, stageLayerTimings, type StageLayer } from '@/engine/generate/pipeline'

type Ctx = { log: string[]; cells: number }
type Rngs = { seed: number }

const step = (name: string, extra?: Partial<StageLayer<Ctx, Rngs>>): StageLayer<Ctx, Rngs> => ({
  name,
  run: ctx => { ctx.log.push(name) },
  ...extra,
})

const fresh = (): Ctx => ({ log: [], cells: 0 })

describe('the runner', () => {
  it('runs every layer once, in the order the list gives', () => {
    const ctx = fresh()
    runLayers([step('ways'), step('terrain'), step('edge'), step('gates')], ctx, { seed: 1 })
    expect(ctx.log).toEqual(['ways', 'terrain', 'edge', 'gates'])
  })

  it('takes a NEW layer without changing: appended, it runs in place', () => {
    const ctx = fresh()
    // shadow, lighting, fog, reprocess, water reflection — this is the shape each of them arrives in.
    const stack = [step('ways'), step('terrain'), step('shadow'), step('fog'), step('reflection')]
    runLayers(stack, ctx, { seed: 1 })
    expect(ctx.log).toEqual(['ways', 'terrain', 'shadow', 'fog', 'reflection'])
  })

  it('hands every layer the same context and the same seeds', () => {
    const seen: Array<[Ctx, Rngs]> = []
    const ctx = fresh()
    const rngs = { seed: 42 }
    const spy = (name: string): StageLayer<Ctx, Rngs> => ({ name, run: (c, r) => { seen.push([c, r]) } })
    runLayers([spy('a'), spy('b')], ctx, rngs)
    expect(seen).toHaveLength(2)
    for (const [c, r] of seen) {
      expect(c).toBe(ctx)
      expect(r).toBe(rngs)
    }
  })
})

describe('a layer that has nothing to do', () => {
  it('is skipped entirely — its guard is one call, not a pass over the map', () => {
    const ctx = fresh()
    const expensive: StageLayer<Ctx, Rngs> = {
      name: 'water',
      when: () => false,
      run: c => { c.cells += 10_000; c.log.push('water') }, // would touch every cell
    }
    runLayers([step('ways'), expensive, step('terrain')], ctx, { seed: 1 })

    expect(ctx.log).toEqual(['ways', 'terrain'])
    expect(ctx.cells).toBe(0) // it never started, so it never counted a single cell
  })

  it('still appears in the readout, marked as not run, so a skip is visible rather than silent', () => {
    const timings = runLayers([step('ways'), { name: 'fog', when: () => false, run: () => {} }], fresh(), { seed: 1 })
    expect(timings.map(t => t.name)).toEqual(['ways', 'fog'])
    expect(timings.find(t => t.name === 'fog')).toMatchObject({ ran: false, ms: 0 })
    expect(timings.find(t => t.name === 'ways')?.ran).toBe(true)
  })

  it('runs when its guard says so', () => {
    const ctx = fresh()
    runLayers([{ name: 'water', when: () => true, run: c => { c.log.push('water') } }], ctx, { seed: 1 })
    expect(ctx.log).toEqual(['water'])
  })
})

describe('what a layer cost', () => {
  it('is published for the last generate, one entry per layer, in order', () => {
    runLayers([step('ways'), step('terrain'), step('gates')], fresh(), { seed: 1 })
    expect(stageLayerTimings().map(t => t.name)).toEqual(['ways', 'terrain', 'gates'])
    for (const t of stageLayerTimings()) expect(t.ms).toBeGreaterThanOrEqual(0)
  })

  it('is replaced by the next generate, never appended to', () => {
    runLayers([step('a'), step('b'), step('c')], fresh(), { seed: 1 })
    runLayers([step('d')], fresh(), { seed: 1 })
    expect(stageLayerTimings().map(t => t.name)).toEqual(['d'])
  })
})

describe('the runner adds nothing of its own', () => {
  it('does no work per cell: an empty stack touches nothing and an empty context comes back empty', () => {
    const ctx = fresh()
    expect(runLayers([], ctx, { seed: 1 })).toEqual([])
    expect(ctx).toEqual({ log: [], cells: 0 })
  })

  it('calls each layer exactly once, however many there are', () => {
    const counts = new Map<string, number>()
    const counted = (name: string): StageLayer<Ctx, Rngs> =>
      ({ name, run: () => counts.set(name, (counts.get(name) ?? 0) + 1) })
    const stack = Array.from({ length: 20 }, (_, i) => counted(`layer${i}`))
    runLayers(stack, fresh(), { seed: 1 })
    expect(counts.size).toBe(20)
    for (const n of counts.values()) expect(n).toBe(1)
  })
})
