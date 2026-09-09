/**
 * TILE-PLACEMENT ROUTING — the pure decision layer behind the editor's Minecraft-style
 * "pick a tile, click to place it" brush. Given a catalog TileDef (the SAME tiles the Tile
 * Library browses via tilesForStyle), it answers the questions the page's brush needs:
 *
 *   1. placementFor(tile)      → WHICH primitive places it (terrain / asset / entity).
 *   2. entityKindForUnitSlug   → which entity kind a `units` tile becomes (player/npc/enemy).
 *
 * There is deliberately NO type/category classifier for a stacked asset: a nature/building tile's
 * insertion HEIGHT is the tile's OWN height DATA (see stackAssetTile) and its COLLISION is one uniform
 * walkable default (a per-cell SETTING the user drives, never derived from height/type/category/style),
 * not a per-type list — so every tile inserts through the same uniform path. The tile's VISUAL is
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

/**
 * What a `units` tile IS, per the backend: a walking figure, a hostile, or a combat effect.
 *
 * This is `tiles.settings.unitRole` — the row the editor reads instead of classifying 36 backend-owned
 * slugs itself (§3.14b Tier-1 #2). It is also the grouping the Characters library needs to sub-divide its
 * 79 creatures (§3.6).
 */
export type UnitRole = 'person' | 'enemy' | 'animal' | 'fx'

const UNIT_ROLES: ReadonlySet<string> = new Set<UnitRole>(['person', 'enemy', 'animal', 'fx'])

/**
 * The roles that are CHARACTERS — people, monsters and animals.
 *
 * `fx` is a role but NOT a character: an arrow, a nova, a fire-slash is what a power DRAWS. Nobody places a
 * bolt as a character. Anything counting or listing characters must exclude it, and the count in the rail
 * read 79 instead of 67 until this was said in one place both the rail and the library could read.
 */
export const CHARACTER_ROLES: readonly UnitRole[] = ['person', 'enemy', 'animal']

/** Is this tile a placeable character (as opposed to an effect a power draws)? */
export function isCharacterTile(settings?: Record<string, unknown>): boolean {
  const role = unitRole(settings)
  return role !== undefined && role !== 'fx'
}

/** The role the backend gives this tile, or undefined when its row carries none. A value the frontend does
 *  not recognise is undefined too — an unknown role must read as "not said", never as a guess. */
export function unitRole(settings?: Record<string, unknown>): UnitRole | undefined {
  const raw = settings?.unitRole
  return typeof raw === 'string' && UNIT_ROLES.has(raw) ? (raw as UnitRole) : undefined
}


/**
 * The entity kind a `units` TILE places as — the tile's served `unitRole` first, the slug bridge second.
 *
 * `player` stays a slug check: the hero is the one distinguished entity in the model ("only units are
 * special, they move"), and its row's role is `person` like any other figure. An `fx` tile is not an
 * entity at all → null; `placementFor` routes it to a decoration asset.
 */
export function entityKindForUnitTile(tile: Pick<TileDef, 'id' | 'settings'>): 'player' | 'npc' | 'enemy' | null {
  // `player` stays a slug check: the hero is the one distinguished entity in the model ("only units are
  // special, they move"), and its row's role is `person` like any other figure.
  if (tileSlug(tile.id) === 'player') return 'player'
  return ENTITY_KIND_BY_ROLE[unitRole(tile.settings) ?? 'fx']
}

/**
 * What each role places as. A dispatch map, so a role added to the catalog is a row here and nothing else.
 *
 * An `fx` tile is not an entity at all → null; `placementFor` routes it to a decoration asset.
 *
 * `animal` places as an ENEMY, exactly as before. The role exists so the Characters library can sub-group
 * People / Monsters / Animals (§4.5) — it is a GROUPING, and changing what an animal places as would be a
 * behaviour change nobody asked for. The old rule was "everything that is not a person is an enemy", and a
 * bear still spawns as one.
 */
const ENTITY_KIND_BY_ROLE: Record<UnitRole, 'player' | 'npc' | 'enemy' | null> = {
  person: 'npc',
  animal: 'enemy',
  enemy: 'enemy',
  fx: null,
}

// Ground-family categories all lay down the cell's walkable ground (a terrain/road/floor is painted flat,
// height 0). The finer taxonomy split `buildings` into stacked structural pieces (walls/windows/doors/roofs)
// and `terrain` into terrain/roads/floors — but the PLACEMENT primitive only cares about ground-vs-asset.
const GROUND_CATEGORIES = new Set<TileCategory>(['terrain', 'roads', 'floors'])

/** Route an armed tile to its placement primitive:
 *   - terrain / roads / floors                          → set the cell's ground
 *   - units (figure)                                    → place an entity
 *   - units (FX) / walls / windows / doors / roofs / props / nature → stamp a (stackable) cell asset
 *
 * A `units` tile is routed by its SERVED role (`settings.unitRole`). The two hardcoded slug Sets that used
 * to stand in for it — §3.14b #11, 36 backend-owned slugs classified in the frontend — are DELETED: the
 * backend seeds every `units` row's role now (`seed_unit_roles/0`). */
export function placementFor(tile: Pick<TileDef, 'category' | 'id' | 'settings'>): PlacementKind {
  const cat: TileCategory = tile.category
  if (GROUND_CATEGORIES.has(cat)) return 'terrain'
  if (cat !== 'units') return 'asset' // walls/windows/doors/roofs/props/nature — every standing piece stacks
  // Routed by the tile's SERVED role. A row with no role is not a placeable creature — the catalog has not
  // said what it is, and inventing an answer is what the deleted slug lists used to do.
  return unitRole(tile.settings) === 'fx' || !unitRole(tile.settings) ? 'asset' : 'entity'
}
