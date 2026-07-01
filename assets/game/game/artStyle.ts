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
  | 'grass' | 'water' | 'path' | 'plaza' | 'sand' | 'ground' // terrain
  | 'wall' | 'roof' | 'door' | 'window'                       // buildings
  | 'tree' | 'flower' | 'bush' | 'rock' | 'crate' | 'lamp'    // nature / props
  | 'enemy' | 'npc' | 'player'                                // units
  | 'mountain'

export type TileCategory = 'terrain' | 'buildings' | 'units' | 'nature'

// ── visuals ──────────────────────────────────────────────────────────────
/** Draw a char (ASCII glyph OR an emoji) with fillText. `color` is optional — an
 *  emoji ignores fill color, an ASCII glyph inherits the renderer's default when omitted. */
export interface GlyphVisual { kind: 'glyph'; char: string; color?: string }
/** Draw an image/sprite (optionally a sub-rect of an atlas) with drawImage. */
export interface ImageVisual { kind: 'image'; src: string; sx?: number; sy?: number; sw?: number; sh?: number }
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
    // terrain
    grass: { kind: 'glyph', char: '🟩' },
    water: { kind: 'glyph', char: '🟦' },
    path: { kind: 'glyph', char: '🟫' },
    plaza: { kind: 'glyph', char: '⬜' },
    sand: { kind: 'glyph', char: '🟨' },
    mountain: { kind: 'glyph', char: '🗻' },
    // buildings (facade cells reskin tile-by-tile)
    wall: { kind: 'glyph', char: '🧱' },
    roof: { kind: 'glyph', char: '🟥' },
    door: { kind: 'glyph', char: '🚪' },
    window: { kind: 'glyph', char: '🪟' },
    // nature / props
    tree: { kind: 'glyph', char: '🌲' },
    flower: { kind: 'glyph', char: '🌸' },
    bush: { kind: 'glyph', char: '🌿' },
    rock: { kind: 'glyph', char: '🪨' },
    crate: { kind: 'glyph', char: '📦' },
    lamp: { kind: 'glyph', char: '💡' },
    // units
    enemy: { kind: 'glyph', char: '👾' },
    npc: { kind: 'glyph', char: '🧑' },
    player: { kind: 'glyph', char: '🧍' },
  },
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

/** Classify a ground TILE TYPE string (grass / path_stone / water_deep / …) into a kind.
 *  Unrecognized terrain → 'ground' (unmapped → passes through to ASCII, never mis-skinned). */
export function groundKind(tileType: string): ElementKind {
  if (WATER_GROUND.test(tileType)) return 'water'
  if (PATH_GROUND.test(tileType)) return 'path'
  if (tileType.startsWith('plaza')) return 'plaza'
  if (SAND_GROUND.test(tileType)) return 'sand'
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
  water: 'water', fountain: 'water', building: 'wall',
}

/** Kind for an entity by its role. */
export function entityKind(kind: string): ElementKind {
  if (kind === 'player') return 'player'
  if (kind === 'npc') return 'npc'
  return 'enemy'
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
  grass: 'terrain', water: 'terrain', path: 'terrain', plaza: 'terrain', sand: 'terrain', ground: 'terrain', mountain: 'terrain',
  wall: 'buildings', roof: 'buildings', door: 'buildings', window: 'buildings',
  tree: 'nature', flower: 'nature', bush: 'nature', rock: 'nature', crate: 'nature', lamp: 'nature',
  enemy: 'units', npc: 'units', player: 'units',
}

const KIND_LABEL: Readonly<Record<ElementKind, string>> = {
  grass: 'Grass', water: 'Water', path: 'Path', plaza: 'Plaza', sand: 'Sand', ground: 'Ground', mountain: 'Mountain',
  wall: 'Wall', roof: 'Roof', door: 'Door', window: 'Window',
  tree: 'Tree', flower: 'Flower', bush: 'Bush', rock: 'Rock', crate: 'Crate', lamp: 'Lamp',
  enemy: 'Enemy', npc: 'NPC', player: 'Player',
}

// Explicit ASCII glyph tiles so the Library has content for the ASCII style too (its
// `map` is intentionally empty for passthrough). These mirror the engine's own glyphs.
const ASCII_TILE_GLYPHS: Partial<Record<ElementKind, string>> = {
  grass: '"', water: '≈', path: '░', plaza: '#', sand: '∴', mountain: '▲',
  wall: '█', roof: '▀', door: '╫', window: '▒',
  tree: '♣', flower: '+', bush: '*', rock: 'O', crate: '$', lamp: '!',
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

/** Every catalog tile, flat (ASCII glyph tiles + each non-ASCII style's mapped tiles). */
export const TILE_CATALOG: readonly TileDef[] = [
  ...tilesForAscii(),
  ...BUILT_IN_STYLES.filter(s => s.id !== 'ascii').flatMap(tilesFromStyle),
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
