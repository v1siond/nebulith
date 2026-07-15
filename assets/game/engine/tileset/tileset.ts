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
import type { TileView, TileViewSettings } from './tileViewSettings'
import type { ImageVisual } from '@/game/artStyle'

// 9-piece autotile POSITION — the swap standard: all sides + corners. 'single' = a non-tiling tile.
export type TilePosition =
  | 'top_left' | 'top' | 'top_right'
  | 'left' | 'center' | 'right'
  | 'bottom_left' | 'bottom' | 'bottom_right'
  | 'single'

export interface TilesetTile {
  /** The swap key — same across every tileset, so re-skin is a label match. */
  label: string
  /** The tile's appearance in THIS tileset (an ASCII glyph now; an image/sprite src later). */
  glyph: string
  /** Where in a 9-piece autotile mass this tile sits (or 'single'). */
  position: TilePosition
  walkable: boolean
  /** Which palette entry supplies the colour (e.g. 'canopy', 'trunk', 'building.roof'). */
  colorRole: string
  /** OPTIONAL positioning data (rotation/scale/flip/offset) resolved through `applyPose` — the SAME
   *  deviations-only shape the emoji tiles carry. Held items (weapons/shield) store here the orientation
   *  the ASCII renderer used to hardcode, so ASCII drives its weapon pose from tileset DATA like emoji. */
  pose?: TilePose
  /** OPTIONAL per-view settings (size/pose/…) — the SAME deviations-only shape the emoji tiles carry;
   *  absent view/field falls back to the tile's shared value then the renderer's hardcoded default. */
  views?: Partial<Record<TileView, TileViewSettings>>
  /** OPTIONAL sidebar metadata (served from the DB): `category` (terrain/buildings/units/nature) marks the
   *  tile BROWSEABLE in the Tile Library; `title` is its human display name. Absent = an internal cell-label
   *  (tree_top, wall corners…) that renders on the map but never shows in the sidebar. */
  category?: string
  title?: string
  /** OPTIONAL portable image asset served by the backend (`image_url` on the API tile) — the same
   *  "load different, behave the same" seam as the emoji tileset's `image`. When set, the renderer's
   *  image path draws this instead of the glyph; absent = the ascii glyph stays the only visual. */
  image?: ImageVisual
  /** OPTIONAL backend `settings` blob (served on the API tile) — holds the GENERIC render-behavior keys
   *  `fadeNear` / `cutawayRoof` a stamp copies onto the placed asset, plus style-specific extras. Any tile
   *  can carry them, so proximity fade/cutaway is a per-tile property, not a building special case. */
  settings?: Record<string, unknown>
}

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
}

/** A multi-cell asset TEMPLATE: a footprint + one tile per cell. The data-driven replacement for the
 *  frontend composeBuilding / make* factories — stored in the DB tileset, stamped by stampComposition. */
export interface Composition {
  footprint: { w: number; h: number }
  cells: readonly CompositionCell[]
}

export interface Tileset {
  id: string
  name: string
  /** Every cell-label tile, keyed by its swap-label (trees / buildings / features). */
  tiles: Readonly<Record<string, TilesetTile>>
  /** Colour palettes keyed by zone id — the "stored colour property" that reskins cell-labels by zone. */
  palettes: Readonly<Record<string, ZonePalette>>
  /** Ground/terrain tiles keyed by ground type. */
  terrain: Readonly<Record<string, GroundTile>>
  /** Optional multi-cell COMPOSITIONS keyed by asset kind (tree_small, house, fountain…) — a footprint of
   *  cells each holding one tile. The stamp places one per-cell asset per cell (data-driven composeBuilding). */
  compositions?: Readonly<Record<string, Composition>>
}

/** Ground drawn before the backend tileset loads — nothing. The app is backend-required (no bundled ground
 *  colour), so an unresolved ground paints an empty, transparent cell rather than a stand-in colour. */
const EMPTY_GROUND: ResolvedGround = { char: ' ', fg: 'transparent', bg: 'transparent' }

/** Resolve a GROUND tile's glyph + fg + base fill from a LOADED tileset — the data-driven twin of the
 *  inline `GROUND_COLORS[type]` + noise-variant selection in drawIsoGroundLayer. Pure; deterministic
 *  per (type, col, row). Grass's per-cell shade is applied by the caller (unchanged), so bg is the base. */
export function resolveGroundTile(tileset: Tileset, tileType: string, col: number, row: number): ResolvedGround {
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
  /** The tile's backend `settings` blob (carries the generic `fadeNear`/`cutawayRoof` behavior keys). */
  settings?: Record<string, unknown>
}

// Unknown label → the same visible-but-neutral fallback the hardcoded path used (never blank/throw).
export const FALLBACK_RESOLVED: ResolvedTile = { char: '?', color: '#cccccc' }

/** The GENERIC render-behavior keys (`fadeNear`/`cutawayRoof`) a stamp copies from a resolved tile's
 *  `settings` onto the placed asset. Returns undefined when the tile carries neither (the common case), so
 *  a stamp only sets `asset.settings` on tiles that actually opt into a behavior. */
export function tileRenderBehavior(settings?: Record<string, unknown>): { fadeNear?: boolean; cutawayRoof?: boolean } | undefined {
  if (!settings) return undefined
  const out: { fadeNear?: boolean; cutawayRoof?: boolean } = {}
  if (settings.fadeNear) out.fadeNear = true
  if (settings.cutawayRoof) out.cutawayRoof = true
  return out.fadeNear || out.cutawayRoof ? out : undefined
}

/** A tile's own per-zone colour map from its backend `settings.colors` (undefined when it carries none).
 *  The single reader for "a tile's colour lives in its own settings" — used by colour resolution, the
 *  canopy-shade count, and decor zone-membership, so none of them re-reach into `settings` by hand. */
function tileColors(tile?: TilesetTile): Record<string, string | readonly string[]> | undefined {
  return (tile?.settings as { colors?: Record<string, string | readonly string[]> } | undefined)?.colors
}

/** Resolve a tile's colour from its OWN backend `settings.colors` — per zone; canopy carries a per-zone
 *  array of tonal shades and `variant` picks one (wrapping). Falls back to the neutral colour when the
 *  tile has no colour for the zone. This is the "a tile's colour comes from its settings, not a shared
 *  palette" rule — the frontend never reads a per-zone palette blob. */
function resolveTileColor(tile: TilesetTile, zone: string, variant: number): string {
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
export function canopyCount(tileset: Tileset, zone: string): number {
  const leaf = tileset.tiles['leaf_center'] ?? tileset.tiles['leaf_top']
  const shades = tileColors(leaf)?.[zone]
  return Array.isArray(shades) && shades.length > 0 ? shades.length : 1
}

/** The DECOR tiles that belong to a zone — a decor tile "belongs" to a zone when its own
 *  `settings.colors` carries that zone (presence of the zone key = it is used there). Sorted by label
 *  so per-cell selection is deterministic regardless of the backend's row order. Empty when the tileset
 *  has not loaded. Replaces the deleted frontend `GROUND_DECOR` table. */
export function decorTilesForZone(tileset: Tileset, zone: string): TilesetTile[] {
  return Object.values(tileset.tiles)
    .filter(t => t.category === 'decor' && tileColors(t)?.[zone] != null)
    .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
}

/** Pick a ground-decor tile for a cell and resolve its glyph + zone colour — the data-driven twin of the
 *  deleted `groundDecor(zone, variant)`. Deterministic per `(col, row)` (the same hash the generator
 *  used). Null when the zone has no decor tiles (unloaded tileset), so the caller simply skips the cell. */
export function pickGroundDecor(tileset: Tileset, zone: string, col: number, row: number): ResolvedTile | null {
  const decors = decorTilesForZone(tileset, zone)
  if (decors.length === 0) return null
  const tile = decors[Math.abs(col * 7 + row * 13) % decors.length]
  return resolveTile(tileset, zone, tile.label)
}

/** Resolve one tile's glyph + colour from a LOADED tileset — the data-driven twin of `cellTile()`.
 *  `variant` picks a canopy tonal shade (ignored by single-colour tiles). Pure. */
export function resolveTile(tileset: Tileset, zone: string, label: string, variant = 0): ResolvedTile {
  const tile = tileset.tiles[label]
  if (!tile) return FALLBACK_RESOLVED
  return { char: tile.glyph, color: resolveTileColor(tile, zone, variant), settings: tile.settings }
}

/** The multi-cell COMPOSITION for an asset kind from a LOADED tileset (null if none). Pure — the caller
 *  (stampComposition) resolves each cell's tile via resolveTile + places it; no render logic here. */
export function resolveComposition(tileset: Tileset, kind: string): Composition | null {
  return tileset.compositions?.[kind] ?? null
}
