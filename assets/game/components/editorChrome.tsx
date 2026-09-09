// Editor CHROME for the game-engine editor (hybrid layout, stage A): the slim
// left tool-rail, a reusable top-bar dropdown/popover, the ⚡ Generate + 🎨 Style
// controls, and the right-Inspector selection placeholder. Pure presentational +
// props-driven — all gameplay state/handlers live in the page; this is layout only.
import { filterTiles } from '@/game/editor/tileSearch'
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { isCharacterTile, tileSlug, unitRole, type UnitRole } from '@/game/editor/tilePlacement'

import { TilePicture } from './shell/Previews'
import { compositionPreview, tileFrames } from '@/engine/tilePreview'
import { InfoButton } from './shell/InfoButton'
import { availableStyles, CATEGORY_LABELS, TILE_CATEGORIES, type TileCategory, type TileDef, tilesForStyle } from '@/game/artStyle'
import { DEFAULT_ACTION_PARAMS, makeTrigger, type Trigger, type TriggerActionType, type TriggerEvent } from '@/game/runtime/trigger'
import { catalogZones, categoryLayouts, findCategory, findGenerator, type GeneratorCatalog } from '@/lib/generatorCatalog'
import { CELL_SIZE_MIN, MAP_SIZE_MIN, atLeast, cellCount, mapSizeValid, type MapSize } from '@/lib/mapSize'
import { PreviewThumb, type PreviewContext } from '@/components/game/shell/PreviewThumb'
import { subjectFor } from '@/engine/preview/previewScene'
import { EDITOR_BANDS, EDITOR_RAIL, type RailEntry, type RailId, type EditorMode, GENERATOR_LAYERS, SEASON_BTN, SEASON_BTN_ACTIVE, SELECT_CLS, INPUT_CLS } from './editorConfig'
import { COMPOSITION_CATEGORY_GLYPH, type CompositionPaletteGroup } from '@/engine/compositionCatalog'
import { headroomFps } from '@/components/useFps'
import { CameraRotateButton, PlayerRangeControl } from './cameraControls'
import { HelpButton } from './editorHelp'
import { ViewButton } from './controls'
import type { Orientation } from '@/engine/render/isoOrientation'
import type { DayNight } from '@/engine/render'

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

/** Rail entry → its active accent. A Record over RailId, so adding an entry is a compile error until it
 *  has a colour (Open/Closed — the switcher never grows an `if`). */
const RAIL_ACTIVE: Record<RailId, string> = {
  select: 'bg-yellow-600 text-black',
  terrain: 'bg-cyan-600 text-black',
  objects: 'bg-emerald-600 text-black',
  characters: 'bg-orange-600 text-black',
  generate: 'bg-purple-600 text-white',
  rules: 'bg-indigo-600 text-white',
  artstyle: 'bg-pink-600 text-white',
  hud: 'bg-sky-600 text-white',
}

function RailButton({ def, active, onClick }: { def: RailEntry; active: boolean; onClick: () => void }) {
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        aria-label={def.label}
        title={def.hint}
        className={`flex w-full flex-col items-center gap-0.5 rounded-md py-2 transition-colors ${
          active ? RAIL_ACTIVE[def.id] : 'text-gray-300 hover:bg-white/10 hover:text-white'
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
 * GROUPED BY THE COMPOSITION'S BACKEND `category` (Buildings / Nature / Props …), exactly the way the tile
 * palette groups tiles — {@link buildCompositionPalette} reads the served category, no frontend heuristic.
 * Each button shows the composition's footprint size (w×h) so you know how many cells it takes before you even
 * hover, and arms it as the stamp brush on click. Fully data-driven — no hardcoded building list — so a new
 * backend composition shows up in its category automatically.
 */
/** One placeable composition button — its label + a footprint (w×h) badge so you know how many cells it takes
 *  before hovering. Clicking arms it as the stamp brush; the armed one glows in the Compose-tool accent. */
function CompositionButton({ item, active, onArm }: { item: CompositionPaletteGroup['items'][number]; active: boolean; onArm: (kind: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onArm(item.kind)}
      aria-pressed={active}
      title={`${item.label} — ${item.footprint.w}×${item.footprint.h} cells`}
      className={`flex items-center justify-between gap-1 rounded px-2 py-1.5 text-left text-xs font-bold transition-colors ${
        active ? 'bg-amber-600 text-black' : 'bg-gray-700 hover:bg-gray-600'
      }`}
    >
      <span className="truncate">{item.label}</span>
      <span className={`shrink-0 rounded px-1 font-mono text-[9px] ${active ? 'bg-black/20 text-black/80' : 'bg-black/30 text-gray-400'}`}>
        {item.footprint.w}×{item.footprint.h}
      </span>
    </button>
  )
}

/** One category SECTION — a clear header (glyph + name + item count + divider) over a 2-up grid of its
 *  compositions. The header mirrors the tile-palette category headers so both browse the same way. */
function CompositionSection({
  section,
  styleId,
  preview,
  armedKind,
  onArm,
  onHover,
  showHeading,
}: {
  section: CompositionPaletteGroup
  styleId: string
  preview: PreviewContext
  armedKind: string | null
  onArm: (kind: string) => void
  onHover?: (kind: string | null) => void
  showHeading: boolean
}) {
  return (
    <>
      {showHeading && (
        <div className="sub" style={{ gridColumn: '1 / -1' }}>
          {section.label}
        </div>
      )}
      {section.items.map(item => (
        <ObjectSwatch
          key={item.kind}
          item={item}
          styleId={styleId}
          preview={preview}
          active={armedKind === item.kind}
          onArm={onArm}
          onHover={onHover}
        />
      ))}
    </>
  )
}

/**
 * ONE object swatch — a composed SILHOUETTE built from the object's own cells, plus its footprint.
 *
 * Alexander, 2026-09-08: *"compositions like houses, fountain, etc, don't have any preview until you look
 * toplace it in grid, which works different to all the other tiles."* Now they preview like everything
 * else, and the picture is assembled from the very tiles the stamp will place.
 */
function ObjectSwatch({
  item,
  styleId,
  preview: ctx,
  active,
  onArm,
  onHover,
}: {
  item: CompositionPaletteGroup['items'][number]
  styleId: string
  /** How to draw it the way the map would — see `PreviewContext`. */
  preview: PreviewContext
  active: boolean
  onArm: (kind: string) => void
  onHover?: (kind: string | null) => void
}) {
  const size = compositionPreview(styleId, item.kind)
  return (
    <button
      type="button"
      className={`sw${active ? ' on' : ''}`}
      title={item.label}
      aria-pressed={active}
      onMouseEnter={() => onHover?.(item.kind)}
      onFocus={() => onHover?.(item.kind)}
      onClick={() => onArm(item.kind)}
    >
      {/* The map's own render, not a composed elevation. These three — fountain, lamp post, well — were the
          ones Alexander named as worst, and all three were wrong for the same reason. */}
      <PreviewThumb subject={{ kind: 'composition', comp: item.kind }} context={ctx} px={66} />
      <span className="n">{item.label}</span>
      {size && <span className="sz">{`${size.width}×${size.depth}`}</span>}
    </button>
  )
}

export function CompositionPalette({
  catalog,
  styleId,
  preview,
  armedKind,
  onArm,
  onHover,
}: {
  catalog: readonly CompositionPaletteGroup[]
  styleId: string
  /** How to draw each object the way the map would — the fix for the fountain / lamp post / well swatches. */
  preview: PreviewContext
  armedKind: string | null
  onArm: (kind: string) => void
  /** Report what the cursor is over, so the preview panel can show it. */
  onHover?: (slug: string | null) => void
}) {
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<string | null>(null)
  const setHover = (slug: string | null) => onHover?.(slug)

  if (catalog.length === 0) {
    return <div className="hint">Loading objects from the server…</div>
  }
  const term = query.trim().toLowerCase()
  const sections = catalog
    .filter(section => kind === null || section.category === kind)
    .map(section => ({
      ...section,
      items: section.items.filter(item => !term || item.label.toLowerCase().includes(term) || item.kind.includes(term)),
    }))
    .filter(section => section.items.length > 0)
  const total = catalog.reduce((n, s) => n + s.items.length, 0)
  const shown = sections.reduce((n, s) => n + s.items.length, 0)
  return (
    <>
      <div className="lhead">
        <div className="lt">
          <span>Objects</span>
          <span className="lcount">{`${shown} of ${total}`}</span>
        </div>
        <div className="ls">ready-made buildings and props, stamped whole</div>
      </div>
      <div className="pfix">
        <LibrarySearch query={query} onQuery={setQuery} total={total} shown={shown} noun="objects" />
        <div className="ctl">
          <span className="l">Kind</span>
          <select
            className="sel"
            aria-label="Kind"
            value={kind ?? ''}
            onChange={e => setKind(e.target.value || null)}
            style={{ flex: 1 }}
          >
            <option value="">{`All (${total})`}</option>
            {catalog.map(section => (
              <option key={section.category} value={section.category}>
                {`${section.label} (${section.items.length})`}
              </option>
            ))}
          </select>
        </div>
        <div className="hint" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span>Every cell it holds lands in one action.</span>
          <InfoButton helpId="objprev" />
        </div>
      </div>
      <div className="grid objgrid" onMouseLeave={() => setHover(null)}>
        {sections.map(section => (
          <CompositionSection
            key={section.category}
            section={section}
            styleId={styleId}
            preview={preview}
            armedKind={armedKind}
            onArm={onArm}
            onHover={setHover}
            showHeading={sections.length > 1}
          />
        ))}
      </div>
      <div className="pfoot">
        {armedKind
          ? 'Move over the map to see its footprint, then click to place it.'
          : 'Pick an object, then click the map.'}
      </div>
    </>
  )
}

/** The left tool-rail. Reflects the active editor mode and switches it on click. */
/**
 * THE LEFT RAIL — banded by the journey, and the ONLY place the three libraries are named.
 *
 * Alexander, 2026-09-08:
 *
 *   > why do we have tiles, objects and characters repeated in the sidebar and inside tile sectrion?
 *   > that's confusing
 *
 * The library panel used to carry a duplicate tab strip. It is gone: this rail IS the tab strip, and each
 * row carries its COUNT so the label has information scent — you can see there are 24 objects without
 * opening anything.
 *
 * The band order is the journey, not the code layout (`EDITOR_BANDS`). Alexander: *"there's 0 sense to put
 * art style and generate to the bottom of the sidebar, those will be usually the first options end users
 * will play with."* So `New world` leads; `Select` is gone (it acts on nothing — it is the resting state of
 * the cursor); and `Art style` moved to the top nav, before the game selector.
 */
export function ToolRail({
  activeId,
  counts,
  hudActive = false,
  bare = false,
  onPick,
}: {
  activeId: RailId
  /** How many things each library holds. Absent for the rows that are not libraries. */
  counts?: Partial<Record<RailId, number>>
  /** True while the player's-UI mode is on, so its row reads as selected. */
  hudActive?: boolean
  /** Render only the bands — the caller owns the zone element (it also owns the collapse handle). */
  bare?: boolean
  onPick: (entry: RailEntry) => void
}) {
  // A TABLIST is what this is: one row selected at a time, and it decides which panel the next column
  // shows. Saying so gives a screen reader the same model the design gives the eye.
  return (
    <nav aria-label="What do you want to work on" className={bare ? 'railbands' : 'z z-rail'} role="tablist">
      {EDITOR_BANDS.map((band, bandIndex) => (
        <Fragment key={band.title}>
          <div className={`zn hot${bandIndex === 0 ? ' first' : ''}`}>{band.title}</div>
          {band.items.map(entry => {
            const on = entry.id === 'hud' ? hudActive : activeId === entry.id && !hudActive
            const count = counts?.[entry.id]
            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={on}
                title={entry.hint}
                className={`b wide sm${on ? ' on' : ''}`}
                onClick={() => onPick(entry)}
              >
                <span className="ic" aria-hidden="true">{entry.glyph}</span>
                <span>{entry.label}</span>
                {count !== undefined && <span className="ct">{count}</span>}
              </button>
            )
          })}
        </Fragment>
      ))}
    </nav>
  )
}

// ── On-canvas quick-action toolbar (stage C) ─────────────────────────
/** One verb in the floating toolbar — a glyph + label that focuses an Inspector section. */
export type QuickAction = { key: string; glyph: string; label: string; onClick: () => void }

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

// ── ⚡ Generate (season → map type → layout, + universal layer re-roll) ─────────────
// Shared micro-header for the Generate menu sections — same type scale as the tile/composition palette
// headers, so the whole editor's grouped panels read as one system.
const MENU_HEADER = 'text-[10px] font-bold uppercase tracking-wider text-gray-400'

/** A labelled section header for the Generate menu (matches the palette headers). */
function MenuHeader({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <p className={`${MENU_HEADER} ${className}`}>{children}</p>
}

/**
 * The ⚡ Generate controls — a clear top-down hierarchy: **Season** → **Map type** → the chosen map type's
 * **Layouts** (a labelled group nested UNDER the selected type, not loose buttons), then a divider and the
 * **universal per-layer re-roll** row. Shared by the top-bar Generate dropdown and the Inspector's
 * nothing-selected stage panel.
 *
 * EVERY option is backend DATA (`GET /api/generators`, T-113 / §3.14b Tier-1 #1): the seasons are the union
 * of the generators' own `zones`, the map types are the catalog's categories, and a type's layouts are the
 * generators inside it that name a shape. There is no `variant === 'forest'` branch and no frontend list to
 * keep in step — adding a map type is a seed row.
 *
 * An EMPTY catalog offers nothing and SAYS so. It never falls back to a hardcoded menu: a button for a map
 * type the backend cannot generate is the same silent lie that hid the localStorage games P0 (§3.1).
 *
 * The per-layer re-roll row stays frontend data (`GENERATOR_LAYERS`) — the layers are engine PASSES
 * (`stageGenerator`'s `LAYER_IDS`), not generator records, and `/api/generators` serves no layer list.
 */
/** A map's MATRIX: how many cells, and how big one cell is. Defined in `@/lib/mapSize`, with the engine
 *  bounds, because the generate path has to agree with this panel about them. */
export type { MapSize }

/**
 * `4 · MAP SIZE` (§4.6) — the grid's MATRIX VARIABLES.
 *
 * Alexander, 2026-09-08: *"the map should have a cell size and how many rows x columns there's in the map,
 * where columns = the number of cells per row … basically the grid is just a matrix, we must define the
 * matrix variables"*. So all three are here: `Columns`, `Rows`, and `Cell size`. The first two were the
 * only ones reachable from the UI, even though `IsometricGrid` has carried `cellSize` all along.
 *
 * It also moved out of ⚙ Stage, which §3.11 measured as "a destructive action [sitting] above four harmless
 * view toggles … no confirmation and no undo checkpoint".
 *
 * The typed numbers are a DRAFT: typing a width must never touch the open map — only an explicit act
 * applies it — and the warning is shown BEFORE the commit rather than as a dialogue after it, so the
 * consequence is legible while you are still deciding.
 *
 * The draft is OWNED BY THE PARENT, and that is the whole point. It used to be this component's private
 * `useState`, which made it unreachable from "Build this world" — so the build read the LIVE grid's size and
 * rebuilt at the old dimensions. Alexander, twice: *"I clicked build this world and it randomized the values
 * I selected on step 4 how big"* and then *"Again, I picked a specific map size, specified the rows, columns
 * and cell pixels … and it didn't built it with the specific sizes I selected."* A number two different
 * actions depend on cannot be private to one of them.
 */
function MapSizeSection({
  draft,
  onDraft,
  size,
  onResize,
}: {
  draft: MapSize
  onDraft: (next: MapSize) => void
  /** The size the open map actually IS, so the destructive button can tell whether it has work to do. */
  size: MapSize
  onResize: (cols: number, rows: number, cellSize: number) => void
}) {
  // NO MAXIMUM. Alexander, 2026-09-09: *"this shouldn't be a limitation, our generators should be versatile
  // enough and random enough to do a forest as big as what I put"* and *"the previous limits where caused by
  // poor optimization."*
  //
  // There were two caps and both leaked into the UI as nonsense: the generator's served range silently cut a
  // requested 40 rows to 35, and an engine cap of 100 made the panel print `400 × 240 = — cells` because it
  // refused to count a size it would not accept. The note naming the preset's authored range is gone too —
  // it described the generator's taste as if it were a rule.
  const valid = mapSizeValid(draft)
  const cells = cellCount(draft)
  const unchanged = draft.cols === size.cols && draft.rows === size.rows && draft.cellSize === size.cellSize

  // A row per number, in the design's control layout, so a narrow panel can never clip the action.
  const num = (key: keyof MapSize, label: string) => (
    <div className="ctl" key={key}>
      <span className="l">{label}</span>
      <input
        type="number" aria-label={`Map ${label.toLowerCase()}`}
        value={draft[key]}
        onChange={e => onDraft({ ...draft, [key]: parseInt(e.target.value, 10) })}
      />
    </div>
  )

  return (
    <section>
      {/* The matrix, stated as a matrix: columns × rows of cells, then how big one cell is. */}
      {num('cols', 'Columns')}
      {num('rows', 'Rows')}
      {num('cellSize', 'Cell pixels')}
      <div className="hint">
        {cells === null
          ? 'Columns is how many cells fit in one row.'
          : `${draft.cols} × ${draft.rows} = ${cells.toLocaleString()} cells. Columns is how many cells fit in one row.`}
      </div>
      {/* Only shown once the numbers actually differ — a destructive button with nothing to do is noise. */}
      {!unchanged && (
        <button
          type="button"
          onClick={() => onResize(draft.cols, draft.rows, draft.cellSize)}
          disabled={!valid}
          title={`Rebuild the map as ${draft.cols} × ${draft.rows} cells of ${draft.cellSize}px`}
          className="b dan"
          style={{ width: '100%', marginTop: 6, justifyContent: 'center' }}
        >
          {`Resize to ${draft.cols} × ${draft.rows}…`}
        </button>
      )}
      <div className="hint" style={{ color: 'var(--warn)' }}>
        {!atLeast(draft.cols, MAP_SIZE_MIN) || !atLeast(draft.rows, MAP_SIZE_MIN)
          ? '\u26a0 A map needs at least one cell on each side.'
          : !atLeast(draft.cellSize, CELL_SIZE_MIN)
            ? '\u26a0 A cell needs to be at least one pixel.'
            : '\u26a0 Changing the size clears the map. Ctrl+Z undoes it.'}
      </div>
    </section>
  )
}

/** The grid a preset thumbnail generates. Small enough to be cheap, big enough that a layout's structure
 *  — a clearing, a street grid, a river — is still legible at ~90px. */
const PRESET_THUMB_CELLS = { cols: 26, rows: 20 } as const

/**
 * A stable seed for one preset's thumbnail, from its identity rather than a counter.
 *
 * Identity, not index: a counter would give the same card a different world whenever the list reordered,
 * and hand two cards the same world whenever they happened to share a position. FNV-1a over
 * category/layout/zone — cheap, and it spreads adjacent strings apart so Woodland and Meadow get visibly
 * different worlds rather than two rolls of the same one.
 */
function presetSeed(categoryKey: string, layoutId: string, zone: string): number {
  const text = `${categoryKey}/${layoutId}/${zone}`
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash) % 1_000_000
}

export function GenerateControls({
  catalog,
  catalogError,
  zone,
  onZone,
  onGenerate,
  onRandomizeLayer,
  selectedCount = 0,
  onRandomizeSelection,
  size,
  onResize,
  preview,
}: {
  /** The backend's generator catalog (see `useGeneratorCatalog`). Empty until it loads, or if it failed. */
  catalog: GeneratorCatalog
  /** Why the catalog is empty, when it failed to load — shown so the user knows the backend is unreachable. */
  catalogError?: string | null
  zone: string
  onZone: (z: string) => void
  /** `layout` steers a map type that HAS layouts (undefined otherwise → the generator's own default).
   *  `requested` is the size TYPED IN "How big" — all three numbers, cell pixels included — and it wins
   *  outright over the generator's random roll. Absent = nothing typed, so let the generator roll one. */
  onGenerate: (zone: string, categoryKey: string, layout?: string, requested?: MapSize) => void
  /** When provided, shows the universal "re-roll one layer" row that re-rolls a single layer of the current
   *  map (leaving the others intact). Omitted where there is no current map to scope. */
  onRandomizeLayer?: (layer: string) => void
  /** §4.6's `RE-ROLL THE SELECTION (R)` section: re-roll just the tiles you have selected, leaving the rest
   *  of the map alone. Omitted when nothing is selected — the action has no subject then, and §4.6 draws the
   *  count in the label so you can see what it will touch. */
  selectedCount?: number
  onRandomizeSelection?: () => void
  /** The open map's size. Together with `onResize` this renders §4.6's MAP SIZE section — the one §3.11
   *  wants OUT of ⚙ Stage. Omit both where there is no map to resize. */
  size?: MapSize
  onResize?: (cols: number, rows: number, cellSize: number) => void
  /** How to draw a preset's thumbnail the way the map would. Absent → the cards carry no picture. */
  preview?: PreviewContext
}) {
  // The selected map type + the layout picked within it. Both start UNSET and follow the catalog, so the
  // menu never highlights a type the backend does not serve.
  const [categoryKey, setCategoryKey] = useState<string | null>(null)
  const [layout, setLayout] = useState<string | null>(null)
  // THE SIZE DRAFT lives here, not in `MapSizeSection`, because BOTH the resize button and "Build this
  // world" act on it. Seeded from the open map, and re-seeded whenever the map is resized from outside this
  // panel (loading a level, generating one) — but never while a number is half-typed, which is why the
  // incoming size is tracked separately rather than compared against the draft.
  const [sizeDraft, setSizeDraft] = useState<MapSize | null>(size ?? null)
  const [sizeSeen, setSizeSeen] = useState<MapSize | null>(size ?? null)
  if (size && (!sizeSeen || size.cols !== sizeSeen.cols || size.rows !== sizeSeen.rows || size.cellSize !== sizeSeen.cellSize)) {
    setSizeSeen(size)
    setSizeDraft(size)
  }

  const zones = catalogZones(catalog)
  // The first category is the flagship the menu opens on, until the user picks another.
  const activeKey = categoryKey ?? catalog[0]?.key ?? null
  const activeCategory = activeKey === null ? undefined : findCategory(catalog, activeKey)
  const layouts = activeKey === null ? [] : categoryLayouts(catalog, activeKey)
  const typeLabel = activeCategory?.name ?? 'map'
  /**
   * The cards to show — always at least one.
   *
   * Alexander, 2026-09-09: *"the preview of the forests ARE AWESONE; we need the same with all places, like
   * towns, cities, etc."* Only the forest had cards, because only the forest has NAMED layouts; a town has a
   * single generator with `layout: null`, so `categoryLayouts` returned nothing and the whole card grid —
   * thumbnail included — was skipped. A category with one generator still has something to show you: what
   * that generator builds. Its card carries no layout id, which is exactly what `generateStage` wants for
   * "run the category's own default pass".
   */
  const presets: ReadonlyArray<{ id: string | undefined; label: string }> =
    layouts.length > 0 ? layouts : activeCategory ? [{ id: undefined, label: activeCategory.name }] : []

  // Picking a map type or a shape only SELECTS it. §4.6: "clicking a map type selects it rather than
  // generating (today it generates immediately — a genuine 'why did my map just vanish' trap)".
  const select = (key: string, chosen?: string) => {
    setCategoryKey(key)
    if (chosen) setLayout(chosen)
  }

  // Generating is the explicit act. A type with no layouts sends `undefined` so the category's own default
  // generator runs; otherwise the picked shape, or that type's first when the user has not chosen one.
  const generate = () => {
    if (activeKey === null) return
    // The numbers TYPED in "How big" travel with the map type — they are one decision, and the draft is the
    // user's answer to it. Reading `size` (the live grid) instead was the defect: it rebuilt at the old
    // dimensions and looked exactly like the generator had randomised over the choice.
    const requested = sizeDraft ?? undefined
    if (layouts.length === 0) { onGenerate(zone, activeKey, undefined, requested); return }
    const picked = layouts.some(l => l.id === layout) ? layout : layouts[0].id
    onGenerate(zone, activeKey, picked ?? undefined, requested)
  }

  if (catalog.length === 0) {
    return (
      <div className="pfix">
        <div className="hint">
          {catalogError
            ? `The map generators could not be loaded — ${catalogError}. Nothing can be generated until the backend answers.`
            : 'Loading the map generators…'}
        </div>
      </div>
    )
  }

  return (
    <div className="pfix" style={{ overflowY: 'auto' }}>
      <div className="hint">Builds a whole level from a preset. Replaces whatever is on this level now.</div>

      {/* Every step is NUMBERED, and the numbers are the instructions: a new user reads 1 → 2 → 3 → 4 and
          knows the order without being told. */}
      <div className="ctl">
        <span className="l">Season</span>
        <select className="sel" aria-label="Season" value={zone} onChange={e => onZone(e.target.value)} style={{ flex: 1, textTransform: 'capitalize' }}>
          {zones.map(z => <option key={z} value={z}>{z}</option>)}
        </select>
      </div>

      {/* A selectable LIST, not a grid of pills — Alexander, 2026-09-08: *"I don't like to use pills as
          filters, they'll create a lot of issues after, because of space."* Each row carries how many
          shapes it offers, which is the information that makes the row worth clicking. */}
      <div className="ctl">
        <span className="l">Kind of place</span>
        <select
          className="sel"
          aria-label="Kind of place"
          value={activeKey ?? ''}
          onChange={e => select(e.target.value)}
          style={{ flex: 1 }}
        >
          {catalog.map(c => {
            const shapes = categoryLayouts(catalog, c.key).length
            return (
              <option key={c.key} value={c.key}>
                {shapes > 0 ? `${c.name} (${shapes})` : c.name}
              </option>
            )
          })}
        </select>
      </div>
      {activeCategory?.description && <div className="hint">{activeCategory.description}</div>}

      {/* The chosen kind's presets as CARDS. Alexander: *"shape is not good, in the sense that, we should
          have better sub options layout"* and *"meadow, meadow + river are just pre defined options of
          forests."* So they are named presets OF the kind above, not a separate concept called "shape". */}
      {presets.length > 0 && (
        <>
          {/* The heading only earns its space when there is a CHOICE. One card needs no question. */}
          {layouts.length > 1 && <div className="sub">{`Which ${typeLabel.toLowerCase()}?`}</div>}
          <div className="pgrid">
            {presets.map(({ id, label }) => (
              <button
                key={id ?? `${activeKey}-default`}
                type="button"
                onClick={() => select(activeKey as string, id)}
                aria-pressed={id === undefined ? true : layout === id}
                className={`pcard${id === undefined || layout === id ? ' on' : ''}`}
                title={
                  id === undefined
                    ? `Build a ${zone} ${typeLabel.toLowerCase()}`
                    : `Shape the ${zone} ${typeLabel.toLowerCase()} as a ${label.toLowerCase()}`
                }
              >
                {/* THE PRESET'S OWN PICTURE — the level this button would build, generated small and
                    seeded, drawn by the map's renderer. Alexander, 2026-09-08: *"yes we want this
                    feature."* The design reserved this slot (a `.pmap` block beside the name) and the port
                    dropped it; it is worth more now than when he asked, because Woodland sits next to two
                    Meadows and the only honest way to tell them apart is to look. */}
                {preview && activeKey && (
                  <PreviewThumb
                    subject={{
                      kind: 'stage',
                      zone: zone as never,
                      variant: activeKey as never,
                      layout: id,
                      nature: findGenerator(catalog, activeKey, id)?.config.nature,
                      // Seeded from the preset's identity, so a card's picture is stable across renders
                      // and every card shows a DIFFERENT world rather than all sharing one seed.
                      seed: presetSeed(activeKey, id ?? 'default', zone),
                      cols: PRESET_THUMB_CELLS.cols,
                      rows: PRESET_THUMB_CELLS.rows,
                    }}
                    context={preview}
                    px={92}
                  />
                )}
                {/* DIVs, matching the design. `.pd` carries `margin-top:3px`, which does nothing on an
                    inline element — as spans these two ran together as "Meadowa spring forest laid out…". */}
                <div>
                  <div className="pn">{label}</div>
                  <div className="pd">
                    {id === undefined
                      ? `a ${zone} ${typeLabel.toLowerCase()}`
                      : `a ${zone} ${typeLabel.toLowerCase()} laid out as a ${label.toLowerCase()}`}
                  </div>
                </div>
              </button>
            ))}
          </div>
          <div className="hint">Pick one; the generator randomizes everything else.</div>
        </>
      )}

      {/* MAP SIZE is part of the same decision, not an afterthought — Alexander, 2026-09-08: *"I think map
          size should be part of generate."* */}
      {size && onResize && sizeDraft && (
        <>
          <div className="sub">How big</div>
          <MapSizeSection
            draft={sizeDraft}
            onDraft={setSizeDraft}
            size={size}
            onResize={onResize}
          />
        </>
      )}

      {/* Change ONE layer — the same five parts on every kind of place. */}
      {onRandomizeLayer && (
        <>
          {/* Named for what it DOES, not for the scope it is not. "Change just one layer" sitting next to a
              button that rebuilds everything never said which one you were about to do. */}
          <div className="sub">Rebuild one part</div>
          <div className="seg" style={{ flexWrap: 'wrap' }} role="group" aria-label="Rebuild one part">
            {GENERATOR_LAYERS.map(({ id, label, hint }) => (
              <button
                key={id}
                type="button"
                onClick={() => onRandomizeLayer(id)}
                title={`Rebuild ${label.toLowerCase()} — ${hint}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="hint">Everything else stays exactly as it is. “Build this world” below rebuilds all of it.</div>
        </>
      )}

      {/* The third scope: the whole map, one layer, or just what you picked. */}
      {onRandomizeSelection && (
        <>
          <div className="sub">Re-roll the selection</div>
          <button
            type="button"
            onClick={onRandomizeSelection}
            disabled={selectedCount === 0}
            className="b sm"
            style={{ width: '100%', justifyContent: 'center' }}
          >
            {`🎲 Randomize ${selectedCount > 0 ? `${selectedCount} selected tile${selectedCount === 1 ? '' : 's'}` : 'the selection'} (R)`}
          </button>
          {/* A missing prerequisite is OFFERED, never enforced by a bare disabled control. */}
          {selectedCount === 0 && <div className="hint">Select some cells on the map first — Shift-drag picks several.</div>}
        </>
      )}

      {/* THE EXPLICIT ACT, LAST. Alexander, 2026-09-09: *"build this world button should be at the end."*
          Until it is clicked nothing above has touched the open map. */}
      <button
        type="button"
        onClick={generate}
        title={`Build a ${zone} ${typeLabel.toLowerCase()}${sizeDraft ? ` at ${sizeDraft.cols} × ${sizeDraft.rows}` : ''} — this replaces the open map`}
        className="b pri"
        style={{ width: '100%', margin: '16px 0 4px', padding: 13, fontSize: 15, justifyContent: 'center' }}
      >
        ⚡ Build this world
      </button>
      <div className="hint">
        {sizeDraft
          ? `At ${sizeDraft.cols} × ${sizeDraft.rows} cells of ${sizeDraft.cellSize}px — the numbers above, exactly.`
          : 'The generator picks the size.'}
      </div>
    </div>
  )
}

/** One numbered step of the world builder. The number IS the instruction. */
function Step({ n, label, children }: { n: number; label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 14, marginBottom: 7 }}>
        <b style={{ color: 'var(--accent)' }}>{n}</b>&nbsp; {label}
      </div>
      {children}
    </div>
  )
}

// ── 🎨 Style (art skin) — the global reskin switch (stage D) ─────────
/** The art-style picker: pick a built-in style → the whole world reskins instantly. ASCII is
 *  the default (byte-identical to the classic renderers); Emoji proves the swap with zero assets. */
export function StylePicker({ activeId, onPick, onClose }: { activeId: string; onPick: (id: string) => void; onClose?: () => void }) {
  return (
    <div className="space-y-1">
      {/* Named for what it lists (Alexander, 2026-09-08: *"we should improve it's naming"* — "Style" said
          nothing). Every row is a TILESET: the same labels, the same names, the same heights, a different
          set of pictures. That is the whole difference a style makes. */}
      <p className="mb-1 text-[10px] leading-snug text-gray-400">
        Every tile keeps its name and its behaviour — only the pictures change.
      </p>
      {/* The styles the BACKEND serves, in its order — a tileset row IS a style. Empty until the catalog
          loads, which shows nothing rather than inventing a style list. */}
      {availableStyles().length === 0 && (
        <p className="text-[10px] italic text-gray-500">Loading the art styles…</p>
      )}
      {availableStyles().map(s => {
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

/** ONE tile swatch — its picture, its NAME, and whether it is armed. Shared by the grouped grid and by
 *  ★ RECENT, so a tile looks the same wherever a library shows it (§4.5's "one idiom"). */
export function TileSwatch({
  tile,
  on,
  onPick,
  onHover,
  preview,
}: {
  tile: TileDef
  on: boolean
  onPick: () => void
  /** Feeds the preview panel. Hovering a swatch is how you look at something without arming it. */
  onHover?: (label: string | null) => void
  /** How to draw it the way the map would. Absent → the flat baked picture (the swap panel's small grid). */
  preview?: PreviewContext
}) {
  const label = tileSlug(tile.id)
  const frames = tileFrames(tile.styleId, label)
  // A tile is drawn by the MAP's renderer when we know which view to draw it in. The flat baked image is
  // right for a 1×1 ground square and wrong for everything with volume — a wall is an extruded block on the
  // map, and its baked picture is only one face of it.
  const subject = preview ? subjectFor('tiles', label, preview.styleId) : null
  return (
    <button
      type="button"
      onClick={onPick}
      onMouseEnter={() => onHover?.(label)}
      onFocus={() => onHover?.(label)}
      title={tile.label}
      aria-pressed={on}
      className={`sw${on ? ' on' : ''}`}
    >
      {preview && subject
        ? <PreviewThumb subject={subject} context={preview} px={62} />
        : <TilePicture styleId={tile.styleId} label={label} size={46} />}
      <span className="n">{tile.label}</span>
      {frames.length > 1 && (
        <span className="anb" title="this one is animated" aria-label="animated">▸</span>
      )}
    </button>
  )
}

/**
 * `[All][Ground][Roads][Floors][Walls]…` — the CATEGORY CHIPS §4.5 draws.
 *
 * §3.5's measurement was "11 stacked headings" you had to scroll past; §4.5 replaces them with chips so the
 * library narrows to one bucket in a click. `All` keeps the grouped view, which is still the right default
 * for browsing.
 *
 * Shared by all three libraries on purpose — §4.5: *"the same header/search/chips/armed-state structure, so
 * learning one teaches all three"*. Each chip carries its COUNT, so the size of a bucket is visible before
 * you open it.
 */
export function LibraryChips<T extends string>({ chips, active, onPick }: {
  chips: readonly { id: T; label: string; count: number }[]
  /** null = All. */
  active: T | null
  onPick: (id: T | null) => void
}) {
  // Alexander, 2026-09-08: *"I don't like to use pills as filters, they'll create a lot of issues after,
  // because of space, it'd rather have a list of selectable items."* So: a list, one row per bucket, each
  // carrying its count — you can see there are 4 doors and 94 ground tiles without opening anything.
  // Alexander, 2026-09-09: *"why not just a regular select??? we don't need to have the options showing with
  // scrolling when we can use an actual dropdown selector and reduce space."* His earlier objection was to
  // PILLS, which wrap and eat width; a native select costs one row for twelve options and needs no scroll
  // area of its own. The count rides in each option's label, so the information scent survives.
  const total = chips.reduce((n, c) => n + c.count, 0)
  return (
    <div className="ctl">
      <span className="l">Category</span>
      <select
        className="sel"
        aria-label="Category"
        value={active ?? ''}
        onChange={e => onPick((e.target.value || null) as T | null)}
        style={{ flex: 1 }}
      >
        <option value="">{`All (${total})`}</option>
        {chips.filter(c => c.count > 0).map(c => (
          <option key={c.id} value={c.id}>{`${c.label} (${c.count})`}</option>
        ))}
      </select>
    </div>
  )
}

/**
 * `★ RECENT` — the last tiles you placed, §4.5's addition to every library.
 *
 * Browsing 305 tiles to re-place the one you just used is the specific waste §3.5 measured. Eight is what
 * §4.5 draws.
 */
export function LibraryRecent({ tiles, isOn, onPick, onHover, preview }: {
  tiles: readonly TileDef[]
  isOn: (tile: TileDef) => boolean
  onPick: (tile: TileDef) => void
  onHover?: (label: string | null) => void
  /** How to draw each swatch the way the map would. Absent → the flat baked picture. */
  preview?: PreviewContext
}) {
  if (tiles.length === 0) return null
  return (
    <div>
      <div className="sub">★ Recent</div>
      <div className="grid">
        {tiles.map(t => (
          <TileSwatch key={`recent-${t.id}`} tile={t} on={isOn(t)} onPick={() => onPick(t)} onHover={onHover} preview={preview} />
        ))}
      </div>
    </div>
  )
}

/** The shared categorized tile GRID: every tile of a style's `groups`, grouped by category, 4-per-row.
 *  Each tile is a button that highlights when `isOn(tile)` and calls `onPick(tile)`. Reused by the Tile
 *  Library (pins a tile to the selected element) and the Paint palette (arms a placement brush) so both
 *  read as the exact same tileset grid. */
/**
 * THE LIBRARY SEARCH FIELD — the same header on every library (§4.5).
 *
 * §3.5/§3.6 measured the problem: 305 tiles in one 4-wide scroll and 79 creatures in a 256px popover, with
 * no search anywhere. §4.5's fix is that all three libraries wear the SAME header, so learning one teaches
 * the others. It reports the count it is filtering so "305 tiles" stops being a surprise, and says plainly
 * when a query matches nothing instead of rendering an empty grid.
 */
export function LibrarySearch({ query, onQuery, total, shown, noun }: {
  query: string
  onQuery: (query: string) => void
  total: number
  shown: number
  /** What is being searched, pluralised by the caller: "tiles", "characters". */
  noun: string
}) {
  return (
    <>
      <input
        className="srch"
        type="search"
        value={query}
        onChange={e => onQuery(e.target.value)}
        aria-label={`Search ${total} ${noun}`}
        placeholder={`search ${total} ${noun}…`}
      />
      {query && (
        <div className="hint">
          {shown === 0 ? `Nothing matches “${query}”. Clear the search, or pick a different group.` : `${shown} of ${total} ${noun}.`}
        </div>
      )}
    </>
  )
}

function TileCategoryGrid({
  groups,
  isOn,
  onPick,
  onHover,
  query = '',
  preview,
}: {
  groups: Record<TileCategory, TileDef[]>
  isOn: (tile: TileDef) => boolean
  onPick: (tile: TileDef) => void
  /** Feeds the preview strip as the cursor moves over the grid. */
  onHover?: (label: string | null) => void
  /** Narrow every category to the tiles answering this query. Empty = the whole library, unchanged. */
  query?: string
  /** How to draw each swatch the way the map would. Absent → the flat baked picture. */
  preview?: PreviewContext
}) {
  const shown = (cat: TileCategory) => filterTiles(groups[cat], query)
  const visible = LIBRARY_CATEGORIES.filter(cat => shown(cat).length > 0)
  // ONE grid, not one per category. When a filter row is picked the panel already shows a single bucket, so
  // the per-category headings only reappear in the unfiltered view — where they are the map of the library.
  const single = visible.length === 1
  return (
    <div className="grid" onMouseLeave={() => onHover?.(null)}>
      {visible.map(cat => (
        <Fragment key={cat}>
          {!single && (
            <div className="sub" style={{ gridColumn: '1 / -1' }}>
              {cat === 'units' ? 'Effects' : CATEGORY_LABELS[cat]}
            </div>
          )}
          {shown(cat).map(t => (
            <TileSwatch key={t.id} tile={t} on={isOn(t)} onPick={() => onPick(t)} onHover={onHover} preview={preview} />
          ))}
        </Fragment>
      ))}
    </div>
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
  const [query, setQuery] = useState('')
  const total = LIBRARY_CATEGORIES.reduce((n, cat) => n + groups[cat].length, 0)
  const shown = LIBRARY_CATEGORIES.reduce((n, cat) => n + filterTiles(groups[cat], query).length, 0)
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
      <LibrarySearch query={query} onQuery={setQuery} total={total} shown={shown} noun="tiles" />
      <TileCategoryGrid groups={groups} isOn={t => !paint && override === t.id} onPick={t => onPick(t.id)} query={query} />
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
  onHover,
  preview,
  recent = [],
}: {
  styleId: string
  /** kept for call-site parity; the palette header no longer prints the style name (tutorial prose removed). */
  styleName?: string
  armedId: string | null
  onArm: (tile: TileDef | null) => void
  /** Report what the cursor is over, so the preview zone can show it. */
  onHover?: (label: string | null) => void
  /** How to draw each swatch the way the map would — threaded to every swatch in this library. */
  preview?: PreviewContext
  /** The last tiles placed, newest first — §4.5's `★ RECENT`. Owned by the page so it survives switching
   *  rails; empty until something has been placed. */
  recent?: readonly TileDef[]
}) {
  // The Paint palette lists REGULAR tiles only (terrain / buildings / nature). Units (player / enemies /
  // NPCs) are placed through the top-nav ◈ Unit flow, NOT the paint brush — so drop the `units` group here
  // (a painted unit would spawn an entity, a separate concern the user asked to keep out of paint).
  // Units split. A figure with a person/enemy/animal role is a CHARACTER and is placed through the
  // Characters library — painting one would spawn an entity, a separate concern. The twelve `fx` labels
  // (arrow, nova, fire-slash…) are NOT characters: they are what a power draws, they are ordinary tiles,
  // and they had no home in any library at all. They belong here, under "Effects".
  const styleGroups = tilesForStyle(styleId)
  const all: Record<TileCategory, TileDef[]> = {
    ...styleGroups,
    units: styleGroups.units.filter(t => !isCharacterTile(t.settings)),
  }
  const armed = armedId ? (Object.values(all).flat() as TileDef[]).find(t => t.id === armedId) ?? null : null
  const [query, setQuery] = useState('')
  // §4.5's category CHIPS — null = All (the grouped view). Narrowing to one bucket replaces scrolling past
  // eleven stacked headings (§3.5).
  const [chip, setChip] = useState<TileCategory | null>(null)
  const groups = chip
    ? ({ ...Object.fromEntries(LIBRARY_CATEGORIES.map(c => [c, [] as TileDef[]])), [chip]: all[chip] } as Record<TileCategory, TileDef[]>)
    : all
  const total = LIBRARY_CATEGORIES.reduce((n, cat) => n + all[cat].length, 0)
  const shown = LIBRARY_CATEGORIES.reduce((n, cat) => n + filterTiles(groups[cat], query).length, 0)
  // What the cursor is over. Reported UP, because the preview lives in another zone now.
  const [hover, setHoverLocal] = useState<string | null>(null)
  const setHover = (label: string | null) => { setHoverLocal(label); onHover?.(label) }
  return (
    <>
      {/* The name of the library and the count, together. */}
      <div className="lhead">
        <div className="lt">
          <span>Tiles</span>
          <span className="lcount">{`${shown} of ${total}`}</span>
        </div>
        <div className="ls">ground, walls, roofs, nature and props</div>
      </div>
      {/* THE PREVIEW IS NOT HERE. Alexander, 2026-09-09: *"why do we have the preview in the same panel and
          not a separate panel next to the selected element?"* — because stacking it above the grid left the
          grid, the thing you opened the library FOR, as a clipped sliver. It renders in the zone that
          already means "what am I looking at": the right-hand one, which is empty while you browse. */}
      <div className="pfix">
        <LibrarySearch query={query} onQuery={setQuery} total={total} shown={shown} noun="tiles" />
        <LibraryChips
          chips={LIBRARY_CATEGORIES.map(c => ({
          id: c,
          // `units` holds only the fx here, so it is named for what it holds rather than for its data value.
          label: c === 'units' ? 'Effects' : CATEGORY_LABELS[c],
          count: all[c].length,
        }))}
          active={chip}
          onPick={setChip}
        />
      </div>
      {/* ★ RECENT — the last eight you placed, so re-placing one is not a 305-tile scroll (§4.5). */}
      <LibraryRecent tiles={recent} isOn={t => armedId === t.id} onPick={onArm} onHover={setHover} />
      <TileCategoryGrid groups={groups} isOn={t => armedId === t.id} onPick={onArm} onHover={setHover} query={query} preview={preview} />
      <div className="pfoot" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {armed ? (
          <>
            <TilePicture styleId={styleId} label={tileSlug(armed.id)} size={22} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <b>{`Placing “${armed.label}”`}</b> · click the map · <kbd>Alt</kbd>-click erases
            </span>
            <button type="button" className="b sm" title="Stop placing — Esc does the same" onClick={() => onArm(null)}>
              Disarm
            </button>
          </>
        ) : (
          <span>Pick a tile, then click the map.</span>
        )}
      </div>
    </>
  )
}

// §4.5's Characters sub-groups. The bucket is the catalog's `settings.unitRole`; `fx` is deliberately
// absent — a projectile is not a character, and the page filters those out before they reach the picker.
const UNIT_GROUPS: readonly { id: UnitRole; label: string }[] = [
  { id: 'person', label: 'People' },
  { id: 'enemy', label: 'Monsters' },
  { id: 'animal', label: 'Animals' },
]

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
  /** Report what the cursor is over, so the preview zone can show it. */
  onHover?: (label: string | null) => void
  /** Open the movable "how it will be placed" panel. */
  onOpenPlacement?: () => void
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
  /**
   * `Place as: ( ) Enemy  (•) Auto  ( ) NPC` — §4.5's row, and Alexander's model made visible
   * (2026-09-08): *"An enemy is just a setting, a unit set as enemy. We can have friendly pets or enemy
   * animals, and the same applies to pretty much all units."*
   *
   * So hostility is NOT a property of the tile. `Auto` takes the catalog's role for the creature you
   * picked; Enemy / NPC override it for what you are about to place. A bear can be a pet.
   */
  placeAs: 'auto' | 'enemy' | 'npc'
  onPlaceAs: (as: 'auto' | 'enemy' | 'npc') => void
  /** What the catalog says the picked creature is, so `Auto` can show what it would place. */
  autoKindLabel?: string
}

/** ◈ Unit → pick WHICH enemy/creature to add, then place it. Reads the `units` category tiles (the data
 *  agent folds animals in here too) so you can SEE + pick a figure — the thing the paint palette no longer
 *  offers. Two modes: ADD (pick one, click the map, like painting) or SCATTER (randomize several); plus a
 *  STATIC / ANIMATED toggle so a placed unit is either still or wandering with a randomized movement
 *  animation. Pure & props-driven — the page owns the tileset, the pick, and the place/scatter handlers. */
export function UnitPicker({ units, pickedId, onPick, mode, onMode, animated, onAnimated, onScatter, placeAs, onPlaceAs, autoKindLabel, onHover, onOpenPlacement }: UnitPickerProps) {
  const picked = pickedId ? units.find(u => u.id === pickedId) ?? null : null
  const [query, setQuery] = useState('')
  // §4.5's sub-groups: `[All] [People] [Monsters] [Animals]`. The bucket is the catalog's own
  // `settings.unitRole` — never a name regex.
  const [group, setGroup] = useState<UnitRole | null>(null)
  const setHover = (label: string | null) => onHover?.(label)
  const roleOf = (t: TileDef) => unitRole(t.settings)
  const inGroup = group ? units.filter(t => roleOf(t) === group) : units
  const shownUnits = filterTiles(inGroup, query)
  return (
    <>
      <div className="lhead">
        <div className="lt">
          <span>Characters</span>
          <span className="lcount">{`${shownUnits.length} of ${units.length}`}</span>
        </div>
        <div className="ls">people, monsters and animals</div>
      </div>
      <div className="pfix" data-testid="unit-picker">
        <LibrarySearch query={query} onQuery={setQuery} total={units.length} shown={shownUnits.length} noun="characters" />
        <div className="ctl">
          <span className="l">Who</span>
          <select
            className="sel"
            aria-label="Who"
            value={group ?? ''}
            onChange={e => setGroup((e.target.value || null) as UnitRole | null)}
            style={{ flex: 1 }}
          >
            <option value="">{`All (${units.length})`}</option>
            {UNIT_GROUPS.map(g => (
              <option key={g.id} value={g.id}>
                {`${g.label} (${units.filter(t => roleOf(t) === g.id).length})`}
              </option>
            ))}
          </select>
        </div>
      </div>

      {units.length === 0 ? (
        <div className="grid"><div className="hint">No characters in this style yet.</div></div>
      ) : (
        <div className="grid" onMouseLeave={() => setHover(null)}>
          {shownUnits.map(t => (
            <TileSwatch
              key={t.id}
              tile={t}
              on={pickedId === t.id}
              onPick={() => onPick(pickedId === t.id ? null : t)}
              onHover={setHover}
            />
          ))}
        </div>
      )}

      {/* The character's BEHAVIOUR lives in its own panel. Alexander, 2026-09-09: *"that's why I requested
          explicitly to consider movable modals, because I knew this was gonna be a problem."* Stacked under
          the grid it left the swatches — the thing you opened the library for — as one clipped row.

          Named for the QUESTION, not the mechanism. Alexander, 2026-09-09: *"'how it will be placed' is not
          clear at all in the characters."* He is right: "placed" describes the click, while the panel decides
          three things about the CHARACTER — whose side it is on, whether one lands or several, and whether it
          stands still or wanders. The count beside the label already reads "Friendly · Patrols", which is a
          summary of behaviour, not of placement. */}
      <div className="pfoot">
        <button type="button" className="b wide sm" onClick={onOpenPlacement} title="Whose side it is on, whether one lands or several, and whether it stands still or wanders">
          <span className="ic" aria-hidden="true">☰</span>
          <span>Behaviour</span>
          <span className="ct">{`${placeAs === 'npc' ? 'Friendly' : placeAs === 'enemy' ? 'Unfriendly' : 'Auto'} · ${animated ? 'Patrols' : 'Still'}`}</span>
        </button>
      </div>
    </>
  )
}

/**
 * HOW A CHARACTER WILL LAND — the second question, in its own movable panel.
 *
 * Kept apart from "which one is it" because they are different decisions, and because stacking both in one
 * 352px column is what crushed the library grid.
 */
export function UnitPlacementBody({
  mode, onMode, animated, onAnimated, onScatter, placeAs, onPlaceAs, autoKindLabel, pickedLabel,
}: Pick<UnitPickerProps, 'mode' | 'onMode' | 'animated' | 'onAnimated' | 'onScatter' | 'placeAs' | 'onPlaceAs' | 'autoKindLabel'> & {
  pickedLabel?: string
}) {
  return (
    <div>

        {/* Whose side: TWO answers and no third. Alexander, 2026-09-08: *"I don't think auto should be an
            option in the character, it's either friendly or unfriendly as simple as that. we don't support
            coop for now."* Neither pressed = the catalog's own answer for this creature, which is what
            `auto` has always meant — so the third state survives as the DEFAULT instead of as a button. */}
        <div className="ctl">
          <span className="l">
            <span>Whose side</span>
            <InfoButton helpId="placeAs" />
          </span>
          <div className="seg" role="group" aria-label="Whose side">
            <button type="button" aria-pressed={placeAs === 'npc'} className={placeAs === 'npc' ? 'on' : ''}
              title="Friendly — it will not fight the player" onClick={() => onPlaceAs(placeAs === 'npc' ? 'auto' : 'npc')}>
              Friendly
            </button>
            <button type="button" aria-pressed={placeAs === 'enemy'} className={placeAs === 'enemy' ? 'on' : ''}
              title="Unfriendly — it fights the player" onClick={() => onPlaceAs(placeAs === 'enemy' ? 'auto' : 'enemy')}>
              Unfriendly
            </button>
          </div>
        </div>
        {placeAs === 'auto' && (
          <div className="hint">
            {autoKindLabel
              ? `Using what this creature already is: ${autoKindLabel}. Pick a side to override it.`
              : 'Using what each creature already is. Pick a side to override it.'}
          </div>
        )}

        <div className="ctl">
          <span className="l">
            <span>How many</span>
            <InfoButton helpId="scatter" />
          </span>
          <div className="seg" role="group" aria-label="How many">
            <button type="button" aria-pressed={mode === 'add'} className={mode === 'add' ? 'on' : ''}
              title="Pick a character, then click the map to place it — one at a time, like painting" onClick={() => onMode('add')}>
              One at a time
            </button>
            <button type="button" aria-pressed={mode === 'scatter'} className={mode === 'scatter' ? 'on' : ''}
              title="Randomly scatter several across the free space" onClick={() => onMode('scatter')}>
              Sprinkle several
            </button>
          </div>
        </div>

        {/* Motion only bites in one-at-a-time: a sprinkle always attaches a patrol, so it is always moving.
            Only the two behaviours the ENGINE actually has are offered. The design drew seven presets
            (guards a spot, chases the hero, runs away…) — nothing in the runtime pursues the player yet, so
            offering them here would be inventing features rather than wiring them. */}
        {mode === 'add' && (
          <div className="ctl">
            <span className="l">
              <span>How it behaves</span>
              <InfoButton helpId="motion" />
            </span>
            <div className="seg" role="group" aria-label="How it behaves">
              <button type="button" aria-pressed={!animated} className={!animated ? 'on' : ''}
                title="Place it still — author movement later in the Inspector" onClick={() => onAnimated(false)}>
                Stands still
              </button>
              <button type="button" aria-pressed={animated} className={animated ? 'on' : ''}
                title="Place it wandering, with a randomized patrol" onClick={() => onAnimated(true)}>
                Patrols nearby
              </button>
            </div>
          </div>
        )}

        {mode === 'scatter' ? (
          <button type="button" className="b pri" style={{ width: '100%', justifyContent: 'center' }} onClick={onScatter}
            title={pickedLabel ? `Scatter several ${pickedLabel} into the free space` : 'Scatter a mix of characters into the free space'}>
            {`⤳ Sprinkle ${pickedLabel ?? 'a mix'}`}
          </button>
        ) : (
          <div className="hint">
            {pickedLabel ? `Click the map to place a ${pickedLabel}.` : 'Pick a character above, then click the map.'}
          </div>
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

// ── Morphing-Inspector selection header + not-yet-built section stubs ─
/** Compact identity header at the top of a morphed selection (kind + coordinates). */
export function SelectionHeader({ kind, label, coords }: { kind: string; label: string; coords?: string }) {
  // The design's `.ihd`: the NAME of the selected thing, with where it is beneath. No per-kind colour —
  // a cell and a character are both "the thing you selected", and four accent colours said otherwise.
  return (
    <div className="ihd">
      <div className="t">{label}</div>
      {coords && <div className="s"><span>{coords}</span></div>}
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
        <p className="text-[10px] leading-tight text-gray-500">No rules yet — add one to make this cell do something.</p>
      )}
      {triggers.map((t, i) => (
        <div key={t.id} className="space-y-1 rounded border border-yellow-500/20 bg-black/40 p-1.5">
          <div className="flex items-center gap-1">
            <span className="text-[10px] font-bold text-yellow-300">When</span>
            <select value={t.event} onChange={e => setEvent(i, e.target.value as TriggerEvent)} aria-label="When this happens" className={SELECT_CLS}>
              {events.map(ev => <option key={ev} value={ev}>{TRIGGER_EVENT_LABEL[ev]}</option>)}
            </select>
            <span aria-hidden className="text-gray-500">→</span>
            <select value={t.action} onChange={e => setAction(i, e.target.value as TriggerActionType)} aria-label="Do this" className={SELECT_CLS}>
              {TRIGGER_ACTIONS.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
            <button onClick={() => remove(i)} aria-label="Remove this rule" title="Remove this rule" className="rounded bg-red-900/70 px-1.5 py-1 text-[10px] font-bold text-red-200 hover:bg-red-800">✕</button>
          </div>
          <TriggerParamsFields trigger={t} templates={templates} enemyTypes={enemyTypes} onPatch={patch => patchParams(i, patch)} />
        </div>
      ))}
      <button onClick={add} className="w-full rounded bg-yellow-700/80 px-2 py-1 text-[11px] font-bold text-white transition-colors hover:bg-yellow-600">
        ⚡ Add a rule
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

// ── THE VIEW BAR (§4.3 / §5.2 — Week 2's bar split) ──────────────────────
/**
 * The bottom VIEW bar: how you LOOK at the map, never what the map IS.
 *
 * §4.1's first principle is one question per region — top = *what am I working on*, bottom = *how am I
 * looking at it / does it work*. Splitting these out of the top bar is what fixes §3.3, a **P0**: measured at
 * 1280×800 the nav's `scrollWidth` was **1763px against a clientWidth of 1246**, so Save, Play, Load and the
 * ⋯ More menu simply scrolled off the right edge of a normal laptop, in an `overflow-x-auto` strip with no
 * scroll affordance. Nothing here changes the map, so nothing here can be lost off-screen with consequences.
 *
 * It also collects the four VIEW toggles that were living inside ⚙ Stage next to a destructive grid resize
 * (§3.11) — "Night mode", "Debug overlay", "Show collisions", "Hide entities" are presentation, and they now
 * sit with presentation. The resize stays behind until §4.6 gives it a home in the Generate panel.
 *
 * Presentational: every value and handler is a prop, so the bar has no idea what a grid is.
 */

export function ViewBar({
  activeView, onIso, on2D, onTop, onFlow,
  facing, onFacing,
  playerRange, onPlayerRange,
  dayNight, onDayNight,
  showDebug, onDebug,
  showCollisions, onCollisions,
  hideEntities, onHideEntities,
  fps, renderMs,
  onHelp,
  onGuides,
  zoomPct,
}: {
  activeView: 'iso' | '2d' | 'top' | 'flow'
  onIso: () => void
  on2D: () => void
  onTop: () => void
  onFlow: () => void
  facing: Orientation
  onFacing: (facing: Orientation) => void
  playerRange: number | undefined
  onPlayerRange: (range: number | undefined) => void
  /** The 🎨 art-style switch. §4.1's first principle puts "how am I looking at it" in this bar, and a
   *  reskin changes no map data — so the style belongs here, not in the PROJECT bar (§4.3 lists only six
   *  things there). */
  /** §4.3 draws `🔍 100%` in this bar. */
  zoomPct: number
  dayNight: DayNight
  onDayNight: () => void
  showDebug: boolean
  onDebug: () => void
  showCollisions: boolean
  onCollisions: () => void
  hideEntities: boolean
  onHideEntities: () => void
  fps: number
  renderMs: number
  onHelp: () => void
  /** Open the step-by-step guides. Alexander, 2026-09-09: *"there's no general step by step guides on how
   *  to do stuff."* Its own button beside Help, because "what does this key do" and "how do I build a
   *  level" are different questions and burying one inside the other is how this went missing. */
  onGuides: () => void
}) {
  const overlays = [
    { label: 'Debug overlay', on: showDebug, onClick: onDebug, activeClass: 'bg-red-600' },
    { label: 'Show collisions', on: showCollisions, onClick: onCollisions, activeClass: 'bg-red-600' },
    { label: 'Hide entities', on: hideEntities, onClick: onHideEntities, activeClass: 'bg-amber-600' },
  ]
  const activeOverlays = overlays.filter(o => o.on).length
  const [overlaysOpen, setOverlaysOpen] = useState(false)
  const overlaysRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!overlaysOpen) return
    const onDown = (e: MouseEvent) => { if (!overlaysRef.current?.contains(e.target as Node)) setOverlaysOpen(false) }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [overlaysOpen])

  return (
    <nav
      aria-label="View"
      className="z z-bar"
    >
      <div className="seg" role="group" aria-label="How to look at the map">
        <ViewButton label="ISO" active={activeView === 'iso'} activeClass="" onClick={onIso} />
        <ViewButton label="2D" active={activeView === '2d'} activeClass="" onClick={on2D} />
        <ViewButton label="Top" active={activeView === 'top'} activeClass="" onClick={onTop} />
        <ViewButton label="Flow" active={activeView === 'flow'} activeClass="" onClick={onFlow} />
      </div>

      {/* Rotation + the render cull are ISO-only — they have no meaning in a flat projection. */}
      {activeView === 'iso' && <span className="vr" aria-hidden="true" />}
      {activeView === 'iso' && <CameraRotateButton facing={facing} onFacing={onFacing} />}
      {activeView === 'iso' && <PlayerRangeControl range={playerRange} onRange={onPlayerRange} />}

      <span className="vr" aria-hidden="true" />
      <button
        onClick={onDayNight}
        aria-pressed={dayNight === 'night'}
        title="Day / night lighting"
        className={`b sm${dayNight === 'night' ? ' on' : ''}`}
      >
        {dayNight === 'night' ? '🌙 Night' : '☀ Day'}
      </button>

      {/* RELATIVE trigger, ABSOLUTE panel anchored to it. The shared `Dropdown` is deliberately FIXED so it
          can escape the TOP bar's clipping — but this bar sits at the BOTTOM, so a fixed panel anchored
          "under" the button lands off the bottom of the screen. Anchored to its own trigger it opens
          UPWARD (`bottom-full`), where there is room. */}
      <div ref={overlaysRef} className="relative shrink-0">
        <button
          onClick={() => setOverlaysOpen(o => !o)}
          aria-expanded={overlaysOpen}
          aria-haspopup="menu"
          title="Debug overlays"
          className="b sm"
        >
          👁 Overlays{activeOverlays > 0 ? ` (${activeOverlays})` : ''} ▾
        </button>
        {overlaysOpen && (
          <div
            role="menu"
            aria-label="Debug overlays"
            className="absolute bottom-full left-0 z-30 mb-2 w-52 space-y-1 rounded-lg border border-white/10 bg-gray-950 p-2 shadow-2xl"
          >
            {overlays.map(o => (
              <button
                key={o.label}
                role="menuitemcheckbox"
                aria-checked={o.on}
                onClick={o.onClick}
                className={`w-full rounded px-2 py-1 text-xs font-bold transition-colors ${o.on ? o.activeClass : 'bg-gray-700 hover:bg-gray-600'}`}
              >
                {o.label} {o.on ? 'on' : 'off'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 🔍 zoom readout — §4.3 draws it between ◎ Range and the day/night toggle. */}
      <span className="h-5 w-px shrink-0 bg-white/15" />
      <span className="shrink-0 tabular-nums text-xs text-gray-300" title="Camera zoom (mouse wheel)">🔍 {zoomPct}%</span>

      {/* 🎨 Style is NOT here — Alexander, 2026-09-08: it is *"a separate group, which list all available
          art styles"*, so it is a rail entry (`artstyle`) with its own panel. */}

      <span className="ml-auto flex shrink-0 items-center gap-2">
        <FpsReadout fps={fps} renderMs={renderMs} variant="nav" />
        <button
          type="button"
          className="b sm"
          onClick={onGuides}
          title="Whole jobs, start to finish — each step names the button it means"
        >
          Guides
        </button>
        <HelpButton onOpen={onHelp} />
      </span>
    </nav>
  )
}
