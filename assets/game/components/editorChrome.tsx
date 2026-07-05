// Editor CHROME for the game-engine editor (hybrid layout, stage A): the slim
// left tool-rail, a reusable top-bar dropdown/popover, the ⚡ Generate + 🎨 Style
// controls, and the right-Inspector selection placeholder. Pure presentational +
// props-driven — all gameplay state/handlers live in the page; this is layout only.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ZoneId } from '@/engine/zones'
import { BUILT_IN_STYLES, type TileCategory, genderize, tilesForStyle, visualForTileId } from '@/game/artStyle'
import type { EntityVariant } from '@/game/types'
import type { AnimDirection, AnimFrame, AnimTrigger, EntityAnimation } from '@/game/runtime/entityAnimation'
import type { TilePose } from '@/engine/tileset/pose'
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

/** The tile kinds that are WEAPONS (get a muzzle control) — matches the seeded weapon tileset entries. */
export const WEAPON_KINDS = new Set(['sword', 'bow', 'gun', 'axe', 'staff', 'shield'])

/** One labeled row of the pose editor: a range slider paired with a typeable number input (same units).
 *  Unit-agnostic — the caller converts (e.g. degrees→radians for rotation) so this stays a dumb control. */
function PoseRow({ label, value, min, max, step, suffix, onInput }: { label: string; value: number; min: number; max: number; step: number; suffix?: string; onInput: (v: number) => void }) {
  const emit = (raw: string) => { const n = parseFloat(raw); if (!Number.isNaN(n)) onInput(n) }
  return (
    <label className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-[10px] text-gray-400">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => emit(e.target.value)} aria-label={label} className="flex-1 accent-cyan-500" />
      <input type="number" min={min} max={max} step={step} value={value} onChange={e => emit(e.target.value)} aria-label={`${label} value`} className="w-14 rounded bg-gray-800 p-1 text-[10px] tabular-nums text-cyan-300" />
      {suffix && <span className="text-[10px] text-gray-400">{suffix}</span>}
    </label>
  )
}

/** Live POSE editor for the selected tile/weapon — sliders retune its position/rotation/scale/colour and,
 *  for a weapon, the projectile muzzle. Each change builds the next pose and calls `onChange`; the page
 *  writes it into the in-memory tileset and the RAF loop redraws, so the element moves IN-SCENE live.
 *  Rotation is authored in DEGREES and converted to radians at this boundary (the stored pose is radians,
 *  AnimTransform parity). Reset drops the pose back to identity (deviations-only). */
export function PoseControls({ kind, pose, isWeapon, onChange, onReset }: { kind: string; pose?: TilePose; isWeapon: boolean; onChange: (pose: TilePose) => void; onReset: () => void }) {
  const set = (patch: Partial<TilePose>) => onChange({ ...pose, ...patch })
  const rotDeg = Math.round((pose?.rot ?? 0) * 180 / Math.PI)
  return (
    <div className="space-y-1.5 rounded-lg border border-white/10 bg-black/40 p-2 text-xs">
      <p className="text-[10px] font-bold uppercase tracking-wider text-cyan-300">Pose — {kind}</p>
      <PoseRow label="x" value={pose?.dx ?? 0} min={-1} max={1} step={0.01} onInput={v => set({ dx: v })} />
      <PoseRow label="y" value={pose?.dy ?? 0} min={-1} max={1} step={0.01} onInput={v => set({ dy: v })} />
      <PoseRow label="rotate" value={rotDeg} min={-180} max={180} step={1} suffix="°" onInput={v => set({ rot: v * Math.PI / 180 })} />
      <PoseRow label="scale" value={pose?.scale ?? 1} min={0.2} max={3} step={0.05} onInput={v => set({ scale: v })} />
      {isWeapon && <PoseRow label="muzzle" value={pose?.muzzle ?? 0} min={0} max={1} step={0.05} onInput={v => set({ muzzle: v })} />}
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={pose?.flip ?? false} onChange={e => set({ flip: e.target.checked })} className="accent-cyan-500" />
        <span className="text-[10px] text-gray-400">flip horizontally</span>
      </label>
      <label className="flex items-center gap-2">
        <span className="w-12 shrink-0 text-[10px] text-gray-400">colour</span>
        <input type="color" value={pose?.color ?? '#ffffff'} onChange={e => set({ color: e.target.value })} aria-label="Base colour override" className="h-6 w-10 rounded bg-gray-800" />
      </label>
      <button onClick={onReset} className="w-full rounded bg-gray-700 px-2 py-1 text-[10px] font-bold text-white transition-colors hover:bg-gray-600">
        ↺ Reset pose
      </button>
    </div>
  )
}

/** Universal per-selection PROPERTY editor. Edits the CURRENT (multi-)selection's floor colour, object
 *  colour, collision, terrain height and size — applied to EVERY selected element at once. Presentational:
 *  the page computes each shared value (`null` = the elements differ → "mixed") and each callback applies
 *  the edit across the selection + bumps a redraw. Only controls relevant to the selection are shown. */
/** The four per-element sprite-scale axes (#77/#78). Width/Height/Depth are per-axis; Zoom is uniform. */
export type DimAxis = 'width' | 'height' | 'depth' | 'zoom'
export interface ElementDims {
  width: number | null // shared scaleX, or null (mixed)
  height: number | null // shared scaleY, or null (mixed)
  depth: number | null // shared scaleZ, or null (mixed)
  zoom: number | null // shared scale (uniform), or null (mixed)
}

export interface PropertiesPanelProps {
  count: number
  // ── cell ── (the grid cell itself)
  floorColor: string | null // shared floor override, or null (none/mixed)
  collision: boolean | null // shared collision state, or null (mixed)
  height: number | null // shared terrain grid-height (iso elevation), or null (mixed)
  onFloorColor: (color: string) => void
  onClearFloorColor: () => void
  onCollision: (blocked: boolean) => void
  onHeight: (h: number) => void
  // ── element ── (the prop/unit standing on the cell)
  hasObject: boolean // any selected cell holds a prop/unit
  elementKind: string | null // the first object's kind → labels the section, e.g. "element (tree)"
  objectColor: string | null // shared object/unit colour, or null (mixed)
  dims: ElementDims // shared per-axis sprite scale
  onObjectColor: (color: string) => void
  onDim: (axis: DimAxis, value: number) => void
}

/** A cell can hold BOTH a floor and an element; the panel keeps them in two clearly-labeled sections so
 *  it's obvious whether you're editing the CELL (floor / grid elevation / collision) or the ELEMENT on it
 *  (colour + Width/Height/Depth/Zoom sprite scale). #58 + #77/#78. */
export function PropertiesPanel(p: PropertiesPanelProps) {
  const mixed = <span className="text-[9px] italic text-amber-300">mixed</span>
  const num = (raw: string, cb: (n: number) => void) => { const n = parseFloat(raw); if (!Number.isNaN(n)) cb(n) }
  const divider = (label: string) => (
    <p className="mt-1 border-t border-white/10 pt-1.5 text-[9px] font-bold uppercase tracking-wider text-gray-500">— {label} —</p>
  )
  // A sprite-scale row (Width/Height/Depth/Zoom): default 1 = the element's natural drawn size.
  const dimRow = (label: string, axis: DimAxis, value: number | null, title: string) => (
    <label className="flex items-center gap-2" title={title}>
      <span className="w-14 shrink-0 text-[10px] text-gray-400">{label}</span>
      <input type="range" min={0.25} max={5} step={0.05} value={value ?? 1} onChange={e => num(e.target.value, v => p.onDim(axis, v))} aria-label={label} className="flex-1 accent-cyan-500" />
      <input type="number" min={0.25} max={5} step={0.05} value={value ?? 1} onChange={e => num(e.target.value, v => p.onDim(axis, v))} aria-label={`${label} value`} className="w-14 rounded bg-gray-800 p-1 text-[10px] tabular-nums text-cyan-300" />
      {value === null && mixed}
    </label>
  )
  return (
    <div className="space-y-1.5 rounded-lg border border-white/10 bg-black/40 p-2 text-xs">
      <p className="text-[10px] font-bold uppercase tracking-wider text-cyan-300">
        Properties — {p.count} cell{p.count === 1 ? '' : 's'}
      </p>

      {divider('cell')}
      <div className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-[10px] text-gray-400">Floor</span>
        <input type="color" value={p.floorColor ?? '#3a7d34'} onChange={e => p.onFloorColor(e.target.value)} aria-label="Floor colour" className="h-6 w-10 rounded bg-gray-800" />
        {p.floorColor === null && mixed}
        <button onClick={p.onClearFloorColor} className="ml-auto rounded bg-gray-700 px-2 py-0.5 text-[9px] hover:bg-gray-600" title="Reset the floor to its tile colour">↺ reset</button>
      </div>
      <label className="flex items-center gap-2" title="Terrain elevation — raises the CELL (iso blocks). This is NOT the element's height.">
        <span className="w-14 shrink-0 text-[10px] text-gray-400">Grid height</span>
        <input type="number" min={0} max={9} step={1} value={p.height ?? 0} onChange={e => num(e.target.value, n => p.onHeight(Math.round(n)))} aria-label="Terrain grid height" className="w-14 rounded bg-gray-800 p-1 text-[10px] tabular-nums text-cyan-300" />
        {p.height === null && mixed}
      </label>
      <div className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-[10px] text-gray-400">Collision</span>
        <button onClick={() => p.onCollision(true)} aria-pressed={p.collision === true} className={`rounded px-2 py-0.5 text-[10px] font-bold ${p.collision === true ? 'bg-red-600 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}>Blocked</button>
        <button onClick={() => p.onCollision(false)} aria-pressed={p.collision === false} className={`rounded px-2 py-0.5 text-[10px] font-bold ${p.collision === false ? 'bg-emerald-600 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}>Walkable</button>
        {p.collision === null && mixed}
      </div>

      {p.hasObject && (
        <>
          {divider(p.elementKind ? `element (${p.elementKind})` : 'element')}
          <div className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-[10px] text-gray-400">Colour</span>
            <input type="color" value={p.objectColor ?? '#ffffff'} onChange={e => p.onObjectColor(e.target.value)} aria-label="Object colour" className="h-6 w-10 rounded bg-gray-800" />
            {p.objectColor === null && mixed}
          </div>
          {dimRow('Width', 'width', p.dims.width, 'Width — horizontal stretch (every view)')}
          {dimRow('Height', 'height', p.dims.height, 'Height — grows UP from the base (iso + 2D views)')}
          {dimRow('Depth', 'depth', p.dims.depth, 'Depth — stretches the ground axis in the top view only')}
          {dimRow('Zoom', 'zoom', p.dims.zoom, 'Zoom — scales Width, Height and Depth together')}
        </>
      )}
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

/** The emoji/glyph a frame slot shows — the SAME image the renderer draws, so the preview matches play:
 *  an empty frame shows the entity's OWN figure (frame 0 = the entity as-is), a `char`/tile is gendered
 *  to the entity's variant (so a walk 🚶 previews as 🚶‍♀️ for a female, matching the idle 🧍‍♀️), and an
 *  image tile shows 🖼. `baseGlyph` is the entity's resolved figure; falls back to '·' if unknown. */
function frameGlyph(frame: AnimFrame, baseGlyph = '', variant?: EntityVariant): string {
  if (frame.char) return genderize(frame.char, variant)
  if (frame.tileId) {
    const v = visualForTileId(frame.tileId)
    if (v?.kind === 'glyph') return genderize(v.char, variant)
    if (v?.kind === 'image') return '🖼'
  }
  return baseGlyph || '·'
}

/** One frame slot: the resolved glyph (mirrored when flipped) + a flip toggle. Clicking the tile
 *  opens the picker for this frame; ⇄ mirrors the frame (a DATA property the renderer honors). */
function FrameSlot({
  frame, index, active, onOpen, onToggleFlip, baseGlyph, variant,
}: {
  frame: AnimFrame
  index: number
  active: boolean
  onOpen: () => void
  onToggleFlip: () => void
  baseGlyph: string
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
        <span style={frame.flipX ? { display: 'inline-block', transform: 'scaleX(-1)' } : undefined}>{frameGlyph(frame, baseGlyph, variant)}</span>
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
            <span className="text-base leading-none">{t.visual.kind === 'glyph' ? t.visual.char : '🖼'}</span>
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
  anim, category, styleId, onAnim, onRemove, baseGlyph, variant,
}: {
  anim: EntityAnimation
  category: TileCategory
  styleId: string
  onAnim: (next: EntityAnimation) => void
  onRemove: () => void
  baseGlyph: string
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
              baseGlyph={baseGlyph}
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

export interface AnimationEditorProps {
  /** the entity's authored animations (empty → it plays the default character set). */
  animations: EntityAnimation[]
  /** the entity's tile category — 'units' for any character (player/npc/enemy); constrains the picker. */
  category: TileCategory
  /** the active art style whose tiles the frame picker offers. */
  styleId: string
  /** the entity's OWN resolved figure (already gendered) — what an empty "base" frame previews as. */
  baseGlyph: string
  /** the entity's variant, so char/tile frames preview gendered (matching the render). */
  variant?: EntityVariant
  onChange: (next: EntityAnimation[]) => void
}

/** Author the data-driven animations that ride on an entity — the player included (the player IS an
 *  entity, so this authors the live hero). Add/edit/remove animations; each has a trigger, direction,
 *  timing, loop, and a frame strip with a category-constrained tile picker. */
export function AnimationEditor({ animations, category, styleId, baseGlyph, variant, onChange }: AnimationEditorProps) {
  const replace = (i: number, next: EntityAnimation) => onChange(animations.map((a, j) => (j === i ? next : a)))
  const remove = (i: number) => onChange(animations.filter((_, j) => j !== i))
  const add = () =>
    onChange([
      ...animations,
      {
        // stable-ish id: index + a base-36 timestamp so two adds in the same session never collide.
        id: `anim-${animations.length}-${Date.now().toString(36)}`,
        name: 'new animation',
        trigger: { on: 'move' },
        direction: 'down',
        frames: [{}, {}],
        durationMs: 300,
        loopDelayMs: 0,
        loop: true,
      },
    ])

  return (
    <div className="space-y-2 text-xs">
      {animations.length === 0 && (
        <p className="text-[10px] leading-tight text-gray-500">
          No animations yet — this entity plays the default character set. Add one to author a custom walk / idle / attack…
        </p>
      )}
      {animations.map((a, i) => (
        <AnimationRow key={a.id} anim={a} category={category} styleId={styleId} baseGlyph={baseGlyph} variant={variant} onAnim={next => replace(i, next)} onRemove={() => remove(i)} />
      ))}
      <button onClick={add} className="w-full rounded bg-cyan-800 px-2 py-1 text-[11px] font-bold text-white transition-colors hover:bg-cyan-700">
        ✦ Add animation
      </button>
    </div>
  )
}
