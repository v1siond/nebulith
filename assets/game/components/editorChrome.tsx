// Editor CHROME for the game-engine editor (hybrid layout, stage A): the slim
// left tool-rail, a reusable top-bar dropdown/popover, the ⚡ Generate + 🎨 Style
// controls, and the right-Inspector selection placeholder. Pure presentational +
// props-driven — all gameplay state/handlers live in the page; this is layout only.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ZoneId } from '@/engine/zones'
import { BUILT_IN_STYLES, type TileCategory, type TileDef, type Visual, genderize, tilesForStyle, visualForTileId } from '@/game/artStyle'
import type { EntityVariant } from '@/game/types'
import type { AnimDirection, AnimFrame, AnimTrigger, EntityAnimation } from '@/game/runtime/entityAnimation'
import { spriteFromEntity, entityFromSprite } from '@/game/runtime/entityAnimation'
import type { TilePose } from '@/engine/tileset/pose'
import type { AssetLight, TileDisplay, TileShape } from '@/engine/tileset/tileset'
import type { DepthDir } from '@/engine/render'
import { DEFAULT_ACTION_PARAMS, makeTrigger, type Trigger, type TriggerActionType, type TriggerEvent } from '@/game/runtime/trigger'
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
import { type EditorMode, SEASON_BTN, STAGE_VARIANTS, STAGE_ZONES } from './editorConfig'

// ── Tool-rail (left, slim icon strip) ────────────────────────────────
type RailDef = { mode: EditorMode; glyph: string; label: string; hint: string }

/** The rail modes, top→bottom. Glyphs mirror the approved design mockup. The Unit tool
 *  lives in the TOP NAV now (a dropdown, like ⚙ Stage / 🎨 Style), so it's off the rail. */
export const RAIL_MODES: readonly RailDef[] = [
  { mode: 'select', glyph: '↖', label: 'Select', hint: 'Select & inspect — click an element to edit it' },
  { mode: 'paint', glyph: '▢', label: 'Paint', hint: 'Paint tiles & ground onto selected cells' },
  { mode: 'building', glyph: '⌂', label: 'Building', hint: 'Place, move & rotate buildings' },
  { mode: 'connector', glyph: '↗', label: 'Connector', hint: 'Link cells to other levels & actions' },
]

const RAIL_ACTIVE: Record<EditorMode, string> = {
  select: 'bg-yellow-600 text-black',
  paint: 'bg-cyan-600 text-black',
  unit: 'bg-orange-600 text-black',
  building: 'bg-amber-700 text-white',
  connector: 'bg-purple-600 text-white',
}

function RailButton({ def, active, onClick }: { def: RailDef; active: boolean; onClick: () => void }) {
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        aria-label={def.label}
        title={def.hint}
        className={`flex w-full flex-col items-center gap-0.5 rounded-md py-2 transition-colors ${
          active ? RAIL_ACTIVE[def.mode] : 'text-gray-300 hover:bg-white/10 hover:text-white'
        }`}
      >
        <span aria-hidden className="text-lg leading-none">{def.glyph}</span>
        <span className="text-[9px] font-bold leading-none">{def.label}</span>
      </button>
      {/* hover flyout label for newbies — escapes the rail to the right */}
      <span className="pointer-events-none absolute left-full top-1/2 z-40 ml-2 hidden -translate-y-1/2 whitespace-nowrap rounded bg-black/95 px-2 py-1 text-[10px] text-gray-200 shadow-lg group-hover:block">
        {def.hint}
      </span>
    </div>
  )
}

/** The left tool-rail. Reflects the active editor mode and switches it on click. */
export function ToolRail({ mode, onPick }: { mode: EditorMode; onPick: (m: EditorMode) => void }) {
  return (
    <nav
      aria-label="Editor tools"
      className="fixed left-3 top-20 z-20 flex w-14 flex-col gap-1 rounded-lg border border-white/10 bg-black/90 p-1.5 font-mono shadow-lg shadow-black/40"
    >
      {RAIL_MODES.map(r => (
        <RailButton key={r.mode} def={r} active={mode === r.mode} onClick={() => onPick(r.mode)} />
      ))}
    </nav>
  )
}

// ── On-canvas quick-action toolbar (stage C) ─────────────────────────
/** One verb in the floating toolbar — a glyph + label that focuses an Inspector section. */
export type QuickAction = { key: string; glyph: string; label: string; onClick: () => void }

/**
 * A small floating toolbar drawn OVER the canvas, glued above the selected element.
 * It is pure affordance/navigation: each button opens + scrolls the matching Inspector
 * section (the deep edit UI stays in the panel). Positioning runs on a rAF loop that
 * reads the live camera/zoom via `getPos` and moves the node with a direct style write
 * — so it tracks smoothly while panning WITHOUT re-rendering React every frame. The
 * container is pointer-events-none; only the buttons take clicks, so canvas clicks pass
 * through everywhere else.
 */
export function QuickActionToolbar({
  actions,
  onDeselect,
  getPos,
}: {
  actions: readonly QuickAction[]
  onDeselect: () => void
  /** viewport coords of the selected element's centre, or null when off-screen/unavailable. */
  getPos: () => { x: number; y: number } | null
}) {
  const ref = useRef<HTMLDivElement>(null)
  // Keep the latest projector in a ref so the rAF loop mounts once yet always reads fresh.
  const getPosRef = useRef(getPos)
  getPosRef.current = getPos

  useEffect(() => {
    let raf = 0
    const tick = () => {
      const el = ref.current
      if (el) {
        const p = getPosRef.current()
        if (!p) {
          el.style.opacity = '0'
        } else {
          const w = el.offsetWidth
          const h = el.offsetHeight
          const gap = 14 // sit just above the element
          const left = Math.max(8, Math.min(p.x - w / 2, window.innerWidth - w - 8))
          const top = Math.max(8, Math.min(p.y - h - gap, window.innerHeight - h - 8))
          el.style.transform = `translate3d(${left}px, ${top}px, 0)`
          el.style.opacity = '1'
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label="Quick actions"
      style={{ opacity: 0, willChange: 'transform' }}
      className="pointer-events-none fixed left-0 top-0 z-30 flex items-center gap-0.5 rounded-lg border border-white/15 bg-black/90 p-1 font-mono shadow-xl shadow-black/60 backdrop-blur-sm"
    >
      {actions.map(a => (
        <button
          key={a.key}
          type="button"
          onClick={a.onClick}
          title={a.label}
          aria-label={a.label}
          className="pointer-events-auto flex items-center gap-1 rounded px-2 py-1 text-[11px] font-bold leading-none text-gray-200 transition-colors hover:bg-white/15 hover:text-white"
        >
          <span aria-hidden className="text-xs">{a.glyph}</span>
          <span>{a.label}</span>
        </button>
      ))}
      <button
        type="button"
        onClick={onDeselect}
        title="Deselect"
        aria-label="Deselect"
        className="pointer-events-auto ml-0.5 rounded px-1.5 py-1 text-[11px] font-bold leading-none text-gray-400 transition-colors hover:bg-red-600/80 hover:text-white"
      >
        ✕
      </button>
    </div>
  )
}

// ── Dropdown / popover (top-bar menus) ───────────────────────────────
/**
 * A trigger button + a fixed-position popover anchored under it. `fixed` (not
 * absolute) so the menu escapes the top bar's `overflow-x-auto` clipping, the same
 * trick the Load list already uses. Closes on outside-click / Escape. `children`
 * is a render-prop given a `close` callback so items can dismiss after acting.
 */
export function Dropdown({
  label,
  title,
  btnClass = 'bg-gray-700 hover:bg-gray-600',
  align = 'left',
  panelClass = 'w-64',
  children,
}: {
  label: React.ReactNode
  title?: string
  btnClass?: string
  align?: 'left' | 'right'
  panelClass?: string
  children: (close: () => void) => React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const close = () => setOpen(false)

  useLayoutEffect(() => {
    if (open && btnRef.current) setRect(btnRef.current.getBoundingClientRect())
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return
      if (panelRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const style: React.CSSProperties | undefined = rect
    ? align === 'right'
      ? { position: 'fixed', top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) }
      : { position: 'fixed', top: rect.bottom + 6, left: rect.left }
    : undefined

  return (
    <div className="relative shrink-0">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        title={title}
        className={`flex items-center gap-1 rounded px-3 py-1 text-xs font-bold transition-colors ${btnClass}`}
      >
        {label}
        <span aria-hidden className="text-[8px] opacity-70">▾</span>
      </button>
      {open && style && (
        <div
          ref={panelRef}
          style={style}
          className={`z-40 max-h-[70vh] overflow-y-auto rounded-lg border border-white/10 bg-gray-950 p-3 font-mono text-white shadow-2xl ${panelClass}`}
        >
          {children(close)}
        </div>
      )}
    </div>
  )
}

// ── ⚡ Generate (zone × variant) ──────────────────────────────────────
/** The stage-preset controls (zone picker + variant generate buttons). Shared by
 *  the top-bar Generate dropdown and the Inspector's nothing-selected stage panel. */
export function GenerateControls({
  zone,
  onZone,
  onGenerate,
}: {
  zone: ZoneId
  onZone: (z: ZoneId) => void
  onGenerate: (zone: ZoneId, variant: (typeof STAGE_VARIANTS)[number]) => void
}) {
  return (
    <div>
      <p className="mb-1 text-xs text-gray-400">Zone</p>
      <div className="mb-2 grid grid-cols-3 gap-1">
        {STAGE_ZONES.map(z => (
          <button
            key={z}
            onClick={() => onZone(z)}
            aria-pressed={zone === z}
            className={`rounded px-2 py-1 text-xs capitalize transition-colors ${
              zone === z ? SEASON_BTN[z] : 'bg-gray-700 hover:bg-gray-600'
            }`}
          >
            {z}
          </button>
        ))}
      </div>
      <p className="mb-1 text-xs text-gray-400">Variant — click to generate</p>
      <div className="grid grid-cols-3 gap-1">
        {STAGE_VARIANTS.map(v => (
          <button
            key={v}
            onClick={() => onGenerate(zone, v)}
            className="rounded bg-purple-700 px-2 py-1.5 text-xs capitalize transition-colors hover:bg-purple-600"
            title={`Generate a randomized ${zone} ${v.replace('-', ' ')}`}
          >
            {v.replace('-', ' ')}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-gray-500">
        Pick a variant to generate a randomized {zone} stage — forest, town, a much larger city, a cavern, or a temple dungeon.
      </p>
    </div>
  )
}

// ── 🎨 Style (art skin) — the global reskin switch (stage D) ─────────
/** The art-style picker: pick a built-in style → the whole world reskins instantly. ASCII is
 *  the default (byte-identical to the classic renderers); Emoji proves the swap with zero assets. */
export function StylePicker({ activeId, onPick, onClose }: { activeId: string; onPick: (id: string) => void; onClose?: () => void }) {
  return (
    <div className="space-y-1">
      <p className="mb-1 text-[10px] uppercase tracking-wide text-gray-500">Art style — one switch reskins everything</p>
      {BUILT_IN_STYLES.map(s => {
        const active = s.id === activeId
        return (
          <button
            key={s.id}
            onClick={() => { onPick(s.id); onClose?.() }}
            aria-pressed={active}
            className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-xs font-bold transition-colors ${
              active ? 'bg-cyan-800 text-white' : 'bg-gray-800/60 text-gray-300 hover:bg-gray-700'
            }`}
          >
            <span>{s.icon} {s.name}</span>
            {active && <span aria-hidden className="text-cyan-300">✓</span>}
          </button>
        )
      })}
      <p className="pt-1 text-[10px] leading-tight text-gray-500">
        Every element follows the active style — unless you pin a specific tile via the Tile Library (◰ Art).
      </p>
    </div>
  )
}

// ── ◰ Tile Library (stage D) — per-element override picker ───────────
const LIBRARY_CATEGORIES: readonly TileCategory[] = ['terrain', 'buildings', 'units', 'nature']

/** The shared categorized tile GRID: every tile of a style's `groups`, grouped by category, 4-per-row.
 *  Each tile is a button that highlights when `isOn(tile)` and calls `onPick(tile)`. Reused by the Tile
 *  Library (pins a tile to the selected element) and the Paint palette (arms a placement brush) so both
 *  read as the exact same tileset grid. */
function TileCategoryGrid({
  groups,
  isOn,
  onPick,
}: {
  groups: Record<TileCategory, TileDef[]>
  isOn: (tile: TileDef) => boolean
  onPick: (tile: TileDef) => void
}) {
  return (
    <>
      {LIBRARY_CATEGORIES.map(cat =>
        groups[cat].length === 0 ? null : (
          <div key={cat}>
            <p className="mb-1 text-[10px] uppercase tracking-wide text-gray-500">{cat}</p>
            <div className="grid grid-cols-4 gap-1">
              {groups[cat].map(t => {
                const on = isOn(t)
                return (
                  <button
                    key={t.id}
                    onClick={() => onPick(t)}
                    title={`${t.label} (${t.id})`}
                    aria-pressed={on}
                    className={`flex flex-col items-center gap-0.5 rounded border px-1 py-1.5 transition-colors ${
                      on ? 'border-cyan-400 bg-cyan-900/40' : 'border-white/10 bg-black/40 hover:bg-white/10'
                    }`}
                  >
                    {t.visual.kind === 'image'
                      ? <img src={t.visual.src} alt={t.label} className="h-5 w-5 object-contain" />
                      : <span className="text-lg leading-none">{t.visual.kind === 'glyph' ? t.visual.char : ''}</span>}
                    <span className="text-[9px] text-gray-400">{t.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ),
      )}
    </>
  )
}

/** The Tile Library body: every tile of the active style, grouped by category. Picking one pins
 *  it to the selected element (a per-element override that beats the global style); "Follow style"
 *  clears the override so the element tracks the active skin again. */
export function TileLibraryBody({
  styleId,
  styleName,
  override,
  onPick,
}: {
  styleId: string
  styleName: string
  override?: string | null
  onPick: (tileId: string | null) => void
}) {
  const groups = tilesForStyle(styleId)
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-gray-400">
          <span className="text-cyan-300">{styleName}</span> tiles — pick one to pin it to this element.
        </p>
        <button
          onClick={() => onPick(null)}
          disabled={!override}
          className={`shrink-0 rounded px-2 py-1 text-[10px] font-bold transition-colors ${
            override ? 'bg-gray-700 text-gray-100 hover:bg-gray-600' : 'cursor-not-allowed bg-gray-800/50 text-gray-600'
          }`}
        >
          Follow style
        </button>
      </div>
      <TileCategoryGrid groups={groups} isOn={t => override === t.id} onPick={t => onPick(t.id)} />
    </div>
  )
}

/** The Paint palette body — the "tileset builder" tile source. It shows the SAME categorized tile grid
 *  as the Tile Library (every terrain / building / unit / nature tile of the active style), but each click
 *  ARMS that tile as the placement brush instead of pinning an element. Clicking the armed tile again — or
 *  Disarm — clears it (onArm(null)). The page then routes a canvas click through tilePlacement by category
 *  (terrain → ground, nature/buildings → stacked asset, units → entity). */
export function TilePalette({
  styleId,
  styleName,
  armedId,
  onArm,
}: {
  styleId: string
  styleName: string
  armedId: string | null
  onArm: (tile: TileDef | null) => void
}) {
  const groups = tilesForStyle(styleId)
  const armed = armedId ? (Object.values(groups).flat() as TileDef[]).find(t => t.id === armedId) ?? null : null
  return (
    <div className="space-y-3" data-testid="tile-palette">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] leading-tight text-gray-400">
          {armed
            ? <>Brush: <span className="font-bold text-cyan-300">{armed.label}</span> — click cells to place, ⌥Alt-click to remove.</>
            : <><span className="text-cyan-300">{styleName}</span> tiles — pick one, then click the map to place it.</>}
        </p>
        <button
          onClick={() => onArm(null)}
          disabled={!armed}
          className={`shrink-0 rounded px-2 py-1 text-[10px] font-bold transition-colors ${
            armed ? 'bg-gray-700 text-gray-100 hover:bg-gray-600' : 'cursor-not-allowed bg-gray-800/50 text-gray-600'
          }`}
        >
          Disarm
        </button>
      </div>
      <TileCategoryGrid groups={groups} isOn={t => armedId === t.id} onPick={onArm} />
    </div>
  )
}

// Inspector controls (◰ Art section, pose editor, per-tile property panel) live in editorInspector.tsx.
export { ArtSection, WEAPON_KINDS, PoseControls, TileControls, PropertiesPanel, type DimAxis, type ElementDims, type TileControlModel, type PropertiesPanelProps } from './editorInspector'

const fpsColor = (v: number) => (v >= 55 ? '#22c55e' : v >= 45 ? '#eab308' : v >= 30 ? '#f97316' : '#ef4444')

/** Compact FPS readout (#86). `variant='nav'` = an inline pill for the editor top bar (edit/show);
 *  `variant='floating'` = a fixed corner box for play mode. One upstream `useFps()` feeds both. */
export function FpsReadout({ fps, variant }: { fps: number; variant: 'nav' | 'floating' }) {
  const body = (
    <span className="font-mono text-xs" title="Frames per second">
      <span className="text-gray-400">FPS </span>
      <span style={{ color: fpsColor(fps), fontWeight: 700 }}>{fps || '—'}</span>
    </span>
  )
  if (variant === 'floating') {
    return <div className="fixed right-4 top-4 z-30 rounded-lg border border-white/10 bg-black/80 px-3 py-1.5 shadow-lg">{body}</div>
  }
  return <span className="shrink-0 rounded bg-white/5 px-2 py-1">{body}</span>
}

// ── Inspector selection placeholder (stage B builds the real morph) ──
const SELECTION_KIND_COLOR: Record<string, string> = {
  player: 'text-yellow-300',
  enemy: 'text-red-300',
  npc: 'text-cyan-300',
  building: 'text-amber-300',
  cell: 'text-cyan-300',
  connector: 'text-purple-300',
}

// ── Morphing-Inspector selection header + not-yet-built section stubs ─
/** Compact identity header at the top of a morphed selection (kind + coordinates). */
export function SelectionHeader({ kind, label, coords }: { kind: string; label: string; coords?: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/60 px-3 py-2 shadow-lg shadow-black/40">
      <span className={`text-xs font-bold uppercase tracking-wider ${SELECTION_KIND_COLOR[kind] ?? 'text-orange-300'}`}>
        ▸ {label}
      </span>
      {coords && <span className="text-[10px] text-gray-500">{coords}</span>}
    </div>
  )
}

// ── Trigger editor (stage E) — "When [event] → do [action]." ─────────
// The unified trigger authoring UI. One editor serves both a CELL (events enter /
// interact) and a UNIT (event defeat) — the `events` prop picks which. Pure &
// props-driven: it holds no state; every edit flows up through `onChange`.

/** Human labels for the event dropdown. */
const TRIGGER_EVENT_LABEL: Record<TriggerEvent, string> = {
  enter: 'on enter',
  interact: 'on interact',
  defeat: 'on defeat',
}

/** Human labels + order for the action dropdown (the playable verbs come first). */
const TRIGGER_ACTIONS: ReadonlyArray<{ id: TriggerActionType; label: string }> = [
  { id: 'goto', label: 'go to level' },
  { id: 'win', label: 'win' },
  { id: 'message', label: 'show message' },
  { id: 'spawn', label: 'spawn units' },
  { id: 'give', label: 'give item' },
  { id: 'lose', label: 'lose' },
]

export interface TriggerEditorProps {
  triggers: Trigger[]
  /** which events this selection allows: cell → [enter, interact]; unit → [defeat]. */
  events: readonly TriggerEvent[]
  /** templates to pick from for a `go to level` action (already excludes the current one). */
  templates: ReadonlyArray<{ id: string; name: string }>
  /** enemy roster for a `spawn units` action. */
  enemyTypes: readonly string[]
  onChange: (next: Trigger[]) => void
}

const SELECT_CLS = 'flex-1 rounded bg-gray-800 p-1 text-xs text-gray-100'
const INPUT_CLS = 'w-full rounded bg-gray-800 p-1 text-xs text-gray-100'

/** The real trigger authoring editor — add / edit / remove multiple triggers. */
export function TriggerEditor({ triggers, events, templates, enemyTypes, onChange }: TriggerEditorProps) {
  const replace = (i: number, next: Trigger) => onChange(triggers.map((t, j) => (j === i ? next : t)))
  const setEvent = (i: number, event: TriggerEvent) => replace(i, { ...triggers[i], event } as Trigger)
  const setAction = (i: number, action: TriggerActionType) =>
    replace(i, { id: triggers[i].id, event: triggers[i].event, action, params: DEFAULT_ACTION_PARAMS[action]() } as Trigger)
  // Merge a params patch (narrowing handled by the per-action fields that call it).
  const patchParams = (i: number, patch: Record<string, unknown>) =>
    replace(i, { ...triggers[i], params: { ...triggers[i].params, ...patch } } as Trigger)
  const remove = (i: number) => onChange(triggers.filter((_, j) => j !== i))
  const add = () => onChange([...triggers, makeTrigger(events[0], 'win')])

  return (
    <div className="space-y-2 text-xs">
      {triggers.length === 0 && (
        <p className="text-[10px] leading-tight text-gray-500">No triggers yet — add one to make this cell do something.</p>
      )}
      {triggers.map((t, i) => (
        <div key={t.id} className="space-y-1 rounded border border-yellow-500/20 bg-black/40 p-1.5">
          <div className="flex items-center gap-1">
            <span className="text-[10px] font-bold text-yellow-300">When</span>
            <select value={t.event} onChange={e => setEvent(i, e.target.value as TriggerEvent)} aria-label="Trigger event" className={SELECT_CLS}>
              {events.map(ev => <option key={ev} value={ev}>{TRIGGER_EVENT_LABEL[ev]}</option>)}
            </select>
            <span aria-hidden className="text-gray-500">→</span>
            <select value={t.action} onChange={e => setAction(i, e.target.value as TriggerActionType)} aria-label="Trigger action" className={SELECT_CLS}>
              {TRIGGER_ACTIONS.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
            <button onClick={() => remove(i)} aria-label="Remove trigger" title="Remove trigger" className="rounded bg-red-900/70 px-1.5 py-1 text-[10px] font-bold text-red-200 hover:bg-red-800">✕</button>
          </div>
          <TriggerParamsFields trigger={t} templates={templates} enemyTypes={enemyTypes} onPatch={patch => patchParams(i, patch)} />
        </div>
      ))}
      <button onClick={add} className="w-full rounded bg-yellow-700/80 px-2 py-1 text-[11px] font-bold text-white transition-colors hover:bg-yellow-600">
        ⚡ Add trigger
      </button>
    </div>
  )
}

/** The action-specific parameter inputs (dispatch on the action, not a chain). */
function TriggerParamsFields({
  trigger, templates, enemyTypes, onPatch,
}: {
  trigger: Trigger
  templates: ReadonlyArray<{ id: string; name: string }>
  enemyTypes: readonly string[]
  onPatch: (patch: Record<string, unknown>) => void
}) {
  if (trigger.action === 'goto') {
    return (
      <select value={trigger.params.templateId} onChange={e => onPatch({ templateId: e.target.value })} aria-label="Target level" className={INPUT_CLS}>
        <option value="">Target level…</option>
        {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
    )
  }
  if (trigger.action === 'spawn') {
    return (
      <div className="flex items-center gap-1">
        <select value={trigger.params.enemyType} onChange={e => onPatch({ enemyType: e.target.value })} aria-label="Enemy type to spawn" className={SELECT_CLS}>
          {enemyTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <span className="text-[10px] text-gray-400">×</span>
        <input type="number" min={1} value={trigger.params.count} onChange={e => onPatch({ count: Math.max(1, parseInt(e.target.value, 10) || 1) })} aria-label="How many to spawn" className="w-14 rounded bg-gray-800 p-1 text-xs text-gray-100" />
      </div>
    )
  }
  if (trigger.action === 'give') {
    return (
      <input type="text" value={trigger.params.itemId} onChange={e => onPatch({ itemId: e.target.value })} placeholder="Item id to give" aria-label="Item to give" className={INPUT_CLS} />
    )
  }
  if (trigger.action === 'message') {
    return (
      <input type="text" value={trigger.params.text} onChange={e => onPatch({ text: e.target.value })} placeholder="Message to show…" aria-label="Message text" className={INPUT_CLS} />
    )
  }
  // win / lose take no params.
  return null
}

// ── ✦ Animation editor (stage 2, #91) — author DATA-DRIVEN per-entity animations ─────
// The Inspector authoring UI for `entity.animations`. EVERY entity carries a list of
// EntityAnimation (the player IS an entity, so this authors the live hero too); the renderer
// already plays them by trigger + direction, so saving an animation here makes it play in-game
// with NO extra code. Pure & props-driven like TriggerEditor — the only local state is which
// frame's tile-picker is open; every edit flows up through `onChange` immutably.

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

  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center justify-between rounded border border-white/10 bg-black/50 px-2 py-1.5">
        <span className="text-[11px] font-bold uppercase tracking-wider text-fuchsia-300">✦ {elementType} animation</span>
        <span className="text-[10px] text-gray-400">{elementLabel}</span>
      </div>

      <TileAnimationPreview animations={animations} />

      {animations.length === 0 && (
        <p className="text-[10px] leading-tight text-gray-500">
          No animations yet — add one to make this {elementType.toLowerCase()} move. A settings animation tweens values (opacity, y-rise, colour…); a sprite animation swaps baked tile frames (walk / idle / attack). Chain several for a sequence.
        </p>
      )}

      {animations.map((a, i) =>
        a.kind === 'settings'
          ? <TileAnimationRow key={a.id} anim={a} onAnim={next => replace(i, next)} onRemove={() => remove(i)} />
          : <SpriteAnimationRow key={a.id} anim={a} ctx={spriteContext} onAnim={next => replace(i, next)} onRemove={() => remove(i)} />,
      )}

      <div className="flex gap-1">
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
      </div>
    </div>
  )
}
