// Inspector controls for the game-engine editor: the ◰ Art section, the live pose editor, and the
// per-tile property panel (dims / z-width / z-index / display / shape / light / z-pos). Pure
// presentational + props-driven — extracted verbatim from editorChrome.tsx (SRP: one file per concern).
import { useState } from 'react'
import { sectionTitle, type InspectorSectionId } from '@/game/editor/inspectorSections'
import { rotateDepthDir } from '@/engine/render'
import type { DepthDir, ThicknessReach } from '@/engine/render'
import { InfoButton } from './shell/InfoButton'
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
        {label}
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
function PoseRow({ label, value, min, max, step, suffix, onInput, labelWidth = 'w-12', help }: { label: string; value: number; min: number; max: number; step: number; suffix?: string; onInput: (v: number) => void; labelWidth?: string; help?: string }) {
  const emit = (raw: string) => { const n = parseFloat(raw); if (!Number.isNaN(n)) onInput(n) }
  return (
    <label className="flex items-center gap-2">
      <span className={`${labelWidth} shrink-0 text-[10px] text-gray-400`}>
        {label}
        {/* Alexander asked outright what several of these meant. The ones with an answer carry it. */}
        {help && <InfoButton helpId={help} />}
      </span>
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
  /** BIDIRECTIONAL z-width (#58): cells this SAME block extends BACKWARD (asset.depthBack; 0 = one-way, null = mixed). */
  zBack?: number | null
  /** 2-AXIS z-width: cells along the PERPENDICULAR axis — forward (asset.depthPerp) + back (asset.depthPerpBack). */
  zPerp?: number | null
  zPerpBack?: number | null
  /** which iso diagonal the Z Width grows along (asset.depthDir; null = none/mixed). */
  zDir?: DepthDir | null
  onZWidth?: (cells: number) => void
  onZBack?: (cells: number) => void
  onZPerp?: (cells: number) => void
  onZPerpBack?: (cells: number) => void
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
  /** TRANSPARENT — hide the block SHELL so only the tile's content shows (with Display 'single', just the
   *  centered billboard, in its own colour): "style the flower without colouring the whole block". Reads
   *  asset.settings.transparent; null = mixed. Asset tiles only (a flat floor has no shell to hide). */
  transparent?: boolean | null
  /** THICKNESS as per-direction reaches, JSON-encoded so a multi-selection can report "mixed" as null.
   *  Present with `onThicknessReach` → the four Thickness rows render. */
  thickness?: string | null
  onThicknessReach?: (dir: DepthDir, value: number) => void
  /** The camera's quarter-turn, so every direction control reads in SCREEN space. */
  facing?: number
  onTransparent?: (on: boolean) => void
  /** ACT AS TILE — the cell behaves as if a tile is already inside it, so a tile placed on it stacks ON TOP
   *  (like a road/floor you walk over) instead of landing inside at level 0. Reads asset.settings.actAsTile;
   *  DEFAULT true (every cell); null = mixed. Asset tiles only. */
  actAsTile?: boolean | null
  onActAsTile?: (on: boolean) => void
  /** LIGHT — the warm night ground GLOW POOL this tile casts (GridAsset.light): intensity (strength), distance
   *  (radius in cells), colour, and an on/off toggle. Reads the first selected tile's light (undefined = none).
   *  Asset tiles only. `onLight(undefined)` clears the setting. */
  light?: AssetLight
  onLight?: (light: AssetLight | undefined) => void
  /** the tile pinned to this stack level (GridAsset.tileOverride), or null = follows the global style. */
  override?: string | null
  /** the active global style name, shown in the "Change tile" affordance. */
  styleName: string
  /** the tile's baked art, so the Inspector can SHOW the currently-selected tile (Image #67). Absent → a
   *  neutral placeholder. */
  preview?: Visual
  /** the tile-add button's label, driven by CELL STATE (not tile type): "Add tile" on an empty cell,
   *  "Replace tile" on a filled one. Absent → the default "Open Tile Library…" (a unit keeps that). */
  libraryLabel?: string
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

/** The ONE inspector card a CELL and a UNIT both use — identical controls, identical order, no fork: a
 *  COLLISION row, a Clear-tiles action, then a COMPACT SUMMARY of the ONE selected tile — swap-tile
 *  (Add / Replace tile), a colour swatch, and the buttons "Edit settings…" (opens the full settings MODAL
 *  {@link TileControls}), Animate, Remove — with a level stepper to reach every block, plus "Rules for
 *  this…" (`onOpenTriggers`). A UNIT additionally passes `unitSection`, which folds its name/size rows and its
 *  stats / inventory / quests / attacks entry buttons UNDER the same tile summary — so a unit is configured
 *  on the SAME card as a tile, never a parallel sidebar. The heavy per-axis controls stay in the modal. */
export interface PropertiesPanelProps {
  /** shared collision state across the selection, or null (mixed). For a UNIT this is its `blocksMovement`
   *  — ONE collision control serves cells and units alike (the old "Blocks movement" checkbox is gone). */
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
  /** Is this section open? From `useInspectorSections`, which reads the persisted `/api/editor_settings`
   *  row and falls back to §4.7's designed default. Required, not optional: a call site that forgot it would
   *  silently lose the remembered state the design asks for. */
  sectionOpen: (id: InspectorSectionId) => boolean
  onToggleSection: (id: InspectorSectionId) => void
  /** Where an open section's controls go. Absent → inline. See {@link SectionPresenter}. */
  present?: SectionPresenter
  /** CLEAR every tile off the selected cell(s) — drops the stacked assets AND the floor, like an erase over
   *  the selection (Image #67). It shows even when the selected tile is the floor, and for a UNIT too (the
   *  page targets the cell the unit stands on). Wired to the existing erase path, captured by undo/redo. */
  onClearTiles?: () => void
  /** remove the SELECTED tile from the grid (not the floor — the caller omits this for level 0). Shows a
   *  "Remove tile" button in the tile section when provided; absent → no button (e.g. the floor). For a UNIT
   *  this IS the delete action — removing a unit is removing a tile, so there is no bespoke Delete button. */
  onRemove?: () => void
  /** open the rules MODAL (the "⚑ Rules for this…" button) — for a CELL and a UNIT alike. Replaces the old
   *  inline expando: authoring now lives in a floating panel, opened from this button. The PROP and the type
   *  are still named `trigger` — the user-facing WORD changed, the data model did not. */
  onOpenTriggers?: () => void
  /** how many rules the selected cell/unit currently has — surfaced as a count on the Rules button. */
  triggerCount?: number
  /** Why this tile's look/size cannot be edited, when it cannot (§3.13 / §4.7).
   *
   *  §3.13 measured the trap: a building block whose stack entry is not an `asset` rendered "size/colour
   *  controls … normally but write nowhere". Passing the reason REPLACES those two sections with it, because
   *  §4.7 is explicit that "rendering live controls over no-op handlers is worse than showing nothing".
   *  Everything that DOES write — collision, the tile library, remove, clear — stays. */
  tileNotice?: string
  /** the UNIT-only extras section (name/size rows + stats/inventory/quests/attacks entry buttons), composed
   *  by the page. It ADDS to the shared card, hiding nothing — the ONE card a tile and a unit both use.
   *  Absent → a plain cell. */
  unitSection?: React.ReactNode
}

const mixedBadge = <span className="text-[9px] italic text-amber-300">mixed</span>
const parseNum = (raw: string, cb: (n: number) => void) => { const n = parseFloat(raw); if (!Number.isNaN(n)) cb(n) }

/** A sprite-scale row (Width/Height/Depth/Zoom): default 1 = the tile's natural drawn size.
 *  Every axis DRAGS DOWN TO 0 — a dimension is a measurement, and 0 is a value it can hold (a flat tile is
 *  0 blocks tall). The slider is the control; it must reach the whole range on its own, not defer to typing. */
function DimRow({ label, axis, value, title, onDim }: { label: string; axis: DimAxis; value: number | null; title: string; onDim: (axis: DimAxis, value: number) => void }) {
  return (
    <label className="flex items-center gap-2" title={title}>
      <span className="w-14 shrink-0 text-[10px] text-gray-400">{label}</span>
      <input type="range" min={0} max={5} step={0.05} value={value ?? 1} onChange={e => parseNum(e.target.value, v => onDim(axis, v))} aria-label={label} className="flex-1 accent-cyan-500" />
      <NumberField value={value ?? 1} onCommit={v => onDim(axis, v)} ariaLabel={`${label} value`} className="w-14 rounded bg-gray-800 p-1 text-[10px] tabular-nums text-cyan-300" />
      {value === null && mixedBadge}
    </label>
  )
}

/** The four directional-depth options with the USER's exact labels, laid out 2×2 to match where the box grows
 *  on screen (top row = up diagonals, bottom row = down diagonals; left = ←, right = →). Each maps to a
 *  DepthDir (verified against the iso projection: right top = up-right, etc.). */
// The four iso diagonals a tile can extend along. `glyph` is what the UI SHOWS — the design (§4.7) replaced
// "left top / bottom left" with arrows precisely because those words never agreed with each other; `spoken`
// is what a screen reader and a tooltip say, so the control is still nameable.
const Z_WIDTH_DIRS: { glyph: string; spoken: string; dir: DepthDir }[] = [
  { glyph: '↖', spoken: 'up-left', dir: 'left-up' },
  { glyph: '↗', spoken: 'up-right', dir: 'right-up' },
  { glyph: '↙', spoken: 'down-left', dir: 'left-down' },
  { glyph: '↘', spoken: 'down-right', dir: 'right-down' },
]

/**
 * The four direction chips AS THE CAMERA CURRENTLY SHOWS THEM.
 *
 * `Z_WIDTH_DIRS` pairs each arrow glyph with the WORLD axis it means at facing 0. Rotate the camera and that
 * pairing breaks: the ↘ button still wrote the same world axis, but ↘ on screen was now a different one —
 * "I rotated and the direction the propreties in the UI were showing didn't match the view".
 *
 * Here the GLYPH stays put (↖ is always the up-left corner of the 2×2 grid, matching where the block grows on
 * screen) and the WORLD axis under it is re-derived for the current facing, so clicking the arrow you can see
 * edits the axis you are looking at. Storage stays world-space — that is what keeps a door thin toward its own
 * wall as you rotate.
 */
function dirsForFacing(facing: number): { glyph: string; spoken: string; dir: DepthDir }[] {
  return Z_WIDTH_DIRS.map(({ glyph, spoken, dir }) => ({
    glyph,
    spoken,
    dir: rotateDepthDir(dir, -facing), // screen arrow → the world axis it currently points at
  }))
}

/** Opposite iso diagonal (180°); perpendicular (90°, = rotateDepthDir(dir,1)). The 4 diagonals close under both. */
const Z_WIDTH_OPPOSITE: Record<DepthDir, DepthDir> = { 'left-up': 'right-down', 'right-down': 'left-up', 'right-up': 'left-down', 'left-down': 'right-up' }
const Z_WIDTH_PERP: Record<DepthDir, DepthDir> = { 'left-up': 'right-up', 'right-up': 'right-down', 'right-down': 'left-down', 'left-down': 'left-up' }

/** Z WIDTH — MULTI-DIRECTION (Alexander "two sides at the same time"): one INDEPENDENT amount per direction. The
 *  box spans a RECTANGLE: the primary axis (depthDir) has a FORWARD end (`depth-1` past the anchor) + a BACK end
 *  (`depthBack`); the PERPENDICULAR axis has forward (`depthPerp`) + back (`depthPerpBack`). Because the 4
 *  diagonals are exactly {dir, opposite, perp, opposite-perp}, EACH of the 4 sliders writes its OWN extent — so
 *  moving one never resets the others (the bug). A fresh tile fixes depthDir to the primary col axis. 2×2 layout
 *  matches where the box grows on screen; cap at 2 sides (zoom covers the rest). */
function ZWidthRow({ zWidth, zBack, zPerp, zPerpBack, zDir, facing, onZWidth, onZBack, onZPerp, onZPerpBack, onZDir }: { zWidth: number | null; facing: number; zBack?: number | null; zPerp?: number | null; zPerpBack?: number | null; zDir: DepthDir | null; onZWidth: (cells: number) => void; onZBack?: (cells: number) => void; onZPerp?: (cells: number) => void; onZPerpBack?: (cells: number) => void; onZDir: (dir: DepthDir) => void }) {
  const depth = zWidth ?? 1, back = zBack ?? 0, perp = zPerp ?? 0, perpBack = zPerpBack ?? 0
  const dir = zDir ?? 'right-down' // fresh tile → the primary (col) axis, so the 4 sliders map to fixed extents
  const perpDir = Z_WIDTH_PERP[dir]
  // CELLS this block reaches toward `d`, COUNTING ITS OWN — so every slider reads in the unit the logic
  // uses, and 1 (its own cell) is the floor. It used to show the EXTRA cells beyond the anchor, which made
  // "0" and "1" render the identical block and a fractional value do nothing at all (Alexander: "I have 0,
  // but its behaving as if value was 1 … the UI is wrong. The min is 1 cell"). The four extents underneath
  // stay independent — moving one never resets another.
  const amountFor = (d: DepthDir): number =>
    1 + (d === dir ? Math.max(0, depth - 1)
      : d === Z_WIDTH_OPPOSITE[dir] ? back
        : d === perpDir ? perp
          : perpBack)
  const setAmount = (d: DepthDir, raw: number): void => {
    const cells = Math.max(1, Math.round(raw))          // a tile always occupies at least its own cell
    const extent = cells - 1                            // …so the stored EXTENT is what it reaches beyond it
    if (zDir == null) onZDir(dir)                       // establish the axis ONCE for a fresh tile (never after)
    if (d === dir) onZWidth(cells)                      // the primary axis stores depth INCLUDING the anchor
    else if (d === Z_WIDTH_OPPOSITE[dir]) onZBack?.(extent)  // BACK end of the primary axis
    else if (d === perpDir) onZPerp?.(extent)                // FORWARD along the perpendicular
    else onZPerpBack?.(extent)                               // BACK along the perpendicular
  }
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-[10px] text-gray-400">
        <span>How many cells it spans</span><InfoButton helpId="footprint" />{zWidth === null && mixedBadge}
      </div>
      <div className="grid grid-cols-2 gap-1" role="group" aria-label="Footprint per direction">
        {dirsForFacing(facing).map(({ glyph, spoken, dir }) => {
          const on = amountFor(dir) > 1 // highlighted once it reaches BEYOND its own cell
          return (
            <label key={dir} className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 ${on ? 'bg-cyan-900/50 ring-1 ring-cyan-700' : 'bg-gray-800/60'}`} title={`Reach ${spoken} — how many CELLS this tile covers that way, counting its own. 1 = just this cell.`}>
              <span aria-hidden className="w-6 shrink-0 text-center text-[12px] font-bold text-gray-300">{glyph}</span>
              <input type="range" min={1} max={9} step={1} value={amountFor(dir)} onChange={e => parseNum(e.target.value, n => setAmount(dir, n))} aria-label={`Footprint ${spoken}`} className="min-w-0 flex-1 accent-cyan-500" />
              <NumberField value={amountFor(dir)} onCommit={n => setAmount(dir, n)} ariaLabel={`Footprint ${spoken} value`} className="w-10 rounded bg-gray-900 p-1 text-[10px] tabular-nums text-cyan-300" />
            </label>
          )
        })}
      </div>
      {/* The numbers above are four independent extents; this says what they ADD UP TO, in cells, because
        * "↘ 2" alone never told anyone the tile now covers three cells. Primary axis already counts its
        * anchor inside `depth`; the perpendicular one does not. */}
      <p className="text-[10px] text-gray-500">
        This tile covers {depth + back} × {1 + perp + perpBack} cells.
      </p>
    </div>
  )
}

/** THICKNESS — four per-direction REACHES, laid out exactly like the Footprint above it.
 *
 *  Alexander: "I pefer thickness UI to work like z-width UI". So the two controls ask the SAME question —
 *  "how far does this tile reach toward ⟨arrow⟩?" — and differ only in unit: the Footprint counts whole
 *  CELLS (>= 1, it always occupies its own), Thickness measures WITHIN one cell (<= 1, 1 = all the way to
 *  that face). A door is 0.3 toward the inside of its wall and 1 toward the wall itself.
 *
 *  The arrows are SCREEN directions — `dirsForFacing` turns the stored WORLD axes into what is currently on
 *  screen — because "I rotated and the direction the propreties in the UI were showing didn't match the
 *  view". Storage stays world-space, or rotating the camera would re-thin the tile. */
function ThicknessRow({ reach, facing, onThicknessReach }: { reach: ThicknessReach | null; facing: number; onThicknessReach: (dir: DepthDir, value: number) => void }) {
  const reachFor = (dir: DepthDir): number => reach?.[dir] ?? 1
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-[10px] text-gray-400">
        <span>How much of its own cell it fills</span><InfoButton helpId="thickness" />{reach === null && mixedBadge}
      </div>
      <div className="grid grid-cols-2 gap-1" role="group" aria-label="Thickness per direction">
        {dirsForFacing(facing).map(({ glyph, spoken, dir }) => {
          const value = reachFor(dir)
          return (
            <label key={dir} className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 ${value < 1 ? 'bg-cyan-900/50 ring-1 ring-cyan-700' : 'bg-gray-800/60'}`} title={`Reach ${spoken} — how far into its own cell this tile extends that way. 1 fills the cell; lower pulls that face in, so a door becomes a thin panel flush with the opposite wall.`}>
              <span aria-hidden className="w-6 shrink-0 text-center text-[12px] font-bold text-gray-300">{glyph}</span>
              <input type="range" min={0.05} max={1} step={0.05} value={value} onChange={e => parseNum(e.target.value, n => onThicknessReach(dir, n))} aria-label={`Thickness ${spoken}`} className="min-w-0 flex-1 accent-cyan-500" />
              <NumberField value={value} onCommit={n => onThicknessReach(dir, n)} ariaLabel={`Thickness ${spoken} value`} className="w-10 rounded bg-gray-900 p-1 text-[10px] tabular-nums text-cyan-300" />
            </label>
          )
        })}
      </div>
    </div>
  )
}

/** Z-INDEX — draw-PRIORITY (CSS z-index style): a HIGHER value draws on top / in front of a lower one,
 *  overriding the positional depth sort in every view. An integer (default 0); the fountain water sits at a
 *  high value so it renders in front of a wall behind it. Asset tiles only — the floor omits onZIndex. */
function ZIndexRow({ zIndex, onZIndex }: { zIndex: number | null; onZIndex: (value: number) => void }) {
  return (
    <label className="flex items-center gap-2" title="Draw order — higher draws on top of / in front of lower, overriding the normal depth sort. Only change this if a tile is hidden behind something it should cover.">
      <span className="w-14 shrink-0 text-[10px] text-gray-400">Draw order</span>
      <input type="range" min={0} max={100} step={1} value={zIndex ?? 0} onChange={e => parseNum(e.target.value, v => onZIndex(Math.round(v)))} aria-label="Draw order" className="flex-1 accent-cyan-500" />
      <NumberField value={zIndex ?? 0} onCommit={v => onZIndex(Math.round(v))} ariaLabel="Draw order value" className="w-14 rounded bg-gray-800 p-1 text-[10px] tabular-nums text-cyan-300" />
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
    <label className="flex items-center gap-2" title="Faces — paint the art on ALL faces of the block, or show ONE upright tile inside it">
      <span className="w-14 shrink-0 text-[10px] text-gray-400">Faces</span>
      <button onClick={() => onDisplay('all-faces')} aria-pressed={display === 'all-faces'} className={`rounded px-2 py-0.5 text-[10px] font-bold ${display === 'all-faces' ? 'bg-cyan-600 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}>All</button>
      <button onClick={() => onDisplay('single')} aria-pressed={display === 'single'} className={`rounded px-2 py-0.5 text-[10px] font-bold ${display === 'single' ? 'bg-cyan-600 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}>One</button>
      {display === null && mixedBadge}
    </label>
  )
}

/** SHAPE — the SOLID the tile's block renders as: "Square" (the default cube) or "Circle" (a shaded ball). A
 *  two-button toggle mirroring the Display toggle. Asset tiles only. Designed to grow (Oval, …) — add a button
 *  + a render drawer, no new branch. */
function ShapeModeRow({ shape, onShape }: { shape: TileShape | null; onShape: (shape: TileShape) => void }) {
  return (
    <label className="flex items-center gap-2" title="Corners — square gives a cube, round gives a ball">
      <span className="w-14 shrink-0 text-[10px] text-gray-400">Corners</span>
      <button onClick={() => onShape('square')} aria-pressed={shape === 'square'} className={`rounded px-2 py-0.5 text-[10px] font-bold ${shape === 'square' ? 'bg-cyan-600 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}>Square</button>
      <button onClick={() => onShape('circle')} aria-pressed={shape === 'circle'} className={`rounded px-2 py-0.5 text-[10px] font-bold ${shape === 'circle' ? 'bg-cyan-600 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}>Round</button>
      {shape === null && mixedBadge}
    </label>
  )
}

/** TRANSPARENT — hide the block SHELL so only the tile's content shows (a flower billboard with no coloured
 *  block around it). A two-button toggle mirroring Display/Shape. Asset tiles only. */
function TransparentRow({ transparent, onTransparent }: { transparent: boolean | null; onTransparent: (on: boolean) => void }) {
  return (
    <label className="flex items-center gap-2" title="Solid — draw the block shell, or see through it so only the tile's own art shows (a flower, not a flower in a box)">
      <span className="w-14 shrink-0 text-[10px] text-gray-400">Solid</span>
      <button onClick={() => onTransparent(false)} aria-pressed={transparent === false} className={`rounded px-2 py-0.5 text-[10px] font-bold ${transparent === false ? 'bg-cyan-600 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}>Solid</button>
      <button onClick={() => onTransparent(true)} aria-pressed={transparent === true} className={`rounded px-2 py-0.5 text-[10px] font-bold ${transparent === true ? 'bg-cyan-600 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}>See-through</button>
      {transparent === null && mixedBadge}
    </label>
  )
}

/** ACT AS TILE — does content stacked on this cell rest ON TOP of the block (the cell behaves as if a tile is
 *  already inside it — a road/floor you walk over) or land INSIDE it at level 0? A two-button toggle mirroring
 *  Block/Display/Shape. Default ON (true). Asset tiles only. */
function ActAsTileRow({ actAsTile, onActAsTile }: { actAsTile: boolean | null; onActAsTile: (on: boolean) => void }) {
  return (
    <label className="flex items-center gap-2" title="Walk over it — Yes: the next thing placed here rests ON TOP (a road, a floor you walk over); No: it lands INSIDE this block at level 0">
      <span className="w-14 shrink-0 text-[10px] text-gray-400">
        Things stack on top
        <InfoButton helpId="stack" />
      </span>
      <button onClick={() => onActAsTile(true)} aria-pressed={actAsTile === true} className={`rounded px-2 py-0.5 text-[10px] font-bold ${actAsTile === true ? 'bg-cyan-600 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}>Yes</button>
      <button onClick={() => onActAsTile(false)} aria-pressed={actAsTile === false} className={`rounded px-2 py-0.5 text-[10px] font-bold ${actAsTile === false ? 'bg-cyan-600 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}>No</button>
      {actAsTile === null && mixedBadge}
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
      <div className="flex items-center gap-2" title="Glow — cast a warm pool of light on the ground at night from this tile">
        <span className="w-14 shrink-0 text-[10px] font-bold text-amber-300">Glow</span>
        <button onClick={() => onLight({ ...cur, on: true })} aria-pressed={isOn} className={`rounded px-2 py-0.5 text-[10px] font-bold ${isOn ? 'bg-amber-600 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}>On</button>
        <button onClick={() => onLight({ ...cur, on: false })} aria-pressed={isOff} className={`rounded px-2 py-0.5 text-[10px] font-bold ${isOff ? 'bg-amber-600 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}>Off</button>
        {!light && <span className="text-[9px] italic text-gray-500">none</span>}
      </div>
      <label className="flex items-center gap-2" title="Intensity — how strong the glow pool is (0–1)">
        <span className="w-14 shrink-0 text-[10px] text-gray-400">Intensity</span>
        <input type="range" min={0} max={1} step={0.05} value={cur.intensity} onChange={e => parseNum(e.target.value, v => patch({ intensity: v }))} aria-label="Glow intensity" className="flex-1 accent-amber-500" />
        <NumberField value={cur.intensity} onCommit={v => patch({ intensity: v })} ariaLabel="Glow intensity value" className="w-14 rounded bg-gray-800 p-1 text-[10px] tabular-nums text-amber-300" />
      </label>
      <label className="flex items-center gap-2" title="Distance — how far the glow reaches, in cells">
        <span className="w-14 shrink-0 text-[10px] text-gray-400">Distance</span>
        <input type="range" min={0} max={12} step={0.1} value={cur.distance} onChange={e => parseNum(e.target.value, v => patch({ distance: v }))} aria-label="Glow distance" className="flex-1 accent-amber-500" />
        <NumberField value={cur.distance} onCommit={v => patch({ distance: v })} ariaLabel="Glow distance value" className="w-14 rounded bg-gray-800 p-1 text-[10px] tabular-nums text-amber-300" />
      </label>
      <label className="flex items-center gap-2" title="Colour — the hue of the glow">
        <span className="w-14 shrink-0 text-[10px] text-gray-400">Colour</span>
        <input type="color" value={cur.color ?? '#ffd98a'} onChange={e => patch({ color: e.target.value })} aria-label="Glow colour" className="h-6 w-10 rounded bg-gray-800" />
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
      <PoseRow label="Toward ↗ / ↙" labelWidth="w-24" value={zPos ?? 0} min={-4} max={4} step={0.1} onInput={onZPos} />
      <div className="grid grid-cols-2 gap-1 pl-24" role="group" aria-label="Slide direction">
        {Z_WIDTH_DIRS.map(({ glyph: label, spoken, dir }) => (
          <button key={dir} onClick={() => onZDir(dir)} aria-label={`Slide ${spoken}`} aria-pressed={active === dir} className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${active === dir ? 'bg-cyan-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>{label}</button>
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
/**
 * HOW IT LOOKS (§4.7) — the tile's appearance: its colour and the four shell settings that decide how the
 * art is painted onto its block. Every one applies to EVERY tile through the same path; a control absent
 * here means the model wired no writer for it (the floor has no block shell), never a gate on tile kind.
 */
export function LooksControls({ tile }: { tile: TileControlModel }) {
  return (
    <div className="space-y-1.5">
      {/* ONE colour for the tile (floor→groundColor, asset→asset.color) — no separate pose colour */}
      <div className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-[10px] text-gray-400">Colour</span>
        <input type="color" value={tile.color ?? tile.colorFallback} onChange={e => tile.onColor(e.target.value)} aria-label={`${tile.label} colour`} className="h-6 w-10 rounded bg-gray-800" />
        {tile.color === null && mixedBadge}
        {tile.onClearColor && <button onClick={tile.onClearColor} className="ml-auto rounded bg-gray-700 px-2 py-0.5 text-[9px] hover:bg-gray-600" title="Reset to the tile's own colour">↺ reset</button>}
      </div>
      {/* Display mode: paint the tile on ALL faces, or ONE tile inside the block. Asset tiles only. */}
      {tile.onDisplay && <DisplayModeRow display={tile.display ?? 'all-faces'} onDisplay={tile.onDisplay} />}
      {/* Block: solid shell, or transparent so only the tile content (e.g. the flower) shows. Asset tiles only. */}
      {tile.onTransparent && <TransparentRow transparent={tile.transparent ?? false} onTransparent={tile.onTransparent} />}
      {/* Shape: render the tile's block as a cube (square) or a ball (circle). Asset tiles only. */}
      {tile.onShape && <ShapeModeRow shape={tile.shape ?? 'square'} onShape={tile.onShape} />}
      {/* Light: cast a warm ground glow pool at night, with intensity/distance/colour + on-off. Asset tiles only. */}
      {tile.onLight && <LightControls light={tile.light} onLight={tile.onLight} />}
    </div>
  )
}

/**
 * SIZE & POSITION (§4.7) — the hardest section, and the one §3.10 singled out: how big the tile is, how many
 * cells it covers, where it sits inside its own cell, and what draws in front of what.
 *
 * The three sub-groups are the design's: **Size** (width / height / zoom + thickness), **Footprint** (cells
 * covered, formerly "Z Width"), **Nudge** (movement WITHIN the cell, formerly the bare x / y / z), and
 * **Draw order** (formerly "Z-Index"). The labels changed; the writers did not.
 */
export function SizeAndPositionControls({ tile }: { tile: TileControlModel }) {
  const pose = tile.pose
  const setPose = tile.onPose ? (patch: Partial<TilePose>) => tile.onPose!({ ...pose, ...patch }) : null
  const rotDeg = Math.round((pose?.rot ?? 0) * 180 / Math.PI)
  return (
    <div className="space-y-1.5">
      <DimRow label="Width" axis="width" value={tile.dims.width} title="Width — horizontal stretch (every view)" onDim={tile.onDim} />
      <DimRow label="Height" axis="height" value={tile.dims.height} title="Height — grows UP from the base (iso + 2D views)" onDim={tile.onDim} />
      <DimRow label="Zoom" axis="zoom" value={tile.dims.zoom} title="Zoom — scales Width, Height and Zoom together" onDim={tile.onDim} />
      {/* THICKNESS (scaleZ) — how much of its OWN cell the block fills along the into-screen axis. Alexander:
          "it was used as 3d fill inside the cells/tiles". It is NOT the Footprint below: that counts CELLS
          SPANNED (always ≥1), this fills within one. A door is a thin panel in a wall — the backend already
          ships `door` at 0.3 (tile_source.ex:45, "scaleZ is THICKNESS") and this control tunes the placed
          instance. Unconditional, like Width and Height: a setting is never gated on the kind of tile. */}
      {tile.onThicknessReach && (
        <ThicknessRow
          reach={tile.thickness === null ? null : (JSON.parse(tile.thickness ?? '{}') as ThicknessReach)}
          facing={tile.facing ?? 0}
          onThicknessReach={tile.onThicknessReach}
        />
      )}
      {/* Footprint (directional depth): extrudes the block across whole CELLS along a chosen diagonal.
          Asset tiles only — the floor omits onZWidth. */}
      {tile.onZWidth && <ZWidthRow facing={tile.facing ?? 0} zWidth={tile.zWidth ?? 1} zBack={tile.zBack ?? 0} zPerp={tile.zPerp ?? 0} zPerpBack={tile.zPerpBack ?? 0} zDir={tile.zDir ?? null} onZWidth={tile.onZWidth} onZBack={tile.onZBack} onZPerp={tile.onZPerp} onZPerpBack={tile.onZPerpBack} onZDir={tile.onZDir ?? (() => {})} />}
      {/* Nudge — move the tile INSIDE its own cell. x/y/z/rotate/flip live in the SAME group; there is NO
          separate POSE section. */}
      {setPose && (
        <>
          <PoseRow label="Left ↔ Right" labelWidth="w-24" value={pose?.dx ?? 0} min={-1} max={1} step={0.01} onInput={v => setPose({ dx: v })} />
          <PoseRow label="Up ↕ Down" labelWidth="w-24" value={pose?.dy ?? 0} min={-1} max={1} step={0.01} onInput={v => setPose({ dy: v })} />
          {/* z = an ISO-DIAGONAL slide (NOT a vertical lift): magnitude + which of the 4 diagonals it moves
              along, distinct from the screen-plane x/y offsets. Asset tiles only. */}
          {tile.onZPos && <ZPosRow zPos={tile.zPos ?? 0} zDir={tile.zPosDir ?? null} onZPos={tile.onZPos} onZDir={tile.onZPosDir ?? (() => {})} />}
          <PoseRow label="Rotate" labelWidth="w-24" value={rotDeg} min={-180} max={180} step={1} suffix="°" onInput={v => setPose({ rot: v * Math.PI / 180 })} />
          {tile.isWeapon && (
            <>
              <PoseRow label="Where the shot comes out" labelWidth="w-24" value={pose?.muzzle ?? 0} min={0} max={1} step={0.05} onInput={v => setPose({ muzzle: v })} help="muzzle" />
              <p className="hint">Melee weapons ignore this. 0 puts the arrow on top of the character; about 0.2 puts it at the end of the bow.</p>
            </>
          )}
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={pose?.flip ?? false} onChange={e => setPose({ flip: e.target.checked })} aria-label="Mirror" className="accent-cyan-500" />
            <span className="text-[10px] text-gray-400">Face the other way</span>
          </label>
          {tile.onPoseReset && (
            <button onClick={tile.onPoseReset} className="w-full rounded bg-gray-700 px-2 py-1 text-[10px] font-bold text-white transition-colors hover:bg-gray-600">
              ↺ Reset nudge
            </button>
          )}
        </>
      )}
      {/* Draw order (was "Z-Index"): a higher value draws on top / in front, overriding the depth sort. */}
      {tile.onZIndex && <ZIndexRow zIndex={tile.zIndex ?? 0} onZIndex={tile.onZIndex} />}
    </div>
  )
}

/**
 * HOW IT BEHAVES (§4.7) — what the tile DOES to the things around it, as opposed to how it looks.
 *
 * Only the tile-owned half lives here. "Blocks the player" is a property of the CELL (or of a unit), not of
 * one tile in its stack, so the inspector renders that alongside rather than inside.
 */
export function BehaviourControls({ tile }: { tile: TileControlModel }) {
  if (!tile.onActAsTile) return null
  return <ActAsTileRow actAsTile={tile.actAsTile ?? true} onActAsTile={tile.onActAsTile} />
}

/** The SETTINGS body for the SELECTED tile — §4.7's three groups, in order. This is what the "Edit
 *  settings…" modal hosts for a UNIT; a cell renders the same three bodies inline as accordions. The floor
 *  (a height-0 tile) and a stacked wall/prop use the EXACT SAME body; only the writers differ (the page
 *  routes floor→per-cell, asset→its tileset kind). */
export function TileControls({ tile }: { tile: TileControlModel }) {
  return (
    <div className="space-y-1.5">
      <LooksControls tile={tile} />
      <SizeAndPositionControls tile={tile} />
      <BehaviourControls tile={tile} />
    </div>
  )
}

/**
 * ONE ACCORDION in the inspector (§4.7).
 *
 * Presentational: it owns no state. Whether it is open comes from the caller (which reads the persisted
 * `/api/editor_settings` row via `useInspectorSections`), so the same component serves a cell and a unit and
 * the remembered state survives a reload.
 *
 * `badge` is the summary §4.7 draws on the right of a COLLAPSED header — "HP 40 · DEF 3", "2 of 4 slots",
 * a count. It shows in both states, because the point of a summary is that you do not have to open the
 * section to learn the thing.
 */
/**
 * How a section's body is presented when it is open.
 *
 * A FUNCTION supplied by the caller, not an imported panel component, and that is deliberate on two counts:
 *
 *  · **It breaks an import cycle.** `editorChrome` re-exports this file and `modals` imports `editorChrome`,
 *    so importing `FloatingPanel` here would close the loop `editorInspector → modals → editorChrome →
 *    editorInspector`.
 *  · **The inspector should not decide.** Whether a group of controls appears inline, in a movable panel, or
 *    somewhere else entirely is a layout decision belonging to the page that owns the layout.
 */
export type SectionPresenter = (
  id: InspectorSectionId,
  title: string,
  body: React.ReactNode,
  onClose: () => void,
) => React.ReactNode

export function InspectorSection({ id, isUnit, open, onToggle, badge, present, children }: {
  id: InspectorSectionId
  /** A unit is a WHO, a cell is a WHAT — the only wording that differs (§4.7). */
  isUnit: boolean
  open: boolean
  onToggle: (id: InspectorSectionId) => void
  /** A short summary shown in the header, so a closed section still answers its own question. */
  badge?: React.ReactNode
  /**
   * Where the body goes when open. Absent → inline, the original accordion.
   *
   * Alexander, 2026-09-09: *"the right sidebar is still too full of stuff, we should have movable modals
   * for each section/group of actions."* With a presenter the sidebar keeps only the six rows and their
   * summaries, and the controls open beside it where they can be dragged and left open.
   */
  present?: SectionPresenter
  children: React.ReactNode
}) {
  const title = sectionTitle(id, isUnit)
  return (
    <section className="border-t border-white/10 pt-1.5">
      <button
        onClick={() => onToggle(id)}
        aria-expanded={open}
        aria-label={title}
        className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-white/5"
      >
        {/* The marker says what the click DOES. Inline it is a disclosure triangle; as a panel it is a
            pop-out, because the body is not going to appear underneath. */}
        <span aria-hidden className="w-2 shrink-0 text-[9px] text-gray-500">
          {present ? (open ? '▣' : '▢') : open ? '▾' : '▸'}
        </span>
        <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400">{title}</span>
        {badge !== undefined && <span className="ml-auto truncate text-[9px] text-gray-500">{badge}</span>}
      </button>
      {open && (present
        ? present(id, title, children, () => onToggle(id))
        : <div className="mt-1.5 space-y-1.5 pl-1">{children}</div>)}
    </section>
  )
}

/**
 * The inspector body — §4.7's six sections, for a cell and for a unit alike.
 *
 * §3.10 measured the old panel as one flat wall of controls behind an "Edit settings…" modal: the things you
 * change most sat in a floating panel you had to open, while the sidebar showed a summary. §4.7 folds the
 * whole control set INLINE as accordions titled with the questions people ask, and remembers which ones you
 * keep open. There is no settings modal any more — the sidebar IS the settings.
 *
 * `unitSection` still only ADDS: the collision toggle is the single collision control for everything (for a
 * unit it IS its "blocks movement"), and Clear tiles / Remove tile are the same actions on both, because
 * everything in the map is a tile.
 */
export function PropertiesPanel(p: PropertiesPanelProps) {
  const t = p.tile
  const isUnit = !!p.unitSection
  const section = (id: InspectorSectionId, badge: React.ReactNode | undefined, body: React.ReactNode) => (
    <InspectorSection id={id} isUnit={isUnit} open={p.sectionOpen(id)} onToggle={p.onToggleSection} badge={badge} present={p.present}>
      {body}
    </InspectorSection>
  )

  return (
    <div className="space-y-1.5 text-xs">
      {/* The header names WHAT IS SELECTED — it is not a section, so it never collapses out from under you. */}
      {t
        ? (
          <div className="flex items-center justify-between">
            <span className="flex min-w-0 items-center gap-1.5">
              <TilePreview visual={t.preview} label={t.label} />
              <p className="truncate text-[9px] font-bold uppercase tracking-wider text-gray-500">{isUnit ? t.label : `cell · ${t.label}`}</p>
            </span>
            {p.levelCount > 1 && (
              <span className="flex shrink-0 items-center gap-1 text-[9px] text-gray-400" aria-label="Select stack level">
                <button onClick={() => p.onLevel(p.level - 2)} disabled={p.level <= 1} aria-label="Lower tile" className="rounded bg-gray-700 px-1 leading-none hover:bg-gray-600 disabled:opacity-30">▼</button>
                <span className="tabular-nums">level {p.level}/{p.levelCount}</span>
                <button onClick={() => p.onLevel(p.level)} disabled={p.level >= p.levelCount} aria-label="Higher tile" className="rounded bg-gray-700 px-1 leading-none hover:bg-gray-600 disabled:opacity-30">▲</button>
              </span>
            )}
          </div>
        )
        : <p className="text-[9px] font-bold uppercase tracking-wider text-gray-500">— cell —</p>}

      {t && section('identity', t.styleName, (
        <>
          {/* Tile Library — the swap-tile action. Its label reads "Add tile" / "Replace tile" by cell status
              for a cell; a unit keeps the default. Opens the draggable/resizable Tile Library modal. */}
          <ArtSection override={t.override} styleName={t.styleName} onOpen={t.onOpenLibrary} label={t.libraryLabel} />
        </>
      ))}

      {/* HOW IT LOOKS and SIZE & POSITION are the two sections a no-op writer would fake, so a tile that
          cannot be written to gets the reason instead of the controls (§3.13). */}
      {p.tileNotice
        ? (
          <p className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] leading-snug text-amber-200">
            {p.tileNotice}
          </p>
        )
        : t && (
          <>
            {section('looks', undefined, <LooksControls tile={t} />)}
            {section('size', undefined, <SizeAndPositionControls tile={t} />)}
          </>
        )}

      {/* HOW IT BEHAVES holds the CELL's collision even with no tile selected — an empty cell can still be
          blocked, so this section is the one that renders unconditionally. */}
      {section('behaviour', p.collision === true ? 'blocked' : p.collision === false ? 'walkable' : undefined, (
        <>
          <div className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-[10px] text-gray-400">Blocks the player</span>
            <button onClick={() => p.onCollision(false)} aria-pressed={p.collision === false} className={`rounded px-2 py-0.5 text-[10px] font-bold ${p.collision === false ? 'bg-emerald-600 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}>Walkable</button>
            <button onClick={() => p.onCollision(true)} aria-pressed={p.collision === true} className={`rounded px-2 py-0.5 text-[10px] font-bold ${p.collision === true ? 'bg-red-600 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}>Blocked</button>
            {p.collision === null && mixedBadge}
          </div>
          {t && <BehaviourControls tile={t} />}
        </>
      ))}

      {/* Unit-only extras (name/size rows + stats/inventory/quests/attacks buttons) — folded INTO this one
          card. §4.7 draws STATS / EQUIPMENT / ABILITIES as their own sections; that regrouping is Week 6's,
          together with the one inventory. */}
      {p.unitSection && <div className="border-t border-white/10 pt-2">{p.unitSection}</div>}

      {/* Animate — opens its OWN modal. A tile authors GridAsset settings tweens; a unit authors its
          frame-by-frame character animations. Present whenever the model wires onOpenAnimator. */}
      {t?.onOpenAnimator && section('animation', t.animations?.length ?? 0, (
        <button onClick={t.onOpenAnimator} aria-label="Animate tile" className="w-full rounded bg-fuchsia-800 px-2 py-1 text-[10px] font-bold text-white transition-colors hover:bg-fuchsia-700">
          ✦ Animate…{t.animations?.length ? ` (${t.animations.length})` : ''}
        </button>
      ))}

      {/* Rules — opens the rules modal (cell: enter/interact; unit: on defeat). Present for a bare cell too:
          a cell can carry a rule without holding a tile.

          The user-facing word is RULES. Alexander, 2026-09-09: *"there's old language in functionalities,
          for example right panel says triggers in tile selection, but that was changed to rules."* The prop
          and the `Trigger` type keep their names — renaming the DATA is a separate, larger change. */}
      {p.onOpenTriggers && section('rules', p.triggerCount ?? 0, (
        <button onClick={p.onOpenTriggers} aria-label="Edit the rules for this" className="b wide sm">
          <span className="ic" aria-hidden="true">⚑</span>
          <span>Rules</span>
          {p.triggerCount ? <span className="ct">{p.triggerCount}</span> : null}
        </button>
      ))}

      {/* The destructive footer — outside every section, so an action that empties the cell can never hide
          inside a collapsed one. */}
      <div className="flex gap-1.5 border-t border-white/10 pt-2">
        {p.onClearTiles && (
          <button onClick={p.onClearTiles} aria-label="Clear tiles" className="flex-1 rounded bg-red-800 px-2 py-1.5 text-[10px] font-bold text-white transition-colors hover:bg-red-700">
            🧹 Clear tiles
          </button>
        )}
        {p.onRemove && (
          <button onClick={p.onRemove} className="flex-1 rounded bg-red-700 px-2 py-1.5 text-[10px] font-bold text-white transition-colors hover:bg-red-600">
            🗑 Remove tile
          </button>
        )}
      </div>
    </div>
  )
}
