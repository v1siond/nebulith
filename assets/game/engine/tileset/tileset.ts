/**
 * Tileset — the data-driven tile catalog. A tile's LABEL (`tree_top_left`, `wall`, …) is the
 * style-agnostic SWAP KEY: every tileset uses the SAME labels, so re-skinning is `label → label`
 * ("grab `X_left`, swap the other tileset's `X_left`"). COLOR is a stored PROPERTY — a per-zone
 * palette + a per-tile colour ROLE — never encoded in the label: there is no `X_pink_left`, only
 * `X_left` whose colour the palette supplies. Glyph + walkability are properties too.
 *
 * This is the "load different, behave the same" seam. Today an ASCII tileset is bundled data the
 * renderer LOADS (asciiTileset.ts); later the SAME shape is a row set served by the Elixir/Ecto API.
 * The render logic never changes — only where the tileset comes from.
 */
import type { TilePose } from './pose'
import type { StyleTile } from './styleTiles'
import type { TileView, TileViewSettings } from './tileViewSettings'
import type { ImageVisual } from '@/game/artStyle'
import type { Animation } from '@/engine/animation/tileAnimation'
import type { DepthDir, ThicknessReach } from '../render/isoBlock'

// 9-piece autotile POSITION — the swap standard: all sides + corners. 'single' = a non-tiling tile.
export type TilePosition =
  | 'top_left' | 'top' | 'top_right'
  | 'left' | 'center' | 'right'
  | 'bottom_left' | 'bottom' | 'bottom_right'
  | 'single'

/** DISPLAY MODE — how a tile is PAINTED onto its block. A per-tile render SETTING (lives in the tile's
 *  `settings` jsonb, mirrored as a per-ASSET override from the editor):
 *    • 'all-faces' (DEFAULT, current behaviour) — the baked tile image is painted on the block's top + the
 *      two camera-visible side faces (drawIsoTileBlock / fillIsoFaceWithTile).
 *    • 'single' — ONE instance of the tile is shown INSIDE the block volume (a single centered billboard at
 *      the block centre) over a plain, shaded block shell — e.g. a single water droplet floating in the block.
 *  Absent → 'all-faces' (byte-identical to before). This changes WHERE / HOW MANY TIMES the SAME baked image
 *  is drawn on the block — it never introduces a glyph. */
export type TileDisplay = 'all-faces' | 'single'

/** How a tile's block renders: a cube, or a shaded ball. */
export type TileShape = 'square' | 'circle'

// `StyleTile` (engine/tileset/styleTiles.ts) is THE tile shape — one per (style, label). The old
// per-style `TilesetTile` is gone with the two holder files.

export interface ZonePalette {
  trunk: string
  /** Variant tonal shades (canopy foliage varies per tree/cluster). */
  canopy: readonly string[]
  building: { roof: string; wall: string; door: string; window: string }
  feature: { mountain: string; peak: string; spill: string }
}

/** A GROUND/terrain tile — a different family from the cell-label tiles: keyed by ground TYPE
 *  (grass, water_deep, path_stone…), with per-variant glyph + foreground + fill. `char`/`fg`/`bg`
 *  are the stored colour properties; the TYPE is the swap key. (This is the current GROUND_COLORS
 *  shape, now carried as tileset data.) */
export interface GroundTile {
  char: readonly string[]
  fg: readonly string[]
  bg: readonly string[]
}

export interface ResolvedGround {
  /** The chosen glyph, its foreground colour, and the BASE fill (grass per-cell shading is applied
   *  render-side, exactly as before — kept out of here so this stays a pure data resolver). */
  char: string
  fg: string
  bg: string
}

/** One cell of a multi-cell COMPOSITION — a tile placed at a footprint offset + stack level. Combined
 *  across cells they form the rich ascii art (the tree's 2 trunk + 6 leaf tiles). */
export interface CompositionCell {
  /** Cell offset from the composition's anchor (grid col/row). */
  dx: number
  dy: number
  /** Stack level (0 = ground; higher = a block up), so a tree's canopy floats above its trunk. Default 0. */
  level?: number
  /** The tile placed in this cell — a swap-key label resolved via resolveTile against the active tileset. */
  label: string
  /** Cell collision — false (blocking) by default; a walkable cell (an open doorway) sets true. */
  walkable?: boolean
  /** Uniform draw ZOOM for this cell's tile (backend `composition_cells.scale`) — the render multiplies every
   *  axis by it (iso `zoom = asset.scale`), so a cell can hold a tile bigger than one block. The tree's canopy
   *  is ONE leaf cell at scale 2 (a 2×2 crown). Absent/1 → the tile draws at one block, unchanged. */
  scale?: number
  /** Draw-PRIORITY (CSS z-index style) for this cell's tile (backend `composition_cells.z_index`). A higher
   *  value renders LATER (on top / in front), overriding the positional depth sort in every view — so the
   *  fountain's water reads IN FRONT of a wall behind it. Absent/0 → the sort falls through to the positional
   *  key, so the tile orders exactly as before. */
  zIndex?: number
  /** DEFAULT tile animations authored on this composition cell (backend `composition_cells.animations` jsonb,
   *  camelCase on the wire) — a LIST of settings/sprite tweens the stamp copies onto the placed asset's
   *  `animations` (and sets `placedAt`), so a composition ships animated BY DEFAULT (the fountain's water_c +
   *  water_jet cells carry the rise/fade loop). Absent → the cell places an un-animated tile, unchanged. */
  animations?: Animation[]
  /** TUNED per-cell tile settings (backend `composition_cells.settings` jsonb, camelCase on the wire) — the
   *  display overrides that shape a cell's tile into a realistic form, beyond the Zoom `scale` + `zIndex`
   *  siblings. `scaleY` stretches the block's HEIGHT (the lamp POST = one cell drawn ~7 blocks tall); `display`
   *  'single' draws ONE centered billboard instead of tiling the faces (the lamp BULB); `pose` nudges the
   *  placed tile (the bulb's `dy` lift onto the post top). stampComposition applies each onto the placed asset.
   *  Absent → the cell places its tile at one block, unposed, all-faces — unchanged. */
  settings?: CompositionCellSettings
}

/** The tuned per-cell tile settings a composition cell can carry (backend jsonb) — applied onto the placed
 *  GridAsset by stampComposition. A small, extensible bag: `scaleX`/`scaleY` (Width/Height), `display`, `pose`,
 *  `shape`. Width (scaleX) + Depth (scaleZ) ride here like Height so a composition can ship a THIN trunk (a
 *  tree's skinny/thick trunk is a per-variant width) without touching the uniform Zoom (`scale`) column. */
export interface CompositionCellSettings {
  scaleX?: number
  scaleY?: number
  scaleZ?: number
  /** Which WORLD axis this cell's THICKNESS shrinks along (authored south-facing, like `depthDir`). The stamp
   *  rotates it by the building's rotation, so a door is thin toward ITS house's front. */
  thicknessDir?: DepthDir
  /** Directional DEPTH in blocks (roof-z-width): >1 (with `depthDir`) extrudes this cell into ONE long iso box
   *  spanning `depth` cells along a diagonal, anchored at its base cell — a roof column spans the whole footprint
   *  depth as a single block. stampComposition copies it onto the placed asset's `depth`. Absent/1 → a unit cell. */
  depth?: number
  /** Which iso diagonal `depth` extrudes along (authored south-facing as `left-down` = +row); stampComposition
   *  copies it onto the asset's `depthDir`, ROTATED by the building's rotation so an east/west building's roof
   *  spans the correct grid axis. Absent → no directional depth (a plain cube). */
  depthDir?: DepthDir
  /** BIDIRECTIONAL z-width (#58): extra cells this SAME cell spans BACKWARD (opposite `depthDir`) from its anchor,
   *  so ONE roof/deck cell covers a footprint both ways — a 4-cell roof authored as 1 tile. stampComposition
   *  copies it onto the placed asset's `depthBack`. Absent/0 → today's one-way span. */
  depthBack?: number
  /** 2-AXIS z-width ("two sides at the same time"): cells this cell ALSO spans along the PERPENDICULAR axis —
   *  forward (`depthPerp`) + back (`depthPerpBack`). With `depth`/`depthBack` this makes the cell a RECTANGLE
   *  (a 2×2 roof deck authored as 1 tile). stampComposition copies both onto the placed asset. Absent/0 = a line. */
  depthPerp?: number
  depthPerpBack?: number
  display?: TileDisplay
  /** the SOLID this cell's tile renders as ('square' cube default, 'circle' ball) — stampComposition copies it
   *  onto the placed asset's `shape`, so a composition can ship a default shape (a lamp globe = a circle cell). */
  shape?: TileShape
  pose?: TilePose
  /** the LIGHT this cell casts (a warm ground GLOW POOL at night) — stampComposition copies it onto the placed
   *  asset's `light`, so the lamp_post BULB cell ships a lit-by-default lamp. See {@link AssetLight}. */
  light?: AssetLight
  /** an authored per-cell COLOUR ("#rrggbb") that TINTS this cell's baked tile in the base render (MAP-MODEL §8:
   *  "colour is a setting of the tile"). stampComposition uses it as the placed asset's colour, so a composition
   *  can ship a recoloured cell — e.g. the lamp BULB reads as a dark lantern by day (a `color` night-animation
   *  still last-wins-tints it warm gold at night). Absent → the tile's own colour. */
  color?: string
}

/** A per-tile LIGHT setting: the tile casts a warm radial GROUND GLOW POOL (drawn only at night by
 *  `drawNightLighting`). A real, controllable SETTING (Alexander: "a regular setting that allows me to control
 *  the light intensity and distance") authored on a composition cell (backend `settings.light`) or per-instance
 *  in the editor's Light control group, round-tripping onto `GridAsset.light`. The renderer sizes the pool from
 *  `distance` and strengths/tints it from `intensity`/`color`; `on:false` casts none. */
export interface AssetLight {
  /** pool STRENGTH, 0..1 — multiplies the pool's warm alpha (1 = today's default lamp brightness). */
  intensity: number
  /** pool RADIUS in cells/blocks — the glow reaches this many cells out (today's default lamp = 3.2). */
  distance: number
  /** pool COLOUR ("#rrggbb"); absent → the default warm lamp glow. */
  color?: string
  /** false → this tile casts NO pool (a switched-off lamp); absent/true → it lights. */
  on?: boolean
}

/** A multi-cell asset TEMPLATE: a footprint + one tile per cell. The data-driven replacement for the retired
 *  frontend building/tree factories — stored in the DB tileset, stamped by stampComposition. */
export interface Composition {
  footprint: { w: number; h: number }
  cells: readonly CompositionCell[]
  /** OPTIONAL human NAME (served from the DB `compositions.title`) — a store's "Store", a hospital's
   *  "Hospital". When set, the stamp badges the building's roof apex with it (apex signage). Absent for
   *  houses/trees/others → no badge. */
  title?: string
  /** OPTIONAL sidebar BUCKET (served from the DB `compositions.category`) — the SAME `category` vocabulary a
   *  tile carries (buildings/nature/props/terrain, MAP-MODEL §8). It marks the composition browseable in the
   *  paint palette and GROUPS it there, exactly like a tile's `category` — so the editor reads the group from
   *  this backend value instead of deriving it (door-detection / name regex). Absent = not browseable. */
  category?: string
}

export interface Tileset {
  id: string
  name: string
  /** Every cell-label tile, keyed by its swap-label (trees / buildings / features). */
  tiles: Readonly<Record<string, StyleTile>>
  /** Colour palettes keyed by zone id — the "stored colour property" that reskins cell-labels by zone. */
  palettes: Readonly<Record<string, ZonePalette>>
  /** Ground/terrain tiles keyed by ground type. */
  terrain: Readonly<Record<string, GroundTile>>
  /** Optional multi-cell COMPOSITIONS keyed by asset kind (tree, house_4, store_5…) — a footprint of cells
   *  each holding one tile. The stamp places one per-cell asset per cell (a data-driven building/tree). */
  compositions?: Readonly<Record<string, Composition>>
}

/** Ground drawn before the backend tileset loads — nothing. The app is backend-required (no bundled ground
 *  colour), so an unresolved ground paints an empty, transparent cell rather than a stand-in colour. */
const EMPTY_GROUND: ResolvedGround = { char: ' ', fg: 'transparent', bg: 'transparent' }

/** Resolve a GROUND tile's glyph + fg + base fill from a LOADED tileset — the data-driven twin of the
 *  inline `GROUND_COLORS[type]` + noise-variant selection in drawIsoGroundLayer. Pure; deterministic
 *  per (type, col, row). Grass's per-cell shade is applied by the caller (unchanged), so bg is the base. */
export function resolveGroundTile(tileset: { terrain: Record<string, GroundTile> }, tileType: string, col: number, row: number): ResolvedGround {
  const g = tileset.terrain[tileType] ?? tileset.terrain.grass
  if (!g) return EMPTY_GROUND // terrain not loaded yet (empty tileset) → draw nothing, don't crash on a missing tile
  const noiseVal = Math.sin(col * 0.3 + row * 0.5) * Math.cos(col * 0.7 - row * 0.2)
  const colorIdx = noiseVal > 0 ? 0 : 1
  return {
    char: g.char[colorIdx % g.char.length],
    fg: g.fg[colorIdx % g.fg.length],
    bg: g.bg[0],
  }
}

export interface ResolvedTile {
  char: string
  color: string
  /** The tile's OWN iso block height from the DB (a flat floor tile is a 0.1 slab, a standing tile ≥1).
   *  Carried here so every consumer — the composition stamp included — reads height through the SAME data
   *  path (MAP-MODEL §4) instead of assuming a whole block. Undefined for an unknown label. */
  height?: number
  /** The tile's backend `settings` blob (carries the generic `fadeNear`/`cutawayRoof` behavior keys). */
  settings?: Record<string, unknown>
}

// Unknown label → the same visible-but-neutral fallback the hardcoded path used (never blank/throw).
export const FALLBACK_RESOLVED: ResolvedTile = { char: '?', color: '#cccccc' }

/** The GENERIC render-behavior keys (`fadeNear`/`cutawayRoof`/`display`) a stamp copies from a resolved
 *  tile's `settings` onto the placed asset. Returns undefined when the tile carries none (the common case),
 *  so a stamp only sets `asset.settings` on tiles that actually opt into a behavior. `display` follows the
 *  SAME data path: only the non-default `'single'` rides through — `'all-faces'` / absent carries nothing,
 *  leaving `asset.settings` unset so a default tile renders byte-identically to before. */
export function tileRenderBehavior(settings?: Record<string, unknown>): { fadeNear?: boolean; cutawayRoof?: boolean; minAlpha?: number; display?: TileDisplay } | undefined {
  if (!settings) return undefined
  const out: { fadeNear?: boolean; cutawayRoof?: boolean; minAlpha?: number; display?: TileDisplay } = {}
  if (typeof settings.minAlpha === 'number') out.minAlpha = settings.minAlpha
  if (settings.fadeNear) out.fadeNear = true
  if (settings.cutawayRoof) out.cutawayRoof = true
  if (settings.display === 'single') out.display = 'single'
  return out.fadeNear || out.cutawayRoof || out.display ? out : undefined
}

/** A tile's authored THICKNESS (`settings.scaleZ`) — how much of its own cell the block fills along the
 *  into-screen axis. Backend TILE data (`tile_source.ex`: "scaleZ is THICKNESS — a door is a thin panel in
 *  the wall, not a full cube"), so a door is thin WHEREVER it lands: stamped by the generator or painted by
 *  hand. THE single reader — the composition stamp and the paint brush both call this, so they cannot drift
 *  the way they did when each kept its own copy.
 *
 *  Ignored unless it is a positive number: a malformed record must never collapse a block to nothing. */
export function tileThickness(settings?: Record<string, unknown>): number | undefined {
  const raw = settings?.scaleZ
  return typeof raw === 'number' && raw > 0 ? raw : undefined
}

/** The four iso diagonals a THICKNESS may shrink along — the same axes z-width spans. */
const THICKNESS_DIRS: ReadonlySet<string> = new Set(['left-up', 'right-up', 'left-down', 'right-down'])

/**
 * A tile's OWN colour, by label — or undefined when the tileset carries no such tile.
 *
 * The one reader for "what colour is this thing, per the backend". Deliberately NOT `resolveTile`, which
 * substitutes `FALLBACK_RESOLVED` for a missing tile: a caller asking for a colour must be able to tell
 * "the backend says grey" from "the backend has never heard of this", and silently returning the fallback
 * grey is how an invented colour gets mistaken for served data.
 *
 * Handles both shapes the backend serves: a flat `settings.color` (emoji rows) and a per-zone
 * `settings.colors` map (ascii rows).
 */
export function tileColorByLabel(tileset: TileSource, label: string, zone = 'spring'): string | undefined {
  const tile = tileset.tiles[label]
  if (!tile) return undefined
  const colors = tileColors(tile)
  const perZone = colors?.[zone] ?? (colors ? Object.values(colors)[0] : undefined)
  if (typeof perZone === 'string') return perZone
  if (Array.isArray(perZone) && perZone.length > 0) return perZone[0]
  const flat = (tile.settings as { color?: unknown } | undefined)?.color
  return typeof flat === 'string' ? flat : undefined
}

/** The opposite iso diagonal, for expanding the "hug this face" shorthand. */
const OPPOSITE: Record<DepthDir, DepthDir> = {
  'left-up': 'right-down', 'right-down': 'left-up', 'right-up': 'left-down', 'left-down': 'right-up',
}

/**
 * A tile's authored THICKNESS as the four REACHES the renderer and the editor both speak.
 *
 * The backend authors it two ways, because one is far easier to write by hand:
 *   - the SHORTHAND `{scaleZ, thicknessDir}` — "0.3 thick, hugging this face" (how a door is authored), and
 *   - the EXPLICIT `{thickness: {"<dir>": 0.4, …}}` — a per-direction reach map, for anything the shorthand
 *     cannot say (thin on both sides, or thin along both axes).
 *
 * Both land in one shape here, so nothing downstream has to know which was written. A direction the
 * renderer cannot name is DROPPED rather than trusted — a typo must leave a full cube, never a block
 * thinned along an axis that does not exist.
 */
export function tileThicknessReach(settings?: Record<string, unknown>): ThicknessReach | undefined {
  const out: ThicknessReach = {}

  const explicit = settings?.thickness
  if (explicit && typeof explicit === 'object') {
    for (const [dir, value] of Object.entries(explicit as Record<string, unknown>)) {
      if (THICKNESS_DIRS.has(dir) && typeof value === 'number' && value > 0 && value < 1) {
        out[dir as DepthDir] = value
      }
    }
  }

  // The shorthand fills in only what the explicit map left unsaid, so an explicit reach always wins.
  const amount = settings?.scaleZ
  const hug = settings?.thicknessDir
  if (typeof amount === 'number' && amount > 0 && amount < 1 && typeof hug === 'string' && THICKNESS_DIRS.has(hug)) {
    const back = OPPOSITE[hug as DepthDir]
    if (out[back] === undefined) out[back] = amount
  }

  return Object.keys(out).length > 0 ? out : undefined
}

/** A tile's own per-zone colour map from its backend `settings.colors` (undefined when it carries none).
 *  The single reader for "a tile's colour lives in its own settings" — used by colour resolution, the
 *  canopy-shade count, and decor zone-membership, so none of them re-reach into `settings` by hand. */
function tileColors(tile?: StyleTile): Record<string, string | readonly string[]> | undefined {
  return (tile?.settings as { colors?: Record<string, string | readonly string[]> } | undefined)?.colors
}

/** Resolve a tile's colour from its OWN backend `settings.colors` — per zone; canopy carries a per-zone
 *  array of tonal shades and `variant` picks one (wrapping). Falls back to the neutral colour when the
 *  tile has no colour for the zone. This is the "a tile's colour comes from its settings, not a shared
 *  palette" rule — the frontend never reads a per-zone palette blob. */
function resolveTileColor(tile: StyleTile, zone: string, variant: number): string {
  const c = tileColors(tile)?.[zone]
  if (typeof c === 'string') return c
  if (Array.isArray(c) && c.length > 0) return c[((variant % c.length) + c.length) % c.length]
  return FALLBACK_RESOLVED.color
}

/** How many canopy tonal shades a zone has, read from the loaded tileset's `leaf_center` (fallback
 *  `leaf_top`) tile's `settings.colors[zone]` array — the data-driven replacement for the deleted
 *  frontend `TREE_CANOPY_SHADES[zone].length`. The generator picks a tree's canopy variant in
 *  `[0, count)`. Safe: returns >= 1 even before the tileset loads (empty) or for an unknown zone, so
 *  tree generation never divides by zero. */
export function canopyCount(tileset: TileSource, zone: string): number {
  const leaf = tileset.tiles['leaf_center'] ?? tileset.tiles['leaf_top']
  const shades = tileColors(leaf)?.[zone]
  return Array.isArray(shades) && shades.length > 0 ? shades.length : 1
}

/** The DECOR tiles that belong to a zone — a decor tile "belongs" to a zone when its own
 *  `settings.colors` carries that zone (presence of the zone key = it is used there). Sorted by label
 *  so per-cell selection is deterministic regardless of the backend's row order. Empty when the tileset
 *  has not loaded. Replaces the deleted frontend `GROUND_DECOR` table. */
export function decorTilesForZone(tileset: TileSource, zone: string): StyleTile[] {
  return Object.values(tileset.tiles)
    .filter(t => t.category === 'decor' && tileColors(t)?.[zone] != null)
    .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
}

/** Pick a ground-decor tile for a cell and resolve its glyph + zone colour + its swap-LABEL — the
 *  data-driven twin of the deleted `groundDecor(zone, variant)`. Deterministic per `(col, row)` (the same
 *  hash the generator used). The `label` is threaded onto the placed decor so the render resolves the
 *  tile's BAKED image by label per active style (styleTileImage), exactly like every other tile — decor is
 *  an image, not a glyph. Null when the zone has no decor tiles (unloaded tileset), so the caller skips the cell. */
export function pickGroundDecor(tileset: TileSource, zone: string, col: number, row: number): (ResolvedTile & { label: string }) | null {
  const decors = decorTilesForZone(tileset, zone)
  if (decors.length === 0) return null
  const tile = decors[Math.abs(col * 7 + row * 13) % decors.length]
  return { ...resolveTile(tileset, zone, tile.label), label: tile.label }
}

/** The minimum a resolver needs: a label → tile map. Structural, so ANY style's catalog satisfies it and
 *  no resolver has to know which style it was handed. */
export interface TileSource {
  tiles: Record<string, StyleTile>
  terrain?: Record<string, GroundTile>
  compositions?: Record<string, Composition>
}

/** Resolve one tile's glyph + colour from a LOADED tileset — the data-driven twin of `cellTile()`.
 *  `variant` picks a canopy tonal shade (ignored by single-colour tiles). Pure. */
export function resolveTile(tileset: TileSource, zone: string, label: string, variant = 0): ResolvedTile {
  const tile = tileset.tiles[label]
  if (!tile) return FALLBACK_RESOLVED
  return { char: tile.char, color: resolveTileColor(tile, zone, variant), height: tile.height, settings: tile.settings }
}

/** The multi-cell COMPOSITION for an asset kind from a LOADED tileset (null if none). Pure — the caller
 *  (stampComposition) resolves each cell's tile via resolveTile + places it; no render logic here. */
export function resolveComposition(tileset: { compositions?: Record<string, Composition> }, kind: string): Composition | null {
  return tileset.compositions?.[kind] ?? null
}
