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
import type { MixEntry } from '@/engine/buildingTypes'
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
  /**
   * The ROOF TILE a residential building lays: `roof` (a gable), `roof_slate`, `flat_roof`.
   *
   * Alexander, 2026-09-11: *"I picked a tropical city and had nothing different than a regular one ... the
   * material of houses should be different, walls different, roof different"*. The roof SHAPE is baked into
   * each composition (`house_5` is slate, `house_4` a gable, `store_5` a flat deck), so colours alone could
   * never make a look read as a look. Absent → every building keeps the roof its composition was authored
   * with, which is what every map did before this existed.
   */
  roof?: string
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
  /**
   * WHICH BUILDINGS THIS PLACE IS MADE OF, served per place. Optional on purpose: a recipe that names no mix
   * keeps the planner's own default list, so an older payload still parses instead of the whole settlement
   * tuning coming back undefined.
   */
  mix?: readonly MixEntry[]
  /** The ground whose colour this place's streets take (`path_stone` for a town, `road` for a city). */
  streets?: string
}

/** Everything one generator is tuned by. Every section is OPTIONAL: a forest carries no settlement
 *  tuning and a cave carries no building palette, and the reader must see that as "none", not as zero. */
/**
 * The COLOURS a template paints its ground and canopy with — what makes an Amazonas not a pine wood.
 *
 * Alexander, 2026-09-10: *"colors should be different"*, *"like there's a huge difference between amazonas
 * and a pines forest"*. Every colour in a forest used to come from the SEASON, so a spring jungle and a
 * spring woodland were painted from the same numbers and looked identical. This is per GENERATOR.
 *
 * Every field is optional because the backend is the authority on which templates state one. A template that
 * serves no palette gets no painting, never a colour invented here.
 */
export interface GeneratorPalette {
  /** the shaded forest floor */
  floor?: string
  /** the second floor tone, for the mottling that stops a floor reading as one flat fill */
  floorAlt?: string
  /** leaf litter / bare earth showing through */
  litter?: string
  /** the canopy overhead */
  canopy?: string
  canopyAlt?: string
  /** the choked layer between the trunks */
  undergrowth?: string
  /** a watercourse, and the ground either side of it */
  water?: string
  /** water by DEPTH: the wadeable edge, and the deep middle. Alexander, 2026-09-11: *"I only want light blue
   *  for walkable water, different layers of darkblue for the deeper waters"*. */
  waterShallow?: string
  waterDeep?: string
  /** standing swamp water, blue-green, the only water allowed to lean green */
  swamp?: string
  bank?: string
  /** a walked route */
  trail?: string
}

/**
 * ONE SUB-ZONE a map is partitioned into — a region with its own character, not a template of its own.
 *
 * Alexander, 2026-09-10: *"the generator shoudl be smart enough to identify different patterns of jungles
 * for example, open zones, dense zones, zones with swamp, zone with river, zone with cave, zone with
 * ruins"*, and 2026-09-11 on the shape: regions inside ONE map. You walk from one into the next.
 *
 * `canopy` and `undergrowth` MULTIPLY the generator's served base densities rather than replacing them, so
 * the base stays the one knob that moves the whole map.
 */
/**
 * HOW THE TREES ARE DISTRIBUTED — the difference between a wood pasture, an even-aged stand and a closed
 * canopy, none of which is a matter of how MANY trees there are.
 *
 * Alexander, 2026-09-11: *"there's different ways in which trees and nature is distributed across these
 * zones"*, with six photographs. Two numbers carry most of it: `lattice` is the scale of the noise the
 * canopy is scored against (small = fine scatter, large = big continuous masses) and `spacing` is the
 * minimum gap between trunks (0 lets them form a wall, 3+ makes every tree individually readable).
 */
/** One entry of a template's tree mix — which shape, and how often it is rolled. */
export interface GeneratorTreeWeight {
  kind: string
  weight: number
}

export interface GeneratorFormation {
  /** noise scale in cells — the "grouping" knob */
  lattice?: number
  /** minimum cells between two trunks */
  spacing?: number
  /** multiplies the served ground cover — how choked the floor is between the trunks */
  understory?: number
}

export interface GeneratorSubZone {
  key: string
  name?: string
  /** how much of the map this kind tends to claim, relative to its siblings */
  weight: number
  canopy?: number
  undergrowth?: number
  /** this region's own floor tone */
  floor?: string
  /** the share of the region standing under water (a swamp's pools) */
  pools?: number
  /** the share of the region carrying fallen masonry (ruins) */
  stone?: number
  /** this region's own tree distribution — a swamp is spaced like a pasture, dense growth is a wall */
  formation?: GeneratorFormation
  /** which species grow in this region — the swamp is cypress, whatever the rest of the jungle is */
  trees?: readonly GeneratorTreeWeight[]
}

export interface GeneratorConfig {
  grid?: GeneratorGrid
  units?: GeneratorUnits
  nature?: GeneratorNature
  buildings?: GeneratorBuildings
  settlement?: GeneratorSettlement
  palette?: GeneratorPalette
  /** The regions this template partitions itself into. Absent → one uniform map. */
  subZones?: readonly GeneratorSubZone[]
  /** How this template distributes its trees. Absent → the generator's own default grouping. */
  formation?: GeneratorFormation
  /**
   * WHICH trees grow here. Alexander, 2026-09-11: *"we're using the same for all forest variations, but
   * that's not good"*. Absent → the global weighted table every template used to share.
   */
  trees?: readonly GeneratorTreeWeight[]
  /** What a river is crossed on, by kind. Absent → the classic bridge deck. */
  crossings?: Readonly<Record<string, GeneratorCrossing>>
}

/** One generator — a concrete map the user can ask for ("Meadow + River", "Town"). */
export interface GeneratorDef {
  key: string
  name: string
  description: string | null
  /** The SHAPE the user steers within a category ('meadow', 'meadow_river'), or null when the category
   *  offers only one generator and therefore no shape choice. */
  layout: string | null
  /**
   * WHICH ARCHETYPE this generator runs: 'town', 'city', 'forest', 'cave', 'temple'.
   *
   * The editor used to send the CATEGORY KEY to the engine as the variant, which only worked while every
   * category held one kind. Alexander, 2026-09-11: *"City and town options are the same, it'd put them in a
   * single category"*, so a row says what it runs. Null on a payload from before this existed, and the caller
   * then falls back to the category key exactly as it used to.
   */
  variant: string | null
  /** The seasons this generator runs in — the season chips are the union of these. */
  zones: readonly string[]
  position: number
  config: GeneratorConfig
  /**
   * What a person may switch ON for this generator.
   *
   * Alexander, 2026-09-10: *"every time we add a new template, the list grows ... that's not sustainable.
   * Instead, we should just have extra options for each template"*. A river used to be a second row
   * (`Woodland + River`); it is an option on Woodland now. DECLARED by the backend, so the panel renders
   * whatever exists without knowing any option by name.
   */
  options: readonly GeneratorOption[]
  /**
   * Its SUBTYPES, any depth — *"forest > type of forest > sub type of type of forest > etc"*. Each arrives with
   * its parent's config already merged under its own, so a subtype runs exactly like any generator.
   */
  children?: readonly GeneratorDef[]
}

/** One switch a generator offers. `requires` names an option that must be on for this one to apply. */
/** One pickable value of a choice option. */
export interface GeneratorChoice {
  key: string
  label: string
}

/**
 * One kind of river crossing: the tile its deck lays, and optionally the tile whose COLOUR it wears. Alexander,
 * 2026-09-11: *"it can be a simple dirt path, it can be an actual bridge, which again, are multiple variations"*.
 * A dirt path is the flat floor in the dirt path's colour; a bridge is its own textured tile.
 */
export interface GeneratorCrossing {
  tile: string
  colorOf?: string
}

/** What an option holds: a toggle is on/off, a choice is the key of the picked value. */
export type GeneratorOptionValue = boolean | string

export interface GeneratorOption {
  key: string
  label: string
  /**
   * `toggle` is on/off. `choice` picks one of `choices` — the river is one, because Alexander asked for its
   * COURSE to be steerable (*"maybe it's traversable, maybe it's dividing the map in two half, maybe it's
   * around the map"*), which an on/off cannot say.
   */
  type: 'toggle' | 'choice'
  default: GeneratorOptionValue
  choices?: readonly GeneratorChoice[]
  /** Meaningless without that option — a crossing needs a river. Stated here, not known by the frontend. */
  requires?: string
}

/**
 * Is this option doing anything? A toggle when it is true; a choice when it picked something other than its
 * "none". One definition, so `requires` means the same thing for every kind of option.
 */
export function optionIsOn(value: GeneratorOptionValue | undefined): boolean {
  if (typeof value === 'string') return value !== 'none' && value !== ''
  return value === true
}

/** The value an option takes when what it `requires` is off. */
export function optionOffValue(opt: GeneratorOption): GeneratorOptionValue {
  return opt.type === 'toggle' ? false : 'none'
}

/**
 * The options a served generator declares. A malformed one is DROPPED with a warning rather than guessed
 * at: an option the panel cannot describe is one a person cannot use on purpose.
 */
function parseOptions(raw: unknown): readonly GeneratorOption[] {
  if (!Array.isArray(raw)) return []
  const out: GeneratorOption[] = []
  for (const row of raw) {
    if (typeof row !== 'object' || row === null) continue
    const { key, label, type, default: fallback, requires, choices } = row as Record<string, unknown>
    if (typeof key !== 'string' || typeof label !== 'string') {
      console.warn('[generators] an option with no key or label was dropped', row)
      continue
    }
    const need = typeof requires === 'string' ? { requires } : {}
    if (type === 'choice') {
      // A choice with nothing to choose from cannot be used on purpose, so it is dropped rather than drawn
      // as an empty select. Its default must be one of its own choices, or the first one stands in.
      const picks = Array.isArray(choices)
        ? choices.flatMap(c => (isObject(c) && str(c.key) && str(c.label) ? [{ key: str(c.key)!, label: str(c.label)! }] : []))
        : []
      if (picks.length === 0) {
        console.warn('[generators] a choice option with no choices was dropped', row)
        continue
      }
      const initial = typeof fallback === 'string' && picks.some(p => p.key === fallback) ? fallback : picks[0].key
      out.push({ key, label, type: 'choice', default: initial, choices: picks, ...need })
      continue
    }
    out.push({ key, label, type: 'toggle', default: fallback === true, ...need })
  }
  return out
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
  const roof = str(v.roof)
  if (!materials || !roofColors || !wallColors) return undefined
  if (storeRoof === undefined || hospitalRoof === undefined || fixedWall === undefined) return undefined
  // `roof` is optional: a payload from before it existed parses exactly as it used to.
  return { materials, roofColors, wallColors, storeRoof, hospitalRoof, fixedWall, ...(roof ? { roof } : {}) }
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
  const mix = parseMix(v.mix)
  const streets = typeof v.streets === 'string' && v.streets !== '' ? v.streets : undefined
  return {
    plazaSize, roadWidth, setback, lotGap, maxPerFrontage,
    buildingCap, houseRange, bigHouseRange, houseWidths, natureMultiplier,
    ...(mix ? { mix } : {}),
    ...(streets ? { streets } : {}),
  }
}

/**
 * The served building MIX: one `{type, count}` per building this place demands.
 *
 * A malformed entry drops the WHOLE mix rather than half of it, because a place built from half its list is a
 * place that quietly stopped being itself. Nothing is invented here: an unknown type name passes straight
 * through, and the planner then skips it when the backend serves no footprint for it.
 */
function parseMix(v: unknown): readonly MixEntry[] | undefined {
  if (!Array.isArray(v) || v.length === 0) return undefined
  const out: MixEntry[] = []
  for (const entry of v) {
    if (!isObject(entry) || typeof entry.type !== 'string') return undefined
    const count = numPair(entry.count)
    if (!count) return undefined
    out.push({ type: entry.type as MixEntry['type'], count })
  }
  return out
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
  const palette = parsePalette(v.palette)
  const subZones = parseSubZones(v.subZones)
  const formation = parseFormation(v.formation)
  const trees = parseTreeMix(v.trees)
  const crossings = parseCrossings(v.crossings)
  if (grid) out.grid = grid
  if (units) out.units = units
  if (nature) out.nature = nature
  if (buildings) out.buildings = buildings
  if (settlement) out.settlement = settlement
  if (palette) out.palette = palette
  if (subZones) out.subZones = subZones
  if (formation) out.formation = formation
  if (trees) out.trees = trees
  if (crossings) out.crossings = crossings
  return out
}

/** The served kinds of crossing. One with no tile is DROPPED: a crossing the backend could not describe is one
 *  the generator must not lay. None left means none served. */
function parseCrossings(v: unknown): Readonly<Record<string, GeneratorCrossing>> | undefined {
  if (!isObject(v)) return undefined
  const out: Record<string, GeneratorCrossing> = {}
  for (const [key, raw] of Object.entries(v)) {
    if (!isObject(raw) || !str(raw.tile)) continue
    const colorOf = str(raw.colorOf)
    out[key] = colorOf ? { tile: str(raw.tile)!, colorOf } : { tile: str(raw.tile)! }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** A served tree mix. An entry with no kind or no positive weight is DROPPED, not defaulted — a species the
 *  backend could not describe is one the generator must not plant. An empty mix is no mix at all. */
function parseTreeMix(v: unknown): readonly GeneratorTreeWeight[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: GeneratorTreeWeight[] = []
  for (const raw of v) {
    if (!isObject(raw)) continue
    const kind = str(raw.kind)
    const weight = num(raw.weight)
    if (kind && weight !== undefined && weight > 0) out.push({ kind, weight })
  }
  return out.length > 0 ? out : undefined
}

/** The served distribution, keeping only the numbers that arrived. A missing field means the backend has no
 *  opinion on it and the generator keeps its own default — never a number invented here. */
function parseFormation(v: unknown): GeneratorFormation | undefined {
  if (!isObject(v)) return undefined
  const out: GeneratorFormation = {}
  for (const k of ['lattice', 'spacing', 'understory'] as const) {
    const n = num(v[k])
    if (n !== undefined && n >= 0) out[k] = n
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** The served sub-zones. A row without a key or a usable weight is DROPPED rather than defaulted — a region
 *  the backend could not describe is one the generator must not invent a character for. */
function parseSubZones(v: unknown): readonly GeneratorSubZone[] | undefined {
  if (!Array.isArray(v)) return undefined
  const rows: GeneratorSubZone[] = []
  for (const raw of v) {
    if (!isObject(raw)) continue
    const key = str(raw.key)
    const weight = num(raw.weight)
    if (!key || weight === undefined || weight <= 0) continue
    const row: GeneratorSubZone = { key, weight }
    const name = str(raw.name)
    if (name) row.name = name
    for (const k of ['canopy', 'undergrowth', 'pools', 'stone'] as const) {
      const n = num(raw[k])
      if (n !== undefined) row[k] = n
    }
    const floor = str(raw.floor)
    if (floor) row.floor = floor
    const formation = parseFormation(raw.formation)
    if (formation) row.formation = formation
    const trees = parseTreeMix(raw.trees)
    if (trees) row.trees = trees
    rows.push(row)
  }
  return rows.length > 0 ? rows : undefined
}

/** The served palette, keeping only the fields that ARRIVED as colours. A malformed or missing entry is
 *  dropped rather than defaulted, so a layout can tell "the backend states no floor colour" from "the floor
 *  is this colour" and paint nothing rather than inventing one. */
function parsePalette(v: unknown): GeneratorPalette | undefined {
  if (!isObject(v)) return undefined
  const keys = ['floor', 'floorAlt', 'litter', 'canopy', 'canopyAlt', 'undergrowth', 'water', 'waterShallow', 'waterDeep', 'swamp', 'bank', 'trail'] as const
  const out: GeneratorPalette = {}
  for (const k of keys) {
    const hex = str(v[k])
    if (hex) out[k] = hex
  }
  return Object.keys(out).length > 0 ? out : undefined
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
    variant: str(v.variant) ?? null,
    zones: strList(v.zones) ?? [],
    position: num(v.position) ?? 0,
    config: parseConfig(v.config),
    options: parseOptions(v.options),
    children: (Array.isArray(v.children) ? v.children : [])
      .map(parseGenerator)
      .filter((g): g is GeneratorDef => g !== null)
      .sort((a, b) => a.position - b.position),
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
 * The generator that runs a given ARCHETYPE, optionally of a given shape.
 *
 * `findGenerator` takes a CATEGORY key, and that was the same thing as the variant until a town and a city
 * started sharing one category (Alexander, 2026-09-11: *"City and town options are the same, it'd put them in a
 * single category"*). A programmatic generate still asks for "town", so this resolves a row by what it RUNS
 * rather than by where it sits in the menu.
 *
 * A `layout` narrows it when the archetype has shapes (a forest has three). A catalog served before the variant
 * existed carries none, and then this falls back to the old category lookup, so nothing old breaks.
 */
export function findGeneratorForVariant(
  catalog: GeneratorCatalog,
  variant: string,
  layout?: string,
): GeneratorDef | undefined {
  const rows = catalog.flatMap(c => c.generators).filter(g => g.variant === variant)
  if (rows.length === 0) return findGenerator(catalog, variant, layout)
  if (layout === undefined) return rows[0]
  return rows.find(g => g.layout === layout) ?? rows[0]
}

/** Any generator in the catalog by its key, at any depth — how the editor finds the SUBTYPE that was picked. */
export function findGeneratorByKey(catalog: GeneratorCatalog, key: string): GeneratorDef | undefined {
  const search = (list: readonly GeneratorDef[]): GeneratorDef | undefined => {
    for (const g of list) {
      if (g.key === key) return g
      const hit = search(g.children ?? [])
      if (hit) return hit
    }
    return undefined
  }
  for (const category of catalog) {
    const hit = search(category.generators)
    if (hit) return hit
  }
  return undefined
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
