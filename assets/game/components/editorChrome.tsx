// Editor CHROME for the game-engine editor (hybrid layout, stage A): the slim
// left tool-rail, a reusable top-bar dropdown/popover, the ⚡ Generate + 🎨 Style
// controls, and the right-Inspector selection placeholder. Pure presentational +
// props-driven — all gameplay state/handlers live in the page; this is layout only.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ZoneId } from '@/engine/zones'
import { BUILT_IN_STYLES, TILE_CATEGORIES, type TileCategory, type TileDef, tilesForStyle } from '@/game/artStyle'
import { DEFAULT_ACTION_PARAMS, makeTrigger, type Trigger, type TriggerActionType, type TriggerEvent } from '@/game/runtime/trigger'
import { type EditorMode, SEASON_BTN, STAGE_VARIANTS, STAGE_ZONES, SELECT_CLS, INPUT_CLS } from './editorConfig'
import { type CompositionPaletteGroup } from '@/engine/compositionCatalog'
import { headroomFps } from '@/components/useFps'

// ── Tool-rail (left, slim icon strip) ────────────────────────────────
type RailDef = { mode: EditorMode; glyph: string; label: string; hint: string }

/** The rail modes, top→bottom. Glyphs mirror the approved design mockup. The Unit tool lives in the TOP NAV
 *  now (a dropdown, like ⚙ Stage / 🎨 Style), and the Connector tool moved to a RIGHT-SIDEBAR button that
 *  opens a draggable modal — so both are off the rail. */
export const RAIL_MODES: readonly RailDef[] = [
  { mode: 'select', glyph: '↖', label: 'Select', hint: 'Select & inspect — click an element to edit it' },
  { mode: 'paint', glyph: '▢', label: 'Paint', hint: 'Paint tiles & ground onto selected cells' },
  { mode: 'building', glyph: '⧉', label: 'Compose', hint: 'Tile composition — stamp buildings, trees, fountains, lamp posts & more' },
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

/**
 * The Tile-composition PALETTE — the "Building" card, generalised. Lists EVERY composition the backend
 * serves (the same set the world randomizer stamps: buildings, trees/bushes, fountains, wells, lamp posts…),
 * grouped and labelled by {@link buildCompositionPalette}. Each button shows the composition's footprint size
 * (w×h) so you know how many cells it takes before you even hover, and arms it as the stamp brush on click.
 * Fully data-driven — no hardcoded building list — so a new backend composition shows up here automatically.
 */
export function CompositionPalette({
  catalog,
  armedKind,
  onArm,
}: {
  catalog: readonly CompositionPaletteGroup[]
  armedKind: string | null
  onArm: (kind: string) => void
}) {
  if (catalog.length === 0) {
    return <p className="text-xs text-gray-400">Loading compositions from the server…</p>
  }
  return (
    <div className="space-y-3">
      {catalog.map(section => (
        <div key={section.group}>
          <h4 className="mb-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">{section.group}</h4>
          <div className="grid grid-cols-2 gap-1">
            {section.items.map(item => {
              const active = armedKind === item.kind
              return (
                <button
                  key={item.kind}
                  type="button"
                  onClick={() => onArm(item.kind)}
                  aria-pressed={active}
                  title={`${item.label} — ${item.footprint.w}×${item.footprint.h} cells`}
                  className={`flex items-center justify-between gap-1 rounded px-2 py-1.5 text-left text-xs font-bold transition-colors ${
                    active ? 'bg-amber-600 text-black' : 'bg-gray-700 hover:bg-gray-600'
                  }`}
                >
                  <span className="truncate">{item.label}</span>
                  <span className={`shrink-0 font-mono text-[9px] ${active ? 'text-black/70' : 'text-gray-400'}`}>
                    {item.footprint.w}×{item.footprint.h}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
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
// The per-layer randomize scopes — re-roll ONE layer of the current map, keeping the rest (macro
// randomize, GENERATION-SPEC §5). Order matches the generator's layer list; labels are user-facing.
const RANDOMIZE_LAYERS: ReadonlyArray<readonly [string, string]> = [
  ['layout', 'Layout only'],
  ['buildings', 'Buildings'],
  ['nature', 'Trees / nature'],
  ['decor', 'Decor'],
  ['units', 'Units'],
]

export function GenerateControls({
  zone,
  onZone,
  onGenerate,
  onRandomizeLayer,
}: {
  zone: ZoneId
  onZone: (z: ZoneId) => void
  onGenerate: (zone: ZoneId, variant: (typeof STAGE_VARIANTS)[number]) => void
  /** When provided, shows a "randomize just one layer" row that re-rolls a single layer of the
   *  current map (leaving the others intact). Omitted where there is no current map to scope. */
  onRandomizeLayer?: (layer: string) => void
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
      {onRandomizeLayer && (
        <>
          <p className="mb-1 mt-3 border-t border-gray-700 pt-2 text-xs text-gray-400">Randomize just one layer — keeps the rest of the map</p>
          <div className="grid grid-cols-3 gap-1">
            {RANDOMIZE_LAYERS.map(([id, label]) => (
              <button
                key={id}
                onClick={() => onRandomizeLayer(id)}
                className="rounded bg-indigo-700 px-2 py-1.5 text-xs capitalize transition-colors hover:bg-indigo-600"
                title={`Re-roll only the ${label.toLowerCase()} of the current map`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-gray-500">
            Generate a map first, then re-roll one layer at a time — e.g. new trees without touching the buildings, or the bare street/plot layout with no structures.
          </p>
        </>
      )}
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
// Sidebar section order = the canonical taxonomy order. The DATA category is a lowercase string; the
// sidebar shows a prettier heading via CATEGORY_LABELS.
const LIBRARY_CATEGORIES: readonly TileCategory[] = TILE_CATEGORIES
const CATEGORY_LABELS: Record<TileCategory, string> = {
  terrain: 'Terrain', roads: 'Roads/Paths', floors: 'Floors', walls: 'Walls', windows: 'Windows',
  doors: 'Doors', roofs: 'Roofs', nature: 'Nature', props: 'Props/Furniture', decor: 'Decor', units: 'Units',
}

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
            <p className="mb-1 text-[10px] uppercase tracking-wide text-gray-500">{CATEGORY_LABELS[cat]}</p>
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
  paint = false,
}: {
  styleId: string
  styleName: string
  override?: string | null
  onPick: (tileId: string | null) => void
  /** PAINT mode (a CELL selection) — picking a tile PAINTS it onto the selected area via the same path the
   *  left Paint tool uses, instead of pinning a per-element override. Swaps the prose + hides "Follow style"
   *  (there's no override to clear). Default (a UNIT) keeps the pin-override behaviour. */
  paint?: boolean
}) {
  const groups = tilesForStyle(styleId)
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-gray-400">
          <span className="text-cyan-300">{styleName}</span> tiles — pick one to {paint ? 'paint it onto the selected cells' : 'pin it to this element'}.
        </p>
        {!paint && (
          <button
            onClick={() => onPick(null)}
            disabled={!override}
            className={`shrink-0 rounded px-2 py-1 text-[10px] font-bold transition-colors ${
              override ? 'bg-gray-700 text-gray-100 hover:bg-gray-600' : 'cursor-not-allowed bg-gray-800/50 text-gray-600'
            }`}
          >
            Follow style
          </button>
        )}
      </div>
      <TileCategoryGrid groups={groups} isOn={t => !paint && override === t.id} onPick={t => onPick(t.id)} />
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
  armedId,
  onArm,
}: {
  styleId: string
  /** kept for call-site parity; the palette header no longer prints the style name (tutorial prose removed). */
  styleName?: string
  armedId: string | null
  onArm: (tile: TileDef | null) => void
}) {
  // The Paint palette lists REGULAR tiles only (terrain / buildings / nature). Units (player / enemies /
  // NPCs) are placed through the top-nav ◈ Unit flow, NOT the paint brush — so drop the `units` group here
  // (a painted unit would spawn an entity, a separate concern the user asked to keep out of paint).
  const groups: Record<TileCategory, TileDef[]> = { ...tilesForStyle(styleId), units: [] }
  const armed = armedId ? (Object.values(groups).flat() as TileDef[]).find(t => t.id === armedId) ?? null : null
  return (
    <div className="space-y-3" data-testid="tile-palette">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] leading-tight text-gray-400">
          {armed
            ? <>Brush: <span className="font-bold text-cyan-300">{armed.label}</span> <span className="text-gray-500">· ⌥Alt-click removes</span></>
            : <span className="text-gray-500">Pick a tile to place.</span>}
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

// ── ◈ Unit — the enemy / creature picker + placement modes (top-nav) ─────
/** One segmented-toggle button (place mode / motion) — orange when active, mirroring the Unit accent. */
function ModeButton({ label, on, onClick, title }: { label: string; on: boolean; onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={title}
      className={`flex-1 rounded px-2 py-1 text-[11px] font-bold transition-colors ${on ? 'bg-orange-600 text-black' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
    >
      {label}
    </button>
  )
}

export interface UnitPickerProps {
  /** the placeable `units`-category tiles (figures only — FX/projectiles filtered out by the page). */
  units: TileDef[]
  /** the currently-picked tile id, or null (nothing armed → clicks select). */
  pickedId: string | null
  /** pick a tile to place (or null to disarm). */
  onPick: (tile: TileDef | null) => void
  /** Add = click the map to place one (like painting); Scatter = randomize several. */
  mode: 'add' | 'scatter'
  onMode: (mode: 'add' | 'scatter') => void
  /** in Add mode: place the unit STILL, or wandering with a randomized movement animation. */
  animated: boolean
  onAnimated: (animated: boolean) => void
  /** run the scatter (scatters the picked creature, or a mix when nothing is picked). */
  onScatter: () => void
}

/** ◈ Unit → pick WHICH enemy/creature to add, then place it. Reads the `units` category tiles (the data
 *  agent folds animals in here too) so you can SEE + pick a figure — the thing the paint palette no longer
 *  offers. Two modes: ADD (pick one, click the map, like painting) or SCATTER (randomize several); plus a
 *  STATIC / ANIMATED toggle so a placed unit is either still or wandering with a randomized movement
 *  animation. Pure & props-driven — the page owns the tileset, the pick, and the place/scatter handlers. */
export function UnitPicker({ units, pickedId, onPick, mode, onMode, animated, onAnimated, onScatter }: UnitPickerProps) {
  const picked = pickedId ? units.find(u => u.id === pickedId) ?? null : null
  return (
    <div className="space-y-2" data-testid="unit-picker">
      <div className="flex gap-1" role="group" aria-label="Placement mode">
        <ModeButton label="＋ Add" on={mode === 'add'} onClick={() => onMode('add')} title="Pick a creature, then click the map to place it — one at a time, like painting" />
        <ModeButton label="⤳ Scatter" on={mode === 'scatter'} onClick={() => onMode('scatter')} title="Randomly scatter several across the free space" />
      </div>
      {/* Motion only bites in Add mode — a scatter always attaches a patrol, so it's inherently animated. */}
      {mode === 'add' && (
        <div className="flex gap-1" role="group" aria-label="Placement motion">
          <ModeButton label="● Static" on={!animated} onClick={() => onAnimated(false)} title="Place it still — author movement later in the Inspector" />
          <ModeButton label="✦ Animated" on={animated} onClick={() => onAnimated(true)} title="Place it wandering, with a randomized movement animation" />
        </div>
      )}
      <div>
        <p className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-gray-500">
          <span>Creatures</span>
          {picked && <span className="normal-case text-cyan-300">{picked.label}</span>}
        </p>
        {units.length === 0 ? (
          <p className="text-[10px] text-gray-500">No unit tiles in this style yet.</p>
        ) : (
          <div className="grid grid-cols-4 gap-1">
            {units.map(t => {
              const on = pickedId === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => onPick(on ? null : t)}
                  title={`${t.label} (${t.id})`}
                  aria-pressed={on}
                  className={`flex flex-col items-center gap-0.5 rounded border px-1 py-1.5 transition-colors ${
                    on ? 'border-orange-400 bg-orange-900/40' : 'border-white/10 bg-black/40 hover:bg-white/10'
                  }`}
                >
                  {t.visual.kind === 'image'
                    ? <img src={t.visual.src} alt={t.label} className="h-5 w-5 object-contain" />
                    : <span className="text-lg leading-none">{t.visual.kind === 'glyph' ? t.visual.char : ''}</span>}
                  <span className="w-full truncate text-center text-[9px] text-gray-400">{t.label}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
      {mode === 'scatter' ? (
        <button
          onClick={onScatter}
          className="w-full rounded bg-purple-700 px-2 py-1.5 text-xs font-bold transition-colors hover:bg-purple-600"
          title={picked ? `Scatter several ${picked.label} into the free space` : 'Scatter a mix of enemies + NPCs into the free space'}
        >
          ⤳ Scatter {picked ? picked.label : 'a mix'}
        </button>
      ) : (
        <p className="text-[10px] leading-tight text-gray-500">
          {picked
            ? <>Click the map to place a <span className="text-cyan-300">{picked.label}</span>. Use <span className="font-bold">Erase</span> to remove.</>
            : 'Pick a creature above, then click the map to place it.'}
        </p>
      )}
    </div>
  )
}

// Inspector controls (◰ Art section, pose editor, per-tile property panel) live in editorInspector.tsx.
export { ArtSection, WEAPON_KINDS, PoseControls, TileControls, PropertiesPanel, type DimAxis, type ElementDims, type TileControlModel, type PropertiesPanelProps } from './editorInspector'

const fpsColor = (v: number) => (v >= 55 ? '#22c55e' : v >= 45 ? '#eab308' : v >= 30 ? '#f97316' : '#ef4444')

/** Compact FPS readout (#86). `variant='nav'` = an inline pill for the editor top bar (edit/show);
 *  `variant='floating'` = a fixed corner box for play mode. One upstream `useFps()` feeds both. */
export function FpsReadout({ fps, renderMs = 0, variant }: { fps: number; renderMs?: number; variant: 'nav' | 'floating' }) {
  // The frame rate is CAPPED by the monitor (rAF = display refresh), so it flatlines at 60 on a 60Hz screen
  // and hides whether the engine has room to spare. The per-frame cost does not lie — show it, and the rate
  // it implies, so a fast engine reads as fast and a slow frame is visible immediately.
  const headroom = headroomFps(renderMs)
  const body = (
    <span className="font-mono text-xs" title="Frames per second (capped by your display refresh) · render cost per frame · the rate that cost allows">
      <span className="text-gray-400">FPS </span>
      <span style={{ color: fpsColor(fps), fontWeight: 700 }}>{fps || '—'}</span>
      {headroom > 0 && (
        <>
          <span className="text-gray-600"> · </span>
          <span className="text-gray-400">{renderMs.toFixed(1)}ms</span>
          <span className="text-gray-600"> · </span>
          <span style={{ color: fpsColor(headroom), fontWeight: 700 }}>≈{headroom}</span>
        </>
      )}
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

// Tile/sprite animation authoring (frame picker, track editors, preview, TileAnimationEditor) lives in editorAnimation.tsx.
export { TileAnimationEditor, type TileAnimationEditorProps, type SpriteAnimationContext } from './editorAnimation'
