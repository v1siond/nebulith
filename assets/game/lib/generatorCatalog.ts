/**
 * The MAP-GENERATOR CATALOG — the backend's answer to "which worlds can I generate, and with what
 * knobs?" (`GET /api/generators`, T-113 / games-page UX §3.14b Tier-1 #1).
 *
 * Alexander (2026-09-06): *"in fact, I want to get to the point where all generators are just backend
 * records organized per categories"*. Every number the generator used to hard-code in the frontend —
 * grid ranges, cell geometry, settlement tuning, nature densities, unit counts, building materials and
 * roof/wall colours — is a row in `generators` now (`Nebulith.Catalog.GeneratorSource`), served whole.
 *
 * This module is the CLIENT + the pure SELECTORS over it. It is deliberately dumb about the game:
 *
 *   - it NEVER invents a value. A category the backend does not serve does not exist; a config section
 *     the backend leaves out reads as `undefined`, and the caller plants nothing rather than falling
 *     back to a number this file made up (the no-fallback law, MAP-MODEL §8).
 *   - it NEVER lets a malformed row through as a half-object. A row missing a `key`/`name` is DROPPED
 *     with a warning, so a bad seed shows up as a missing menu entry — loud — instead of a silent
 *     default that looks generated.
 *
 * The catalog is the DATA behind the Generate panel (§4.6): season chips, map-type cards and the
 * per-type layouts are all read from here, so adding a generator is a seed row and nothing else.
 */
import { NEBULITH_API } from './nebulithApi'

// ── the served shapes ────────────────────────────────────────────────────────

/** An inclusive `[min, max]` range the generator rolls a grid dimension within. */
export interface GridRange {
  min: number
  max: number
}

/** The grid a generator rolls: the col/row ranges plus the cell geometry every map starts from. */
export interface GeneratorGrid {
  cols: GridRange
  rows: GridRange
  cellSize: number
  isoScale: number
}

/** Who populates a generated map: wandering townsfolk, and (for dungeons) how many enemies of which types. */
export interface GeneratorUnits {
  townsfolk: number
  enemies: number
  enemyTypes: readonly string[]
}

/**
 * How thickly a map is dressed (0..1 per-cell chance).
 *
 * `canopy` is OPTIONAL because most generators are not forests: a town, a cave and a meadow have no tree
 * density to state, and a required field would have forced every one of them to carry a meaningless zero.
 * A layout that needs it and does not get it plants nothing and says so — it must not invent a number.
 */
export interface GeneratorNature {
  groundCover: number
  flowers: number
  /** Share of cells carrying a tree. Only a woodland-style layout reads it. */
  canopy?: number
}

/** The per-building material + colour roll: residential picks from the lists, civic buildings are fixed. */
export interface GeneratorBuildings {
  materials: readonly string[]
  roofColors: readonly string[]
  wallColors: readonly string[]
  storeRoof: string
  hospitalRoof: string
  fixedWall: string
}

/** Settlement density tuning — the street/lot rules that make a town a town and a city a city. */
export interface GeneratorSettlement {
  plazaSize: number
  roadWidth: number
  setback: number
  lotGap: readonly [number, number]
  maxPerFrontage: number
  buildingCap: number
  houseRange: readonly [number, number]
  bigHouseRange: readonly [number, number]
  houseWidths: readonly number[]
  natureMultiplier: number
}

/** Everything one generator is tuned by. Every section is OPTIONAL: a forest carries no settlement
 *  tuning and a cave carries no building palette, and the reader must see that as "none", not as zero. */
export interface GeneratorConfig {
  grid?: GeneratorGrid
  units?: GeneratorUnits
  nature?: GeneratorNature
  buildings?: GeneratorBuildings
  settlement?: GeneratorSettlement
}

/** One generator — a concrete map the user can ask for ("Meadow + River", "Town"). */
export interface GeneratorDef {
  key: string
  name: string
  description: string | null
  /** The SHAPE the user steers within a category ('meadow', 'meadow_river'), or null when the category
   *  offers only one generator and therefore no shape choice. */
  layout: string | null
  /** The seasons this generator runs in — the season chips are the union of these. */
  zones: readonly string[]
  position: number
  config: GeneratorConfig
}

/** A category — the user-facing MAP TYPE (Forest, Town, City, Cave, Temple) and its generators. */
export interface GeneratorCategoryDef {
  key: string
  name: string
  description: string | null
  position: number
  generators: readonly GeneratorDef[]
}

/** The whole catalog, in menu order. */
export type GeneratorCatalog = readonly GeneratorCategoryDef[]

/** No catalog. What the editor holds before the load resolves and after it fails — an honestly EMPTY
 *  menu, never a stand-in list of map types the backend may not actually have. */
export const EMPTY_GENERATOR_CATALOG: GeneratorCatalog = []

// ── parsing: narrow `unknown` without inventing anything ─────────────────────

type Json = Record<string, unknown>

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/** A list of strings, or undefined when the value is not a string array — never a partial list. */
function strList(v: unknown): readonly string[] | undefined {
  if (!Array.isArray(v)) return undefined
  return v.every(x => typeof x === 'string') ? (v as string[]) : undefined
}

/** A fixed-length numeric pair (`[min, max]`), or undefined. */
function numPair(v: unknown): readonly [number, number] | undefined {
  if (!Array.isArray(v) || v.length !== 2) return undefined
  const [a, b] = v
  return typeof a === 'number' && typeof b === 'number' ? [a, b] : undefined
}

function parseRange(v: unknown): GridRange | undefined {
  if (!isObject(v)) return undefined
  const min = num(v.min)
  const max = num(v.max)
  return min === undefined || max === undefined ? undefined : { min, max }
}

function parseGrid(v: unknown): GeneratorGrid | undefined {
  if (!isObject(v)) return undefined
  const cols = parseRange(v.cols)
  const rows = parseRange(v.rows)
  const cellSize = num(v.cellSize)
  const isoScale = num(v.isoScale)
  if (!cols || !rows || cellSize === undefined || isoScale === undefined) return undefined
  return { cols, rows, cellSize, isoScale }
}

function parseUnits(v: unknown): GeneratorUnits | undefined {
  if (!isObject(v)) return undefined
  const townsfolk = num(v.townsfolk)
  const enemies = num(v.enemies)
  const enemyTypes = strList(v.enemyTypes)
  if (townsfolk === undefined || enemies === undefined || !enemyTypes) return undefined
  return { townsfolk, enemies, enemyTypes }
}

function parseNature(v: unknown): GeneratorNature | undefined {
  if (!isObject(v)) return undefined
  const groundCover = num(v.groundCover)
  const flowers = num(v.flowers)
  if (groundCover === undefined || flowers === undefined) return undefined
  // `canopy` is carried through when served and left off when not — never defaulted here.
  const canopy = num(v.canopy)
  return canopy === undefined ? { groundCover, flowers } : { groundCover, flowers, canopy }
}

function parseBuildings(v: unknown): GeneratorBuildings | undefined {
  if (!isObject(v)) return undefined
  const materials = strList(v.materials)
  const roofColors = strList(v.roofColors)
  const wallColors = strList(v.wallColors)
  const storeRoof = str(v.storeRoof)
  const hospitalRoof = str(v.hospitalRoof)
  const fixedWall = str(v.fixedWall)
  if (!materials || !roofColors || !wallColors) return undefined
  if (storeRoof === undefined || hospitalRoof === undefined || fixedWall === undefined) return undefined
  return { materials, roofColors, wallColors, storeRoof, hospitalRoof, fixedWall }
}

function parseSettlement(v: unknown): GeneratorSettlement | undefined {
  if (!isObject(v)) return undefined
  const plazaSize = num(v.plazaSize)
  const roadWidth = num(v.roadWidth)
  const setback = num(v.setback)
  const maxPerFrontage = num(v.maxPerFrontage)
  const buildingCap = num(v.buildingCap)
  const natureMultiplier = num(v.natureMultiplier)
  const lotGap = numPair(v.lotGap)
  const houseRange = numPair(v.houseRange)
  const bigHouseRange = numPair(v.bigHouseRange)
  const houseWidths = Array.isArray(v.houseWidths) && v.houseWidths.every(x => typeof x === 'number')
    ? (v.houseWidths as number[])
    : undefined
  if (plazaSize === undefined || roadWidth === undefined || setback === undefined) return undefined
  if (maxPerFrontage === undefined || buildingCap === undefined || natureMultiplier === undefined) return undefined
  if (!lotGap || !houseRange || !bigHouseRange || !houseWidths) return undefined
  return {
    plazaSize, roadWidth, setback, lotGap, maxPerFrontage,
    buildingCap, houseRange, bigHouseRange, houseWidths, natureMultiplier,
  }
}

/** Each config section stands alone: an unparseable one is simply absent, so a typo in the settlement
 *  block never costs the caller the grid it CAN read. */
function parseConfig(v: unknown): GeneratorConfig {
  if (!isObject(v)) return {}
  const out: GeneratorConfig = {}
  const grid = parseGrid(v.grid)
  const units = parseUnits(v.units)
  const nature = parseNature(v.nature)
  const buildings = parseBuildings(v.buildings)
  const settlement = parseSettlement(v.settlement)
  if (grid) out.grid = grid
  if (units) out.units = units
  if (nature) out.nature = nature
  if (buildings) out.buildings = buildings
  if (settlement) out.settlement = settlement
  return out
}

/** A generator row, or null when it lacks the identity the menu needs (key + name). */
function parseGenerator(v: unknown): GeneratorDef | null {
  if (!isObject(v)) return null
  const key = str(v.key)
  const name = str(v.name)
  if (!key || !name) return null
  return {
    key,
    name,
    description: str(v.description) ?? null,
    layout: str(v.layout) ?? null,
    zones: strList(v.zones) ?? [],
    position: num(v.position) ?? 0,
    config: parseConfig(v.config),
  }
}

/** A category row, or null when it lacks key + name. Its generators are sorted into menu order here so
 *  every reader sees the same order regardless of what the wire happened to hand back. */
function parseCategory(v: unknown): GeneratorCategoryDef | null {
  if (!isObject(v)) return null
  const key = str(v.key)
  const name = str(v.name)
  if (!key || !name) return null
  const raw = Array.isArray(v.generators) ? v.generators : []
  const generators = raw
    .map(parseGenerator)
    .filter((g): g is GeneratorDef => g !== null)
    .sort((a, b) => a.position - b.position)
  return { key, name, description: str(v.description) ?? null, position: num(v.position) ?? 0, generators }
}

/**
 * Turn a raw `/api/generators` body into the catalog. Rows the frontend cannot identify are dropped and
 * NAMED in a warning — a bad seed must be visible in the console, not silently smoothed over.
 */
export function parseGeneratorCatalog(body: unknown): GeneratorCatalog {
  const rows = isObject(body) && Array.isArray(body.data) ? body.data : []
  const parsed = rows.map(parseCategory)
  const dropped = parsed.filter(c => c === null).length
  if (dropped > 0) console.warn(`[generatorCatalog] dropped ${dropped} generator category rows with no key/name`)
  return parsed
    .filter((c): c is GeneratorCategoryDef => c !== null)
    .sort((a, b) => a.position - b.position)
}

// ── the client ───────────────────────────────────────────────────────────────

const BASE = `${NEBULITH_API}/generators`

/** Load the whole catalog (called once on editor mount). Throws on a non-ok response — the caller shows
 *  the failure; it must never render a made-up menu in its place. */
export async function fetchGeneratorCatalog(): Promise<GeneratorCatalog> {
  const res = await fetch(BASE)
  if (!res.ok) throw new Error(`Failed to load the generator catalog: ${res.statusText}`)
  return parseGeneratorCatalog(await res.json())
}

// ── selectors ────────────────────────────────────────────────────────────────

/** Every season the catalog offers, first-seen order — the union of the generators' own `zones`, so a
 *  season exists exactly when some generator runs in it. Empty catalog → no seasons. */
export function catalogZones(catalog: GeneratorCatalog): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const category of catalog) {
    for (const generator of category.generators) {
      for (const zone of generator.zones) {
        if (seen.has(zone)) continue
        seen.add(zone)
        out.push(zone)
      }
    }
  }
  return out
}

/** The category with this key, or undefined. */
export function findCategory(catalog: GeneratorCatalog, key: string): GeneratorCategoryDef | undefined {
  return catalog.find(c => c.key === key)
}

/** A LAYOUT choice the user picks within a map type — a generator that names a shape. `id` is the
 *  generator's `layout` (what the engine is asked for), `label` its display name. */
export interface CatalogLayout {
  id: string
  label: string
}

/** The layouts a map type offers, in menu order. A category whose generators name no layout offers NO
 *  choice (one generator, no shape) — the menu then shows no layout group, as DATA, never a
 *  `key === 'forest'` branch. */
export function categoryLayouts(catalog: GeneratorCatalog, categoryKey: string): CatalogLayout[] {
  const category = findCategory(catalog, categoryKey)
  if (!category) return []
  const out: CatalogLayout[] = []
  for (const generator of category.generators) {
    if (generator.layout) out.push({ id: generator.layout, label: generator.name })
  }
  return out
}

/**
 * The generator to RUN for a (map type, layout) pair.
 *
 * A named layout selects its generator exactly; no layout takes the category's first (lowest-position)
 * generator. A layout the category does not carry resolves to nothing — the caller must not silently
 * run a different world than the user asked for.
 */
export function findGenerator(
  catalog: GeneratorCatalog,
  categoryKey: string,
  layout?: string,
): GeneratorDef | undefined {
  const category = findCategory(catalog, categoryKey)
  if (!category) return undefined
  if (layout === undefined) return category.generators[0]
  return category.generators.find(g => g.layout === layout)
}

/**
 * Roll a grid SIZE from a generator's range: an integer in `[min, max]` inclusive per axis.
 *
 * `rand` is injected (0..1) so a seeded harness reproduces a size exactly, the way the editor's own
 * seeded generate path does. Undefined when the generator carries no grid — the caller keeps the grid
 * it has rather than resizing to a size this file invented.
 */
export function rollGridSize(
  generator: GeneratorDef | undefined,
  rand: () => number,
): { cols: number; rows: number } | undefined {
  const grid = generator?.config.grid
  if (!grid) return undefined
  return { cols: rollRange(grid.cols, rand()), rows: rollRange(grid.rows, rand()) }
}

/**
 * A generator's served grid range is used for ONE thing: `rollGridSize` picking a random size when the user
 * has not typed one.
 *
 * It used to be exposed here as guidance the panel printed, and before that as a CAP. Alexander, 2026-09-09:
 * *"this shouldn't be a limitation, our generators should be versatile enough and random enough to do a
 * forest as big as what I put."* So neither the cap nor the note survives, and with no caller left the
 * accessors are deleted rather than kept "just in case" — the range is read where it is rolled.
 */

/** One integer in an inclusive range. A reversed/degenerate range yields its `min` rather than NaN. */
function rollRange(range: GridRange, r: number): number {
  const span = Math.max(0, Math.floor(range.max) - Math.floor(range.min))
  return Math.floor(range.min) + Math.floor(r * (span + 1))
}
