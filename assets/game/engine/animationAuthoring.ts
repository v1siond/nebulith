/**
 * Pure helpers for the animation AUTHOR panel — build, validate, and describe AnimationCycles
 * from the editor's choices, so the React panel stays a thin shell over tested logic. The panel
 * picks animations + a mode + delay + trigger; these functions turn that into a valid cycle (or
 * tell the user why it isn't yet).
 */
import type { AnimationCycle, CycleMode, AnimTrigger } from './animationCycles'

/** One pickable animation in the author panel (id the engine knows + a display name). */
export interface AnimationOption {
  id: string
  name: string
}

export const CYCLE_MODES: readonly CycleMode[] = ['sequential', 'randomized', 'stacked']

/** Build a cycle from author-panel choices — copies the animation list, clamps delay ≥ 0. Pure. */
export function makeCycle(
  id: string,
  animations: string[],
  mode: CycleMode,
  delayMs: number,
  trigger: AnimTrigger,
): AnimationCycle {
  return { id, animations: [...animations], mode, delayMs: Math.max(0, Math.round(delayMs)), trigger }
}

/** Validate a cycle against the set of animation ids the engine actually knows. Pure. */
export function validateCycle(
  cycle: AnimationCycle,
  knownAnimationIds: ReadonlySet<string>,
): { ok: boolean; reason?: string } {
  if (cycle.animations.length === 0) return { ok: false, reason: 'pick at least one animation' }
  const missing = cycle.animations.filter(a => !knownAnimationIds.has(a))
  if (missing.length > 0) return { ok: false, reason: `unknown animation: ${missing.join(', ')}` }
  if (cycle.delayMs < 0) return { ok: false, reason: 'delay must be ≥ 0' }
  return { ok: true }
}

/** A short human summary of a cycle for the panel (e.g. "stacked · 2 anim · 0ms gap · on combat"). Pure. */
export function describeCycle(cycle: AnimationCycle): string {
  const trig = cycle.trigger.kind === 'always' ? 'always' : `on ${cycle.trigger.state}`
  return `${cycle.mode} · ${cycle.animations.length} anim · ${cycle.delayMs}ms gap · ${trig}`
}
