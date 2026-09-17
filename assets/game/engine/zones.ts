/**
 * SEASONS, the TYPES, and the readers over the backend's season catalog.
 *
 * This file used to AUTHOR every season: ground palettes, hazard and trail tiles, the curated tree / decor /
 * flower tile per season, bloom variants, tree shape weights, rock shades, prop art, and the temple and cave
 * palettes. 302 lines of values. It even said where they belonged, in its own comment:
 *
 * They do now (`GET /api/zones`, plus the season-independent tables in `game_rules`).
 * 2026-09-10: What is left here is the processing: the type of a season, and the readers that hand
 * the generator what the backend served.
 *
 * Every reader is a FUNCTION. A module-level const would capture the catalog while it is still empty, which
 * is the exact trap documented in `archetypes.ts` and now removed from it.
 *
 * A season the backend does not serve has no palette, and a caller with no palette plants NOTHING. That is
 * deliberate: inventing a fallback green would be the hardcoded default this migration exists to delete.
 */
import {
  cavePalette as catalogCavePalette,
  defaultFlowers as catalogDefaultFlowers,
  livingTreeVariants as catalogTreeVariants,
  propTable,
  templePalette as catalogTemplePalette,
  zoneFlowers as catalogZoneFlowers,
  zonePalette as catalogZonePalette,
  zoneTile,
  type FlowerKind,
  type ZonePalette,
} from '@/engine/zoneCatalog'

export type { FlowerKind, ZonePalette }

export type ZoneId = 'spring' | 'summer' | 'autumn' | 'winter' | 'desert' | 'beach' | 'lava'

export const DEFAULT_ZONE: ZoneId = 'spring'

/** A season's ground palette, or undefined until the backend answers. */
export function zonePalette(zone: ZoneId): ZonePalette | undefined {
  return catalogZonePalette(zone)
}

/** A season's bloom variants; undefined for a season that does not flower. */
export function zoneFlowers(zone: ZoneId): readonly FlowerKind[] | undefined {
  return catalogZoneFlowers(zone)
}

/** The bloom set a season with no curated list falls back to, as the BACKEND states it. */
export function defaultFlowers(): readonly FlowerKind[] {
  return catalogDefaultFlowers()
}

/**
 * The curated-catalog `tileOverride` a generated prop of `propType` wears in `zone`.
 *
 * Two tables behind one question, both backend data now: roles whose tile varies by season (tree, flower,
 * ground decor) and roles whose tile never does (a boulder is a boulder). Dispatch by lookup, no branching.
 * VISUAL-ONLY: collision and height are unchanged by the override. Pure.
 */
export function stagePropTileOverride(zone: ZoneId, propType: string): string | undefined {
  const zonal = propType === 'tree' ? 'tree' : propType === 'flower' ? 'flower' : propType === 'ground_decor' ? 'decor' : null
  if (zonal) return zoneTile(zone, zonal)
  return propTable<Record<string, string>>('constantRoleTile')?.[propType]
}

/** The living-tree shape variants and their weights, and the total to roll against. */
export function livingTreeVariants(): ReadonlyArray<{ kind: LivingTreeKind; weight: number }> {
  return catalogTreeVariants() as ReadonlyArray<{ kind: LivingTreeKind; weight: number }>
}
export function livingTreeWeight(): number {
  return livingTreeVariants().reduce((sum, v) => sum + v.weight, 0)
}

/** Every tree SHAPE the backend composes. Typing only, `stampComposition` resolves any composition key by
 *  name, so a new shape is backend data; this union just lets the generator name it. */
export type LivingTreeKind =
  | 'tree' | 'tree_tall' | 'tree_stub' | 'tree_round' | 'tree_small' | 'tree_big'
  | 'tree_conifer' | 'tree_column' | 'tree_broadleaf' | 'tree_gnarled'
  | 'tree_giant' | 'tree_cypress' | 'tree_palm' | 'tree_sapling'
  | 'bush' | 'bush_round'
  // The tropics, 2026-09-13:
  | 'tree_coconut' | 'tree_banana' | 'tree_mangrove'
  // The four he named that the catalog lacked, 2026-09-16: *"I like to see pines, palm tree, cypress, oak,
  // weeping willow, cherry tree, encina"*. Pine is tree_conifer, cypress and palm already existed.
  | 'tree_oak' | 'tree_willow' | 'tree_cherry' | 'tree_encina'
  // The dry country, 2026-09-16. A cactus is not a tree: no trunk, no canopy, one succulent body whose
  // species is its proportion. The acacia's umbrella is the silhouette that reads as dry savanna.
  | 'tree_acacia' | 'cactus_column' | 'cactus_barrel' | 'cactus_prickly'
  // AFTER THE ERUPTION, 2026-09-16: the woodland and mountain species burned, for a volcanic map. Not new
  // species, the same four that grow in those two places with the fire gone through them.

/** Tonal rock shades so cave and arena walls are not one flat grey. */
export function rockShades(): readonly string[] {
  return propTable<string[]>('rockShades') ?? []
}

/** Non-blocking cave-floor decor glyphs. */
export function caveDecor(): readonly string[] {
  return propTable<string[]>('caveDecor') ?? []
}

/** Cave mushroom cap tones. */
export function mushroomTones(): readonly string[] {
  return propTable<string[]>('mushroomTones') ?? []
}

export type StructuralProp = 'pillar' | 'brazier' | 'altar' | 'torch'
export interface PropArt {
  char: string
  color: string
}

/** Structural-prop art for the temple / arena furniture makers. */
export function propArt(): Readonly<Record<string, PropArt>> {
  return propTable<Record<string, PropArt>>('propArt') ?? {}
}

// ── temple (a real SEASONAL DUNGEON) palette ─────────────────────────────────
export interface TemplePalette {
  /** main paved dungeon floor tile. */
  floor: string
  /** checker-inlay accent tile (the ornate tiled look). */
  accent: string
  /** tonal wall colours, the stone boundary + inner walls, varied per cell (disjoint per season). */
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
/** A season's temple palette, or undefined until the backend answers. */
export function templePalette(zone: ZoneId): TemplePalette | undefined {
  return catalogTemplePalette(zone) as TemplePalette | undefined
}

// ── cave (a real SEASONAL cavern) palette ────────────────────────────────────
export interface CavePalette {
  /** base cave-floor ground tile (a GROUND_COLORS key that renders in the live engine). */
  floor: string
  /** patchy floor accent (moss / fallen leaves / dune / ash). */
  accent: string
  /** fraction of floor cells that take the accent, how mossy/leafy the cave reads. */
  accentChance: number
  /** tonal wall colours, the rock boundary + internal formations, varied per cell. */
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
/** A season's cave palette, or undefined until the backend answers. */
export function cavePalette(zone: ZoneId): CavePalette | undefined {
  return catalogCavePalette(zone) as CavePalette | undefined
}
