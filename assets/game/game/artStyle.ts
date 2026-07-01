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
export type ElementKind =
  | 'grass' | 'water' | 'path' | 'plaza' | 'sand' | 'ground' | 'snow' | 'autumn' // terrain (+ seasons)
  | 'wall' | 'roof' | 'door' | 'window' | 'fountain'          // buildings
  | 'tree' | 'flower' | 'bush' | 'rock' | 'crate' | 'lamp'    // nature / props
  | 'crystal' | 'mushroom'                                     // cave features
  | 'pillar' | 'altar' | 'torch' | 'hazard' | 'key'          // temple / dungeon features
  | 'enemy' | 'npc' | 'player'                                // units
  | 'mountain'

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
 *  optional backing TINT (drawn as the diamond/cube fill under the clipped sprite). */
export interface ImageVisual { kind: 'image'; src: string; color?: string; sx?: number; sy?: number; sw?: number; sh?: number }
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

/** Zero-asset, visually striking reskin — proves the mechanism with pure emoji glyphs. */
export const EMOJI_STYLE: Style = {
  id: 'emoji',
  name: 'Emoji',
  icon: '😀',
  map: {
    // terrain — `color` is the FILL hue (harmonised with the ASCII GROUND_COLORS so the reskin reads
    // as the same world); the emoji rides FULL-CELL on top as the texture. Grass/water use a REAL
    // texture glyph (clover, wave) not a same-colour square — a colored square just vanishes into the
    // fill ("grass is just color"). Grass also keeps its per-cell shade (cellFill) so a field varies.
    grass: { kind: 'glyph', char: '🍀', color: '#5faf4a' },
    water: { kind: 'glyph', char: '🌊', color: '#4a90e2' },
    path: { kind: 'glyph', char: '🟫', color: '#9c7b4d' },
    plaza: { kind: 'glyph', char: '⬜', color: '#cabfa6' },
    sand: { kind: 'glyph', char: '🟨', color: '#e2c86b' },
    // seasons — the WHOLE ground shifts hue so a winter/autumn map doesn't read as the same green:
    // snow is a pale field, autumn an amber one with fallen leaves.
    snow: { kind: 'glyph', char: '⬜', color: '#e2ecf5' },
    autumn: { kind: 'glyph', char: '🍂', color: '#b5732f' },
    mountain: { kind: 'glyph', char: '🗻', color: '#8d8d97' },
    // buildings — `color` tints the CUBE face (roof colour on the roof faces, wall colour
    // on the walls); the facade door/window cells fill at their own hue.
    wall: { kind: 'glyph', char: '🧱', color: '#b0603a' },
    roof: { kind: 'glyph', char: '🟥', color: '#c8443c' },
    door: { kind: 'glyph', char: '🚪', color: '#5a3a22' },
    window: { kind: 'glyph', char: '🪟', color: '#7fb4d8' },
    fountain: { kind: 'glyph', char: '⛲', color: '#4a90e2' },
    // nature / props — upright billboards, `color` fills the glyph
    tree: { kind: 'glyph', char: '🌲', color: '#2f8f3f' },
    flower: { kind: 'glyph', char: '🌸', color: '#e785b5' },
    bush: { kind: 'glyph', char: '🌿', color: '#4fa03f' },
    rock: { kind: 'glyph', char: '🪨', color: '#8a8a8a' },
    crate: { kind: 'glyph', char: '📦', color: '#b5793a' },
    lamp: { kind: 'glyph', char: '💡', color: '#ffd24a' },
    // cave features — upright billboards, `color` fills the glyph (season-tinted at the site)
    crystal: { kind: 'glyph', char: '💎', color: '#b48cff' },
    mushroom: { kind: 'glyph', char: '🍄', color: '#d24a4a' },
    // temple / dungeon features — colonnade columns, the boss altar, wall torches, floor
    // hazards, and the locked-door key (season-tinted where the generator sets `color`).
    pillar: { kind: 'glyph', char: '🏛️', color: '#cbb68c' },
    altar: { kind: 'glyph', char: '🗿', color: '#ffe7a8' },
    torch: { kind: 'glyph', char: '🔥', color: '#ff8a3a' },
    hazard: { kind: 'glyph', char: '🔺', color: '#d0402a' },
    key: { kind: 'glyph', char: '🗝️', color: '#ffd24a' },
    // units — upright billboards. Every PERSON (player + npcs) uses the SAME standing-figure
    // family (🧍) and animates identically; only enemies get the monster glyph.
    enemy: { kind: 'glyph', char: '👾', color: '#b45ac0' },
    npc: { kind: 'glyph', char: '🧍', color: '#d9a066' },
    player: { kind: 'glyph', char: '🧍', color: '#ffcf3a' },
  },
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

/** The gendered form of a person glyph for an entity `variant`; a non-person or variant-less glyph
 *  (a monster, a terrain square) passes through unchanged. Data-only — the renderer just calls it. */
export function genderize(char: string, variant?: 'male' | 'female'): string {
  if (!variant) return char
  return GENDERED[char]?.[variant] ?? char
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
const SAND_GROUND = /sand|desert|dune/
const SNOW_GROUND = /snow|ice|frost/
// Polished temple/dungeon floors read as a paved plaza in the emoji reskin (⬜).
const TEMPLE_FLOOR = /temple_floor|marble|gold_tile|ancient_stone|rune_floor/

/** Classify a ground TILE TYPE string (grass / path_stone / water_deep / …) into a kind.
 *  Unrecognized terrain → 'ground' (unmapped → passes through to ASCII, never mis-skinned). */
export function groundKind(tileType: string): ElementKind {
  if (WATER_GROUND.test(tileType)) return 'water'
  if (PATH_GROUND.test(tileType)) return 'path'
  if (TEMPLE_FLOOR.test(tileType)) return 'plaza'
  if (tileType.startsWith('plaza')) return 'plaza'
  if (SAND_GROUND.test(tileType)) return 'sand'
  if (SNOW_GROUND.test(tileType)) return 'snow' // winter: snow/ice/frost — a WHITE field, not green
  if (tileType.startsWith('autumn')) return 'autumn' // autumn: amber ground + fallen leaves
  if (tileType.startsWith('grass')) return 'grass'
  return 'ground'
}

// A cell LABEL (tree_top_left / roof / door / …) → kind. Trees collapse to 'tree';
// building parts map to themselves; biome features to 'mountain'.
const LABEL_KIND: Readonly<Record<string, ElementKind>> = {
  roof_top: 'roof', roof: 'roof', wall: 'wall', door: 'door', window: 'window',
  mountain: 'mountain', peak: 'mountain',
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
  // cave props — walls + rubble read as rock; crystals + mushrooms get their own tint.
  cave_decor: 'rock', crystal: 'crystal', mushroom: 'mushroom',
  // temple props — walls read as wall; the colonnade/altar/torch/hazard/key get their own kinds
  // (a brazier reuses the torch flame).
  temple_wall: 'wall', pillar: 'pillar', altar: 'altar', torch: 'torch', brazier: 'torch',
  hazard: 'hazard', key: 'key',
}

/** Kind for an entity by its role. */
export function entityKind(kind: string): ElementKind {
  if (kind === 'player') return 'player'
  if (kind === 'npc') return 'npc'
  return 'enemy'
}

/** enemyType → catalog tile id, so a wolf draws 🐺 and a skeleton 💀 instead of every enemy sharing the
 *  generic 👾. Keyed on the lowercase enemyType tag. Unmapped types fall back to the plain 👾 enemy. */
export const ENEMY_TILE_BY_TYPE: Readonly<Record<string, string>> = {
  goblin: 'emoji:goblin', wolf: 'emoji:wolf', bandit: 'emoji:ninja', skeleton: 'emoji:skeleton',
  bat: 'emoji:bat', spider: 'emoji:spider', guardian: 'emoji:troll', wraith: 'emoji:ghost',
  orc: 'emoji:ogre', ogre: 'emoji:ogre', ghost: 'emoji:ghost', zombie: 'emoji:zombie',
  vampire: 'emoji:vampire', dragon: 'emoji:dragon', troll: 'emoji:troll', slime: 'emoji:alien',
}

/** The per-type tile OVERRIDE for an enemy under a reskin style — so goblin→👺, wolf→🐺, etc. Returns
 *  undefined for ASCII (its enemies stay block-figures) and for unmapped/blank types (→ the base 👾). */
export function enemyTileId(enemyType: string | undefined, style: Style): string | undefined {
  if (style.id === 'ascii' || !enemyType) return undefined
  return ENEMY_TILE_BY_TYPE[enemyType.toLowerCase()]
}

/** LANDMARK building types render as their own big emoji under a reskin (a castle looks like 🏰, a
 *  cathedral ⛪, a temple 🏛️, a manor 🏘️) — so temple/manor/castle/cathedral read distinctly instead of
 *  four identical brick boxes. Houses/stores/hospitals keep the 3D brick structure (they read fine). */
export const BUILDING_LANDMARK_EMOJI: Readonly<Record<string, string>> = {
  temple: '🏛️',
  'big-house': '🏘️',
  castle: '🏰',
  cathedral: '⛪',
}

/** The landmark emoji for a building type under a reskin, or undefined (ASCII, or a non-landmark type
 *  that keeps its structure). */
export function buildingLandmarkEmoji(type: string, style: Style): string | undefined {
  if (style.id === 'ascii') return undefined
  return BUILDING_LANDMARK_EMOJI[type]
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
  grass: 'terrain', water: 'terrain', path: 'terrain', plaza: 'terrain', sand: 'terrain', ground: 'terrain', mountain: 'terrain', snow: 'terrain', autumn: 'terrain',
  wall: 'buildings', roof: 'buildings', door: 'buildings', window: 'buildings', fountain: 'buildings',
  pillar: 'buildings', altar: 'buildings',
  tree: 'nature', flower: 'nature', bush: 'nature', rock: 'nature', crate: 'nature', lamp: 'nature',
  crystal: 'nature', mushroom: 'nature', torch: 'nature', hazard: 'nature', key: 'nature',
  enemy: 'units', npc: 'units', player: 'units',
}

const KIND_LABEL: Readonly<Record<ElementKind, string>> = {
  grass: 'Grass', water: 'Water', path: 'Path', plaza: 'Plaza', sand: 'Sand', ground: 'Ground', mountain: 'Mountain', snow: 'Snow', autumn: 'Autumn Ground',
  wall: 'Wall', roof: 'Roof', door: 'Door', window: 'Window', fountain: 'Fountain',
  pillar: 'Pillar', altar: 'Altar',
  tree: 'Tree', flower: 'Flower', bush: 'Bush', rock: 'Rock', crate: 'Crate', lamp: 'Lamp',
  crystal: 'Crystal', mushroom: 'Mushroom', torch: 'Torch', hazard: 'Hazard', key: 'Key',
  enemy: 'Enemy', npc: 'NPC', player: 'Player',
}

// Explicit ASCII glyph tiles so the Library has content for the ASCII style too (its
// `map` is intentionally empty for passthrough). These mirror the engine's own glyphs.
const ASCII_TILE_GLYPHS: Partial<Record<ElementKind, string>> = {
  grass: '"', water: '≈', path: '░', plaza: '#', sand: '∴', mountain: '▲',
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
  return { id: `emoji:${slug}`, label, category, styleId: 'emoji', visual: { kind: 'glyph', char, color } }
}

/**
 * The FULL, categorized + labeled emoji tileset the Library browses — every tree, every
 * building, every terrain, every character, each with a clear human label. This is what makes
 * the Library read like a real tileset instead of the sparse one-per-kind starter map. These
 * are catalog/override tiles only (they don't touch EMOJI_STYLE.map, so render is unchanged);
 * they surface in `tilesForStyle('emoji')` and can be pinned per-element via `visualForTileId`.
 */
export const EMOJI_TILES: TileDef[] = [
  // ── terrain — grounds, water, and the biome extremes (square/round + landform glyphs) ──
  emojiTile('terrain', 'grass-field', 'Grass', '🍀', '#5faf4a'),
  emojiTile('terrain', 'dark-grass', 'Dark Grass', '🌿', '#3c7a2f'),
  emojiTile('terrain', 'shallow-water', 'Shallow Water', '🌊', '#4a90e2'),
  emojiTile('terrain', 'deep-water', 'Deep Water', '🔵', '#1c5fa8'),
  emojiTile('terrain', 'beach-sand', 'Sand', '🟨', '#e2c86b'),
  emojiTile('terrain', 'desert', 'Desert', '🏜️', '#d9b45f'),
  emojiTile('terrain', 'dirt-path', 'Dirt Path', '🟫', '#9c7b4d'),
  emojiTile('terrain', 'gravel', 'Gravel', '🟤', '#7c6a52'),
  emojiTile('terrain', 'cobblestone', 'Cobblestone', '⬜', '#b9b2a3'),
  emojiTile('terrain', 'snowflake', 'Snowflake', '❄️', '#eaf4ff'),
  emojiTile('terrain', 'ice', 'Ice', '🧊', '#a8d8f0'),
  emojiTile('terrain', 'lava', 'Lava', '🟥', '#d0402a'),
  emojiTile('terrain', 'volcano', 'Volcano', '🌋', '#b5372a'),
  emojiTile('terrain', 'mountain-slope', 'Mountain', '⛰️', '#8d8d97'),
  emojiTile('terrain', 'snowy-peak', 'Snowy Peak', '🏔️', '#cfd8e3'),

  // ── nature — ALL trees, plants, flowers, and ground props/items ──
  emojiTile('nature', 'pine-tree', 'Pine Tree', '🌲', '#2f8f3f'),
  emojiTile('nature', 'oak-tree', 'Oak Tree', '🌳', '#4caf50'),
  emojiTile('nature', 'palm-tree', 'Palm Tree', '🌴', '#4f9d5a'),
  emojiTile('nature', 'sapling', 'Sapling', '🌱', '#7cc36a'),
  emojiTile('nature', 'dead-tree', 'Dead Tree', '🪾', '#8a6f4a'),
  emojiTile('nature', 'cactus', 'Cactus', '🌵', '#4a8f3f'),
  emojiTile('nature', 'shrub', 'Shrub', '🌿', '#4fa03f'),
  emojiTile('nature', 'shamrock', 'Shamrock', '☘️', '#3fa03f'),
  emojiTile('nature', 'clover', 'Four-Leaf Clover', '🍀', '#3c9a3a'),
  emojiTile('nature', 'cherry-blossom', 'Cherry Blossom', '🌸', '#e785b5'),
  emojiTile('nature', 'tulip', 'Tulip', '🌷', '#e05a7a'),
  emojiTile('nature', 'rose', 'Rose', '🌹', '#d13b3b'),
  emojiTile('nature', 'hibiscus', 'Hibiscus', '🌺', '#e5527a'),
  emojiTile('nature', 'sunflower', 'Sunflower', '🌻', '#f2c33a'),
  emojiTile('nature', 'blossom', 'Blossom', '🌼', '#f2d84a'),
  emojiTile('nature', 'bouquet', 'Bouquet', '💐', '#e57ba0'),
  emojiTile('nature', 'wilted-flower', 'Wilted Flower', '🥀', '#9c6a7a'),
  emojiTile('nature', 'red-mushroom', 'Red Mushroom', '🍄', '#d24a4a'),
  emojiTile('nature', 'boulder', 'Boulder', '🪨', '#8a8a8a'),
  emojiTile('nature', 'wood-log', 'Wood Log', '🪵', '#a9793f'),
  emojiTile('nature', 'wheat', 'Wheat', '🌾', '#d9b25f'),
  emojiTile('nature', 'fallen-leaf', 'Fallen Leaf', '🍂', '#c8742f'),
  emojiTile('nature', 'maple-leaf', 'Maple Leaf', '🍁', '#d0552a'),
  emojiTile('nature', 'coral', 'Coral', '🪸', '#e06a5a'),
  emojiTile('nature', 'seashell', 'Seashell', '🐚', '#f0c8a8'),
  emojiTile('nature', 'potted-plant', 'Potted Plant', '🪴', '#5a9a4a'),
  // ── animals — livestock, woodland critters, birds + bugs (a living world, not just plants) ──
  emojiTile('nature', 'cow', 'Cow', '🐄', '#c9b8a8'),
  emojiTile('nature', 'sheep', 'Sheep', '🐑', '#e8e4dc'),
  emojiTile('nature', 'pig', 'Pig', '🐖', '#e59ab0'),
  emojiTile('nature', 'goat', 'Goat', '🐐', '#b8a888'),
  emojiTile('nature', 'horse', 'Horse', '🐎', '#a9793f'),
  emojiTile('nature', 'chicken', 'Chicken', '🐓', '#d8663a'),
  emojiTile('nature', 'rabbit', 'Rabbit', '🐇', '#d8cbb8'),
  emojiTile('nature', 'deer', 'Deer', '🦌', '#a9763f'),
  emojiTile('nature', 'fox', 'Fox', '🦊', '#e0863a'),
  emojiTile('nature', 'grey-wolf', 'Grey Wolf', '🐺', '#8a8f9a'),
  emojiTile('nature', 'boar', 'Boar', '🐗', '#7a6a5a'),
  emojiTile('nature', 'bear', 'Bear', '🐻', '#8a5f3a'),
  emojiTile('nature', 'squirrel', 'Squirrel', '🐿️', '#b5793a'),
  emojiTile('nature', 'hedgehog', 'Hedgehog', '🦔', '#a98f6a'),
  emojiTile('nature', 'turtle', 'Turtle', '🐢', '#4f8f5a'),
  emojiTile('nature', 'frog', 'Frog', '🐸', '#5fa03f'),
  emojiTile('nature', 'snail', 'Snail', '🐌', '#c8a06a'),
  emojiTile('nature', 'bird', 'Bird', '🐦', '#5a8fc8'),
  emojiTile('nature', 'owl', 'Owl', '🦉', '#a98f6a'),
  emojiTile('nature', 'duck', 'Duck', '🦆', '#6a8f4a'),
  emojiTile('nature', 'dove', 'Dove', '🕊️', '#e8e8e8'),
  emojiTile('nature', 'butterfly', 'Butterfly', '🦋', '#6a9ad8'),
  emojiTile('nature', 'honeybee', 'Honeybee', '🐝', '#e5b53a'),
  emojiTile('nature', 'ladybug', 'Ladybug', '🐞', '#d13b3b'),
  emojiTile('nature', 'cat', 'Cat', '🐈', '#c8964a'),
  emojiTile('nature', 'dog', 'Dog', '🐕', '#b5854a'),

  // ── buildings — ALL of them: homes, civic, worship, defensive, and building parts ──
  emojiTile('buildings', 'house', 'House', '🏠', '#c8443c'),
  emojiTile('buildings', 'house-garden', 'House with Garden', '🏡', '#b5793a'),
  emojiTile('buildings', 'houses', 'Houses', '🏘️', '#c86b4d'),
  emojiTile('buildings', 'derelict-house', 'Derelict House', '🏚️', '#8a7a5f'),
  emojiTile('buildings', 'office-building', 'Office Building', '🏢', '#7f8c9a'),
  emojiTile('buildings', 'department-store', 'Department Store', '🏬', '#b05a8a'),
  emojiTile('buildings', 'convenience-store', 'Convenience Store', '🏪', '#4a9ac8'),
  emojiTile('buildings', 'hospital', 'Hospital', '🏥', '#e05a5a'),
  emojiTile('buildings', 'bank', 'Bank', '🏦', '#6a8f5a'),
  emojiTile('buildings', 'hotel', 'Hotel', '🏨', '#c89a4a'),
  emojiTile('buildings', 'school', 'School', '🏫', '#d0a83a'),
  emojiTile('buildings', 'classical-building', 'Classical Building', '🏛️', '#cbb68c'),
  emojiTile('buildings', 'castle', 'Castle', '🏰', '#9a8a7a'),
  emojiTile('buildings', 'japanese-castle', 'Japanese Castle', '🏯', '#d9c8a8'),
  emojiTile('buildings', 'church', 'Church', '⛪', '#b0a89a'),
  emojiTile('buildings', 'mosque', 'Mosque', '🕌', '#8aa88a'),
  emojiTile('buildings', 'tower', 'Tower', '🗼', '#d0553a'),
  emojiTile('buildings', 'torii-gate', 'Torii Gate', '⛩️', '#d0402a'),
  emojiTile('buildings', 'tent', 'Tent', '⛺', '#7a9a5a'),
  emojiTile('buildings', 'factory', 'Factory', '🏭', '#8a8a8a'),
  emojiTile('buildings', 'brick', 'Brick', '🧱', '#b0603a'),
  emojiTile('buildings', 'wooden-door', 'Wooden Door', '🚪', '#5a3a22'),
  emojiTile('buildings', 'glass-window', 'Glass Window', '🪟', '#7fb4d8'),
  emojiTile('buildings', 'stadium', 'Stadium', '🏟️', '#9a9a8a'),

  // ── units — characters + monsters (the animation frame picker draws from here) ──
  emojiTile('units', 'person', 'Person', '🧍', '#d9a066'),
  emojiTile('units', 'man', 'Man', '🧍‍♂️', '#6a8fd9'),
  emojiTile('units', 'woman', 'Woman', '🧍‍♀️', '#d96a9a'),
  emojiTile('units', 'adult', 'Adult', '🧑', '#d9a066'),
  emojiTile('units', 'boy', 'Boy', '👦', '#e0b060'),
  emojiTile('units', 'girl', 'Girl', '👧', '#e5a0b0'),
  emojiTile('units', 'old-man', 'Old Man', '👴', '#c8c8c8'),
  emojiTile('units', 'old-woman', 'Old Woman', '👵', '#d0c0c8'),
  emojiTile('units', 'mage', 'Mage', '🧙', '#7a5ac0'),
  emojiTile('units', 'wizard', 'Wizard', '🧙‍♂️', '#6a4ab0'),
  emojiTile('units', 'witch', 'Witch', '🧙‍♀️', '#9a5ac0'),
  emojiTile('units', 'elf', 'Elf', '🧝', '#6ac07a'),
  emojiTile('units', 'ninja', 'Ninja', '🥷', '#3a3a4a'),
  emojiTile('units', 'guard', 'Guard', '💂', '#c8443c'),
  emojiTile('units', 'prince', 'Prince', '🤴', '#d0a83a'),
  emojiTile('units', 'princess', 'Princess', '👸', '#e585b5'),
  emojiTile('units', 'police-officer', 'Police Officer', '👮', '#4a6ac0'),
  emojiTile('units', 'construction-worker', 'Construction Worker', '👷', '#e5b03a'),
  emojiTile('units', 'vampire', 'Vampire', '🧛', '#8a4a6a'),
  emojiTile('units', 'zombie', 'Zombie', '🧟', '#6a8f5a'),
  emojiTile('units', 'troll', 'Troll', '🧌', '#7a6a4a'),
  emojiTile('units', 'goblin', 'Goblin', '👺', '#c8443c'),
  emojiTile('units', 'ogre', 'Ogre', '👹', '#d0402a'),
  emojiTile('units', 'ghost', 'Ghost', '👻', '#e0e0f0'),
  emojiTile('units', 'skeleton', 'Skeleton', '💀', '#e8e8e8'),
  emojiTile('units', 'skull', 'Skull', '☠️', '#d8d8d8'),
  emojiTile('units', 'alien', 'Alien', '👾', '#b45ac0'),
  emojiTile('units', 'pumpkin', 'Jack-o-Lantern', '🎃', '#e5842a'),
  emojiTile('units', 'dragon', 'Dragon', '🐉', '#4a9a5a'),
  emojiTile('units', 'wolf', 'Wolf', '🐺', '#8a8a9a'),
  emojiTile('units', 'bat', 'Bat', '🦇', '#5a4a5a'),
  emojiTile('units', 'spider', 'Spider', '🕷️', '#3a3a3a'),
]

/** Every catalog tile, flat (ASCII glyph tiles + each non-ASCII style's mapped tiles + the
 *  full curated emoji tileset above). */
export const TILE_CATALOG: readonly TileDef[] = [
  ...tilesForAscii(),
  ...BUILT_IN_STYLES.filter(s => s.id !== 'ascii').flatMap(tilesFromStyle),
  ...EMOJI_TILES,
]

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
