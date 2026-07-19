// Tile & sprite ANIMATION authoring for the game-engine editor: the frame picker, per-animation rows,
// the settings/sprite track editors, the live preview, and the TileAnimationEditor that hosts them.
// Pure presentational + props-driven — extracted verbatim from editorChrome.tsx (SRP: one file per concern).
import { useEffect, useState } from 'react'
import { type TileCategory, type Visual, genderize, tilesForStyle, visualForTileId } from '@/game/artStyle'
import type { EntityVariant } from '@/game/types'
import type { AnimDirection, AnimFrame, AnimTrigger, EntityAnimation } from '@/game/runtime/entityAnimation'
import { spriteFromEntity, entityFromSprite, randomMovementAnimation } from '@/game/runtime/entityAnimation'
import {
  resolveAnimatedSettings,
  type Animation as TileAnim,
  type AnimationKind,
  type SettingsAnimation,
  type SpriteAnimation,
  type AnimationTrack,
  type SettingKey,
  type Ease as AnimEase,
  type TriggerEvent as AnimTriggerEvent,
  type TileStyle,
  type TileView,
} from '@/engine/animation/tileAnimation'
import { SELECT_CLS, INPUT_CLS } from './editorConfig'

/** The trigger events an animation can fire on (dropdown order). */
const ANIM_TRIGGERS: ReadonlyArray<{ id: AnimTrigger['on']; label: string }> = [
  { id: 'idle', label: 'idle' },
  { id: 'move', label: 'move' },
  { id: 'attack', label: 'attack' },
  { id: 'interact', label: 'interact' },
  { id: 'key', label: 'key' },
]

const ANIM_DIRECTIONS: readonly AnimDirection[] = ['up', 'down', 'left', 'right', 'any']

/** The VISUAL a frame slot renders — resolved the SAME way the canvas resolves a tile (label→baked image via
 *  `visualForTileId`), so the preview matches play: a `char` frame is a glyph gendered to the entity's variant;
 *  a `tileId` frame is that tile's baked IMAGE (or its glyph in ASCII); an empty frame is the element's OWN
 *  base visual (frame 0 = the element as-is). This is the #55 fix — a frame that references a baked tile shows
 *  that tile's IMAGE, never a raw glyph / a generic 🖼 placeholder. */
function frameVisual(frame: AnimFrame, base: Visual, variant?: EntityVariant): Visual {
  if (frame.char) return { kind: 'glyph', char: genderize(frame.char, variant) }
  if (frame.tileId) {
    const v = visualForTileId(frame.tileId)
    if (v) return v.kind === 'glyph' ? { kind: 'glyph', char: genderize(v.char, variant), color: v.color } : v
  }
  return base
}

/** Draw a frame's resolved visual: a baked tile IMAGE via <img> (the same art the renderer draws), or the
 *  glyph char for an ASCII/glyph tile. NEVER a raw glyph where a baked image belongs (#55). `flipX` mirrors
 *  the thumbnail, matching the DATA flag the renderer honors. */
function FrameThumb({ visual, flipX }: { visual: Visual; flipX?: boolean }) {
  const mirror = flipX ? { display: 'inline-block', transform: 'scaleX(-1)' } : undefined
  if (visual.kind === 'image') {
    return <img src={visual.src} alt="" draggable={false} style={{ height: '1.5rem', width: '1.5rem', objectFit: 'contain', imageRendering: 'pixelated', ...mirror }} />
  }
  return <span style={mirror}>{visual.kind === 'glyph' ? visual.char : '·'}</span>
}

/** One frame slot: the resolved baked IMAGE/glyph (mirrored when flipped) + a flip toggle. Clicking the tile
 *  opens the picker for this frame; ⇄ mirrors the frame (a DATA property the renderer honors). */
function FrameSlot({
  frame, index, active, onOpen, onToggleFlip, baseVisual, variant,
}: {
  frame: AnimFrame
  index: number
  active: boolean
  onOpen: () => void
  onToggleFlip: () => void
  baseVisual: Visual
  variant?: EntityVariant
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <button
        onClick={onOpen}
        aria-pressed={active}
        title={`Frame ${index} — click to pick a tile`}
        className={`flex h-9 w-9 items-center justify-center rounded border text-lg leading-none transition-colors ${
          active ? 'border-cyan-400 bg-cyan-900/40' : 'border-white/15 bg-black/40 hover:bg-white/10'
        }`}
      >
        <FrameThumb visual={frameVisual(frame, baseVisual, variant)} flipX={frame.flipX} />
      </button>
      <button
        onClick={onToggleFlip}
        aria-pressed={!!frame.flipX}
        title="Flip horizontally (mirror this frame)"
        className={`rounded px-1 text-[9px] leading-none transition-colors ${
          frame.flipX ? 'bg-cyan-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
        }`}
      >
        ⇄
      </button>
      <span className="text-[8px] leading-none text-gray-600">{index}</span>
    </div>
  )
}

/** The category-constrained tile grid for a frame — only the entity's own category (units for a
 *  character), so a person's frames pick from people/monsters, never buildings. "Base" clears the
 *  frame back to the entity's own tile (an empty frame). */
function FramePicker({
  styleId, category, onPick, onClose,
}: {
  styleId: string
  category: TileCategory
  onPick: (patch: Partial<AnimFrame>) => void
  onClose: () => void
}) {
  const tiles = tilesForStyle(styleId)[category]
  return (
    <div className="mt-1.5 rounded border border-cyan-500/30 bg-black/60 p-1.5">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[9px] uppercase tracking-wide text-gray-500">Pick {category} frame</span>
        <button onClick={onClose} aria-label="Close tile picker" className="rounded px-1 text-[10px] text-gray-400 hover:text-white">✕</button>
      </div>
      <div className="grid max-h-44 grid-cols-6 gap-1 overflow-y-auto">
        <button
          onClick={() => onPick({ tileId: undefined, char: undefined })}
          title="Base tile — the entity's own"
          className="flex flex-col items-center gap-0.5 rounded border border-white/10 bg-black/40 px-1 py-1 hover:bg-white/10"
        >
          <span className="text-base leading-none">·</span>
          <span className="text-[8px] text-gray-400">base</span>
        </button>
        {tiles.map(t => (
          <button
            key={t.id}
            onClick={() => onPick({ tileId: t.id, char: undefined })}
            title={`${t.label} (${t.id})`}
            className="flex flex-col items-center gap-0.5 rounded border border-white/10 bg-black/40 px-1 py-1 hover:bg-white/10"
          >
            <FrameThumb visual={t.visual} />
            <span className="w-full truncate text-center text-[8px] text-gray-400">{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** One animation's full editing row: name, trigger + its conditional fields, direction, timing,
 *  loop, the frame strip + picker, and a delete. Every edit patches this animation immutably up
 *  through `onAnim`. */
function AnimationRow({
  anim, category, styleId, onAnim, onRemove, baseVisual, variant,
}: {
  anim: EntityAnimation
  category: TileCategory
  styleId: string
  onAnim: (next: EntityAnimation) => void
  onRemove: () => void
  baseVisual: Visual
  variant?: EntityVariant
}) {
  const [pickerFrame, setPickerFrame] = useState<number | null>(null)
  const patch = (p: Partial<EntityAnimation>) => onAnim({ ...anim, ...p })
  const patchTrigger = (p: Partial<AnimTrigger>) => patch({ trigger: { ...anim.trigger, ...p } })
  const patchFrame = (fi: number, p: Partial<AnimFrame>) =>
    patch({ frames: anim.frames.map((f, j) => (j === fi ? { ...f, ...p } : f)) })
  const addFrame = () => patch({ frames: [...anim.frames, {}] })
  const removeFrame = () => {
    if (anim.frames.length > 1) patch({ frames: anim.frames.slice(0, -1) })
    setPickerFrame(null)
  }
  const numMs = (raw: string) => Math.max(0, parseInt(raw, 10) || 0)

  return (
    <div className="space-y-1.5 rounded border border-cyan-500/20 bg-black/40 p-1.5">
      <div className="flex items-center gap-1">
        <input value={anim.name} onChange={e => patch({ name: e.target.value })} aria-label="Animation name" placeholder="name" className={INPUT_CLS} />
        <button onClick={onRemove} aria-label="Delete animation" title="Delete animation" className="rounded bg-red-900/70 px-1.5 py-1 text-[10px] font-bold text-red-200 hover:bg-red-800">✕</button>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[10px] font-bold text-cyan-300">When</span>
        <select value={anim.trigger.on} onChange={e => patchTrigger({ on: e.target.value as AnimTrigger['on'] })} aria-label="Animation trigger" className={SELECT_CLS}>
          {ANIM_TRIGGERS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <span aria-hidden className="text-gray-500">·</span>
        <select value={anim.direction} onChange={e => patch({ direction: e.target.value as AnimDirection })} aria-label="Animation direction" className={SELECT_CLS}>
          {ANIM_DIRECTIONS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      {anim.trigger.on === 'move' && (
        <label className="flex items-center gap-1 text-[10px] text-gray-300">
          <input type="checkbox" checked={!!anim.trigger.whileRunning} onChange={e => patchTrigger({ whileRunning: e.target.checked })} />
          while running (Shift)
        </label>
      )}
      {anim.trigger.on === 'key' && (
        <div className="flex items-center gap-1">
          <input value={anim.trigger.key ?? ''} onChange={e => patchTrigger({ key: e.target.value })} placeholder="key (e.g. Shift)" aria-label="Trigger key" className={INPUT_CLS} />
          <select value={anim.trigger.mode ?? 'hold'} onChange={e => patchTrigger({ mode: e.target.value as 'tap' | 'hold' })} aria-label="Key mode" className={SELECT_CLS}>
            <option value="tap">tap</option>
            <option value="hold">hold</option>
          </select>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-[10px] text-gray-300">
        <label className="flex items-center gap-1">
          dur
          <input type="number" min={0} value={anim.durationMs} onChange={e => patch({ durationMs: numMs(e.target.value) })} aria-label="Duration in ms" className="w-14 rounded bg-gray-800 p-1 text-xs text-gray-100" />
          ms
        </label>
        <label className="flex items-center gap-1">
          delay
          <input type="number" min={0} value={anim.loopDelayMs ?? 0} onChange={e => patch({ loopDelayMs: numMs(e.target.value) })} aria-label="Loop delay in ms" className="w-14 rounded bg-gray-800 p-1 text-xs text-gray-100" />
          ms
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={anim.loop} onChange={e => patch({ loop: e.target.checked })} />
          loop
        </label>
      </div>

      <div>
        <p className="mb-1 text-[9px] uppercase tracking-wide text-gray-500">Frames — frame 0 is the entity's own tile</p>
        <div className="flex flex-wrap items-start gap-1.5">
          {anim.frames.map((f, fi) => (
            <FrameSlot
              key={fi}
              frame={f}
              index={fi}
              active={pickerFrame === fi}
              onOpen={() => setPickerFrame(p => (p === fi ? null : fi))}
              onToggleFlip={() => patchFrame(fi, { flipX: !f.flipX })}
              baseVisual={baseVisual}
              variant={variant}
            />
          ))}
          <div className="flex flex-col gap-0.5">
            <button onClick={addFrame} aria-label="Add frame" title="Add a frame" className="h-9 w-7 rounded border border-white/15 bg-black/40 text-sm font-bold text-cyan-300 hover:bg-white/10">+</button>
            <button onClick={removeFrame} disabled={anim.frames.length <= 1} aria-label="Remove last frame" title="Remove the last frame" className="h-5 w-7 rounded border border-white/10 bg-black/40 text-xs text-gray-400 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40">−</button>
          </div>
        </div>
        {pickerFrame != null && (
          <FramePicker
            styleId={styleId}
            category={category}
            onPick={p => { patchFrame(pickerFrame, p); setPickerFrame(null) }}
            onClose={() => setPickerFrame(null)}
          />
        )}
      </div>
    </div>
  )
}

// `AnimationRow` (above) is the reusable frame-swap editor; the standalone character `AnimationEditor` that
// wrapped it is GONE — units now author their frame-swap animations as the `sprite` KIND inside the shared
// `TileAnimationEditor` below (the character animation merged into the tile settings modal, per the user).

// ── ✦ TILE + UNIT animation editor — the ONE shared modal (settings AND sprite kinds) ────
// The dedicated modal body that authors an animation LIST (→ chaining) for the ONE selected tile OR unit.
// Two kinds share it:
//   - `settings` — tweens render settings (opacity, y-rise, colour, zoom…) `from → to` over one duration, with
//     start/loop delays, looping, ease, a trigger, and per-(style,view) scope — the pure `tileAnimation` engine.
//   - `sprite`   — a frame-swap cycle (walk/idle/attack) authored with the SAME `AnimationRow` a unit uses; it
//     reuses the entity frame model, so a unit edits its animations here and a tile can carry one too.
// Pure & props-driven: every edit flows up through `onChange` immutably; the only stateful bit is the live
// PREVIEW's RAF clock (which reflects the settings kind — sprite writes no render settings).

/** Every render setting a tile animation can drive, in picker order (opacity/y first — the fountain case). */
const ANIM_SETTING_KEYS: ReadonlyArray<{ key: SettingKey; label: string }> = [
  { key: 'opacity', label: 'opacity' },
  { key: 'y', label: 'y' },
  { key: 'x', label: 'x' },
  { key: 'zoom', label: 'zoom' },
  { key: 'width', label: 'width' },
  { key: 'height', label: 'height' },
  { key: 'rotate', label: 'rotate' },
  { key: 'zWidth', label: 'zWidth' },
  { key: 'zPos', label: 'zPos' },
  { key: 'heightLevel', label: 'heightLevel' },
  { key: 'color', label: 'color' },
  { key: 'zIndex', label: 'zIndex' },
  { key: 'display', label: 'display' },
]
const ANIM_EASES: readonly AnimEase[] = ['linear', 'sine', 'ease']
const ANIM_TILE_TRIGGERS: ReadonlyArray<{ id: AnimTriggerEvent; label: string }> = [
  { id: 'load', label: 'on load (ambient)' },
  { id: 'proximity', label: 'near hero' },
  { id: 'attack', label: 'on attack' },
  { id: 'interact', label: 'on interact' },
]
const ANIM_STYLES: readonly TileStyle[] = ['ascii', 'emoji']
const ANIM_VIEWS: readonly TileView[] = ['iso', '2d', 'top']

/** Parse a number field, falling back to `fb` on empty/invalid so the input never writes NaN. */
const numOr = (raw: string, fb: number): number => { const n = parseFloat(raw); return Number.isNaN(n) ? fb : n }

/** A fresh track for a newly-checked setting: colour/display carry string endpoints, everything else 0→1. */
function defaultTrack(setting: SettingKey): AnimationTrack {
  if (setting === 'color') return { setting, from: '#ffffff', to: '#38bdf8' }
  if (setting === 'display') return { setting, from: 'all-faces', to: 'single' }
  return { setting, from: 0, to: 1 }
}

/** A blank settings animation for "Add" — ambient load loop, no tracks yet (the multi-picker adds them). */
function makeDefaultSettingsAnim(index: number): SettingsAnimation {
  return {
    id: `tileanim-${index}-${Date.now().toString(36)}`,
    name: 'new animation',
    kind: 'settings',
    tracks: [],
    durationMs: 1000,
    startDelayMs: 0,
    loopDelayMs: 0,
    loop: true,
    ease: 'sine',
    priority: 0,
    trigger: { on: 'load' },
  }
}

/** A blank sprite (frame-swap) animation for "Add" — a 2-frame looping move cycle, the SAME default the old
 *  character editor seeded. Frame 0 is the element's own tile (empty); the author swaps in tiles per frame. */
function makeDefaultSpriteAnim(index: number): SpriteAnimation {
  return {
    id: `spriteanim-${index}-${Date.now().toString(36)}`,
    name: 'new animation',
    kind: 'sprite',
    frames: [{}, {}],
    spriteTrigger: { on: 'move' },
    direction: 'down',
    durationMs: 300,
    loopDelayMs: 0,
    loop: true,
  }
}

/** The context a `sprite` row needs to render its frame strip + category-constrained picker (the same inputs
 *  the old character editor took): the element's tile category, the active style, its own base visual (the
 *  empty "base" frame preview), and its variant (so glyph frames preview gendered). */
export interface SpriteAnimationContext {
  category: TileCategory
  styleId: string
  baseVisual: Visual
  variant?: EntityVariant
}

/** ONE track's from/to editor — colour pickers for `color`, an all-faces/single toggle for `display`,
 *  numeric fields otherwise. Labels are `<setting> from` / `<setting> to` so each is uniquely addressable. */
function TrackRow({ track, onChange }: { track: AnimationTrack; onChange: (patch: Partial<AnimationTrack>) => void }) {
  const s = track.setting
  const field = (which: 'from' | 'to', value: number | string) => {
    if (s === 'color') {
      return <input type="color" value={String(value || '#ffffff')} onChange={e => onChange({ [which]: e.target.value })} aria-label={`${s} ${which}`} className="h-6 w-9 rounded bg-gray-800" />
    }
    if (s === 'display') {
      return (
        <select value={String(value)} onChange={e => onChange({ [which]: e.target.value })} aria-label={`${s} ${which}`} className="rounded bg-gray-800 p-1 text-[10px] text-gray-100">
          <option value="all-faces">all-faces</option>
          <option value="single">single</option>
        </select>
      )
    }
    return <input type="number" step={0.1} value={Number(value)} onChange={e => onChange({ [which]: numOr(e.target.value, 0) })} aria-label={`${s} ${which}`} className="w-16 rounded bg-gray-800 p-1 text-[10px] tabular-nums text-cyan-300" />
  }
  return (
    <div className="flex items-center gap-1.5 pl-1 text-[10px] text-gray-300">
      <span className="w-16 shrink-0 font-bold text-cyan-300">{s}</span>
      {field('from', track.from)}
      <span aria-hidden className="text-gray-500">→</span>
      {field('to', track.to)}
    </div>
  )
}

/** One toggle chip (scope styles/views). Empty scope list = "all", so a lit chip LIMITS to that token. */
function Chip({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} aria-pressed={on} aria-label={`scope ${label}`} className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${on ? 'bg-cyan-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>{label}</button>
  )
}

/** One settings animation's full editing block: name, the settings MULTI-PICKER (checkbox per SettingKey →
 *  a from/to track), timing (duration / start delay / loop delay / loop / ease / priority), the trigger
 *  (+radius for proximity), and the style/view scope chips. Every edit patches this animation immutably. */
function TileAnimationRow({ anim, onAnim, onRemove }: { anim: SettingsAnimation; onAnim: (next: SettingsAnimation) => void; onRemove: () => void }) {
  const patch = (p: Partial<SettingsAnimation>) => onAnim({ ...anim, ...p })
  const hasTrack = (s: SettingKey) => anim.tracks.some(t => t.setting === s)
  const toggleTrack = (s: SettingKey) =>
    patch({ tracks: hasTrack(s) ? anim.tracks.filter(t => t.setting !== s) : [...anim.tracks, defaultTrack(s)] })
  const patchTrack = (s: SettingKey, p: Partial<AnimationTrack>) =>
    patch({ tracks: anim.tracks.map(t => (t.setting === s ? { ...t, ...p } : t)) })
  const trigOn = anim.trigger?.on ?? 'load'
  const patchTrigger = (p: Partial<{ on: AnimTriggerEvent; radiusCells: number }>) =>
    patch({ trigger: { on: trigOn, ...anim.trigger, ...p } })
  // Scope: an empty (or absent) list means "all". Toggling the last member off drops the key back to "all".
  const toggleScope = (dim: 'styles' | 'views', token: TileStyle | TileView) => {
    const cur = (anim.scope?.[dim] ?? []) as string[]
    const next = cur.includes(token) ? cur.filter(x => x !== token) : [...cur, token]
    const scope = { ...anim.scope, [dim]: next.length ? next : undefined }
    if (!scope.styles && !scope.views) { patch({ scope: undefined }); return }
    patch({ scope })
  }

  return (
    <div className="space-y-1.5 rounded border border-fuchsia-500/25 bg-black/40 p-2">
      <div className="flex items-center gap-1">
        <input value={anim.name ?? ''} onChange={e => patch({ name: e.target.value })} aria-label="Animation name" placeholder="name" className={INPUT_CLS} />
        <span className="shrink-0 rounded bg-fuchsia-900/60 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-fuchsia-200">settings</span>
        <button onClick={onRemove} aria-label="Delete animation" title="Delete animation" className="shrink-0 rounded bg-red-900/70 px-1.5 py-1 text-[10px] font-bold text-red-200 hover:bg-red-800">✕</button>
      </div>

      {/* Settings MULTI-PICKER — check a setting to add its from/to track. */}
      <div>
        <p className="mb-1 text-[9px] uppercase tracking-wide text-gray-500">Animate settings</p>
        <div className="flex flex-wrap gap-x-2 gap-y-0.5">
          {ANIM_SETTING_KEYS.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-1 text-[10px] text-gray-300">
              <input type="checkbox" checked={hasTrack(key)} onChange={() => toggleTrack(key)} aria-label={`animate ${key}`} className="accent-fuchsia-500" />
              {label}
            </label>
          ))}
        </div>
        {anim.tracks.length > 0 && (
          <div className="mt-1.5 space-y-1">
            {anim.tracks.map(t => <TrackRow key={t.setting} track={t} onChange={p => patchTrack(t.setting, p)} />)}
          </div>
        )}
      </div>

      {/* Timing. */}
      <div className="flex flex-wrap items-center gap-2 border-t border-white/5 pt-1.5 text-[10px] text-gray-300">
        <label className="flex items-center gap-1">dur<input type="number" min={0} value={anim.durationMs} onChange={e => patch({ durationMs: numOr(e.target.value, 0) })} aria-label="duration" className="w-16 rounded bg-gray-800 p-1 text-xs text-gray-100" />ms</label>
        <label className="flex items-center gap-1">start<input type="number" min={0} value={anim.startDelayMs ?? 0} onChange={e => patch({ startDelayMs: numOr(e.target.value, 0) })} aria-label="start delay" className="w-16 rounded bg-gray-800 p-1 text-xs text-gray-100" />ms</label>
        <label className="flex items-center gap-1">loop gap<input type="number" min={0} value={anim.loopDelayMs ?? 0} onChange={e => patch({ loopDelayMs: numOr(e.target.value, 0) })} aria-label="loop delay" className="w-16 rounded bg-gray-800 p-1 text-xs text-gray-100" />ms</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={!!anim.loop} onChange={e => patch({ loop: e.target.checked })} aria-label="loop" className="accent-fuchsia-500" />loop</label>
        <label className="flex items-center gap-1" title="Ping-pong: play from→to then auto-reverse to→from each loop (e.g. grow then shrink)"><input type="checkbox" checked={!!anim.yoyo} onChange={e => patch({ yoyo: e.target.checked })} aria-label="yoyo" className="accent-fuchsia-500" />yoyo</label>
        <label className="flex items-center gap-1">ease
          <select value={anim.ease ?? 'linear'} onChange={e => patch({ ease: e.target.value as AnimEase })} aria-label="ease" className="rounded bg-gray-800 p-1 text-xs text-gray-100">
            {ANIM_EASES.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1">priority<input type="number" step={1} value={anim.priority ?? 0} onChange={e => patch({ priority: Math.round(numOr(e.target.value, 0)) })} aria-label="priority" className="w-12 rounded bg-gray-800 p-1 text-xs text-gray-100" /></label>
      </div>

      {/* Trigger (+ radius when proximity). */}
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-gray-300">
        <span className="font-bold text-cyan-300">When</span>
        <select value={trigOn} onChange={e => patchTrigger({ on: e.target.value as AnimTriggerEvent })} aria-label="trigger" className={SELECT_CLS}>
          {ANIM_TILE_TRIGGERS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        {trigOn === 'proximity' && (
          <label className="flex items-center gap-1">radius<input type="number" min={0} value={anim.trigger?.radiusCells ?? 3} onChange={e => patchTrigger({ radiusCells: numOr(e.target.value, 0) })} aria-label="proximity radius" className="w-14 rounded bg-gray-800 p-1 text-xs text-gray-100" />cells</label>
        )}
      </div>

      {/* Scope — which styles/views this plays in (none lit = all). */}
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-gray-400">
        <span className="font-bold text-gray-500">Style</span>
        {ANIM_STYLES.map(s => <Chip key={s} label={s} on={!!anim.scope?.styles?.includes(s)} onToggle={() => toggleScope('styles', s)} />)}
        <span className="ml-1 font-bold text-gray-500">View</span>
        {ANIM_VIEWS.map(v => <Chip key={v} label={v} on={!!anim.scope?.views?.includes(v)} onToggle={() => toggleScope('views', v)} />)}
      </div>
    </div>
  )
}

/** A `sprite` (frame-swap) animation row — the REAL editor. It reuses the SAME `AnimationRow` a unit's
 *  frame-swap uses by viewing the sprite envelope through the entity model (`entityFromSprite`) and mapping
 *  edits back (`spriteFromEntity`); the spread preserves any settings-only envelope extras (startDelay /
 *  priority / scope) the frame UI doesn't touch. This is how the character animation lives INSIDE the shared
 *  modal as the sprite kind. */
function SpriteAnimationRow({ anim, ctx, onAnim, onRemove }: {
  anim: SpriteAnimation
  ctx: SpriteAnimationContext
  onAnim: (next: SpriteAnimation) => void
  onRemove: () => void
}) {
  return (
    <AnimationRow
      anim={entityFromSprite(anim)}
      category={ctx.category}
      styleId={ctx.styleId}
      baseVisual={ctx.baseVisual}
      variant={ctx.variant}
      onAnim={next => onAnim({ ...anim, ...spriteFromEntity(next) })}
      onRemove={onRemove}
    />
  )
}

/** The live PREVIEW — one swatch driven by the WHOLE chain (`resolveAnimatedSettings`) on a RAF clock, so
 *  the author sees the composed result (opacity fade + y-rise + colour + zoom…) exactly as the engine plays
 *  it. Scope is ignored here (it composes every animation) so any authored track is visible while tuning. */
function TileAnimationPreview({ animations }: { animations: readonly TileAnim[] }) {
  const [nowMs, setNowMs] = useState(0)
  useEffect(() => {
    if (typeof requestAnimationFrame !== 'function') return
    let raf = 0
    const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
    const start = clock()
    const loop = () => { setNowMs(clock() - start); raf = requestAnimationFrame(loop) }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])
  const v = resolveAnimatedSettings(animations, nowMs, 0)
  const num = (key: SettingKey, fb: number) => (typeof v[key] === 'number' ? (v[key] as number) : fb)
  const opacity = num('opacity', 1)
  const x = num('x', 0), y = num('y', 0), rot = num('rotate', 0)
  const zoom = num('zoom', 1), width = num('width', 1), height = num('height', 1)
  const color = typeof v.color === 'string' ? v.color : '#38bdf8'
  const UNIT = 20 // px per tile-fraction/block unit in the little preview stage
  return (
    <div className="relative h-24 overflow-hidden rounded border border-white/10 bg-gradient-to-b from-slate-800 to-slate-900" aria-label="Animation preview" role="img">
      <span className="absolute left-1 top-1 text-[8px] uppercase tracking-wide text-gray-500">preview</span>
      <div className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-sm"
        style={{
          background: color,
          opacity,
          transform: `translate(${x * UNIT}px, ${-y * UNIT}px) rotate(${rot}rad) scale(${zoom * width}, ${zoom * height})`,
        }}
      />
    </div>
  )
}

export interface TileAnimationEditorProps {
  /** the element's authored animations (a LIST → chain order), mixing `settings` + `sprite` kinds. */
  animations: TileAnim[]
  /** what the animated element IS — surfaced in the header so it's unmistakable ('Tile' vs 'Character'). */
  elementType: 'Tile' | 'Character'
  /** the element's name, e.g. 'water_c' — shown beside the type. */
  elementLabel: string
  /** the context a `sprite` row + the "Add sprite animation" button need (frame picker category, style,
   *  base visual, variant). Required — every selected tile/unit can author a frame-swap animation. */
  spriteContext: SpriteAnimationContext
  /** which kinds this element may ADD. A tile authors both; a unit stores `EntityAnimation[]`, which only maps
   *  to the sprite kind, so its modal offers `['sprite']` (no settings add → nothing lost on the bridge back).
   *  Default both. Existing rows of any kind still render + delete regardless. */
  kinds?: readonly AnimationKind[]
  onChange: (next: TileAnim[]) => void
}

/** Author the DATA-DRIVEN animations that ride on ONE selected tile/asset OR unit — the ONE shared modal.
 *  `settings` rows tween render settings (the fountain opacity+height chain); `sprite` rows author frame-swap
 *  cycles (a unit's walk/idle, or a tile's flicker) with the reused character frame editor. Add/edit/remove;
 *  the live preview reflects the settings chain (sprite writes no render settings). */
export function TileAnimationEditor({ animations, elementType, elementLabel, spriteContext, kinds = ['settings', 'sprite'], onChange }: TileAnimationEditorProps) {
  const replace = (i: number, next: TileAnim) => onChange(animations.map((a, j) => (j === i ? next : a)))
  const remove = (i: number) => onChange(animations.filter((_, j) => j !== i))
  const addSettings = () => onChange([...animations, makeDefaultSettingsAnim(animations.length)])
  const addSprite = () => onChange([...animations, makeDefaultSpriteAnim(animations.length)])
  // 🎲 Random: append a RANDOMIZED movement animation (the user: "click animate and add a random animation
  // (movement) or build one manually"). It's a sprite-kind walk cycle (the unit's own tile → mirrored), so it
  // rides the same bridge a hand-built sprite does and is editable afterwards like any other row.
  const addRandom = () => onChange([...animations, spriteFromEntity(randomMovementAnimation())])

  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center justify-between rounded border border-white/10 bg-black/50 px-2 py-1.5">
        <span className="text-[11px] font-bold uppercase tracking-wider text-fuchsia-300">✦ {elementType} animation</span>
        <span className="text-[10px] text-gray-400">{elementLabel}</span>
      </div>

      <TileAnimationPreview animations={animations} />

      {/* Add buttons pinned ABOVE the list so they stay reachable however many animations exist — a long list
          no longer pushes them off the bottom (Alexander: "have the buttons up"). */}
      <div className="flex flex-wrap gap-1">
        {kinds.includes('settings') && (
          <button onClick={addSettings} className="flex-1 rounded bg-fuchsia-800 px-2 py-1 text-[11px] font-bold text-white transition-colors hover:bg-fuchsia-700">
            ✦ Add settings animation
          </button>
        )}
        {kinds.includes('sprite') && (
          <button onClick={addSprite} aria-label="Add sprite animation" className="flex-1 rounded bg-cyan-800 px-2 py-1 text-[11px] font-bold text-white transition-colors hover:bg-cyan-700">
            ✦ Add sprite animation
          </button>
        )}
        {kinds.includes('sprite') && (
          <button onClick={addRandom} aria-label="Add random animation" title="Drop in a randomized movement animation you can then tweak" className="flex-1 rounded bg-emerald-800 px-2 py-1 text-[11px] font-bold text-white transition-colors hover:bg-emerald-700">
            🎲 Random move
          </button>
        )}
      </div>

      {animations.length === 0 && (
        <p className="text-[10px] leading-tight text-gray-500">
          No animations yet — add one to make this {elementType.toLowerCase()} move. A settings animation tweens values (opacity, y-rise, colour…); a sprite animation swaps baked tile frames (walk / idle / attack). Chain several for a sequence.
        </p>
      )}

      {/* Rows render NEWEST-FIRST (most recently added on top) so a new animation is immediately visible under the
          buttons. Only the RENDER order is reversed — the underlying `animations` data order is untouched, so
          chaining/priority still read it in author order; each row keeps its ORIGINAL index so replace/remove hit
          the right entry. */}
      {animations.map((a, i) => ({ a, i })).reverse().map(({ a, i }) =>
        a.kind === 'settings'
          ? <TileAnimationRow key={a.id} anim={a} onAnim={next => replace(i, next)} onRemove={() => remove(i)} />
          : <SpriteAnimationRow key={a.id} anim={a} ctx={spriteContext} onAnim={next => replace(i, next)} onRemove={() => remove(i)} />,
      )}
    </div>
  )
}
