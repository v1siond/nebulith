/**
 * TILE-PLACEMENT ROUTING — the pure decision layer behind the editor's Minecraft-style
 * "pick a tile, click to place it" brush. Given a catalog TileDef (the SAME tiles the Tile
 * Library browses via tilesForStyle), it answers the questions the page's brush needs:
 *
 *   1. placementFor(tile)      → WHICH primitive places it (terrain / asset / entity).
 *   2. entityKindForUnitSlug   → which entity kind a `units` tile becomes (player/npc/enemy).
 *
 * There is deliberately NO type/category classifier for a stacked asset: a nature/building tile's
 * insertion HEIGHT and COLLISION derive from the tile's OWN height DATA (see stackAssetTile), not
 * from a per-type list — so every tile inserts through the same uniform path. The tile's VISUAL is
 * pinned via `tileOverride = tile.id`, so the exact catalog tile always renders. Kept pure + here
 * so the routing is unit-testable without the React page.
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
