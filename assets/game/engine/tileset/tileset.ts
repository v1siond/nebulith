/**
 * Tileset, the data-driven tile catalog. A tile's LABEL (`tree_top_left`, `wall`, …) is the
 * style-agnostic SWAP KEY: every tileset uses the SAME labels, so re-skinning is `label → label`
 * ("grab `X_left`, swap the other tileset's `X_left`"). COLOR is a stored PROPERTY, a per-zone
 * palette + a per-tile colour ROLE, never encoded in the label: there is no `X_pink_left`, only
 * `X_left` whose colour the palette supplies. Glyph + walkability are properties too.
 *
 * This is the "load different, behave the same" seam. Today an ASCII tileset is bundled data the
 * renderer LOADS (asciiTileset.ts); later the SAME shape is a row set served by the Elixir/Ecto API.
 * The render logic never changes, only where the tileset comes from.
 */
import type { TilePose } from './pose'
import type { StyleTile } from './styleTiles'
import type { TileView, TileViewSettings } from './tileViewSettings'
import type { ImageVisual } from '@/game/artStyle'
import type { Animation } from '@/engine/animation/tileAnimation'
import type { IsoDiagonal, ThicknessReach } from '../render/isoBlock'

// 9-piece autotile POSITION, the swap standard: all sides + corners. 'single' = a non-tiling tile.
export type TilePosition =
  | 'top_left' | 'top' | 'top_right'
  | 'left' | 'center' | 'right'
  | 'bottom_left' | 'bottom' | 'bottom_right'
  | 'single'

/** DISPLAY MODE, how a tile is PAINTED onto its block. A per-tile render SETTING (lives in the tile's
 *  `settings` jsonb, mirrored as a per-ASSET override from the editor):
 *    • 'all_faces' (DEFAULT, current behaviour), the baked tile image is painted on the block's top + the
 *      two camera-visible side faces (drawIsoTileBlock / fillIsoFaceWithTile).
 *    • 'single', ONE instance of the tile is shown INSIDE the block volume (a single centered billboard at
 *      the block centre) over a plain, shaded block shell, e.g. a single water droplet floating in the block.
 *  Absent → 'all_faces' (byte-identical to before). This changes WHERE / HOW MANY TIMES the SAME baked image
 *  is drawn on the block, it never introduces a glyph. */
/**
 * ONE SPELLING, THE COLUMN'S.
 *
 * This was `all-faces` in the engine and `all_faces` in `cell_tiles.display`, which is a second
 * vocabulary whose whole job is to be translated back. It cost a round trip: a map saved the column's
 * spelling and loaded the engine's, so the same tile came back holding a different string than it went
 * in with, and the two paths could never be compared.
 */
export type TileDisplay = 'all_faces' | 'single'

/** How a tile's block renders: a cube, a shaded ball, or a cone.
 *
 *  `cone` is here because a conifer and a cypress are not round, and with only square and circle on
 *  offer every conifer in the catalogue was lying about its silhouette. The column admits all three
 *  (docs/SPEC.md §3.2); a drawer that does not know a shape falls through to the cube, so adding one
 *  is a new drawer rather than a branch in every renderer. */
export type TileShape = 'square' | 'circle' | 'cone'

// `StyleTile` (engine/tileset/styleTiles.ts) is THE tile shape, one per (style, label). The old
// per-style `TilesetTile` is gone with the two holder files.

export interface ZonePalette {
  trunk: string
  /** Variant tonal shades (canopy foliage varies per tree/cluster). */
  canopy: readonly string[]
  building: { roof: string; wall: string; door: string; window: string }
  feature: { mountain: string; peak: string; spill: string }
}

/** A GROUND/terrain tile, a different family from the cell-label tiles: keyed by ground TYPE
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
   *  render-side, exactly as before, kept out of here so this stays a pure data resolver). */
  char: string
  fg: string
  bg: string
}

/** One cell of a multi-cell COMPOSITION, a tile placed at a footprint offset + stack level. Combined
 *  across cells they form the rich ascii art (the tree's 2 trunk + 6 leaf tiles). */
export interface CompositionCell {
  /** Cell offset from the composition's anchor (grid col/row). */
  dx: number
  dy: number
  /** Stack level (0 = ground; higher = a block up), so a tree's canopy floats above its trunk. Default 0. */
  level?: number
  /** The tile placed in this cell, a swap-key label resolved via resolveTile against the active tileset. */
  label: string
  /** Cell collision, false (blocking) by default; a walkable cell (an open doorway) sets true. */
  walkable?: boolean
  /** Uniform draw ZOOM for this cell's tile (backend `composition_cells.scale`), the render multiplies every
   *  axis by it (iso `zoom = asset.scale`), so a cell can hold a tile bigger than one block. The tree's canopy
   *  is ONE leaf cell at scale 2 (a 2×2 crown). Absent/1 → the tile draws at one block, unchanged. */
  scale?: number
  /** Draw-PRIORITY (CSS z-index style) for this cell's tile (backend `composition_cells.z_index`). A higher
   *  value renders LATER (on top / in front), overriding the positional depth sort in every view, so the
   *  fountain's water reads IN FRONT of a wall behind it. Absent/0 → the sort falls through to the positional
   *  key, so the tile orders exactly as before. */
  zIndex?: number
  /** DEFAULT tile animations authored on this composition cell (backend `composition_cells.animations` jsonb,
   *  camelCase on the wire), a LIST of settings/sprite tweens the stamp copies onto the placed asset's
   *  `animations` (and sets `placedAt`), so a composition ships animated BY DEFAULT (the fountain's water_c +
   *  water_jet cells carry the rise/fade loop). Absent → the cell places an un-animated tile, unchanged. */
  animations?: Animation[]
  /** TUNED per-cell tile settings (backend `composition_cells.settings` jsonb, camelCase on the wire), the
   *  display overrides that shape a cell's tile into a realistic form, beyond the Zoom `scale` + `zIndex`
   *  siblings. `scaleY` stretches the block's HEIGHT (the lamp POST = one cell drawn ~7 blocks tall); `display`
   *  'single' draws ONE centered billboard instead of tiling the faces (the lamp BULB); `pose` nudges the
   *  placed tile (the bulb's `dy` lift onto the post top). stampComposition applies each onto the placed asset.
   *  Absent → the cell places its tile at one block, unposed, all_faces, unchanged. */
  settings?: CompositionCellSettings
}

/** The tuned per-cell tile settings a composition cell can carry (backend jsonb), applied onto the placed
 *  GridAsset by stampComposition. A small, extensible bag: `scaleX`/`scaleY` (Width/Height), `display`, `pose`,
 *  `shape`. Width (scaleX) + Depth (scaleZ) ride here like Height so a composition can ship a THIN trunk (a
 *  tree's skinny/thick trunk is a per-variant width) without touching the uniform Zoom (`scale`) column. */
export interface CompositionCellSettings {
  scaleX?: number
  scaleY?: number
  scaleZ?: number
  /** Which WORLD axis this cell's THICKNESS shrinks along (authored south-facing, like `spanAxis`). The stamp
   *  rotates it by the building's rotation, so a door is thin toward ITS house's front. */
  thicknessDir?: IsoDiagonal
  /** How many CELLS this composition cell spans along `spanAxis`, anchored at its base cell: a roof column
   *  covers the whole footprint as a single block. Absent/1 is the anchor and nothing more.
   *
   *  Still spelled `depth` because it mirrors the `composition_cells` column, which phase 7 renames with
   *  its table. `compositionCellRender` maps it onto the placed tile's `spanForward`, so the clash between
   *  a span and a size stops at that boundary rather than travelling into the renderers. */
  depth?: number
  /** Which iso diagonal `depth` extrudes along (authored south-facing as `left-down` = +row); stampComposition
   *  copies it onto the asset's `spanAxis`, ROTATED by the building's rotation so an east/west building's roof
   *  spans the correct grid axis. Absent → no directional depth (a plain cube). */
  spanAxis?: IsoDiagonal
  /** BIDIRECTIONAL z-width (#58): extra cells this SAME cell spans BACKWARD (opposite `spanAxis`) from its anchor,
   *  so ONE roof/deck cell covers a footprint both pathways, a 4-cell roof authored as 1 tile. stampComposition
   *  copies it onto the placed asset's `spanBack`. Absent/0 → today's one-way span. */
  spanBack?: number
  /** 2-AXIS z-width ("two sides at the same time"): cells this cell ALSO spans along the PERPENDICULAR axis, *  forward (`spanPerp`) + back (`spanPerpBack`). With `depth`/`spanBack` this makes the cell a RECTANGLE
   *  (a 2×2 roof deck authored as 1 tile). stampComposition copies both onto the placed asset. Absent/0 = a line. */
  spanPerp?: number
  spanPerpBack?: number
  display?: TileDisplay
  /**
   * DROP THE CUBE SHELL: only the tile's own picture is drawn, with no coloured block behind it.
   *
   * Every tile draws as a cube by default, so a prop authored into a composition came out as a coloured box with
   * its picture painted on the faces, which is *"what the hell is that ugly tetris piece?????"*. `display:
   * 'single'` centres the picture; this is what removes the box around it, and the two are authored together.
   *
   * The field did not exist here, so the backend stored it on the cell, served it, and the stamp threw it away
   * while copying `display` from the very same object. Measured on a stamped `forest_entrance`: every cell came
   * back carrying `display: 'single'` and nothing else, so the fix seeded for the tetris piece never rendered.
   */
  transparent?: boolean
  /** the SOLID this cell's tile renders as ('square' cube default, 'circle' ball), stampComposition copies it
   *  onto the placed asset's `shape`, so a composition can ship a default shape (a lamp globe = a circle cell). */
  shape?: TileShape
  pose?: TilePose
  /** the LIGHT this cell casts (a warm ground GLOW POOL at night), stampComposition copies it onto the placed
   *  asset's `light`, so the lamp_post BULB cell ships a lit-by-default lamp. See {@link AssetLight}. */
  light?: AssetLight
  /** an authored per-cell COLOUR ("#rrggbb") that TINTS this cell's baked tile in the base render (MAP-MODEL §8:
   *  "colour is a setting of the tile"). stampComposition uses it as the placed asset's colour, so a composition
   *  can ship a recoloured cell, e.g. the lamp BULB reads as a dark lantern by day (a `color` night-animation
   *  still last-wins-tints it warm gold at night). Absent → the tile's own colour. */
  color?: string
}

/** A per-tile LIGHT setting: the tile casts a warm radial GROUND GLOW POOL (drawn only at night by
 * `drawNightLighting`). A real, controllable SETTING authored on a composition cell (backend `settings.light`) or
  * per-instance
 *  in the editor's Light control group, round-tripping onto `GridAsset.light`. The renderer sizes the pool from
 *  `distance` and strengths/tints it from `intensity`/`color`; `on:false` casts none. */
export interface AssetLight {
  /** pool STRENGTH, 0..1, multiplies the pool's warm alpha (1 = today's default lamp brightness). */
  intensity: number
  /** pool RADIUS in cells/blocks, the glow reaches this many cells out (today's default lamp = 3.2). */
  distance: number
  /** pool COLOUR ("#rrggbb"); absent → the default warm lamp glow. */
  color?: string
  /** false → this tile casts NO pool (a switched-off lamp); absent/true → it lights. */
  on?: boolean
}

/** A multi-cell asset TEMPLATE: a footprint + one tile per cell. The data-driven replacement for the retired
 *  frontend building/tree factories, stored in the DB tileset, stamped by stampComposition. */
export interface Composition {
  footprint: { w: number; h: number }
  cells: readonly CompositionCell[]
  /** OPTIONAL human NAME (served from the DB `compositions.title`), a store's "Store", a hospital's
   *  "Hospital". When set, the stamp badges the building's roof apex with it (apex signage). Absent for
   *  houses/trees/others → no badge. */
  title?: string
  /** OPTIONAL sidebar BUCKET (served from the DB `compositions.category`), the SAME `category` vocabulary a
   *  tile carries (buildings/nature/props/terrain, MAP-MODEL §8). It marks the composition browseable in the
   *  paint palette and GROUPS it there, exactly like a tile's `category`, so the editor reads the group from
   *  this backend value instead of deriving it (door-detection / name regex). Absent = not browseable. */
  category?: string
}

export interface Tileset {
  id: string
  name: string
  /** Every cell-label tile, keyed by its swap-label (trees / buildings / features). */
  tiles: Readonly<Record<string, StyleTile>>
  /** Colour palettes keyed by zone id, the "stored colour property" that reskins cell-labels by zone. */
  palettes: Readonly<Record<string, ZonePalette>>
  /** Ground/terrain tiles keyed by ground type. */
  terrain: Readonly<Record<string, GroundTile>>
  /** Optional multi-cell COMPOSITIONS keyed by asset kind (tree, house_4, store_5…), a footprint of cells
   *  each holding one tile. The stamp places one per-cell asset per cell (a data-driven building/tree). */
  compositions?: Readonly<Record<string, Composition>>
}

/** Ground drawn before the backend tileset loads, nothing. The app is backend-required (no bundled ground
 *  colour), so an unresolved ground paints an empty, transparent cell rather than a stand-in colour. */
const EMPTY_GROUND: ResolvedGround = { char: ' ', fg: 'transparent', bg: 'transparent' }

/** Resolve a GROUND tile's glyph + fg + base fill from a LOADED tileset, the data-driven twin of the
 *  inline `GROUND_COLORS[type]` + noise-variant selection in drawIsoGroundLayer. Pure; deterministic
 *  per (type, col, row). Grass's per-cell shade is applied by the caller (unchanged), so bg is the base. */
export function resolveGroundTile(
  tileset: { terrain: Record<string, GroundTile>; tiles?: Record<string, { color?: string; char?: string }> },
  tileType: string,
  col: number,
  row: number,
): ResolvedGround {
  const g = tileset.terrain[tileType]
  if (!g) {
    // NOT GRASS. This read `?? tileset.terrain.grass`, and that one fallback is why the woodland had
    // no visible paths: `path` has no `variants` entry, so every trail cell resolved to the GRASS variant and
    // was painted the exact colour of the field it crossed. A hardcoded fallback for loaded data is the thing
    // the compliance rule forbids, and here it was quietly overwriting a real served colour.
    //
    // A label with no terrain VARIANT still has a TILE, and that tile owns a colour. Use it. Only a label the
    // catalog does not know at all comes back empty, which is the honest answer and draws nothing.
    const tile = tileset.tiles?.[tileType]
    return tile?.color ? { char: tile.char ?? '', fg: tile.color, bg: tile.color } : EMPTY_GROUND
  }
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
   *  Carried here so every consumer, the composition stamp included, reads height through the SAME data
   *  path (MAP-MODEL §4) instead of assuming a whole block. Undefined for an unknown label. */
  height?: number
  /** The tile's backend `settings` blob (carries the generic `fadeNear`/`cutawayRoof` behavior keys). */
  settings?: Record<string, unknown>
  /**
   * Does the backend say you can walk on it. Carried here so a generator READS the answer instead of
   * minting one, which is ticket 2: `thicket` is the only one of 40 nature tiles the catalog blocks, and
   * `makeThicket` hardcoded that same `true` in the frontend rather than asking. Absent for an unknown
   * label, and an unknown label must not become an invisible wall, so the fallback below states `true`.
   */
  walkable?: boolean
}

// Unknown label → the same visible-but-neutral fallback the hardcoded path used (never blank/throw).
export const FALLBACK_RESOLVED: ResolvedTile = { char: '?', color: '#cccccc', walkable: true }

/** The GENERIC render-behavior keys (`fadeNear`/`cutawayRoof`/`display`) a stamp copies from a resolved
 *  tile's `settings` onto the placed asset. Returns undefined when the tile carries none (the common case),
 *  so a stamp only sets `asset.settings` on tiles that actually opt into a behavior. `display` follows the
 *  SAME data path: only the non-default `'single'` rides through, `'all_faces'` / absent carries nothing,
 *  leaving `asset.settings` unset so a default tile renders byte-identically to before. */
export function tileRenderBehavior(settings?: Record<string, unknown>): { fadeNear?: boolean; cutawayRoof?: boolean; minAlpha?: number; display?: TileDisplay; transparent?: boolean; collision?: Array<{ x: number; y: number; w: number; h: number }> } | undefined {
  if (!settings) return undefined
  const out: { fadeNear?: boolean; cutawayRoof?: boolean; minAlpha?: number; display?: TileDisplay; transparent?: boolean; collision?: Array<{ x: number; y: number; w: number; h: number }> } = {}
  if (typeof settings.minAlpha === 'number') out.minAlpha = settings.minAlpha
  if (settings.fadeNear) out.fadeNear = true
  if (settings.cutawayRoof) out.cutawayRoof = true
  if (settings.display === 'single') out.display = 'single'
  // `transparent` DROPS THE CUBE SHELL so only the tile's own picture shows, and it rode no data path at all.
  // The renderer reads `asset.settings.transparent`; this function is what puts settings on an asset; it copied
  // `display` and not this. So the backend served it on 12 tiles (every flower, every entrance piece) and the
  // only thing that ever set it was a hardcoded table in the generator keyed by prop TYPE, which is the
  // violation twice already caught: *"this should be backend data, we receive the existing objects from backend
  // and are correctly processed by the frontend methods"*. A setting reaching one kind of tile and not another
  // is a bug, never a design: every tile setting applies to every tile through this same path.
  if (settings.transparent) out.transparent = true
  // AUTHORED collision boxes, the finer truth under a blocked cell (collisionBoxes.ts). Kept only when every box
  // is a real rectangle: a malformed one must never make a tile walk-through.
  const boxes = Array.isArray(settings.collision)
    ? settings.collision.filter((b): b is { x: number; y: number; w: number; h: number } =>
      !!b && typeof b === 'object' && ['x', 'y', 'w', 'h'].every(k => typeof (b as Record<string, unknown>)[k] === 'number'))
    : []
  if (boxes.length > 0) out.collision = boxes
  return out.fadeNear || out.cutawayRoof || out.display || out.transparent || out.collision ? out : undefined
}


/** The four iso diagonals a THICKNESS may shrink along, the same axes z-width spans. */
const THICKNESS_DIRS: ReadonlySet<string> = new Set(['left-up', 'right-up', 'left-down', 'right-down'])

/**
 * A tile's OWN colour, by label, or undefined when the tileset carries no such tile.
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
const OPPOSITE: Record<IsoDiagonal, IsoDiagonal> = {
  'left-up': 'right-down', 'right-down': 'left-up', 'right-up': 'left-down', 'left-down': 'right-up',
}

/**
 * A tile's authored THICKNESS as the four REACHES the renderer and the editor both speak.
 *
 * The backend authors it two pathways, because one is far easier to write by hand:
 *   - the SHORTHAND `{scaleZ, thicknessDir}`, "0.3 thick, hugging this face" (how a door is authored), and
 *   - the EXPLICIT `{thickness: {"<dir>": 0.4, …}}`, a per-direction reach map, for anything the shorthand
 *     cannot say (thin on both sides, or thin along both axes).
 *
 * Both land in one shape here, so nothing downstream has to know which was written. A direction the
 * renderer cannot name is DROPPED rather than trusted, a typo must leave a full cube, never a block
 * thinned along an axis that does not exist.
 */
export function tileThicknessReach(settings?: Record<string, unknown>): ThicknessReach | undefined {
  const out: ThicknessReach = {}

  const explicit = settings?.thickness
  if (explicit && typeof explicit === 'object') {
    for (const [dir, value] of Object.entries(explicit as Record<string, unknown>)) {
      if (THICKNESS_DIRS.has(dir) && typeof value === 'number' && value > 0 && value < 1) {
        out[dir as IsoDiagonal] = value
      }
    }
  }

  // The shorthand fills in only what the explicit map left unsaid, so an explicit reach always wins.
  const amount = settings?.scaleZ
  const hug = settings?.thicknessDir
  if (typeof amount === 'number' && amount > 0 && amount < 1 && typeof hug === 'string' && THICKNESS_DIRS.has(hug)) {
    const back = OPPOSITE[hug as IsoDiagonal]
    if (out[back] === undefined) out[back] = amount
  }

  // A thickness with NO direction thins toward every face, which is what "0.3 thick" means when nobody
  // said which way. It used to fall through to a screen-axis squash on the depth axis instead, so the
  // one control thinned from the side and stretched from above. Thickness is the only thinner now, and
  // it says so here rather than in each renderer.
  if (typeof amount === 'number' && amount > 0 && amount < 1 && typeof hug !== 'string') {
    for (const dir of THICKNESS_DIRS) {
      if (out[dir as IsoDiagonal] === undefined) out[dir as IsoDiagonal] = amount
    }
  }

  return Object.keys(out).length > 0 ? out : undefined
}

/** A tile's own per-zone colour map from its backend `settings.colors` (undefined when it carries none).
 *  The single reader for "a tile's colour lives in its own settings", used by colour resolution, the
 *  canopy-shade count, and decor zone-membership, so none of them re-reach into `settings` by hand. */
function tileColors(tile?: StyleTile): Record<string, string | readonly string[]> | undefined {
  return (tile?.settings as { colors?: Record<string, string | readonly string[]> } | undefined)?.colors
}

/** Resolve a tile's colour from its OWN backend `settings.colors`, per zone; canopy carries a per-zone
 *  array of tonal shades and `variant` picks one (wrapping). Falls back to the neutral colour when the
 *  tile has no colour for the zone. This is the "a tile's colour comes from its settings, not a shared
 *  palette" rule, the frontend never reads a per-zone palette blob. */
function resolveTileColor(tile: StyleTile, zone: string, variant: number): string {
  const c = tileColors(tile)?.[zone]
  if (typeof c === 'string') return c
  if (Array.isArray(c) && c.length > 0) return c[((variant % c.length) + c.length) % c.length]
  // THE FLAT SHAPE IS SERVED DATA TOO, and dropping it is how an invented colour reached the screen.
  //
  // The backend serves a tile's colour two pathways: a per-zone `settings.colors` map (240 of the 361 ascii rows)
  // and a flat `settings.color` (every emoji row, plus exactly two ascii rows: `thicket` and `tall_grass`,
  // authored that way in `tile_source.ex` @growth_tiles). This read only the map, so those two fell through to
  // the neutral grey and `makeThicket` stamped #cccccc onto every thicket prop. `tintedImage` is documented as
  // `tint x luminance(sprite)`, so the green sprig came out a pale white shape.
  //
  // That was right on both counts: no flower ever blocked, and the
  // thing blocking was a thicket wearing an invented colour. `tileColorByLabel` in this same file already reads
  // both shapes; this resolver was simply incomplete.
  const flat = (tile.settings as { color?: unknown } | undefined)?.color
  if (typeof flat === 'string') return flat
  return FALLBACK_RESOLVED.color
}

/** How many canopy tonal shades a zone has, read from the loaded tileset's `leaf_center` (fallback
 *  `leaf_top`) tile's `settings.colors[zone]` array, the data-driven replacement for the deleted
 *  frontend `TREE_CANOPY_SHADES[zone].length`. The generator picks a tree's canopy variant in
 *  `[0, count)`. Safe: returns >= 1 even before the tileset loads (empty) or for an unknown zone, so
 *  tree generation never divides by zero. */
export function canopyCount(tileset: TileSource, zone: string): number {
  const leaf = tileset.tiles['leaf_center'] ?? tileset.tiles['leaf_top']
  const shades = tileColors(leaf)?.[zone]
  return Array.isArray(shades) && shades.length > 0 ? shades.length : 1
}

/** WHICH of a zone's canopy shades this tree wears, the value behind the count above.
 *
 *  `canopyCount` says how many there are and the generator picks a `variant` in `[0, count)`; this returns
 *  the shade that variant names, so the four-per-season variance is read from the SAME served array rather
 *  than re-derived. Undefined when the tileset has not loaded or the zone serves no shades, and the caller
 *  then leaves the tree its composition's own colour. */
export function canopyShade(tileset: TileSource, zone: string, variant: number): string | undefined {
  const leaf = tileset.tiles['leaf_center'] ?? tileset.tiles['leaf_top']
  const shades = tileColors(leaf)?.[zone]
  if (!Array.isArray(shades) || shades.length === 0) return undefined
  const shade = shades[((variant % shades.length) + shades.length) % shades.length]
  return typeof shade === 'string' ? shade : undefined
}

/** The DECOR tiles that belong to a zone, a decor tile "belongs" to a zone when its own
 *  `settings.colors` carries that zone (presence of the zone key = it is used there). Sorted by label
 *  so per-cell selection is deterministic regardless of the backend's row order. Empty when the tileset
 *  has not loaded. Replaces the deleted frontend `GROUND_DECOR` table. */
export function decorTilesForZone(tileset: TileSource, zone: string): StyleTile[] {
  return Object.values(tileset.tiles)
    .filter(t => t.category === 'decor' && tileColors(t)?.[zone] != null)
    .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
}

/** Pick a ground-decor tile for a cell and resolve its glyph + zone colour + its swap-LABEL, the
 *  data-driven twin of the deleted `groundDecor(zone, variant)`. Deterministic per `(col, row)` (the same
 *  hash the generator used). The `label` is threaded onto the placed decor so the render resolves the
 *  tile's BAKED image by label per active style (styleTileImage), exactly like every other tile, decor is
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

/** Resolve one tile's glyph + colour from a LOADED tileset, the data-driven twin of `cellTile()`.
 *  `variant` picks a canopy tonal shade (ignored by single-colour tiles). Pure. */
export function resolveTile(tileset: TileSource, zone: string, label: string, variant = 0): ResolvedTile {
  const tile = tileset.tiles[label]
  if (!tile) return FALLBACK_RESOLVED
  return { char: tile.char, color: resolveTileColor(tile, zone, variant), height: tile.height, settings: tile.settings, walkable: tile.walkable }
}

/** The multi-cell COMPOSITION for an asset kind from a LOADED tileset (null if none). Pure, the caller
 *  (stampComposition) resolves each cell's tile via resolveTile + places it; no render logic here. */
export function resolveComposition(tileset: { compositions?: Record<string, Composition> }, kind: string): Composition | null {
  return tileset.compositions?.[kind] ?? null
}
