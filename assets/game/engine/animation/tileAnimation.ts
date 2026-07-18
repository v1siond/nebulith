/**
 * Tile Animation — the shared, pure animation ENGINE (Phase 1).
 *
 * ONE envelope for every animated tile. An `Animation` has a `kind`:
 *   - `'settings'` — tweens a tile's live render SETTINGS (position, zoom, size, colour, opacity, …)
 *     from a `from` value to a `to` value over one `durationMs`. Many settings move together (`tracks[]`).
 *     Fully implemented here.
 *   - `'sprite'` — swaps baked frame images. Its TYPE is defined so later phases can attach it; its
 *     PLAYBACK is stubbed for Phase 1 (`spriteFrameIndex` → frame 0, `animationValue` → no settings).
 *
 * PURE + clock-derived (no per-instance state, no canvas): the value at time `nowMs` for a tile placed
 * at `placedAtMs` is a deterministic function of the envelope + the two timestamps — the renderer reads
 * the RAF clock each frame and applies the result (exactly how every current engine subsystem works).
 * `startDelayMs`, `loopDelayMs`, `loop`, and `ease` shape the phase; the per-tile `placedAtMs` anchors
 * the start delay so a LIST of animations sharing one anchor produces A→B→C chains from their delays.
 *
 * Compliance (MAP-MODEL / TILE-BACKEND-MIGRATION): the ANIMATION is data — an envelope authored in the
 * backend (composition/tile default) or per-instance in `Template.assetsData`. This module holds NO tile
 * art and NO hardcoded tiles; it only computes live values the renderer drives. `trigger` + `scope` are
 * metadata consumed by later render/play phases; the pure interpolator ignores them (the caller passes
 * the animations that should be playing).
 */

import { lerp } from '@/lib/math'
import { parseColor } from '@/engine/colors'

/**
 * A render setting an animation track can drive. Numeric unless noted:
 *   x/y → pose.dx/dy · rotate → pose.rot · zoom → scale · width → scaleX · height → scaleY
 *   zWidth → depth · zPos → zOffset · heightLevel → heightLevel · opacity → globalAlpha
 *   zIndex → draw order · color → tile colour (RGB lerp) · display → visibility (STEP, not tween)
 */
export type SettingKey =
  | 'x'
  | 'y'
  | 'rotate'
  | 'zoom'
  | 'width'
  | 'height'
  | 'zWidth'
  | 'zPos'
  | 'heightLevel'
  | 'opacity'
  | 'color'
  | 'zIndex'
  | 'display'

export type AnimationKind = 'settings' | 'sprite'

/** Interpolation curve. `sine`/`ease` = ease-in-out (matches `cellAnimation.easeT`); `linear` = default. */
export type Ease = 'linear' | 'sine' | 'ease'

/** How an animation fires. `load` = plays immediately; `proximity` uses `radiusCells` from the hero. */
export type TriggerEvent = 'load' | 'attack' | 'interact' | 'proximity'

export type TileStyle = 'ascii' | 'emoji'
export type TileView = 'iso' | '2d' | 'top'

export interface AnimationTrigger {
  on: TriggerEvent
  /** proximity only — radius in cells/blocks, measured from the hero. */
  radiusCells?: number
}

export interface AnimationScope {
  /** limit to these styles; absent/empty = all styles. */
  styles?: TileStyle[]
  /** limit to these views; absent/empty = all views. */
  views?: TileView[]
}

/** One setting tweened `from → to` over the animation's single duration. */
export interface AnimationTrack {
  setting: SettingKey
  /** number for numeric settings; colour string for `color`; display keyword for `display`. */
  from: number | string
  to: number | string
}

interface AnimationBase {
  id: string
  name?: string
  kind: AnimationKind
  /** length of one play, ms (< 1 loop for looping animations). */
  durationMs: number
  /** dead time before the animation begins, ms (anchored at the tile's `placedAtMs`). Default 0. */
  startDelayMs?: number
  /** rest time between loops, ms — HOLDS the end (`to`) value, then snaps back to `from`. Default 0. */
  loopDelayMs?: number
  loop?: boolean
  ease?: Ease
  /**
   * When two animations write the SAME setting, the higher `priority` wins; on a tie the one later in
   * the list wins. Default 0. (Lets a per-instance override outrank a composition default.)
   */
  priority?: number
  trigger?: AnimationTrigger
  scope?: AnimationScope
}

/** The settings kind — drives live render settings. Fully implemented in Phase 1. */
export interface SettingsAnimation extends AnimationBase {
  kind: 'settings'
  tracks: AnimationTrack[]
}

/** The sprite kind — swaps baked frame images. Type only in Phase 1; playback is stubbed. */
export interface SpriteAnimation extends AnimationBase {
  kind: 'sprite'
  /** baked frame image labels/urls, resolved by the backend tileset; drawn in order. */
  frames: string[]
}

export type Animation = SettingsAnimation | SpriteAnimation

/** The live per-setting override values the engine produces for a moment in time. */
export type AnimatedValues = Partial<Record<SettingKey, number | string>>

/** Settings whose value STEPS (no tween) — `display` flips at the temporal midpoint. */
const STEP_SETTINGS: ReadonlySet<SettingKey> = new Set<SettingKey>(['display'])
/** Settings interpolated as RGB colours rather than plain numbers. */
const COLOR_SETTINGS: ReadonlySet<SettingKey> = new Set<SettingKey>(['color'])

/** Eased 0→1 parameter. `sine`/`ease` = ease-in-out; `linear` (default) = identity. PURE. */
export function easeAnim(kind: Ease | undefined, t: number): number {
  if (kind === 'sine' || kind === 'ease') return (1 - Math.cos(Math.PI * t)) / 2
  return t
}

/**
 * RAW (un-eased) progress in [0,1] of `anim` at `nowMs` for a tile placed at `placedAtMs`. PURE.
 *   - before the start delay (or before the tile is placed) → 0 (hold `from`; the animation is deferred).
 *   - non-loop, at/after the duration → 1 (hold `to` forever).
 *   - loop: each period = duration + loopDelay; the duration window runs 0→1, then the loopDelay tail
 *     RESTS at 1 (holds `to`, matching `cellAnimation`'s "hold the last frame") before snapping back to 0.
 */
function rawProgress(anim: Animation, nowMs: number, placedAtMs: number): number {
  const duration = anim.durationMs
  if (duration <= 0) return 1 // instant / degenerate → settle at `to`

  const startDelay = Math.max(0, anim.startDelayMs ?? 0)
  const elapsed = nowMs - placedAtMs - startDelay
  if (elapsed <= 0) return 0 // not placed yet, or still inside the start delay → `from`

  if (!anim.loop) return elapsed >= duration ? 1 : elapsed / duration

  const loopDelay = Math.max(0, anim.loopDelayMs ?? 0)
  const period = duration + loopDelay
  const cyc = elapsed % period
  return cyc >= duration ? 1 : cyc / duration // loopDelay tail rests at `to`
}

/** Lerp two colour strings in RGB, emitting `rgb(r, g, b)`. Fail-safe: STEP if either is unparseable. */
function lerpColor(from: string, to: string, t: number): string {
  const a = parseColor(from)
  const b = parseColor(to)
  if (!a || !b) return t >= 0.5 ? to : from
  const r = Math.round(lerp(a.r, b.r, t))
  const g = Math.round(lerp(a.g, b.g, t))
  const bl = Math.round(lerp(a.b, b.b, t))
  return `rgb(${r}, ${g}, ${bl})`
}

/**
 * One track's value at the given progress. `color` = RGB lerp (eased); `display` = STEP at the temporal
 * midpoint (`raw`, so the ease curve can't shift the flip point); everything else = numeric lerp (eased).
 */
function trackValue(track: AnimationTrack, raw: number, eased: number): number | string {
  if (COLOR_SETTINGS.has(track.setting)) return lerpColor(String(track.from), String(track.to), eased)
  if (STEP_SETTINGS.has(track.setting)) return raw >= 0.5 ? track.to : track.from
  return lerp(Number(track.from), Number(track.to), eased)
}

/**
 * The live setting overrides produced by ONE animation at `nowMs` for a tile placed at `placedAtMs`. PURE.
 * `settings` kind → one entry per track (its current tweened/stepped value). `sprite` kind → `{}` (playback
 * stubbed for Phase 1; use `spriteFrameIndex`). Trigger/scope are NOT consulted here — the caller decides
 * which animations are playing.
 */
export function animationValue(anim: Animation, nowMs: number, placedAtMs: number): AnimatedValues {
  if (anim.kind !== 'settings') return {} // sprite playback stubbed for Phase 1
  const raw = rawProgress(anim, nowMs, placedAtMs)
  const eased = easeAnim(anim.ease, raw)
  const out: AnimatedValues = {}
  for (const track of anim.tracks) out[track.setting] = trackValue(track, raw, eased)
  return out
}

interface SettingClaim {
  value: number | string
  priority: number
  order: number
}

/**
 * Compose a LIST of animations into the live setting overrides at `nowMs` for a tile placed at
 * `placedAtMs`. PURE.
 *
 * Stacking rule (defined): every animation contributes the current value of each of its tracks; when two
 * animations write the SAME setting, the winner is the one with the higher `priority`, and on a tie the
 * one LATER in the list (list order = author/chain order, per-instance overrides appended last). Settings
 * no animation writes are simply absent (the renderer keeps the tile's base value).
 *
 * All animations share the tile's `placedAtMs` anchor, so per-animation `startDelayMs` yields A→B→C chains.
 * The caller passes the animations that should be playing (trigger + scope filtering happens upstream).
 */
export function resolveAnimatedSettings(
  animations: readonly Animation[],
  nowMs: number,
  placedAtMs: number,
): AnimatedValues {
  const claims = new Map<SettingKey, SettingClaim>()
  animations.forEach((anim, order) => {
    const priority = anim.priority ?? 0
    const values = animationValue(anim, nowMs, placedAtMs)
    for (const key of Object.keys(values) as SettingKey[]) {
      const cur = claims.get(key)
      if (cur && priority < cur.priority) continue
      if (cur && priority === cur.priority && order < cur.order) continue
      claims.set(key, { value: values[key] as number | string, priority, order })
    }
  })

  const out: AnimatedValues = {}
  claims.forEach((claim, key) => {
    out[key] = claim.value
  })
  return out
}

/**
 * Does `anim` play in the given (style, view)? An absent/empty scope list means "all". PURE — later
 * render phases call this to gate playback per active style/view.
 */
export function animationMatchesScope(anim: Animation, style: TileStyle, view: TileView): boolean {
  const styles = anim.scope?.styles
  if (styles && styles.length > 0 && !styles.includes(style)) return false
  const views = anim.scope?.views
  if (views && views.length > 0 && !views.includes(view)) return false
  return true
}

/**
 * Sprite-kind playback STUB — Phase 1 defines the shape only. Returns the frame index a later phase will
 * draw; today it always resolves frame 0 so callers can wire the type without behaviour. PURE.
 */
export function spriteFrameIndex(_anim: SpriteAnimation, _nowMs: number, _placedAtMs: number): number {
  return 0
}
