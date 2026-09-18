/**
 * The MAP-GENERATOR CATALOG, the backend's answer to "which worlds can I generate, and with what
 * knobs?" (`GET /api/generators`, T-113 / games-page UX §3.14b Tier-1 #1).
 *
 * Every number the generator used to hard-code in the frontend, * grid ranges, cell geometry, settlement tuning, nature densities, unit counts, building materials and
 * roof/wall colours, is a row in `generators` now (`Nebulith.Catalog.GeneratorSource`), served whole.
 *
 * This module is the CLIENT + the pure SELECTORS over it. It is deliberately dumb about the game:
 *
 *   - it NEVER invents a value. A category the backend does not serve does not exist; a config section
 *     the backend leaves out reads as `undefined`, and the caller plants nothing rather than falling
 *     back to a number this file made up (the no-fallback law, MAP-MODEL §8).
 *   - it NEVER lets a malformed row through as a half-object. A row missing a `key`/`name` is DROPPED
 *     with a warning, so a bad seed shows up as a missing menu entry, loud, instead of a silent
 *     default that looks generated.
 *
 * The catalog is the DATA behind the Generate panel (§4.6): season chips, map-type cards and the
 * per-type layouts are all read from here, so adding a generator is a seed row and nothing else.
 */
import type { MixEntry } from '@/engine/buildingTypes'
// The bloom shape a REGION can serve, imported rather than re-declared so the two cannot drift. Cycle-free:
// `zoneCatalog` imports only `nebulithApi`, and nothing in that chain reaches back here (checked, after a
// circular import through `render/shared` cost a rewrite earlier the same day).
import type { FlowerKind } from '@/engine/zoneCatalog'
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
 * A layout that needs it and does not get it plants nothing and says so, it must not invent a number.
 */
export interface GeneratorNature {
  groundCover: number
  flowers: number
  /** Share of cells carrying a tree. Only a woodland-style layout reads it. */
  canopy?: number
  /** Share of a meadow's open floor carrying tall grass. */
  tallGrass?: number
  /** Any other NUMBER the backend serves for this map's nature. The named fields above are the ones the
   *  engine reads today; this is what keeps a newly served one from being dropped before anything can. */
  readonly [served: string]: number | undefined
}

/** The per-building material + colour roll: residential picks from the lists, civic buildings are fixed. */
export interface GeneratorBuildings {
  /**
   * The ROOF TILE a residential building lays: `roof` (a gable), `roof_slate`, `flat_roof`.
   *
   * The roof SHAPE is baked into
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

/** Settlement density tuning, the street/lot rules that make a town a town and a city a city. */
export interface GeneratorSettlement {
  plazaSize: number
  roadWidth: number
  setback: number
  lotGap: readonly [number, number]
  maxPerFrontage: number
  buildingCap: number
  houseRange: readonly [number, number]
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
 * The COLOURS a template paints its ground and canopy with, what makes an Amazonas not a pine wood.
 *
 * Every colour in a forest used to come from the SEASON, so a spring jungle and a
 * spring woodland were painted from the same numbers and looked identical. This is per GENERATOR.
 *
 * Every field is optional because the backend is the authority on which templates state one. A template that
 * serves no palette gets no painting, never a colour invented here.
 */
export interface GeneratorPalette {
  /** The colour molten rock takes when a map's liquid is lava. Absent leaves lava looking like water, which
   *  is why it is served rather than assumed: the engine invents no colours. */
  lava?: string
  /** the shaded forest floor */
  floor?: string
  /** the second floor tone, for the mottling that stops a floor reading as one flat fill */
  floorAlt?: string
  /** leaf litter / bare earth showing through */
  litter?: string
  /** the canopy overhead. NOT a leaf colour: this is read as the floor tint of a jungle light gap. */
  canopy?: string
  canopyAlt?: string
  /**
   * THE BIOME'S FOLIAGE, the hue and saturation a leaf wears here. Its own brightness is not read; `leafValue`
   * sets that. Measured off his vegetation references, where every real one sits between 30 and 74 degrees.
   */
  leaf?: string
  /** How much the SEASON moves that hue. 1 fully deciduous (a woodland turns), 0 evergreen (a jungle does not). */
  leafSeasonality?: number
  /** Brightness multiplier on the season's shade. Below 1 darker (jungle), above 1 brighter (beach). */
  leafValue?: number
  /** The TILE this biome's open ground is made of (`sand`, `beach-sand`, `basalt`). Absent → the season's. */
  groundTile?: string
  /** the choked layer between the trunks */
  undergrowth?: string
  /** a watercourse, and the ground either side of it */
  water?: string
  /** Water by DEPTH: light blue for the wadeable edge, darker blues for the deep middle. */
  waterShallow?: string
  waterDeep?: string
  /** standing swamp water, blue-green, the only water allowed to lean green */
  swamp?: string
  bank?: string
  /** a walked route */
  trail?: string
}

/**
 * ONE SUB-ZONE a map is partitioned into, a region with its own character, not a template of its own.
 *
 * On the shape: regions inside ONE map. You walk from one into the next.
 *
 * `canopy` and `undergrowth` MULTIPLY the generator's served base densities rather than replacing them, so
 * the base stays the one knob that moves the whole map.
 */
/**
 * HOW THE TREES ARE DISTRIBUTED, the difference between a wood pasture, an even-aged stand and a closed
 * canopy, none of which is a matter of how MANY trees there are.
 *
 * with six photographs. Two numbers carry most of it: `lattice` is the scale of the noise the
 * canopy is scored against (small = fine scatter, large = big continuous masses) and `spacing` is the
 * minimum gap between trunks (0 lets them form a wall, 3+ makes every tree individually readable).
 */
/** One entry of a template's tree mix, which shape, and how often it is rolled. */
export interface GeneratorTreeWeight {
  kind: string
  weight: number
}

export interface GeneratorFormation {
  /** noise scale in cells, the "grouping" knob */
  lattice?: number
  /** minimum cells between two trunks */
  spacing?: number
  /** multiplies the served ground cover, how choked the floor is between the trunks */
  understory?: number
  /**
   * WHICH PLANT grows as that understory. Ticket 2: the pass could only ever plant `thicket`, the one tile
   * of 40 in the nature catalog that blocks, so a meadow grew waist-high walls wearing a plant picture.
   * Whether it blocks is the TILE's own business, read off its row; this only says which tile.
   */
  understoryTile?: string
}

/** One thing sprinkled along a pathway: a tile label and how much of the eligible ground takes it. */
export interface GeneratorPathwayDressing {
  /** The tile the backend serves for this, by label. Never a name this file invents. */
  tile: string
  /** Share of eligible cells that get one, 0..1. */
  rate: number
}

/**
 * WHAT A PATHWAY IS MADE OF, served per template.
 *
 * A pathway used to be a tint. A woodland trail swapped the ground for the flat floor tile and recoloured it,
 * and a meadow and a jungle did not even do that: their paths were the same `meadow` ground as the field
 * beside them, in a different colour. Width was `WOODLAND.pathWidth`, a constant in the engine, so a beach
 * lane, a rainforest machete trail and a city street came out as one 3-wide rectangle in three colours.
 *
 * Read off the references he gave, a pathway is four things and every one of them is data:
 * a MATERIAL, a WIDTH, an EDGE that is ragged wherever nobody laid a kerb, and what lies on it and stands
 * beside it. The lining is what tells you which place you are in before you have looked at anything else.
 */
export interface GeneratorPathwayMarking {
  /** The colour the line is painted in. A line is PAINT, so it is a colour, never a tile laid on the road. */
  color: string
  /** One dash every this many cells along the way. */
  every: number
}

export interface GeneratorPathway {
  /** The ground tile the way is paved with, by label (`path_dirt`, `gravel`, `wooden_planks`, `road`, …). */
  surface?: string
  /**
   * The COLOUR the way wears.
   *
   * It used to come from the template's `palette.trail`, and that is why a mountain forest's gravel was
   * painted the woodland's dirt and a swamp's boardwalk the jungle's: a template said what its way was made
   * of and the palette it inherited said what colour, and the palette won. The kind IS the look of the way,
   * so it carries the colour, and the palette is left owning the ground, the water and the shore.
   */
  tone?: string
  /** The line down the middle of a carriageway, where the way is one somebody painted. */
  marking?: GeneratorPathwayMarking
  /** How many cells across it runs. */
  width?: number
  /** How ragged the edge is: the share of its border cells the field takes back. 0 is a laid kerb. */
  edge?: number
  /** What lies ON the surface. Walkable, always: a pebble is not an obstacle. */
  scatter?: readonly GeneratorPathwayDressing[]
  /** What stands BESIDE it, on the field cells that touch it. This is what makes a path read as a corridor. */
  lining?: readonly GeneratorPathwayDressing[]
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
  /** this region's hue shift, in degrees: how much light reaches it (a glade takes the most). */
  leafHue?: number
  /** this region's brightness offset on the leaf, added after the biome's scale. */
  leafValue?: number
  /** the share of the region standing under water (a swamp's pools) */
  pools?: number
  /** the share of the region carrying fallen masonry (ruins) */
  stone?: number
  /**
   * The share of this region's PLOTS that carry a building, where the region is part of a settlement.
   *
   * A park, a market square, a green and a graveyard are all defined by open ground inside a built-up place,
   * and nothing could say so: every plot the planner laid got a house whatever neighbourhood it stood in.
   * Absent means fully built, which is what a settlement did before anyone could ask for less.
   */
  built?: number
  /**
   * This region's own ELEVATION in levels: 0 the walking floor, positive standing above it. The step between
   * two regions is a cliff.
   */
  level?: number
  /** this region's own tree distribution, a swamp is spaced like a pasture, dense growth is a wall */
  formation?: GeneratorFormation
  /** which species grow in this region, the swamp is cypress, whatever the rest of the jungle is */
  trees?: readonly GeneratorTreeWeight[]
  /**
   * Which BLOOMS grow in this region, overriding the season's set. A region could state its species and not its
    * flowers, so a swamp
   * planted summer's set, which carries a near-white. Absent means the season decides, as before.
   */
  flowers?: readonly FlowerKind[]
  /** Any other NUMBER the backend serves for this region. The named fields above are the ones the engine
   *  reads today; this is what keeps a newly served one from being dropped before anything can read it. */
  readonly [served: string]: unknown
  /**
   * What this region is BUILT of, where the region is part of a settlement rather than a wood.
   *
   * A city's neighbourhoods differ by money, and money shows in the architecture: stone under slate on one
   * side of town, timber under a flat roof on the other. Same shape as a row's own `buildings`, so a region
   * states only what makes it different from the city it sits in.
   */
  buildings?: Partial<GeneratorBuildings>
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
  /** How the regions above are laid on the map: `scatter`, `rings` or `bands` (`REGIONS.md` §2). */
  regionLayout?: string
  /** How this template distributes its trees. Absent → the generator's own default grouping. */
  formation?: GeneratorFormation
  /** What this template's pathways are made of. Absent → the engine's own plain track. */
  pathway?: GeneratorPathway
  /**
   * WHICH trees grow here. Absent → the global weighted table every template used to share.
   */
  trees?: readonly GeneratorTreeWeight[]
  /** What a river is crossed on, by kind. Absent → the classic bridge deck. */
  crossings?: Readonly<Record<string, GeneratorCrossing>>
  /** The heading each option GROUP shows, keyed by the group name its options carry. Served so the panel
   *  spells no heading of its own; absent → the options render ungrouped, exactly as they did. */
  optionGroups?: Readonly<Record<string, string>>
}

/** One generator, a concrete map the user can ask for ("Meadow + River", "Town"). */
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
   * category held one kind. so a row says what it runs. Null on a payload from before this existed, and the caller
   * then falls back to the category key exactly as it used to.
   */
  variant: string | null
  /** The seasons this generator runs in, the season chips are the union of these. */
  zones: readonly string[]
  position: number
  config: GeneratorConfig
  /**
   * What a person may switch ON for this generator.
   *
   * A river used to be a second row
   * (`Woodland + River`); it is an option on Woodland now. DECLARED by the backend, so the panel renders
   * whatever exists without knowing any option by name.
   */
  options: readonly GeneratorOption[]
  /**
   * Its SUBTYPES, any depth, Each arrives with
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
 * One kind of river crossing: the tile its deck lays, and optionally the tile whose COLOUR it wears.
 * 2026-09-11:
 * A dirt path is the flat floor in the dirt path's colour; a bridge is its own textured tile.
 */
export interface GeneratorCrossing {
  tile: string
  colorOf?: string
  /**
   * The COMPOSITION this kind of crossing builds, without its span: `bridge_wood`, and the generator appends
   * the span it needs (`bridge_wood_5`), the same shape as `house_3`/`house_4`/`house_5`.
   *
   * Absent means this crossing is not a structure. A dirt path names none on purpose: it is a path, not a
   * bridge. `tile` stays for both: it is what a crossing lays
   * when no composition of the needed span is loaded, which keeps a map generating rather than leaving a gap.
   */
  composition?: string
}

/** What an option holds: a toggle is on/off, a choice is the key of the picked value. */
export type GeneratorOptionValue = boolean | string

export interface GeneratorOption {
  key: string
  label: string
  /**
   * `toggle` is on/off. `choice` picks one of `choices`. The river is a choice because its COURSE is what
   * gets steered (traversable, dividing the map, or around the edge), which an on/off cannot say.
   */
  type: 'toggle' | 'choice'
  default: GeneratorOptionValue
  choices?: readonly GeneratorChoice[]
  /** Meaningless without that option, a crossing needs a river. Stated here, not known by the frontend. */
  requires?: string
  /**
   * WHICH GROUP this option is browsed under (`layout`, `water`, `crossings`). Its heading comes from the
   * generator's own `optionGroups`, so the panel spells nothing itself.
   *
   * The seven options are not siblings: depth, bridge and the water look are all settings OF the river and
   * read as peers of it in a flat list, which is what he called unclear. See `docs/EDITOR-UX.md` §2.1.
   */
  group?: string
  /**
   * CELLS ONE OF THESE WANTS before another is offered, for the options that are a COUNT. A choice of N is
   * offered while `cols * rows >= N * maxPer`.
   *
   * *"I want to have dynamic pathways limits based of size of the grid"*. Four ways across a 30x24 is a
   * different map from four across a 120x90, and the list was the same for both. The rate is served rather
   * than computed here: the frontend narrows the list, it does not own the arithmetic's constants.
   */
  maxPer?: number
  /**
   * SHOW A PICTURE OF EACH CHOICE rather than a dropdown of words.
   *
   * *"we see the preview of the element like we do on objects"*. True for the options whose choices are
   * visibly different things (a river's course, a kind of crossing, a look of water) and absent for the ones
   * that are counts, where two thumbnails would be near identical and cost a map generation each.
   *
   * Served, not decided in the panel, so turning it on for another option is a data change.
   */
  preview?: boolean
}

/**
 * The choices of a COUNT option that a map this size can actually carry, and why the rest are gone.
 *
 * Non-numeric choices (`random`, `none`) always survive: they are not counts and the size says nothing about
 * them. An option with no `maxPer` is not a count at all and is returned untouched. The first choice is never
 * dropped, so a map can always be built.
 */
export function choicesForSize(opt: GeneratorOption, cols: number, rows: number): readonly GeneratorChoice[] {
  const picks = opt.choices ?? []
  if (!opt.maxPer || picks.length === 0) return picks
  const cells = Math.max(0, cols) * Math.max(0, rows)
  const fits = picks.filter(c => {
    const n = Number(c.key)
    return !Number.isFinite(n) || n <= 0 || cells >= n * (opt.maxPer as number)
  })
  return fits.length > 0 ? fits : [picks[0]]
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
    const { key, label, type, default: fallback, requires, choices, group, maxPer, preview } = row as Record<string, unknown>
    if (typeof key !== 'string' || typeof label !== 'string') {
      console.warn('[generators] an option with no key or label was dropped', row)
      continue
    }
    const need = {
      ...(typeof requires === 'string' ? { requires } : {}),
      ...(typeof group === 'string' ? { group } : {}),
      ...(typeof maxPer === 'number' && maxPer > 0 ? { maxPer } : {}),
      ...(preview === true ? { preview: true } : {}),
    }
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

/** A category, the user-facing MAP TYPE (Forest, Town, City, Cave, Temple) and its generators. */
export interface GeneratorCategoryDef {
  key: string
  name: string
  description: string | null
  position: number
  generators: readonly GeneratorDef[]
}

/** The whole catalog, in menu order. */
export type GeneratorCatalog = readonly GeneratorCategoryDef[]

/** No catalog. What the editor holds before the load resolves and after it fails, an honestly EMPTY
 *  menu, never a stand-in list of map types the backend may not actually have. */
export const EMPTY_GENERATOR_CATALOG: GeneratorCatalog = []

// ── parsing: narrow `unknown` without inventing anything ─────────────────────

type Json = Record<string, unknown>

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/** A list of strings, or undefined when the value is not a string array, never a partial list. */
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
  // EVERY NUMBER THE BACKEND SERVES, not the three this file happens to name.
  //
  // It listed them by hand, so a served fourth was dropped here in silence with nothing failing to say so.
  // Measured: every meadow template serves `nature.tallGrass`, and `scatterTallGrass` reads
  // `ctx.nature?.tallGrass` and returns immediately when it is undefined. It always was. A meadow has never
  // grown a single blade of the tall grass it asks for, and the pass that does it has been dead code.
  //
  // Same shape of defect as `parseSubZones` and `parseBuildings` before it, and the same fix: copy what
  // arrives. `canopy` stays spelled out because a layout tells "served zero" from "not served at all".
  const rest: Record<string, number> = {}
  for (const [field, value] of Object.entries(v)) {
    if (field === 'groundCover' || field === 'flowers') continue
    const n = num(value)
    if (n !== undefined) rest[field] = n
  }
  return { ...rest, groundCover, flowers } as GeneratorNature
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

/**
 * A REGION'S buildings, which is an OVERLAY and not a whole palette.
 *
 * `parseBuildings` demands `storeRoof`, `hospitalRoof` and `fixedWall` as well as the three lists, and those
 * are MAP-level identity: the colours that keep a store looking like a store anywhere in town. A
 * neighbourhood has no business restating them, and does not: all eleven city templates serve their regions
 * exactly `materials`, `roof`, `roofColors` and `wallColors`.
 *
 * So every one of them was parsed and dropped, and every city came out architecturally uniform while the data
 * describing three classes of neighbourhood sat there being served. The type says what the shape should have
 * been all along: *"a region states only what makes it different from the city it sits in"*.
 */
function parseBuildingOverlay(v: unknown): Partial<GeneratorBuildings> | undefined {
  if (!isObject(v)) return undefined
  const out: Partial<GeneratorBuildings> = {}
  const materials = strList(v.materials)
  const roofColors = strList(v.roofColors)
  const wallColors = strList(v.wallColors)
  const roof = str(v.roof)
  const storeRoof = str(v.storeRoof)
  const hospitalRoof = str(v.hospitalRoof)
  const fixedWall = str(v.fixedWall)
  if (materials) out.materials = materials
  if (roofColors) out.roofColors = roofColors
  if (wallColors) out.wallColors = wallColors
  if (roof) out.roof = roof
  if (storeRoof !== undefined) out.storeRoof = storeRoof
  if (hospitalRoof !== undefined) out.hospitalRoof = hospitalRoof
  if (fixedWall !== undefined) out.fixedWall = fixedWall
  return Object.keys(out).length > 0 ? out : undefined
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
  const houseWidths = Array.isArray(v.houseWidths) && v.houseWidths.every(x => typeof x === 'number')
    ? (v.houseWidths as number[])
    : undefined
  if (plazaSize === undefined || roadWidth === undefined || setback === undefined) return undefined
  if (maxPerFrontage === undefined || buildingCap === undefined || natureMultiplier === undefined) return undefined
  if (!lotGap || !houseRange || !houseWidths) return undefined
  const mix = parseMix(v.mix)
  const streets = typeof v.streets === 'string' && v.streets !== '' ? v.streets : undefined
  return {
    plazaSize, roadWidth, setback, lotGap, maxPerFrontage,
    buildingCap, houseRange, houseWidths, natureMultiplier,
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
  const pathway = parsePathway(v.pathway)
  const trees = parseTreeMix(v.trees)
  const crossings = parseCrossings(v.crossings)
  // SERVED, so it has to be READ. This parser is a whitelist, and a key it does not name is dropped on the
  // floor: that is the served-and-ignored defect this file has produced more than once (the palette's `leaf`,
  // a woodland's regions). `regionLayout` says whether a set is a scatter, rings or bands (`REGIONS.md` §2).
  const regionLayout = typeof v.regionLayout === 'string' && v.regionLayout !== '' ? v.regionLayout : undefined
  const optionGroups = isObject(v.optionGroups)
    ? Object.fromEntries(Object.entries(v.optionGroups).flatMap(([k, label]) => (typeof label === 'string' ? [[k, label]] : [])))
    : undefined
  if (optionGroups && Object.keys(optionGroups).length > 0) out.optionGroups = optionGroups
  if (grid) out.grid = grid
  if (units) out.units = units
  if (nature) out.nature = nature
  if (buildings) out.buildings = buildings
  if (settlement) out.settlement = settlement
  if (palette) out.palette = palette
  if (subZones) out.subZones = subZones
  if (regionLayout) out.regionLayout = regionLayout
  if (formation) out.formation = formation
  if (pathway) out.pathway = pathway
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
    const entry: GeneratorCrossing = { tile: str(raw.tile)! }
    const colorOf = str(raw.colorOf)
    if (colorOf) entry.colorOf = colorOf
    // THE COMPOSITION, read here or it is dead data. The backend began naming one per bridge kind on
    // 2026-09-12; a parser that lists its keys by hand drops any new served field silently, which
    // `parseSettlement` and `parseBuildings` have each done before. Built up field by field rather than as a
    // nested ternary so the next served key cannot be forgotten the same way.
    const composition = str(raw.composition)
    if (composition) entry.composition = composition
    out[key] = entry
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** A served tree mix. An entry with no kind or no positive weight is DROPPED, not defaulted, a species the
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

/** A region's served BLOOM set. Mirrors `parseTreeMix` exactly: an entry missing its mark or its colour is
 *  DROPPED rather than defaulted, because a bloom the backend could not describe is one the generator must not
 *  plant, and an empty set is no set at all (the season then decides). */
function parseFlowerSet(v: unknown): readonly FlowerKind[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: FlowerKind[] = []
  for (const raw of v) {
    if (!isObject(raw)) continue
    const char = str(raw.char)
    const color = str(raw.color)
    if (char && color) out.push({ char, color })
  }
  return out.length > 0 ? out : undefined
}

/** The served distribution, keeping only the numbers that arrived. A missing field means the backend has no
 *  opinion on it and the generator keeps its own default, never a number invented here. */
function parseFormation(v: unknown): GeneratorFormation | undefined {
  if (!isObject(v)) return undefined
  const out: GeneratorFormation = {}
  for (const k of ['lattice', 'spacing', 'understory'] as const) {
    const n = num(v[k])
    if (n !== undefined && n >= 0) out[k] = n
  }
  const tile = v.understoryTile
  if (typeof tile === 'string' && tile.length > 0) out.understoryTile = tile
  return Object.keys(out).length > 0 ? out : undefined
}

/** The served dressing rows. A row with no tile or no usable rate is DROPPED rather than defaulted: a thing
 *  the backend could not name is not one the generator may choose for it. */
function parseDressing(v: unknown): readonly GeneratorPathwayDressing[] | undefined {
  if (!Array.isArray(v)) return undefined
  const rows: GeneratorPathwayDressing[] = []
  for (const raw of v) {
    if (!isObject(raw)) continue
    const tile = str(raw.tile)
    const rate = num(raw.rate)
    if (!tile || rate === undefined || rate <= 0) continue
    rows.push({ tile, rate })
  }
  return rows.length > 0 ? rows : undefined
}

/** The served centre line. Both halves are required: a marking with no colour has nothing to paint and one
 *  with no rhythm has no shape, and neither is something this file may decide. */
function parseMarking(v: unknown): GeneratorPathwayMarking | undefined {
  if (!isObject(v)) return undefined
  const color = str(v.color)
  const every = num(v.every)
  if (!color || every === undefined || every < 1) return undefined
  return { color, every: Math.round(every) }
}

/** The served pathway block. An absent field stays absent, so the generator keeps what it did before for it
 *  rather than being handed a number this file made up. */
function parsePathway(v: unknown): GeneratorPathway | undefined {
  if (!isObject(v)) return undefined
  const out: GeneratorPathway = {}
  const surface = str(v.surface)
  if (surface) out.surface = surface
  const tone = str(v.tone)
  if (tone) out.tone = tone
  const marking = parseMarking(v.marking)
  if (marking) out.marking = marking
  const width = num(v.width)
  if (width !== undefined && width >= 1) out.width = Math.round(width)
  const edge = num(v.edge)
  if (edge !== undefined && edge >= 0 && edge <= 1) out.edge = edge
  const scatter = parseDressing(v.scatter)
  if (scatter) out.scatter = scatter
  const lining = parseDressing(v.lining)
  if (lining) out.lining = lining
  return Object.keys(out).length > 0 ? out : undefined
}

/** The region fields this parser reads by NAME, so the sweep below knows which ones it has already taken. */
const SUBZONE_NAMED = new Set(['key', 'name', 'weight', 'floor', 'formation', 'trees', 'flowers', 'buildings'])

/** The served sub-zones. A row without a key or a usable weight is DROPPED rather than defaulted, a region
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
    const buildings = parseBuildingOverlay(raw.buildings)
    if (buildings) row.buildings = buildings
    // EVERY NUMBER THE BACKEND SERVES FOR THIS REGION, not the five this file happens to list.
    //
    // It named them by hand, which makes the frontend the place that decides which of the backend's own
    // fields exist: serve a sixth and it is dropped here in silence, with nothing failing to say so. The
    // comment below records that `parseSettlement` and `parseBuildings` have each already lost a newly
    // served field this exact way. Copying whatever arrives means the backend can describe a region however
    // it needs to and the frontend carries it through without being edited.
    for (const [field, value] of Object.entries(raw)) {
      if (SUBZONE_NAMED.has(field)) continue
      const n = num(value)
      if (n !== undefined) (row as Record<string, unknown>)[field] = n
    }
    const floor = str(raw.floor)
    if (floor) row.floor = floor
    const formation = parseFormation(raw.formation)
    if (formation) row.formation = formation
    const trees = parseTreeMix(raw.trees)
    if (trees) row.trees = trees
    // READ HERE or it is dead data. This parser lists its keys by hand, and `parseSettlement` and
    // `parseBuildings` have each silently dropped a newly served field for exactly that reason.
    const flowers = parseFlowerSet(raw.flowers)
    if (flowers) row.flowers = flowers
    rows.push(row)
  }
  return rows.length > 0 ? rows : undefined
}

/** The served palette, keeping only the fields that ARRIVED. A malformed or missing entry is dropped rather
 *  than defaulted, so a layout can tell "the backend states no floor colour" from "the floor is this colour"
 *  and paint nothing rather than inventing one.
 *
 *  EVERY FIELD THE BACKEND SERVES, not the thirteen this file happened to list. It named them by hand, which
 *  made the frontend the place that decides which of the backend's own palette fields exist, and the failure
 *  is silent: `leaf`, `leafSeasonality` and `leafValue` were served on 36 generators, curled correctly off
 *  `/api/generators`, and arrived at the generator as a palette with twelve keys and none of those three.
 *  Every tree on every map then wore its season shade with no biome in it, which looks exactly like a colour
 *  bug and is a parser dropping data.
 *
 *  `parseSubZones` already solved this the same way and says so in its own comment, naming `parseSettlement`
 *  and `parseBuildings` as having each lost a newly served field like this before. This is the fourth. */
function parsePalette(v: unknown): GeneratorPalette | undefined {
  if (!isObject(v)) return undefined
  const out: Record<string, string | number> = {}
  for (const [field, value] of Object.entries(v)) {
    // A palette entry is a COLOUR or a NUMBER (how seasonal the foliage is, how bright). Anything else is
    // not something a palette says, so it is dropped rather than carried as an unknown shape.
    const hex = str(value)
    if (hex) { out[field] = hex; continue }
    const n = num(value)
    if (n !== undefined) out[field] = n
  }
  return Object.keys(out).length > 0 ? (out as GeneratorPalette) : undefined
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
 * NAMED in a warning, a bad seed must be visible in the console, not silently smoothed over.
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

/** Load the whole catalog (called once on editor mount). Throws on a non-ok response, the caller shows
 *  the failure; it must never render a made-up menu in its place. */
export async function fetchGeneratorCatalog(): Promise<GeneratorCatalog> {
  const res = await fetch(BASE)
  if (!res.ok) throw new Error(`Failed to load the generator catalog: ${res.statusText}`)
  return parseGeneratorCatalog(await res.json())
}

// ── selectors ────────────────────────────────────────────────────────────────

/** Every season the catalog offers, first-seen order, the union of the generators' own `zones`, so a
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

/** A LAYOUT choice the user picks within a map type, a generator that names a shape. `id` is the
 *  generator's `layout` (what the engine is asked for), `label` its display name. */
export interface CatalogLayout {
  id: string
  label: string
}

/** The layouts a map type offers, in menu order. A category whose generators name no layout offers NO
 *  choice (one generator, no shape), the menu then shows no layout group, as DATA, never a
 *  `key === 'forest'` branch. */
export function categoryLayouts(catalog: GeneratorCatalog, categoryKey: string): CatalogLayout[] {
  const category = findCategory(catalog, categoryKey)
  if (!category) return []
  const out: CatalogLayout[] = []
  // A CARD IS A ROW, identified by that row's KEY.
  //
  // It was identified by its `layout`, which names the ENGINE BUILDER, and that was the same thing as the row
  // only while every row had a builder of its own. It no longer is: a type is an ENVIRONMENT now, and nine
  // wilderness environments share three builders between them, so a swamp and a jungle and a beach all say
  // `layout: "jungle"`. Keyed by layout, picking Swamp resolved to the first row that says jungle, which is
  // the Jungle, and the person got a different world from the one they clicked with nothing to tell them.
  for (const generator of category.generators) out.push({ id: generator.key, label: generator.name })
  return out
}

/**
 * The generator to RUN for a (map type, layout) pair.
 *
 * A named layout selects its generator exactly; no layout takes the category's first (lowest-position)
 * generator. A layout the category does not carry resolves to nothing, the caller must not silently
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
  // THE ROW'S KEY FIRST, because that is what a card carries now and it names exactly one row. A layout still
  // resolves for a caller that has one, and it takes the first row that runs it, which is all a layout can
  // ever mean when several rows share one.
  return category.generators.find(g => g.key === layout) ?? category.generators.find(g => g.layout === layout)
}

/**
 * The generator that runs a given ARCHETYPE, optionally of a given shape.
 *
 * `findGenerator` takes a CATEGORY key, and that was the same thing as the variant until a town and a city
 * started sharing one category. A programmatic generate still asks for "town", so this resolves a row by what it RUNS
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
  // A ROW'S KEY RESOLVES IT EXACTLY; a layout only narrows to the first row that runs that builder, which is
  // all a layout can mean once several rows share one.
  return rows.find(g => g.key === layout) ?? rows.find(g => g.layout === layout) ?? rows[0]
}

/** Any generator in the catalog by its key, at any depth, how the editor finds the SUBTYPE that was picked. */
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
 * seeded generate path does. Undefined when the generator carries no grid, the caller keeps the grid
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
 * It used to be exposed here as guidance the panel printed, and before that as a CAP.
 * So neither the cap nor the note survives, and with no caller left the
 * accessors are deleted rather than kept "just in case", the range is read where it is rolled.
 */

/** One integer in an inclusive range. A reversed/degenerate range yields its `min` rather than NaN. */
function rollRange(range: GridRange, r: number): number {
  const span = Math.max(0, Math.floor(range.max) - Math.floor(range.min))
  return Math.floor(range.min) + Math.floor(r * (span + 1))
}

/** One headed section of the options panel: a group's label and the options that belong to it. */
export interface GeneratorOptionSection {
  key: string
  label: string
  options: readonly GeneratorOption[]
}

/**
 * THE OPTIONS, GROUPED THE WAY THE GENERATOR SAYS.
 *
 * Order comes from the options themselves, so a group appears where its first option does and the panel never
 * carries a list of group names to sort by. A generator that serves no groups gets one section called
 * "Options", which is exactly what the panel drew before groups existed.
 *
 * A group with no served label falls back to the group's own key rather than being hidden: a missing label is
 * a data gap worth seeing, not a reason to drop the controls.
 */
export function optionSections(gen: GeneratorDef | null | undefined): readonly GeneratorOptionSection[] {
  const options = gen?.options ?? []
  if (options.length === 0) return []
  const labels = gen?.config.optionGroups ?? {}
  const sections: GeneratorOptionSection[] = []
  for (const opt of options) {
    const key = opt.group ?? ''
    const found = sections.find(s => s.key === key)
    if (found) {
      ;(found.options as GeneratorOption[]).push(opt)
      continue
    }
    sections.push({ key, label: key === '' ? 'Options' : labels[key] ?? key, options: [opt] })
  }
  return sections
}

/** How many choices this map's size takes off the lists, across every option. 0 when nothing was narrowed,
 *  which is what lets the panel say so only when it is true. */
export function trimmedBySize(gen: GeneratorDef | null | undefined, size: { cols: number; rows: number }): number {
  return (gen?.options ?? []).reduce(
    (n, opt) => n + ((opt.choices?.length ?? 0) - choicesForSize(opt, size.cols, size.rows).length),
    0,
  )
}
