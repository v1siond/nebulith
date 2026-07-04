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

export interface Tileset {
  id: string
  name: string
  /** Every cell-label tile, keyed by its swap-label (trees / buildings / features). */
  tiles: Readonly<Record<string, TilesetTile>>
  /** Colour palettes keyed by zone id — the "stored colour property" that reskins cell-labels by zone. */
  palettes: Readonly<Record<string, ZonePalette>>
  /** Ground/terrain tiles keyed by ground type. */
  terrain: Readonly<Record<string, GroundTile>>
}

/** Resolve a GROUND tile's glyph + fg + base fill from a LOADED tileset — the data-driven twin of the
 *  inline `GROUND_COLORS[type]` + noise-variant selection in drawIsoGroundLayer. Pure; deterministic
 *  per (type, col, row). Grass's per-cell shade is applied by the caller (unchanged), so bg is the base. */
export function resolveGroundTile(tileset: Tileset, tileType: string, col: number, row: number): ResolvedGround {
  const g = tileset.terrain[tileType] ?? tileset.terrain.grass
  const noiseVal = Math.sin(col * 0.3 + row * 0.5) * Math.cos(col * 0.7 - row * 0.2)
  const colorIdx = noiseVal > 0 ? 0 : 1
  return {
    char: g.char[colorIdx % g.char.length],
    fg: g.fg[colorIdx % g.fg.length],
    bg: g.bg[0],
  }
}

export interface ResolvedTile { char: string; color: string }

// Unknown label → the same visible-but-neutral fallback the hardcoded path used (never blank/throw).
export const FALLBACK_RESOLVED: ResolvedTile = { char: '?', color: '#cccccc' }

// colour ROLE → the palette entry it reads (dispatch map, not an if/else chain). Canopy is the only
// variant-aware role (a tree/cluster picks a tonal shade); the rest are single per-zone colours.
const COLOR_RESOLVERS: Readonly<Record<string, (pal: ZonePalette, variant: number) => string>> = {
  canopy: (pal, variant) => pal.canopy[((variant % pal.canopy.length) + pal.canopy.length) % pal.canopy.length],
  trunk: pal => pal.trunk,
  'building.roof': pal => pal.building.roof,
  'building.wall': pal => pal.building.wall,
  'building.door': pal => pal.building.door,
  'building.window': pal => pal.building.window,
  'feature.mountain': pal => pal.feature.mountain,
  'feature.peak': pal => pal.feature.peak,
  'feature.spill': pal => pal.feature.spill,
}

/** Resolve one tile's glyph + colour from a LOADED tileset — the data-driven twin of `cellTile()`.
 *  `variant` picks a canopy tonal shade (ignored by non-canopy roles). Pure. */
export function resolveTile(tileset: Tileset, zone: string, label: string, variant = 0): ResolvedTile {
  const tile = tileset.tiles[label]
  if (!tile) return FALLBACK_RESOLVED
  const palette = tileset.palettes[zone]
  if (!palette) return FALLBACK_RESOLVED
  const resolver = COLOR_RESOLVERS[tile.colorRole]
  return { char: tile.glyph, color: resolver ? resolver(palette, variant) : FALLBACK_RESOLVED.color }
}
