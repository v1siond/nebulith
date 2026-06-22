/**
 * ASCII ATTACK ANIMATIONS — pure, time-driven. The play loop spawns an `AttackAnim`
 * when an attack lands and asks `animFrame(anim, now)` each frame for the glyph +
 * world position to draw; `null` means the animation has finished and can be dropped.
 *
 * Kinds: slash (melee sword/axe), shot (ranged, travels from→to), lightning (magic),
 * block (defensive flash on the blocker).
 */

export type AttackAnimKind = 'slash' | 'shot' | 'lightning' | 'block'

export interface AttackAnim {
  kind: AttackAnimKind
  fromX: number
  fromZ: number
  toX: number
  toZ: number
  start: number
  durationMs: number
}

export const ATTACK_ANIM_MS: Record<AttackAnimKind, number> = {
  slash: 280,
  shot: 360,
  lightning: 320,
  block: 260,
}

/** Per-kind glyph sequence (played start→end) and tint. */
const FRAMES: Record<AttackAnimKind, string[]> = {
  slash: ['╱', '╳', '✶', '✦'],
  shot: ['·', '–', '→', '➤'],
  lightning: ['ϟ', '⌁', '⚡', '✸'],
  block: ['▢', '◇', '◈', '✦'],
}

const COLORS: Record<AttackAnimKind, string> = {
  slash: '#ffe28a',
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
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** The glyph + world position to draw this frame, or null once finished. */
export function animFrame(anim: AttackAnim, now: number): AnimFrame | null {
  if (isAnimDone(anim, now)) return null
  const p = animProgress(anim, now)
  const frames = FRAMES[anim.kind]
  const char = frames[Math.min(frames.length - 1, Math.floor(p * frames.length))]
  // A shot flies along its path; melee/magic/block sit on the target cell.
  const x = anim.kind === 'shot' ? lerp(anim.fromX, anim.toX, p) : anim.toX
  const z = anim.kind === 'shot' ? lerp(anim.fromZ, anim.toZ, p) : anim.toZ
  return { char, x, z, color: COLORS[anim.kind] }
}
