/**
 * DATA-DRIVEN entity animation. An animation is AUTHORED DATA that rides on an entity and saves/
 * loads with it (the "seed"); the game is a DUMB PLAYER that reads the data and executes it. There
 * is NO hardcoded "when to swap to 🚶" / "when to flip" logic — every such decision is a property of
 * a frame or a trigger in the data. "Emoji" is just one kind of frame asset; an uploaded image tile
 * is the same shape. See docs/animation-system.md.
 *
 *   entity.animations: EntityAnimation[]   // authored via the Inspector; frame 0 is the entity's own tile
 *
 * Playback each render frame:
 *   1. selectAnimation(anims, input)  — pick the animation whose trigger matches the current input
 *      (action → key-hold → move+facing → idle);
 *   2. loopFrameIndex(anim, now)      — which frame is showing now (stateless: derived from `now`,
 *      honoring loopDelay by resting on frame 0 between loops);
 *   3. resolveFrame(frame, base)      — the glyph/image (+ mirror flag) to actually draw.
 * `activeFrame(...)` chains all three. Pure — unit-tested; no DOM/grid access.
 */
import { visualForTileId, type ImageVisual } from '@/game/artStyle'
// The shared animation modal authors every animation as a tileAnimation `Animation`; a unit's frame-swap set
// maps 1:1 onto the `sprite` kind. Type-only import (erased at compile → no runtime cycle, though
// tileAnimation.ts imports our frame types back). See spriteFromEntity / entityFromSprite below.
import type { Animation, SpriteAnimation } from '@/engine/animation/tileAnimation'

export type AnimDirection = 'up' | 'down' | 'left' | 'right' | 'any'
/** Concrete facing (never 'any') — what the live input reports. */
export type Facing = 'up' | 'down' | 'left' | 'right'

/** What makes an animation play. `on` is the event; a `move` trigger can require running via
 *  `whileRunning`; a `key` trigger names the bound key + tap/hold. All data — the player just checks. */
export interface AnimTrigger {
  on: 'idle' | 'move' | 'attack' | 'interact' | 'key'
  /** move only: this variant plays while running (Shift) instead of the plain walk. */
  whileRunning?: boolean
  /** key only: the bound key (e.g. 'Shift', ' '), and whether it plays once (tap) or loops (hold). */
  key?: string
  mode?: 'tap' | 'hold'
}

/** One frame. `tileId` selects a catalog tile (emoji OR image); `char` is a raw glyph for quick seed
 *  frames; BOTH empty → the entity's own base tile (so frame 0 = "the entity as-is"). `flipX` mirrors
 *  the frame horizontally — a DATA property (e.g. a right-facing walk reuses the left-facing emoji
 *  flipped), never a JS decision. */
export interface AnimFrame {
  tileId?: string
  char?: string
  flipX?: boolean
}

export interface EntityAnimation {
  id: string
  name: string
  trigger: AnimTrigger
  direction: AnimDirection
  frames: AnimFrame[]
  /** total loop length in ms; frames are spread evenly across it. */
  durationMs: number
  /** pause between loops in ms (rests on frame 0). Default 0 = seamless. */
  loopDelayMs?: number
  /** hold/looping animation loops forever; a one-shot (tap) plays once (Stage-2 concern). */
  loop: boolean
}

/** The live input the player matches triggers against. */
export interface AnimInput {
  moving: boolean
  facing: Facing
  running?: boolean
  /** a transient one-frame action (attack/interact) that takes priority when present. */
  action?: 'attack' | 'interact' | null
  /** currently-held keys, for `key` triggers. */
  keysDown?: Record<string, boolean>
}

/** What to draw for the current frame. */
export interface ResolvedFrame { char?: string; image?: ImageVisual; flipX: boolean }

const dirMatches = (a: EntityAnimation, facing: Facing): boolean => a.direction === 'any' || a.direction === facing

/**
 * Pick the animation to play. Priority: a transient `action` → a held `key` → `move` (facing, run
 * variant preferred while running) → `idle`. Returns null when nothing matches (caller draws the
 * entity's base tile).
 */
export function selectAnimation(anims: readonly EntityAnimation[], input: AnimInput): EntityAnimation | null {
  if (input.action) {
    const a = anims.find(x => x.trigger.on === input.action && dirMatches(x, input.facing))
    if (a) return a
  }
  if (input.keysDown) {
    const k = anims.find(x => x.trigger.on === 'key' && x.trigger.key && input.keysDown![x.trigger.key] && dirMatches(x, input.facing))
    if (k) return k
  }
  if (input.moving) {
    const moves = anims.filter(x => x.trigger.on === 'move' && dirMatches(x, input.facing))
    const run = input.running ? moves.find(x => x.trigger.whileRunning) : undefined
    const walk = moves.find(x => !x.trigger.whileRunning)
    const chosen = run ?? walk ?? moves[0]
    if (chosen) return chosen
  }
  return anims.find(x => x.trigger.on === 'idle' && dirMatches(x, input.facing)) ?? anims.find(x => x.trigger.on === 'idle') ?? null
}

/**
 * Which frame index shows at `now` — stateless, derived from `now` so a continuously-playing loop
 * needs no start timestamp. Frames spread evenly across `durationMs`; during `loopDelayMs` the
 * animation rests on frame 0.
 */
export function loopFrameIndex(anim: EntityAnimation, now: number): number {
  const n = anim.frames.length
  if (n <= 1) return 0
  const period = anim.durationMs + (anim.loopDelayMs ?? 0)
  if (period <= 0) return 0
  const t = ((now % period) + period) % period
  if (t >= anim.durationMs) return 0 // resting between loops
  return Math.min(n - 1, Math.floor(t / (anim.durationMs / n)))
}

/** Resolve a frame to the glyph/image (+ mirror) to draw; an empty frame falls back to `base`. */
export function resolveFrame(frame: AnimFrame, base: { char?: string }): ResolvedFrame {
  const flipX = !!frame.flipX
  if (frame.char) return { char: frame.char, flipX }
  if (frame.tileId) {
    const v = visualForTileId(frame.tileId)
    if (v?.kind === 'glyph') return { char: v.char, flipX }
    if (v?.kind === 'image') return { image: v, flipX }
  }
  return { char: base.char, flipX } // empty frame → the entity's own tile
}

/** Chain select → index → resolve: what to draw for this entity RIGHT NOW. Falls back to `base`
 *  when the entity has no matching animation. */
export function activeFrame(anims: readonly EntityAnimation[] | undefined, base: { char?: string }, input: AnimInput, now: number): ResolvedFrame {
  if (!anims || anims.length === 0) return { char: base.char, flipX: false }
  const anim = selectAnimation(anims, input)
  if (!anim || anim.frames.length === 0) return { char: base.char, flipX: false }
  return resolveFrame(anim.frames[loopFrameIndex(anim, now)], base)
}

// ── the SEED: a person's default walk/run/idle, authored AS DATA ────────────────
// Frame 0 is empty → the entity's own DB tile (🧍 → player.png under emoji). The moving frame is the baked
// walk (🚶 → emoji:walk) or run (🏃 → emoji:run) DB tile — the SAME consistent Noto font as every other
// tile, never a raw OS glyph. A right-facing move reuses the tile with flipX in the DATA (the renderer only
// honors the flag). Replaced/extended per-entity once the Inspector authoring lands (Stage 2).
const WALK_TILE = 'emoji:walk'
const RUN_TILE = 'emoji:run'
const DIRS: Facing[] = ['up', 'down', 'left', 'right']

function move(dir: Facing, running: boolean): EntityAnimation {
  const motionTile = running ? RUN_TILE : WALK_TILE
  return {
    id: `char-${running ? 'run' : 'walk'}-${dir}`,
    name: `${running ? 'run' : 'walk'} ${dir}`,
    trigger: { on: 'move', ...(running ? { whileRunning: true } : {}) },
    direction: dir,
    // The walk cycle is the moving tile then the SAME tile MIRRORED — never back to the idle figure (that
    // flickered idle↔walk). Same tile both frames → one consistent figure; the mirror gives the step motion.
    frames: [{ tileId: motionTile }, { tileId: motionTile, flipX: true }],
    durationMs: running ? 300 : 440,
    loopDelayMs: 0,
    loop: true,
  }
}

/** Default person animation set (idle + walk×4 + run×4), all data. */
export const DEFAULT_CHARACTER_ANIMATIONS: readonly EntityAnimation[] = [
  { id: 'char-idle', name: 'idle', trigger: { on: 'idle' }, direction: 'any', frames: [{}], durationMs: 1000, loop: true },
  ...DIRS.map(d => move(d, false)),
  ...DIRS.map(d => move(d, true)),
]

/** A fresh, EDITABLE deep copy of the default person animations — SEEDED onto a person entity at
 *  creation so the authored set shows in the Inspector + saves with the entity. (The renderer's
 *  `DEFAULT_CHARACTER_ANIMATIONS` fallback only covers entities minted before seeding.) */
export function seedCharacterAnimations(): EntityAnimation[] {
  return DEFAULT_CHARACTER_ANIMATIONS.map(a => ({
    ...a,
    trigger: { ...a.trigger },
    frames: a.frames.map(f => ({ ...f })),
  }))
}

/** A RANDOMIZED movement animation, authored AS DATA — the one-off the editor drops on a unit for the
 *  top-nav "Animated" placement, and the same thing the Animate modal's 🎲 button appends. It swaps the
 *  unit's OWN tile (frame 0) with its MIRROR (a visible step), fires on `move` in ANY direction so it shows
 *  however the unit wanders, and randomizes only the step cadence — a different feel every roll, no tile
 *  picker needed. Editable like any other animation once it lands (name/frames/direction all patchable). */
export function randomMovementAnimation(rng: () => number = Math.random): EntityAnimation {
  const durationMs = 260 + Math.floor(rng() * 260) // 260–520ms: a brisk-to-lazy step
  const suffix = Math.floor(rng() * 1e9).toString(36)
  return {
    id: `rand-move-${suffix}`,
    name: 'wander',
    trigger: { on: 'move' },
    direction: 'any',
    frames: [{}, { flipX: true }], // the unit's own tile, then mirrored → a step
    durationMs,
    loopDelayMs: 0,
    loop: true,
  }
}

// The hardcoded pose glyphs the PRE-DB-tile seed used for walk/run. A saved person whose frames still
// carry these is running the OUTDATED default (raw OS emoji, inconsistent font) → reseed it.
const OUTDATED_SEED_CHARS: ReadonlySet<string> = new Set(['🚶', '🏃'])

/** True when a person's animation set should be RESEEDED from the current default: it's empty (never
 *  seeded), OR it's the outdated hardcoded-emoji default (a frame still carries a raw 🚶/🏃 instead of the
 *  DB pose tile). A CUSTOM set — anything without those raw glyphs — is preserved untouched. This is how
 *  persons saved with the old seed pick up the baked DB tiles on load ("remove old anims + reseed"). */
export function needsAnimationReseed(anims: readonly EntityAnimation[] | undefined): boolean {
  if (!anims || anims.length === 0) return true
  return anims.some(a => a.frames.some(f => f.char !== undefined && OUTDATED_SEED_CHARS.has(f.char)))
}

// ── the bridge: a unit's frame-swap animation ⇄ the shared modal's `sprite` kind ─────────────────────
// The tile settings modal authors every animation as a tileAnimation `Animation`; the user asked for the
// character animation to BE the sprite kind inside that one modal. A unit still STORES EntityAnimation[]
// (the renderer plays it via activeFrame — unchanged), so the modal edits the SPRITE VIEW of each animation
// and writes the plain entity shape back. The mapping is lossless: every EntityAnimation field has a home on
// the sprite envelope (id/name/durationMs/loopDelayMs/loop on the base; trigger→spriteTrigger; direction; frames).

/** A unit's EntityAnimation as the shared modal's `sprite` Animation (a deep, editable copy). */
export function spriteFromEntity(anim: EntityAnimation): SpriteAnimation {
  return {
    id: anim.id,
    name: anim.name,
    kind: 'sprite',
    frames: anim.frames.map(f => ({ ...f })),
    spriteTrigger: { ...anim.trigger },
    direction: anim.direction,
    durationMs: anim.durationMs,
    loopDelayMs: anim.loopDelayMs,
    loop: anim.loop,
  }
}

/** A `sprite` Animation edited in the shared modal back to the stored EntityAnimation shape (a deep copy).
 *  Fills the entity defaults (idle trigger / 'any' facing / looping) for the fields the sprite envelope leaves
 *  optional, so a round-trip through the modal always yields a valid, playable unit animation. */
export function entityFromSprite(anim: SpriteAnimation): EntityAnimation {
  return {
    id: anim.id,
    name: anim.name ?? '',
    trigger: anim.spriteTrigger ? { ...anim.spriteTrigger } : { on: 'idle' },
    direction: anim.direction ?? 'any',
    frames: (anim.frames ?? []).map(f => ({ ...f })),
    durationMs: anim.durationMs,
    loopDelayMs: anim.loopDelayMs,
    loop: anim.loop ?? true,
  }
}

// ── the unified UNIT storage bridge: `Entity.unitAnimations: Animation[]` ⇄ render `EntityAnimation[]` ──────
// The user: units and tiles must use the IDENTICAL modal — BOTH the settings AND the sprite add-buttons. That
// means a unit STORES the same unified `Animation[]` a tile does (settings-kind + sprite-kind), authored in
// `Entity.unitAnimations`. But the RENDERER (iso/topdown) + `PlayerState` still read the frame-swap list as
// `EntityAnimation[]` via `activeFrame`, unchanged — so `Entity.animations` stays that render projection, kept
// in sync from the sprite subset of `unitAnimations`. These two pure helpers ARE that lossless bridge.

/** Project a unit's unified authored list to the `EntityAnimation[]` the renderer/runtime plays. Only the
 *  sprite kind maps to a playable frame set; settings-kind envelopes drive render settings the ENTITY renderer
 *  doesn't consume yet (render-parity follow-up) so they are dropped from the frame projection but PRESERVED in
 *  `unitAnimations`. Lossless for every sprite animation (`entityFromSprite`). PURE. */
export function entityAnimationsFromUnit(anims: readonly Animation[] | undefined): EntityAnimation[] {
  if (!anims) return []
  return anims.filter((a): a is SpriteAnimation => a.kind === 'sprite').map(entityFromSprite)
}

/** Lift a legacy sprite-only `EntityAnimation[]` (a unit minted before `unitAnimations` existed) to the unified
 *  `Animation[]` the shared modal authors — every EntityAnimation is a sprite Animation (`spriteFromEntity`).
 *  The fallback read when a unit has no `unitAnimations` yet, so its seeded walk/idle still shows in the modal. PURE. */
export function unitAnimationsFromEntity(anims: readonly EntityAnimation[] | undefined): Animation[] {
  if (!anims) return []
  return anims.map(spriteFromEntity)
}
