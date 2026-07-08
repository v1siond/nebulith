/**
 * TILE-PLACEMENT ROUTING — the pure decision layer behind the editor's Minecraft-style
 * "pick a tile, click to place it" brush. Given a catalog TileDef (the SAME tiles the Tile
 * Library browses via tilesForStyle), it answers three questions the page's brush needs:
 *
 *   1. placementFor(tile)      → WHICH primitive places it (terrain / asset / entity).
 *   2. assetTypeForTile(tile)  → the GridAsset `type` a nature/building tile stamps as
 *                                (drives collision default, tree height, the fallback draw).
 *   3. entityKindForUnitSlug   → which entity kind a `units` tile becomes (player/npc/enemy).
 *
 * The tile's VISUAL is pinned separately via `tileOverride = tile.id`, so the exact catalog
 * tile always renders regardless of the base kind/type this module picks. Kept pure + here so
 * the routing is unit-testable without the React page.
 */
import type { TileCategory, TileDef } from '@/game/artStyle'

/** How an armed tile lands on the map. */
export type PlacementKind = 'terrain' | 'asset' | 'entity'

/** The slug portion of a tile id ('emoji:pine-tree' → 'pine-tree', 'ascii:grass' → 'grass'). */
export function tileSlug(id: string): string {
  const i = id.indexOf(':')
  return i < 0 ? id : id.slice(i + 1)
}

// `units`-category ids that are combat FX / projectiles, NOT placeable figures. They fall back to
// a decoration asset (pinned to the tile) instead of spawning a nonsensical entity.
const NON_ENTITY_UNIT = new Set<string>([
  'arrow', 'bullet', 'dart',
  'fire-slash', 'ice-slash', 'cleave', 'bolt', 'piercing-shot',
  'nova', 'lightning', 'heal-glow', 'guard-flash',
])

// `units` slugs that are PEOPLE → an NPC (everything else in units becomes an enemy). 'player' is
// handled first (its own kind); the FX slugs above never reach here.
const PERSON_SLUGS = new Set<string>([
  'npc', 'person', 'man', 'woman', 'adult', 'boy', 'girl', 'old-man', 'old-woman', 'elder', 'child',
  'grey-alien', 'robot', 'mage', 'wizard', 'witch', 'elf', 'ninja', 'guard', 'prince', 'princess',
  'police-officer', 'construction-worker',
])

/** The entity kind a `units` tile places as. player → player; a person slug → npc; else enemy. */
export function entityKindForUnitSlug(slug: string): 'player' | 'npc' | 'enemy' {
  if (slug === 'player') return 'player'
  if (PERSON_SLUGS.has(slug)) return 'npc'
  return 'enemy'
}

// Nature-slug → asset `type`. FLOWER is tested before TREE so 'cherry-blossom' reads as a flower,
// not a tree. Order matters; first match wins.
const FLOWER_RE = /flower|rose|tulip|blossom|sunflower|hibiscus|clover|shamrock|bouquet|wilt|lily|lotus|daisy|petal/
const TREE_RE = /tree|sapling|cactus|palm|pine|oak|bamboo|spruce|willow/
const ROCK_RE = /rock|boulder|stone|log|pebble/
const BUSH_RE = /bush|shrub|hedge/
const MUSHROOM_RE = /mushroom/

/** The GridAsset `type` a nature/buildings tile stamps as. Buildings are one 'building' cell; nature
 *  keywords pick tree/flower/rock/bush/mushroom (for collision + the 2D fallback draw), else 'decoration'.
 *  The tile's own visual is pinned via tileOverride, so this only affects collision/height, not the glyph. */
export function assetTypeForTile(tile: Pick<TileDef, 'category' | 'id'>): string {
  if (tile.category === 'buildings') return 'building'
  const slug = tileSlug(tile.id)
  if (FLOWER_RE.test(slug)) return 'flower'
  if (TREE_RE.test(slug)) return 'tree'
  if (ROCK_RE.test(slug)) return 'rock'
  if (BUSH_RE.test(slug)) return 'bush'
  if (MUSHROOM_RE.test(slug)) return 'mushroom'
  return 'decoration'
}

// Asset types that stand in a cell as an obstacle. A cell with any blocking asset is collision.
const BLOCKING_ASSET_TYPES = new Set<string>(['building', 'tree', 'rock', 'bush'])

/** Does a stamped asset of this `type` block movement? (drives the cell's collision flag). */
export function tileIsBlocking(type: string): boolean {
  return BLOCKING_ASSET_TYPES.has(type)
}

/** Route an armed tile to its placement primitive:
 *   - terrain            → set the cell's ground
 *   - units (figure)     → place an entity
 *   - units (FX) / nature / buildings → stamp a (stackable) cell asset */
export function placementFor(tile: Pick<TileDef, 'category' | 'id'>): PlacementKind {
  const cat: TileCategory = tile.category
  if (cat === 'terrain') return 'terrain'
  if (cat === 'units') return NON_ENTITY_UNIT.has(tileSlug(tile.id)) ? 'asset' : 'entity'
  return 'asset' // nature + buildings
}
