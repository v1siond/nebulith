/**
 * THE SEASON CATALOG, from the backend (`GET /api/zones`).
 *
 * `engine/zones.ts` authored all of this: ground palettes, the hazard and trail tile, the curated tree /
 * decor / flower tile each season wears, its bloom variants, and its temple and cave palettes. That file
 * named its own destination in a comment,, and
 *
 * Season-INDEPENDENT tables (tree shape weights, rock shades, cave decor, prop art) are not per-zone, so
 * they arrive in the `game_rules` bundles rather than repeated in every season.
 *
 * Read through FUNCTIONS, never a module const: the catalog is empty until the backend answers, and a
 * const would capture that empty state for the life of the page.
 */
import { NEBULITH_API } from '@/lib/nebulithApi'

/** One bloom variant: the glyph the generator scatters and the colour it tints it. */
export interface FlowerKind {
  char: string
  color: string
}

/**
 * THE OPEN FIELD'S OWN COLOURS for a season: the row gradient's two ends, the grass and earth patches, the
 * cobble at its entrance, and the river and its bank.
 *
 * Served, because this was a table of seven seasons in `stageGenerator.ts` and a map's appearance is not
 * the frontend's to decide. Optional, and a caller with none paints no meadow rather than inventing one.
 */
export interface ZoneMeadow {
  top: string
  bottom: string
  grass: string
  earth: string
  cobble: string
  river: string
  bank: string
  plot: string
}

/** A season's ground: what fills it, what is hazardous, what a trail is paved with. */
export interface ZonePalette {
  id: string
  groundTypes: string[]
  hazard: string
  trail: string
  wallColor: string
  accentColor: string
  meadow?: ZoneMeadow
}

/** One season, whole. */
export interface ZoneRow {
  key: string
  name: string
  position: number
  palette: ZonePalette
  tiles: { tree?: string; decor?: string; flower?: string }
  /** Null for a season that does not flower, different from one that blooms with nothing. */
  flowers: { variants: FlowerKind[] } | null
  temple: Record<string, unknown>
  cave: Record<string, unknown>
}

let ZONES: readonly ZoneRow[] = []
let PROPS: Record<string, unknown> = {}
let TREES: Record<string, unknown> = {}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** Install a served `/api/zones` payload. Exported so tests and the loader share one way in. */
export function installZones(body: unknown): void {
  const data = isObject(body) && Array.isArray(body.data) ? body.data : []
  ZONES = data.filter(isObject).filter(row => typeof row.key === 'string') as unknown as ZoneRow[]
}

/** Install the season-independent rule bundles (`props`, `trees`) from `/api/combat`. */
export function installZoneRules(rules: unknown): void {
  const bundles = isObject(rules) ? rules : {}
  PROPS = isObject(bundles.props) ? bundles.props : {}
  TREES = isObject(bundles.trees) ? bundles.trees : {}
}

/** Fetch and install. A failure leaves the catalog EMPTY and says why; it plants no seasons of its own. */
export async function loadZones(): Promise<void> {
  try {
    const res = await fetch(`${NEBULITH_API}/zones`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    installZones(await res.json())
  } catch (error) {
    console.warn('[zones] the season catalog could not be loaded, nothing has a palette', error)
  }
}

/** Every season the backend serves, in menu order. Empty until it answers. */
export function zones(): readonly ZoneRow[] {
  return ZONES
}

/** One season by key, or undefined when the backend serves no such season. */
export function zone(key: string | undefined): ZoneRow | undefined {
  return key === undefined ? undefined : ZONES.find(z => z.key === key)
}

/** A season's ground palette, or undefined. A caller with no palette plants nothing rather than inventing one. */
export function zonePalette(key: string | undefined): ZonePalette | undefined {
  return zone(key)?.palette
}

/** A season's open-field colours, or undefined when the backend serves none for it. */
export function zoneMeadow(key: string | undefined): ZoneMeadow | undefined {
  return zonePalette(key)?.meadow
}

/** The curated catalog tile a season wears for `tree` / `decor` / `flower`. */
export function zoneTile(key: string | undefined, role: 'tree' | 'decor' | 'flower'): string | undefined {
  return zone(key)?.tiles?.[role]
}

/** A season's bloom variants, or undefined for a season that does not flower. */
export function zoneFlowers(key: string | undefined): readonly FlowerKind[] | undefined {
  return zone(key)?.flowers?.variants
}

/** The bloom set a season with no curated list falls back to, as the backend states it. */
export function defaultFlowers(): readonly FlowerKind[] {
  const served = TREES.defaultFlowers
  return Array.isArray(served) ? (served as FlowerKind[]) : []
}

/** A season's temple palette. */
export function templePalette(key: string | undefined): Record<string, unknown> | undefined {
  return zone(key)?.temple
}

/** A season's cave palette. */
export function cavePalette(key: string | undefined): Record<string, unknown> | undefined {
  return zone(key)?.cave
}

/** The living-tree shape variants and their weights. */
export function livingTreeVariants(): ReadonlyArray<{ kind: string; weight: number }> {
  const served = TREES.variants
  return Array.isArray(served) ? (served as { kind: string; weight: number }[]) : []
}

/** One of the season-independent prop tables, or an empty one until the backend answers. */
export function propTable<T>(name: 'rockShades' | 'caveDecor' | 'mushroomTones' | 'propArt' | 'constantRoleTile'): T | undefined {
  return PROPS[name] as T | undefined
}
