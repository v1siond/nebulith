/**
 * FRAME-BASED cell animation — the author defines an asset's motion directly as FRAMES.
 * Frame 0 is the rest pose; each later frame is a small transform offset (dx/dy/rot/scale). Set a
 * duration to traverse frame 0 → last, a delay, and it loops. A leaf in the wind is
 * static → right → left → right.
 *
 * This is a TRANSFORM track that lives ALONGSIDE the glyph-swap engine in `animationCycles.ts`:
 * a cycle changes WHICH glyph is drawn; a CellAnimation changes WHERE/how it's drawn. The two are
 * independent and compose.
 *
 * Pure: (animation, now) → interpolated transform. No per-frame state lives here, so it's
 * deterministic + unit-testable; the renderer reads the clock each frame and applies the result.
 */

import { lerp } from '@/lib/math'

/** A grid cell the animation is attached to. */
export interface Cell {
  col: number
  row: number
}

/** One frame: a cell-relative transform. Frame 0 is the rest state (dx=dy=0, rot=0, scale=1). */
export interface AnimFrame {
  /** X offset as a fraction of a tile (+0.15 ≈ "slightly right"). */
  dx: number
  /** Y offset as a fraction of a tile. */
  dy: number
  /** optional rotation in radians (sway / rustle). */
  rot?: number
  /** optional uniform scale (pulse); 1 = unchanged. */
  scale?: number
}

export type Ease = 'linear' | 'sine'

/** When the animation runs. v1 renders 'always' (ambient); the others are documented, not wired. */
export type AnimTrigger = 'always' | 'on-interact' | 'on-proximity'

export interface CellAnimation {
  id: string
  cells: Cell[]
  /** frame 0 = rest; played 0 → N-1 over `durationMs`. */
  frames: AnimFrame[]
  /** time to traverse frame 0 → last. */
  durationMs: number
  /** dead time at the end, holding the last frame, before re-looping. */
  delayMs: number
  loop: boolean
  trigger: AnimTrigger
  ease?: Ease
}

/** The fully-resolved transform the renderer applies (no optionals). */
export interface AnimTransform {
  dx: number
  dy: number
  rot: number
  scale: number
}

/** The rest transform — no movement. */
export const REST: AnimTransform = { dx: 0, dy: 0, rot: 0, scale: 1 }

/** Eased 0→1 interpolation parameter. sine = ease-in-out (reads as a natural sway). */
export function easeT(kind: Ease | undefined, t: number): number {
  if (kind === 'sine') return (1 - Math.cos(Math.PI * t)) / 2
  return t // linear (default)
}

/** Resolve a frame's optional fields to a full transform. */
const resolve = (f: AnimFrame): AnimTransform => ({
  dx: f.dx,
  dy: f.dy,
  rot: f.rot ?? 0,
  scale: f.scale ?? 1,
})

/** Blend two frames by an eased parameter. */
const blend = (a: AnimFrame, b: AnimFrame, e: number): AnimTransform => ({
  dx: lerp(a.dx, b.dx, e),
  dy: lerp(a.dy, b.dy, e),
  rot: lerp(a.rot ?? 0, b.rot ?? 0, e),
  scale: lerp(a.scale ?? 1, b.scale ?? 1, e),
})

/**
 * The interpolated transform at absolute time `now`. PURE — same (anim, now) → same transform.
 *   - frames 0 → N-1 are spread evenly across `durationMs` (N-1 segments), eased per `ease`.
 *   - the `delayMs` tail (and any time past the end of a non-looping run) HOLDS the last frame.
 *   - looping wraps on `durationMs + delayMs`.
 * Empty or single-frame animations have nothing to move → REST.
 */
export function transformAt(anim: CellAnimation, now: number): AnimTransform {
  const { frames, durationMs, delayMs, loop } = anim
  if (!frames || frames.length <= 1) return { ...REST }

  const period = durationMs + Math.max(0, delayMs)
  if (durationMs <= 0 || period <= 0) return resolve(frames[0])

  // Position within one loop (or clamp forward when not looping).
  const t = loop ? ((now % period) + period) % period : Math.max(0, now)

  // Delay tail / past the end of the run: hold the last frame.
  if (t >= durationMs) return resolve(frames[frames.length - 1])

  const segCount = frames.length - 1
  const segDur = durationMs / segCount
  const seg = Math.min(Math.floor(t / segDur), segCount - 1)
  const local = (t - seg * segDur) / segDur
  return blend(frames[seg], frames[seg + 1], easeT(anim.ease, local))
}

/**
 * The transform to apply when DRAWING an animated asset at `now`, or null when there's nothing to
 * apply (no animation, a single rest frame, or a trigger v1 doesn't run). Returning null keeps the
 * cheap, allocation-free path for the vast majority of (un-animated) cells.
 */
export function assetCellTransform(
  anim: CellAnimation | undefined | null,
  now: number,
): AnimTransform | null {
  if (!anim || anim.trigger !== 'always') return null
  if (!anim.frames || anim.frames.length <= 1) return null
  return transformAt(anim, now)
}

/** A fresh rest frame (frame 0). */
export const restFrame = (): AnimFrame => ({ dx: 0, dy: 0 })

/** Build a CellAnimation from author choices. Copies frames + cells; clamps timing ≥ 0. */
export function makeCellAnimation(
  cells: Cell[],
  frames: AnimFrame[],
  opts: {
    durationMs?: number
    delayMs?: number
    loop?: boolean
    ease?: Ease
    trigger?: AnimTrigger
    id?: string
  } = {},
): CellAnimation {
  return {
    id: opts.id ?? 'cellanim',
    cells: cells.map(c => ({ col: c.col, row: c.row })),
    frames: frames.map(f => ({ ...f })),
    durationMs: Math.max(0, Math.round(opts.durationMs ?? 1200)),
    delayMs: Math.max(0, Math.round(opts.delayMs ?? 0)),
    loop: opts.loop ?? true,
    trigger: opts.trigger ?? 'always',
    ease: opts.ease ?? 'sine',
  }
}
