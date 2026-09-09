/**
 * ART-STYLE SWAP — the pure model behind the "reskin the whole world in one click"
 * milestone. ONE global Style maps an element's KIND → a Visual; a per-element
 * `tileOverride` (a style-agnostic tile id) pins a specific tile regardless of the
 * active style. `resolveVisual(kind, style, override?)` is the single decision point
 * every renderer funnels through.
 *
 * THE INVARIANT — **a style is a SET OF BAKED IMAGES, and nothing else.** Alexander: *"all arts have
 * the exact same behavior and engine and the only thing that changes is the tiles, that's all that
 * changes, the tileset art … changing from emoji to ascii shouldn't make a difference whatsoever,
 * because we're just saying 'use this set of images instead of this other one'."* So a tile's Visual
 * is built by ONE helper (`tileVisual`) from ONE normalised record (`TileArt`), looked up through ONE
 * one lookup (`styleTileArt`). No resolver, and no renderer, may branch on the style id for
 * anything but WHICH TILESET to read — never for how to draw. (MAP-MODEL §4 / §8.)
 *
 * `ASCII_STYLE.map` stays empty: a KIND resolves through the tileset lookup, not a pre-baked kind map,
 * so `resolveVisual` returns the `ascii` passthrough sentinel for an unmapped kind and the renderer
 * resolves the kind's baked tile itself (`styleTileImage`). A non-ASCII style only overrides the kinds
 * it maps; anything it leaves out passes through, so the world can never go blank.
 *
 * Two Visual KINDS:
 *   - `image`  — a baked tile PNG (+ optional atlas sub-rect). **This is what every seeded tile is**,
 *                in EITHER style; the renderer draws it with drawImage and caches the built sprite.
 *   - `glyph`  — a char (+ optional color). The documented LAST RESORT for a tile with genuinely no
 *                baked image (MAP-MODEL §8 forbids `image_url: nil` on a seeded tile), never a
 *                pre-load placeholder — the loader decodes every PNG before the render gate opens.
 */

// ── element kinds (the vocabulary a Style maps) ──────────────────────────
import { styleTile, styleTiles } from '@/engine/tileset/styleTiles'
// The BAKED entity/person/enemy resolution (which baked slug an enemyType / variant draws) is backend
// DATA fetched from `GET /api/entities` and installed into this holder — the frontend holds none of it.
// Read LIVE at call time so the resolvers below see the installed map (empty pre-load → the entity falls
// back to its base figure; the render is gated on the install, so that empty state never paints).
import { getEntityResolution } from '@/engine/entity/entityResolution'
import type { EntityVariant } from '@/game/types'
import type { HasTileViews } from '@/engine/tileset/tileViewSettings'

export type ElementKind =
  | 'grass' | 'water' | 'path' | 'road' | 'plaza' | 'sand' | 'ground' | 'snow' | 'autumn' | 'meadow' // terrain (+ seasons; road = dark-gray town street; meadow = flat colour-only floor)
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

/** The heading each bucket shows. The DATA value is the lowercase string above; this is what people read. */
export const CATEGORY_LABELS: Record<TileCategory, string> = {
  terrain: 'Terrain', roads: 'Roads/Paths', floors: 'Floors', walls: 'Walls', windows: 'Windows',
  doors: 'Doors', roofs: 'Roofs', nature: 'Nature', props: 'Props/Furniture', decor: 'Decor', units: 'Units',
}

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

/** A loaded tile's ART, normalised across the tilesets — the ONE shape every style is read through.
 *  An `EmojiTile` carries `char`/`color`/`image:string`; a `TilesetTile` carries `glyph`/`image:ImageVisual`.
 *  Both project onto this, so nothing downstream may branch on which style it came from. `pose`/`views` ride
 *  along because the per-view size/pose resolvers (tileViewSettings) read them and must read them the SAME
 *  way in every style — a renderer that only looked them up for emoji made a tile behave differently under
 *  ASCII, which the whole "a style is just a set of images" rule forbids. */
export interface TileArt extends HasTileViews { char: string; color?: string; image?: string; height?: number }

/** The Visual for ONE loaded tile — its baked IMAGE if it has one, else its glyph.
 *
 *  THE INVARIANT (Alexander): *"the only thing that changes is the tiles, that's all that changes, the
 *  tileset art … we're just saying 'use this set of images instead of this other one'."* So this is the
 *  SINGLE builder for EVERY style — ascii and emoji produce the identical Visual shape and only the `src`
 *  differs. ASCII used to discard the tile's baked `image` here and hand back a raw glyph, which made every
 *  image-backed tile miss the cube-sprite cache (gated on `dv.image`) and fall into the per-face
 *  clip+fillText path — the whole reason ASCII rendered ~2.5× slower than emoji on the same map.
 *
 *  The glyph branch is the documented LAST RESORT for a tile with genuinely no baked image (MAP-MODEL §8:
 *  a seeded tile must never be `image_url: nil`); it is never a pre-load placeholder — the loader decodes
 *  every baked PNG before the render gate opens (tilesetLoader → preloadTileImages). */
export function tileVisual(t: TileArt): Visual {
  return t.image ? { kind: 'image', src: t.image, color: t.color, char: t.char } : { kind: 'glyph', char: t.char, color: t.color }
}

/**
 * The normalised art for a tile LABEL under a STYLE — the ONE lookup every renderer and resolver shares.
 *
 * There used to be two normalisers (`asciiTileArt` / `emojiTileArt`) behind a dispatch map keyed on the
 * style id, because the two stores held two different shapes. There is one shape now (`StyleTile`), so
 * there is one lookup and no map: a style is a set of pictures for the same labels, and a third style
 * resolves here the day the backend serves it, with no code change.
 *
 * Undefined when this style has no such label — the caller then falls back to the coarse kind. An unknown
 * style resolves nothing rather than borrowing another style's picture.
 */
export function styleTileArt(label: string, styleId: string): TileArt | undefined {
  const tile = styleTile(styleId, label)
  if (!tile) return undefined
  return { char: tile.char, color: tile.color, image: tile.image, height: tile.height, pose: tile.pose, views: tile.views }
}

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

/** Build the emoji Style's per-kind map from the ONE tile store. A Style's `map` is only a shortcut for
 *  resolving a coarse ElementKind; every actual tile resolves by LABEL through `styleTileArt`. */
function emojiStyleMap(): Partial<Record<ElementKind, Visual>> {
  const map: Partial<Record<ElementKind, Visual>> = {}
  // A tile with an `image` (a Noto PNG) renders through the wired drawImage path — kills the Segoe
  // `[?]` tofu on Unicode-13 glyphs. `color` still rides along as the geometry backing tint. Built by
  // the SAME `tileVisual` every other style/lookup uses (see below) — no bespoke emoji construction.
  for (const [label, tile] of Object.entries(styleTiles('emoji'))) {
    map[label as ElementKind] = tileVisual({ char: tile.char, color: tile.color, image: tile.image })
  }
  return map
}

/** Zero-asset, visually striking reskin — proves the mechanism with pure emoji glyphs. Built from
 *  the loaded tile store, so no art is hardcoded here. */
export const EMOJI_STYLE: Style = {
  id: 'emoji',
  name: 'Emoji',
  icon: '😀',
  map: emojiStyleMap(),
}

/** Rebuild EMOJI_STYLE.map from the loaded store — called after a tileset install (EMOJI_STYLE is a stable
 *  object; only its map is swapped). */
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


/**
 * The per-variant tile for a PERSON (npc/player) — male→`man`, old→`elder`, robot→`robot`.
 *
 * Resolves in the ACTIVE style, whichever that is. It used to read `if (style.id === 'ascii') return
 * undefined` and hardcode `emoji:${slug}` — so ascii was denied pictures the backend was serving it
 * (`/tiles/ascii/man.png` exists, and always did). That is the "one engine, N art styles" rule broken by a
 * style-name check: the question is never *which style is this*, it is *does this style have a picture for
 * this label*.
 *
 * Undefined for no variant, or a variant this style has no tile for — both fall back to the BASE figure.
 */
export function personVariantTileId(variant: EntityVariant | undefined, style: Style): string | undefined {
  if (!variant) return undefined
  const slug = getEntityResolution().variantSlug[variant]
  return slug && styleTile(style.id, slug) ? `${style.id}:${slug}` : undefined
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

// ── the style LIST is backend data ────────────────────────────────────────
/**
 * The art styles, as the BACKEND declares them (Alexander, 2026-09-08: *"styles should be backend
 * categories"*).
 *
 * A tileset row IS a style — `ascii` and `emoji` are rows in the `tilesets` table — so the list, its order,
 * and each style's display name and icon are catalog data, served on `/api/tilesets`. This used to be a
 * frontend constant (`BUILT_IN_STYLES`, §3.14a), which meant adding a style was a frontend edit: exactly
 * what the whole tile pipeline exists to avoid.
 *
 * What stays here is MECHANISM, not data: each style needs a way to look a label's art up
 * (`styleTiles`), and that is engine code. A served style with no such entry still lists and still
 * switches — every tile resolves by LABEL, so it simply renders whatever that style's tileset holds.
 */
export interface StyleInfo {
  id: string
  name: string
  icon: string
}

// Filled by `setStyleCatalog` on the tileset load. EMPTY until the backend answers — the picker then shows
// nothing rather than inventing a style list, the same honesty rule the generator menu follows.
let STYLE_CATALOG: readonly StyleInfo[] = []

/** Install the served STYLE LIST — which styles the picker offers (not their tiles; that is
 *  `setStyleCatalog` in engine/tileset/styleTiles.ts). Called by the tileset loader. */
export function setStyleList(styles: readonly StyleInfo[]): void {
  STYLE_CATALOG = styles
}

/** The styles the picker offers, in the backend's order. */
export function availableStyles(): readonly StyleInfo[] {
  return STYLE_CATALOG
}

// The per-style art LOOKUP. A style is only a different set of images, so this maps a style id to the
// Style object that resolves its visuals; the backend decides which of these are actually offered.
const STYLE_BY_ID: Readonly<Record<string, Style>> = {
  ascii: ASCII_STYLE,
  emoji: EMOJI_STYLE,
}

/**
 * Look a style up by id, defaulting to ASCII (so a bad/absent saved id can't break render).
 *
 * A style the backend serves but the engine has no art lookup for still resolves: it gets a Style with an
 * empty `map`, and every tile then renders through the LABEL→IMAGE path against that style's tileset —
 * which is the whole point of "one engine, N art styles".
 */
export function styleById(id: string | null | undefined): Style {
  if (!id) return ASCII_STYLE
  const known = STYLE_BY_ID[id]
  if (known) return known
  const served = STYLE_CATALOG.find(s => s.id === id)
  return served ? { id: served.id, name: served.name, icon: served.icon, map: {} } : ASCII_STYLE
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
  if (tileType === 'meadow') return 'meadow' // a flat colour-only meadow floor — its own baked solid tile, no clover
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

/**
 * The per-type tile for an ENEMY — goblin, wolf, bat… — in the ACTIVE style.
 *
 * Same correction as `personVariantTileId`: this used to return undefined for ascii and hardcode
 * `emoji:${slug}`, so an ascii goblin drew a generic block-figure while `/tiles/ascii/goblin.png` sat
 * unused. A style is a set of pictures for the same labels; the enemyType→slug map is backend data and the
 * slug is a LABEL, so it resolves in whatever style is active.
 *
 * Undefined for a blank/unmapped type, or one this style has no tile for (→ the base figure).
 */
export function enemyTileId(enemyType: string | undefined, style: Style): string | undefined {
  if (!enemyType) return undefined
  const slug = getEntityResolution().enemyTypeSlug[enemyType.toLowerCase()]
  return slug && styleTile(style.id, slug) ? `${style.id}:${slug}` : undefined
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
// The sidebar browses the SAME tiles the MAP renders — the one backend-loaded store
// (tilesetLoader swaps in the :4000 DB rows). NOTHING art-related is hardcoded here: a tile is BROWSEABLE
// when its loaded entry carries a browseable `category` (one of TILE_CATEGORIES); its display name is the
// entry's `title`, its art the entry's image/glyph. The per-kind seed metadata (category/label/glyph)
// lives in the backend DB now — the frontend never hardcodes it.

const BROWSEABLE_CATEGORIES: ReadonlySet<string> = new Set<TileCategory>(TILE_CATEGORIES)


/** The tiles the Library lists for a style, grouped by category — read LIVE from the loaded tileset so the
 *  sidebar ALWAYS matches the map. Only entries carrying a `category` are browseable (internal cell-labels
 *  like wall pieces / tree corners render on the map but never surface in the sidebar). */
export function tilesForStyle(styleId: string): Record<TileCategory, TileDef[]> {
  const out = Object.fromEntries(TILE_CATEGORIES.map(c => [c, [] as TileDef[]])) as Record<TileCategory, TileDef[]>
  // `extra` carries the DB tile's BLOCK height + settings so the palette tile FULLY describes the DB tile —
  // the brush then seeds a painted asset from it and a painted tile matches the generator's version. BOTH
  // styles push the same fields through the same helper: a style is only a different set of images.
  const push = (key: string, category: string | undefined, title: string | undefined, art: TileArt, settings?: Record<string, unknown>): void => {
    if (!category || !BROWSEABLE_CATEGORIES.has(category)) return
    out[category as TileCategory].push({ id: `${styleId}:${key}`, label: title ?? key, category: category as TileCategory, styleId, visual: tileVisual(art), height: art.height, settings })
  }
  // ONE loop over the style's own tiles. This used to be `if (styleId === 'emoji') … else if ('ascii') …`
  // over two differently-shaped stores — the clearest instance of the two-engines problem, since adding a
  // style meant editing this function.
  for (const [label, tile] of Object.entries(styleTiles(styleId))) {
    push(label, tile.category, tile.title, {
      char: tile.char, color: tile.color, image: tile.image, height: tile.height, pose: tile.pose, views: tile.views,
    }, tile.settings)
  }
  return out
}

/** Resolve a style-agnostic tile id (`<styleId>:<key>`) to its Visual, LIVE from the loaded tileset (null
 *  for an unknown id / a style that lacks that tile — the caller then falls back to the coarse kind).
 *  One path for every style: look the tile's normalised art up, build the Visual from it. */
export function visualForTileId(id: string): Visual | null {
  const sep = id.indexOf(':')
  if (sep < 0) return null
  const art = styleTileArt(id.slice(sep + 1), id.slice(0, sep))
  return art ? tileVisual(art) : null
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
