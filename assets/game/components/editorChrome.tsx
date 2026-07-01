// Editor CHROME for the game-engine editor (hybrid layout, stage A): the slim
// left tool-rail, a reusable top-bar dropdown/popover, the ⚡ Generate + 🎨 Style
// controls, and the right-Inspector selection placeholder. Pure presentational +
// props-driven — all gameplay state/handlers live in the page; this is layout only.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ZoneId } from '@/engine/zones'
import { BUILT_IN_STYLES, type TileCategory, tilesForStyle } from '@/game/artStyle'
import { DEFAULT_ACTION_PARAMS, makeTrigger, type Trigger, type TriggerActionType, type TriggerEvent } from '@/game/runtime/trigger'
import { type EditorMode, SEASON_BTN, STAGE_VARIANTS, STAGE_ZONES } from './editorConfig'

// ── Tool-rail (left, slim icon strip) ────────────────────────────────
type RailDef = { mode: EditorMode; glyph: string; label: string; hint: string }

/** The five modes, top→bottom. Glyphs mirror the approved design mockup. */
export const RAIL_MODES: readonly RailDef[] = [
  { mode: 'select', glyph: '↖', label: 'Select', hint: 'Select & inspect — click an element to edit it' },
  { mode: 'paint', glyph: '▢', label: 'Paint', hint: 'Paint tiles & ground onto selected cells' },
  { mode: 'unit', glyph: '◈', label: 'Unit', hint: 'Place units — player, enemies, NPCs' },
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
      {LIBRARY_CATEGORIES.map(cat =>
        groups[cat].length === 0 ? null : (
          <div key={cat}>
            <p className="mb-1 text-[10px] uppercase tracking-wide text-gray-500">{cat}</p>
            <div className="grid grid-cols-4 gap-1">
              {groups[cat].map(t => {
                const on = override === t.id
                return (
                  <button
                    key={t.id}
                    onClick={() => onPick(t.id)}
                    title={`${t.label} (${t.id})`}
                    aria-pressed={on}
                    className={`flex flex-col items-center gap-0.5 rounded border px-1 py-1.5 transition-colors ${
                      on ? 'border-cyan-400 bg-cyan-900/40' : 'border-white/10 bg-black/40 hover:bg-white/10'
                    }`}
                  >
                    <span className="text-lg leading-none">{t.visual.kind === 'glyph' ? t.visual.char : '🖼'}</span>
                    <span className="text-[9px] text-gray-400">{t.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ),
      )}
    </div>
  )
}

/** Inspector ◰ Art section — shows whether this element follows the global style or a pinned
 *  tile, and opens the Tile Library modal to change it. */
export function ArtSection({ override, styleName, onOpen }: { override?: string | null; styleName: string; onOpen: () => void }) {
  return (
    <div className="space-y-1.5 text-xs">
      <p className="text-[10px] leading-tight text-gray-400">
        {override
          ? <>Pinned tile: <span className="font-bold text-cyan-300">{override}</span> (ignores the global style).</>
          : <>Following the <span className="font-bold text-cyan-300">{styleName}</span> style.</>}
      </p>
      <button onClick={onOpen} className="w-full rounded bg-cyan-800 px-2 py-1.5 text-xs font-bold text-white transition-colors hover:bg-cyan-700">
        ◰ Open Tile Library…
      </button>
    </div>
  )
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

/** Shown in the right Inspector when something is selected. Stage A keeps the
 *  existing quick actions beneath it (passed as children); stage B replaces this
 *  with the full per-selection morphing panel. */
export function InspectorPlaceholder({ kind, label }: { kind: string; label?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-white/15 bg-black/40 p-3">
      <p className={`text-xs font-bold uppercase tracking-wider ${SELECTION_KIND_COLOR[kind] ?? 'text-orange-300'}`}>
        ▸ {label || kind} selected
      </p>
      <p className="mt-1 text-[10px] leading-tight text-gray-500">
        Inline settings land in the next update — quick actions below for now.
      </p>
    </div>
  )
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
