/**
 * THE GENERATION PIPELINE: one module that runs a list of layers, in order.
 *
 * *"we generate the grid, then we add water if any, then we generate pathways with number of exits around the
 * existing area, then we add the rest of vegeation and other things, then we add the characters if any, our
 * layers aren't correctly applied"* — and then, on what this is FOR:
 *
 *   *"we'll add more layers as things get more complicated, for example, we can apply shadow and lightning as
 *   extra layers, we'll also add fog layer, then we probably will add some reprocess layer too, we'll add
 *   water reflection layer, the point is: the main reason why we want a main module that runs a bunch of
 *   other layers, everything optimized On is to have top performance plus clean code plus clear subsystem to
 *   manage"*
 *
 * Three goals, and each one is a property of the code here:
 *
 *   **A CLEAR SUBSYSTEM.** A layer is a name, a guard and a function. Adding shadow, lighting, fog, reprocess
 *   or water reflection is appending one entry to a list. This runner never learns what any of them do, so it
 *   never grows a branch per layer, and the ORDER is a list you can read top to bottom instead of a call
 *   sequence buried in a 5,000-line function.
 *
 *   **TOP PERFORMANCE.** The runner itself is O(layers): one guard call and one run call each, no allocation
 *   per layer, no per-cell work of its own. What it adds is the ability to SEE cost: every run is timed and
 *   the readout is on `window.__stageLayerMs`, so a layer that gets expensive is visible instead of being
 *   absorbed into one "generation is slow". A layer with nothing to do declares it ONCE in `when` rather
 *   than having each of its own loops discover it per cell, which is where an O(n) pass turns into O(n) of
 *   nothing.
 *
 *   **CLEAN CODE.** A layer takes the context and the seeds and returns nothing. It has one reason to change.
 *
 * NOT THE SAME THING AS `LayerId`. That one names a SEED GROUP (layout / buildings / nature / decor / units):
 * which parts re-roll when you re-roll one. This names an EXECUTION STEP: what runs, and when. Two different
 * axes that happen to share the word, and a layer here draws from whichever seed group it belongs to.
 */

/** Per-layer cost of the last generate, newest run wins. Read it off `window.__stageLayerMs`. */
export interface LayerTiming {
  name: string
  /** Milliseconds it ran for, or 0 when its guard skipped it. */
  ms: number
  /** False when `when` said there was nothing to do. */
  ran: boolean
}

/**
 * ONE STEP of generation.
 *
 * `when` is the whole-layer guard: answer false and `run` is never called. It exists so "this map has no
 * water" costs one call instead of a pass over every cell discovering it, which is the difference between
 * O(1) and O(n) of nothing, repeated per layer.
 */
export interface StageLayer<Ctx, Rngs> {
  readonly name: string
  readonly when?: (ctx: Ctx) => boolean
  readonly run: (ctx: Ctx, rngs: Rngs) => void
}

/** Where the last generate's per-layer timings are published, for the same reason `__isoRenderMs` exists. */
interface TimingHost { __stageLayerMs?: LayerTiming[] }

/**
 * Run every layer in order and publish what each one cost.
 *
 * Returns the timings as well as publishing them, so a test can assert the ORDER without reaching for a
 * global. Nothing here knows what a layer does: this function is the whole of the runner and it does not
 * change when a layer is added.
 */
export function runLayers<Ctx, Rngs>(
  layers: ReadonlyArray<StageLayer<Ctx, Rngs>>,
  ctx: Ctx,
  rngs: Rngs,
  /**
   * STOP AFTER THIS LAYER, which is the UI's "layout" choice: *"LAYOUT IN THE UI JUST REFERS TO I WANT TO
   * ONLY EXECUTE THE SYSTEM UP TO THIS SPECIFIC LAYER. IE: ONLY GIVE ME AN EMPTY MAP WITH ALL PATHWAYS, GIVE
   * AN EMPTY MAP WITH A RIVER, GIVE THE FULL MAP, ETC. IS JUST A FILTER, ANOTHER PARAMETER FOR THE
   * GENERATOR"*.
   *
   * A layer beyond the stop is reported as not run, exactly like one whose guard said no, so the readout
   * still accounts for every layer. Absent, or naming a layer this stack does not have, runs all of them.
   */
  stopAfter?: string,
): LayerTiming[] {
  const timings: LayerTiming[] = []
  let stopped = false
  for (const layer of layers) {
    if (stopped || (layer.when && !layer.when(ctx))) {
      timings.push({ name: layer.name, ms: 0, ran: false })
      continue
    }
    const started = performance.now()
    layer.run(ctx, rngs)
    timings.push({ name: layer.name, ms: performance.now() - started, ran: true })
    if (layer.name === stopAfter) stopped = true
  }
  ;(globalThis as unknown as TimingHost).__stageLayerMs = timings
  return timings
}

/** The timings of the last generate, or an empty list before the first one. */
export function stageLayerTimings(): readonly LayerTiming[] {
  return (globalThis as unknown as TimingHost).__stageLayerMs ?? []
}
