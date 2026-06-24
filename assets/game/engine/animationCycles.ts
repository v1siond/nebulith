/**
 * A general, reusable ANIMATION-CYCLE engine — for entities AND assets alike. A thing owns
 * a set of CYCLES; each cycle plays its animations in a MODE (sequential / randomized /
 * stacked), with a delay between iterations, gated by a TRIGGER (always, or while a state is
 * active). Cycles are INDEPENDENT, so several run at once — that's how a walk cycle and an
 * attack cycle overlap ("stacked" at the set level).
 *
 * Pure: (cycles, now, active states) → frames. The renderer composites the returned frames.
 * No entity/asset-specific logic lives here — same engine for a goblin, the player, or an
 * animated leaf tile.
 */
export type AnimFrame = readonly string[]

/** One animation: a sequence of tile-variation frames played over `durationMs`. */
export interface Animation {
  id: string
  frames: AnimFrame[]
  /** time to play through ALL frames once. */
  durationMs: number
  loop: boolean
}

export type CycleMode = 'sequential' | 'randomized' | 'stacked'

/** When a cycle is active: always, or only while the thing is in `state` (idle/walk/combat…). */
export type AnimTrigger = { kind: 'always' } | { kind: 'state'; state: string }

export interface AnimationCycle {
  id: string
  /** ids of the animations this cycle plays. */
  animations: string[]
  mode: CycleMode
  /** delay (ms) between animations for sequential/randomized — 0 = continuous. */
  delayMs: number
  trigger: AnimTrigger
}

/** The frame of one animation at a LOCAL elapsed time. loop wraps; one-shot holds the last. */
export function frameAt(anim: Animation, elapsedMs: number): AnimFrame {
  const n = anim.frames.length
  if (n === 0) return []
  if (n === 1 || anim.durationMs <= 0) return anim.frames[0]
  const perFrame = anim.durationMs / n
  const raw = Math.floor(Math.max(0, elapsedMs) / perFrame)
  const idx = anim.loop ? ((raw % n) + n) % n : Math.min(raw, n - 1)
  return anim.frames[idx]
}

/** Is this cycle active given the set of currently-active states? Pure. */
export function cycleActive(cycle: AnimationCycle, activeStates: ReadonlySet<string>): boolean {
  return cycle.trigger.kind === 'always' || activeStates.has(cycle.trigger.state)
}

/** Deterministic pseudo-random index for the randomized mode (no Math.random → testable). */
function randIndex(seed: number, count: number): number {
  const h = Math.abs(Math.sin((seed + 1) * 12.9898) * 43758.5453) % 1
  return Math.floor(h * count) % count
}

/**
 * The frames a cycle contributes at `now` (since `startMs`). PURE.
 *   - stacked    : every animation plays at once → one frame each (composited layers).
 *   - sequential : animations play one-at-a-time in order, looping, with `delayMs` between.
 *   - randomized : same, but each slot picks a deterministic pseudo-random animation.
 * During the delay portion of a slot the animation holds its last frame (no flicker).
 */
export function cycleFrames(
  cycle: AnimationCycle,
  byId: Readonly<Record<string, Animation>>,
  now: number,
  startMs: number,
): AnimFrame[] {
  const anims = cycle.animations.map(id => byId[id]).filter(Boolean) as Animation[]
  if (anims.length === 0) return []
  const elapsed = Math.max(0, now - startMs)

  if (cycle.mode === 'stacked') {
    return anims.map(a => frameAt(a, elapsed))
  }

  // sequential / randomized: one anim per SLOT (anim.duration + delay), looping over the set.
  const slots = anims.map(a => a.durationMs + cycle.delayMs)
  const period = slots.reduce((s, d) => s + d, 0)
  if (period <= 0) return [frameAt(anims[0], elapsed)]
  const t = elapsed % period
  const iteration = Math.floor(elapsed / period)
  let acc = 0
  for (let i = 0; i < anims.length; i++) {
    if (t < acc + slots[i]) {
      const local = t - acc
      const pick = cycle.mode === 'randomized' ? randIndex(iteration * anims.length + i, anims.length) : i
      const a = anims[pick]
      if (a.frames.length === 0) return []
      // During the delay portion (local ≥ duration) FREEZE on the last frame, else play.
      return [local >= a.durationMs ? a.frames[a.frames.length - 1] : frameAt(a, local)]
    }
    acc += slots[i]
  }
  return [frameAt(anims[0], elapsed)]
}

/** Composite every ACTIVE cycle into a flat list of frames to draw (cycle order = layer order). */
export function activeFrames(
  cycles: readonly AnimationCycle[],
  byId: Readonly<Record<string, Animation>>,
  activeStates: ReadonlySet<string>,
  now: number,
  startMs = 0,
): AnimFrame[] {
  return cycles
    .filter(c => cycleActive(c, activeStates))
    .flatMap(c => cycleFrames(c, byId, now, startMs))
}
