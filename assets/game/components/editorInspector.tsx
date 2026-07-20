// Inspector controls for the game-engine editor: the ◰ Art section, the live pose editor, and the
// per-tile property panel (dims / z-width / z-index / display / shape / light / z-pos). Pure
// presentational + props-driven — extracted verbatim from editorChrome.tsx (SRP: one file per concern).
import { useState } from 'react'
import type { DepthDir } from '@/engine/render'
import type { TilePose } from '@/engine/tileset/pose'
import type { AssetLight, TileDisplay, TileShape } from '@/engine/tileset/tileset'
import type { Animation as TileAnim } from '@/engine/animation/tileAnimation'
import type { Visual } from '@/game/artStyle'

/** A small thumbnail of a tile's baked art — an <img> for an image tile, else its glyph. Lets the Inspector
 *  SHOW the currently-selected tile at a glance (Image #67: "see the current selected tile"). An ASCII
 *  passthrough has no art of its own, so it renders a neutral dot. */
export function TilePreview({ visual, label }: { visual?: Visual; label: string }) {
  const box = 'flex h-7 w-7 shrink-0 items-center justify-center rounded border border-white/10 bg-black/50'
  if (visual?.kind === 'image') return <span className={box}><img src={visual.src} alt={label} className="h-5 w-5 object-contain" /></span>
  const char = visual?.kind === 'glyph' ? visual.char : '·'
  return <span className={box}><span aria-hidden className="text-lg leading-none">{char}</span></span>
}

/** Inspector ◰ Art section — shows whether this element follows the global style or a pinned
 *  tile, and opens the Tile Library modal to change it. The button `label` is caller-driven: a cell
 *  reads "Add tile" / "Replace tile" by its occupancy (the tile-add action names itself by cell STATE,
 *  no tile-type branch); a unit keeps the default "Open Tile Library…". */
export function ArtSection({ override, styleName, onOpen, label = '◰ Open Tile Library…' }: { override?: string | null; styleName: string; onOpen: () => void; label?: string }) {
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

/** A FREE-FORM numeric field — the typeable half of every slider row. Unlike a bounded `<input type=number>`
 *  it (1) can hold an EMPTY string, a lone "-", or a trailing "." WHILE editing, so select-all + delete +
 *  retype never snaps back mid-edit, and (2) has NO min/max, so a value BELOW the slider's min or ABOVE its
 *  max is honored — the typed number is written through as-is. It commits every time the draft parses to a
 *  finite number (live, so the scene updates as you type) and holds an un-committable draft (empty / "-" /
 *  "abc") WITHOUT writing. On blur it drops the draft so the display re-syncs to the committed `value`, which
 *  means an emptied field reverts to the last value (treated as "unchanged"). A text input — not `number` —
 *  because a controlled `number` input cannot hold those intermediate strings (it reports them as ""). */
function NumberField({ value, onCommit, ariaLabel, className }: {
  value: number
  onCommit: (v: number) => void
  ariaLabel: string
  className?: string
}) {
  const [draft, setDraft] = useState<string | null>(null) // null = mirror `value`; a string = mid-edit
  const onChange = (raw: string) => {
    setDraft(raw)
    const trimmed = raw.trim()
    if (trimmed === '') return // empty → unchanged; keep the empty draft on screen
    const n = Number(trimmed)
    if (Number.isFinite(n)) onCommit(n) // out-of-range honored; "-" / "1e" / "abc" → NaN → held, not written
  }
  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft ?? String(value)}
      onChange={e => onChange(e.target.value)}
      onBlur={() => setDraft(null)}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      aria-label={ariaLabel}
      className={className}
    />
  )
}

/** One labeled row of the pose editor: a range slider paired with a typeable number input (same units).
 *  Unit-agnostic — the caller converts (e.g. degrees→radians for rotation) so this stays a dumb control. */
function PoseRow({ label, value, min, max, step, suffix, onInput }: { label: string; value: number; min: number; max: number; step: number; suffix?: string; onInput: (v: number) => void }) {
  const emit = (raw: string) => { const n = parseFloat(raw); if (!Number.isNaN(n)) onInput(n) }
  return (
    <label className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-[10px] text-gray-400">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => emit(e.target.value)} aria-label={label} className="flex-1 accent-cyan-500" />
      <NumberField value={value} onCommit={onInput} ariaLabel={`${label} value`} className="w-14 rounded bg-gray-800 p-1 text-[10px] tabular-nums text-cyan-300" />
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

/** The four per-tile sprite-scale axes (#77/#78). Width/Height/Depth are per-axis; Zoom is uniform. */
export type DimAxis = 'width' | 'height' | 'depth' | 'zoom'
export interface ElementDims {
  width: number | null // shared scaleX, or null (mixed)
  height: number | null // shared scaleY, or null (mixed)
  depth: number | null // shared scaleZ, or null (mixed)
  zoom: number | null // shared scale (uniform), or null (mixed)
}

/** The ONE selected tile in the Cell inspector, as a single consolidated control group. A cell is a fixed
 *  slot; the ONE tile the user has selected in its stack (the floor is the height-0 tile, a wall/prop is a
 *  stacked block) gets EVERY control in ONE group: which-tile + Open Tile Library (swap it), colour, the
 *  Width/Height/Zoom scale axes (+ Z Width directional depth for asset tiles), and the x/y/z/rotate/flip
 *  transform. NO separate FLOOR / POSE / colour
 *  sections. The page pre-computes each shared value across a multi-cell selection (`null` = the tiles
 *  differ → "mixed") and each callback writes the edit to THIS stack level across the whole selection. */
export interface TileControlModel {
  /** stable identity for the react key. */
  key: string
  /** what this tile IS, shown in the TILE section header, e.g. "grass" or "wall". */
  label: string
  /** shared Width/Height/Depth/Zoom (null per axis = mixed). */
  dims: ElementDims
  /** shared colour override, or null (none/mixed). */
  color: string | null
  /** swatch shown when `color` is null. */
  colorFallback: string
  onDim: (axis: DimAxis, value: number) => void
  onColor: (color: string) => void
  /** floor tiles can reset to the tileset colour; props may omit. */
  onClearColor?: () => void
  /** DIRECTIONAL DEPTH ("Z Width"): how many cells this block extrudes into a long iso box (asset.depth;
   *  null = mixed). Present only for asset tiles that support it — the floor omits it (no directional depth). */
  zWidth?: number | null
  /** which iso diagonal the Z Width grows along (asset.depthDir; null = none/mixed). */
  zDir?: DepthDir | null
  onZWidth?: (cells: number) => void
  onZDir?: (dir: DepthDir) => void
  /** "z position": ISO-DIAGONAL slide magnitude in cells (asset.zOffset; null = mixed). NOT a vertical lift —
   *  the tile moves along zPosDir's diagonal. Asset tiles only. */
  zPos?: number | null
  onZPos?: (value: number) => void
  /** "z position" DIRECTION: which iso diagonal the z slide moves along (asset.zDir; null = default/mixed).
   *  Same 4 dirs + labels as Z Width; +z slides toward it, −z toward its opposite. Asset tiles only. */
  zPosDir?: DepthDir | null
  onZPosDir?: (dir: DepthDir) => void
  /** "z-index": DRAW-PRIORITY (CSS z-index style) — a higher value draws on top / in front of a lower one,
   *  overriding the positional depth sort (asset.zIndex; null = mixed). Asset tiles only. */
  zIndex?: number | null
  onZIndex?: (value: number) => void
  /** DISPLAY mode — how the tile is painted on its block: 'all-faces' (paint on every visible face) vs
   *  'single' (ONE centered tile inside the block). Reads asset.settings.display; null = mixed. Asset tiles
   *  only — the floor omits onDisplay (a flat cell has no block volume to sit a single tile inside). */
  display?: TileDisplay | null
  onDisplay?: (mode: TileDisplay) => void
  /** SHAPE — the solid the tile renders as: 'square' (cube, default) vs 'circle' (a shaded ball). Reads
   *  asset.shape; null = mixed. Asset tiles only (mirrors Display — the floor has no block to reshape). */
  shape?: TileShape | null
  onShape?: (shape: TileShape) => void
  /** LIGHT — the warm night ground GLOW POOL this tile casts (GridAsset.light): intensity (strength), distance
   *  (radius in cells), colour, and an on/off toggle. Reads the first selected tile's light (undefined = none).
   *  Asset tiles only. `onLight(undefined)` clears the setting. */
  light?: AssetLight
  onLight?: (light: AssetLight | undefined) => void
  /** the tile pinned to this stack level (GridAsset.tileOverride), or null = follows the global style. */
  override?: string | null
  /** the active global style name, shown in the "Change tile" affordance. */
  styleName: string
  /** open the Tile Library to SWAP this tile — the same "current sprite → Open Tile Library" flow the
   *  entity inspector uses. */
  onOpenLibrary: () => void
  /** pose for this tile: the floor carries a real per-cell pose; a stacked asset routes to its tileset-kind
   *  pose (GridAsset has no per-instance pose field). Absent = this tile is not posable. */
  pose?: TilePose
  onPose?: (pose: TilePose) => void
  onPoseReset?: () => void
  /** weapon tiles get a muzzle row. */
  isWeapon?: boolean
  /** the TILE ANIMATIONS authored on this placed tile (Phase 4) — surfaced as a count on the Animate button.
   *  Present only for asset tiles (the floor omits onOpenAnimator). */
  animations?: TileAnim[]
  /** open the dedicated animation modal for this tile. Present only for asset tiles. */
  onOpenAnimator?: () => void
}

/** The ONE inspector card a CELL and a UNIT both use. For a CELL: a COLLISION row (its sole tunable prop) +
 *  a COMPACT SUMMARY of the ONE selected tile — swap-tile (Open Tile Library), a colour swatch, and the
 *  buttons "Edit settings…" (opens the full settings MODAL {@link TileControls}), Animate, Remove — with a
 *  level stepper to reach every block. For a UNIT: the caller passes `unitSection`, which HIDES the collision
 *  row (a unit isn't a cell) and folds the unit's identity/vitals/inventory UNDER the same tile summary — so a
 *  unit is configured on the SAME card as a tile, not a parallel sidebar. Both get a "Triggers…" button
 *  (`onOpenTriggers`) that opens the trigger-authoring modal. The heavy per-axis controls stay in the modal. */
export interface PropertiesPanelProps {
  /** shared collision state across the selection, or null (mixed). */
  collision: boolean | null
  onCollision: (blocked: boolean) => void
  /** the ONE selected tile, or null when the cell holds no tile at all (→ only the CELL section shows). */
  tile: TileControlModel | null
  /** 1-based position of the selected tile in the stack (1 = floor). */
  level: number
  /** total tiles in the selected cell's stack (floor + stacked). >1 → the level stepper shows. */
  levelCount: number
  /** select a tile by 0-based stack index (0 = floor) — the ▲▼ stepper reaches every block. */
  onLevel: (index0: number) => void
  /** open the tile-settings MODAL (the {@link TileControls} body) — the "Edit settings…" button. */
  onOpenSettings: () => void
  /** CLEAR every tile off the selected cell(s) — drops the stacked assets, like an erase over the selection
   *  (Image #67). A CELL-level action, so it shows even when the selected tile is the floor; absent for a unit
   *  (a unit isn't a cell). Wired to the existing erase path, captured by undo/redo. */
  onClearTiles?: () => void
  /** remove the SELECTED tile from the grid (not the floor — the caller omits this for level 0). Shows a
   *  "Remove tile" button in the tile section when provided; absent → no button (e.g. the floor). */
  onRemove?: () => void
  /** open the triggers-management MODAL (the "⚑ Triggers…" button) — for a CELL and a UNIT alike. Replaces
   *  the old inline trigger expando: authoring now lives in a floating panel, opened from this button. */
  onOpenTriggers?: () => void
  /** how many triggers the selected cell/unit currently has — surfaced as a count on the Triggers button. */
  triggerCount?: number
  /** the UNIT-only extras section (identity/vitals/inventory/quests/attacks), composed by the page. When
   *  present, THIS card is a unit: the cell-collision row is hidden (a unit isn't a cell) and the section
   *  renders under the shared tile summary — the ONE card a tile and a unit both use. Absent → a plain cell. */
  unitSection?: React.ReactNode
}

const mixedBadge = <span className="text-[9px] italic text-amber-300">mixed</span>
const parseNum = (raw: string, cb: (n: number) => void) => { const n = parseFloat(raw); if (!Number.isNaN(n)) cb(n) }

/** A sprite-scale row (Width/Height/Depth/Zoom): default 1 = the tile's natural drawn size. */
function DimRow({ label, axis, value, title, onDim }: { label: string; axis: DimAxis; value: number | null; title: string; onDim: (axis: DimAxis, value: number) => void }) {
  return (
    <label className="flex items-center gap-2" title={title}>
      <span className="w-14 shrink-0 text-[10px] text-gray-400">{label}</span>
      <input type="range" min={0.25} max={5} step={0.05} value={value ?? 1} onChange={e => parseNum(e.target.value, v => onDim(axis, v))} aria-label={label} className="flex-1 accent-cyan-500" />
      <NumberField value={value ?? 1} onCommit={v => onDim(axis, v)} ariaLabel={`${label} value`} className="w-14 rounded bg-gray-800 p-1 text-[10px] tabular-nums text-cyan-300" />
      {value === null && mixedBadge}
    </label>
  )
}

/** The four directional-depth options with the USER's exact labels, laid out 2×2 to match where the box grows
 *  on screen (top row = up diagonals, bottom row = down diagonals; left = ←, right = →). Each maps to a
 *  DepthDir (verified against the iso projection: right top = up-right, etc.). */
const Z_WIDTH_DIRS: { label: string; dir: DepthDir }[] = [
  { label: 'left top', dir: 'left-up' },
  { label: 'right top', dir: 'right-up' },
  { label: 'bottom left', dir: 'left-down' },
  { label: 'bottom right', dir: 'right-down' },
]

/** Z WIDTH — directional depth: how many cells the selected BLOCK extrudes into a long iso box, plus WHICH
 *  diagonal it grows along. Replaces the old symmetric "Depth" (scaleZ) stretch — the value is a cell count
 *  (integer), and the render extrudes the long box via isoDepthBox in the chosen direction. */
function ZWidthRow({ zWidth, zDir, onZWidth, onZDir }: { zWidth: number | null; zDir: DepthDir | null; onZWidth: (cells: number) => void; onZDir: (dir: DepthDir) => void }) {
  return (
    <div className="space-y-1">
      <label className="flex items-center gap-2" title="Z Width — how many cells this block extrudes into a long iso box, along the chosen direction (iso view)">
        <span className="w-14 shrink-0 text-[10px] text-gray-400">Z Width</span>
        <input type="range" min={1} max={8} step={1} value={zWidth ?? 1} onChange={e => parseNum(e.target.value, onZWidth)} aria-label="Z Width" className="flex-1 accent-cyan-500" />
        <NumberField value={zWidth ?? 1} onCommit={onZWidth} ariaLabel="Z Width value" className="w-14 rounded bg-gray-800 p-1 text-[10px] tabular-nums text-cyan-300" />
        {zWidth === null && mixedBadge}
      </label>
      <div className="grid grid-cols-2 gap-1 pl-16" role="group" aria-label="Z Width direction">
        {Z_WIDTH_DIRS.map(({ label, dir }) => (
          <button key={dir} onClick={() => onZDir(dir)} aria-pressed={zDir === dir} className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${zDir === dir ? 'bg-cyan-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>{label}</button>
        ))}
      </div>
    </div>
  )
}

/** Z-INDEX — draw-PRIORITY (CSS z-index style): a HIGHER value draws on top / in front of a lower one,
 *  overriding the positional depth sort in every view. An integer (default 0); the fountain water sits at a
 *  high value so it renders in front of a wall behind it. Asset tiles only — the floor omits onZIndex. */
function ZIndexRow({ zIndex, onZIndex }: { zIndex: number | null; onZIndex: (value: number) => void }) {
  return (
    <label className="flex items-center gap-2" title="Z-Index — draw priority (like CSS z-index): a higher value draws on top / in front, overriding the depth sort (every view)">
      <span className="w-14 shrink-0 text-[10px] text-gray-400">Z-Index</span>
      <input type="range" min={0} max={100} step={1} value={zIndex ?? 0} onChange={e => parseNum(e.target.value, v => onZIndex(Math.round(v)))} aria-label="Z-Index" className="flex-1 accent-cyan-500" />
      <NumberField value={zIndex ?? 0} onCommit={v => onZIndex(Math.round(v))} ariaLabel="Z-Index value" className="w-14 rounded bg-gray-800 p-1 text-[10px] tabular-nums text-cyan-300" />
      {zIndex === null && mixedBadge}
    </label>
  )
}

/** DISPLAY — how the tile is PAINTED on its block: "all faces" paints the baked tile on the block's top + two
 *  visible faces (the default); "single" shows ONE centered tile INSIDE the block volume (a single water
 *  droplet floating in the block — the fountain case). A two-button toggle mirroring the collision toggle.
 *  Asset tiles only. */
function DisplayModeRow({ display, onDisplay }: { display: TileDisplay | null; onDisplay: (mode: TileDisplay) => void }) {
  return (
    <label className="flex items-center gap-2" title="Display — paint the tile on ALL faces of the block, or show ONE tile inside the block">
      <span className="w-14 shrink-0 text-[10px] text-gray-400">Display</span>
      <button onClick={() => onDisplay('all-faces')} aria-pressed={display === 'all-faces'} className={`rounded px-2 py-0.5 text-[10px] font-bold ${display === 'all-faces' ? 'bg-cyan-600 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}>All faces</button>
      <button onClick={() => onDisplay('single')} aria-pressed={display === 'single'} className={`rounded px-2 py-0.5 text-[10px] font-bold ${display === 'single' ? 'bg-cyan-600 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}>Single</button>
      {display === null && mixedBadge}
    </label>
  )
}

/** SHAPE — the SOLID the tile's block renders as: "Square" (the default cube) or "Circle" (a shaded ball). A
 *  two-button toggle mirroring the Display toggle. Asset tiles only. Designed to grow (Oval, …) — add a button
 *  + a render drawer, no new branch. */
function ShapeModeRow({ shape, onShape }: { shape: TileShape | null; onShape: (shape: TileShape) => void }) {
  return (
    <label className="flex items-center gap-2" title="Shape — render the tile as a cube (square) or a ball (circle)">
      <span className="w-14 shrink-0 text-[10px] text-gray-400">Shape</span>
      <button onClick={() => onShape('square')} aria-pressed={shape === 'square'} className={`rounded px-2 py-0.5 text-[10px] font-bold ${shape === 'square' ? 'bg-cyan-600 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}>Square</button>
      <button onClick={() => onShape('circle')} aria-pressed={shape === 'circle'} className={`rounded px-2 py-0.5 text-[10px] font-bold ${shape === 'circle' ? 'bg-cyan-600 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}>Circle</button>
      {shape === null && mixedBadge}
    </label>
  )
}

/** The default LIGHT a tile takes when the user first turns its light ON — matches the seeded lamp default
 *  (today's warm LAMP_GLOW: intensity 1, radius 3.2 cells, #ffd98a). */
const DEFAULT_LIGHT: AssetLight = { intensity: 1, distance: 3.2, color: '#ffd98a', on: true }

/** LIGHT — a real, controllable SETTING (Alexander: "a regular setting that allows me to control the light
 *  intensity and distance"): the tile casts a warm ground GLOW POOL at night. An On/Off toggle plus an
 *  intensity slider (pool strength 0–1), a distance slider (pool radius in cells), and a colour picker. Editing
 *  any control materialises the light (turning it On); Off keeps the values but casts no pool. Asset tiles only. */
function LightControls({ light, onLight }: { light: AssetLight | undefined; onLight: (light: AssetLight | undefined) => void }) {
  const cur = light ?? DEFAULT_LIGHT
  const isOn = !!light && light.on !== false
  const isOff = !!light && light.on === false
  const patch = (p: Partial<AssetLight>) => onLight({ ...cur, ...p, on: true }) // editing a value turns the light On
  return (
    <div className="space-y-1 rounded border border-gray-700 p-1.5">
      <div className="flex items-center gap-2" title="Light — cast a warm ground glow pool at night from this tile">
        <span className="w-14 shrink-0 text-[10px] font-bold text-amber-300">Light</span>
        <button onClick={() => onLight({ ...cur, on: true })} aria-pressed={isOn} className={`rounded px-2 py-0.5 text-[10px] font-bold ${isOn ? 'bg-amber-600 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}>On</button>
        <button onClick={() => onLight({ ...cur, on: false })} aria-pressed={isOff} className={`rounded px-2 py-0.5 text-[10px] font-bold ${isOff ? 'bg-amber-600 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}>Off</button>
        {!light && <span className="text-[9px] italic text-gray-500">none</span>}
      </div>
      <label className="flex items-center gap-2" title="Intensity — how strong the light pool is (0–1)">
        <span className="w-14 shrink-0 text-[10px] text-gray-400">Intensity</span>
        <input type="range" min={0} max={1} step={0.05} value={cur.intensity} onChange={e => parseNum(e.target.value, v => patch({ intensity: v }))} aria-label="Light intensity" className="flex-1 accent-amber-500" />
        <NumberField value={cur.intensity} onCommit={v => patch({ intensity: v })} ariaLabel="Light intensity value" className="w-14 rounded bg-gray-800 p-1 text-[10px] tabular-nums text-amber-300" />
      </label>
      <label className="flex items-center gap-2" title="Distance — how far the light pool reaches, in cells">
        <span className="w-14 shrink-0 text-[10px] text-gray-400">Distance</span>
        <input type="range" min={0} max={12} step={0.1} value={cur.distance} onChange={e => parseNum(e.target.value, v => patch({ distance: v }))} aria-label="Light distance" className="flex-1 accent-amber-500" />
        <NumberField value={cur.distance} onCommit={v => patch({ distance: v })} ariaLabel="Light distance value" className="w-14 rounded bg-gray-800 p-1 text-[10px] tabular-nums text-amber-300" />
      </label>
      <label className="flex items-center gap-2" title="Colour — the hue of the light pool">
        <span className="w-14 shrink-0 text-[10px] text-gray-400">Colour</span>
        <input type="color" value={cur.color ?? '#ffd98a'} onChange={e => patch({ color: e.target.value })} aria-label="Light colour" className="h-6 w-10 rounded bg-gray-800" />
      </label>
    </div>
  )
}

/** Z POSITION — SLIDE the tile along an iso DIAGONAL (NOT a vertical lift): a magnitude (± cells) plus WHICH
 *  diagonal it slides along, reusing the same 4 dirs + labels as Z Width. +z slides TOWARD the picked dir,
 *  −z toward its opposite; default 'right-up' ("right top") → +z = up-right toward the back. The direction
 *  buttons always show one highlighted (the effective default) so there's never a "no direction" limbo. */
function ZPosRow({ zPos, zDir, onZPos, onZDir }: { zPos: number | null; zDir: DepthDir | null; onZPos: (value: number) => void; onZDir: (dir: DepthDir) => void }) {
  const active = zDir ?? 'right-up' // z always has an effective direction (render defaults to right-up)
  return (
    <div className="space-y-1">
      <PoseRow label="z" value={zPos ?? 0} min={-4} max={4} step={0.1} onInput={onZPos} />
      <div className="grid grid-cols-2 gap-1 pl-16" role="group" aria-label="Z position direction">
        {Z_WIDTH_DIRS.map(({ label, dir }) => (
          <button key={dir} onClick={() => onZDir(dir)} aria-pressed={active === dir} className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${active === dir ? 'bg-cyan-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>{label}</button>
        ))}
      </div>
    </div>
  )
}

/** The SETTINGS body for the SELECTED tile — every tunable control in one flat block: colour, the
 *  Width/Height/Zoom scale axes (+ Z Width directional depth for asset tiles), then the x/y/z/rotate/flip
 *  transform, Z-Index and Display. This is the body the "Edit settings…" modal hosts (mirroring the
 *  tile-animation modal); the swap-tile (Open Tile Library) + Animate + Remove affordances live in the
 *  compact inspector summary, NOT here. The floor (a height-0 tile) and a stacked wall/prop use the EXACT
 *  SAME body; only the writers differ (the page routes floor→per-cell, asset→its tileset kind). */
export function TileControls({ tile }: { tile: TileControlModel }) {
  const pose = tile.pose
  const setPose = tile.onPose ? (patch: Partial<TilePose>) => tile.onPose!({ ...pose, ...patch }) : null
  const rotDeg = Math.round((pose?.rot ?? 0) * 180 / Math.PI)
  return (
    <div className="space-y-1.5">
      {/* ONE colour for the tile (floor→groundColor, asset→asset.color) — no separate pose colour */}
      <div className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-[10px] text-gray-400">Colour</span>
        <input type="color" value={tile.color ?? tile.colorFallback} onChange={e => tile.onColor(e.target.value)} aria-label={`${tile.label} colour`} className="h-6 w-10 rounded bg-gray-800" />
        {tile.color === null && mixedBadge}
        {tile.onClearColor && <button onClick={tile.onClearColor} className="ml-auto rounded bg-gray-700 px-2 py-0.5 text-[9px] hover:bg-gray-600" title="Reset to the tile's own colour">↺ reset</button>}
      </div>
      <DimRow label="Width" axis="width" value={tile.dims.width} title="Width — horizontal stretch (every view)" onDim={tile.onDim} />
      <DimRow label="Height" axis="height" value={tile.dims.height} title="Height — grows UP from the base (iso + 2D views)" onDim={tile.onDim} />
      {/* Z Width (directional depth): extrudes the block into a long iso box along a chosen diagonal. Replaces
          the old symmetric "Depth" (scaleZ) stretch. Asset tiles only — the floor omits onZWidth. */}
      {tile.onZWidth && <ZWidthRow zWidth={tile.zWidth ?? 1} zDir={tile.zDir ?? null} onZWidth={tile.onZWidth} onZDir={tile.onZDir ?? (() => {})} />}
      {/* Z-Index (draw priority): a higher value draws on top / in front, overriding the depth sort. Asset tiles only. */}
      {tile.onZIndex && <ZIndexRow zIndex={tile.zIndex ?? 0} onZIndex={tile.onZIndex} />}
      {/* Display mode: paint the tile on ALL faces, or ONE tile inside the block. Asset tiles only. */}
      {tile.onDisplay && <DisplayModeRow display={tile.display ?? 'all-faces'} onDisplay={tile.onDisplay} />}
      {/* Shape: render the tile's block as a cube (square) or a ball (circle). Asset tiles only. */}
      {tile.onShape && <ShapeModeRow shape={tile.shape ?? 'square'} onShape={tile.onShape} />}
      {/* Light: cast a warm ground glow pool at night, with intensity/distance/colour + on-off. Asset tiles only. */}
      {tile.onLight && <LightControls light={tile.light} onLight={tile.onLight} />}
      <DimRow label="Zoom" axis="zoom" value={tile.dims.zoom} title="Zoom — scales Width, Height and Zoom together" onDim={tile.onDim} />
      {/* x/y/rotate/flip live in the SAME group — there is NO separate POSE section */}
      {setPose && (
        <>
          <PoseRow label="x" value={pose?.dx ?? 0} min={-1} max={1} step={0.01} onInput={v => setPose({ dx: v })} />
          <PoseRow label="y" value={pose?.dy ?? 0} min={-1} max={1} step={0.01} onInput={v => setPose({ dy: v })} />
          {/* z = an ISO-DIAGONAL slide (NOT a vertical lift): magnitude + which of the 4 diagonals it moves
              along, distinct from the screen-plane x/y offsets. Asset tiles only. */}
          {tile.onZPos && <ZPosRow zPos={tile.zPos ?? 0} zDir={tile.zPosDir ?? null} onZPos={tile.onZPos} onZDir={tile.onZPosDir ?? (() => {})} />}
          <PoseRow label="rotate" value={rotDeg} min={-180} max={180} step={1} suffix="°" onInput={v => setPose({ rot: v * Math.PI / 180 })} />
          {tile.isWeapon && <PoseRow label="muzzle" value={pose?.muzzle ?? 0} min={0} max={1} step={0.05} onInput={v => setPose({ muzzle: v })} />}
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={pose?.flip ?? false} onChange={e => setPose({ flip: e.target.checked })} aria-label="flip horizontally" className="accent-cyan-500" />
            <span className="text-[10px] text-gray-400">flip horizontally</span>
          </label>
          {tile.onPoseReset && (
            <button onClick={tile.onPoseReset} className="w-full rounded bg-gray-700 px-2 py-1 text-[10px] font-bold text-white transition-colors hover:bg-gray-600">
              ↺ Reset pose
            </button>
          )}
        </>
      )}
    </div>
  )
}

/** The Cell inspector body — EXACTLY TWO sections. The CELL section (collision only — the cell's sole
 *  tunable prop) then the TILE section: a COMPACT SUMMARY of the ONE selected tile — its name in the header
 *  with a ▲▼ level stepper, swap-tile (Open Tile Library), a colour swatch, and the buttons. The full
 *  per-axis controls open in the settings MODAL via "Edit settings…". No per-tile-in-stack sections. */
export function PropertiesPanel(p: PropertiesPanelProps) {
  const t = p.tile
  // A UNIT card passes `unitSection`: it hides the cell-collision row (a unit isn't a cell) and appends the
  // unit-only extras under the SAME tile summary — one card serves a tile and a unit, no parallel sidebar.
  const isUnit = !!p.unitSection
  return (
    <div className="space-y-1.5 text-xs">
      {!isUnit && (
        <>
          <p className="text-[9px] font-bold uppercase tracking-wider text-gray-500">— cell —</p>
          <div className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-[10px] text-gray-400">Collision</span>
            <button onClick={() => p.onCollision(true)} aria-pressed={p.collision === true} className={`rounded px-2 py-0.5 text-[10px] font-bold ${p.collision === true ? 'bg-red-600 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}>Blocked</button>
            <button onClick={() => p.onCollision(false)} aria-pressed={p.collision === false} className={`rounded px-2 py-0.5 text-[10px] font-bold ${p.collision === false ? 'bg-emerald-600 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}>Walkable</button>
            {p.collision === null && mixedBadge}
          </div>
          {/* Clear tiles — a PROMINENT cell-level erase: drops every stacked tile off the selected cell(s).
              Shown for a cell even when the floor is selected (it's a cell action, not a tile action). */}
          {p.onClearTiles && (
            <button onClick={p.onClearTiles} aria-label="Clear tiles" className="w-full rounded bg-red-800 px-2 py-1.5 text-xs font-bold text-white transition-colors hover:bg-red-700">
              🧹 Clear tiles
            </button>
          )}
        </>
      )}
      {t && (
        <>
          <div className={`flex items-center justify-between ${isUnit ? '' : 'mt-1 border-t border-white/10 pt-1.5'}`}>
            {/* "everything is a tile": a unit's sprite is shown as its tile, same header shape a cell tile uses.
                A thumbnail of the tile's baked art (a SIBLING of the divider text, not inside it) SHOWS the
                currently-selected tile at a glance (Image #67). */}
            <span className="flex items-center gap-1.5">
              <TilePreview visual={t.preview} label={t.label} />
              <p className="text-[9px] font-bold uppercase tracking-wider text-gray-500">— tile · {t.label} —</p>
            </span>
            {p.levelCount > 1 && (
              <span className="flex items-center gap-1 text-[9px] text-gray-400" aria-label="Select stack level">
                <button onClick={() => p.onLevel(p.level - 2)} disabled={p.level <= 1} aria-label="Lower tile" className="rounded bg-gray-700 px-1 leading-none hover:bg-gray-600 disabled:opacity-30">▼</button>
                <span className="tabular-nums">level {p.level}/{p.levelCount}</span>
                <button onClick={() => p.onLevel(p.level)} disabled={p.level >= p.levelCount} aria-label="Higher tile" className="rounded bg-gray-700 px-1 leading-none hover:bg-gray-600 disabled:opacity-30">▲</button>
              </span>
            )}
          </div>
          {/* swap-tile — kept accessible in the summary (does NOT live in the settings modal) */}
          <ArtSection override={t.override} styleName={t.styleName} onOpen={t.onOpenLibrary} />
          {/* quick colour swatch — the one setting worth tweaking without opening the modal */}
          <div className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-[10px] text-gray-400">Colour</span>
            <input type="color" value={t.color ?? t.colorFallback} onChange={e => t.onColor(e.target.value)} aria-label={`${t.label} colour`} className="h-6 w-10 rounded bg-gray-800" />
            {t.color === null && mixedBadge}
          </div>
          {/* open the full settings — colour, W/H/Z Width, Zoom, x/y/z, rotate, flip, Z-Index, Display */}
          <button onClick={p.onOpenSettings} aria-label="Edit settings" className="w-full rounded bg-cyan-800 px-2 py-1.5 text-xs font-bold text-white transition-colors hover:bg-cyan-700">
            ⚙ Edit settings…
          </button>
          {/* Animate — opens its OWN modal. A tile authors GridAsset settings tweens; a unit authors its
              frame-by-frame character animations. Present whenever the model wires onOpenAnimator. */}
          {t.onOpenAnimator && (
            <button onClick={t.onOpenAnimator} aria-label="Animate tile" className="w-full rounded bg-fuchsia-800 px-2 py-1 text-[10px] font-bold text-white transition-colors hover:bg-fuchsia-700">
              ✦ Animate…{t.animations?.length ? ` (${t.animations.length})` : ''}
            </button>
          )}
          {p.onRemove && (
            <button onClick={p.onRemove} className="w-full rounded bg-red-700 px-2 py-1 text-[10px] font-bold text-white transition-colors hover:bg-red-600">
              🗑 Remove tile
            </button>
          )}
        </>
      )}
      {/* Unit-only extras (identity/vitals/inventory/quests/attacks) — folded INTO this one card for a unit. */}
      {p.unitSection && <div className="border-t border-white/10 pt-2">{p.unitSection}</div>}
      {/* Triggers — a BUTTON that opens the triggers-management modal (cell: enter/interact; unit: on defeat).
          Replaces the old inline expando; present for a bare cell too (a cell can trigger without a tile). */}
      {p.onOpenTriggers && (
        <button onClick={p.onOpenTriggers} aria-label="Edit triggers" className="w-full rounded bg-yellow-700/90 px-2 py-1 text-[10px] font-bold text-white transition-colors hover:bg-yellow-600">
          ⚑ Triggers…{p.triggerCount ? ` (${p.triggerCount})` : ''}
        </button>
      )}
    </div>
  )
}
