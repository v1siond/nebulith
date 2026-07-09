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
