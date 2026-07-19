/**
 * SEASON palettes for Nebulith stages.
 *
 * A "zone" is now a SEASON — spring (default), summer, autumn, winter — driving the
 * stage's ground + the seasonal tint of trees/nature (see cellTileset.ts). The type
 * is still named `ZoneId` (the generator/editor speak "zone"); the values are seasons.
 */

export type ZoneId = 'spring' | 'summer' | 'autumn' | 'winter' | 'desert' | 'beach' | 'lava'

export const DEFAULT_ZONE: ZoneId = 'spring'

export interface ZonePalette {
  id: ZoneId
  /** Ground tile types for this season (index 0 is the default fill, 1 the accent). */
  groundTypes: string[]
  /** The "water" equivalent hazard tile for this season (winter = walkable ice). */
  hazard: string
  wallColor: string
  accentColor: string
}

export const ZONE_PALETTES: Record<ZoneId, ZonePalette> = {
  spring: {
    id: 'spring',
    groundTypes: ['grass', 'grass_tall', 'grass'],
    hazard: 'water',
    wallColor: '#6a5a3a',
    accentColor: '#ff9ecf', // blossom pink
  },
  summer: {
    id: 'summer',
    groundTypes: ['grass', 'grass_tall', 'grass'],
    hazard: 'water',
    wallColor: '#5a4a30',
    accentColor: '#2e8b2e', // deep green
  },
  autumn: {
    id: 'autumn',
    groundTypes: ['autumn_ground', 'autumn_leaves', 'autumn_ground'],
    hazard: 'water',
    wallColor: '#6a4a28',
    accentColor: '#d2691e', // amber
  },
  winter: {
    id: 'winter',
    groundTypes: ['snow', 'ice', 'frost'],
    hazard: 'ice_water', // ice is walkable (skate/swim later)
    wallColor: '#3a5a7a',
    accentColor: '#a0e0ff', // frost blue
  },
  desert: {
    id: 'desert',
    groundTypes: ['sand', 'sand_dune', 'sand'],
    hazard: 'water', // rare oasis
    wallColor: '#b89a5a', // sandstone
    accentColor: '#e8c97a', // sunlit dune
  },
  beach: {
    id: 'beach',
    groundTypes: ['sand', 'sand_dune', 'sand'],
    hazard: 'water', // the sea
    wallColor: '#c2a878',
    accentColor: '#7fd0c0', // sea-foam
  },
  lava: {
    id: 'lava',
    groundTypes: ['ash', 'rock', 'basalt'],
    hazard: 'lava', // molten — always blocks
    wallColor: '#4a4038',
    accentColor: '#ff7a30', // ember
  },
}

/** The tree tile a zone's foliage uses — so a season reads at a glance: pink blossoms in spring, deep
 *  green in summer, amber maple in autumn, bare grey in winter, cactus in the desert, palms on a beach.
 *  Emoji can't be tinted, so the SEASON PICKS A DIFFERENT TREE TILE (stamped as the tree's tileOverride
 *  by the generator) instead of recolouring one green 🌲. Ids point at the Tile Library catalog. */
export const ZONE_TREE_TILE: Record<ZoneId, string> = {
  spring: 'emoji:cherry-blossom', // 🌸
  summer: 'emoji:oak-tree', // 🌳 deep green
  autumn: 'emoji:maple-leaf', // 🍁 amber
  winter: 'emoji:dead-tree', // 🪾 bare
  desert: 'emoji:cactus', // 🌵
  beach: 'emoji:palm-tree', // 🌴
  lava: 'emoji:dead-tree', // 🪾 scorched
}

/** The subtle floor-litter tile a zone scatters (was ASCII specks that drew as ugly dark boxes in the
 *  emoji style). A small zone-appropriate accent instead — blossoms in spring, dry wheat in the desert,
 *  a snowflake in winter. Stamped as the ground_decor's tileOverride by the generator. */
export const ZONE_DECOR_TILE: Record<ZoneId, string> = {
  spring: 'emoji:blossom', // 🌼
  summer: 'emoji:clover', // 🍀
  autumn: 'emoji:fallen-leaf', // 🍂
  winter: 'emoji:snowflake', // ❄️
  desert: 'emoji:wheat', // 🌾 dry grass
  beach: 'emoji:seashell', // 🐚
  lava: 'emoji:boulder', // 🪨 scorched stone
}

/** The flower a zone scatters — the palette's curated bloom, one per season. Only spring/summer
 *  actually flower today (see FLOWERS_BY_ZONE in stageGenerator); the other zones map too so any
 *  stray bloom still lands on a real catalog tile instead of the generic 🌸. Stamped as the flower's
 *  tileOverride by the generator. */
export const ZONE_FLOWER_TILE: Record<ZoneId, string> = {
  spring: 'emoji:tulip', // 🌷
  summer: 'emoji:sunflower', // 🌻
  autumn: 'emoji:rose', // 🌹 deep red
  winter: 'emoji:blossom', // 🌼 rare
  desert: 'emoji:hibiscus', // 🌺
  beach: 'emoji:hibiscus', // 🌺
  lava: 'emoji:wilted-flower', // 🥀
}

// ── generated-prop skin dispatch ──────────────────────────────────────────
/** Roles whose curated catalog tile is the SAME in every zone — a boulder is a boulder. */
const CONSTANT_ROLE_TILE: Readonly<Record<string, string>> = {
  rock: 'emoji:boulder', // 🪨
  bush: 'emoji:shrub', // 🌿 (no generator prop emits type 'bush' today — wired for palette/brush parity + OCP)
  mushroom: 'emoji:red-mushroom', // 🍄
}

/** Roles whose curated catalog tile varies by zone (season) — each points at a per-zone table above. */
const ZONAL_ROLE_TILE: Readonly<Record<string, Record<ZoneId, string>>> = {
  tree: ZONE_TREE_TILE,
  flower: ZONE_FLOWER_TILE,
  ground_decor: ZONE_DECOR_TILE,
}

/** The curated-catalog `tileOverride` a generated prop of `propType` wears in `zone` — so the map
 *  RANDOMIZER pins the SAME Tile Library tiles the palette brush does (per zone/role) instead of the
 *  ~40 generic per-kind EMOJI_TILESET fallbacks. Undefined for props with no curated role (buildings,
 *  water, temple/cave furniture, biome features) — those keep their existing tile. Dispatch-table
 *  lookup (OCP: add a role by adding a row, no branching). VISUAL-ONLY — collision/height are unchanged
 *  by the override. Pure. */
export function stagePropTileOverride(zone: ZoneId, propType: string): string | undefined {
  return ZONAL_ROLE_TILE[propType]?.[zone] ?? CONSTANT_ROLE_TILE[propType]
}

// ── generated-STAGE palette + prop DATA (single source of truth) ─────────────
// The generator (stageGenerator.ts) READS every table below instead of baking hex /
// glyph literals inline. All the scattered colour/prop tables it used to hold live here
// now — one place per zone — so a zone's look is edited in ONE file. (The true model
// end-state is these palettes living in the Nebulith backend; see docs.)

/** A walkable FLOWER variant — its glyph + base colour (the generator tints each per-cell). */
export interface FlowerKind {
  char: string
  color: string
}

// SPRING bursts into many shapes + colours (a meadow in bloom); SUMMER keeps a smaller,
// deeper-toned set. Zones absent from ZONE_FLOWERS don't flower.
const SPRING_FLOWERS: ReadonlyArray<FlowerKind> = [
  { char: '✿', color: '#ff8fc8' }, // pink bloom
  { char: '❀', color: '#ffd24a' }, // buttercup
  { char: '✾', color: '#c89bff' }, // lilac
  { char: '❁', color: '#ff7a7a' }, // poppy
  { char: '✽', color: '#ffffff' }, // daisy
  { char: '❋', color: '#7ad0ff' }, // bluebell
]
const SUMMER_FLOWERS: ReadonlyArray<FlowerKind> = [
  { char: '*', color: '#ff88cc' },
  { char: '✿', color: '#ffd24a' },
]
/** Fallback bloom set for a zone with no curated list — a stray bloom still lands on a real variant. */
export const DEFAULT_FLOWERS: ReadonlyArray<FlowerKind> = SUMMER_FLOWERS
/** The flower variants a zone scatters. Only spring/summer flower today; others fall back to DEFAULT_FLOWERS. */
export const ZONE_FLOWERS: Partial<Record<ZoneId, ReadonlyArray<FlowerKind>>> = {
  spring: SPRING_FLOWERS,
  summer: SUMMER_FLOWERS,
}

// The living-tree SHAPE variants the generator scatters (Alexander: "randomize trees composition … small
// trees, long trees … circle forms … a variant without trunk to simulate bushes"). Each is a backend
// COMPOSITION (2 tiles; a bush is 1); the per-tree COLOUR is a separate canopy shade. Weighted so standard
// trees dominate and the rarer forms (tall/round/stub/bush) accent — a believable mixed stand, never a
// monoculture. Adding a shape = one row here.
export type LivingTreeKind = 'tree' | 'tree_tall' | 'tree_stub' | 'tree_round' | 'bush' | 'bush_round'

export const LIVING_TREE_VARIANTS: ReadonlyArray<{ kind: LivingTreeKind; weight: number }> = [
  { kind: 'tree', weight: 32 },
  { kind: 'tree_tall', weight: 22 },
  { kind: 'tree_round', weight: 20 },
  { kind: 'tree_stub', weight: 12 },
  { kind: 'bush', weight: 8 },
  { kind: 'bush_round', weight: 6 },
]
export const LIVING_TREE_WEIGHT = LIVING_TREE_VARIANTS.reduce((sum, v) => sum + v.weight, 0)

/** Tonal rock shades (+ a little char texture at the call site) so cave/arena walls aren't one flat grey. */
export const ROCK_SHADES: ReadonlyArray<string> = ['#3a3340', '#332e3a', '#443b50', '#2c2832', '#3d3543']

/** Non-blocking cave-floor decor glyphs — stalagmite / slim / rubble / pebbles. */
export const CAVE_DECOR: ReadonlyArray<string> = ['ʌ', '∧', '∴', '·']

/** Cave mushroom cap tones (red / tan / pink toadstools). */
export const MUSHROOM_TONES: ReadonlyArray<string> = ['#d24a4a', '#c98a52', '#e0a0c0']

/** Structural-prop art (glyph + default colour) for the temple / arena furniture makers. Per-zone tints
 *  (pillar / altar / torch) come from TEMPLE_PALETTES; the colour here is the fallback a maker uses when no
 *  zone tint is passed (the season-neutral arena). */
export type StructuralProp = 'pillar' | 'brazier' | 'altar' | 'torch'
export interface PropArt {
  char: string
  color: string
}
export const PROP_ART: Readonly<Record<StructuralProp, PropArt>> = {
  pillar: { char: '║', color: '#cbb68c' },
  brazier: { char: 'Φ', color: '#ff8a3a' },
  altar: { char: '‡', color: '#ffe7a8' },
  torch: { char: 'ϯ', color: '#ff9a3a' }, // colour always overridden by the zone temple palette's torch tint
}

// ── temple (a real SEASONAL DUNGEON) palette ─────────────────────────────────
export interface TemplePalette {
  /** main paved dungeon floor tile. */
  floor: string
  /** checker-inlay accent tile (the ornate tiled look). */
  accent: string
  /** tonal wall colours — the stone boundary + inner walls, varied per cell (disjoint per season). */
  wall: readonly string[]
  /** colonnade pillar colour. */
  pillar: string
  /** wall-torch flame colour. */
  torch: string
  /** boss-altar glow colour. */
  altar: string
  /** seasonal hazard-pool terrain (water / walkable ice / molten lava / desert sand-trap). */
  pool: string
  /** water/lava/sand-trap block; frozen ice is walkable. */
  poolBlocks: boolean
  /** spike-trap glyph + colour (a non-blocking floor hazard). */
  spikeChar: string
  spikeColor: string
}

// Open/Closed: add a season → add a row. Each season has a DISTINCT floor tile + wall
// palette + hazard, so ≥3 seasons always render as clearly different temples.
export const TEMPLE_PALETTES: Readonly<Record<ZoneId, TemplePalette>> = {
  spring: { floor: 'temple_floor', accent: 'cave_moss', wall: ['#5b6a52', '#53614b', '#4c5945', '#616e58'], pillar: '#b9c6a6', torch: '#ffb24a', altar: '#d8f0b0', pool: 'water', poolBlocks: true, spikeChar: '▲', spikeColor: '#6a9f4a' },
  summer: { floor: 'ancient_stone', accent: 'marble', wall: ['#7a736a', '#6f6860', '#847c72', '#655f57'], pillar: '#e6ddc8', torch: '#ff9a3a', altar: '#ffe7a8', pool: 'water', poolBlocks: true, spikeChar: '▲', spikeColor: '#c0402a' },
  autumn: { floor: 'ancient_stone', accent: 'gold_tile', wall: ['#6a5540', '#5f4c3a', '#74604a', '#544433'], pillar: '#d8c090', torch: '#ff8a3a', altar: '#ffcf8a', pool: 'water', poolBlocks: true, spikeChar: '▲', spikeColor: '#b5602a' },
  winter: { floor: 'frost', accent: 'ice', wall: ['#5a6a7a', '#647486', '#516070', '#6d7d8e'], pillar: '#bcd6e6', torch: '#8fd0ff', altar: '#dff0ff', pool: 'ice_water', poolBlocks: false, spikeChar: '❆', spikeColor: '#bfe8f5' },
  desert: { floor: 'sandstone', accent: 'sand', wall: ['#b08a52', '#c2975c', '#9c7a46', '#b89060'], pillar: '#e2c88a', torch: '#ffc24a', altar: '#ffe6a0', pool: 'sand_trap', poolBlocks: true, spikeChar: '▲', spikeColor: '#c99a52' },
  beach: { floor: 'sandstone', accent: 'temple_floor', wall: ['#9a8a6a', '#a89a78', '#8a7c5e', '#b0a284'], pillar: '#d8c9a4', torch: '#ffb86a', altar: '#ffe6c0', pool: 'water', poolBlocks: true, spikeChar: '▲', spikeColor: '#a8926a' },
  lava: { floor: 'basalt', accent: 'obsidian', wall: ['#2e2824', '#3a322c', '#241f1c', '#332b26'], pillar: '#8a6a52', torch: '#ff5a1f', altar: '#ff9a5a', pool: 'lava', poolBlocks: true, spikeChar: '▲', spikeColor: '#ff6a2a' },
}

// ── cave (a real SEASONAL cavern) palette ────────────────────────────────────
export interface CavePalette {
  /** base cave-floor ground tile (a GROUND_COLORS key that renders in the live engine). */
  floor: string
  /** patchy floor accent (moss / fallen leaves / dune / ash). */
  accent: string
  /** fraction of floor cells that take the accent — how mossy/leafy the cave reads. */
  accentChance: number
  /** tonal wall colours — the rock boundary + internal formations, varied per cell. */
  wall: readonly string[]
  /** the season's pool terrain (water / walkable ice / molten lava). */
  pool: string
  /** water + lava block; frozen ice is walkable. */
  poolBlocks: boolean
  /** crystal-cluster tint. */
  crystal: string
  /** damp seasons grow a fungi patch; arid/frozen/molten ones don't. */
  mushrooms: boolean
}

// Open/Closed: add a season → add a row. Each season has a DISTINCT floor tile + wall
// palette + pool + crystal, so ≥3 seasons always render as clearly different caves.
export const CAVE_PALETTES: Readonly<Record<ZoneId, CavePalette>> = {
  spring: { floor: 'cave_floor', accent: 'cave_moss', accentChance: 0.14, wall: ['#4c4a44', '#565248', '#42403a', '#514d46'], pool: 'water', poolBlocks: true, crystal: '#e79ec8', mushrooms: true },
  summer: { floor: 'cave_floor', accent: 'cave_moss', accentChance: 0.24, wall: ['#46493f', '#3f463a', '#4e5145', '#3a3f36'], pool: 'water', poolBlocks: true, crystal: '#5fd0e0', mushrooms: true },
  autumn: { floor: 'cave_floor', accent: 'autumn_leaves', accentChance: 0.16, wall: ['#5a4a38', '#6a5540', '#4e4030', '#5f4c3a'], pool: 'water', poolBlocks: true, crystal: '#e0a020', mushrooms: true },
  winter: { floor: 'frost', accent: 'ice', accentChance: 0.2, wall: ['#5a6a7a', '#647486', '#516070', '#6d7d8e'], pool: 'ice_water', poolBlocks: false, crystal: '#bfe8f5', mushrooms: false },
  desert: { floor: 'sand', accent: 'sandstone', accentChance: 0.2, wall: ['#b08a52', '#c2975c', '#9c7a46', '#b89060'], pool: 'water', poolBlocks: true, crystal: '#e8c060', mushrooms: false },
  beach: { floor: 'sand', accent: 'cave_floor', accentChance: 0.16, wall: ['#9a8a6a', '#a89a78', '#8a7c5e', '#b0a284'], pool: 'water', poolBlocks: true, crystal: '#7fd0c0', mushrooms: false },
  lava: { floor: 'basalt', accent: 'ash', accentChance: 0.22, wall: ['#2e2824', '#3a322c', '#241f1c', '#332b26'], pool: 'lava', poolBlocks: true, crystal: '#ff7a30', mushrooms: false },
}
