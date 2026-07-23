/**
 * ART-STYLE SWAP — the pure model behind the "reskin the whole world in one click"
 * milestone. ONE global Style maps an element's KIND → a Visual; a per-element
 * `tileOverride` (a style-agnostic tile id) pins a specific tile regardless of the
 * active style. `resolveVisual(kind, style, override?)` is the single decision point
 * every renderer funnels through.
 *
 * The load-bearing invariant: the built-in **ASCII** style maps NOTHING, so
 * `resolveVisual` returns the `ascii` passthrough sentinel for every unmapped kind —
 * the renderer then draws EXACTLY as it always did (byte-identical). A non-ASCII style
 * (e.g. Emoji) only overrides the kinds it maps; anything it leaves out still passes
 * through to ASCII, so the world can never go blank.
 *
 * Two Visual KINDS keep the mechanism future-proof:
 *   - `glyph`  — a char (+ optional color): what ASCII uses, and what an Emoji style
 *                uses (tree→🌲, water→🟦…). Drawn with the existing fillText path.
 *   - `image`  — a sprite/tile src + optional sub-rect: for pixel packs / Pixellab /
 *                uploads. The renderer draws it with drawImage. v1 ships no image pack,
 *                but the resolution + draw plumbing is wired.
 */

// ── element kinds (the vocabulary a Style maps) ──────────────────────────
import { EMOJI_TILESET } from '@/engine/tileset/emojiTileset'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'
// The BAKED entity/person/enemy resolution (which baked slug an enemyType / variant draws) is backend
// DATA fetched from `GET /api/entities` and installed into this holder — the frontend holds none of it.
// Read LIVE at call time so the resolvers below see the installed map (empty pre-load → the entity falls
// back to its base figure; the render is gated on the install, so that empty state never paints).
import { getEntityResolution } from '@/engine/entity/entityResolution'
import type { EntityVariant } from '@/game/types'

export type ElementKind =
  | 'grass' | 'water' | 'path' | 'road' | 'plaza' | 'sand' | 'ground' | 'snow' | 'autumn' // terrain (+ seasons; road = dark-gray town street)
  | 'cavefloor' | 'moss'                                       // dungeon terrain (cavern floor + moss)
  | 'wall' | 'roof' | 'door' | 'window' | 'fountain'          // buildings
  | 'tree' | 'flower' | 'bush' | 'rock' | 'crate' | 'lamp'    // nature / props
  | 'crystal' | 'mushroom'                                     // cave features
  | 'pillar' | 'altar' | 'torch' | 'hazard' | 'key'          // temple / dungeon features
  | 'enemy' | 'npc' | 'player'                                // units
  | 'mountain'
  | 'lava' | 'ember' | 'spill'                                 // volcanic ground + lava/water edge crust + waterfall spill
  | 'boss' | 'well' | 'connector'                            // arena boss anchor · village well · template portal marker
  | 'arrow' | 'bullet' | 'dart'                              // projectiles — drawn by their glyph → baked image
  // ability animations — the AbilityAnimation string IS the kind name (identity), so the renderer
  // phase routes an ability's `animation` straight through resolveVisual(animation, style).
  | 'fire-slash' | 'ice-slash' | 'cleave' | 'bolt' | 'piercing-shot'
  | 'nova' | 'lightning' | 'heal-glow' | 'guard-flash'

// The finer tile taxonomy (11 buckets, backend-owned). Order matches the Library sidebar layout.
// `buildings` was split into its structural pieces: walls / windows / doors / roofs. Ground splits into
// terrain (natural) / roads (paved ways) / floors (constructed interior). props = furniture/anchors, decor
// = small ground detail. The DATA value is always one of these strings; the UI shows prettier labels.
export type TileCategory =
  | 'terrain' | 'roads' | 'floors'
  | 'walls' | 'windows' | 'doors' | 'roofs'
  | 'nature' | 'props' | 'decor' | 'units'

/** The canonical bucket order (sidebar layout) + the single source for iterating every category. */
export const TILE_CATEGORIES: readonly TileCategory[] = [
  'terrain', 'roads', 'floors', 'walls', 'windows', 'doors', 'roofs', 'nature', 'props', 'decor', 'units',
]

// ── visuals ──────────────────────────────────────────────────────────────
/** Draw a char (ASCII glyph OR an emoji) with fillText. `color` does DOUBLE duty:
 *  it is the glyph fill (an emoji ignores it; an ASCII glyph inherits the renderer's
 *  default when omitted) AND — crucially — the TINT the geometry-preserving renderers
 *  fill each unit with (the iso ground DIAMOND, the building CUBE faces). A style glyph
 *  must carry a `color` so the diamond/cube it reskins is filled at the tile's own hue
 *  instead of drawing a flat upright emoji square on top of the ASCII fill. */
export interface GlyphVisual { kind: 'glyph'; char: string; color?: string }
/** Draw an image/sprite (optionally a sub-rect of an atlas) with drawImage. `color` is an
 *  optional backing TINT (drawn as the diamond/cube fill under the clipped sprite). `char` is the
 *  SOURCE glyph the image was baked from — kept as the label + the first-paint fallback (before the
 *  PNG decodes) so an image tile never has to invent a char. */
export interface ImageVisual { kind: 'image'; src: string; color?: string; char?: string; sx?: number; sy?: number; sw?: number; sh?: number }
/** Passthrough: draw exactly what the renderer already computed (the ASCII default). */
export interface AsciiVisual { kind: 'ascii' }
export type Visual = GlyphVisual | ImageVisual | AsciiVisual

/** The one shared passthrough instance (referentially stable, cheap to compare). */
export const ASCII_PASSTHROUGH: AsciiVisual = { kind: 'ascii' }

// ── a Style ───────────────────────────────────────────────────────────────
export interface Style {
  id: string
  name: string
  /** UI affordance icon (top-bar / picker). */
  icon: string
  /** A Style only maps the kinds it reskins; unmapped kinds pass through to ASCII. */
  map: Partial<Record<ElementKind, Visual>>
}

/** The built-in default — maps nothing, so EVERY kind passes through unchanged. */
export const ASCII_STYLE: Style = { id: 'ascii', name: 'ASCII', icon: '⌨', map: {} }

/** Build the emoji Style's map from the plain-data EMOJI_TILESET — each kind → a glyph Visual. This
 *  is the "load different" seam for emoji: the glyph+colour data lives in EMOJI_TILESET (JSON-
 *  serialisable, DB-seed-ready), and EMOJI_STYLE is just a view over it — not a hardcoded literal. */
function emojiStyleMap(): Partial<Record<ElementKind, Visual>> {
  const map: Partial<Record<ElementKind, Visual>> = {}
  for (const kind of Object.keys(EMOJI_TILESET)) {
    const tile = EMOJI_TILESET[kind]
    // A tile with an `image` (a Noto PNG) renders through the wired drawImage path — kills the Segoe
    // `[?]` tofu on Unicode-13 glyphs. `color` still rides along as the geometry backing tint.
    map[kind as ElementKind] = tile.image
      ? { kind: 'image', src: tile.image, color: tile.color, char: tile.char }
      : { kind: 'glyph', char: tile.char, color: tile.color }
  }
  return map
}

/** Zero-asset, visually striking reskin — proves the mechanism with pure emoji glyphs. Built from
 *  EMOJI_TILESET (loadable plain data), so the emoji tileset isn't hardcoded here. */
export const EMOJI_STYLE: Style = {
  id: 'emoji',
  name: 'Emoji',
  icon: '😀',
  map: emojiStyleMap(),
}

/** Rebuild EMOJI_STYLE.map from the current EMOJI_TILESET — call after setEmojiTileset() so DB-loaded
 *  emoji tiles install into the active style (EMOJI_STYLE is a stable object; only its map is swapped). */
export function rebuildEmojiStyle(): void {
  EMOJI_STYLE.map = emojiStyleMap()
}

// Gendered forms of the person glyphs, so an entity's `variant` renders the matching figure. A
// monster / colored-square / variant-less glyph is returned unchanged (genderize passes it through).
const GENDERED: Readonly<Record<string, { male: string; female: string }>> = {
  '🧍': { male: '🧍‍♂️', female: '🧍‍♀️' },
  '🚶': { male: '🚶‍♂️', female: '🚶‍♀️' },
  '🏃': { male: '🏃‍♂️', female: '🏃‍♀️' },
  '🧑': { male: '👨', female: '👩' },
  '🧒': { male: '👦', female: '👧' },
  '🧓': { male: '👴', female: '👵' },
  '🧙': { male: '🧙‍♂️', female: '🧙‍♀️' },
  '🧝': { male: '🧝‍♂️', female: '🧝‍♀️' },
  '🧛': { male: '🧛‍♂️', female: '🧛‍♀️' },
  '🧟': { male: '🧟‍♂️', female: '🧟‍♀️' },
  '💂': { male: '💂‍♂️', female: '💂‍♀️' },
  '👮': { male: '👮‍♂️', female: '👮‍♀️' },
  '👷': { male: '👷‍♂️', female: '👷‍♀️' },
  '🦸': { male: '🦸‍♂️', female: '🦸‍♀️' },
  '🦹': { male: '🦹‍♂️', female: '🦹‍♀️' },
}

/** The gendered form of a person glyph for an entity `variant` — the GLYPH fallback (used before the
 *  baked image decodes / when a tileset has no image). male/female swap to the gendered figure; the
 *  age/exotic variants (and a non-person or variant-less glyph) pass through unchanged. Data-only. */
export function genderize(char: string, variant?: EntityVariant): string {
  if (!variant) return char
  return GENDERED[char]?.[variant as 'male' | 'female'] ?? char
}

// ── baked entity/variant tiles (people + typed enemies as IMAGES) ──────────
// The baked slug set + the resolution maps are BACKEND DATA (getEntityResolution) installed from
// `/api/entities`, so a slug can never be wired to a PNG the backend didn't declare baked.

/** The baked PNG for an entity slug (goblin / man / robot …), or undefined when nothing was baked for
 *  it — so a catalog tile whose glyph the font couldn't rasterise stays a glyph instead of pointing at
 *  a missing image. The `dir` prefix is served by the backend alongside the slug set. */
export function bakedEntityImage(slug: string): string | undefined {
  const { dir, tiles } = getEntityResolution()
  return slug in tiles ? `${dir}/${slug}.png` : undefined
}


/** The per-variant tile OVERRIDE for a PERSON (npc/player) under a reskin — male→🧍‍♂️ man, old→🧓 elder,
 *  robot→🤖 … each a baked image. Returns undefined for ASCII, for no variant, or for a variant with no
 *  baked tile — all of which fall back to the BASE figure (never a raw glyph). Mirrors enemyTileId. */
export function personVariantTileId(variant: EntityVariant | undefined, style: Style): string | undefined {
  if (style.id === 'ascii' || !variant) return undefined
  const slug = getEntityResolution().variantSlug[variant]
  return slug && bakedEntityImage(slug) ? `emoji:${slug}` : undefined
}

/** The style-derived tile override for an ENTITY: an enemy's per-type tile (goblin→👺) or a person's
 *  per-variant figure (male→🧍‍♂️). One decision point so every renderer resolves entities identically.
 *  A manual `entity.tileOverride` still wins — the caller applies it before this. */
export function entityStyleOverride(
  entity: { kind: string; enemyType?: string; variant?: EntityVariant },
  style: Style,
): string | undefined {
  if (entity.kind === 'enemy') return enemyTileId(entity.enemyType, style)
  return personVariantTileId(entity.variant, style)
}

/** The styles the picker offers, in order. ASCII first (the default). */
export const BUILT_IN_STYLES: readonly Style[] = [ASCII_STYLE, EMOJI_STYLE]

/** Look a style up by id, defaulting to ASCII (so a bad/absent saved id can't break render). */
export function styleById(id: string | null | undefined): Style {
  return BUILT_IN_STYLES.find(s => s.id === id) ?? ASCII_STYLE
}

// ── kind derivation (pure classifiers the renderers call) ────────────────
const WATER_GROUND = /water|oasis|koi_pond/
const PATH_GROUND = /road|path|bridge|courtyard_stone/
// A town road is its OWN dark-gray tile (checked BEFORE PATH so path_stone/driveways stay brown).
const ROAD_GROUND = /^road(_center|_edge)?$/
const SAND_GROUND = /sand|desert|dune/
const SNOW_GROUND = /snow|ice|frost/
// Polished temple/dungeon floors read as a paved plaza in the emoji reskin (⬜).
const TEMPLE_FLOOR = /temple_floor|marble|gold_tile|ancient_stone|rune_floor/
// Raw cavern floors → dark rock; damp moss/lichen accents → green. basalt/ash/rock are the lava-cave
// floor (the lava zone's `rock` accent ground reads as cavern rock, not the passthrough 'ground').
const CAVE_FLOOR = /cave_floor|basalt|^ash$|^rock$/
const CAVE_MOSS = /moss/
// Molten ground — a lava/magma lake floor gets its OWN kind (🌋-red), never the ASCII passthrough.
const LAVA_GROUND = /^lava$|^magma$/

/** Classify a ground TILE TYPE string (grass / path_stone / water_deep / …) into a kind.
 *  Unrecognized terrain → 'ground' (unmapped → passes through to ASCII, never mis-skinned). */
export function groundKind(tileType: string): ElementKind {
  if (LAVA_GROUND.test(tileType)) return 'lava' // before water: a lava lake floor is its own molten kind
  if (WATER_GROUND.test(tileType)) return 'water'
  if (ROAD_GROUND.test(tileType)) return 'road' // town roads carve their own dark-gray tile
  if (PATH_GROUND.test(tileType)) return 'path'
  if (TEMPLE_FLOOR.test(tileType)) return 'plaza'
  if (tileType.startsWith('plaza')) return 'plaza'
  if (SAND_GROUND.test(tileType)) return 'sand'
  if (SNOW_GROUND.test(tileType)) return 'snow' // winter: snow/ice/frost — a WHITE field, not green
  if (tileType.startsWith('autumn')) return 'autumn' // autumn: amber ground + fallen leaves
  if (CAVE_MOSS.test(tileType)) return 'moss' // damp cavern moss/lichen (before cavefloor: distinct green)
  if (CAVE_FLOOR.test(tileType)) return 'cavefloor' // rocky cavern floor (incl. lava-cave basalt/ash)
  if (tileType.startsWith('grass')) return 'grass'
  return 'ground'
}

// A cell LABEL (tree_top_left / roof / door / …) → kind. Trees collapse to 'tree';
// building parts map to themselves; biome features to 'mountain'.
const LABEL_KIND: Readonly<Record<string, ElementKind>> = {
  roof_top: 'roof', roof: 'roof', wall: 'wall', door: 'door', window: 'window',
  mountain: 'mountain', peak: 'mountain', spill: 'spill', // biome-feature waterfall/lava spill
  // Multi-cell ASCII structures (stampAsset writes the asset id as the cell label) that read as
  // their own thing — the generic ones fall through to TYPE_KIND['structure'] = 'wall' below.
  big_tree: 'tree', big_rock: 'rock', statue: 'altar', well: 'well', fountain: 'fountain',
}

// Autotile PIECE + MATERIAL labels that must render their OWN per-cell tile in EVERY style (not a coarse
// base emoji): the wall MATERIAL pieces (wall_stone_* 🪨 / wall_brick_* 🧱 / wall_wood_* 🟫 / wall_plaster_* ⬜),
// the coloured roofs (roof_slate/roof_top_slate ⬛ · roof_hospital 🟩 · roof_store/roof_top_store 🟦 · rooftop_unit
// ⬛) which would otherwise fall to the coarse red 🟥 roof, and the fountain rim/water/jet pieces (fountain_*,
// water_c, water_jet). See assetKind — they fall through to the per-label draw, the SAME path trees use.
const PIECE_LABEL = /^(wall_stone|wall_brick|wall_wood|wall_plaster|roof_slate|roof_top_slate|roof_hospital|roof_top_hospital|roof_store|roof_top_store|rooftop_unit|fountain_|water_c$|water_jet$)/

/** Kind for a placed asset OR a labeled cell — the classifier the asset draw sites use.
 *  A tree label/type → 'tree'; a building part label → its part; else the asset `type`
 *  when that is itself a known kind; otherwise 'ground' (passthrough). */
export function assetKind(asset: { type: string; label?: string; tileKey?: string }): ElementKind {
  // A FLOOR is a regular tile whose art KIND is its ground kind (grass/road/water/…), carried on tileKey.
  // This is the ONE floor-aware line: it reuses groundKind so the floor slab resolves the SAME ground tile
  // + colour the old ground layer did — through the normal per-asset tile path, no separate renderer.
  if (asset.type === 'floor') return groundKind(asset.tileKey ?? 'grass')
  const label = asset.label
  if (label) {
    if (label.startsWith('tree')) return 'tree'
    const byLabel = LABEL_KIND[label]
    if (byLabel) return byLabel
    // Autotile PIECE + MATERIAL tiles are assembled per-cell from real DB tiles, so in emoji mode they must
    // paint their OWN tile (🪨 stone / 🧱 brick / 🟫 wood / ⬜ plaster wall · ⬛ slate roof · 🟦 water / 💧 jet) —
    // NOT the coarse whole-object wall(🧱)/roof/fountain(⛲) emoji. Returning the unmapped 'ground' routes ISO
    // to the per-label cube (iso.ts) + keeps 2D per-label; ASCII is untouched (already passthrough). MUST
    // precede the roof/wall prefix + fountain TYPE_KIND below.
    if (PIECE_LABEL.test(label)) return 'ground'
    // Type-specific building tiles (roof_store / roof_top_hospital / wall_house_a …) map to their
    // base part — the colour lives on the tile, the KIND is still roof/wall for art resolution.
    if (label.startsWith('roof')) return 'roof' // covers roof_* and roof_top_*
    if (label.startsWith('wall')) return 'wall'
  }
  return TYPE_KIND[asset.type] ?? 'ground'
}

// Placed-asset `type` → kind. `building`/`water`/`fountain` fold onto a mapped kind so
// legacy per-cell buildings + water props reskin too.
const TYPE_KIND: Readonly<Record<string, ElementKind>> = {
  tree: 'tree', flower: 'flower', bush: 'bush', rock: 'rock', decoration: 'rock',
  crate: 'crate', lamp: 'lamp', lantern: 'lamp', npc: 'npc',
  water: 'water', fountain: 'fountain', building: 'wall',
  // cave props — walls + rubble read as rock; crystals + mushrooms get their own tint; a water-edge
  // shore reads as sand so it doesn't leak to ASCII.
  cave_decor: 'rock', crystal: 'crystal', mushroom: 'mushroom', shore: 'sand',
  // temple props — walls read as wall; the colonnade/altar/torch/hazard/key get their own kinds
  // (a brazier reuses the torch flame); a placed door uses the door glyph.
  temple_wall: 'wall', pillar: 'pillar', altar: 'altar', torch: 'torch', brazier: 'torch',
  hazard: 'hazard', key: 'key', door: 'door',
  // the last unmapped generated types — the 'ground' fallback used to send these to the ASCII
  // passthrough. A biome-feature massif reads as mountain; auto ground litter as grass (its own
  // per-cell tileOverride still wins at draw); a paved driveway as path; a multi-cell stamp as wall.
  boss: 'boss', ember: 'ember', feature: 'mountain', ground_decor: 'grass',
  path_stone: 'path', structure: 'wall', well: 'well',
}

/** Kind for an entity by its role. */
export function entityKind(kind: string): ElementKind {
  if (kind === 'player') return 'player'
  if (kind === 'npc') return 'npc'
  return 'enemy'
}

/** The per-type tile OVERRIDE for an enemy under a reskin style — so goblin→👺, wolf→🐺, etc. Reads the
 *  backend-served enemyType→slug map (getEntityResolution) so the id always points at a baked tile, keyed
 *  on the lowercase enemyType tag. Returns undefined for ASCII (its enemies stay block-figures) and for
 *  unmapped/blank types (→ the base 👾). */
export function enemyTileId(enemyType: string | undefined, style: Style): string | undefined {
  if (style.id === 'ascii' || !enemyType) return undefined
  const slug = getEntityResolution().enemyTypeSlug[enemyType.toLowerCase()]
  return slug ? `emoji:${slug}` : undefined
}

// ── the Tile Library catalog (what the modal lists + what an override points at) ──
export interface TileDef {
  /** style-agnostic, globally-unique tile id (what a `tileOverride` stores). */
  id: string
  label: string
  category: TileCategory
  /** which style this tile belongs to in the Library UI. */
  styleId: string
  visual: Visual
  /** DEFAULT iso BLOCK height from the DB tile (0/undefined = a flat ground square, ≥1 = an extruded block).
   *  A painted tile SEEDS its GridAsset height from this, so a block tile (a boulder, a stone wall) paints as
   *  a BLOCK — byte-identical to a generated one — instead of a flat single-face billboard. */
  height?: number
  /** The DB tile's `settings` blob (the generic render-behavior keys fadeNear/cutawayRoof/display + colour).
   *  A painted tile carries the tile's OWN settings (via tileRenderBehavior) — the SAME seam stampComposition
   *  uses — so it is never forced to a flat single default and behaves exactly like the generator's version. */
  settings?: Record<string, unknown>
}

// ── the Tile Library: read LIVE from the loaded (DB) tilesets ─────────────────────────────────────
// The sidebar browses the SAME tilesets the MAP renders — the backend-loaded EMOJI_TILESET / ASCII_TILESET
// (tilesetLoader swaps in the :4000 DB rows). NOTHING art-related is hardcoded here: a tile is BROWSEABLE
// when its loaded entry carries a browseable `category` (one of TILE_CATEGORIES); its display name is the
// entry's `title`, its art the entry's image/glyph. The per-kind seed metadata (category/label/glyph)
// lives in the backend DB now — the frontend never hardcodes it.

const BROWSEABLE_CATEGORIES: ReadonlySet<string> = new Set<TileCategory>(TILE_CATEGORIES)

/** The Visual for one loaded EMOJI tile entry — its baked image if present, else its glyph. */
function emojiEntryVisual(t: { char: string; color?: string; image?: string }): Visual {
  return t.image ? { kind: 'image', src: t.image, color: t.color, char: t.char } : { kind: 'glyph', char: t.char, color: t.color }
}

/** The tiles the Library lists for a style, grouped by category — read LIVE from the loaded tileset so the
 *  sidebar ALWAYS matches the map. Only entries carrying a `category` are browseable (internal cell-labels
 *  like wall pieces / tree corners render on the map but never surface in the sidebar). */
export function tilesForStyle(styleId: string): Record<TileCategory, TileDef[]> {
  const out = Object.fromEntries(TILE_CATEGORIES.map(c => [c, [] as TileDef[]])) as Record<TileCategory, TileDef[]>
  // `extra` carries the DB tile's BLOCK height + settings so the palette tile FULLY describes the DB tile —
  // the brush then seeds a painted asset from it and a painted tile matches the generator's version.
  const push = (key: string, category: string | undefined, title: string | undefined, visual: Visual, extra: Pick<TileDef, 'height' | 'settings'> = {}): void => {
    if (!category || !BROWSEABLE_CATEGORIES.has(category)) return
    out[category as TileCategory].push({ id: `${styleId}:${key}`, label: title ?? key, category: category as TileCategory, styleId, visual, ...extra })
  }
  if (styleId === 'emoji') for (const [key, t] of Object.entries(EMOJI_TILESET)) push(key, t.category, t.title, emojiEntryVisual(t), { height: t.height, settings: t.settings })
  else if (styleId === 'ascii') for (const [key, t] of Object.entries(ASCII_TILESET.tiles)) push(key, t.category, t.title, { kind: 'glyph', char: t.glyph }, { settings: t.settings })
  return out
}

/** Resolve a style-agnostic tile id (`<styleId>:<key>`) to its Visual, LIVE from the loaded tileset (null
 *  for an unknown id / a style that lacks that tile — the caller then falls back to the coarse kind). */
export function visualForTileId(id: string): Visual | null {
  const sep = id.indexOf(':')
  if (sep < 0) return null
  const styleId = id.slice(0, sep), key = id.slice(sep + 1)
  if (styleId === 'emoji') { const t = EMOJI_TILESET[key]; return t ? emojiEntryVisual(t) : null }
  if (styleId === 'ascii') { const t = ASCII_TILESET.tiles[key]; return t ? { kind: 'glyph', char: t.glyph } : null }
  return null
}

// ── the one resolution point ──────────────────────────────────────────────
/**
 * The visual to draw for an element. Precedence:
 *   1. a per-element `override` (a tile id) — wins over the active style, even ASCII;
 *   2. the active `style`'s mapping for this `kind`;
 *   3. the ASCII passthrough sentinel — draw the renderer's own default (byte-identical).
 * An unknown override id falls through to (2)/(3) rather than throwing.
 */
export function resolveVisual(kind: ElementKind, style: Style, override?: string | null): Visual {
  if (override) {
    const v = visualForTileId(override)
    if (v) return v
  }
  return style.map[kind] ?? ASCII_PASSTHROUGH
}
