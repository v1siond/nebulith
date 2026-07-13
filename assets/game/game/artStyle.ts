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
// The single source for the BAKED entity/person/enemy tiles (slug → glyph) + the resolution maps
// (enemyType → slug, variant → slug). The bake script (scripts/bake-entity-tiles.mjs) reads the SAME
// file, so the baked PNGs and the images wired here can never drift.
import ENTITY_TILES from '@/game/data/entityTiles.json'
import EMOJI_CATALOG from '@/game/data/emojiCatalog.json'
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

export type TileCategory = 'terrain' | 'buildings' | 'units' | 'nature'

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
// The baked slug set + the resolution maps come from ONE data file (entityTiles.json), shared with the
// bake script so a slug can never be wired to a PNG that wasn't baked.
const ENTITY_TILE_DIR: string = ENTITY_TILES.dir
const BAKED_ENTITY_SLUGS = ENTITY_TILES.tiles as Readonly<Record<string, string>>
const VARIANT_SLUG = ENTITY_TILES.variantSlug as Readonly<Record<string, string>>

/** The baked PNG for an entity slug (goblin / man / robot …), or undefined when nothing was baked for
 *  it — so a catalog tile whose glyph the font couldn't rasterise stays a glyph instead of pointing at
 *  a missing image. A path under /public, so it's static, always-served data (no DB needed). */
export function bakedEntityImage(slug: string): string | undefined {
  return slug in BAKED_ENTITY_SLUGS ? `${ENTITY_TILE_DIR}/${slug}.png` : undefined
}

// The full emoji CATALOG is baked to PNGs too (scripts/bake-catalog-tiles.mjs), driven by the SAME data
// file so bake set and wiring never drift — so every placeable tile draws as an IMAGE, not a live glyph.
const CATALOG_DIR: string = EMOJI_CATALOG.dir
const BAKED_CATALOG_SLUGS = new Set(EMOJI_CATALOG.baked as readonly string[])
/** A catalog slug with a baked PNG → its image path; else undefined (the few Noto can't ink stay glyphs). */
export function bakedCatalogImage(slug: string): string | undefined {
  return BAKED_CATALOG_SLUGS.has(slug) ? `${CATALOG_DIR}/${slug}.png` : undefined
}

/** The per-variant tile OVERRIDE for a PERSON (npc/player) under a reskin — male→🧍‍♂️ man, old→🧓 elder,
 *  robot→🤖 … each a baked image. Returns undefined for ASCII, for no variant, or for a variant with no
 *  baked tile — all of which fall back to the BASE figure (never a raw glyph). Mirrors enemyTileId. */
export function personVariantTileId(variant: EntityVariant | undefined, style: Style): string | undefined {
  if (style.id === 'ascii' || !variant) return undefined
  const slug = VARIANT_SLUG[variant]
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

/** Kind for a placed asset OR a labeled cell — the classifier the asset draw sites use.
 *  A tree label/type → 'tree'; a building part label → its part; else the asset `type`
 *  when that is itself a known kind; otherwise 'ground' (passthrough). */
export function assetKind(asset: { type: string; label?: string }): ElementKind {
  const label = asset.label
  if (label) {
    if (label.startsWith('tree')) return 'tree'
    const byLabel = LABEL_KIND[label]
    if (byLabel) return byLabel
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

/** enemyType → catalog tile id, so a wolf draws 🐺 and a skeleton 💀 instead of every enemy sharing the
 *  generic 👾. Derived from entityTiles.json's enemyType→slug map (the same data the bake reads), so the
 *  id always points at a baked tile. Keyed on the lowercase enemyType tag; unmapped types fall back to 👾. */
export const ENEMY_TILE_BY_TYPE: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(ENTITY_TILES.enemyTypeSlug as Readonly<Record<string, string>>).map(
    ([type, slug]) => [type, `emoji:${slug}`],
  ),
)

/** The per-type tile OVERRIDE for an enemy under a reskin style — so goblin→👺, wolf→🐺, etc. Returns
 *  undefined for ASCII (its enemies stay block-figures) and for unmapped/blank types (→ the base 👾). */
export function enemyTileId(enemyType: string | undefined, style: Style): string | undefined {
  if (style.id === 'ascii' || !enemyType) return undefined
  return ENEMY_TILE_BY_TYPE[enemyType.toLowerCase()]
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
}

const CATEGORY_OF: Readonly<Record<ElementKind, TileCategory>> = {
  grass: 'terrain', water: 'terrain', path: 'terrain', road: 'terrain', plaza: 'terrain', sand: 'terrain', ground: 'terrain', mountain: 'terrain', snow: 'terrain', autumn: 'terrain', cavefloor: 'terrain', moss: 'terrain',
  lava: 'terrain', ember: 'terrain', spill: 'terrain',
  wall: 'buildings', roof: 'buildings', door: 'buildings', window: 'buildings', fountain: 'buildings',
  pillar: 'buildings', altar: 'buildings', well: 'buildings', connector: 'buildings',
  tree: 'nature', flower: 'nature', bush: 'nature', rock: 'nature', crate: 'nature', lamp: 'nature',
  crystal: 'nature', mushroom: 'nature', torch: 'nature', hazard: 'nature', key: 'nature',
  enemy: 'units', npc: 'units', player: 'units', boss: 'units',
  // projectiles + ability-animation FX — grouped under units (combat visuals) for the Library.
  arrow: 'units', bullet: 'units', dart: 'units',
  'fire-slash': 'units', 'ice-slash': 'units', cleave: 'units', bolt: 'units', 'piercing-shot': 'units',
  nova: 'units', lightning: 'units', 'heal-glow': 'units', 'guard-flash': 'units',
}

const KIND_LABEL: Readonly<Record<ElementKind, string>> = {
  grass: 'Grass', water: 'Water', path: 'Path', road: 'Road', plaza: 'Plaza', sand: 'Sand', ground: 'Ground', mountain: 'Mountain', snow: 'Snow', autumn: 'Autumn Ground', cavefloor: 'Cave Floor', moss: 'Moss',
  lava: 'Lava', ember: 'Ember', spill: 'Spill',
  wall: 'Wall', roof: 'Roof', door: 'Door', window: 'Window', fountain: 'Fountain',
  pillar: 'Pillar', altar: 'Altar', well: 'Well', connector: 'Portal',
  tree: 'Tree', flower: 'Flower', bush: 'Bush', rock: 'Rock', crate: 'Crate', lamp: 'Lamp',
  crystal: 'Crystal', mushroom: 'Mushroom', torch: 'Torch', hazard: 'Hazard', key: 'Key',
  enemy: 'Enemy', npc: 'NPC', player: 'Player', boss: 'Boss',
  arrow: 'Arrow', bullet: 'Bullet', dart: 'Bolt',
  'fire-slash': 'Fire Slash', 'ice-slash': 'Ice Slash', cleave: 'Cleave', bolt: 'Arcane Bolt', 'piercing-shot': 'Piercing Shot',
  nova: 'Nova', lightning: 'Lightning', 'heal-glow': 'Heal Glow', 'guard-flash': 'Guard Flash',
}

// Explicit ASCII glyph tiles so the Library has content for the ASCII style too (its
// `map` is intentionally empty for passthrough). These mirror the engine's own glyphs.
const ASCII_TILE_GLYPHS: Partial<Record<ElementKind, string>> = {
  grass: '"', water: '≈', path: '░', plaza: '#', sand: '∴', mountain: '▲', cavefloor: ':', moss: ',',
  wall: '█', roof: '▀', door: '╫', window: '▒',
  pillar: '║', altar: '‡', torch: 'ϯ', hazard: '▲', key: '⚷',
  tree: '♣', flower: '+', bush: '*', rock: 'O', crate: '$', lamp: '!',
  crystal: '◆', mushroom: '♠',
  enemy: '&', npc: '☺', player: '@',
}

function tilesForAscii(): TileDef[] {
  return (Object.keys(ASCII_TILE_GLYPHS) as ElementKind[]).map(kind => ({
    id: `ascii:${kind}`,
    label: KIND_LABEL[kind],
    category: CATEGORY_OF[kind],
    styleId: 'ascii',
    visual: { kind: 'glyph', char: ASCII_TILE_GLYPHS[kind]! } as GlyphVisual,
  }))
}

function tilesFromStyle(style: Style): TileDef[] {
  return (Object.keys(style.map) as ElementKind[]).map(kind => ({
    id: `${style.id}:${kind}`,
    label: KIND_LABEL[kind],
    category: CATEGORY_OF[kind],
    styleId: style.id,
    visual: style.map[kind]!,
  }))
}

/** A curated emoji tile helper — one call per row keeps the big catalog below readable.
 *  `slug` is the id suffix (kept distinct from every EMOJI_STYLE kind name so the whole
 *  catalog stays id-unique); `color` is the dominant hue (the iso diamond/cube tint + ASCII
 *  fallback — an emoji glyph draws itself, but a sensible tint keeps the geometry on-hue). */
function emojiTile(category: TileCategory, slug: string, label: string, char: string, color: string): TileDef {
  // A slug with a baked PNG (people + typed enemies) renders as an IMAGE — identical on every OS, no
  // Segoe tofu — carrying the source glyph + tint as label/fallback. Everything else stays a glyph.
  const image = bakedEntityImage(slug) ?? bakedCatalogImage(slug)
  const visual: Visual = image
    ? { kind: 'image', src: image, color, char }
    : { kind: 'glyph', char, color }
  return { id: `emoji:${slug}`, label, category, styleId: 'emoji', visual }
}

/**
 * The FULL, categorized + labeled emoji tileset the Library browses — every tree, every
 * building, every terrain, every character, each with a clear human label. This is what makes
 * the Library read like a real tileset instead of the sparse one-per-kind starter map. These
 * are catalog/override tiles only (they don't touch EMOJI_STYLE.map, so render is unchanged);
 * they surface in `tilesForStyle('emoji')` and can be pinned per-element via `visualForTileId`.
 */
export const EMOJI_TILES: TileDef[] = Object.entries(
  EMOJI_CATALOG.tiles as Record<string, { category: TileCategory; label: string; char: string; color: string; height?: number }>,
).map(([slug, t]) => emojiTile(t.category, slug, t.label, t.char, t.color))

/** Every catalog tile, flat (ASCII glyph tiles + each non-ASCII style's mapped tiles + the
 *  full curated emoji tileset above). Deduped by id keeping the FIRST occurrence: a style KIND and
 *  a curated catalog tile can legitimately share a slug (e.g. `lava` — a mapped ground kind AND a
 *  browsable catalog terrain), and the style's mapped tile is the canonical one. Keeps every id
 *  globally unique so `visualForTileId` (a `tileOverride` lookup) is never ambiguous. */
function dedupById(defs: TileDef[]): TileDef[] {
  const seen = new Set<string>()
  return defs.filter(d => (seen.has(d.id) ? false : (seen.add(d.id), true)))
}
export const TILE_CATALOG: readonly TileDef[] = dedupById([
  ...tilesForAscii(),
  ...BUILT_IN_STYLES.filter(s => s.id !== 'ascii').flatMap(tilesFromStyle),
  ...EMOJI_TILES,
])

const TILE_BY_ID: Readonly<Record<string, TileDef>> = Object.fromEntries(TILE_CATALOG.map(t => [t.id, t]))

/** The tiles the Library lists for a style, grouped by category (terrain/buildings/units/nature). */
export function tilesForStyle(styleId: string): Record<TileCategory, TileDef[]> {
  const out: Record<TileCategory, TileDef[]> = { terrain: [], buildings: [], units: [], nature: [] }
  for (const t of TILE_CATALOG) {
    if (t.styleId === styleId) out[t.category].push(t)
  }
  return out
}

/** Resolve a style-agnostic tile id to its Visual (null for an unknown id). */
export function visualForTileId(id: string): Visual | null {
  return TILE_BY_ID[id]?.visual ?? null
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
