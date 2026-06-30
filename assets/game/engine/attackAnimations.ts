/**
 * ASCII ATTACK ANIMATIONS — pure, time-driven. The play loop spawns an `AttackAnim`
 * when an attack lands and asks `animFrame(anim, now)` each frame for the glyph +
 * world position to draw; `null` means the animation has finished and can be dropped.
 *
 * Kinds: slash (melee sword/axe), shot (ranged, travels from→to), lightning (magic),
 * block (defensive flash on the blocker).
 */

import { lerp } from '@/lib/math'

export type AttackAnimKind = 'slash' | 'shot' | 'lightning' | 'block'

export interface AttackAnim {
  kind: AttackAnimKind
  fromX: number
  fromZ: number
  toX: number
  toZ: number
  start: number
  durationMs: number
  /** The attacker's weapon glyph — a slash swings THIS (the actual sword) in-hand, instead of a
   *  generic floating stroke. Optional: falls back to the kind's default frame glyph. */
  glyph?: string
  /** The PLAYER's own melee: drawn as the single swinging in-hand weapon by the player render — the
   *  anim loop skips it so there's no second, separate stroke. */
  inHand?: boolean
  /** Overrides the kind's default color (e.g. an ability recolors the blade — Fire Slash burns
   *  red-orange). Undefined → the kind's steel/default tint. */
  tint?: string
}

export const ATTACK_ANIM_MS: Record<AttackAnimKind, number> = {
  slash: 200,
  shot: 360,
  lightning: 320,
  block: 260,
}

/** Per-kind glyph sequence (played start→end) and tint. */
const FRAMES: Record<AttackAnimKind, string[]> = {
  // Melee swing ARC: raised-back (\) → vertical (|) → forward (/) → low follow-through (─).
  slash: ['\\', '|', '/', '─'],
  shot: ['·', '–', '→', '➤'],
  lightning: ['ϟ', '⌁', '⚡', '✸'],
  block: ['▢', '◇', '◈', '✦'],
}

const COLORS: Record<AttackAnimKind, string> = {
  slash: '#e6ebf3', // steel blade glint (the swung weapon), not a yellow stick
  shot: '#cfd8e3',
  lightning: '#7ad7ff',
  block: '#9effa0',
}

/** Which animation a weapon produces. Anything ranged shoots; staff casts lightning;
 *  everything else in melee is a slash. */
export function weaponAnimKind(weaponKind: string, range: string): AttackAnimKind {
  if (range === 'ranged') return 'shot'
  if (weaponKind === 'staff') return 'lightning'
  return 'slash'
}

/** 0..1 across the animation's lifetime (clamped). */
export function animProgress(anim: AttackAnim, now: number): number {
  if (anim.durationMs <= 0) return 1
  const p = (now - anim.start) / anim.durationMs
  if (p < 0) return 0
  if (p > 1) return 1
  return p
}

export function isAnimDone(anim: AttackAnim, now: number): boolean {
  return now - anim.start >= anim.durationMs
}

export interface AnimFrame {
  char: string
  x: number
  z: number
  color: string
  /** Radians to rotate the glyph by (slash only) — the renderer spins the blade through the swing
   *  arc at the hand. Undefined → draw upright (shot/lightning/block). */
  angle?: number
}

/** The glyph + world position to draw this frame, or null once finished. */
export function animFrame(anim: AttackAnim, now: number): AnimFrame | null {
  if (isAnimDone(anim, now)) return null
  const p = animProgress(anim, now)
  const frames = FRAMES[anim.kind]
  const isSlash = anim.kind === 'slash'
  // A slash swings the ATTACKER'S WEAPON (its glyph) if we have it; otherwise the generic arc stroke.
  const char = isSlash && anim.glyph ? anim.glyph : frames[Math.min(frames.length - 1, Math.floor(p * frames.length))]
  // A shot flies along its path; a SLASH stays in the attacker's HAND (reaches only a little toward
  // the target) so the sword arcs from the player, not a stick floating on the enemy cell; magic +
  // block land on the target cell.
  const SLASH_REACH = 0.3
  const t = anim.kind === 'shot' ? p : isSlash ? SLASH_REACH : 1
  const x = lerp(anim.fromX, anim.toX, t)
  const z = lerp(anim.fromZ, anim.toZ, t)
  // The blade sweeps raised-back → follow-through, mirrored toward whichever side the target is on.
  const dir = anim.toX >= anim.fromX ? 1 : -1
  const angle = isSlash ? dir * lerp(-1.15, 0.95, p) : undefined
  return { char, x, z, color: anim.tint ?? COLORS[anim.kind], angle }
}
