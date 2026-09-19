/**
 * Stage generator for Nebulith (GENERATION-SPEC §3).
 *
 * Turns a small input, (zone, variant), into coherent StageData: themed
 * ground, archetype layouts (modeled on real reference levels), collision
 * (blocks are logical, not elevation), props, and a walkable spawn.
 *
 * Pure logic (no rendering, no IsometricGrid mutation) so it is unit-testable
 * and reusable by the editor, the template mapper, and the eventual AI generator.
 */
import { classifyBody, DEFAULT_LIQUID, isMolten, type Liquid, LIQUIDS, paintWaterBody, setForLiquid, waterBodies, type WaterSet } from './waterBody'
import { styleCatalog, styleTile } from '@/engine/tileset/styleTiles'
import { type BuildingType } from './buildingTypes'
import { buildingCompositionKind, buildingDoorOffset, compositionFootprint, facingRotation, isRoadGround, rotateFootprintOffset } from './buildingCatalog'
import { composedKind } from '@/lib/buildingSizes'
import { type BuildingSizes, type SettlementTuning, planVillage, streetRoom, type VillageLayout, type Settlement, type Plot, type Facing, type PlazaRect, type StreetPlan } from './villageLayout'
// The planner is pure: it takes the building sizes rather than reading them. They come from the BACKEND
// compositions (buildingCatalog resolves them), so deepening a building in Elixir moves the plots with it.
import { BACKEND_BUILDING_SIZES } from './buildingCatalog'
import { type GeneratorCrossing, type GeneratorFormation, type GeneratorPalette, type GeneratorPathway, type GeneratorSubZone, type GeneratorTreeWeight, type GeneratorOptionValue } from '@/lib/generatorCatalog'
import {
  stagePropTileOverride,
  zonePalette,
  ZoneId,
  zoneFlowers,
  defaultFlowers,
  type FlowerKind,
  type LivingTreeKind,
  livingTreeVariants,
  livingTreeWeight,
  rockShades,
  caveDecor,
  mushroomTones,
  propArt,
  type TemplePalette,
  templePalette,
  type CavePalette,
  cavePalette,
} from './zones'
// Re-exported so the generator keeps its public tree-shape type (backend palette data now owns it).
export type { LivingTreeKind } from './zones'
import { autotileLabel, autotilePosition, type CellLabel, type MassFamily } from './cellLabels'
import { resolveTile, resolveComposition, canopyCount, canopyShade, pickGroundDecor, type TileDisplay } from './tileset/tileset'
import { foliageColor } from './foliageColor'
import { groundKind } from '@/game/artStyle'
import { resolveTileHeight } from './tileset/tileHeight'

/** The block height of the FLOOR tile at a ground slug, a floor is a TILE, so this is the shared height
 *  primitive (`resolveTileHeight`), read style-identically from the ascii twin. The SAVE path bakes it as the
 *  level a stamped composition/prop lands at, because it serializes StageData WITHOUT a grid; the LIVE path gets
 *  the identical value from the real stack (`cellStackTop`). No `floorStackLift` special case, just a tile's height. */
function groundBlockHeight(slug: string): number {
  return resolveTileHeight(styleTile('ascii', slug) ?? styleTile('ascii', groundKind(slug)), undefined)
}
// The ONE per-cell mapping the live composition stamp uses, the save path expands its anchors through it too,
// so a generated stage RELOADS exactly as it was stamped (height / z-width / scale / pose / animations).
import { compositionCellRender } from '@/game/runtime/composition'
import { flood, forEachCell, inBounds, isEdge, toCell, ORTHO, type Cell } from './grid'
import { darkenColor, varyIntensity } from './colors'
import { groundTileColor } from './tileset/groundColor'
import type { Connector } from '@/lib/api'
import { clamp, randInt, randIntWith, manhattan, makeRng, type Rng } from '@/lib/math'
import { runLayers, type StageLayer } from '@/engine/generate/pipeline'
import { generationLayerKeys } from '@/engine/generate/generationLayers'
import { isTileCategory, TILE_CATEGORY } from '@/engine/tileset/tileCategory'
import { planRoutes, resolvePathways, type Gate, type RouteCell, type RoutePlan, type Side, type Pathways } from '@/engine/pathNetwork'
import {
  carveBody, carveChannel, carveShore, crossingRefused, crossingStyle, deckRoutes, levelTheWater, flowField, isWaterGround, layDeck, recordBridgeSpan, wadeCrossing, WATER_BANDS,
  narrowestLine, narrowPathwaysToCrossings, resolveRiverCourse, CROSSING_ROWS, settleWaterDepth, strewRiverRocks, wadeableShallows, waterBand, waterReach,
  FLOW_STEPS, type RiverCourse,
} from '@/engine/riverNetwork'

export type VariantId = 'town' | 'city' | 'forest' | 'cave' | 'temple' | 'boss-stage'

/**
 * The independent GENERATION LAYERS a stage is built from, the "macro" randomize scopes the user
 * steers (whole map vs just this layer). Each maps to a seedable pass over the current grid:
 *   pathways     , how many exits the map has, where its gates sit and where its paths run. FIRST: everything
 *               below is built around it.
 *   layout   , terrain/ground distribution + roads/plots (the "map without structures nor nature"),
 *   buildings, the compositions stamped on the layout's plots,
 *   nature   , trees / bushes / flowers / ground cover,
 *   decor    , small props (plaza centrepiece, lamp posts),
 *   units    , enemy/npc scatter (owned by the editor's entity store, not the generator).
 * A given layer re-rolls in isolation by handing it a fresh seed while the others keep theirs.
 */
/** A layer's id. A STRING, because the list is backend data: *"I just don't want anything hardcoded on the
 *  frontend … we're also hardcoding on the actual engine, that's where we need to update it"*. A union type
 *  here would be exactly that hardcoding, and adding a fog layer would mean editing this file. */
export type LayerId = string

/** Every layer the backend serves, in run order. Empty until the catalog answers, which is the honest state:
 *  no served layers means no layers, never a list this file kept for the occasion. */
export const layerIds = (): readonly LayerId[] => generationLayerKeys()

/** The engine-owned layers (units are scattered by the editor). Each pass draws from its own seedable rng so
 *  one layer re-rolls without disturbing the others. A string for the same reason `LayerId` is. */
export type EngineLayerId = LayerId

/** Layer key → its rng. Built per generate from whatever the backend serves, so a layer added there has a seed
 *  here without this file learning its name. A key with no seed falls back to the shared rng, which is what an
 *  unseeded generate always did. */
type LayerRngs = Record<EngineLayerId, Rng>

/** General forest LAYOUT the user steers; the generator randomizes the rest. The old passages/open/lake
 * generators were RETIRED, the forest now builds one of the meadow layouts, and a plain generate
 *  with no explicit layout RANDOMLY picks one (seeded). All are registered in the forest layout table. `meadow_pass` is a
 *  NEW variation: the open meadow opened on TWO opposite edges (top + bottom) for a through-route map (#26). */
export type ForestLayout = 'woodland' | 'jungle' | 'meadow' | 'meadow_pass'

export interface StageProp {
  col: number
  row: number
  type: string
  char: string
  blocking: boolean
  color: string
  /** generator-marked tree-base cell → always casts a ground shadow (even when another
   *  tree sits directly below it). */
  baseShadow?: boolean
  /**
   * THIS PROP GREW HERE, so a pass that clears a pathway may pull it out.
   *
   * A hand-written list of type names was tried and it is the wrong shape twice over: it goes stale when a
   * plant is added, and no served field can replace it, because `rock` and `key` are BOTH `category: nature`
   * while one is scenery and the other is a temple's puzzle. Only the thing that PLANTED it knows which it
   * is, so the planter says so, the way `baseShadow` already does.
   *
   * Absent means structure: an altar, a door, a key, a wall. Clearing those broke three temple tests when a
   * name list tried to guess.
   */
  grows?: boolean
  /** Cell-label naming this cell's part (e.g. tree_leaf_top, tree_interior).
   *  Drives per-label collision + the eventual ASCII→tileset mapping. */
  label?: string
  /** For building cells: the building's TYPE (store/hospital/…), so the render can
   *  badge the apex (a "STORE" marquee, a red hospital cross). */
  buildingType?: string
  /** For building cells: the cell's corner/edge/interior class within the footprint
   *  rect (nw/n/ne/w/interior/e/sw/s/se), the directional info a tileset maps. */
  edge?: BuildingEdge
  /** For the town-square fountain: the side (in cells) of the square basin this ONE prop spans,
   *  centred on its cell. Lets the render draw a SINGLE big fountain over the whole plaza instead of
   *  one mini-structure per cell. Absent on every other prop. */
  footprint?: number
  /** Per-cell iso block height (default extrusion): a building WALL cell rises `floors` blocks; flat
   *  cells (door/ground) are 0. Drives the tile-block render (2D+3D tileset model). */
  height?: number
}

export interface PlacedBuilding {
  type: BuildingType
  col: number
  row: number
  /** Footprint GRID col-span (= road-parallel length for south/north, = depth for east/west). */
  length: number
  /** Footprint GRID row-span (= depth for south/north, = road-parallel length for east/west). */
  height: number
  /** Logical GROUND depth (perpendicular to the facade), drives the iso box z-extrusion and is
   *  DECOUPLED from the facade's vertical elevation (`facade.height`). */
  depth: number
  /** The planner's road-derived facing, the building composition is stamped rotated to face this road. */
  facing: Facing
  doorCells: { col: number; row: number }[]
  /** The backend composition NAME (e.g. `house_4`, `store_5`) this plot stamps, the data-driven
   *  replacement for the retired `facade: ComposedBuilding`. applyStageToGrid stamps it via
   *  stampBuildingComposition, rotated to `facing`. */
  kind: string
  /**
   * THE NEIGHBOURHOOD THIS ONE STANDS IN, when the map has neighbourhoods.
   *
   * A city's `upper` is stone under slate and its `lower` is timber under a flat roof, and that is served per
   * region. It was resolved at STAMP time by looking the region up again from the cell, so the stage itself
   * carried no record of it: nothing downstream could tell two neighbourhoods apart, and neither could a
   * test. The generator decides it, so the generator writes it.
   */
  region?: string
  /** The ROOF this neighbourhood builds under, where it states one. The most visible half of "different
   *  architecture": a gable, a slate pitch and a flat deck do not read alike from above. */
  roof?: string
  /** And what its WALLS are made of. */
  material?: string
}

/** A TREE anchor, the trunk-base cell + which composition (tree / tree_dead) + its canopy shade. The
 *  generator RECORDS these (it does not bake flat tree props); at load applyStageToGrid re-stamps each via
 *  stampComposition into per-cell heightLevel-stacked DB tiles, the SAME model buildings use (a PlacedBuilding
 *  is stamped by stampBuildingComposition). That makes every tree tile individually SELECTABLE + backend-driven. */
export interface TreeAnchor {
  col: number
  row: number
  /** A living-tree SHAPE variant (2-tile trunk+leaf composition: standard / tall / small / round, or a
   *  trunkless bush) picked by pickLivingTree so a stand shows variety, used for ALL living trees (glade AND
   *  forest-mass). tree_dead = a leafless snag, UNCHANGED (kept blocking so dead trees still obstruct). */
  kind: LivingTreeKind | 'tree_dead'
  variant: number
  /**
   * The colour THIS tree's leaves wear, resolved at plant time from its season shade, its biome and the
   * region it stands in (see `foliageColor`). Absent leaves the composition's own authored colour, which is
   * what every tree did before a generator served any foliage palette.
   */
  leafColor?: string
}

/** A generic COMPOSITION anchor, a named backend composition (fountain / …) stamped at load, the SAME
 *  path trees + buildings use (stampComposition). The generator RECORDS these instead of baking special
 *  props, so a fountain is a stamped composition (rim + water + jets), not a `type:'fountain'` prop. */
export interface CompositionAnchor {
  kind: string
  col: number
  row: number
  variant?: number
  /**
   * CW QUARTER-TURNS (0-3) this composition is stamped at, the same rotation a building gets from
   * `facingRotation(facing)`. Absent means 0, which is every composition recorded before bridges existed, so
   * nothing that was unrotated changes.
   *
   * A bridge needs it: it is authored span x 3 running along +dx, so a river crossed on the other axis has to
   * turn. The stamp has always supported rotation (`stampComposition`'s 7th argument, which is how a house
   * faces its road); it was the ANCHOR that could not express one, and both readers hardcoded 0. Threading it
   * through `applyStageToGrid` alone would have left a placed bridge straightening itself on reload, so the
   * save path (`stageToTemplate` -> `anchorAssets`) reads the same field.
   */
  rotation?: number
  /**
   * THE LEVEL THIS COMPOSITION'S OWN LEVEL 0 SITS AT, absolutely. Absent means "rest on the cell stack", which
   * is every composition but a crossing.
   *
   * The lego rule is that an object stacks on whatever fills its anchor cell, and it holds for everything that
   * STANDS on the map. A bridge does not stand on what is under it, it SPANS it, so reading its height off
   * the contents of one anchor cell gives a different answer on every map: measured across three woodland
   * seeds, the same bridge came out at levels 4 to 7, 1 to 4 and 0.5 to 3.5. A crossing states 0, the level
   * its banks are at, and the deck lands where the ground either side is.
   */
  baseLevel?: number
}

export interface StageData {
  zone: ZoneId
  variant: VariantId
  cols: number
  rows: number
  ground: string[][]
  collision: boolean[][]
  buildings: PlacedBuilding[]
  props: StageProp[]
  trees: TreeAnchor[]
  /** Non-tree, non-building compositions (the plaza fountain today), stamped at load. */
  compositions: CompositionAnchor[]
  /** Per-cell FLOOR COLOUR the generator writes as STATE (the meadow season gradient + earth/cobble/river
   *  patches), MAP-MODEL §4: colour is per-cell DATA the generator PICKS, the render READS (never derives).
   *  `undefined` at a cell = use the ground tile's own DB colour (groundTileColor). applyStageToGrid +
   *  stageToTemplate read it so live + saved maps carry the same gradient. */
  floorColors: (string | undefined)[][]
  /**
   * PER-CELL ELEVATION, in levels, 0 being the walking floor and NEGATIVE being dug out.
   *
   * The grid has carried a per-cell height since the beginning and it has always been all zeros, because
   * `applyStageToGrid` wrote 0 into every cell of every generate and the save path wrote a field of zeros.
   * This is where a generator says otherwise. Absent, or absent at a cell, means flat, which is what every
   * template does today, so nothing changes for one that does not ask.
   */
  elevation?: number[][]
  /**
   * WHICH REGION each cell belongs to, by key, absent where the map has no regions.
   *
   * The same kind of state as `floorColors` and `elevation`: the generator PICKS it, everything else READS
   * it. It lived only on the generation context, so the one question a region set has to answer, "is this
   * laid out as the journey it describes", could not be asked from outside the generator at all. That is not
   * a detail: `REGIONS.md` §6 requires region work to be measured region by region on a real build, and
   * without this the only honest answer was that it had not been.
   */
  regions?: (string | undefined)[][]
  /**
   * PER-CELL CURRENT, in quarter turns (0 = +col, 1 = +row, 2 = -col, 3 = -row); absent means still.
   *
   * Carried beside `floorColors` and `elevation` because it is the same
   * kind of thing: state the generator PICKS and the render READS.
   */
  flow?: (number | undefined)[][]
  /**
   * EVERY CELL A CROSSING SPANS, as `col,row` keys.
   *
   * The generator has always known this: `layDeck` records each deck cell as it lays it, because a deck is a
   * fact about the map that later passes have to respect (nothing plants on a bridge). It simply never left
   * the generator, so anything downstream that needed to ask "is this cell a bridge" had no way to, and the
   * only route left was to guess from tile NAMES. That is the thing that must never happen: the tiles a
   * crossing is built from are backend data, a new crossing style is a row in the database, and a name list
   * in this repo goes stale the moment one is added.
   *
   * Carried for the same reason as `flow` and `elevation`: state the generator PICKS and everything after it
   * READS.
   */
  decks?: ReadonlySet<string>
  /**
   * EVERY CELL WHERE THE RIVER IS WADEABLE: a ford, not a built crossing.
   *
   * Separate from `decks` because they are separate things. A deck is a structure standing over the water; a
   * ford is the water itself, shallow and flush with its banks. Undefined when the map has none.
   */
  fords?: ReadonlySet<string>
  /**
   * A REGION'S OWN STANDING WATER: its puddles, its pools and its lakes.
   *
   * A map has two kinds of water now and they are not interchangeable. The CHANNEL is cut below the walking
   * floor, it flows, it is bridged, it stands its banks above itself and the treeline closes over where it
   * leaves the map. A region's water does none of that: it is a lake in a `lakeside` or a pool in a bog, and
   * it sits where the region says it sits.
   *
   * Nothing downstream could tell them apart, because both are water GROUND, so anything asking "is this
   * water" got one answer for two different things. Publishing it is what lets a caller ask the difference
   * instead of guessing it from a tile name. Undefined when a map has none, so nothing changes for one
   * without.
   */
  standing?: ReadonlySet<string>
  /**
   * HOW DEEP THE WATER IS, per cell: 1 where it touches a bank, higher further from one.
   *
   * It used to be readable off the ground LABEL, because the depth pass wrote `water_shallow` / `water` /
   * `water_deep` over the channel. That label is gone: which tile a water cell wears is decided by where it
   * sits in the body's shape, not by its depth (`docs/WATER.md` §1). Depth is still real and still decides
   * what you can wade, so it is carried here as the number it always was, for the same reason as `decks`:
   * state the generator PICKS and everything after it READS.
   *
   * It is also what the water effect layers are owed. A depth tint and the caustics fade both read this.
   */
  waterDepth?: ReadonlyMap<string, number>
  /**
   * EVERY CELL THE PATHWAYS LAYER DREW AS A WAY.
   *
   * The structure that layer produced, which nothing downstream could ask for. Anything that wanted to know
   * "is this cell a way" had to guess from the ground label or from a colour, and a way is a COLOUR on the
   * ground block, so both guesses are wrong the moment two things share a tone. Undefined when the map has
   * none. Carried for the same reason as `decks`: state the generator PICKS and everything after it READS.
   */
  pathways?: ReadonlySet<string>
  connectors: Connector[]
  spawn: { col: number; row: number }
  /** THE WAYS THROUGH THIS MAP as they were planned, before anything was planted (see `pathNetwork`), or null
   *  when this generator serves none. Each gate is a place a connector belongs. */
  routes?: RoutePlan | null
}

export interface GenerateOptions {
  zone: ZoneId
  variant: VariantId
  cols?: number
  rows?: number
  /** The generator's options as the person set them (`{river: true}`), a variation, not a new template. */
  options?: Readonly<Record<string, GeneratorOptionValue>>
  /**
   * WHICH SHAPE of its kind this map builds: a forest's `woodland`, a settlement's `modern_city`.
   *
   * A plain string, not `ForestLayout`, since 2026-09-11: a settlement's presets are its LOOKS now
   * , and passing
   * `modern_city` through a type called ForestLayout would be a lie the compiler happily told. Only
   * `placeForest` resolves it today, and it checks membership before it does.
   */
  layout?: string
  /** Per-layer SEED. A layer given a seed draws from a reproducible `makeRng(seed)` stream; a layer
   *  left out draws from the global `Math.random` (today's behaviour). This is the macro-randomize
   *  seam: re-roll one layer by changing only its seed and regenerating, the other layers, fed the
   *  SAME seeds, reproduce identically. Omitting `seeds` entirely = a plain, unchanged generate. */
  seeds?: Partial<Record<EngineLayerId, number>>
  /**
   * The chosen generator's `nature` block, straight off `/api/generators`.
   *
   * This is why `groundCover` was dead data: the backend has served it since T-113 and
   * `generatorCatalog.ts` has parsed it into the typed catalog, but `generateStage` never took it, so
   * nothing could read it. Turning the knob up changed nothing. Passed through now, and a layout that
   * has no opinion simply ignores it.
   */
  nature?: NatureDensity
  /**
   * The chosen generator's `settlement` block, straight off `/api/generators`.
   *
   * Same dead-data story as `nature`: it has been served and parsed into `GeneratorSettlement` all along
   * and nothing read it, so every value in it had a hand-kept twin in `villageLayout`, `houseWidths`,
   * `plazaSize`, `setback`, `roadWidth`, `lotGap`, `maxPerFrontage`, `buildingCap`, `houseRange` and
   * `houseWidths`. The whole block passes through now; absent → the planner uses its own defaults.
   */
  settlement?: SettlementTuning
  /** The served COLOURS for this template (`config.palette`). Absent → this generator states none and the
   *  layout paints nothing, keeping the ground tile's own colour. Never substituted for here. */
  palette?: GeneratorPalette
  /** The REGIONS this template partitions itself into (`config.subZones`). Absent → one uniform map. */
  subZones?: readonly GeneratorSubZone[]
  /** HOW those regions are laid out: `scatter` (the default), `rings` or `bands`. See `REGIONS.md` §2. */
  regionLayout?: string
  /** How this template DISTRIBUTES its trees (`config.formation`), grouping, spacing, understory. */
  formation?: GeneratorFormation
  /**
   * WHAT THIS TEMPLATE'S WAYS ARE MADE OF (`config.pathway`): surface, width, edge, scatter and lining.
   *
   * Every one of those was decided in here before. The width was `WOODLAND.pathWidth`, a constant, so a beach
   * lane and a city street were the same three cells; the surface was a tint over whatever ground was already
   * there, so a meadow path was the meadow. Absent → the plain track the engine always cut.
   */
  pathway?: GeneratorPathway
  /** WHICH trees grow here (`config.trees`). Named `treeMix` because the stage already has a `trees` list,
   *  the anchors. Absent → the global weighted table. */
  treeMix?: readonly GeneratorTreeWeight[]
  /** What a river is crossed on, by kind (`config.crossings`), picked by the `bridge` option. */
  crossings?: Readonly<Record<string, GeneratorCrossing>>
  /**
   * RUN THE SYSTEM ONLY UP TO THIS LAYER, by name. The UI's "layout" choice, and the preview behind it.
   *
   * *"LAYOUT IN THE UI JUST REFERS TO I WANT TO ONLY EXECUTE THE SYSTEM UP TO THIS SPECIFIC LAYER. IE: ONLY
   * GIVE ME AN EMPTY MAP WITH ALL PATHWAYS, GIVE AN EMPTY MAP WITH A RIVER, GIVE THE FULL MAP, ETC. IS JUST A
   * FILTER, ANOTHER PARAMETER FOR THE GENERATOR"*.
   *
   * So `upTo: 'water'` is the empty map with its river, `upTo: 'pathways'` is that plus the ways and the
   * exits and nothing built on them, and absent is the whole map. What it shows is real ground and real
   * tiles, because it is the same layers stopping early rather than a second way of drawing a map.
   */
  upTo?: string
  /**
   * Where footprints come from. Defaults to the composition-backed source so a caller that does not care (every
   * test) is unaffected.
   */
  buildingSizes?: BuildingSizes
}

/**
 * How much stuff a generator wants on the ground, as fractions of its cells.
 *
 * `canopy` is new and is what makes a FOREST a forest: the share of cells carrying a tree. The meadow
 * layouts do not read it, they are clearings by definition, framed rather than filled.
 */
export interface NatureDensity {
  /** Grass / ground-cover ornaments, 0-1. */
  groundCover?: number
  /** Flowers, 0-1. */
  flowers?: number
  /** Tree cover, 0-1. A woodland reads as woodland from about 0.35 up. */
  canopy?: number
  /** The share of open floor standing in walkable LONG GRASS, 0 to 1. Absent means none. */
  tallGrass?: number
}

type Plant = (col: number, row: number) => void

// ── small pure helpers ──────────────────────────────────────────────

function makeGrid<T>(cols: number, rows: number, fill: () => T): T[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, fill))
}

// A deterministic [0,1) value from a seed, drives leaf/flower intensity variety WITHOUT
// consuming the layout RNG, so generation stays reproducible. Coherent per seed.
const shadeNoise = (seed: number): number => {
  const h = Math.abs(Math.sin(seed * 12.9898) * 43758.5453)
  return h - Math.floor(h)
}

// A canopy tonal variant for a tree-MASS cell, derived from its position so the
// canopy varies in coherent ~2×2 patches (contrast without per-cell noise).
const massVariant = (col: number, row: number): number =>
  Math.floor(col / 2) * 7 + Math.floor(row / 2) * 13

/** Pick a living-tree composition kind by WEIGHT from a [0,1) roll, `Math.random()` for the glade/town
 *  scatter, a position hash for the coherent forest mass. This is the randomization the ticket asks for:
 *  a stand shows standard / tall / small / round trees + bushes instead of one repeated shape. Pure +
 *  injectable (tests pass explicit rolls to prove the full spread). */
export function pickLivingTree(rand: number, mix?: readonly GeneratorTreeWeight[]): LivingTreeKind {
  // A template's OWN species first., every forest rolled this one global table, so a jungle grew what a meadow grew.
  // No served mix → the global table, which is exactly the old behaviour.
  const table = mix && mix.length > 0 ? mix : livingTreeVariants()
  const total = table.reduce((sum, v) => sum + v.weight, 0)
  let roll = rand * total
  for (const v of table) {
    if (roll < v.weight) return v.kind as LivingTreeKind
    roll -= v.weight
  }
  return table[0].kind as LivingTreeKind
}

/**
 * WHICH SPECIES GROW AT THIS CELL: the REGION's own where it states them, the template's otherwise.
 *
 * Six planters asked this question and two of them asked it of the region. The other four rolled the
 * template's one global mix wherever they stood, and the border treeline is by far the biggest of them:
 * measured on a 40x40 woodland, 290 of 343 trees stand in the two-cell edge band, so 85% of a map's wood
 * never knew which region it grew in. What that looks like is *"THERE'S NOT A SINGLE DIFFERENCE BETWEEN THE
 * FOREST REGIONS, THEY'RE EXACTLY THE SAME"*: asking for the thicket, whose served species are bushes and
 * saplings, and asking for the deep wood both gave the same five species in the same order, led by the
 * column the template serves and the thicket does not grow at all.
 *
 * One answer, in one place, so a planter added later cannot quietly go back to the global table. A map with
 * no regions, or a cell no region claimed, falls through to the template's mix and is unmoved.
 */
function speciesAt(ctx: ArchetypeContext, col: number, row: number): readonly GeneratorTreeWeight[] | undefined {
  return ctx.zoneAt?.[row]?.[col]?.trees ?? ctx.treeMix
}

/** One blocking biome-feature cell (mountain / peak / spill), appearance from
 *  the tileset's per-zone feature palette (ember crater in lava, snowcap + blue
 *  waterfall otherwise). Always blocks (it's terrain). */
// Walkable flowers read from the zone's curated bloom set (ZONE_FLOWERS in zones.ts).
/**
 * A THICKET: the undergrowth you cannot push through, drawn as itself.
 *
 * The undergrowth pass used to place the same little
 * clover a meadow uses and then stamp `collision = true` over it, so what you saw was walkable and what you hit
 * was a wall. This is the thing that blocks, and it looks like it.
 */
/**
 * ONE PLANT, and the tile's own row says whether you can walk on it.
 *
 * separately
 *
 * This was two functions that differed only in a hardcoded boolean: `makeThicket` said `blocking: true` and
 * `makeTallGrass` said `false`, neither of them asking. Measured against the live catalog, `thicket` is the
 * ONLY one of 40 nature tiles that blocks, so the frontend was minting the single most surprising collision
 * in the game rather than reading it.
 */
const makePlant = (ctx: ArchetypeContext, col: number, row: number, label: string): StageProp => {
  const tile = resolveTile(styleCatalog('ascii'), ctx.zone, label)
  // A PLANT GROWS. It left `grows` unset, so the flag that every way-clearing sweep reads was undefined on the
  // undergrowth: a thicket or a tuft of grass was neither something growing (to be swept off a path) nor
  // something deliberately not growing (like the film on a ford). The flowers beside it have always said true.
  return { col, row, type: label, char: tile.char, label, blocking: !tile.walkable, grows: true, color: undergrowthTone(ctx, col, row, tile) ?? tile.color }
}

/**
 * THE UNDERGROWTH'S COLOUR, on the same three axes as the canopy above it.
 *
 * A desert grew ochre trees standing on emerald shrubs, because this was left on the tile's flat per-season
 * colour: 193 thickets on one desert map, every single one `#2f6b2a`.
 *
 * Identical machinery to a leaf, with one input swapped. The season supplies the tone and, through a
 * per-cell variant, the variation that stops a thicket reading as one painted mass. The biome supplies the
 * hue, but from `palette.undergrowth` rather than `palette.leaf`, because undergrowth stands in the shade of
 * what is over it and is the darker, duller half of the same vegetation. The region shifts it by light, as
 * everywhere else.
 *
 * Gated on the TILE saying it is foliage. The frontend does not get to decide that a `thicket` is a plant
 * and a `rock` is not, and a label-prefix test could never have covered either. A tile with no `foliage`
 * flag (a pebble, a flower, autumn litter) keeps its own colour untouched.
 */
function undergrowthTone(ctx: ArchetypeContext, col: number, row: number, tile: { settings?: Record<string, unknown> }): string | undefined {
  if (tile.settings?.foliage !== true) return undefined
  const pal = ctx.palette
  if (!pal?.undergrowth) return undefined
  const count = canopyCount(styleCatalog('ascii'), ctx.zone)
  const shade = canopyShade(styleCatalog('ascii'), ctx.zone, massVariant(col, row) % count)
  const region = ctx.zoneAt?.[row]?.[col]
  return foliageColor(
    shade,
    { leaf: pal.undergrowth, seasonality: pal.leafSeasonality, value: pal.leafValue },
    { leafHue: region?.leafHue, leafValue: region?.leafValue },
  )
}

/** LONG GRASS you walk INTO: Walkable, so `placeProp` leaves the
 *  cell open. */


/** How coarse the long-grass patches are, in cells: grass grows in stands, not as pepper. */
const TALL_GRASS_PATCH = 4

/**
 * Patches of long grass over the open floor, as much of it as the generator SERVES (`nature.tallGrass`). No
 * served share means none, like every other density here: this file invents no numbers.
 */
function scatterTallGrass(ctx: ArchetypeContext): void {
  const share = ctx.nature?.tallGrass
  if (share === undefined) return
  const { cols, rows, collision, ground } = ctx
  const occupied = new Set(ctx.props.map(p => `${p.col},${p.row}`))
  forEachCell(cols, rows, (col, row) => {
    if (collision[row][col] || isWaterGround(ground[row][col])) return
    if (isBuiltFloor(ground[row][col]) || isRoadGround(ground[row][col])) return // keep paving and roads clear
    if (occupied.has(`${col},${row}`)) return
    // THE REGION'S OWN SHARE OF IT, AND ITS OWN PLANT.
    //
    // This grew `tall_grass` at one density over the whole map, so a meadow's five regions had the same thing
    // underfoot however they differed above it: measured, its `pasture`, its `hedgerow` and its `orchard` all
    // came out reading as one place. The meadow is the only builder that never planted a region's understory,
    // and both of the things that make one are served per region already.
    const zone = ctx.zoneAt?.[row]?.[col]
    const plant = zone?.formation?.understoryTile ?? 'tall_grass'
    const density = share * (zone?.undergrowth ?? 1) * (zone?.formation?.understory ?? 1)
    if (shadeNoise(Math.floor(col / TALL_GRASS_PATCH) * 2.3 + Math.floor(row / TALL_GRASS_PATCH) * 3.7) > density) return
    placeProp(ctx, makePlant(ctx, col, row, plant))
  })
}

const makeFlower = (rng: Rng, zone: ZoneId, col: number, row: number, regionSet?: readonly FlowerKind[]): StageProp | null => {
  // A REGION's own blooms beat the season's. A sub-zone could already say which SPECIES grow in it
  // (`trees`) and had no way to say which BLOOMS, so a swamp planted the season's set, and summer's carries
  // `✽ #f4f4ec`, a near-white. Measured in a swamp jungle before this: whites among the blooms, as it saw.
  // WHICH BLOOMS GROW HERE IS THE ENVIRONMENT'S TO SAY, and where it says none, none grow.
  //
  // The chain ended in the season's set and then in a hardcoded default, so a template that serves no blooms
  // got spring's anyway: measured, 13 on a volcanic forest and on a mountain, both of which serve no bloom
  // set on any region. Four of the nine wild environments serve none, which is the catalogue stating that
  // nothing flowers there. Serving a set is how an environment gets blooms back, one line per region.
  // A REGION's own blooms beat the season's, and a season with none grows none.
  //
  // The chain ended in a hardcoded default set, which is this file deciding what flowers somewhere. It is the
  // season's where a region names nothing, and nothing at all where neither does.
  //
  // NOT NARROWED FURTHER, deliberately. Dropping the season's set as well leaves four of the nine wild
  // environments with no blooms at all, because they name none, and 29 cases across the suite document that
  // those maps do flower. That is a product decision rather than a defect, so it waits on his word.
  const set = regionSet ?? zoneFlowers(zone)
  if (!set || set.length === 0) return null
  const pick: FlowerKind = set[randIntWith(rng, 0, set.length - 1)] // seeded pick, the caller passes its layer rng so the pass stays reproducible
  // Each flower gets its own intensity tone (per-cell) for a naturally varied meadow, tone only, no opacity.
  // LABEL 'flower' routes it through the label→image path (render/shared.labelTileImage) so it draws the BAKED
  // flower tile in EVERY style (ascii + emoji), colour-composited, never a per-style glyph (ASCII_STYLE.map is
  // empty, so a label-less prop would fall to the legacy '+' glyph drawer). The colour stays a per-instance tint.
  return { col, row, type: 'flower', char: pick.char, label: 'flower', blocking: false, grows: true, color: varyIntensity(pick.color, shadeNoise(col * 2.7 + row * 3.1)) }
}

/** Per-instance RENDER the generator stamps onto specific prop TYPES, the SAME per-asset settings a hand-painter
 *  would set (they ride the normal stage save/load; NO tile-definition change, NO migration). A flower stands as
 *  ONE centered billboard a block tall (`display: 'single'` + `height: 1`) with a TRANSPARENT block, just the
 *  bloom shows, no coloured cube around it. A type with no entry keeps the tile's own flat render, as before. */
export const GENERATED_PROP_RENDER: Readonly<Record<string, { height?: number; display?: TileDisplay; transparent?: boolean; scale?: number }>> = {
  // A flower AND a scattered ground-decor bloom both render as ONE small SINGLE billboard with a TRANSPARENT
  // block, so a
  // daisy shows as a small bloom on the grass, NOT a coloured cube. scale < 1 = slightly smaller than a full cell.
  flower: { height: 1, display: 'single', transparent: true, scale: 0.85 },
  ground_decor: { height: 1, display: 'single', transparent: true, scale: 0.85 },
}

/** Does the backend state a height for this label? Then nothing here may stamp one over it. */
function servesOwnHeight(label: string | undefined): boolean {
  if (!label) return false
  const tile = styleTile('ascii', label) ?? styleTile('emoji', label)
  return typeof (tile as { height?: number } | undefined)?.height === 'number'
}

/** The GridAsset overrides (`height` + `scale` + `settings`) a generated prop of `type` carries, ONE source BOTH
 *  the live grid (applyStageToGrid) and the saved payload (stageToTemplate) apply, so the two paths never diverge.
 *  Returns {} for a type with no override (the default tile-driven flat render). */
export function generatedPropRender(type: string, label?: string): { height?: number; scale?: number; settings?: { display?: TileDisplay; transparent?: boolean } } {
  const o = GENERATED_PROP_RENDER[type]
  if (!o) return {}
  const out: { height?: number; scale?: number; settings?: { display?: TileDisplay; transparent?: boolean } } = {}
  // THE BACKEND'S HEIGHT WINS WHERE THE BACKEND STATES ONE.
  //
  // This stamped `height: 1` onto every ground decor, and `resolveTileHeight` takes the ASSET's height over
  // the TILE's, so a served height was overridden by a constant in this file. `water_still` is served at 0.05
  // with `stackAt: 0` and a 0.72 opacity, which is a thin translucent film lying on the floor, and it was
  // drawn as a block a full cell tall. A puddle is a data question and the data already answered it.
  if (o.height !== undefined && !servesOwnHeight(label)) out.height = o.height
  if (o.scale !== undefined) out.scale = o.scale
  const settings: { display?: TileDisplay; transparent?: boolean } = {}
  if (o.display !== undefined) settings.display = o.display
  if (o.transparent !== undefined) settings.transparent = o.transparent
  if (Object.keys(settings).length > 0) out.settings = settings
  return out
}

// Deterministic per-cell pick from the zone-data rockShades() palette (zones.ts) so cave/arena
// walls read tonal, not one flat grey.
const rockShade = (col: number, row: number): string => rockShades()[Math.abs(col * 7 + row * 13) % rockShades().length]

const makeRock = (col: number, row: number): StageProp => ({
  col,
  row,
  type: 'rock',
  char: Math.abs(col * 5 + row * 3) % 7 === 0 ? '▒' : '▓',
  label: 'rock', // baked 'rock' tile (both styles), draws the image, not the '▓' glyph, under ascii
  blocking: true,
  color: rockShade(col, row),
})

// ── cave feature cells (all SEASONAL), every KIND maps to an ASCII glyph+color AND
//    an emoji tint (see game/artStyle.ts): wall/rubble → 🪨, crystal → 💎, mushroom → 🍄.
// Non-blocking cave-floor DECOR: stalagmites + rubble + pebbles, tinted from the
// season's rock tone so they read as living rock against the cavern walls.
const makeCaveDecor = (col: number, row: number, tone: string): StageProp => ({
  col, row, type: 'cave_decor',
  char: caveDecor()[Math.abs(col * 5 + row * 7) % caveDecor().length],
  blocking: false,
  color: varyIntensity(tone, shadeNoise(col * 1.7 + row * 2.3)),
})

// A crystal-cluster cell, a glowing gem tinted by the season (blossom-violet spring,
// cyan summer, amber autumn, icy winter, gold desert, ember lava). Non-blocking.
const makeCrystal = (col: number, row: number, tint: string): StageProp => ({
  col, row, type: 'crystal',
  char: Math.abs(col + row) % 2 === 0 ? '◆' : '◇',
  label: 'crystal', // baked 'crystal' tile (both styles), draws the image, not the '◆' glyph, under ascii
  blocking: false,
  color: varyIntensity(tint, shadeNoise(col * 3.1 + row * 1.9)),
})

// A cave mushroom (damp seasons only), a red/tan toadstool on the floor. Non-blocking.
// Cap tone from the zone-data mushroomTones() palette (zones.ts).
const makeMushroom = (col: number, row: number): StageProp => ({
  col, row, type: 'mushroom', char: '♠', label: 'mushroom', blocking: false, grows: true,
  color: mushroomTones()[Math.abs(col * 3 + row * 5) % mushroomTones().length],
})

/**
 * A ROCK FACE: a blocking, full-height wall of natural stone. What closes a cavern, a boss arena, and the
 * border of a place too bare to close with a wood.
 *
 * NOT A BOULDER. All three of those used `makeRock`, whose type is `rock`, and the served `constantRoleTile`
 * table pins every `rock` prop to `emoji:boulder`. So a cave's entire boundary, every formation inside it and
 * an arena's walls were drawn as rounded stones lying on the ground. A boulder is a thing you walk around; a
 * rock face is a thing you cannot see through, and the difference is the whole reason a cave reads as a cave.
 *
 * It carries the `cliff_face` label and NO override, so it resolves through the ordinary label to image path
 * rather than being pinned to a picture of something else. The temple already worked this way: its
 * `temple_wall` type maps to the `wall` kind in `artStyle`, which is the pattern this follows.
 *
 * Tonal per season (pale ice-rock in winter, warm sandstone in desert, charred basalt in lava, mossy grey
 * otherwise) so a cavern reads by season the way the forest does.
 */
const makeRockFace = (col: number, row: number, shades: readonly string[]): StageProp => ({
  col, row, type: 'rock_face',
  char: Math.abs(col * 5 + row * 3) % 7 === 0 ? '▒' : '▓',
  label: 'cliff_face',
  blocking: true,
  color: shades[Math.abs(col * 7 + row * 13) % shades.length],
})

// Non-blocking zone GROUND DECOR (grass/litter/pebbles/embers), the density layer. Each decor variant
// is a backend TILE (category 'decor', its own settings.colors per zone); pickGroundDecor selects one
// deterministically from the loaded tileset and resolves its glyph + zone colour. Null when the tileset
// carries no decor for the zone (e.g. before load), the caller then skips the cell.
export const makeGroundDecor = (zone: ZoneId, col: number, row: number): StageProp | null => {
  const d = pickGroundDecor(styleCatalog('ascii'), zone, col, row)
  if (!d) return null
  // Carry the decor tile's LABEL so the render resolves its BAKED image (labelTileImage) per active style, // decor draws its own tile image, colour-composited, NOT a glyph (see render/shared.groundDecorImage).
  return { col, row, type: 'ground_decor', char: d.char, blocking: false, grows: true, color: d.color, label: d.label }
}

/** Fill most empty, walkable, non-edge cells with non-blocking zone ground decor so a
 *  stage reads DENSE instead of blank. Skips cells that already hold a prop, and leaves
 *  ~(1-density) of cells clear so the floor still reads as navigable. Decor never blocks,
 *  so walkable connectivity is unchanged. */
// Built/paved floors should NOT get nature decor (no grass on marble), they're
// already detailed by their tile pattern.
/**
 * IS THIS GROUND A BUILT FLOOR, one nothing plants on? Asked of the backend.
 *
 * This was a hand-written set of six names. Measured against the live catalogue: the backend files **21**
 * tiles under `floors`, so `courtyard_stone`, `temple_floor`, `cave_floor`, `tatami`, `terracotta`,
 * `wooden_planks` and a dozen more were never recognised, and a flower could grow out of a temple's paving.
 * A floor added by a migration was invisible here.
 *
 * `path_stone` was in the old list and is a ROAD to the backend, which `isRoadGround` already covers, so
 * every caller pairs the two questions and nothing is lost.
 */
const isBuiltFloor = (ground: string | undefined): boolean => isTileCategory(ground, TILE_CATEGORY.floors)

function scatterGroundCover(ctx: ArchetypeContext, density = 0.18, layout?: VillageLayout): void {
  const { props, collision, ground, cols, rows, zone } = ctx
  const occupied = new Set(props.map(p => `${p.col},${p.row}`))
  forEachCell(cols, rows, (col, row) => {
    if (isEdge(col, row, cols, rows)) return
    if (collision[row][col]) return // walkable floor only
    if (isWaterGround(ground[row][col])) return // land-only: no ground cover in water
    if (isBuiltFloor(ground[row][col]) || isRoadGround(ground[row][col]) || layout?.roads[row]?.[col]) return // keep paved floors + ROADS clean (roads are colour-only now → layout.roads)
    if (occupied.has(`${col},${row}`)) return // don't cover trees / buildings / decor
    // THE REGION'S OWN SHARE OF IT. A flat density made a market square as grassy as a park, which is half of
    // why a settlement's neighbourhoods were one place under six names. `undergrowth` multiplies, so a region
    // that states none is untouched.
    if (ctx.rand() > density * (ctx.zoneAt?.[row]?.[col]?.undergrowth ?? 1)) return // breathing room
    // AND THE PLANT THE REGION NAMES, when it names one.
    //
    // This grew the zone's one generic decor everywhere, so a village's commons, its garden plots and its
    // wooded edge all came out as the same tuft of the same thing: measured, all three read as `flower` at
    // the same density, which is three names for one place. The forests already plant a region's own
    // `understoryTile` and a settlement is the only builder that did not.
    const plant = ctx.zoneAt?.[row]?.[col]?.formation?.understoryTile
    if (plant) { placeProp(ctx, makePlant(ctx, col, row, plant)); return }
    const prop = makeGroundDecor(zone, col, row)
    if (prop) placeProp(ctx, prop) // no decor tile for this zone (tileset not loaded) → leave the cell bare
  })
}

/** Scatter standing BLOOMS over a settlement's OPEN grass (skips edges, collisions, paved/built floor, roads, and
 *  cells already holding a prop). Only flowering zones bloom (ZONE_FLOWERS). Each rides GENERATED_PROP_RENDER →
 *  a single billboard a block tall, so the town's grass gets actual flowers, not just the flat ground tufts
 *  scatterGroundCover lays down. */
function scatterFlowers(ctx: ArchetypeContext, density: number, layout?: VillageLayout): void {
  const { props, collision, ground, cols, rows, zone } = ctx
  if (zoneFlowers(zone) === undefined) return // non-flowering zone → no blooms
  const occupied = new Set(props.map(p => `${p.col},${p.row}`))
  forEachCell(cols, rows, (col, row) => {
    if (isEdge(col, row, cols, rows)) return
    if (collision[row][col]) return // walkable grass only
    if (isWaterGround(ground[row][col])) return // land-only: no blooms in water
    if (isBuiltFloor(ground[row][col]) || isRoadGround(ground[row][col]) || layout?.roads[row]?.[col]) return // keep streets/paved clean (roads are colour-only now → layout.roads)
    if (occupied.has(`${col},${row}`)) return // don't cover trees / buildings / decor
    // Blooms follow the neighbourhood too: a graveyard and a green are not a market square.
    if (ctx.rand() > density * (ctx.zoneAt?.[row]?.[col]?.undergrowth ?? 1)) return
    placeProp(ctx, makeFlower(ctx.rand, zone, col, row)) // seeded pick → the nature layer stays reproducible per-seed
  })
}

// Structural decor for temple / boss arena / village (readable single-glyph props). Glyph + fallback
// colour come from the zone-data propArt() table (zones.ts); a caller passes the zone's tint to override.
const makePillar = (col: number, row: number, color = propArt().pillar.color): StageProp => ({ col, row, type: 'pillar', char: propArt().pillar.char, blocking: true, color })
const makeBrazier = (col: number, row: number): StageProp => ({ col, row, type: 'brazier', char: propArt().brazier.char, blocking: true, color: propArt().brazier.color })
const makeAltar = (col: number, row: number, color = propArt().altar.color): StageProp => ({ col, row, type: 'altar', char: propArt().altar.char, blocking: true, color })

// ── temple-interior feature cells (all SEASONAL), every KIND maps to an ASCII glyph+color
//    AND an emoji tint (see game/artStyle.ts): temple_wall → 🧱, pillar → 🏛️, altar → 🗿,
//    torch → 🔥, hazard → 🔺, key → 🗝️, the gateway door → 🚪.
// One blocking temple WALL cell, the dungeon's stone boundary + inner walls, tinted per
// season (mossy marble in spring, sandstone in desert, frozen blue in winter, basalt in lava)
// so a temple reads by season the way the cavern does.
const makeTempleWall = (col: number, row: number, shades: readonly string[]): StageProp => ({
  col, row, type: 'temple_wall',
  char: Math.abs(col * 5 + row * 3) % 6 === 0 ? '▓' : '█',
  blocking: true,
  color: shades[Math.abs(col * 7 + row * 13) % shades.length],
})

// A wall TORCH, a mounted flame lighting the halls. Non-blocking (a sconce you pass under),
// so it can never pinch off the walkable floor.
const makeTorch = (col: number, row: number, color: string): StageProp => ({ col, row, type: 'torch', char: propArt().torch.char, blocking: false, color })

// A floor HAZARD, spike/pit trap tile. Non-blocking (you CAN step on it, it would deal
// damage in play), so hazards never disconnect the dungeon floor. Season-tinted.
const makeHazard = (col: number, row: number, char: string, color: string): StageProp => ({ col, row, type: 'hazard', char, blocking: false, color })

// The boss-door KEY, a collectible on the floor of a side room. Non-blocking.
const makeKey = (col: number, row: number): StageProp => ({ col, row, type: 'key', char: '⚷', blocking: false, color: '#ffd24a' })

// A gateway/threshold prop marking the (narratively locked) boss door, WALKABLE (label
// 'door'), so it reskins as 🚪 and the floor stays one connected region.
const makeGateway = (col: number, row: number, color: string): StageProp => ({ col, row, type: 'door', char: '∏', blocking: false, color, label: 'door' })
// The two town-square WATER VARIANTS, each a backend COMPOSITION (rim + water) stamped at load, no special
// prop. Each footprint MUST match its Nebulith composition so the plaza reserve/centre matches what the stamp
// fills: the small `well` (5w × 3d, a 1×3 water line) vs the grand `fountain` (5w × 5d, a 3×3 water grid).
const CENTREPIECE_FOOTPRINT = { well: { w: 5, h: 3 }, fountain: { w: 5, h: 5 } } as const
type Centrepiece = keyof typeof CENTREPIECE_FOOTPRINT
// Pick the water variant by settlement SIZE (kept simple): a small town square gets the modest `well` (3
// animated water columns), a grand city square gets the big `fountain` (a 3×3 basin, its centre 3 animated).
// The plaza side is the settlement tell, PLAZA_SIZE is town 5 / city 7 (villageLayout), so ≥6 ⇒ city.
const pickCentrepiece = (plazaSize: number): Centrepiece => (plazaSize >= 6 ? 'fountain' : 'well')
/** Place a prop iff the cell is in-bounds + not already blocked; set collision when blocking. */
/**
 * IS THIS CELL PART OF A WAY?
 *
 * *"we have trees in the pathway, we shouldn't have any trees in the pathway, just in grass or dirt zones,
 * same with flowers"*. That was answered with a SWEEP: plant everywhere, then pull the growing things back
 * off the road afterwards. A sweep is the right shape only while the planting happens BEFORE the pathways are
 * cut, which was true when every variant painted and planted in one pass.
 *
 * Once objects run after pathways, the pathways are already there while things are being planted, so the rule is
 * a GUARD at the moment of placing rather than a repair afterwards. Empty until the pathways layer has run, so
 * this costs a set lookup and changes nothing for a variant that has not been split yet.
 */
const standsOnPathway = (ctx: ArchetypeContext, col: number, row: number): boolean => {
  if (ctx.pathwayCells.has(`${col},${row}`)) return true
  // …OR IN FRONT OF ONE, which hides it. Screen depth is `col + row`, so the cells drawn in front of a way
  // cell are the ones at +1 col and +1 row: this cell is in front of a way when a way is at -1 col or -1 row.
  // The sweep this guard replaces cleared exactly these two, and dropping them showed up at once as six trees
  // a seed standing in front of a woodland road.
  return ctx.pathwayCells.has(`${col - 1},${row}`) || ctx.pathwayCells.has(`${col},${row - 1}`)
}

/** What a placement is allowed to ignore. Way DRESSING is put on the way on purpose, so it says so. */
interface PlaceOptions {
  /** This thing belongs ON the way: the pebbles and litter the objects layer scatters down it. */
  onPathway?: boolean
}

function placeProp(ctx: ArchetypeContext, prop: StageProp | null, opts?: PlaceOptions): void {
  const { props, collision, cols, rows } = ctx
  // NOTHING TO PLACE IS NOT AN ERROR. A maker returns null when the data says this place grows none of what
  // it makes, and that answer travels here rather than being guarded at each of the five call sites.
  if (!prop) return
  if (!inBounds(prop.col, prop.row, cols, rows)) return
  if (collision[prop.row][prop.col]) return
  if (!isLandCell(ctx, prop.col, prop.row)) return // land-only: no prop (flower / rock / …) in water
  // NOTHING IS PUT IN A ROAD unless it is the road's own dressing, which says so.
  //
  // The sweep this replaces filtered on `grows`, because it ran at the END and had to leave the structures
  // alone. A guard at the moment of placing does not need that: a meadow's field stones are not marked
  // `grows` and the sweep never touched them, but the cobble way used to be paved over them AFTERWARDS and
  // that is what kept them off it. With the ways drawn first, three rocks a seed simply sat in the road.
  if (!opts?.onPathway && standsOnPathway(ctx, prop.col, prop.row)) return
  props.push(prop)
  if (prop.blocking) collision[prop.row][prop.col] = true
}

const makeBossAnchor = (col: number, row: number): StageProp => ({
  col,
  row,
  type: 'boss',
  char: 'Ω',
  blocking: true,
  color: '#c0392b',
})

// ── terrain transitions (the "real tileset" edge logic) ────────────────────
// Real tilesets blend at material borders instead of hard cell edges. After the
// archetype paints the ground, we scan every walkable LAND cell and, where it
// touches water/ice/lava, stamp a non-blocking edge decor, a shoreline ripple, a
// frosty rim, or a charred ember crust, so coastlines/lava banks read as blended.
const LAVA_LIKE = new Set(['lava', 'magma'])

/** THE reusable LAND-ONLY guard: NOTHING, a prop, tree, lamp, ornament, rock, unit or spawn, may
 *  sit on a WATER cell; only the bridge deck crosses water. Reads the GROUND directly so every generator + the
 *  placement primitives share ONE check instead of a per-type special case. A cell is water when its ground tile
 *  is water-like (the meadow river, a lake, oasis, koi pond, deep/ice water, …). */
const isLandCell = (ctx: ArchetypeContext, col: number, row: number): boolean =>
  inBounds(col, row, ctx.cols, ctx.rows) && !isWaterGround(ctx.ground[row][col]) && !ctx.wet.has(`${col},${row}`)

function edgeDecor(neighbourType: string, col: number, row: number): StageProp | null {
  // ANY water, not the four names in WATER_LIKE. The depth pass renames a cell `water_shallow` or `water_deep`,
  // so a deep pool used to border the land with no shoreline at all, which is half of why the swamp read as
  // : nothing marked where the water began.
  // A WATER EDGE GETS NOTHING. It was a `≈` character, then the 8 baked `shore_*` autotile pieces, and those
  // are drawn as BLOOMS: 231 to 450 a map, which is what it had been calling "white flowers" for four rounds.
  // Lava keeps its ember.
  if (isWaterGround(neighbourType)) return null
  if (LAVA_LIKE.has(neighbourType)) {
    return { col, row, type: 'ember', char: '▒', blocking: false, color: '#d2691e' }
  }
  return null
}



/** Stamp blended edges on land cells bordering water/lava. Non-blocking; never
 *  overwrites an existing prop. */
function addTerrainTransitions(ctx: ArchetypeContext): void {
  const { ground, collision, props, cols, rows, zone } = ctx
  const occupied = new Set(props.map(p => `${p.col},${p.row}`))
  const edges: StageProp[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const here = ground[row][col]
      if (isWaterGround(here) || LAVA_LIKE.has(here)) continue // decorate LAND only, whatever depth the water is
      if (collision[row][col] || occupied.has(`${col},${row}`)) continue
      // NO SHORE DECORATION. and
      //
      // The `shore_*` pieces are drawn as blooms, which is why it read 231 to 450 of them a map as "white
      // flowers" through four rounds of me hunting the flower data. Recolouring them to the served bank only
      // made them brown blooms. A water edge marked with a ring of daisies is not a water edge.
      // Lava keeps its ember below; only the water shoreline is gone.
      for (const [dc, dr] of ORTHO) {
        const c = col + dc
        const r = row + dr
        if (!inBounds(c, r, cols, rows)) continue
        const decor = edgeDecor(ground[r][c], col, row)
        if (decor) {
          edges.push(decor)
          occupied.add(`${col},${row}`)
          break
        }
      }
    }
  }
  props.push(...edges)
}

// ── archetypes (Open/Closed: register a variant here, no dispatcher edits) ──
interface ArchetypeContext {
  /** Which archetype is being built. A LAYER guards on this (`edge` is forests only); the passes inside an
   *  archetype already know which one they are. */
  variant: VariantId
  zone: ZoneId
  ground: string[][]
  collision: boolean[][]
  buildings: PlacedBuilding[]
  props: StageProp[]
  /** Tree anchors recorded during generation → stamped as compositions at load (see TreeAnchor). */
  trees: TreeAnchor[]
  /** Non-tree/building composition anchors (the plaza fountain) → stamped at load. */
  compositions: CompositionAnchor[]
  /** Per-cell FLOOR COLOUR the generator writes as STATE (see StageData.floorColors). The meadow layouts
   *  paint the season gradient + earth/cobble/river patches here; every other archetype leaves it undefined
   *  and the render falls back to the ground tile's own DB colour. */
  floorColors: (string | undefined)[][]
  /**
   * PER-CELL ELEVATION in levels, 0 the walking floor, NEGATIVE dug out. Written by a pass, read by the
   * stamp and by the save. See `StageData.elevation`.
   */
  elevation: number[][]
  /** Every cell laid as a crossing deck. The depth pass has to tell a deck from a bank, and the tile no longer
   *  says which (a dirt-path crossing is the flat floor). */
  decks: Set<string>
  /** Every cell laid as a ford: river shallow enough to walk through, raised back to the level of its banks.
   *  The depth pass, the dry-area walk and the wading rule each need to tell one from a deck. */
  fords: Set<string>
  /**
   * CELLS WITH STANDING WATER LYING ON TOP OF DRY GROUND.
   *
   * A puddle is not a ground tile. and
   * Replacing the ground meant the puddle's own height had
   * to match whatever floor it landed on, and it never could: `meadow` is a 1.0 block and the puddle was 0.
   *
   * So the ground STAYS and the film is stacked over it, which is the "small layer above it" exactly, and the
   * walking level never changes. This set is how the planting passes still know a cell is wet, since they used
   * to learn it from the ground label.
   */
  wet: Set<string>
  /** Per-cell CURRENT, in quarter turns (0 = +col, 1 = +row, 2 = -col, 3 = -row). See `flowField`. */
  flow: Map<string, number>
  /** See StageData.waterDepth. Written by the depth pass, read by everything that varies with depth. */
  waterDepth: Map<string, number>
  /** True when this map's liquid is molten (see `liquidFor`): read by the depth pass, which never lets a
   *  molten cell be waded however shallow it is. */
  molten: boolean
  /** The crossing this map is built with, decided the first time a deck is laid. null → the classic deck. */
  crossing?: GeneratorCrossing | null
  cols: number
  rows: number
  /** The generator's served nature densities, or undefined when it states none. A layout must treat an
   *  absent value as "no opinion" and never substitute a number of its own, see the compliance rule. */
  nature?: NatureDensity
  /** The served settlement tuning, every number the backend states about a settlement's shape. */
  settlement?: SettlementTuning
  /** The served COLOURS for this template. What makes an Amazonas not a pine wood, every colour in a forest
   *  used to come from the SEASON, so two different forests in spring were painted identically. */
  palette?: GeneratorPalette
  /** The REGIONS this template partitions itself into, open canopy, dense growth, swamp, ruins. A jungle is
   *  not one uniform density, it is several kinds of ground you walk between. */
  subZones?: readonly GeneratorSubZone[]
  /** How the regions are laid out, served. */
  regionLayout?: string
  /** How the trees are DISTRIBUTED, a wood pasture, an even-aged stand and a closed canopy differ in this,
   *  not in how many trees they hold. */
  formation?: GeneratorFormation
  /** What this template's pathways are MADE OF: surface, width, edge, scatter, lining. A pathway used to be a
   *  tint over the ground already there, at one width for every place in the game. */
  pathway?: GeneratorPathway
  /**
   * THE CELLS A LAYOUT ACTUALLY CUT AS A WAY, which is not the same set as `routes.cells`.
   *
   * The plan holds the centreline the planner drew. A layout then widens it, joins its clearings, mouths it
   * at each gate and folds all of that into one trail, so a woodland's real trail was 487 cells where the
   * plan named 170. Paving the plan alone left the other 317 wearing the tile the layout had laid, and the
   * map showed ONE path in TWO materials. A layout that cuts a way says so here, and one pass surfaces them.
   */
  pathwayCells: Set<string>
  /** THE END CELLS OF EACH PATHWAY: the exits. Recorded by layer 3 the moment the plan exists, and nothing
   *  is written into one. It is the served pathway width by construction, because `gateOn` cuts the gate at
   *  exactly that width. See PATHWAYS.md §4 and GENERATION-SPEC §5.1. */
  exitCells: Set<string>
  /**
   * EVERY CELL THE WATER LAYER LAID, so the layers after it can go around what it left.
   *
   * *"we should have water go first, because then the pathway can footprint the actual navigable layout,
   * including potentially using bridges"*. It used to be a local `Set` inside whichever archetype carved it
   * and it died with that function, so anything downstream had to re-derive it from the ground labels.
   */
  water: Set<string>
  /** Which forest layout this map is, resolved once in the terrain phase so all four phases agree. */
  forestLayout?: ForestLayout
  /**
   * EVERY CELL AN EARLIER LAYER SPOKE FOR, so the objects layer knows what is left.
   *
   * *"objects are put in the free spaces that the map has after pathways and river has run"*. Water, the
   * ways, the gate mouths and a wood's clearings all claim ground before anything is planted on it, and each
   * variant used to carry that as a local `open` set that died with its build function. On the ctx it is
   * simply what "free space" means, for every variant, in one place.
   */
  claimed: Set<string>
  /** Which REGION each cell belongs to, decided by terrain and read by every layer after it. */
  zoneAt?: (GeneratorSubZone | undefined)[][]
  /** The regions this map actually has, in the order terrain resolved them. */
  zones?: readonly GeneratorSubZone[]
  /** Standing water a swamp region flooded, kept apart from the channel because it settles differently. */
  pools: Set<string>
  /** Water with no CURRENT: every puddle, and every still body a region asked for. The flow walk skips it, so
   *  a lake is read as a lake rather than as a river that happens to be wide. */
  still: Set<string>
  /** The walkable bank the water layer left along its edge, which the pathways layer routes to. */
  banks: Set<string>
  /** A settlement's street and plot plan, made by its pathways phase and built on by its objects phase. */
  villageLayout?: VillageLayout
  /** A cave's mouth, cut by terrain and reopened by pathways after the walls went in. */
  caveEntrance?: Rect
  /** A cave's chambers, so the water phase knows which floor it may flood. */
  caveChambers?: ReadonlySet<string>
  /** A temple's rooms, cut by terrain and dressed by objects. */
  templeRooms?: TempleRoom[]
  /** The species this template grows. A jungle is not a meadow with more trees in it. */
  treeMix?: readonly GeneratorTreeWeight[]
  /** What a river is crossed on, by kind (`config.crossings`), picked by the `bridge` option. */
  crossings?: Readonly<Record<string, GeneratorCrossing>>
  /** Where footprints come from, see `GenerateOptions.buildingSizes`. */
  buildingSizes?: BuildingSizes
  /** The user-steered shape of this kind of place, or undefined for a plain generate (placeForest then
   *  random-picks a meadow layout). Only placeForest resolves it, and it checks membership first. */
  layout: string | undefined
  /** The generator's OPTIONS as the person set them, `{river: true}`. A layout reads the ones it knows. */
  options: Readonly<Record<string, GeneratorOptionValue>> | undefined
  /** The pathways through this map, planned BEFORE anything was planted. Undefined → this generator serves no pathways
   *  and the layout built exactly the map it always did. */
  routes?: RoutePlan
  /** The two COUNTS the pathways layer settled: how many exits, how many pathways. Kept beside the plan because a
   *  settlement lays one street per pathway, and the plan itself only records where the roads run. */
  pathways?: Pathways
  /** The active pass's random source. Defaults to `Math.random`; a seeded layer swaps in its own
   *  `makeRng(seed)` stream so the pass reproduces. EVERY stochastic helper draws from this, never
   *  from `Math.random` directly, so a pass is pure given its rng. */
  rand: Rng
}

/** A ctx viewing the same grid through a DIFFERENT random source, the one seam that lets each
 *  settlement pass run on its own seed while sharing the grid it mutates. */
const withRand = (ctx: ArchetypeContext, rand: Rng): ArchetypeContext => ({ ...ctx, rand })

/**
 * THE PHASES A VARIANT IS BUILT IN, one per layer the backend serves.
 *
 * *"having a layer or a subsystem that is not present in the rest of templates makes no sense, all it does is
 * segment the general core logic"*. Every variant used to be ONE function that painted, flooded, carved and
 * planted in a single pass, so `terrain` was three layers wearing one name and each variant owned a private
 * pipeline nobody could read the order of.
 *
 * A variant declares the four phases instead, and the layers call them. What a variant does not do, it does
 * not declare, rather than the engine leaving a call out.
 *
 * MIGRATING ONE AT A TIME, on purpose. A variant that has not been split yet declares everything under
 * `terrain`, which is exactly where its code runs today, so the suite stays green while they move across.
 * The order only becomes his (terrain, water, pathways, objects) once the last one is split, because until
 * then the archetypes still read `ctx.routes` while they build and the plan has to be made first.
 */
interface VariantPhases {
  /** The ground: the grid's floor by zone, region and season. Decides what may grow and what it looks like. */
  terrain: (ctx: ArchetypeContext, rngs: LayerRngs) => void
  /** Rivers, creeks and pools. Laid BEFORE the pathways, because it is what they have to go around. */
  water?: (ctx: ArchetypeContext, rngs: LayerRngs) => void
  /** The map's STRUCTURE: where the pathways run, and which ground is left to build on. */
  pathways?: (ctx: ArchetypeContext, rngs: LayerRngs) => void
  /** Everything placed on it, and the LOOK of the pathways and the exits. */
  objects?: (ctx: ArchetypeContext, rngs: LayerRngs) => void
}

// BUILT LAZILY, so a phase object declared further down the file can still be in it. A `const` table would
// have to sit below every phase it names, which puts the shape of the whole generator at the bottom.
const buildFor = (variant: VariantId): VariantPhases | undefined => BUILD()[variant]

const BUILD = (): Partial<Record<VariantId, VariantPhases>> => ({
  town: settlementPhases('town'),
  city: settlementPhases('city'),
  forest: {
    terrain: placeForest,
    water: (ctx, rngs) => forestPhases(ctx)?.water?.(ctx, rngs),
    pathways: (ctx, rngs) => forestPhases(ctx)?.pathways?.(ctx, rngs),
    objects: (ctx, rngs) => forestPhases(ctx)?.objects?.(ctx, rngs),
  },
  temple: templePhases,
  cave: cavePhases,
  'boss-stage': bossStagePhases,
})


// ── the floor is a colour ────────────────────────────────────────────────
// The meadow lays ONE flat tile and paints each cell's colour on it; textured tiles are spent on ornaments. The
// other archetypes laid a textured tile as their whole floor (a cave is `cave_floor` wall to wall, a temple a
// checkerboard of two textured tiles, a winter wood is `snow`). They still lay those while they build, because
// their own passes read the labels (a pool is "not the cave floor"). Once an archetype is done, `flattenFloors`
// swaps each open-ground material for the flat tile, wearing that material's colour: the colour stays, only the
// texture goes. Tiles laid on purpose as ornaments (moss patches, the rune ring, bridges) are not open ground, so
// they stay textured.

/** The flat floor every template lays (backend tile `floor`, the meadow's flat tile under a neutral name). */
export const FLAT_FLOOR = 'floor'
/** Floors that are flat already: the meadow's own tile, and this one. */
const FLAT_FLOORS: ReadonlySet<string> = new Set(['meadow', FLAT_FLOOR])
/** The stone a settlement paves its plaza and door steps with. Its building foundations use the same tile, but a
 *  foundation belongs to the building, so `flattenFloors` leaves footprints alone. */
const PLAZA_STONE = 'path_stone'
/** The stone a boss arena is paved with. */
const ARENA_STONE = 'ancient_stone'

/** The open ground a place is MADE of.
 *
 * The biome's own tile when the generator serves one, the SEASON's otherwise. It was the season's only, so a
 * desert city was paved in spring meadow grass: the ground a place is made of is a fact about the PLACE, and
 * the season is what colour it happens to be today. Absent → unchanged, so nothing that looked right moves. */
const openGround = (ctx: ArchetypeContext): string | undefined =>
  ctx.palette?.groundTile ?? zonePalette(ctx.zone)?.groundTypes[0]

/** The OPEN-GROUND labels of each kind of place, read from the served palettes where they come from there. */
const FLOOR_MATERIALS: Readonly<Record<VariantId, (ctx: ArchetypeContext) => ReadonlyArray<string | undefined>>> = {
  town: ctx => [openGround(ctx), PLAZA_STONE],
  city: ctx => [openGround(ctx), PLAZA_STONE],
  forest: ctx => [openGround(ctx), zonePalette(ctx.zone)?.trail],
  cave: ctx => [(cavePalette(ctx.zone) ?? cavePalette('summer'))?.floor],
  temple: ctx => {
    const pal = templePalette(ctx.zone) ?? templePalette('summer')
    return [pal?.floor, pal?.accent]
  },
  'boss-stage': ctx => [openGround(ctx), ARENA_STONE],
}

/** Swap every open-ground material for the flat floor, keeping the colour it wore. */
function flattenFloors(ctx: ArchetypeContext, materials: ReadonlyArray<string | undefined>): void {
  const open = new Set(materials.filter((m): m is string => !!m && !FLAT_FLOORS.has(m)))
  if (open.size === 0) return
  const foundations = buildingFootprints(ctx.buildings)
  forEachCell(ctx.cols, ctx.rows, (col, row) => {
    const material = ctx.ground[row][col]
    if (!open.has(material) || foundations.has(`${col},${row}`)) return
    const tone = ctx.floorColors[row][col] ?? groundTileColor(material, col, row)
    if (!tone) return // no colour served for it: keep its own tile rather than lay a flat one in no colour
    ctx.floorColors[row][col] = tone
    ctx.ground[row][col] = FLAT_FLOOR
  })
}

/** Every cell a building stands on. A placed building's `row` is its BOTTOM row (see placeBuilding). */
function buildingFootprints(buildings: readonly PlacedBuilding[]): Set<string> {
  const cells = new Set<string>()
  for (const b of buildings) {
    for (let row = b.row - (b.height - 1); row <= b.row; row++) {
      for (let col = b.col; col < b.col + b.length; col++) cells.add(`${col},${row}`)
    }
  }
  return cells
}

/** A layer's random source: its own reproducible `makeRng(seed)` when a seed is given, else the
 *  global `Math.random` (today's behaviour, so a plain generate is unchanged). */
/** The rngs the passes in this file ASK FOR BY NAME. A pass that reads `rngs.nature` needs one whether or not
 *  the backend happens to serve a `nature` layer today, so these are filled in after the served ones. This is
 *  not a second list of layers: it is the set of names the CODE in this file uses, and it shrinks as passes
 *  move out into layers of their own. */
const ENGINE_PASS_RNGS: readonly string[] = ['pathways', 'layout', 'buildings', 'nature', 'decor']

const layerRng = (seeds: GenerateOptions['seeds'], layer: EngineLayerId): Rng => {
  const seed = seeds?.[layer]
  return seed === undefined ? Math.random : makeRng(seed)
}

/**
 * A PLAIN COLOUR TO WORK ON: every cell the flat floor tile, one colour, and nothing else in it.
 *
 * Landing on a new template used to lay down a whole generated town.
 *
 * The colour is the floor tile's OWN served colour, so this invents nothing: change it in the backend and every
 * blank map follows. `variant` is inert here, a blank map carries no buildings, props or units for it to steer.
 */
export function blankStage(zone: ZoneId, cols: number, rows: number): StageData {
  const floorColors = makeGrid<string | undefined>(cols, rows, () => undefined)
  forEachCell(cols, rows, (col, row) => {
    floorColors[row][col] = groundTileColor(FLAT_FLOOR, col, row) || undefined
  })
  return {
    zone,
    variant: 'town',
    cols,
    rows,
    ground: makeGrid(cols, rows, () => FLAT_FLOOR),
    collision: makeGrid(cols, rows, () => false),
    buildings: [],
    props: [],
    trees: [],
    compositions: [],
    floorColors,
    connectors: [],
    spawn: { col: Math.floor(cols / 2), row: Math.floor(rows / 2) },
    routes: null,
  }
}

/**
 * THE ORDER GENERATION RUNS IN, as a list you can read.
 *
 * *"we generate the grid, then we add water if any, then we generate pathways with number of exits around the
 * existing area, then we add the rest of vegeation and other things, then we add the characters if any"*.
 *
 * `pathways` is hoisted out of the six archetypes and runs FIRST, which is the half of his order that was only ever
 * a convention: every archetype happened to call `plannedRoutes` near its top, and nothing made it so. It is
 * structural now, and `terrain` reads `ctx.routes` instead of planning its own.
 *
 * Water still runs inside `terrain`, because it is woven into how each archetype paints its ground; pulling it
 * out is its own step and it changes what the maps look like, so it is not smuggled in here.
 *
 * ADDING ONE IS APPENDING A ROW. shadow, lighting, fog, reprocess, water reflection: each is a `name`, an
 * optional `when` guard, and a `run`. `runLayers` does not change, and neither does anything above.
 */
const STAGE_LAYERS: ReadonlyArray<StageLayer<ArchetypeContext, LayerRngs>> = [
  // THE PLAN: how many exits the map has and where its pathways run, as a skeleton.
  //
  // It is drawn in the `pathways` layer below, AFTER the water, which is the order he asked for. The plan
  // itself is made here because the two INTERIORS carve their terrain out of it: a cave's tunnels and a
  // temple's corridors ARE its pathways, so their rock has to know where the ways go before there is any rock.
  // Nothing outdoors reads it during `terrain` any more.
  { name: 'pathways:plan', run: (ctx, rngs) => { planPathways(ctx, rngs.pathways) } },

  // TERRAIN: the grid's ground, by zone, region and season. Still carries WATER and OBJECTS inside it,
  // because each archetype paints, floods and plants in one pass. Splitting those three apart is the work
  // this list is being straightened out for.
  // THE BIOME'S FLOOR AS A BASE COAT, before the variant paints anything.
  //
  // Only the forest and meadow layouts ever called `paintFloor`, so a town, a village and a city never got
  // their biome's ground at all: they laid the SEASON's grass tile and kept its own colour, which is why a
  // desert city was green (measured: 749 cells of #a4ac48, the meadow tile's own colour, on a desert).
  //
  // A base coat rather than a new pipeline layer, and it runs FIRST so every layout that paints its own
  // floor still overwrites it exactly as before. A generator serving no floor colour paints nothing, which
  // is what `paintFloor` already does with an absent `floor`.
  { name: 'terrain', run: (ctx, rngs) => {
    paintFloor(ctx, { floor: ctx.palette?.floor, floorAlt: ctx.palette?.floorAlt, litter: ctx.palette?.litter })
    buildFor(ctx.variant)?.terrain(ctx, rngs)
  } },

  // WATER, laid before the pathways because it is what they go around: *"we should have water go first, because
  // then the pathway can footprint the actual navigable layout, including potentially using bridges"*. Empty
  // for every variant that still carves its own inside `terrain`; they move across one at a time.
  { name: 'water', when: ctx => !!buildFor(ctx.variant)?.water, run: (ctx, rngs) => buildFor(ctx.variant)?.water?.(ctx, rngs) },

  // PATHWAYS: the map's STRUCTURE. *"what the pathways determine is the map structure, what is a pathway,
  // what is a section to put objects, what are the exits, how's the pathway draw"*.
  //
  // This was FOUR entries (`edge`, `gates`, `pathways-clear`, `sightlines`) plus a fifth (`pathways`) at the top and
  // a sixth (`pathway`) below, six names for one layer. None of them is a layer: the border is defined by the
  // exits, the gates are the exits, keeping a way walkable and clearing what stands in it are both the way
  // still being a way. They ran consecutively already, so this is the same order under one name.
  {
    name: 'pathways',
    // A VARIANT WITH NO SERVED ROUTES STILL HAS WAYS. The meadow draws its cobble entrance whether or not a
    // plan was served, and gating the whole layer on `ctx.routes` skipped it: measured, zero lamp posts and
    // no entrance at all on a plain generate. The GATE steps keep their own check, because a gate needs a
    // plan to be cut from; the variant's own way-drawing does not.
    when: ctx => !!ctx.routes || !!buildFor(ctx.variant)?.pathways,
    run: (ctx, rngs) => {
      buildFor(ctx.variant)?.pathways?.(ctx, rngs) // where this variant's pathways actually run
      // AND THE GROUND THEY TOOK IS SPOKEN FOR, so the objects layer chooses from what is genuinely left.
      //
      // Without this the canopy still CHOSE pathway cells (it scores every plantable cell and takes the
      // lowest N) and the guard then refused them one by one, so a region the road ran through came out
      // thinner than the density it was served: measured on a woodland stand, 0.042 against the 0.048 its own
      // test asks for. Claiming the ground first means the field picks other cells and hits the number.
      for (const key of ctx.pathwayCells) {
        const { col, row } = toCell(key)
        ctx.claimed.add(key)
        ctx.claimed.add(`${col + 1},${row}`) // and the two cells drawn in FRONT of it, which would hide it
        ctx.claimed.add(`${col},${row + 1}`)
      }
    },
  },

  // OBJECTS: what the map is dressed with, which is where the LOOK of a way and of an exit is decided.
  // *"then on the objects phase we can pick the type of pathway, type of exit, etc"*.
  //
  // Only two of its steps are here so far. The rest is still inside `terrain`, planted by each archetype.
  {
    name: 'objects',
    // Same as pathways: a map with no served plan is still dressed. Only the two steps that dress a GATE
    // need one.
    when: ctx => !!ctx.routes || !!buildFor(ctx.variant)?.objects,
    run: (ctx, rngs) => {
      buildFor(ctx.variant)?.objects?.(ctx, rngs) // everything this variant plants and builds
      if (!ctx.routes) return
      // THE BORDER IS BLOCKED WITH OBJECTS, which is what an edge IS: *"edge is part of objects, we just used
      // it to determine how to block towns borders with objects with the exception of pathway exits...so for
      // example a edge in a town help us to put a bunch of trees around it"*. It ran in the pathways layer
      // and that was wrong twice over: it is a treeline, and running it before the planting let the passes
      // that repair and join the floor cut straight back out through it. Measured, six holes in a woodland's
      // border that belonged to no exit.
      sealMapEdge(ctx)
      openGates(ctx) // and the exits are cut through it, so they get the last word on the border
      keepPathwaysWalkable(ctx) // nothing placed above may wall a gate in behind it
      clearPathSightlines(ctx) // and nothing that grew is left standing in a way or in front of one
      layPathways(ctx) // the surface a way wears, what lies on it and what stands beside it
    },
  },

  // TERRAIN, FINISHED. Both of these are terrain steps and both have to see the BUILT map: the flatten swaps
  // a textured ground for the flat tile keeping its colour, and the transitions blend the shorelines over
  // whatever ended up painted. A shoreline cannot be drawn before the thing it borders exists, so this is the
  // terrain layer's last word rather than a layer of its own.
  // THE BORDER PASS RUNS LAST, with the other finishing passes over the terrain.
  //
  // It was in the `water` layer, which reads as the right home for it and is the wrong one: the CURRENT is
  // written by the depth pass in `objects`, so at water-layer time `ctx.flow` is still empty and every river
  // classified as a lake and wore a lake's dark still edge. Measured on a "winds through" woodland: 121 cells,
  // all of them `water_smooth_lake_*`.
  //
  // Here it also cannot be undone by anything downstream, which is the other half of the same lesson.
  { name: 'terrain:finish', run: ctx => { flattenFloors(ctx, FLOOR_MATERIALS[ctx.variant]?.(ctx) ?? []); addTerrainTransitions(ctx); borderTheWater(ctx) } },
]

export function generateStage(opts: GenerateOptions): StageData {
  const { zone, variant } = opts
  const cols = opts.cols ?? 40
  const rows = opts.rows ?? 40
  const layout = opts.layout // undefined → placeForest randomly picks a meadow layout (seeded)
  // THE SEASON'S OWN GROUND, from the backend. No palette → no ground: a generate with an unloaded catalog
  // produces an empty map and says so, rather than inventing a green the author never chose.
  const palette = zonePalette(zone)
  if (!palette) console.warn(`[generate] the backend serves no "${zone}" season, the map has no ground`)

  const ground = makeGrid(cols, rows, () => palette?.groundTypes[0] ?? '')
  const collision = makeGrid(cols, rows, () => false)
  const floorColors = makeGrid<string | undefined>(cols, rows, () => undefined)
  // Flat until a pass digs or raises.
  const elevation = makeGrid(cols, rows, () => 0)
  const buildings: PlacedBuilding[] = []
  const props: StageProp[] = []
  const trees: TreeAnchor[] = []
  const compositions: CompositionAnchor[] = []

  // One rng per engine layer. When no seeds are supplied they all alias `Math.random`, so the pass
  // order draws the exact same sequence as before the split, the behaviour-preservation guarantee.
  // ONE RNG PER SERVED LAYER, plus the ones the passes below name directly. When no seeds are supplied they
  // all alias `Math.random`, so the draw order is exactly what it was before the split.
  const rngs: LayerRngs = {}
  for (const key of generationLayerKeys()) rngs[key] = layerRng(opts.seeds, key)
  for (const key of ENGINE_PASS_RNGS) rngs[key] ??= layerRng(opts.seeds, key)
  // Single-pass archetypes (forest/cave/temple/boss) read `ctx.rand`; the layout rng is their source.
  const ctx: ArchetypeContext = { variant, zone, ground, collision, floorColors, elevation, buildings, props, trees, compositions, cols, rows, layout, options: opts.options, nature: opts.nature, settlement: opts.settlement, palette: opts.palette, subZones: opts.subZones, regionLayout: opts.regionLayout, formation: opts.formation, pathway: opts.pathway, treeMix: opts.treeMix, crossings: opts.crossings, pathwayCells: new Set<string>(), exitCells: new Set<string>(), water: new Set<string>(), pools: new Set<string>(), still: new Set<string>(), banks: new Set<string>(), claimed: new Set<string>(), decks: new Set<string>(), fords: new Set<string>(), wet: new Set<string>(), flow: new Map<string, number>(), waterDepth: new Map<string, number>(), molten: isMolten(liquidFor(opts)), buildingSizes: opts.buildingSizes, rand: rngs.layout }
  runLayers(STAGE_LAYERS, ctx, rngs, opts.upTo)

  return {
    zone,
    variant,
    cols,
    rows,
    ground,
    collision,
    floorColors,
    elevation,
    // THE CURRENT, as a grid beside the colours. Absent everywhere means a map with no moving water, which is
    // most of them, and `undefined` at a cell means still.
    flow: ctx.flow.size === 0 ? undefined : (() => {
      const grid: (number | undefined)[][] = Array.from({ length: rows }, () => new Array<number | undefined>(cols).fill(undefined))
      for (const [key, dir] of ctx.flow) {
        const { col, row } = toCell(key)
        if (inBounds(col, row, cols, rows)) grid[row][col] = dir
      }
      return grid
    })(),
    buildings,
    props,
    trees,
    compositions,
    regions: ctx.zoneAt?.map(row => row.map(zone => zone?.key)),
    connectors: [],
    // WHERE YOU COME IN. A map that planned its pathways puts you just inside its entrance, which is the whole point
    // of an entrance; a map that planned none keeps the old choice, so every existing template is unmoved.
    spawn: routeSpawn(ctx) ?? chooseSpawn(buildings, collision, cols, rows),
    routes: ctx.routes ?? null,
    // WHICH CELLS A CROSSING SPANS. The generator has always recorded these; they simply never left it, so
    // anything downstream that needed to ask "is this a bridge" had to guess from tile NAMES. Undefined when
    // the map has no crossing, so nothing changes for a map without one.
    decks: ctx.decks.size === 0 ? undefined : ctx.decks,
    waterDepth: ctx.waterDepth.size === 0 ? undefined : ctx.waterDepth,
    fords: ctx.fords.size === 0 ? undefined : ctx.fords,
    standing: ctx.still.size === 0 ? undefined : ctx.still,
    pathways: ctx.pathwayCells.size === 0 ? undefined : ctx.pathwayCells,
  }
}

// ── settlement archetype ─────────────────────────────────────────────
// Nature density by settlement, a town is leafy (lots of trees around the lots); a city is mostly
// paved. Towns lean green here per design.
const NATURE_MULT: Record<Settlement, number> = { town: 1.15, city: 0.4 }

// Hoisted function decls (not const arrows) so the BUILD table above can reference them.

/**
 * Compose a settlement from independent, SEEDABLE layer passes (GENERATION-SPEC §"layer passes"):
 * the layout skeleton → buildings on its plots → decor → nature. Each pass runs on its own rng
 * (`rngs.<layer>`), so a single layer re-rolls in isolation; run together with aliased `Math.random`
 * rngs they reproduce today's town exactly. Order is load-bearing: layout carves roads BEFORE
 * buildings reserve plots, and decor paves the plaza BEFORE nature plants, so no tree lands on the
 * square, the same order this generator always ran, just named + separable now.
 */
/**
 * A SETTLEMENT, IN PHASES. Its four passes already matched the layers almost exactly, so the cut is where
 * they already were: the layout pass is the map's STRUCTURE, and buildings, decor and nature are objects.
 *
 * AND ITS RIVER IS FINALLY WIRED. `carveMapWater` was written and deliberately left out of the stack, with
 * the measurement that said why: run after `terrain`, a 50x50 town came out severed (three exits asked for,
 * two reachable sides) and with one to three BUILDINGS standing in the water. Both followed from the order,
 * and the note ended *"His own stack puts water BEFORE the rest ... Moving it there is the next step"*. This
 * is that step: water runs before the streets are planned and before anything is built, so the pathways
 * footprint the navigable ground and no house lands in the channel.
 */
function settlementPhases(settlement: Settlement): VariantPhases {
  return {
    // The ground a settlement stands on is the season's, laid before any layer runs. Its own terrain work is
    // the plaza and the street surfacing, which belong to the structure below.
    //
    // ITS NEIGHBOURHOODS, THOUGH, ARE REGIONS, and no settlement ever partitioned them. `partitionSubZones`
    // had three callers and all three were forests, so a city's `upper` / `middle` / `lower` were served on
    // all eleven city templates, typed, documented ("a city's neighbourhoods differ by money, and money shows
    // in the architecture"), parsed, and read by nothing at all. Every city came out architecturally uniform.
    //
    // A village and a town serve none, so they take the same single call and are unmoved.
    terrain: ctx => {
      shapeRegions(ctx)
    },

    water: carveMapWater,

    pathways: (ctx, rngs) => {
      ctx.villageLayout = layoutPass(withRand(ctx, rngs.layout), settlement)
    },

    objects: (ctx, rngs) => {
      const layout = ctx.villageLayout
      if (!layout) return
      buildingsPass(withRand(ctx, rngs.buildings), layout)
      decorPass(withRand(ctx, rngs.decor), layout)
      naturePass(withRand(ctx, rngs.nature), layout, settlement)
      // THE STONE A NEIGHBOURHOOD ASKS FOR. A graveyard is open ground inside a town like a park is, and with
      // no stone in it the two measured as the same place: same greenery, same nothing built. `stone` was
      // served for it and only the forest builders ever read one.
      strewRegionRuins(ctx)
      // AND GET ACROSS IT. A bridge is an object, and it is the first thing the objects phase owes the
      // pathways: *"if you want to put actual tiles or objects specifically related to pathways, like a
      // bridge to go over a river for example ... it'll still happen at the end of the process and can be the
      // start of the objects phase"*.
      const course = riverCourse(ctx, 'through')
      if (!course || ctx.water.size === 0) return
      bridgeRiver(ctx, flowingWater(ctx), ctx.pathwayCells, course, waterPalette(ctx))

      // AND THE TOWN IS ONE PLACE. A settlement had NO connectivity repair at all, which was harmless while it
      // had no water: measured the moment the river was wired, a 50x50 town came out in up to four pieces with
      // small pockets stranded behind the channel. The forests have answered this since they got rivers, with
      // the same function and the same bound, and after the bridge so the deck is never filled back in.
      repairFloorConnectivity(ctx, MEADOW_MAX_POCKET)

      // AND IT SETTLES BY DEPTH, which is what makes it a RIVER rather than a patch of blue.
      //
      // *"a river is not a river withouyt a channel"*. Every forest has ended its build with this since it
      // got water, and the settlement was wired up without it: measured, a town's river came out as ONE flat
      // `water` tile end to end, no wadeable shallow at the edge, no deep middle, no bend where it turns,
      // and its banks standing above it only 74% of the time against a forest's 100%. A water ZONE, which is
      // exactly what he called it. Last, after the bridge, for the same reason the forests do it last.
      settleWaterDepth(ctx, waterPalette(ctx))
    },
  }
}

/**
 * LAYOUT pass, the "map without structures nor nature": plan a logical road/plot skeleton + a
 * central plaza (villageLayout.planVillage) and carve the streets into the ground as the dark-gray
 * ROAD tile. Returns the plan the later passes build on. This is the layer a "randomize layout only"
 * re-rolls; the caller then clears buildings + nature so only roads/plots/ground remain.
 */
export function layoutPass(ctx: ArchetypeContext, settlement: Settlement): VillageLayout {
  const { ground, cols, rows } = ctx
  // A building's SIZE is backend data (the composition footprints). With none loaded there is no size to plan
  // and nothing to stamp, so the settlement gets NO buildings, a size is never invented (MAP-MODEL §8). Say it
  // out loud: an empty town is a data problem, and the one thing worse than no buildings is silent no buildings.
  if (BACKEND_BUILDING_SIZES.lengthOf('house') === null) {
    console.warn(
      '[stageGenerator] no building compositions are loaded, planting NO buildings. The sizes come from ' +
        '/api/tilesets, which has not installed the tileset yet.',
    )
  }
  const layout = planVillage(cols, rows, ctx.rand, ctx.buildingSizes ?? BACKEND_BUILDING_SIZES, settlement, ctx.settlement, streetPlanFor(ctx))
  // WHAT THIS PLACE PAVES WITH. It was `road` for a town and a city alike, so a village had
  // asphalt through it. The place says it now; with nothing served it stays the road it always was.
  const streets = ctx.settlement?.streets ?? 'road'
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Roads are a COLOUR on the ground BLOCK, not a separate ROAD tile. The base ground stays (a height-1 block)
      // and is tinted asphalt, so a
      // road is FLUSH with the grass, no raised road-tile trench. Road IDENTITY lives in `layout.roads` (read by
      // placement + scatter), never re-derived from the ground kind.
      if (!layout.roads[r][c]) continue
      ctx.floorColors[r][c] = groundTileColor(streets, c, r)
      // AND A STREET IS A PATHWAY, so it says so. Nothing recorded a settlement's streets as pathway cells,
      // so `ctx.pathwayCells` was empty for every town and city: the served pathway surface, its scatter and
      // its lining all had nothing to act on, and the guard that keeps things out of a road saw no road. The
      // forests have filled this since they were split into phases; a settlement simply never did.
      ctx.pathwayCells.add(`${c},${r}`)
    }
  }
  snapGatesToStreets(ctx, layout)
  adoptStreetsAsPathways(ctx, layout)
  return layout
}

/**
 * A GATE SITS ON A STREET.
 *
 * The streets are laid to meet the gates, but two gates on the same axis can want lines closer together than a
 * buildable block fits between, and only one of them gets a street of its own. Measured on a 40x40 town asked
 * for 4 exits: the north gate landed four columns off the south gate's street, opened onto no road at all, and
 * the map had four mouths but three pathways in.
 *
 * So the GATE moves to the street, rather than the street being bent to the gate. Two gates sharing one street
 * is a road THROUGH the town, which is what a through road is anyway.
 */
function snapGatesToStreets(ctx: ArchetypeContext, layout: VillageLayout): void {
  const plan = ctx.routes
  if (!plan) return
  for (const gate of plan.gates) {
    const band = nearestStreetBand(gate, layout, ctx.cols, ctx.rows)
    if (!band) continue // no street runs to that edge: the gate keeps the mouth the planner gave it
    moveGateInto(gate, band)
  }
}

/** A run of cells one street covers where it meets an edge, as first and last position along that edge. */
interface StreetBand {
  lo: number
  hi: number
}

/** The street band nearest this gate on the edge it sits on, read off the paved cells rather than off the
 *  planner's numbers, so it is the street that is actually there. Null when no street reaches that edge. */
function nearestStreetBand(gate: Gate, layout: VillageLayout, cols: number, rows: number): StreetBand | null {
  const alongRow = gate.side === 'west' || gate.side === 'east'
  const span = alongRow ? rows : cols
  const paved = (at: number): boolean => {
    if (gate.side === 'west') return layout.roads[at][0]
    if (gate.side === 'east') return layout.roads[at][cols - 1]
    if (gate.side === 'north') return layout.roads[0][at]
    return layout.roads[rows - 1][at]
  }
  const bands: StreetBand[] = []
  for (let at = 0; at < span; at++) {
    if (!paved(at)) continue
    const last = bands[bands.length - 1]
    if (last && last.hi === at - 1) {
      last.hi = at
      continue
    }
    bands.push({ lo: at, hi: at })
  }
  if (bands.length === 0) return null
  const mid = gate.cells[Math.floor(gate.cells.length / 2)]
  const at = alongRow ? mid.row : mid.col
  const distance = (b: StreetBand): number => Math.max(b.lo - at, 0, at - b.hi)
  return bands.reduce((best, b) => (distance(b) < distance(best) ? b : best))
}

/** Re-centre a gate's mouth inside a street band, and the cell just inside it with it. */
function moveGateInto(gate: Gate, band: StreetBand): void {
  const width = gate.cells.length
  const start = band.lo + Math.max(0, Math.floor((band.hi - band.lo + 1 - width) / 2))
  const along = (cell: RouteCell, at: number): RouteCell =>
    gate.side === 'west' || gate.side === 'east' ? { col: cell.col, row: at } : { col: at, row: cell.row }
  const moved = gate.cells.map((cell, i) => along(cell, start + i))
  gate.cells.length = 0
  gate.cells.push(...moved)
  gate.inside = along(gate.inside, start + Math.floor(width / 2))
}

/**
 * THE STREETS BECOME THE MAP'S WAYS.
 *
 * *"street is just a form of pathway"* (2026-09-14). The pathways layer plans a WINDING route from gate to gate,
 * which is what a forest trail is; a settlement paves a STRAIGHT grid instead. Keeping both left a town with
 * two networks: the streets you see, and a wandering corridor that `pathways-clear` then kept walkable straight
 * through the blocks and `sightlines` stripped trees along.
 *
 * So the settlement hands its streets back as the pathways. Every layer below this one works on the roads that are
 * actually there. The GATES are untouched: they are what the streets were placed to meet.
 *
 * Mutates the sets in place rather than replacing `ctx.routes`, because this pass runs on a `withRand` copy of
 * the context and a fresh object would never reach the layers that come after it.
 */
function adoptStreetsAsPathways(ctx: ArchetypeContext, layout: VillageLayout): void {
  const plan = ctx.routes
  if (!plan) return
  plan.cells.clear()
  for (let r = 0; r < ctx.rows; r++) {
    for (let c = 0; c < ctx.cols; c++) {
      if (layout.roads[r][c]) plan.cells.add(`${c},${r}`)
    }
  }
  // A gate keeps its own mouth even when its street was clamped a row off it, so a way out is never walled in.
  for (const gate of plan.gates) {
    for (const cell of gate.cells) plan.cells.add(`${cell.col},${cell.row}`)
    plan.cells.add(`${gate.inside.col},${gate.inside.row}`)
  }
  // A street does not pinch, so the whole of it is spine. That is what a cave uses the distinction for.
  plan.spine.clear()
  for (const key of plan.cells) plan.spine.add(key)
}

/**
 * BUILDINGS pass, stamp one typed composition on each plot the layout reserved. plot.row/plot.col
 * are the MIN-ROW/MIN-COL of the small `length × depth` footprint rect; placeBuilding blocks every
 * footprint cell (a roof from above) EXCEPT the road-facing door. The composition KIND is a plot
 * decision (its type + facade length name house_4 / store_5 …); per-building appearance variety
 * (material / roof / wall colour) is rolled at load (applyStageToGrid), which is what a
 * "randomize buildings only" re-rolls.
 */
/** Is every cell of this footprint dry land? A building stands on the ground, never in the water. */
function rectOnLand(ctx: ArchetypeContext, rect: { col: number; row: number; w: number; h: number }): boolean {
  for (let row = rect.row; row < rect.row + rect.h; row++) {
    for (let col = rect.col; col < rect.col + rect.w; col++) {
      if (!isLandCell(ctx, col, row)) return false
    }
  }
  return true
}

export function buildingsPass(ctx: ArchetypeContext, layout: VillageLayout): void {
  const { buildings, cols, rows } = ctx
  for (const plot of layout.plots) {
    // THE FOOTPRINT THE PLOT ROLLED decides the building, not a baked name. `composedKind` names the
    // composition the backend will lay out for that size; `buildingCompositionKind` named the nearest
    // AUTHORED one, which is the snap asked to be removed, The editor composes every kind this pass names
    // before the stamp runs.
    const kind = ctx.buildingSizes?.defaultOf
      ? composedKind(plot.type, { w: plot.length, h: plot.depth })
      : buildingCompositionKind(plot.type, plot.length)
    const rect = footprintRect(plot)
    if (!rectInBounds(rect, cols, rows)) continue // planner's rectClear guarantees this; stay safe
    // AND NOT IN THE RIVER. The plot planner lays its grid geometrically and knows nothing about water, which
    // was harmless while a settlement had none. Measured the moment it got one: two houses in a town and one
    // in a city standing in the channel. It read as fine for a while only because the PLAZA was paving over
    // the river first, so by the time anything asked, those cells were no longer water.
    if (!rectOnLand(ctx, rect)) continue
    if (!plotIsBuilt(ctx, rect)) continue
    buildings.push(placeBuilding(ctx, plot, rect, kind))
  }
}

/** DECOR pass, the town SQUARE (well/fountain) + street lamps along the frontages. */
export function decorPass(ctx: ArchetypeContext, layout: VillageLayout): void {
  villageDecor(ctx, layout)
}

/** NATURE pass, trees ringing the lots (denser toward the edges) + a light scatter of grass /
 *  flowers over the open floor. This is the layer a "randomize trees / nature only" re-rolls. */
export function naturePass(ctx: ArchetypeContext, layout: VillageLayout, settlement: Settlement): void {
  // EVERY NUMBER HERE IS SERVED, and all three used to be ignored.
  //
  // `NATURE_MULT[settlement]` stays as the DEFAULT, which is what this file's own rule says defaults are for,
  // but the served `natureMultiplier` wins: eight rows carry one and none of them could reach this line.
  fillVillageNature(ctx, layout, ctx.settlement?.natureMultiplier ?? NATURE_MULT[settlement])
  // The densities are the served `nature` block, the same one `scatterTallGrass` already reads. They were
  // literals here, so town_forest's 0.28/0.08 and town_swamp's 0.45/0.08 were dead data. No served share means
  // NONE, exactly as the tall-grass pass states it: this file invents no numbers.
  const cover = ctx.nature?.groundCover
  if (cover !== undefined) scatterGroundCover(ctx, cover, layout) // flat ground tufts; skips paved streets + colour roads
  const blooms = ctx.nature?.flowers
  if (blooms !== undefined) scatterFlowers(ctx, blooms, layout) // STANDING blooms (single billboards, height 1) over open grass
}

/**
 * Fill the non-road, non-building cells with trees, denser toward the map EDGES so the
 * village sits in a leafy clearing ringed by forest, sparse in the built core. Reuses the
 * glade-tree stamper (full vertical extent) with blue-noise spacing; never on a street.
 */
function fillVillageNature(ctx: ArchetypeContext, layout: VillageLayout, natureMult = 1): void {
  const { collision, ground, buildings, cols, rows } = ctx
  // Cells occupied by (or hugging) a building, never plant a tree here, so doors + facades
  // stay clear (a door is walkable, so treeFits alone would happily plant a tree on it).
  const nearBuilding = new Set<string>()
  for (const b of buildings) {
    for (let r = b.row - b.height; r <= b.row + 1; r++) {
      for (let c = b.col - 1; c <= b.col + b.length; c++) nearBuilding.add(`${c},${r}`)
    }
  }
  const placed: Cell[] = []
  const minDist = 3
  const attempts = Math.floor(cols * rows * 0.5)
  for (let i = 0; i < attempts; i++) {
    const col = randIntWith(ctx.rand, 2, cols - 3)
    const row = randIntWith(ctx.rand, 2, rows - 3)
    // The tree's trunk cell must clear PAVED floors (the stone plaza, driveways, roads) AND stay off
    // buildings/roads, a door is walkable, so treeFits alone would happily plant a tree on it. The canopy is
    // walkable overhead, so only the trunk cell is checked.
    if (!treeColumnClearsPaving(ground, col, row)) continue
    if (layout.roads[row]?.[col] || nearBuilding.has(`${col},${row}`)) continue
    // NOR ON GROUND LAYER 3 ALREADY SPOKE FOR, which is what `claimed` means (GENERATION-SPEC §5.1: the
    // pathways layer owns where the exits are, the objects layer puts the trees). A settlement's GATE cells
    // are not part of `layout.roads`: that grid is the streets INSIDE the town, a gate is the mouth at the
    // border. So this asked every question except the one covering the exit, and a town planted in its own
    // way out while every forest, which reads the same set, did not.
    if (ctx.claimed.has(`${col},${row}`)) continue
    if (!treeFits(collision, col, row, cols, rows)) continue
    const sideDist = Math.min(col, cols - 1 - col) // distance from the LEFT/RIGHT edge
    const edgeDist = Math.min(sideDist, row, rows - 1 - row)
    // Denser toward the SIDES, the village sits in a clearing framed by forest left & right, but
    // the INTERIOR stays leafy too (a Pokémon-style town nestled in trees, not bare lots).
    // …AND THE NEIGHBOURHOOD IT FALLS IN.
    //
    // This pass read the distance to the edge and nothing else, so a settlement's regions were told apart by
    // their walls and by nothing a person can see between the walls: a `park` serving canopy 1.4 and a
    // `market` serving 0.1 grew exactly the same trees. Measured, a city's park came out indistinguishable
    // from its lower quarter, its market and its middle.
    //
    // `canopy` MULTIPLIES the base density, which is what that field means in every other builder, so a
    // region that states none leaves this pass exactly as it was.
    const green = ctx.zoneAt?.[row]?.[col]?.canopy ?? 1
    const p = (sideDist < 5 ? 0.82 : edgeDist < 4 ? 0.66 : edgeDist < 9 ? 0.52 : 0.36) * natureMult * green
    if (ctx.rand() > p) continue
    if (placed.some(t => Math.abs(t.col - col) < minDist && Math.abs(t.row - row) < minDist)) continue
    stampTree(ctx, col, row, ctx.rand() < DEAD_TREE_CHANCE[ctx.zone])
    placed.push({ col, row })
  }
}

/** A village square below the houses: a central well, flanking lamp-posts, and a
 *  short fence line, turns "houses on grass" into a place. */
/** Village plaza + street lighting: a well OR fountain centrepiece, and lamp posts dotted
 *  along the frontages (gaps between buildings), all in the shared block art style. */
function villageDecor(ctx: ArchetypeContext, layout: VillageLayout): void {
  const { cols, rows, collision } = ctx
  const streetRows = [...new Set(layout.entrances.filter(e => e.side === 'left').map(e => e.row))].sort((a, b) => a - b)
  if (streetRows.length === 0) return
  // Cells occupied by a building footprint (INCLUDING the walkable door). Decor must never land here:
  // a door is walkable, so the plaza/lamp checks below would otherwise drop a fountain on a door and
  // block the only way in. Build the exclusion set from the placed buildings.
  const buildingCells = new Set<string>()
  // Door + its driveway (door + one step toward the road) are walkable, so they pass the collision
  // check, but a lamp there would block the entrance or stand in the paved drive. Exclude both.
  const doorways = new Set<string>()
  for (const b of ctx.buildings) {
    const top = b.row - (b.height - 1)
    for (let r = top; r <= b.row; r++) for (let c = b.col; c < b.col + b.length; c++) buildingCells.add(`${c},${r}`)
    const [dc, dr] = FACING_STEP[b.facing]
    for (const door of b.doorCells) {
      doorways.add(`${door.col},${door.row}`) // the walkable entrance cell(s)
      doorways.add(`${door.col + dc},${door.row + dr}`) // its paved driveway step toward the road
    }
  }
  const decorFree = (c: number, r: number): boolean =>
    !collision[r]?.[c] && !layout.roads[r]?.[c] && !buildingCells.has(`${c},${r}`) && !doorways.has(`${c},${r}`)
  // The town SQUARE: ONE big fountain (rarely a pond) on the plaza the planner reserved dead-centre
  // BEFORE the houses, the settlement's focal landmark, not a leftover-space afterthought.
  placeCentrepiece(ctx, layout.plaza)
  // Lamp posts every ~6 cells along each street's frontage gaps (never on a road or building). Each is a
  // COMPOSITION (post base + lamp on top) stamped at load, NOT a single lamp prop, so both art styles render
  // the same post+lamp structure. Every lamp is placed STEADY; AFTER placement a tiny random subset (≤2) is
  // flipped to the flickering variant, so "only 1 or 2 lamps" flicker no matter how many the settlement has.
  // NO LAMPS. *"please remove the bulbs I really don't want to see them anymore"*. A `lamp_post` IS a real
  // composition, a post with the lamp on top, but its bulb reaches the grid carrying none of its cell
  // settings, so it draws as a full cube at ground level rather than a lit head on a post. Placing more of
  // them only puts more cubes on the map. The composition stays in the catalog: it is what a street lamp
  // should be rebuilt from, once the stamp carries its settings through.
}

/** Stamp the town SQUARE the planner reserved dead-centre BEFORE the houses: pave the whole block
 *  path_stone, then drop ONE big fountain (rarely a pond) at its centre. The fountain is a SINGLE
 *  prop spanning a central odd-sized basin (collision-blocked, you walk the paved ring around it), *  not N clustered mini-structures. A pond fills the same central basin with water instead. */
function placeCentrepiece(ctx: ArchetypeContext, plaza: PlazaRect | null): void {
  if (!plaza) return
  const { cols, rows, ground, collision } = ctx
  const { c0, r0, size } = plaza
  // Pave the whole square as a walkable stone plaza (the ring you stroll around the basin), EXCEPT where the
  // water already is. *"objects are put in the free spaces that the map has after pathways and river has
  // run"*, and this stamped straight over a river: measured on a town with a `divides` course, 20 channel
  // cells came out as `path_stone` still sunk at elevation -1, a paved street lying in the river bed.
  for (let r = r0; r < r0 + size; r++)
    for (let c = c0; c < c0 + size; c++) {
      if (!inBounds(c, r, cols, rows) || !isLandCell(ctx, c, r)) continue
      ground[r][c] = PLAZA_STONE
    }

  // The centrepiece is a COMPOSITION (rim + water), not a special prop: pick the variant by settlement size,
  // record its anchor centred in the square (footprint TOP-LEFT, the origin stampComposition places from).
  // Pre-block its footprint so generation-time decor (lamps/trees) stays off it; the stamp re-derives
  // collision from its cells at load.
  const kind = pickCentrepiece(size)
  const { w: fw, h: fh } = CENTREPIECE_FOOTPRINT[kind]
  // A FOUNTAIN STANDS ON FREE GROUND, like any other object.
  //
  // *"the fountain should always be positioned on empty space, like any other object, sometimes is even put
  // in the same place as the bridge"*. The paving above already refused to pave the water; the fountain
  // itself was pushed at the square's centre whatever was there, so a plaza straddling a river got its
  // basin in the channel and, where the crossing landed in the same square, on top of the bridge.
  //
  // The centre is still preferred; only when the centre will not take it does it look elsewhere in the
  // square, and if nothing in the square is free the town simply has no fountain. An object that cannot
  // stand somewhere sensible is better absent than standing in a river.
  const spot = centrepieceSpot(ctx, plaza, fw, fh)
  if (!spot) return
  for (let r = spot.row; r < spot.row + fh; r++)
    for (let c = spot.col; c < spot.col + fw; c++) if (inBounds(c, r, cols, rows)) collision[r][c] = true
  ctx.compositions.push({ kind, col: spot.col, row: spot.row, variant: 0 })
}

/**
 * WHERE THE CENTREPIECE FITS: the middle of the square when the middle is free, else the first place in the
 * square that is, else nowhere.
 *
 * "Free" is the same question every other object asks: every cell of the footprint is land, none is water,
 * none is a crossing, and nothing has claimed it. The plaza's own paving is not a claim, it is the ground the
 * fountain stands on.
 */
function centrepieceSpot(ctx: ArchetypeContext, plaza: PlazaRect, fw: number, fh: number): Cell | null {
  const { c0, r0, size } = plaza
  const fits = (col: number, row: number): boolean => {
    if (col < c0 || row < r0 || col + fw > c0 + size || row + fh > r0 + size) return false
    for (let r = row; r < row + fh; r++) {
      for (let c = col; c < col + fw; c++) {
        if (!inBounds(c, r, ctx.cols, ctx.rows)) return false
        if (!isLandCell(ctx, c, r)) return false
        if (ctx.decks.has(`${c},${r}`) || ctx.fords.has(`${c},${r}`)) return false
        if (ctx.collision[r][c]) return false
      }
    }
    return true
  }
  const centre = { col: c0 + Math.floor((size - fw) / 2), row: r0 + Math.floor((size - fh) / 2) }
  if (fits(centre.col, centre.row)) return centre
  for (let row = r0; row + fh <= r0 + size; row++) {
    for (let col = c0; col + fw <= c0 + size; col++) if (fits(col, row)) return { col, row }
  }
  return null
}

/** Footprint rect type, the cells a building actually occupies on the grid. */
interface FootRect {
  col: number
  row: number
  w: number
  h: number
}

/** The oriented GROUND footprint rect for a plot: south/north run length×depth (cols×rows); east/west
 *  swap to depth×length. `plot.col`/`plot.row` are the rect's top-left. Mirrors villageLayout's
 *  `footprint`, so the stamp lands exactly on the small road-free plot the planner reserved. */
/**
 * DOES THIS PLOT GET A BUILDING, which is the one thing that separates a park from a terrace.
 *
 * A settlement's regions were neighbourhoods in name only: this pass walked the planner's plots and built
 * every single one, so `upper` / `middle` / `lower` could differ in wall material and in nothing else. A city
 * has parks, a market square, a green and a graveyard, and every one of those is defined by the ground NOT
 * being built on. No region could say so, so none of them could exist.
 *
 * `built` is that share, read at the plot's own centre so a plot belongs to one neighbourhood rather than
 * being split between two. A region that states none is fully built, which is what every settlement does
 * today, so nothing that exists moves until the backend serves a number.
 */
function plotIsBuilt(ctx: ArchetypeContext, rect: FootRect): boolean {
  const share = ctx.zoneAt?.[Math.floor(rect.row + rect.h / 2)]?.[Math.floor(rect.col + rect.w / 2)]?.built
  if (share === undefined) return true
  return ctx.rand() < share
}

function footprintRect(plot: Plot): FootRect {
  const horizontal = plot.facing === 'south' || plot.facing === 'north'
  return { col: plot.col, row: plot.row, w: horizontal ? plot.length : plot.depth, h: horizontal ? plot.depth : plot.length }
}

const rectInBounds = (rect: FootRect, cols: number, rows: number): boolean =>
  rect.col >= 0 && rect.row >= 0 && rect.col + rect.w <= cols && rect.row + rect.h <= rows

/**
 * A building cell's CORNER / EDGE / INTERIOR class within its GROUND footprint rect, * the directional sub-classification a real tileset needs (a corner tile ≠ an edge
 * tile ≠ an interior fill tile). The 9 classes laid out on the rect:
 *
 *     nw   n   ne
 *      w   ·   e        (· = interior)
 *     sw   s   se
 *
 * Derived from the cell's position in the grid-aligned footprint rect (length × depth),
 * NOT facade-relative, so it maps straight onto the cells a tileset paints on the ground.
 * Degenerate footprints collapse their thin axis (N wins over S, W wins over E): a
 * 1-deep strip reads nw/n/ne, a 1-wide strip nw/w/sw, and a 1×1 footprint is 'nw'.
 */
export type BuildingEdge = 'nw' | 'n' | 'ne' | 'w' | 'interior' | 'e' | 'sw' | 's' | 'se'

export function footprintEdgeClass(col: number, row: number, rect: FootRect): BuildingEdge {
  const vert = row === rect.row ? 'n' : row === rect.row + rect.h - 1 ? 's' : '' // N wins on a 1-row strip
  const horiz = col === rect.col ? 'w' : col === rect.col + rect.w - 1 ? 'e' : '' // W wins on a 1-col strip
  if (vert && horiz) return (vert + horiz) as BuildingEdge // a corner: nw / ne / sw / se
  return (vert || horiz || 'interior') as BuildingEdge // an edge (n/s/e/w) or the interior fill
}

// ── shared DEBUG-LABEL vocabulary ───────────────────────────────────────────
// One labeling standard for EVERY element so the debug overlay reads uniformly and the
// labels can guide future tile replacement. The format is `<TYPE> <POSITION>`, the same
// scheme buildings already use ("BUILDING NE") generalized to every multi-cell asset, and
// IDENTICAL across the top / 2D / iso views because all three build their captions through
// these PURE helpers (no view computes a label on its own).

// A footprint edge CLASS (n/s/e/w/nw/ne/sw/se/interior) → the ONE shared POSITION vocabulary
// (TOP/BOTTOM/LEFT/RIGHT + hyphenated corners + INTERIOR) that terrain autotiling also uses, so a
// building/fountain cell reads the SAME token format as a grass cell, the consistency the tileset
// swap needs. Mirrors cellLabels.SLOT_TOKEN (compass class ↔ autotile slot).
const EDGE_TOKEN: Readonly<Record<string, string>> = {
  n: 'TOP', s: 'BOTTOM', e: 'RIGHT', w: 'LEFT',
  nw: 'TOP-LEFT', ne: 'TOP-RIGHT', sw: 'BOTTOM-LEFT', se: 'BOTTOM-RIGHT',
  interior: 'INTERIOR',
}

/** The POSITION token for a footprint cell, corner/edge/interior CLASS → the shared display token
 *  (TOP-LEFT/TOP/…/INTERIOR). The single place a class is tokenized, so a building cell, a fountain
 *  cell, and a grass cell all read the same `<TYPE> <POSITION>` format. */
export function edgeToSide(edge: string): string {
  return EDGE_TOKEN[edge] ?? edge.toUpperCase()
}

/** Generalizes footprintEdgeClass into the caption SIDE for ANY multi-cell element (tree mass,
 *  fountain basin, …), not just buildings: NE/NW/SE/SW / N/S/E/W / INTERIOR derived purely from
 *  the cell's place in its footprint rect. Every view derives a cell's side through this. */
export function footprintSide(col: number, row: number, rect: FootRect): string {
  return edgeToSide(footprintEdgeClass(col, row, rect))
}

/** Concentric ring of a footprint cell: 0 = the outer rim, increasing inward to the centre.
 *  Lets a fountain basin read rim → water → centre (the inner rings beyond the rim). Pure. */
export function footprintRing(col: number, row: number, rect: FootRect): number {
  return Math.min(col - rect.col, rect.col + rect.w - 1 - col, row - rect.row, rect.row + rect.h - 1 - row)
}

// Trunk vs canopy from a tree cell's CellLabel. The vertical column stems (incl. the dead snag)
// are the TRUNK; the solid cap / walkable apex is the CANOPY TOP; an autotiled forest-MASS cell
// maps its 9-piece leaf label to a canopy SIDE (NW…SE / INTERIOR), so a tree mass labels exactly
// like a building footprint; a plain leaf is the CANOPY.
const TREE_TRUNK_LABELS: ReadonlySet<string> = new Set(['tree_stem_bottom', 'tree_stem', 'tree_snag'])
const TREE_CANOPY_TOP_LABELS: ReadonlySet<string> = new Set(['tree_crown', 'tree_leaf_top'])
const TREE_MASS_SIDE: Readonly<Record<string, string>> = {
  tree_top_left: 'TOP-LEFT', tree_top: 'TOP', tree_top_right: 'TOP-RIGHT',
  tree_edge_left: 'LEFT', tree_interior: 'INTERIOR', tree_edge_right: 'RIGHT',
  tree_bottom_left: 'BOTTOM-LEFT', tree_bottom: 'BOTTOM', tree_bottom_right: 'BOTTOM-RIGHT',
}

/** A tree cell's debug sub-part from its CellLabel: 'TRUNK' for stem/snag cells, 'CANOPY TOP' for
 *  the apex cap, 'CANOPY <SIDE>' for an autotiled forest-mass cell, 'CANOPY' for a plain leaf.
 *  '' when the label is missing/unknown (the cell then reads as a bare 'TREE'). Pure + view-agnostic. */
export function treeSubpart(label?: string): string {
  if (!label) return ''
  if (TREE_TRUNK_LABELS.has(label)) return 'TRUNK'
  if (TREE_CANOPY_TOP_LABELS.has(label)) return 'CANOPY TOP'
  const side = TREE_MASS_SIDE[label]
  if (side) return `CANOPY ${side}`
  if (label === 'tree_leaf') return 'CANOPY'
  return ''
}

/** THE single, PURE debug caption for one placed cell: `<TYPE> <POSITION>`, or a bare `<TYPE>` for a
 *  single-cell element. EVERY debug overlay (top / 2D / iso) builds its captions through this one
 *  function, so a cell's label can never drift between views. `pos` is the already-resolved position
 *  token, footprintSide for footprint elements, treeSubpart for trees, '' for single-cell assets. */
export function labelForCell(type: string, pos = ''): string {
  const t = type.toUpperCase()
  return pos ? `${t} ${pos}` : t
}

/**
 * Where ONE facade offset lands on the grid, per facing, the SAME quarter-turn `rotateFootprintOffset`
 * applies when the stamp rotates a south-baked composition to face its road. A door tile authored at
 * `(dx, dy = depth-1)` rotates to: south → the bottom edge at +dx; north (180°) → the top edge mirrored;
 * west (90° CW) → the left edge at row +dx; east (270°) → the right edge mirrored down the rows. Deriving
 * the opening through the SAME geometry is what stops it drifting from the doorway that gets drawn.
 * Dispatch map, not an if/else chain, a new facing is a new row here.
 */
const DOOR_CELL_AT: Readonly<Record<Facing, (rect: FootRect, offset: number) => Cell>> = {
  south: (rect, offset) => ({ col: rect.col + offset, row: rect.row + rect.h - 1 }),
  north: (rect, offset) => ({ col: rect.col + rect.w - 1 - offset, row: rect.row }),
  west: (rect, offset) => ({ col: rect.col, row: rect.row + offset }),
  east: (rect, offset) => ({ col: rect.col + rect.w - 1, row: rect.row + rect.h - 1 - offset }),
}

/**
 * The walkable DOOR cells, the building's way in, on the footprint's ROAD-FACING edge. Every OTHER
 * footprint cell blocks.
 *
 * The opening spans the FULL drawn door on EVERY facing (G7: ). `door` is the composition's own door span along its
  * south-baked facade
 * (`buildingDoorOffset`), and each offset in `[door.x, door.x + width)` is mapped through `DOOR_CELL_AT`, * the stamp's own rotation, so a 2-door facade opens BOTH cells wherever it faces. East/west used to
 * collapse to a single mid-edge cell on the grounds that `draw2DBuilding` drew only one door column there;
 * that drawer is gone (H2 dead-code sweep) and buildings now render through the generic per-cell
 * composition path in all three views, so a rotated 2-door facade really does stamp two door tiles down
 * its edge, one walkable cell left the other half walled off.
 */
export function doorCells(facing: Facing, rect: FootRect, door: { x: number; width: number }): Cell[] {
  const cellAt = DOOR_CELL_AT[facing]
  const cells: Cell[] = []
  for (let i = 0; i < door.width; i++) cells.push(cellAt(rect, door.x + i))
  return cells
}

/**
 * The building's DOOR SPAN along its facade, READ from the composition the stamp will draw (never
 * re-derived): `buildingDoorOffset` returns the ground-level `door` cells' first offset + how many there
 * are, which the backend builds from the one `door_cols/1` list that also places the entrance apron, so
 * doors, apron and opening can only ever agree.
 *
 * DEGRADED FALLBACK: the tileset holder starts EMPTY and is filled from `/api/tilesets` at load
 * (MAP-MODEL §8), so an un-loaded (or unknown) kind has no readable door span. We still open a 1-cell
 * centred entrance, a building with NO opening would seal the player out of the stage entirely, but we
 * WARN, because that width is a guess and a wide door would come out half-walled. The shipped app never
 * takes this path: the editor's render gate blocks until the tilesets are installed, so every real
 * generate reads the composition. (It is reachable from a unit test that skips the tileset fixture.)
 */
function facadeDoorSpan(kind: string, facadeLength: number): { x: number; width: number } {
  const span = buildingDoorOffset(kind)
  if (span) return span
  console.warn(
    `[stageGenerator] composition "${kind}" is not in the loaded tileset, opening a GUESSED 1-cell entrance ` +
      `at the facade centre. The real door span is unknown until /api/tilesets installs the tileset.`,
  )
  return { x: Math.floor(facadeLength / 2), width: 1 }
}

/**
 * Reserve a building's small GROUND FOOTPRINT (`rect`, width × depth): pave a stone base and BLOCK every
 * footprint cell (collision true) EXCEPT the road-facing DOOR cells, which stay WALKABLE. This is
 * the collision blueprint spawn/enemy placement reads BEFORE the stamp; the building's actual tiles are
 * stamped from its composition at load (applyStageToGrid → stampBuildingComposition), so we emit NO
 * per-cell building props here, the composition IS the tiles. Returns the placed building's metadata
 * (kind + footprint + door + facing) the nature/decor passes and the load-time stamp use.
 */
function placeBuilding(
  ctx: ArchetypeContext,
  plot: Plot,
  rect: FootRect,
  kind: string,
): PlacedBuilding {
  const { ground, collision, cols, rows } = ctx
  // The walkable entrance + its driveway span the composition's REAL door, an even facade is baked with a
  // centred 2-wide doorway, so a hardcoded 1-cell opening walled off half of it (G7).
  const doors = doorCells(plot.facing, rect, facadeDoorSpan(kind, plot.length))
  const isDoor = new Set(doors.map(d => `${d.col},${d.row}`))
  // A building is a ROOM, not a solid obstacle: its SHELL blocks (walls + windows, you don't walk through a
  // window), the DOORWAY is the way in, and the INTERIOR is walkable floor you move around on. Blanket-blocking
  // the whole rect (the old `!isDoor` line) let the hero stand in the doorway and go nowhere, // Image #5: "I can't navigate inside the house". Per-cell truth still comes from the composition's own
  // `walkable` flags when it stamps; the generator must not pre-seal what the composition leaves open.
  const lastCol = rect.col + rect.w - 1
  const lastRow = rect.row + rect.h - 1
  for (let row = rect.row; row <= lastRow; row++) {
    for (let col = rect.col; col <= lastCol; col++) {
      if (!inBounds(col, row, cols, rows)) continue
      if (!isLandCell(ctx, col, row)) continue // and never a foundation laid in the river
      ground[row][col] = 'path_stone' // brown stone BASE under the building (freed from roads, §2b)
      const shell = col === rect.col || col === lastCol || row === rect.row || row === lastRow
      collision[row][col] = shell && !isDoor.has(`${col},${row}`)
    }
  }
  // `row` = the rect's BOTTOM row; `length`/`height` = the rect's grid span (cols×rows), so the nature
  // math + the load-time stamp read the real small footprint (and its TOP-LEFT) regardless of facing.
  const zone = ctx.zoneAt?.[Math.floor(rect.row + rect.h / 2)]?.[Math.floor(rect.col + rect.w / 2)]
  const built = zone?.buildings
  return {
    type: plot.type, col: rect.col, row: rect.row + rect.h - 1, length: rect.w, height: rect.h,
    depth: plot.depth, facing: plot.facing, doorCells: doors, kind,
    region: zone?.key, roof: built?.roof, material: built?.materials?.[0],
  }
}

// ── forest archetype (≈ Viridian Forest, per docs/ALGORITHMS.md): a fully-
//    forested map carved by a biased drunkard's walk into a winding, connected
//    trail with glades, then blue-noise trees dotting the clearings ──────────
function placeForest(ctx: ArchetypeContext): void {
  const { ground, zone, cols, rows } = ctx
  const floor = zonePalette(zone)?.groundTypes[0] ?? '' // zone floor: grass / snow / ash; none served → bare
  forEachCell(cols, rows, (col, row) => {
    ground[row][col] = floor
  })
  // The forest builds one of the MEADOW layouts; the old passages/open/lake generators are retired.
  // An explicit meadow layout is honoured; a plain generate (no/legacy layout) RANDOMLY
  // picks one, seeded from ctx.rand, so it's reproducible per seed. Dispatch map (Open/Closed).
  // A layout this forest does not know (a settlement's `modern_city`, or nothing at all) rolls a meadow, the
  // same fallback a plain generate always had.
  forestPhases(ctx)?.terrain(ctx, {})
}

/**
 * Pick a forest layout at random (seeded via the caller's rng), the forest's default when the user hasn't
 * steered one.
 *
 * ONLY LAYOUTS WHOSE PREREQUISITES ARE MET. `woodland` needs a served `nature.canopy` and correctly plants
 * nothing without it; putting it in the pool unconditionally meant a plain `generateStage({variant:
 * 'forest'})` could roll it and hand back an empty field. That is worse than the old behaviour, because it
 * fails only sometimes, it broke six existing generator tests exactly one run in four.
 *
 * A layout that cannot run is not a candidate. The alternative, letting it run and inventing a canopy
 * density, is the hardcoded fallback the compliance rule forbids.
 */
function forestLayoutCandidates(nature: NatureDensity | undefined): readonly ForestLayout[] {
  const meadows: readonly ForestLayout[] = ['meadow', 'meadow_pass']
  // The canopy layouts need a served tree density to build from; without one they would plant nothing, so
  // they only enter the pool when the generator actually supplies `nature.canopy`.
  const canopied: readonly ForestLayout[] = ['woodland', 'jungle']
  return nature?.canopy === undefined ? meadows : [...canopied, ...meadows]
}

function pickMeadowLayout(rand: Rng, nature: NatureDensity | undefined): ForestLayout {
  const pool = forestLayoutCandidates(nature)
  return pool[randIntWith(rand, 0, pool.length - 1)]
}

/** The water options as the generator serves them, read once so the three forest layouts cannot drift apart
 *  on what a river or a crossing means. An absent option is OFF: the catalog row says `default: false`, and
 *  inventing a value here is exactly the hardcoded fallback the compliance rule forbids. */
/**
 * THE RIVER'S COURSE.
 *
 *   · `through`, winds across the map edge to edge, and is easy to cross in several places
 *   · `divides`, cuts the map in two, and can be crossed at exactly ONE place
 *   · `around` , runs around the edge, leaving the way in open
 */

/** Resolve the served `river` option to a course, or null for no river. `random` is one of the choices, not
 *  the only behaviour, which is the whole of the note. An old boolean recipe (`river: true`) keeps the river
 *  its layout always had, so a saved map does not change under anyone. */
function riverCourse(ctx: ArchetypeContext, legacy: RiverCourse): RiverCourse | null {
  return resolveRiverCourse(ctx.options?.river, legacy, ctx.rand)
}

/**
 * DID THE PERSON SAY NO RIVER, as opposed to saying nothing at all.
 *
 * `resolveRiverCourse` answers null for both, which is right for every layout that simply has no river when
 * none is asked for. It is not enough for a layout with a river OF ITS OWN: the jungle carves its creek when
 * no course is picked, so *"sometimes I select 'no river' and still get one"*, measured, 180 water cells on
 * a jungle and a swamp with `river: none`, against 0 on the six templates that have no creek of their own.
 *
 * A default is what you get when nobody chose. A choice is not a default.
 */
function riverRefused(ctx: ArchetypeContext): boolean {
  const asked = ctx.options?.river
  return asked === 'none' || asked === false
}


/** Carve the river along its course. `around` is the existing perimeter river; the other two are channels
 *  that cross the whole map, which is what makes them cross it or cut it. */
function carveRiver(ctx: ArchetypeContext, course: RiverCourse, pal: GeneratorPalette | undefined): Set<string> {
  if (course === 'around') {
    const water = paintMeadowRiver(ctx)
    // A template that serves its own water colour wears it here too, not the meadow's blue. THE TONE, FLAT:
    // this used to pass it through `varyIntensity(…, 0.44)`, which is not a no-op (it darkens ~4%), so a
    // perimeter river came out a slightly different blue from a carved one. One water colour, everywhere.
    if (pal?.water) for (const key of water) { const { col, row } = toCell(key); ctx.floorColors[row][col] = pal.water }
    levelTheWater(ctx, water) // the one course that does not come through carveChannel
    return water
  }
  // THE SEA, which is a shape and not a subsystem: `classifyBody` reads it as a beach on its own because it
  // runs along the map edge, so the border pass picks the beach pieces with no branch anywhere.
  if (course === 'shore') return carveShore(ctx, pal)
  // `divides` is wide and nearly straight across the middle, so it reads as a barrier; `through` meanders.
  const water = course === 'divides'
    ? carveChannel(ctx, pal, { half: 2.3, swing: 0.05, horizontal: true })
    : carveChannel(ctx, pal, { half: 1.6, swing: 0.26 })
  return water
}

/**
 * THE WAYS GIVE GROUND TO THE RIVER, once, right where it was carved.
 *
 * The pathways ARE
 * drawn first, and this is the adapting: whatever stretch of a way the channel landed on stops being a way,
 * except for the one crossing that keeps both banks joined. Everything after it (the paving, the decking, the
 * gates) sees a network that no longer runs down the river, so none of them needed a change.
 *
 * The `around` course does not come through here on purpose: a perimeter river has the map's edge on one side,
 * so its "pathways" are the bridge it always had.
 */
/*
 * THE PATHWAYS USED TO GIVE GROUND TO THE RIVER, and they no longer have to.
 *
 * `narrowPathways` ran inside `carveRiver`: the ways were drawn FIRST, so whatever stretch of one the channel
 * landed on stopped being a way, except for the single crossing that kept both banks joined. It was the only
 * way to reconcile the two while the river was cut after the roads.
 *
 * With water as its own layer that runs before them, the reconciling is not needed: *"we should have water go
 * first, because then the pathway can footprint the actual navigable layout, including potentially using
 * bridges. if we do water after, then we'd have to run pathways twice or separate it into more layers, we
 * don't need nor want that"*. A pathway meets the water and is crossed, rather than being cut back from it.
 */

/**
 * Get across it, the way its course says. Several crossings make `through` traversable; exactly ONE makes
 * `divides` a real division; `around` keeps the bridge it always had over its near arm.
 */
/** The longest unbroken run in a sorted list of positions, as its first and last. A river that meanders
 *  touches one straight line in several places, and a crossing belongs to ONE of them: the widest, which is
 *  the channel rather than a puddle the same slice happens to clip. */
function widestRun(sorted: readonly number[]): { from: number; to: number } {
  let bestFrom = sorted[0], bestTo = sorted[0]
  let from = sorted[0], prev = sorted[0]
  for (const at of sorted.slice(1)) {
    if (at === prev + 1) { prev = at; continue }
    if (prev - from > bestTo - bestFrom) { bestFrom = from; bestTo = prev }
    from = at
    prev = at
  }
  if (prev - from > bestTo - bestFrom) { bestFrom = from; bestTo = prev }
  return { from: bestFrom, to: bestTo }
}

function bridgeRiver(ctx: ArchetypeContext, water: Set<string>, routes: Set<string>, course: RiverCourse, pal: GeneratorPalette | undefined): void {
  // A RIVER THAT CUTS A PATH IS ALWAYS CROSSED. It used to be a toggle, "A crossing joined to the paths",
  // and he asked what it even meant and why it was in the UI. It meant: off, the river got fallen logs at
  // random spots and the path simply stopped at the water; on, a real crossing was placed where the path
  // meets it.
  //
  // There is no map where the first is wanted. A path that walks into a river and ends is a broken map, not a
  // variation, so the crossing is unconditional now and the option is gone.
  // NO BRIDGE, ASKED FOR. A river nobody built a way over is a river you go around, which is a map, not a
  // defect: the only thing that was missing was being able to choose it.
  if (crossingRefused(ctx)) return
  // A DIRT CROSSING IS ALREADY DONE, and laying a deck over it UNDOES it.
  //
  // `deckRoutes` fords the route where it meets the water. This then laid a second crossing over the same
  // river, and `clearForDeck` strips every prop on a deck's cells, so it wiped the water films off the ford
  // that was already there: measured, 10 of a map's 18 ford cells left as bare opaque route.
  //
  // Nothing to add, then, unless no route crossed at all and the map has no ford yet.
  if (!crossingStyle(ctx)?.composition) {
    if (ctx.fords.size === 0) fellLogsAcross(ctx, water, pal, [0.5])
    return
  }
  if (course === 'around') { crossRiver(ctx, water, routes, true); return }
  if (placeRiverCrossing(ctx, water, routes)) return
  // NOTHING CROSSES ON THE PATHS HERE, so this is the one case that still needs a ford of its own.
  //
  // It used to add MORE on top of a crossing that had already been placed, at fixed fractions of the river,
  // and they are the "extra zones" that keep getting reported. They are also the cells you end up standing in
  // plain water on: `fellLogsAcross` swaps the ground for shallow water, so unlike a crossing laid by
  // `deckRoutes` there is no route under it and no film over it, just river you can walk on. One ford, where
  // the map genuinely has no other way over.
  fellLogsAcross(ctx, water, pal, [0.5])
}

/** Every cell the route network PROMISES you can reach: the mouths of its ways out, and the stops where a
 *  path ends on purpose. A crossing carrying one of these is never the redundant one. */
function promisedCells(plan: RoutePlan, gateLanes: ReadonlySet<string>): Set<string> {
  const out = new Set<string>(gateLanes)
  for (const stop of plan.deadEnds) out.add(`${stop.col},${stop.row}`)
  for (const gate of plan.gates) for (const cell of gate.cells) out.add(`${cell.col},${cell.row}`)
  return out
}

/** Forest layout builders, keyed by the user-steered ForestLayout. Each runs on the already-floored ctx
 *  and is fully responsible for the floor gradient / trees / river / ornaments / repair.
 *  Open/Closed: register a layout here, no dispatcher edits. */
const forestLayoutTable = (): Readonly<Partial<Record<ForestLayout, VariantPhases>>> => ({
  // A RIVER IS AN OPTION, not a layout.
  // It was already an option INSIDE the builder, `layoutWoodland(ctx, {river: true})`, and only the
  // catalog row and the layout string duplicated per combination. Now the option reaches the builder from
  // the generator's declared options, and `woodland_river` / `meadow_river` are gone as layouts.
  woodland: woodlandPhases,
  // A JUNGLE HAS ITS OWN BUILDER. It used to share the woodland's with heavier numbers, but density is not
  // the difference: light gaps instead of clearings, a creek instead of trails, blocking undergrowth,
  // emergents.
  jungle: junglePhases,
  meadow: meadowPhases(false),
  meadow_pass: meadowPhases(true),
})

/**
 * WHICH FOREST THIS IS, decided once and remembered.
 *
 * The layout used to be rolled inside `placeForest`, which was fine while one function built the whole map.
 * With the phases split across layers it has to be the SAME answer in all four, so the terrain phase resolves
 * it and the rest read it back.
 */
function forestPhases(ctx: ArchetypeContext): VariantPhases | undefined {
  if (!ctx.forestLayout) {
    const named = ctx.layout as ForestLayout | undefined
    ctx.forestLayout = named && forestLayoutTable()[named] ? named : pickMeadowLayout(ctx.rand, ctx.nature)
  }
  return forestLayoutTable()[ctx.forestLayout]
}

// ── 'woodland' layout, an ACTUAL forest ──────────────────────────────────────
//
// That is right, and the measurement was blunt: the Forest category's presets produced
// ~10% tree cover scattered at random over an open field. That is a lawn with shrubs on it. Worse, the
// category described itself as "Open meadow and tree masses" and `forest_meadow` as "tree masses filling
// the rest", both promising something the code never built. `scatterFramingTrees` says so in its own
// comment:
//
// A meadow framed by trees is a fine thing and it stays. It is simply not a forest, so the category now
// leads with one.
//
// THE INVERSION. A meadow decides where trees are ALLOWED (a band near the edges) and leaves the rest
// empty. A woodland decides where they are ABSENT, trees are the field, and clearings are carved out of
// it. That single reversal is the whole layout:
//
//   1. canopy everywhere the density says, as coherent stands rather than per-cell coin flips
//   2. carve a handful of organic CLEARINGS out of it
//   3. cut WINDING PATHS joining every clearing, so nothing is sealed off
//   4. dress the clearings with the ground cover / flowers the generator asked for
//
// Step 3 is not decoration: a dense forest with no connectivity guarantee produces sealed pockets, and a
// spawn inside one is an unplayable level. The paths are cut AFTER the canopy and clear whatever they
// cross, which makes reachability a property of the construction rather than something to test for.

/** Woodland tuning that is NOT the generator's to state, the shape of the algorithm, not its dial. */
const WOODLAND = {
  /**
   * Clearings per 1,000 cells.
   *
   * Two clearings on a small map gave ONE trail between them, which
   * is not a network. Raised so a map always has somewhere to go as well as somewhere to stand.
   */
  clearingsPerThousand: 5,
  /** A clearing's radius range, in cells. */
  clearingRadius: [2, 5] as const,
  /** How wide a path through the trees is, when the template serves no width of its own. It was 2, the bottom
   *  of what was asked for, and a 2-wide corridor with a tree leaning into it walks like a 1-wide one. */
  pathWidth: 3,
} as const

/** How deep the edge band runs. The gate is `pathWidth` (3) cells across, so a one-cell band reads as a fence
 *  beside a three-cell opening rather than an edge that thickens. Two is the least that reads as a BAND. */
const EDGE_TREELINE = 2

/**
 * THE RIVER, for a map whose own archetype did not make one.
 *
 * *"towns should work withn rivers and everything we have on forests too, like bidges and whatnot"*
 * (2026-09-14). A town served no water options at all and its archetype has no water pass, so a settlement
 * could never have a river however the map was set.
 *
 * `carveRiver` and `bridgeRiver` are the SAME functions the three forest layouts call. Nothing about water is
 * re-implemented here: this is the general layer, and the template supplies the course, the palette and
 * whether it wants a crossing, which is the shape he asked the layers to have.
 *
 * NOT WIRED INTO THE STACK YET, and here is the measurement that says why. Run AFTER `terrain`, which is the
 * only place the "has this map already made water" guard can be asked, a 50x50 town came out with 120 to 141
 * water cells and 60 bridge cells, and:
 *   · the river SEVERED it. Three exits asked for came back as two reachable sides, because a town's pathways are
 *     planned but not paved, so the crossing does not join the two banks for walking.
 *   · one to three BUILDINGS stood in the water, because the river was cut after the town was built.
 *
 * Both follow from the order. His own stack puts water BEFORE the rest: *"we generate the grid, then we add
 * water if any, then we generate pathways ... then we add the rest"*. Moving it there means the forest
 * layouts stop carving their own, which is a change to three layouts he has already approved, so it is the
 * next step rather than something to slip in behind a guard.
 *
 * The OPTIONS are served on a town regardless, because that half is backend data and costs nothing.
 */
/**
 * THE COLOURS THIS MAP'S WATER WEARS.
 *
 * A settlement serves no `palette` at all, so handing `ctx.palette` to the water passes `undefined` and the
 * river comes out with no water colour, no bank and no shallow: the three tones that make a channel read as
 * one. A forest states its own; everything else falls back to the meadow's, which is the water every map had
 * before any template stated one.
 */
/**
 * LAVA IS THE SAME WATER IN A DIFFERENT COLOUR, which is the whole of what he asked for. The served `lava`
 * tone replaces the `water` one, so every pass that paints the surface, the banks and the body beneath keeps
 * working and nothing downstream learns a new liquid.
 *
 * It takes the caller's OWN palette rather than choosing one. Four passes each have their own answer for what
 * colour their water is (a settlement's served palette, a jungle's `pal`, the meadow's fallback), and routing
 * them all through one chooser handed every template the meadow's invented fallback: the "paints NOTHING when
 * the backend serves no palette" case caught it immediately. Only the lava override is shared.
 */
function molten(ctx: ArchetypeContext, pal: GeneratorPalette | undefined): GeneratorPalette | undefined {
  const lava = isMolten(liquidFor(ctx)) ? ctx.palette?.lava : undefined
  if (!lava) return pal
  return { ...(pal ?? {}), water: lava, waterDeep: lava, waterShallow: lava }
}

/** A settlement's water colour: its served palette, else the meadow's fallback, with lava applied over it. */
function waterPalette(ctx: ArchetypeContext): GeneratorPalette | undefined {
  return molten(ctx, ctx.palette?.water ? ctx.palette : meadowWater(ctx))
}

/**
 * THE BORDER PASS. Whatever shape the water came out as, its edge cells get the family's edge pieces and its
 * middle gets the middle piece.
 *
 * *"the only thing we need is to have some type of algorithm that takes care of correctly positioning the
 * 'border water tiles' on the actual border of the other terrain... we identify what coordinates are in the
 * border of the circle, then we ensure those use the tiles that have the border color, and voila, looks like
 * river, like lake, like anything, even when it's at the same level of the terrain."*
 *
 * It runs on the WATER LAYER rather than inside any one variant, so a river, a swamp pool, a lake and a
 * harbour all get it from the same place and a new variant gets it for free.
 *
 * The cells come from the ground itself rather than from `ctx.water`, because the two disagree: a swamp pool
 * is a film over dry ground and never joins that set, and a ford deliberately leaves the route walkable. What
 * this pass is asked is "which cells LOOK like water", which is what the ground says.
 */
/**
 * ICE IS ITS OWN MATERIAL, not a body of water to be bordered.
 *
 * Both spellings, because both are written: a winter river freezes to `frozen_water` and a winter cave pools
 * `ice_water`. Both pass `isWaterGround`, so leaving either out of this set had the border pass repaint the
 * ice as liquid water, which is what the "freezes into WALKABLE ice" case caught.
 */
const ICE_MATERIALS: ReadonlySet<string> = new Set(['frozen_water', 'ice_water'])

function borderTheWater(ctx: ArchetypeContext): void {
  const body = new Set<string>()
  for (let row = 0; row < ctx.rows; row++) {
    for (let col = 0; col < ctx.cols; col++) {
      const here = ctx.ground[row][col]
      if (ICE_MATERIALS.has(here)) continue
      if (isWaterGround(here)) body.add(`${col},${row}`)
    }
  }
  if (!body.size) return
  // ONE BODY AT A TIME. A map can carry a river and a pool at once, and they are not the same kind of water,
  // so each connected body is classified and edged on its own. Running the pass over all the water together
  // would give a pool the river's foam.
  const set = waterSetFor(ctx)
  const open = openWater(ctx, body)
  for (const cells of waterBodies(body)) {
    // `open` is every water cell with NOTHING STANDING IN IT, which is what the edge test asks about. The
    // painted set is still the whole body: the ground under a boulder is water and stays water.
    paintWaterBody(ctx.ground, cells, set, classifyBody(cells, ctx.flow, ctx.cols, ctx.rows), open)
  }
}

/**
 * THE WATER YOU CAN SEE ACROSS: the body, minus every cell with something solid standing in it.
 *
 * *"water border should show in anything that 'collapses' with it, so a big rock in middle, definitely needs
 * borders"*.
 *
 * `WATER.md` §1 states the rule as *"every cell whose orthogonal neighbour is not water is a boundary cell"*,
 * and read literally that means a boulder standing midstream is invisible to the edge pass: its cell is still
 * painted water, so the water around it is all interior and the rock sits in a flat sheet with no shore. The
 * rule is about what the water MEETS, and it meets the rock exactly as it meets the bank.
 *
 * BLOCKING is the test, not merely "a prop is here". A lily or a floating leaf is on the water, not in its
 * way, and the water does not break around it. `strewRiverRocks` marks its boulders blocking, which is the
 * same fact that stops you walking through them.
 *
 * KNOWN LIMIT: a composition is counted at its ANCHOR cell only, so a multi-cell structure standing in water
 * borders one cell of its footprint rather than all of them. Nothing in the catalog stands in water across
 * more than one cell today, so this is recorded rather than solved.
 */
function openWater(ctx: ArchetypeContext, body: ReadonlySet<string>): Set<string> {
  const open = new Set(body)
  for (const prop of ctx.props) if (prop.blocking) open.delete(`${prop.col},${prop.row}`)
  for (const comp of ctx.compositions) open.delete(`${comp.col},${comp.row}`)
  for (const tree of ctx.trees) open.delete(`${tree.col},${tree.row}`)
  return open
}

/** Which LIQUID this map is filled with, served like every other look. Unserved falls back to the default
 *  rather than to a guess, and an unknown name falls back too rather than painting labels that resolve to
 *  nothing. */
export function liquidFor(ctx: { options?: Record<string, GeneratorOptionValue> }): Liquid {
  const served = ctx.options?.water
  return LIQUIDS.includes(served as Liquid) ? (served as Liquid) : DEFAULT_LIQUID
}

/** The piece family this map's liquid draws with. */
const waterSetFor = (ctx: ArchetypeContext): WaterSet => setForLiquid(liquidFor(ctx))

function carveMapWater(ctx: ArchetypeContext): void {
  const course = riverCourse(ctx, 'through')
  if (!course) return
  for (const key of carveRiver(ctx, course, waterPalette(ctx))) {
    ctx.water.add(key)
    ctx.claimed.add(key)
  }
}

/**
 * THE EDGE IS DEFINED BY THE EXITS. Everywhere else on the border is closed.
 *
 * *"the town edge is defined by the exits, every other place should be blocked somehow, by structure or trees,
 * or whatever"* (2026-09-14). So this is not a forest pass any more: it runs for every map, and what it plants
 * is the template's OWN species, which is the shape he asked for on the layers generally, *"a general module
 * that enforces the layers we have, then we just change the things SPECIFIC to the template generator, but
 * overall rules are the same"*.
 *
 * A map that walls its own border already (a cave, a temple) has every band cell blocking, so this finds
 * nothing to do and plants nothing. A town and a forest both had an open border and both get closed.
 *
 * Measured 2026-09-14: a woodland, a jungle and a meadow each had 156 of 156 border cells walkable, and a
 * 50x50 town 196 of 196. The map had no edge at all, so you left wherever you liked and the `exits` count
 * could never mean anything: every one of them read 4 pathways out however many were asked for.
 *
 * His call on what closes a wood: a dense treeline, broken only at the gates. The band is planted with the
 * species that grow WHERE EACH CELL IS (`speciesAt`), which is why a jungle edge is jungle and a meadow edge
 * is meadow without this function knowing anything about either, and why a town's edge is whatever its own
 * template grows. It asked the TEMPLATE alone before, and it plants 290 of a woodland's 343 trees, so the
 * regions it runs through decided nothing about a map's wood.
 *
 * Runs BEFORE `openGates`, which then cuts the pathways back through it. Cells the route network already claimed
 * are left alone, so a path that reaches the border is not planted over on its way out.
 *
 * A generator that serves no pathways plans no routes, and its map is left exactly as it was.
 */
/** Does anything grow at this cell? A region states its own canopy, so a place that grows almost nothing says
 *  so in its own data and the border seal reads it rather than a list of biome names being kept in sync. */
const BARE_CANOPY = 0.1

function barelyGrows(ctx: ArchetypeContext, col: number, row: number): boolean {
  const canopy = ctx.zoneAt?.[row]?.[col]?.canopy
  return canopy !== undefined && canopy < BARE_CANOPY
}

function sealMapEdge(ctx: ArchetypeContext): void {
  const plan = ctx.routes
  if (!plan) return
  const { collision, trees, cols, rows } = ctx
  // THE BORDER OPENS AT GATES AND NOWHERE ELSE. The route network is spared so a path is not planted over on
  // its way out, but where that network TOUCHES the border it was leaving extra holes: measured, a lone cell
  // three along from the gate, and a three-cell run beside another gate, each counting as one more opening
  // than was asked for. Inside the map the whole network is spared; on the ring, only the gates.
  //
  // WHAT IT SPARES IS THE PUBLISHED WAY, not the planned one. The plan is the centreline a layout was cut
  // from; the way the map actually carries is `pathwayCells`, and a forest's gate LANES are in one and not
  // the other. So the treeline planted straight into the mouth you walk out through: measured at seed 4, 3
  // of a woodland's 7 trees standing on a way, 3 of a meadow's 8 and 1 of a jungle's 4.
  const spared = new Set<string>()
  for (const key of ctx.pathwayCells) {
    const { col, row } = toCell(key)
    if (!isEdge(col, row, cols, rows)) spared.add(key)
  }
  for (const key of plan.cells) {
    const { col, row } = toCell(key)
    if (!isEdge(col, row, cols, rows)) spared.add(key)
  }
  for (const gate of plan.gates) {
    spared.add(`${gate.inside.col},${gate.inside.row}`)
    for (const c of gate.cells) spared.add(`${c.col},${c.row}`)
  }
  forEachCell(cols, rows, (col, row) => {
    const depth = Math.min(col, row, cols - 1 - col, rows - 1 - row)
    if (depth >= EDGE_TREELINE) return               // not in the band
    if (spared.has(`${col},${row}`)) return          // a way runs through here
    // A RIVER MOUTH IS NOT A WAY OUT. *"I think we're counting river exits as exits, vbut they don't count
    // towards pathways exits"*. Measured on every forest and every river course: he asks for 2 exits and the
    // border shows FOUR openings, two gates and two places the river runs off the map. The water is already
    // impassable there, so it is not a way out you can use; it is a hole in the treeline that reads as one.
    // The band closes over it, which is what a wooded bank looks like anyway.
    const wet = isWaterGround(ctx.ground[row][col]) || ctx.wet.has(`${col},${row}`)
    if (collision[row][col] && !wet) return          // something already stands here, and it is not the river
    // A BARE PLACE IS WALLED WITH ROCK, not with a wood.
    //
    // The border is shut with whatever grows there, which is right in a wood and absurd at the top of a
    // mountain: on an ordered region set the map's edge IS the first and last region, so a summit served
    // `canopy: 0.02` had the whole northern ring planted and came out the DENSEST region on the map, 72 trees
    // per 100 cells against the foot's 14.5. That is the exact inverse of the rule its own reference states,
    // *"the higher you get to the mountain the less vegetation there is"*.
    //
    // A place with almost nothing growing in it still needs its border shut, so it is shut with what is
    // actually there. No new art: `rock` has been in the catalog all along.
    if (barelyGrows(ctx, col, row)) {
      // SHUT, not scattered. This closes the border of a place with almost nothing growing in it, which is a
      // WALL of stone. `makeRock` drew it as a line of loose boulders along a mountain edge.
      placeProp(ctx, makeRockFace(col, row, rockShades()))
      collision[row][col] = true
      ctx.pathwayCells.delete(`${col},${row}`)
      return
    }
    plantTree(ctx, { col, row, kind: pickLivingTree(ctx.rand(), speciesAt(ctx, col, row)), variant: massVariant(col, row) })
    collision[row][col] = true
    // AND A CELL THE WOOD CLOSED IS NO LONGER A WAY. Only a ring cell reaches here, since everything else the
    // map publishes as a way is spared above, and a ring cell with no gate on it is a place the border stays
    // shut. It stayed in `pathwayCells` all the same, so the map went on calling it a way: a street that runs
    // the full span reaches the edge at both ends and a town published 12 such cells, each now paved, counted
    // as pathway, and holding the trunk that closes it. The sweeps could not answer that, because taking the
    // tree out is the one thing the border rule forbids. Dropping the claim is the honest half, and it takes
    // the paving with it, so the way now stops where the wood does.
    ctx.pathwayCells.delete(`${col},${row}`)
  })
}

/**
 * A WAY STAYS WALKABLE. Nothing may be built across a road.
 *
 * A settlement plans its pathways like every other map and then lays its streets and plots without consulting the
 * plan, so a gate can end up walled in behind a block of houses. Measured: a city asked for 4 exits and one
 * seed gave 3 reachable sides, because one gate's corridor was built over.
 *
 * This is the general rule rather than a settlement patch: a cell a way covers is a cell you can walk. It runs
 * after everything that builds, so it has the last word, in the same way `gates` has the last word on the
 * border. Water is left alone: a river crossing a way is what a bridge is for, and drying the river to make a
 * road would be the wrong fix.
 */
function keepPathwaysWalkable(ctx: ArchetypeContext): void {
  const plan = ctx.routes
  if (!plan) return
  const { collision, cols, rows } = ctx
  // THE BORDER IS THE GATES' BUSINESS, not this layer's. A way that touches the ring would otherwise open it
  // wherever it happens to run, which is the same hole the treeline was taught to close.
  const gate = new Set<string>()
  for (const g of plan.gates) for (const c of g.cells) gate.add(`${c.col},${c.row}`)
  const opened: Cell[] = []
  for (const key of plan.cells) {
    const { col, row } = toCell(key)
    if (!inBounds(col, row, cols, rows)) continue
    if (isEdge(col, row, cols, rows) && !gate.has(key)) continue
    if (isWaterGround(ctx.ground[row][col]) || ctx.wet.has(key)) continue
    if (!collision[row][col]) continue
    collision[row][col] = true // keep it shut for now; the reachable ones are opened below
    opened.push({ col, row })
  }
  if (opened.length === 0) return

  // OPEN ONLY WHAT JOINS UP. Clearing every planned cell made a cave grow a one-cell island: a cell the plan
  // ran through, surrounded by rock the cave never carved, walkable and unreachable. So each one is opened
  // only when it already touches somewhere you can stand, and the sweep repeats while that keeps being true,
  // which grows the corridor outward from the map instead of punching holes in it.
  let grew = true
  while (grew) {
    grew = false
    for (const { col, row } of opened) {
      if (!collision[row][col]) continue
      const joins = ORTHO.some(([dc, dr]) => {
        const c = col + dc, r = row + dr
        return inBounds(c, r, cols, rows) && !collision[r][c]
      })
      if (!joins) continue
      collision[row][col] = false
      grew = true
    }
  }
}

/**
 * KEEP THE PATH IN SIGHT: no tree stands between the camera and a way.
 *
 * *"the trees formation on right side block the pathway from top … I think it's fine to keep the tree formation
 * but we can tune it towards where it doesn't block the pathway view"* (2026-09-14, Image #61).
 *
 * In an isometric view the two cells drawn IN FRONT of `(col,row)` are `(col+1,row)` and `(col,row+1)`: they
 * are painted later and they are a whole tree tall, so anything there hides the cell behind it. Measured over
 * three seeds each: a woodland hid 42 of 489 path cells that way, a jungle 43 of 525, a meadow 12 of 489.
 *
 * The formation is KEPT, as he asked. What changes is that a tree does not take the one cell where it would
 * stand in the way of a road. The trees are cleared rather than shortened because the renderer draws a tree at
 * one height; a short species is a different ticket.
 *
 * NEVER THE BORDER BAND. A tree there is holding the edge closed, and pulling one out would open a way nobody
 * asked for, which is the bug two layers above this one exists to prevent.
 */
function clearPathSightlines(ctx: ArchetypeContext): void {
  const plan = ctx.routes
  if (!plan) return
  const { collision, trees, cols, rows } = ctx
  // The cells that must be free of trees: every cell a way covers, and the cell drawn in front of each.
  //
  // ON the way matters more than in front of it, and it was the bigger number: measured, 19 of 31 remaining
  // in a woodland and 20 of 33 in a jungle were trees standing IN the road rather than beside it. Nothing
  // planted them there on purpose; the canopy fills a density and the road was simply not excluded from it.
  //
  // The border band is exempt, because a tree there is what holds the edge shut, EXCEPT where the band cell is
  // itself part of a way.
  //
  // THE RING ITSELF IS THE GATES' BUSINESS, though, and that is a rule rather than an accident. It used to hold
  // by luck: a forest trail wanders, so it touches the ring exactly once, at its gate. A settlement's pathways are
  // STREETS and every one of them runs the full span, so both ends of every street were being cleared and the
  // edge opened. Measured on his 40x40 town asked for 2 exits: 6 openings across 3 streets.
  const gateWay = new Set<string>()
  for (const gate of plan.gates) {
    for (const c of gate.cells) gateWay.add(`${c.col},${c.row}`)
    gateWay.add(`${gate.inside.col},${gate.inside.row}`)
  }
  const mayClear = (c: number, r: number): boolean => !isEdge(c, r, cols, rows) || gateWay.has(`${c},${r}`)
  const mustSee = new Set<string>()
  const inBand = (c: number, r: number) => Math.min(c, r, cols - 1 - c, rows - 1 - r) < EDGE_TREELINE
  for (const key of plan.cells) {
    const { col, row } = toCell(key)
    // NOTHING STANDS IN A ROAD, INCLUDING IN THE BAND.
    //
    // `mayClear` keeps the RING shut where no gate runs, which is right: a tree there holds the map's edge.
    // But a way's own cells one and two rows in from the ring were being spared as well, and that is the
    // gate CORRIDOR: the stretch you walk out through. Measured on his meadow, trees stood at 15,38 and
    // 15,39 on a gate at 12 to 14, so the way out had trees in it and the exit was off to the side.
    if (inBounds(col, row, cols, rows) && mayClear(col, row)) mustSee.add(key) // nothing stands IN a road
    for (const [dc, dr] of [[1, 0], [0, 1]] as const) {
      const c = col + dc, r = row + dr
      if (!inBounds(c, r, cols, rows)) continue
      if (!mayClear(c, r)) continue // the ring stays shut wherever no gate runs through it
      if (inBand(c, r) && !plan.cells.has(`${c},${r}`)) continue // the band holds the border shut
      mustSee.add(`${c},${r}`)
    }
  }
  if (mustSee.size === 0) return
  const kept = trees.filter(t => !mustSee.has(`${t.col},${t.row}`))
  const stillTreed = new Set(kept.map(t => `${t.col},${t.row}`))
  for (const t of trees) {
    const key = `${t.col},${t.row}`
    if (stillTreed.has(key) || !mustSee.has(key)) continue
    collision[t.row][t.col] = false // the trunk was what blocked it; nothing else stands here
  }
  trees.length = 0
  for (const tree of kept) plantTree(ctx, tree)

  // AND THE UNDERGROWTH WITH THEM.
  //
  // *"we have trees in the pathway, we shouldn't have any trees in the pathway, just in grass or dirt zones,
  // same with flowers"*. This cleared TREES only, so a way came out swept of trunks and still carrying
  // flowers, mushrooms and tall grass down the middle of it. They are `props`, a different list, and nothing
  // was ever taking them off a road.
  //
  // A path a bloom is growing out of is not a path. Same rule, same cells, one list further.
  const { props } = ctx
  // ASK THE PROP, DO NOT GUESS ITS NAME. This filtered on a hand-written set of three type names, which
  // goes stale the moment a plant is added and cannot be replaced by a served field either: `rock` and `key`
  // are BOTH `category: nature` while one is scenery and the other is a temple's puzzle. The planter marks
  // what it plants, so an altar, a door and a key are never swept.
  const keptProps = props.filter(p => !p.grows || !mustSee.has(`${p.col},${p.row}`))
  if (keptProps.length === props.length) return
  props.length = 0
  props.push(...keptProps)
}

/**
 * LAY THE WAYS: the served surface, its ragged edge, what lies on it and what stands beside it.
 *
 * *"we need better pathways definitions on all templates too"*, with nine isometric references, and *"we need
 * the same variance for towns, we need towns with rustic pathways, street pathways, etc based of their
 * specific characteristics"* (2026-09-15).
 *
 * WHAT WAS THERE. Measured on a 40x40: a woodland trail swapped the ground for the flat floor tile and
 * tinted it; a meadow and a jungle did not even do that, their pathways were the SAME `meadow` ground as the
 * field beside them wearing a different colour. Width was a constant in this file. So a rainforest machete
 * trail, a clifftop path above a beach and a four lane seafront street were one 3-wide rectangle in three
 * colours, with nothing on them and nothing beside them.
 *
 * IT RUNS AS A LAYER, not inside each layout, for two reasons. Every layout gets it from one place, which is
 * what stops a meadow and a jungle drifting into two different ideas of what a path is; and it runs AFTER
 * `sightlines`, so the sweep that pulls growing things off a way cannot pull off the dressing that was put
 * there on purpose. Nothing here is marked `grows`, because none of it did.
 *
 * Every value is served. A template with no pathway block gets exactly the map it got before.
 */
function layPathways(ctx: ArchetypeContext): void {
  const plan = ctx.routes
  const way = ctx.pathway
  if (!plan || !way) return
  const lane = pavableLane(ctx, plan)
  if (lane.size === 0) return
  paveLane(ctx, lane, way)
  scatterOnLane(ctx, lane, way)
  lineTheLane(ctx, lane, way)
}

/**
 * The way's cells that may actually take a surface, with the edge eaten back into the field.
 *
 * A path is only straight-sided where somebody laid a kerb, which in these references is the town street and
 * the boardwalk and nothing else. Everywhere else the grass comes back into the dirt in tongues. `edge` is
 * the share of BORDER cells the field takes back, so 0 leaves the full rectangle and 0.5 leaves a track that
 * reads as walked rather than built.
 *
 * Water is never paved. A river is crossed on a deck, which the crossing layer already laid, and the deck's
 * own cells are left exactly as it made them.
 */
function pavableLane(ctx: ArchetypeContext, plan: RoutePlan): Set<string> {
  const { cols, rows, ground } = ctx
  const edge = ctx.pathway?.edge ?? 0
  const lane = new Set<string>()
  // Every cell the layout cut as a way, and the planned centreline for a layout that records none.
  const cut = ctx.pathwayCells.size > 0 ? ctx.pathwayCells : plan.cells
  for (const key of cut) {
    const { col, row } = toCell(key)
    if (!inBounds(col, row, cols, rows)) continue
    if (isWaterGround(ground[row][col]) || ctx.wet.has(key)) continue
    if (ctx.decks.has(key)) continue
    lane.add(key)
  }
  // THE FIELD TAKES ITS SHARE BACK IN THE ART, NOT IN WHOLE CELLS.
  //
  // This ate border cells out of the lane, first one at a time and then in patches of three, to make the edge
  // ragged. The verge pieces do that now and they do it INSIDE the cell, which is where the reference puts
  // it: measured, the boundary there wanders about 0.17 of a cell. Eating whole cells as well was the same
  // job done twice at ten times the scale, and it left those cells in `pathwayCells` wearing the field's own
  // colour, which is 32 of a woodland's 334 way cells reading as grass in the middle of a path.
  //
  // `edge` still decides, and still means what the backend says it means: 0 is a kerb somebody laid, so a
  // city street and a boardwalk get a clean straight boundary and no verge at all. Anything above 0 is a way
  // the field comes back into, and `wearTheWay` lays the verge.
  void edge
  return lane
}

/** Lay the served surface over the lane and tint it with the template's trail tone. The tone is what makes
 *  one dirt path an autumn one and another a summer one; the TILE is what makes it a path at all. */
function paveLane(ctx: ArchetypeContext, lane: ReadonlySet<string>, way: GeneratorPathway): void {
  const surface = way.surface
  if (!surface) return
  // A WAY IS A COLOUR ON THE GROUND BLOCK, NEVER A TILE LAID ON TOP OF IT.
  //
  // This wrote `ground[row][col] = surface`, which is the exact thing the settlement paver forty lines up has
  // warned against since it was written: *"Roads are a COLOUR on the ground BLOCK, not a separate ROAD tile.
  // The base ground stays (a height-1 block) and is tinted asphalt, so a road is FLUSH with the grass, no
  // raised road-tile trench"*. Swapping the tile puts a second block on the map, which is why it read as
  // *"BLACK ULGY TILES ON TOP"* and why every floor came out wrong at once.
  //
  // WHICH COLOUR is `wayTone`'s to answer, from the served pathway. The surface still decides what the way is
  // MADE of, and the tone what that material looks like here.
  const base = wayTone(ctx) ?? groundTileColor(surface, 0, 0)
  if (!base) return
  wearTheWay(ctx, lane, base)
  paintMarking(ctx, lane, way)
}

/**
 * THE COLOUR THIS MAP'S MADE GROUND WEARS: its ways, its decks, its bridges, the paving in its gateways.
 *
 * One answer, in one place, because it had two and they disagreed. The pathway's own `tone` is the template
 * saying what its way looks like, and it WINS: the alternative is what we had, where a mountain forest asked
 * for a gravel track and the woodland palette it inherits painted the gravel brown, and a swamp asked for a
 * boardwalk and the jungle palette painted the planks dirt. A template with no pathway block at all falls
 * back to the palette, which is every saved recipe made before pathways were served.
 */
function wayTone(ctx: ArchetypeContext): string | undefined {
  // NOTHING SERVED, NOTHING PAINTED. The season's own trail was the last resort here for one run, and its own
  // compliance case is why it is not: *"paints NOTHING when the backend serves no palette"*. A way with no
  // served tone is a way the backend has not described yet, and inventing one for it is the whole defect
  // this file keeps being corrected for.
  return ctx.pathway?.tone ?? ctx.palette?.trail
}

/**
 * A WAY IS TWO TONES: its own in the middle, and that tone darkened along the edge where it meets the field.
 *
 * *"the pathway I shared has more consistent coloring and a clear path look, usually darker dirt with clear
 * dirt in the middle"*. MEASURED on all ten stored references, by eroding the warm pixels to a core and
 * taking what the erosion removed as the rim: the rim is darker than the core in EVERY one of them, and the
 * ratio barely moves (0.78, 0.79, 0.80, 0.81, 0.84, 0.87, 0.88, 0.89, with a single 0.64). So it is not a
 * flourish, it is what makes a path read as a path, and 0.81 is the number.
 *
 * TWO tones, placed by POSITION. Before this it was three tones placed by a per-cell hash, and a per-cell
 * hash is a dither: *"this looks like weird chessboard"*. A rim is contiguous by construction, so it draws
 * an outline rather than confetti, and a way is two colours in long runs, which is also what lets
 * `compressGround` merge it (it joins only floors sharing a tile AND a colour).
 */
function wearTheWay(ctx: ArchetypeContext, cells: ReadonlySet<string>, tone: string): void {
  for (const key of cells) {
    const { col, row } = toCell(key)
    if (!inBounds(col, row, ctx.cols, ctx.rows)) continue
    if (isWaterGround(ctx.ground[row][col]) || ctx.wet.has(key) || ctx.decks.has(key)) continue
    // ONE TONE, ON EVERY CELL OF THE WAY.
    //
    // This painted only the cells with the way on every side and left the boundary cells wearing the FIELD's
    // colour with the dirt laid over them as art. Measured on a woodland: 334 way cells in SIX colours, and
    // only 144 of them on the way's own tone, so more than half of a path was painted the colour of the
    // grass. That is the patchwork, and it was this line.
    ctx.floorColors[row][col] = tone
    // A KERB IS A KERB. `edge` 0 is a way somebody laid an edge to, so the field does not come into it and
    // there is no verge to draw: a city street's boundary is the cell edge, which is exactly right for it.
    if ((ctx.pathway?.edge ?? 0) <= 0) continue
    // AND NEVER IN THE MOUTH. An exit cell is the way LEAVING, so the field does not come over it: the only
    // thing beside a gate cell is the border the map is sealed with, and taking that as "the field" drew a
    // tongue of grass across the way out. Nothing is written into the end cells of a pathway, verge art
    // included. PATHWAYS.md §4.
    if (ctx.exitCells.has(key)) continue
    const field = fieldBeside(ctx, cells, col, row)
    if (!field) continue
    // A VERGE THE COLOUR OF THE PATH IS NOT A VERGE. The way is painted by several passes (the layout's own
    // track, the gate lanes, the gateways), so a cell can find a neighbour that a later pass will make part
    // of the way, or that an earlier one already did. Measured: 3% of a woodland's verges and 12% of a
    // jungle's. Laying one would cost an asset to draw nothing.
    if (field === tone) continue
    // AND THE FIELD COMES OVER THE TOP, where the way meets it. The piece is the tongue of grass reaching in,
    // tinted with the colour of the field cell it reaches from, laid as the same flat ground overlay the
    // pebbles and the puddles use. The boundary therefore lives INSIDE the cell, which is where the
    // reference puts it and the one thing a colour per cell can never do.
    ctx.props.push({
      col, row, type: 'ground_decor', char: '', label: wayPiece(cells, col, row),
      blocking: false, grows: false, color: field,
    })
  }
}

/** The colour of the first field cell beside this one, or nothing when the way surrounds it. That colour is
 *  what the encroaching grass is tinted with, so a verge always matches the ground it grew from. */
function fieldBeside(ctx: ArchetypeContext, cells: ReadonlySet<string>, col: number, row: number): string | undefined {
  for (const [dc, dr] of ORTHO) {
    const c = col + dc
    const r = row + dr
    const key = `${c},${r}`
    if (!inBounds(c, r, ctx.cols, ctx.rows)) continue
    // NOT PART OF ANY WAY, not merely outside the set this call was handed. A gateway lane and a layout's own
    // track are painted by separate calls, so a cell of one is "field" to the other and the verge came out
    // tinted the path's own colour, which is a verge you cannot see.
    // A DECK IS NOT FIELD EITHER. It wears the way's tone because it is the way carried over water, so a verge
    // sampling one came out the colour of the path it was meant to edge.
    if (cells.has(key) || ctx.pathwayCells.has(key) || ctx.decks.has(key)) continue
    const painted = ctx.floorColors[r][c] ?? groundTileColor(ctx.ground[r][c], c, r)
    if (painted) return painted
  }
  return undefined
}

/**
 * WHICH PIECE OF THE WAY THIS CELL IS.
 *
 * The 9-piece autotile the tileset authoring guide describes: `_c` where the way continues on every side,
 * `_t _b _l _r` where it meets the field on one, `_tl _tr _bl _br` on two. The art carries the boundary, so
 * the wander between dirt and grass is inside the tile rather than at the cell edge, which is the whole
 * difference between a path and a polygon of tinted cells.
 *
 * Three cuts of each piece, chosen from the cell's own position, so a long edge does not repeat.
 */
function wayPiece(cells: ReadonlySet<string>, col: number, row: number): string {
  const open = ('t' + 'b' + 'l' + 'r')
    .split('')
    .filter(side => !cells.has(NEIGHBOUR[side](col, row)))
    .join('')
  const cut = Math.abs((col * 73856093) ^ (row * 19349663)) % WAY_PIECE_CUTS
  return `${WAY_FAMILY}_${wayPosition(open)}${cut === 0 ? '' : cut + 1}`
}

/** Where each named side of a cell is. */
const NEIGHBOUR: Record<string, (col: number, row: number) => string> = {
  t: (col, row) => `${col},${row - 1}`,
  b: (col, row) => `${col},${row + 1}`,
  l: (col, row) => `${col - 1},${row}`,
  r: (col, row) => `${col + 1},${row}`,
}

/**
 * The piece name for a set of open sides.
 *
 * A cell open on two OPPOSITE sides, or on three, has no piece of its own in a nine-piece family: it is a
 * way one cell wide, which the corner and edge pieces cannot describe between them. It takes the strongest
 * single edge it does have rather than nothing, because a missing piece is a hole in the way.
 */
function wayPosition(open: string): string {
  if (open === '') return 'c'
  if (WAY_POSITIONS.has(open)) return open
  for (const pick of ['tl', 'tr', 'bl', 'br', 't', 'b', 'l', 'r']) {
    if ([...pick].every(side => open.includes(side))) return pick
  }
  return 'c'
}

const WAY_POSITIONS = new Set(['t', 'b', 'l', 'r', 'tl', 'tr', 'bl', 'br'])

/** The autotile family a way's EDGE is built from. Each piece is the field reaching into the way, tinted with
 *  that field's own colour, so one set of art serves every environment's grass, sand and ash. */
const WAY_FAMILY = 'path_edge'

/** How many cuts of each piece the backend serves. */
const WAY_PIECE_CUTS = 3

/** A cell of the way with the field on one side of it. Orthogonal only: a way meets the field along its
 *  sides, and counting diagonals would rim every cell of a 2-wide track and leave it with no middle. */
function atLaneEdge(cells: ReadonlySet<string>, col: number, row: number): boolean {
  return !cells.has(`${col - 1},${row}`) || !cells.has(`${col + 1},${row}`) ||
    !cells.has(`${col},${row - 1}`) || !cells.has(`${col},${row + 1}`)
}

/**
 * A RIM IS THE EDGE OF A MIDDLE. A cell is rim when it touches the field AND it touches a cell of the way
 * that does not, which is what makes it the border of something rather than the whole of it.
 *
 * Without the second half, a two-wide track is entirely edge and comes out entirely dark: the jungle's cut
 * trail, which is two cells across, would lose a fifth of its luminance along its whole length and stop
 * matching the tone its own reference was measured from. A track too narrow to have a middle simply wears one
 * tone, which is also what a narrow track looks like.
 */
function isRim(cells: ReadonlySet<string>, col: number, row: number): boolean {
  if (!atLaneEdge(cells, col, row)) return false
  for (const [dc, dr] of ORTHO) {
    const c = col + dc
    const r = row + dr
    if (cells.has(`${c},${r}`) && !atLaneEdge(cells, c, r)) return true
  }
  return false
}

/** How dark a way's edge is against its middle. Measured across the ten references: 0.81 of the core's
 *  luminance, and every one of them sits between 0.78 and 0.89. */
const PATHWAY_RIM = 0.81

/**
 * THE LINE DOWN THE MIDDLE, where the way is one somebody painted.
 *
 * *"ALL WE NEEDED WAS TO ADD THE WHITE RECTANGULAR LINES IN MIDDLE AS ORNAMENT IF WE WANTED, NOT ADD BLACK
 * ULGY TILES ON TOP"*. So it is a COLOUR, like the way under it, and the backend serves which colour: it is
 * the reference's own marking white, measured off the pixels lying on its asphalt.
 *
 * The middle is found per RUN rather than per cell: the cells of a lane that share a row are one stretch of
 * street, and the marking goes down the centre of that stretch, dashed at the rhythm the backend serves.
 */
function paintMarking(ctx: ArchetypeContext, lane: ReadonlySet<string>, way: GeneratorPathway): void {
  const marking = way.marking
  if (!marking) return
  const tone = marking.color
  // A run WIDER than the carriageway is not a cross-section of this street, it is the street running the other
  // way, or a junction. Those get no line, which is what a junction looks like.
  const span = (way.width ?? 3) + 1
  markAcross(ctx, lane, tone, marking.every, span, 'down')
  markAcross(ctx, lane, tone, marking.every, span, 'across')
}

/**
 * Paint the middle cell of every carriageway cross-section on one axis, dashed.
 *
 * `down` walks the columns and reads each one's run of rows, which is the cross-section of a street running
 * ACROSS the map; `across` does the mirror. A street gets its line from whichever pass sees it edge-on.
 */
function markAcross(ctx: ArchetypeContext, lane: ReadonlySet<string>, tone: string, every: number, span: number, axis: 'down' | 'across'): void {
  const { cols, rows } = ctx
  const alongCount = axis === 'down' ? cols : rows
  const acrossCount = axis === 'down' ? rows : cols
  const key = (along: number, across: number): string => (axis === 'down' ? `${along},${across}` : `${across},${along}`)
  for (let along = 0; along < alongCount; along++) {
    let start = -1
    for (let across = 0; across <= acrossCount; across++) {
      const paved = across < acrossCount && lane.has(key(along, across))
      if (paved && start < 0) start = across
      if (paved || start < 0) continue
      const from = start
      start = -1
      const run = across - from
      if (run < 2 || run > span) continue // a single cell has no middle; a wide one is a junction
      if (along % every !== 0) continue   // the dash rhythm along the street
      const { col, row } = toCell(key(along, from + ((run - 1) >> 1)))
      ctx.floorColors[row][col] = tone
    }
  }
}

/**
 * What LIES ON the way. Pebbles and litter, thinly, and never an obstacle: `makePlant` reads the tile's own
 * row for that, so whether a thing blocks is the catalogue's business and not this file's.
 *
 * Both the forest crossroads and the park reference show it, and it is what stops a path reading as a painted
 * stripe rather than ground somebody walks on.
 */
function scatterOnLane(ctx: ArchetypeContext, lane: ReadonlySet<string>, way: GeneratorPathway): void {
  for (const { tile, rate } of way.scatter ?? []) {
    for (const key of lane) {
      if (ctx.rand() >= rate) continue
      const { col, row } = toCell(key)
      if (ctx.collision[row][col]) continue
      placeProp(ctx, makePlant(ctx, col, row, tile), { onPathway: true })
    }
  }
}

/**
 * What STANDS BESIDE the way, on the field cells that touch it.
 *
 * This is the thing that tells you which place you are in before you have looked at anything else: boulders
 * and scrub along the forest track, tufts and blooms along the park path, a rhythm of lamp posts down the
 * seafront. It is placed on the FIELD and never on the surface, so a lined way reads as a corridor you follow
 * rather than an obstacle course you pick through.
 */
function lineTheLane(ctx: ArchetypeContext, lane: ReadonlySet<string>, way: GeneratorPathway): void {
  const lining = way.lining ?? []
  if (lining.length === 0) return
  const { cols, rows } = ctx
  const verge = new Set<string>()
  for (const key of lane) {
    const { col, row } = toCell(key)
    for (const [dc, dr] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      const c = col + dc
      const r = row + dr
      if (!inBounds(c, r, cols, rows) || isEdge(c, r, cols, rows)) continue
      const near = `${c},${r}`
      if (lane.has(near) || ctx.collision[r][c]) continue
      if (isWaterGround(ctx.ground[r][c]) || ctx.wet.has(near)) continue
      verge.add(near)
    }
  }
  for (const { tile, rate } of lining) {
    for (const key of verge) {
      if (ctx.rand() >= rate) continue
      const { col, row } = toCell(key)
      if (ctx.collision[row][col]) continue
      placeLining(ctx, col, row, tile)
    }
  }
}

/**
 * PUT DOWN ONE LINING ITEM, as whatever the catalogue says it IS.
 *
 * *"you keep using tiles as standalone elements when they're just lego pieces in our system"*, and this is
 * exactly that: the lining placed every served name as a bare tile, so `lamp` came out as a yellow cube with
 * a bulb painted on it standing beside every street. A lamp is a COMPOSITION, a post with the lamp on top,
 * and the generator has said so in `placeLampPost` all along: *"stamped at load, NOT a single lamp prop, so
 * both art styles render the IDENTICAL post+lamp structure"*.
 *
 * So the name is asked of the catalogue rather than assumed to be a tile. A composition is stamped as one; a
 * tile is a prop. Nothing here lists which is which, so a composition added in the backend simply works.
 */
function placeLining(ctx: ArchetypeContext, col: number, row: number, name: string): void {
  if (resolveComposition(styleCatalog('ascii'), name)) {
    if (!isLandCell(ctx, col, row)) return
    ctx.compositions.push({ kind: name, col, row })
    ctx.collision[row][col] = true
    return
  }
  placeProp(ctx, makePlant(ctx, col, row, name))
}

/**
 * CUT THE EXITS THROUGH THE BORDER, as a LAYER, after everything that seals it.
 *
 * An exit is a hole in the map's edge. The planner picks where they go and hands back `gates`, each holding the
 * EDGE cells it runs off by. Nothing then opened them, and two passes ran afterwards that close the border on
 * purpose: the temple's *"seal the map border so the dungeon is fully enclosed"* walls the whole ring, and
 * every cave carve is guarded with `!isEdge(...)` so it stops one cell short. Measured across 5 generators ×
 * 4 exits × 4 pathways × 3 seeds, 240 builds: a cave and a temple had **0 of 156 border cells walkable**, so
 * the way out did not exist and the `exits` option had never once changed a map.
 *
 * This is the shape he named: *"we generate pathways with number of exits around the existing area … our
 * layers aren't correctly applied"*. The gates belong to the PATHWAY layer, so they are cut here, in
 * `generateStage`, after the archetype has finished sealing whatever it seals. No later pass can take them
 * back, and no archetype has to remember to ask.
 *
 * A gate cell takes the ground and colour of the cell just INSIDE it, so the mouth reads as the floor it
 * continues rather than a colour this function picked.
 */
function openGates(ctx: ArchetypeContext): void {
  const plan = ctx.routes
  if (!plan) return // a generator that serves no pathways has no gates, and its map is untouched
  const { collision, ground, floorColors, cols, rows } = ctx
  for (const gate of plan.gates) {
    const inside = gate.inside
    if (!inBounds(inside.col, inside.row, cols, rows)) continue
    for (const cell of gate.cells) {
      if (!inBounds(cell.col, cell.row, cols, rows)) continue
      collision[cell.row][cell.col] = false
      ground[cell.row][cell.col] = ground[inside.row][inside.col]
      floorColors[cell.row][cell.col] = floorColors[inside.row][inside.col]
    }
    // …and the cell just inside it, so a mouth carved up to the ring is actually joined to it.
    collision[inside.row][inside.col] = false
  }
}

/**
 * HOW WIDE THIS TEMPLATE'S WAYS RUN, off the served pathway block.
 *
 * This was `WOODLAND.pathWidth`, a constant, read at five places that cut a way: the route planner, the route
 * cutter, the animal track, the woodland trail and the spur. So a rainforest machete trail, a clifftop path
 * above a beach and a four lane seafront street were all three cells across, and the only thing that told
 * them apart was a colour.
 *
 * A template that serves no pathway keeps that 3, which is what every saved recipe was built against.
 */
function pathwayWidth(ctx: ArchetypeContext): number {
  return ctx.pathway?.width ?? WOODLAND.pathWidth
}

/** The variants that lay a STREET GRID. Their pathway ceiling is measured in blocks (`streetRoom`) rather than
 *  in path widths, because a street is only a street if there is something to build between it and the next. */
const STREET_VARIANTS = new Set<VariantId>(['town', 'city'])

function planPathways(ctx: ArchetypeContext, rand: Rng): RoutePlan | null {
  const room = STREET_VARIANTS.has(ctx.variant) ? streetRoom(ctx.cols, ctx.rows, ctx.settlement) : undefined
  const pathways = resolvePathways(ctx.options, rand, { cols: ctx.cols, rows: ctx.rows, width: pathwayWidth(ctx) }, room)
  if (!pathways) return null
  ctx.pathways = pathways
  ctx.routes = planRoutes(ctx.cols, ctx.rows, pathways, rand, pathwayWidth(ctx))
  // THE PATHWAYS LAYER RECORDS ITS EXITS, AND NOTHING IS WRITTEN THERE.
  //
  // GENERATION-SPEC §5.1: layer 3 is the map's STRUCTURE and owns "where the exits are"; layer 4 puts the
  // objects. `claimed` is how layer 3 tells layer 4 which ground is already spoken for, so the gate cells
  // join it here, the moment the plan exists. Every layout inherits it, because every layout plans through
  // this one function.
  //
  // It used to be done downstream by the two forest layouts folding their own gate lanes in, so a settlement
  // never spoke for its gates at all and planted in its own way out.
  //
  // The cells are the gate's own, which `gateOn` cuts at exactly the served `pathwayWidth`, so a way 4 cells
  // wide reserves 4 and a way 2 wide reserves 2, with no width stated here. PATHWAYS.md §4.
  for (const gate of ctx.routes.gates) {
    for (const cell of gate.cells) {
      ctx.claimed.add(`${cell.col},${cell.row}`)
      ctx.exitCells.add(`${cell.col},${cell.row}`)
    }
  }
  return ctx.routes
}

/**
 * THE STREET SKELETON A SETTLEMENT INHERITS FROM THE WAYS LAYER.
 *
 * *"pathways size must apply to the streets distribution logic, in fact, they're rendundant, street is just a
 * form of pathway"* (2026-09-14). The backend already agreed: a settlement's "Streets" dropdown is the
 * `pathways` key under a different label. Only the planner disagreed, laying its own fixed grid.
 *
 * Undefined when this generator serves no pathways, and the planner then keeps the grid it always had.
 */
function streetPlanFor(ctx: ArchetypeContext): StreetPlan | undefined {
  const plan = ctx.routes
  const pathways = ctx.pathways
  if (!plan || !pathways) return undefined
  return { pathways: pathways.pathways, gates: plan.gates.map(gate => ({ side: gate.side, at: gateLine(gate) })) }
}

/** The line a gate's street runs along: its ROW when the gate is on the left or right edge, its COLUMN when it
 *  is on the top or bottom. Taken from the gate's middle cell so the street is centred on the mouth. */
function gateLine(gate: Gate): number {
  const mid = gate.cells[Math.floor(gate.cells.length / 2)]
  if (gate.side === 'west' || gate.side === 'east') return mid.row
  return mid.col
}

/** What the `pathways` layer decided, for the archetypes that build around it. Null when the generator serves no
 *  counts, which is how a recipe from before the pathways existed keeps the map it always had. */
function plannedRoutes(ctx: ArchetypeContext): RoutePlan | null {
  return ctx.routes ?? null
}

/**
 * Build a woodland: dense canopy, carved clearings, connected paths.
 *
 * `ctx.nature?.canopy` is the density and it comes from the BACKEND. Absent → nothing is planted and a
 * warning says why, rather than this file inventing a number: a generator that states no canopy has not
 * been configured as a forest, and quietly picking 0.45 here is exactly the hardcoded-fallback the
 * compliance rule forbids.
 */
/** `woodland` (dense trees, clearings, trails) and `woodland_river` (the same, cut by a river with a bridge).
 * Mirrors the meadow pair, one builder, an
 *  options object, so the two never drift apart. A JUNGLE is not here: it is the same STRUCTURE at a heavier
 *  served density, so it is a preset over this builder, not a fourth code path (see the forest layout table). */
/**
 * A WOODLAND, IN PHASES, one per layer the backend serves.
 *
 * It was one 180-line function that painted the floor, partitioned the regions, carved the river, cut the
 * trails, planted the canopy, dressed the clearings, repaired the floor and bridged the water, in that order,
 * with five local sets threaded through all of it. The cut is at the layer boundaries, and what used to be a
 * local `open` set is `ctx.claimed`: the ground an earlier layer spoke for, which is what "free space" means
 * for every variant rather than for this one.
 */
const woodlandPhases: VariantPhases = {
  terrain: ctx => {
    const { cols, rows, ground, zone } = ctx
    if (ctx.nature?.canopy === undefined) {
      console.warn('[generate] this generator serves no `nature.canopy`, so a woodland has no tree density to build from, nothing planted')
      return
    }
    const floor = zonePalette(zone)?.groundTypes[0] ?? ''
    forEachCell(cols, rows, (col, row) => { ground[row][col] = floor })
    // AND ITS SERVED COLOUR, which nothing applied before. All five woodland templates serve
    // `palette.floor` and only the jungle's painter ever read one, so a wood's field rendered as the season's
    // grass and its own colour was parsed and dropped.
    paintFloor(ctx, { floor: ctx.palette?.floor, floorAlt: ctx.palette?.floorAlt, litter: ctx.palette?.litter })

    // THE REGIONS. Only the jungle ever called `partitionSubZones`, so a woodland's served regions were
    // parsed and dropped: served-and-ignored, the exact defect that keeps turning up. Both forest layouts
    // share the one mechanism, and `subZoneCanopyField` runs `woodlandCanopyField` once per region, so a map
    // with no regions takes the same single call it always did.
    shapeRegions(ctx)
  },

  // THE RIVER, carved before anything is planted OR drawn, so its cells are already spoken for. It joins
  // `ctx.claimed`, which is why the canopy pass needs no river branch at all: water is simply somewhere a
  // tree cannot go.
  water: ctx => {
    const course = riverCourse(ctx, 'around')
    for (const key of course ? carveRiver(ctx, course, ctx.palette) : []) {
      ctx.water.add(key)
      ctx.claimed.add(key)
    }
    // AND THE REGIONS' OWN WATER. A `lakeside` asks for 22% standing water and this builder had no pool pass,
    // so the one region on the map named after a lake was the one place with no water in it.
    floodRegionPools(ctx, ctx.palette)
  },

  pathways: ctx => {
    const { cols, rows } = ctx
    if (ctx.nature?.canopy === undefined) return
    const trail = ctx.pathwayCells
    const clearings: Cell[] = []

    // THE PATHS, FIRST. When the generator serves the pathways the network is already decided: its cells
    // join `claimed` so nothing can be planted on them. A GLADE goes where the paths meet and at every stop,
    // so a pathway that is not an exit ends somewhere worth walking to rather than in a wall of trunks.
    if (ctx.routes) {
      for (const key of ctx.routes.cells) { ctx.claimed.add(key); trail.add(key) }
      clearings.push(ctx.routes.hub, ...ctx.routes.deadEnds)
      for (const centre of clearings) carveClearing(ctx, centre, ctx.claimed)
      // …AND THE MOUTH OF EACH WAY. The corridor alone stopped dead at the border, so a woodland had pathways
      // you could walk and could not see.
      //
      // A MOUTH IS THE WIDTH OF ITS OWN TRACK, not the meadow's 5. Measured, after two wrong guesses: a lane
      // is CLEARED, so it unblocks cells, and 5x11 at every gate lifted the woodland's walkable share enough
      // to break the jungle's own choked-forest test, which compares the two. The jungle number never moved;
      // the woodland baseline did.
      const gateLanes = gateLaneCells(ctx, ctx.routes, ctx.water, 1, 6)
      clearMeadowCells(ctx, gateLanes) // nothing standing in the gateway
      for (const key of gateLanes) { ctx.claimed.add(key); trail.add(key) }
    }

    const wanted = Math.max(2, Math.round((cols * rows / 1000) * WOODLAND.clearingsPerThousand))
    for (let i = 0; i < wanted; i++) {
      const centre = {
        col: randIntWith(ctx.rand, 3, Math.max(3, cols - 4)),
        row: randIntWith(ctx.rand, 3, Math.max(3, rows - 4)),
      }
      clearings.push(centre)
      carveClearing(ctx, centre, ctx.claimed)
    }

    // TRAILS joining the clearings in a chain, so every one is reachable from every other, plus a spur from
    // the first and last to the map EDGE: a forest you cannot enter or leave is a room.
    //
    // WITH A PLAN, THE PLAN IS THE MAP'S PATHWAYS, and the glade links are gaps rather than ways. Measured on
    // a 40x40 asked for two pathways: seven glades chained by six L-shaped corridors at the full served width
    // paved 486 cells, 30% of the map, against 18.7% in the references. The way stopped reading as a way and
    // became a tan field with green islands in it, which is *"this looks like weird chessboard"* and *"the
    // pathways don't look like paths at all"*. The links are still CARVED, so no glade is stranded and
    // nothing is planted in them; they are simply not painted as a way the person did not ask for.
    const glades = ctx.routes ? new Set<string>() : trail
    for (let i = 1; i < clearings.length; i++) carveWoodlandPath(ctx, clearings[i - 1], clearings[i], ctx.claimed, glades)
    // The two spurs are what a forest with NO plan uses to avoid being sealed. With a plan the gates already
    // run off the border, and a spur would be a way out nobody asked for.
    if (!ctx.routes && clearings.length > 0) {
      carveWoodlandPath(ctx, clearings[0], nearestEdgeCell(clearings[0], cols, rows), ctx.claimed, glades)
      const last = clearings[clearings.length - 1]
      carveWoodlandPath(ctx, last, nearestEdgeCell(last, cols, rows), ctx.claimed, glades)
    }

    // PAVE them. A trail has to be visible to be a trail. THE TEMPLATE PAVES, NOT THE SEASON, whenever the
    // template says what its pathways are made of: this came from `zonePalette(zone).trail`, so which material
    // a trail was laid in depended on whether it was autumn and every forest in a season shared one. A
    // template that serves a pathway is paved by the pathway layer, where the LOOK of a way belongs.
    //
    // One that serves none is painted with whatever IS served and nothing otherwise. Its own function laid
    // the season's trail TILE into `ground`, which is the raised trench again in the last place that still
    // did it, and it cleared the colour underneath while it was there.
    //
    // NO PLAN IS ALSO NO PAVING. The guard was the surface alone, and `layPathways` needs a ROUTE PLAN as
    // well as a surface, so a plain generate with no exits asked for carved its trails between the clearings
    // and left every one of them the colour of the grass. Painted here whenever the pathways layer will not,
    // and skipped when it will, so the ragged edge it eats back is not filled in behind it.
    if (!ctx.routes || !ctx.pathway?.surface) tintCells(ctx, trail, wayTone(ctx))

    // AND PLANK IT where the river runs across it. After the paving, never before: the paving skips water, so
    // a deck laid first would be paved straight back over.
    if (ctx.routes) deckRoutes(ctx, ctx.routes, flowingWater(ctx), wayTone(ctx), ctx.pathwayCells)
  },

  objects: ctx => {
    const { collision, trees } = ctx
    const canopy = ctx.nature?.canopy
    if (canopy === undefined) return
    const zones = ctx.zones ?? []
    const zoneAt = ctx.zoneAt!

    // CANOPY everywhere else, chosen rather than thrown. Two attempts failed here and both are the same
    // mistake: treating a density as an input to a lossy process instead of as the outcome. Clump counts gave
    // 27% for a configured 42%; random anchors until a count filled hit the number with a ruinous
    // distribution. So: score EVERY plantable cell with spatially-coherent noise and take the lowest-scoring
    // `target` of them. Coverage is exact by construction, and it clumps because neighbours score alike.
    const field = zones.length > 0
      ? subZoneCanopyField(ctx, ctx.claimed, canopy, zoneAt, zones)
      : woodlandCanopyField(ctx, ctx.claimed, canopy, ctx.formation)
    for (const { col, row } of field) {
      if (standsOnPathway(ctx, col, row)) continue // the ways are drawn by now, and nothing grows in one
      const kind: LivingTreeKind | 'tree_dead' = ctx.rand() < 0.06 ? 'tree_dead' : pickLivingTree(ctx.rand(), speciesAt(ctx, col, row))
      plantTree(ctx, { col, row, kind, variant: massVariant(col, row) })
      collision[row][col] = true // the trunk blocks; the canopy is walkable overhead, as everywhere else
    }

    // The clearings get whatever ground cover and flowers the generator asked for. Absent means bare.
    dressWoodlandClearings(ctx, ctx.claimed, zoneAt)
    scatterTallGrass(ctx) // patches of walkable long grass, as much as the generator serves

    // UNDERSTORY between the trunks, when the formation asks for one. Image #15 is a woodland whose hard part
    // is the FLOOR, and no amount of canopy tuning produces that because it is not about the canopy. A
    // formation that states no understory runs nothing here, so an ordinary wood is unchanged.
    if (ctx.formation?.understory !== undefined) plantUndergrowth(ctx, ctx.claimed, ctx.water, ctx.palette, zoneAt)

    // KEEP THE FLOOR ONE PLACE. A river can strand a pocket of forest floor behind it, and a pocket you
    // cannot walk to is a hole in the map. Before the bridge, so the repair can never fill the deck back in.
    const course = riverCourse(ctx, 'around')
    if (course) repairFloorConnectivity(ctx, MEADOW_MAX_POCKET)

    // THE CROSSING. A river you cannot cross splits the forest in two, and the deck is laid after the
    // planting so nothing puts a trunk back on it. The trails are this layout's path network, so a joined
    // crossing lands on one of them rather than in the middle of the trees.
    if (course) bridgeRiver(ctx, flowingWater(ctx), ctx.pathwayCells, course, ctx.palette)

    // ONE PLACE, cutting tracks through the brush to anything the undergrowth walled off. AFTER the bridge,
    // and that order is a fix rather than a preference: run before it, the join saw the far bank as a stray
    // region and cut a track straight across the water, which made the river walkable.
    if (ctx.formation?.understory !== undefined) joinStrandedRegions(ctx)

    // THE WAYS OUT, drawn. After the planting and the joins, so nothing puts a trunk back on a lane. A
    // woodland wears its own trail between flanking trunks rather than the meadow's cobble and lamps.
    paintGateways(ctx, ctx.routes, ctx.water, ctx.pathwayCells, {
      ground: FLAT_FLOOR,
      paving: wayTone(ctx),
      flank: flankingTrees,
    })

    // THE STONE a region asks for, after the planting so a trunk is never inside a wall.
    strewRegionRuins(ctx)

    dropDrownedFilms(ctx) // a puddle under a trunk is not a puddle
    settleWaterDepth(ctx, molten(ctx, ctx.palette), ctx.pools, ctx.still) // the water settles by depth, last
  },
}

// ── 'jungle', a JUNGLE, not a dense woodland ─────────────────────────────────
//
// That was right, and what shipped was exactly what it objected to: `layoutWoodland` with heavier numbers. Density
// is not the difference between the Amazon and a pine wood. The STRUCTURE is, and it inverts in four pathways:
//
//   · A wood has CLEARINGS cut into it, open ground you can walk. A jungle has none. What it has is LIGHT
//     GAPS where a giant fell, small and irregular, and they are the only places the sun reaches the floor.
//   · A wood has TRAILS, straight-ish routes between places. A jungle has no roads. You move along the
//     WATER, so the creek and its banks ARE the route through the map.
//   · A wood's floor is walkable between the trunks. A jungle's is choked, UNDERGROWTH is its own blocking
//     layer, and it is what makes a jungle hard rather than the trunks.
//   · A wood is lit from above and shaded below. A jungle is the other way round: the canopy is the brightest
//     thing on the map because it is the layer getting the sun, and the floor lives in permanent shade.
//
// All four are here. The colours come from the SERVED palette, never from a constant in this file.

const JUNGLE = {
  /** light gaps per 1000 cells, far fewer than the woodland's clearings, and they are not walkable routes. */
  gapsPerThousand: 2.2,
  /** a fallen-giant gap is small: this radius, wobbled. A wood's clearing is 2-5. */
  gapRadius: [2, 3] as const,
  /** the creek's half-width → a ~3 wide watercourse. */
  creekHalf: 1.5,
  /** how far the walkable bank reaches back from the water on each side. */
  bankDepth: 2,
  /** emergent giants per 1000 cells, the few trees standing above the canopy. */
  emergentsPerThousand: 1.6,
}

/**
 * HOW FAR A JUNGLE'S UNDERGROWTH HAS TO REACH so the served number means what it says.
 *
 * `plantUndergrowth` hits its density against the cells nothing else claimed. In a woodland that is nearly the
 * whole map, so the reading does not matter. In a jungle it does: the creek, its two-cell banks, the light gaps
 * and the animal tracks all join `open` before anything is planted, and measured across 12 seeds at 60x40 that
 * set swings from 397 to 875 cells. A seed whose creek wandered therefore got a thinner jungle EVERYWHERE, and
 * the choked-forest assertion in `stageGenerator.jungle.test.ts` failed on 8 of 12 seeds. It had been passing
 * on seed 3 by 11 cells out of 2400, so the commit that moved it did not break it, it exposed it.
 *
 * The fix belongs on the UNDERGROWTH and not on the canopy, which the suite says out loud in two places:
 * and I tried the canopy first and it failed both, which is the suite doing its job.
 *
 * So groundCover reads as the share of the jungle's WALKABLE FLOOR that is choked, and the pathways are simply not
 * where it grows. This factor is that floor over what is left to plant on.
 */
function jungleFloorReach(ctx: ArchetypeContext, open: Set<string>): number {
  const { cols, rows, collision, ground } = ctx
  let floor = 0
  let plantable = 0
  for (let row = 1; row < rows - 1; row++) {
    for (let col = 1; col < cols - 1; col++) {
      if (collision[row][col] || isWaterGround(ground[row][col])) continue
      floor++
      if (!open.has(`${col},${row}`)) plantable++
    }
  }
  return plantable === 0 ? 1 : floor / plantable
}

/**
 * THE JUNGLE. Floor → creek → light gaps → canopy → undergrowth → keep it one place.
 *
 * Ordered so each pass can simply avoid what the ones before it claimed: the creek and the gaps join `open`
 * before the canopy is scored, exactly as the woodland's clearings do, which is why neither the canopy nor
 * the undergrowth pass needs to know what water or a gap is.
 */
/**
 * A JUNGLE, IN PHASES. Same cut as the woodland, on the layer boundaries.
 *
 * A jungle ALWAYS has water: *"a jungle map without water is a map with no way across it"*. The river option
 * decides what KIND, not whether, which is why the water phase here is unconditional where the woodland's
 * returns early.
 */
const junglePhases: VariantPhases = {
  terrain: ctx => {
    const { cols, rows, ground } = ctx
    if (ctx.nature?.canopy === undefined) {
      console.warn('[generate] this generator serves no `nature.canopy`, so a jungle has no tree density to build from, nothing planted')
      return
    }
    // THE FLOOR, in permanent shade. Mottled over coarse patches rather than one flat fill, because a jungle
    // floor is litter and roots and standing shade, not lawn. Absent palette means the tile's own colour.
    const floor = zonePalette(ctx.zone)?.groundTypes[0] ?? ''
    forEachCell(cols, rows, (col, row) => { ground[row][col] = floor })
    paintFloor(ctx, { floor: ctx.palette?.floor, floorAlt: ctx.palette?.floorAlt, litter: ctx.palette?.litter })

    // THE REGIONS. A jungle is not one uniform density, it is several kinds of ground you walk between: open
    // canopy, dense growth, swamp, ruins. The region the person picked LEADS the map.
    shapeRegions(ctx)
  },

  water: ctx => {
    if (ctx.nature?.canopy === undefined) return
    const pal = ctx.palette
    const course = riverCourse(ctx, 'through')
    // No course picked means the jungle's own narrow creek; `through` is the same creek, wide; the other
    // courses carve their own channel. Unless no river was ASKED for, which is a different answer from none
    // being picked for you.
    const channel = course === 'through' ? carveJungleCreek(ctx, pal, true)
      : course ? carveRiver(ctx, course, pal)
      : riverRefused(ctx) ? new Set<string>()
      : carveJungleCreek(ctx, pal, false)
    for (const key of channel) ctx.water.add(key)

    // THE REGIONS' OWN WATER, standing where a region says so. After the channel, so a pool never lands on
    // top of one.
    floodRegionPools(ctx, pal)
    for (const key of jungleBanks(ctx, ctx.water, pal)) {
      ctx.banks.add(key)
      ctx.claimed.add(key) // a bank is walkable ground the water left, so nothing plants on it
    }
  },

  pathways: ctx => {
    const { cols, rows } = ctx
    if (ctx.nature?.canopy === undefined) return
    const pal = ctx.palette

    // LIGHT GAPS where a giant came down. Small, irregular, and dressed brighter than the floor around them,
    // because they are the only lit ground on the map.
    const gaps = new Set<string>()
    const wanted = Math.max(1, Math.round((cols * rows / 1000) * JUNGLE.gapsPerThousand))
    for (let i = 0; i < wanted; i++) {
      const centre = { col: randIntWith(ctx.rand, 3, Math.max(3, cols - 4)), row: randIntWith(ctx.rand, 3, Math.max(3, rows - 4)) }
      const radius = randIntWith(ctx.rand, JUNGLE.gapRadius[0], JUNGLE.gapRadius[1])
      for (let r = centre.row - radius - 1; r <= centre.row + radius + 1; r++) {
        for (let c = centre.col - radius - 1; c <= centre.col + radius + 1; c++) {
          if (!inBounds(c, r, cols, rows) || ctx.water.has(`${c},${r}`)) continue
          if (Math.hypot(c - centre.col, r - centre.row) <= radius - 0.5 + ctx.rand()) {
            gaps.add(`${c},${r}`)
            ctx.claimed.add(`${c},${r}`)
          }
        }
      }
    }
    paintJungleGaps(ctx, gaps, pal, ctx.zoneAt!)

    // AN ANIMAL TRACK joining each gap to the water. Not a road and not paved: it is the line of least
    // undergrowth, so it reads as a way through rather than a path someone built. Without it a light gap is a
    // pocket you cannot reach, which the repair would then carpet over.
    const nearestWater = (from: Cell) => nearestCell(from, ctx.banks.size > 0 ? ctx.banks : ctx.water)
    for (const key of gaps) {
      const cell = toCell(key)
      const target = nearestWater(cell)
      if (target) traceJungleTrack(ctx, cell, target, ctx.claimed)
    }

    // THE PLANNED PATHS. A jungle has no roads, but a map that shows no way through it is the complaint
    // reference image #16 answers, so the network is a trodden track: clear, and painted in the SERVED trail
    // tone so you can SEE it. A generator that serves no trail colour still gets a clear track, unpainted.
    if (!ctx.routes) return
    // Every planned cell, the wet ones too: a tree planted on a boardwalk is a blocked pathway.
    for (const key of ctx.routes.cells) { ctx.claimed.add(key); ctx.pathwayCells.add(key) }
    tintCells(ctx, ctx.routes.cells, wayTone(ctx))

    // …AND THE MOUTH OF EACH WAY. NARROWER AND SHALLOWER than the meadow's, measured rather than chosen: a
    // gate lane is CLEARED, so it unblocks cells, and five wide by eleven deep at every gate moved the
    // jungle's walkable share from under to over the woodland-gap threshold its own test defends, which is
    // the test saying "this no longer walks like a jungle" and being right.
    const gateLanes = gateLaneCells(ctx, ctx.routes, ctx.water, 1, 6)
    clearMeadowCells(ctx, gateLanes)
    for (const key of gateLanes) { ctx.claimed.add(key); ctx.pathwayCells.add(key) }
    tintCells(ctx, gateLanes, wayTone(ctx))
    // THE GATE LANES AND THE STOPS ARE WHAT THE NETWORK PROMISES. A lane is the way OUT and a stop is where a
    // path ends on purpose, so neither is ever the spare crossing: dropping one left a gate you could stand on
    // and could not walk to, and a stop the planner had put in the river.
    deckRoutes(ctx, ctx.routes, flowingWater(ctx), wayTone(ctx), ctx.pathwayCells, promisedCells(ctx.routes, gateLanes))
  },

  objects: ctx => {
    const { collision, trees } = ctx
    const canopy = ctx.nature?.canopy
    if (canopy === undefined) return
    const pal = ctx.palette
    const zones = ctx.zones ?? []
    const zoneAt = ctx.zoneAt!

    // THE CANOPY over everything else, the same exact-coverage field the woodland uses. Run PER REGION so
    // dense growth is genuinely denser than open canopy on the same map, rather than the whole map sharing
    // one number. A map with no regions runs it once, which is the old behaviour exactly.
    const field = zones.length > 0
      ? subZoneCanopyField(ctx, ctx.claimed, canopy, zoneAt, zones)
      : woodlandCanopyField(ctx, ctx.claimed, canopy, ctx.formation)
    for (const { col, row } of field) {
      if (standsOnPathway(ctx, col, row)) continue
      const kind: LivingTreeKind | 'tree_dead' = ctx.rand() < 0.04 ? 'tree_dead' : pickLivingTree(ctx.rand(), speciesAt(ctx, col, row))
      plantTree(ctx, { col, row, kind, variant: massVariant(col, row) })
      collision[row][col] = true
    }

    // UNDERGROWTH between the trunks, the layer a wood does not have. Its density is the served `groundCover`
    // scaled by the region, which is why dense growth is a wall and open canopy is not.
    plantUndergrowth(ctx, ctx.claimed, ctx.water, pal, zoneAt, jungleFloorReach(ctx, ctx.claimed))

    // RUINS where a ruins region says so: a stone platform with columns on it. The planned routes are kept
    // out explicitly, which used to be done by skipping all of `claimed` and cost every ruin in the clearings.
    strewRegionRuins(ctx)

    // EMERGENTS, the few giants standing clear above the canopy.
    plantEmergents(ctx, ctx.claimed, ctx.water)

    // CROSS THE CREEK. Before this existed the creek ran edge to edge and split the jungle into two halves
    // that never met: 6 regions, the largest holding 49% of the walkable ground against a woodland's 100%.
    // The crossings are FALLEN LOGS rather than a stone bridge, because a jungle has no masonry and the thing
    // you actually cross a creek on is a tree that came down over it.
    const course = riverCourse(ctx, 'through')
    if (course) bridgeRiver(ctx, flowingWater(ctx), ctx.claimed, course, pal)
    else fellLogsAcross(ctx, ctx.water, pal)

    // KEEP IT ONE PLACE by CUTTING TO the strays rather than carpeting them. The undergrowth blocks half the
    // floor, which pinches regions off behind it; filling those in is the meadow's answer and it costs play
    // area, while a track is exactly what gets you through undergrowth.
    repairFloorConnectivity(ctx, JUNGLE_MAX_POCKET)
    joinStrandedRegions(ctx)

    // THE WAYS OUT. Same lane as the meadow's, wearing the jungle's own trail and flanked by its growth.
    paintGateways(ctx, ctx.routes, ctx.water, ctx.claimed, {
      ground: FLAT_FLOOR,
      paving: wayTone(ctx),
      flank: flankingTrees,
    })

    dropDrownedFilms(ctx) // a puddle under a trunk is not a puddle
    settleWaterDepth(ctx, molten(ctx, pal), ctx.pools, ctx.still) // the creek settles by depth; the pools stay blocking
  },
}


// ── the pathways OUT ──────────────────────────────────────────────────────────
// One lane, shared by every layout. It is the meadow's entrance generalised twice over:
//
//   1. ANY EDGE. It only ever ran in from the top or the bottom, so a gate on the east or west side had
//      nothing drawn at all.
//   2. THE DRESSING IS THE LAYOUT'S. A meadow way out is cobble between flower beds under lamps; a forest way
//      out is its own trail between flanking trunks. Same lane, the template's own materials.

/** Where a `CROSSING_ROWS`-wide deck starts, so the band is centred on the line it was cut along. */
const DECK_HALF = Math.floor(CROSSING_ROWS / 2)

/** How far a way out reaches in. There is no half-width beside it on purpose: a way is as wide as the gate
 *  it runs out of, and the gate is cut at the SERVED width. PATHWAYS.md §3. */
const GATEWAY_RUN = 11

/** Which way a lane runs in from each edge, and which way it measures its width. */
const GATEWAY_STEPS: Record<Side, { readonly inward: readonly [number, number]; readonly across: readonly [number, number] }> = {
  south: { inward: [0, -1], across: [1, 0] },
  north: { inward: [0, 1], across: [1, 0] },
  west: { inward: [1, 0], across: [0, 1] },
  east: { inward: [-1, 0], across: [0, 1] },
}

/** What stands down both sides of a way out, one call per lane-side cell. The layout chooses it. */
type GatewayFlank = (ctx: ArchetypeContext, col: number, row: number, depth: number) => void

/** Tended beds the whole way, with two pairs of lamps. A lamp REPLACES the bed at its depth: the post blocks
 *  its own cell, so a flower placed there would sit inside a blocked cell. */
function bedsAndLamps(ctx: ArchetypeContext, col: number, row: number, depth: number): void {
  // The lamps that used to stand at these two depths are gone with the rest of the bulbs; the beds stay.
  plantFlowerBed(ctx, col, row)
}

/** Trunks down both sides, so a forest way out reads as a gap in the trees rather than a lane that happens to
 *  be empty. Every other cell, or it comes out as a hedge. */
function flankingTrees(ctx: ArchetypeContext, col: number, row: number, depth: number): void {
  if (depth % 2 === 1) return
  stampTree(ctx, col, row)
}

/** One way out: the border cells it opens on, what it is paved with, and what stands beside it. */
interface Gateway {
  side: Side
  /**
   * THE GATE'S OWN CELLS, in order along the edge. This is the way's width, and it is the only one.
   *
   * It used to be `inside`, one cell, from which the lane rebuilt its own width off a `GATEWAY_HALF` of 2,
   * so every way out was painted 5 cells across whatever the template served. An exit then had TWO widths:
   * the structure's (`gateOn` cuts exactly `pathwayWidth`) and the dressing's constant 5. Everything that
   * guards an exit, the claim, `sealMapEdge`'s spare list, the connectors, works off the structure's, so on
   * a served 3 the two outermost paved cells were unguarded ground in plain sight and the border treeline
   * planted straight into them: the reported `[tree][ ][ ][ ][tree]`.
   *
   * Taking the cells themselves rather than a width means nothing here can disagree with the plan.
   * PATHWAYS.md §3.
   */
  cells: readonly Cell[]
  /** The floor label the lane is laid in, and the tone it wears. Both the layout's own. */
  ground: string
  paving: string | undefined
  flank: GatewayFlank
}

/**
 * Paint one way out: a lane cleared of whatever grew on it, paved so you can see it, dressed so you can tell
 * it leads somewhere.
 *
 * Never the water in it. Clearing a river cell's collision makes the river WALKABLE, and a river on the
 * `through` course can run straight across a lane.
 */
function paintGateway(ctx: ArchetypeContext, gate: Gateway, water: ReadonlySet<string>, routes: Set<string>): void {
  const { cols, rows, ground, collision, floorColors } = ctx
  const { inward, across } = GATEWAY_STEPS[gate.side]
  // THE MOUTH IS THE GATE. Every lane cell is one of the gate's own cells carried `depth` steps inward, so
  // the way the map DRAWS is cell-for-cell the way the map PLANNED, and the claim that protects the plan
  // protects every cell you can see. PATHWAYS.md §3.
  const mouths = gate.cells
  if (mouths.length === 0) return
  const at = (depth: number, mouth: Cell): Cell => ({
    col: mouth.col + inward[0] * depth,
    row: mouth.row + inward[1] * depth,
  })
  // What stands BESIDE the way: the two cells just outside the outermost lanes, one on each hand. Taken off
  // the gate's ends rather than off a half-width, so a 2-wide way is flanked one cell out and a 4-wide way
  // is flanked one cell out, instead of both being flanked three cells from a centre they do not share.
  const first = mouths[0]
  const last = mouths[mouths.length - 1]
  const sides: Cell[] = [
    { col: first.col - across[0], row: first.row - across[1] },
    { col: last.col + across[0], row: last.row + across[1] },
  ]

  const lane = new Set<string>()
  for (let depth = 0; depth < GATEWAY_RUN; depth++) {
    for (const mouth of mouths) {
      const { col, row } = at(depth, mouth)
      if (!inBounds(col, row, cols, rows) || water.has(`${col},${row}`)) continue
      lane.add(`${col},${row}`)
    }
  }
  clearMeadowCells(ctx, lane)

  for (let depth = 0; depth < GATEWAY_RUN; depth++) {
    for (const mouth of mouths) {
      const { col, row } = at(depth, mouth)
      if (!lane.has(`${col},${row}`) || collision[row][col]) continue
      ground[row][col] = gate.ground
      // NO PAVING TONE, NO REPAINT. Writing `undefined` here CLEARED the colour the trail pass had already
      // laid, so a template that states no tone came out with a way that stopped dead at its own gateway.
      //
      // ONE TONE, like every other cell of the way. It darkened the outermost cell on each side, which was the
      // rim trick from when a boundary was a colour, and it left a gateway wearing two tones where the way it
      // continues wears one. The boundary is art now, laid by `wearTheWay` over whichever cells meet the
      // field, and a gateway's cells are in `routes` so they get it like the rest.
      if (gate.paving) floorColors[row][col] = gate.paving
      routes.add(`${col},${row}`)
    }
    for (const side of sides) {
      const { col, row } = at(depth, side)
      if (!inBounds(col, row, cols, rows) || water.has(`${col},${row}`)) continue
      gate.flank(ctx, col, row, depth)
    }
  }
}

/** Every gate the plan made, drawn. Without this a layout paves its pathways and leaves them looking like any
 *  other stretch of floor, so there is nothing on screen that reads as a way out. */
function paintGateways(
  ctx: ArchetypeContext,
  plan: RoutePlan | null | undefined,
  water: ReadonlySet<string>,
  routes: Set<string>,
  dress: Omit<Gateway, 'side' | 'cells'>,
): void {
  if (!plan) return
  for (const gate of plan.gates) paintGateway(ctx, { ...dress, side: gate.side, cells: gate.cells }, water, routes)
}

/** Paint a route network in a served tone, so a way through is something you can SEE rather than merely walk.
 *  Water is skipped: a path laid over water is neither a path nor a river, water is crossed on a deck. */
/** How coarse the bloom lattice is. Bigger than the canopy's, because flowers should come in PATCHES you can
 *  point at rather than an even sprinkle over the whole floor. */
const BLOOM_LATTICE = 9

/**
 * MAY A BLOOM STAND HERE? The one rule, in one place.
 *
 * Flowers in the bridge wood happened because this rule existed in ONE of the three bloom passes.
 * `scatterFlowers` checked the ground (roads, built floor, water) and the other two checked nothing at all,
 * so a clearing or a light gap would plant on a deck. `ctx.decks` has always been recorded by `layDeck` and
 * nothing consulted it.
 */
function canPlantBloom(ctx: ArchetypeContext, col: number, row: number): boolean {
  if (!inBounds(col, row, ctx.cols, ctx.rows)) return false
  if (isEdge(col, row, ctx.cols, ctx.rows)) return false
  if (ctx.collision[row][col]) return false
  if (ctx.decks.has(`${col},${row}`)) return false // never on a bridge or a boardwalk
  const ground = ctx.ground[row][col]
  if (isWaterGround(ground)) return false
  if (isBuiltFloor(ground) || isRoadGround(ground)) return false
  return true
}

/**
 * PICK A CLUSTERED SHARE of the candidates: value noise on a coarse lattice, lowest-scoring taken.
 *
 * The choice when asked how blooms should be distributed: patches, not an even scatter. This is the SAME
 * mechanism the canopy uses, and that function's own comment records why the alternatives fail: a per-cell
 * roll gives an even sprinkle with no order to it, and random anchors until a count is hit gave "ruinous"
 * distribution because the loop stops as soon as the number fills. Scoring every candidate and taking the
 * lowest N is exact by construction and clumps because neighbours interpolate from the same lattice corners.
 */
function pickClustered(ctx: ArchetypeContext, candidates: readonly Cell[], share: number, lattice: number): Cell[] {
  if (share <= 0 || candidates.length === 0) return []
  const size = Math.max(1, Math.round(lattice))
  const latticeCols = Math.ceil(ctx.cols / size) + 2
  const latticeRows = Math.ceil(ctx.rows / size) + 2
  // POSITIONAL noise, not draws from the layer rng. Pulling a lattice out of `ctx.rand()` would consume
  // hundreds of numbers from the SHARED seeded sequence, so every later pass (the canopy above all) would
  // land differently purely because the bloom pass ran. That is how this function first broke the jungle's
  // choked-forest test without touching a single collision cell: the woodland's canopy moved underneath it.
  // `shadeNoise` is the file's existing positional noise, so the patches stay reproducible per seed and cost
  // the sequence nothing.
  const corner: number[][] = []
  for (let r = 0; r < latticeRows; r++) {
    const line: number[] = []
    for (let c = 0; c < latticeCols; c++) line.push(shadeNoise(c * 12.9898 + r * 78.233))
    corner.push(line)
  }
  const smooth = (t: number) => t * t * (3 - 2 * t)
  const noiseAt = (col: number, row: number): number => {
    const gc = col / size
    const gr = row / size
    const c0 = Math.floor(gc)
    const r0 = Math.floor(gr)
    const tx = smooth(gc - c0)
    const ty = smooth(gr - r0)
    const a = corner[r0][c0] + (corner[r0][c0 + 1] - corner[r0][c0]) * tx
    const b = corner[r0 + 1][c0] + (corner[r0 + 1][c0 + 1] - corner[r0 + 1][c0]) * tx
    return a + (b - a) * ty
  }
  const scored = candidates.map(cell => ({ cell, n: noiseAt(cell.col, cell.row) }))
  scored.sort((a, b) => a.n - b.n)
  return scored.slice(0, Math.round(scored.length * Math.min(1, share))).map(s => s.cell)
}

/** A gate lane's half-width and how far it reaches in. The meadow's own numbers, which it has called correct:
 *  5 cells across (wider than the 3-cell corridor, so the way MOUTHS at the border) and 11 deep. */
const GATE_LANE_HALF = 2
const GATE_LANE_RUN = 11

/**
 * THE CELLS OF EVERY GATE'S LANE: the mouth of each way where it meets the map edge.
 *
 * That is right, and the reason is narrow. All three forest layouts PLAN the same network (`plannedRoutes`), and
 * all three render the corridor. What only the meadow does is render the GATES: `paintMeadowEntrance` clears
 * and paves a wide lane running in from the edge, so the way reads as an opening. Woodland and jungle drew a
 * 3-wide corridor that simply stopped at the border, which is a path you can walk and cannot see.
 *
 * This is the geometry half, shared, so both layouts get the same mouth and neither grows its own copy. What
 * each layout DOES with the cells stays its own: the woodland folds them into `trailCells` and its existing
 * paving handles them, the jungle tints them like the rest of its track. Water is skipped, because a lane laid
 * over the river is a blocked stripe rather than a way (the same rule the trail paving already follows).
 *
 * `d` starts at -1 so the EDGE cells are included, not just the run inward from `gate.inside`.
 */
function gateLaneCells(
  ctx: ArchetypeContext,
  plan: RoutePlan,
  water: ReadonlySet<string>,
  half = GATE_LANE_HALF,
  run = GATE_LANE_RUN,
): Set<string> {
  const { cols, rows } = ctx
  const lane = new Set<string>()
  for (const gate of plan.gates) {
    // Which way the lane runs IN from its edge, and which axis it widens along.
    const [dc, dr] =
      gate.side === 'north' ? [0, 1] : gate.side === 'south' ? [0, -1] : gate.side === 'west' ? [1, 0] : [-1, 0]
    const [wc, wr] = dc === 0 ? [1, 0] : [0, 1]
    for (let d = -1; d < run; d++) {
      for (let w = -half; w <= half; w++) {
        const col = gate.inside.col + dc * d + wc * w
        const row = gate.inside.row + dr * d + wr * w
        if (!inBounds(col, row, cols, rows)) continue
        if (water.has(`${col},${row}`)) continue
        lane.add(`${col},${row}`)
      }
    }
  }
  return lane
}

/**
 * WEAR A SET OF CELLS INTO A WAY: the same stepped tone `paveLane` lays, for a layout that decides its own
 * cells rather than taking them off the plan.
 *
 * `paveRoutes` stood here beside it and did the same work from a `RoutePlan`, one flat tone with a water
 * skip. Two painters mean two looks for one thing, which is what put a flat cobble way beside a mottled dirt
 * one on the same meadow. Water is skipped here as it was there: a river is crossed on a deck, never paved.
 */
function tintCells(ctx: ArchetypeContext, cells: ReadonlySet<string>, tone: string | undefined): void {
  if (!tone) return
  wearTheWay(ctx, cells, tone)
}

/** How big a stranded pocket the jungle repair absorbs. Higher than the meadow's 12 because undergrowth
 *  closes pockets the meadow's framing trees never would, and a choked pocket is not a feature. */
const JUNGLE_MAX_POCKET = 40

/**
 * CUT A TRACK to anything left stranded, until the whole floor is one place.
 *
 * `repairFloorConnectivity` answers a stranded pocket by filling it in. That is right for a meadow, where a
 * pocket is a mistake, and wrong for a jungle, where it is simply ground the undergrowth closed off, the
 * area is worth keeping and a machete is what you would actually use. So every region that is not the
 * largest gets a track cut from it to the nearest cell of the largest.
 *
 * Bounded by the number of regions it finds, and each pass strictly reduces them, so it cannot spin.
 */
function joinStrandedRegions(ctx: ArchetypeContext): void {
  const { cols, rows, collision } = ctx
  const isFloor = (col: number, row: number) => inBounds(col, row, cols, rows) && !collision[row][col]

  // A few passes, because one route can absorb several strays at once and re-flooding is cheaper than
  // assuming it did not. Each pass strictly reduces the count, so this cannot spin.
  for (let guard = 0; guard < 6; guard++) {
    const seen = new Set<string>()
    const found: Set<string>[] = []
    forEachCell(cols, rows, (col, row) => {
      if (!isFloor(col, row) || seen.has(`${col},${row}`)) return
      found.push(flood(isFloor, col, row, seen))
    })
    if (found.length <= 1) return
    found.sort((a, b) => b.size - a.size)
    const mainCells = [...found[0]].map(toCell)

    // EVERY stray in one pass, dense undergrowth pinches the floor into many small islands, and one per pass
    // would need a full re-flood each.
    for (const stray of found.slice(1)) {
      const from = toCell([...stray][0])
      // A DRY route first, a log only when there is none. Measured before this: an around-river woodland came
      // out with five crossings, because the forest beyond the river breaks into fragments and each one was
      // reached across the nearest water when it could be joined ALONG ITS OWN BANK to the piece the real
      // bridge already serves. A moat with five logs over it is not a moat. Right-angle routes, not a
      // wandering track: a dry one can be checked before it is cut, and a log, when one is needed, comes out
      // as one straight deck instead of the scatter of pieces a wandering line leaves on water.
      const dry = dryRouteTo(ctx, from, mainCells)
      if (dry) cutRoute(ctx, dry, false)
      else cutRoute(ctx, elbowRoute(from, nearestOf(from, mainCells) ?? from, true), true)
    }
  }
}

/** A right-angle route from `a` to `b`: along one axis, then the other. */
function elbowRoute(a: Cell, b: Cell, colsFirst: boolean): Cell[] {
  const out: Cell[] = [{ col: a.col, row: a.row }]
  let { col, row } = a
  const step = (x: number, y: number) => (x < y ? 1 : -1)
  const walkCols = () => { while (col !== b.col) { col += step(col, b.col); out.push({ col, row }) } }
  const walkRows = () => { while (row !== b.row) { row += step(row, b.row); out.push({ col, row }) } }
  if (colsFirst) { walkCols(); walkRows() } else { walkRows(); walkCols() }
  return out
}

/** The first right-angle route into the main region that touches no water, every main cell, nearest first,
 *  both elbow orders. Null only when every one of them has to cross water, which is the one case for a log. */
function dryRouteTo(ctx: ArchetypeContext, from: Cell, mainCells: readonly Cell[]): Cell[] | null {
  // isWaterGround, not a name test: after the depth pass a cell is `water_deep`, and an exact test read that
  // as dry ground and would cut a route straight across it.
  const isWater = (c: Cell) => inBounds(c.col, c.row, ctx.cols, ctx.rows) && isWaterGround(ctx.ground[c.row][c.col])
  const byDistance = [...mainCells].sort((p, q) =>
    (p.col - from.col) ** 2 + (p.row - from.row) ** 2 - ((q.col - from.col) ** 2 + (q.row - from.row) ** 2))
  for (const target of byDistance) {
    for (const colsFirst of [true, false]) {
      const route = elbowRoute(from, target, colsFirst)
      if (!route.some(isWater)) return route
    }
  }
  return null
}

/**
 * Cut a route to walking width. Land is cleared of whatever stands on it. Water is either left alone (a dry
 * route that merely runs beside it) or, for a route that has to cross, laid as a log deck, never cleared
 * into a walkable stripe of river.
 */
function cutRoute(ctx: ArchetypeContext, route: readonly Cell[], bridgeWater: boolean): void {
  const wet = new Set<string>()
  const dry = new Set<string>()
  const width = pathwayWidth(ctx)
  for (const { col, row } of route) {
    for (let dc = 0; dc < width; dc++) {
      for (let dr = 0; dr < width; dr++) {
        const c = col + dc
        const r = row + dr
        if (!inBounds(c, r, ctx.cols, ctx.rows)) continue
        ;(isWaterGround(ctx.ground[r][c]) ? wet : dry).add(`${c},${r}`)
      }
    }
  }
  for (const key of dry) {
    const { col, row } = toCell(key)
    ctx.collision[row][col] = false
  }
  clearMeadowCells(ctx, dry)
  if (bridgeWater && wet.size > 0) layDeck(ctx, wet, wayTone(ctx))
}

/** The nearest of an already-materialised cell list. Separate from `nearestCell` because that one re-parses
 *  keys on every call, which is wasted work when the same list is searched hundreds of times. */
function nearestOf(from: Cell, cells: readonly Cell[]): Cell | null {
  let best: Cell | null = null
  let bestD = Infinity
  for (const cell of cells) {
    const d = (cell.col - from.col) ** 2 + (cell.row - from.row) ** 2
    if (d >= bestD) continue
    bestD = d
    best = cell
  }
  return best
}

/**
 * FALLEN LOGS over the creek, the crossings that keep the two banks one place.
 *
 * Placed along the creek's run rather than at a fixed point, because a creek that meanders has no single
 * "middle", and two of them so a crossing is never a long detour.
 */
/** How many rows wide a FORD is: the stretch of river shallow enough to wade. Two, against the four of a
 *  built bridge, whose width comes from the composition stamped on it. */
const FORD_ROWS = 2

function fellLogsAcross(ctx: ArchetypeContext, water: Set<string>, pal: GeneratorPalette | undefined, fractions: readonly number[] = [0.32, 0.72]): void {
  if (water.size === 0) return
  // HOW MANY FORDS IS THE CALLER'S CALL, and it is the number that matters.
  //
  // This laid a log at two or three fixed fractions of the river on every map with water, on top of the decks
  // the ways already got where they cross it. Measured on a swamp: 37 deck cells from the routes, which are
  // the crossings a person walks to, plus 56 more from here that nothing leads to. A ford is four rows of
  // planking, so those 56 are what read as brown rectangles lying in the landscape.
  //
  // Gating this on the floor being in pieces was tried and is wrong: the crossing on the path network joins
  // the floor first, so the guard then refuses every ford and a river stops being crossable anywhere but at
  // the one path. Fewer fords, not no fords.
  const cells = [...water].map(toCell)
  // Which way the creek RUNS, the axis it spans more of. The log lies across the other one.
  const cols = cells.map(c => c.col)
  const rows = cells.map(c => c.row)
  const vertical = Math.max(...rows) - Math.min(...rows) >= Math.max(...cols) - Math.min(...cols)
  const along = (c: Cell) => (vertical ? c.row : c.col)
  const lo = Math.min(...cells.map(along))
  const hi = Math.max(...cells.map(along))

  // How wide the water is on every line, so a crossing can be put at the NARROWS rather than at a fixed
  // fraction. A meander makes a straight slice through the middle far longer than the river is actually wide,
  // and the flat deck has to reach both banks, so that slice is what made the wooden causeway.
  const widths = new Map<number, number>()
  for (const c of cells) widths.set(along(c), (widths.get(along(c)) ?? 0) + 1)
  const CROSSING_REACH = 6

  for (const frac of fractions) {
    const at = narrowestLine(widths, Math.round(lo + (hi - lo) * frac), CROSSING_REACH)
    // Every water cell on that line, plus one dry cell past each end so the log lands on both banks.
    const band = cells.filter(c => along(c) === at)
    if (band.length === 0) continue
    const across = (c: Cell) => (vertical ? c.col : c.row)
    // THE CHANNEL, NOT THE WHOLE SLICE.
    //
    // This took the min and the max of the water on the line and decked everything between them. A river
    // MEANDERS, so one straight slice can touch it at two places with dry land in the gap, and the deck then
    // ran over that dry land as planking. Measured on a swamp: 86 deck cells in six separate decks, the
    // biggest 32 long, and only 24 of the 86 touching water at all. Two thirds of every crossing was a
    // plank road over solid ground, which is what the brown rectangles are.
    //
    // A crossing spans ONE channel: the contiguous run of water, plus a cell of landing on each bank.
    const span = widestRun(band.map(across).sort((a, b) => a - b))
    const from = span.from - 1
    const to = span.to + 1
    // A FORD IS NOT A BRIDGE AND LAYS NO PLANKING.
    //
    // A ford is a stretch of river too shallow to stop you, not a structure: you walk THROUGH it. This called
    // `layDeck`, which swaps the cell's ground for `bridge` and paints it the way's tone, so every ford came
    // out as a dirt coloured plank rectangle lying across the water.
    //
    // So the water STAYS. It is raised back flush with its banks, undoing exactly the cut `levelTheWater` made,
    // so there is no rim to climb into or out of, and it stops blocking. The shallow tile is what the river
    // already uses at its own edges, so a ford reads as a continuation of the water rather than as a thing
    // built on it.
    // ONE KIND OF FORD, MADE ONE WAY. This wrote its own cells: shallow water as the GROUND, no route under
    // it and no film over it, which is not what a dirt crossing is any more. Two makers meant two looks, and
    // measured on one seed, 10 of a map's 18 ford cells came out as bare opaque route with no water on them
    // because these were later paved over: *"that's how the FULL dirt path should look like, right now is not
    // entirely correct"*. So this one decides WHERE and `wadeCrossing` decides WHAT, for every ford.
    const half = Math.floor(FORD_ROWS / 2)
    const wet = new Set<string>()
    for (let a = from; a <= to; a++) {
      for (let w = half - FORD_ROWS + 1; w <= half; w++) {
        const col = vertical ? a : at + w
        const row = vertical ? at + w : a
        if (!inBounds(col, row, ctx.cols, ctx.rows)) continue
        if (!isWaterGround(ctx.ground[row][col])) continue // the banks either side stay land
        wet.add(`${col},${row}`)
      }
    }
    wadeCrossing(ctx, wet, wayTone(ctx))
    // AND NO STRUCTURE ON IT. A ford is a shallow stretch of river, so there is nothing to stamp a bridge
    // composition onto: those rails and abutments are what a BUILT crossing is made of, and standing them in
    // the water with no deck under them is what put tall plank boxes in the middle of the landscape.
    // `placeRiverCrossing` still builds a real bridge where a way meets the water, which is where one belongs.
  }
}

/**
 * THE SUB-ZONE MAP, which region each cell belongs to.
 *
 * The shape (2026-09-11):
 * regions inside ONE map, so you walk out of the open canopy into dense growth without loading anything.
 *
 * Nearest-seed partition: scatter a seed per region, every cell joins its closest. That gives irregular
 * organic borders for free, which matters, a jungle does not change character along a straight line. The
 * distance is warped by a little noise so the borders wobble instead of reading as Voronoi edges.
 *
 * Seeds are drawn by WEIGHT, so the served numbers decide how much of the map each kind tends to claim.
 */
/**
 * How much heavier the region you PICKED is than the weights the generator serves.
 *
 * `partitionSubZones` hands one seed to every kind first and draws the rest by weight, so multiplying the
 * lead's weight makes it dominate the map WITHOUT deleting the others: a swamp-led jungle is mostly swamp with
 * dense growth and open canopy still in it, which is what a region you pick should mean.
 */
const REGION_LEAD = 5

/**
 * The served regions, with the picked one weighted up. `random` or nothing picked leaves the served weights
 * exactly as they are, and a key this template does not carry is ignored rather than guessed at.
 */
function leadRegion(ctx: ArchetypeContext, zones: readonly GeneratorSubZone[] | undefined): readonly GeneratorSubZone[] {
  const served = zones ?? []
  const picked = ctx.options?.region
  if (typeof picked !== 'string' || picked === 'random' || picked === '') return served
  if (!served.some(z => z.key === picked)) return served
  return served.map(z => (z.key === picked ? { ...z, weight: z.weight * REGION_LEAD } : z))
}

/** How a region set is laid on the map. Served per generator; absent means the scatter it has always had. */
export type RegionLayout = 'scatter' | 'rings' | 'bands'

const REGION_LAYOUTS: readonly RegionLayout[] = ['scatter', 'rings', 'bands']

/** The served arrangement, falling back to the scatter rather than to a guess. */
function regionLayoutOf(ctx: ArchetypeContext): RegionLayout {
  const served = ctx.regionLayout
  return REGION_LAYOUTS.includes(served as RegionLayout) ? (served as RegionLayout) : 'scatter'
}

/**
 * THE ORDERED LAYOUTS: a region set you walk THROUGH rather than stumble across.
 *
 * Both read the served ORDER of the list, so the list stops being a bag and becomes a sequence, and both use
 * `weight` as the THICKNESS of the ring or band rather than as a seed count, so the served numbers keep
 * meaning how much of the map a region claims.
 *
 *   rings   region 0 at the middle, the last at the rim. For anything you APPROACH: a volcano, a ruin.
 *   bands   region 0 at the SOUTH edge, the last at the north. For a gradient you cross: a mountain foot to
 *           summit, a beach shore to inland, a swamp margin to open water.
 *
 * South first is not arbitrary: a map's entrance is always south (`DESIGN-ENTRANCES.md`), so band 0 is the one
 * you walk into. That puts the foot of the mountain and the shore of the beach where you arrive, which is
 * what his descriptions say: *"is not same the bottom of the mountain, the middle and the top"*.
 *
 * The same noise the scatter uses wobbles the boundary, or the rings read as drawn with a compass.
 */
function orderedRegions(
  ctx: ArchetypeContext,
  zones: readonly GeneratorSubZone[],
  layout: Exclude<RegionLayout, 'scatter'>,
  map: (GeneratorSubZone | undefined)[][],
): (GeneratorSubZone | undefined)[][] {
  const { cols, rows } = ctx
  // WEIGHT IS A SHARE OF THE MAP, so the cut is by RANK rather than by a threshold on the coordinate.
  //
  // Cutting on the coordinate is what the first version did and it is wrong for rings: a ring is an ANNULUS,
  // so a region holding the innermost tenth of the RADIUS holds a hundredth of the AREA. Measured by the
  // region sheet: the volcanic crater, served weight 1 of 12, came out at 0 per cent of the map. The same
  // error is invisible on bands, because a band's area really is linear in its coordinate, which is exactly
  // the kind of thing that survives until something renders every member and looks.
  //
  // Sorting the cells by their position along the journey and cutting the sorted list at the served shares
  // gives each region its share of the MAP exactly, on rings and bands alike, whatever shape the map is.
  const midCol = (cols - 1) / 2
  const midRow = (rows - 1) / 2
  // The same noise the scatter uses, or the rings read as drawn with a compass.
  const along = (col: number, row: number): number =>
    (layout === 'rings' ? Math.hypot(col - midCol, row - midRow) : rows - 1 - row) + shadeNoise(col * 0.23 + row * 0.41) * 2.2

  const cells: Array<{ col: number; row: number; at: number }> = []
  forEachCell(cols, rows, (col, row) => { cells.push({ col, row, at: along(col, row) }) })
  cells.sort((a, b) => a.at - b.at)

  const total = zones.reduce((n, z) => n + Math.max(0, z.weight), 0) || zones.length
  let i = 0
  zones.forEach((zone, index) => {
    // The last region takes whatever is left, so rounding can never leave a cell unassigned.
    const share = Math.max(0, zone.weight) || 1
    const upto = index === zones.length - 1 ? cells.length : Math.min(cells.length, i + Math.round((share / total) * cells.length))
    for (; i < upto; i++) map[cells[i].row][cells[i].col] = zone
  })
  return map
}

/**
 * WHICH REGION each cell belongs to.
 *
 * Seeds are drawn by WEIGHT, so the served numbers decide how much of the map each kind tends to claim, and
 * the distance is warped by a little noise so the borders wobble instead of reading as Voronoi edges.
 *
 * Exported so WHERE a region lands can be tested directly. `zoneAt` never leaves the generator, so the only
 * other way to ask was to re-derive the answer in the test, which tests the test.
 */
export function partitionSubZones(ctx: ArchetypeContext, zones: readonly GeneratorSubZone[]): (GeneratorSubZone | undefined)[][] {
  const { cols, rows } = ctx
  const map: (GeneratorSubZone | undefined)[][] = Array.from({ length: rows }, () => new Array(cols).fill(undefined))
  if (zones.length === 0) return map

  // HOW THE SET IS LAID OUT, which is a property of the SET and is served (`REGIONS.md` §2).
  //
  // *"there's no sense of getting close to the volcano for example, because all of them are the same as the
  // other forests"*. The scatter below is a nearest-seed Voronoi, so every kind lands in blobs all over the
  // map, and NO amount of region content produces a sense of approach on top of that: the volcanic bands were
  // built with the right species and the right floors and still read as a wood, because you met them in a
  // random order. A set that describes a journey has to be laid out as one.
  const arrangement = regionLayoutOf(ctx)
  if (arrangement !== 'scatter') return orderedRegions(ctx, zones, arrangement, map)

  // One seed per ~200 cells, never fewer than TWICE the number of kinds. The density matters: the first pass
  // hands one seed to each kind so none is ever missing, and only the seeds after that are drawn by weight,
  // so too few of them and the served weights stop deciding anything.
  const total = zones.reduce((n, z) => n + z.weight, 0)
  const count = Math.max(zones.length * 2, Math.round((cols * rows) / 200))
  const seeds: Array<{ col: number; row: number; zone: GeneratorSubZone }> = []
  for (let i = 0; i < count; i++) {
    // The first pass guarantees every KIND is present; after that they are drawn by weight.
    const zone = i < zones.length ? zones[i] : pickWeighted(zones, ctx.rand() * total)
    seeds.push({ col: randIntWith(ctx.rand, 0, cols - 1), row: randIntWith(ctx.rand, 0, rows - 1), zone })
  }

  forEachCell(cols, rows, (col, row) => {
    let best = seeds[0]
    let bestD = Infinity
    for (const seed of seeds) {
      // The noise term is what stops the borders being straight lines between seeds.
      const wobble = shadeNoise(col * 0.31 + row * 0.47 + seed.col * 1.7 + seed.row * 2.3) * 6
      const d = Math.hypot(col - seed.col, row - seed.row) + wobble
      if (d >= bestD) continue
      bestD = d
      best = seed
    }
    map[row][col] = best.zone
  })
  return map
}

/**
 * The canopy field, scored PER REGION so each one hits its own density.
 *
 * The woodland's field takes one target over the whole map. That is right when the map has one character and
 * wrong the moment it has several: averaging a dense region and an open one gives you neither, just a
 * uniform middle. So the cells are bucketed by region and the same exact-coverage selection runs inside each
 * bucket against its own scaled target.
 *
 * Reuses `woodlandCanopyField`'s guarantee rather than re-deriving it: take the lowest-scoring N, and
 * coverage is exact by construction while still clumping.
 */
function subZoneCanopyField(
  ctx: ArchetypeContext,
  open: Set<string>,
  canopy: number,
  zoneAt: (GeneratorSubZone | undefined)[][],
  zones: readonly GeneratorSubZone[],
): Cell[] {
  const out: Cell[] = []
  for (const zone of zones) {
    // Everything OUTSIDE this region counts as already spoken for, so the shared field only scores cells
    // belonging to it. One extra pass per region, and each is cheap.
    const masked = new Set(open)
    forEachCell(ctx.cols, ctx.rows, (col, row) => {
      if (zoneAt[row][col] !== zone) masked.add(`${col},${row}`)
    })
    const target = clamp01(canopy * (zone.canopy ?? 1))
    // A region's OWN grouping first, the template's as the fallback, a swamp is spaced like a pasture even
    // inside a jungle whose default is a closed canopy.
    out.push(...woodlandCanopyField(ctx, masked, target, zone.formation ?? ctx.formation))
  }
  return out
}

/** Pick a sub-zone by WEIGHT from an already-scaled roll. */
function pickWeighted(zones: readonly GeneratorSubZone[], roll: number): GeneratorSubZone {
  let r = roll
  for (const z of zones) {
    if (r < z.weight) return z
    r -= z.weight
  }
  return zones[zones.length - 1]
}

/**
 * EVERY MAP-DESIGN PROPERTY A REGION STATES, applied in one call, for whichever layout is running.
 *
 * A region is a TEMPLATE for a piece of map, not a set of tree weights. The fields that shape the ground
 * (`floor`, `level`) were applied by the woodland and the jungle and by nobody else, `pools` by the jungle
 * alone and `stone` by the jungle alone, so which of a region's own properties survived depended entirely
 * on which builder the generator happened to name. Measured on what the backend serves today: the
 * woodland's `lakeside` asks for 22% standing water and the meadow's `bank` for 12%, and neither builder
 * has a pool pass, so a lakeside has no lake.
 *
 * That is a whole class of served-and-ignored, and the fix is to stop spreading the reader across builders.
 * A layout decides how a map is COMPOSED (trees as the field vs clearings as the field); it does not get to
 * decide which of a region's stated properties exist. Three calls, one per phase, and a new region field is
 * added in one place and works everywhere.
 */
function shapeRegions(ctx: ArchetypeContext): void {
  ctx.zones = leadRegion(ctx, ctx.subZones)
  ctx.zoneAt = partitionSubZones(ctx, ctx.zones)
  paintSubZoneFloors(ctx, ctx.zoneAt)
  raiseRegions(ctx, ctx.zoneAt)
}

/**
 * The standing water a region asks for, in the water phase.
 *
 * A PUDDLE AND A LAKE ARE THE SAME THING AT DIFFERENT SIZES, which is `WATER.md` §1 exactly: *"a river, a
 * lake and a beach are the same thing, a set of cells painted with a water tile, and what makes each of them
 * read as what it is comes from the SHAPE that is painted plus a border around its edge"*. This pass only
 * ever laid the puddle: a translucent film over the floor, correct for a swamp hollow and wrong for
 * everything else, so the one region on a woodland map named `lakeside` got wet grass instead of a lake.
 *
 * So the body decides. Under `REGION_LAKE_MIN` it is a hollow full of standing water and keeps the film it
 * always had, which leaves every swamp exactly as approved. At or over it, it is a BODY of water: real water
 * ground, which `borderTheWater` then finds on its own and edges with the same shore pieces the river wears,
 * and `classifyBody` reads as a lake or, when it runs along a map edge, as a sea.
 */
function floodRegionPools(ctx: ArchetypeContext, pal: GeneratorPalette | undefined): void {
  if (!ctx.zoneAt) return
  for (const body of regionPoolBodies(ctx, ctx.zoneAt)) {
    // A BODY GOES THROUGH THE WATER LAYER, exactly as the sea does, so it is cut, tinted, edged, depth-banded
    // and classified by the one set of passes that already do all of that. A PUDDLE keeps the film it has
    // always had: it is water lying on dry ground rather than a body you go around.
    // A LAKE STOPS SHORT OF THE RIVER, it is not cancelled by it. Judging the whole body meant one cell near
    // the channel demoted all of it, and on a swamp with a river running through it that was every body on the
    // map: measured, nothing grew anywhere in it. So the margin is trimmed off and stays marshy, and whatever
    // is left of the body is carved if it is still big enough to be a lake.
    const open = awayFromTheRiver(ctx, body)
    if (open.size >= REGION_LAKE_MIN) {
      for (const key of carveBody(ctx, pal, open)) { ctx.water.add(key); ctx.still.add(key) }
      const margin = new Set([...body].filter(key => !open.has(key)))
      if (margin.size > 0) layPoolFilm(ctx, margin, pal)
      continue
    }
    layPoolFilm(ctx, body, pal)
  }
}

/**
 * A body of standing water this big is a LAKE, cut into the map like the sea. Below it, a hollow with water
 * standing in it, which keeps the film it has always had.
 *
 * Sixty, not twenty-four. A swamp's pools come out in bodies of roughly twenty-five to fifty, and at the
 * lower number they were being promoted to lakes: measured, a swamp jungle dropped from over twenty puddles
 * to eighteen, which is the swamp losing the look it was approved with. A `lakeside`'s water lands in one
 * body of well over a hundred, so the two separate cleanly.
 */
const REGION_LAKE_MIN = 60

/** How far a LAKE keeps off the map's own watercourse, in cells. A puddle beside a creek is a swamp and is
 *  exactly right; a lake that close pinches the ground between the two into fragments, and the connectivity
 *  pass answers a fragment by logging across the RIVER. Measured on an `around` course, which hugs three
 *  edges: three crossings where its whole definition is one. */
const RIVER_ELBOW_ROOM = 3

/** The part of a body that is far enough from the map's watercourse to be carved as a lake. The rest is the
 *  marshy margin between the two, which stays a film. */
function awayFromTheRiver(ctx: ArchetypeContext, body: ReadonlySet<string>): Set<string> {
  const out = new Set<string>()
  for (const key of body) {
    const { col, row } = toCell(key)
    let crowded = false
    for (let dr = -RIVER_ELBOW_ROOM; dr <= RIVER_ELBOW_ROOM && !crowded; dr++) {
      for (let dc = -RIVER_ELBOW_ROOM; dc <= RIVER_ELBOW_ROOM; dc++) {
        if (isWaterGround(ctx.ground[row + dr]?.[col + dc])) { crowded = true; break }
      }
    }
    if (!crowded) out.add(key)
  }
  return out
}

/** The fallen masonry a region asks for, in the objects phase, keeping off the route network. */
function strewRegionRuins(ctx: ArchetypeContext): void {
  if (!ctx.zoneAt) return
  raiseRuins(ctx, ctx.zoneAt, ctx.water, ctx.routes?.cells ?? new Set<string>())
}

/** Paint each region's own floor tone, so the border between open canopy and dense growth is visible from
 *  above. A region that states no floor colour keeps whatever the base floor pass gave it. */
function paintSubZoneFloors(ctx: ArchetypeContext, zoneAt: (GeneratorSubZone | undefined)[][]): void {
  forEachCell(ctx.cols, ctx.rows, (col, row) => {
    const tone = zoneAt[row][col]?.floor
    if (tone) ctx.floorColors[row][col] = tone
  })
}

/**
 * THE WATER A CROSSING IS FOR: the channel, which is every wet cell that is not standing.
 *
 * You ford a river because it is shallow here and you have to get to the other side. You do not ford a LAKE:
 * there is no other side, you walk around it. Handing the whole of `ctx.water` to the crossing passes had
 * them plank a way across a region's pond, so a map asked for NO RIVER came back with thirteen ford cells in
 * it, and a `divides` river came back with two crossings where its whole definition is one.
 */
const flowingWater = (ctx: ArchetypeContext): Set<string> => {
  const out = new Set<string>()
  for (const key of ctx.water) if (!ctx.still.has(key)) out.add(key)
  return out
}

/** Is this cell on the planned way, or close enough to it that the way's own width will reach it. */
function nearRoute(ctx: ArchetypeContext, col: number, row: number): boolean {
  const cells = ctx.routes?.cells
  if (!cells) return false
  const reach = Math.ceil(pathwayWidth(ctx) / 2) + 1
  for (let dr = -reach; dr <= reach; dr++) {
    for (let dc = -reach; dc <= reach; dc++) if (cells.has(`${col + dc},${row + dr}`)) return true
  }
  return false
}

/** WHERE A REGION'S STANDING WATER LIES, as separate bodies. Not a channel: it sits in hollows, so it is
 *  blobs scored off the same coherent noise the canopy uses rather than scattered per cell. */
function regionPoolBodies(ctx: ArchetypeContext, zoneAt: (GeneratorSubZone | undefined)[][]): Array<Set<string>> {
  const { cols, rows, ground } = ctx

  // 1 · WHERE the water stands. Coherent noise on a COARSE patch, so a pool comes out as a sheet.
  const candidate = new Set<string>()
  forEachCell(cols, rows, (col, row) => {
    const share = zoneAt[row][col]?.pools
    if (share === undefined) return
    // NOT THE CREEK. The creek is carved first and blocks its cells; a pool blob painted over the top of it
    // left cells reading as swamp-green standing water while behaving as river. Measured on a swamp jungle:
    // 21 swamp-toned cells, 9 of them blocked, and one `water` label carrying two different tones.
    //
    // This is one of the pathways it was: the
    // tone said puddle and the collision said channel. A pool is standing water in a hollow, so it takes only
    // cells the channel has not already claimed, and swamp tone now means exactly one thing.
    // NOT ON THE WAY IN. The route network is planned before a drop of water is laid (`pathways:plan` runs
    // ahead of `water`, on purpose), so a body can be kept off it rather than having to be bridged after the
    // fact. Without this a lake big enough to block could land across the only way to a stop and cut the map
    // in two, which is what a river gets a crossing for and a lake has no business doing.
    // …WITH A MARGIN. The plan's centreline is not the width of the way: the network is cut `pathwayWidth`
    // cells across, so water touching the line's neighbour still lands ON the way and gets forded. Measured
    // on a woodland asked for NO river: thirteen ford cells, all of them where a lake met the widened track.
    if (nearRoute(ctx, col, row)) return
    // THE PATCH DECIDES WHERE, A FINER NOISE DECIDES THE SHORE.
    //
    // Scoring the patch alone puts every boundary on a 5-cell step, so a body comes out as a RECTANGLE: a
    // beach's pool read as a painted teal box on the sand. The coarse term still carries almost all the
    // weight, so water stays in coherent sheets rather than breaking into a pepper of puddles; the fine term
    // only decides where inside its own patch the edge falls, which is what gives a lake a wobbling shore.
    const patch = shadeNoise(Math.floor(col / SWAMP_POOL_PATCH) * 1.9 + Math.floor(row / SWAMP_POOL_PATCH) * 2.7)
    const shore = shadeNoise(col * 0.73 + row * 1.31)
    // A BODY OF WATER NEVER FILLS ITS REGION EXACTLY, or its shape IS the region's shape.
    //
    // The score is 0..1 and the test was against `share * 2`, so any share from 0.5 up passes every cell and
    // the water comes out as the region: for a band that is a RECTANGLE with right-angle steps, which is what
    // a swamp's `open_water` (0.78) and its `sink` (0.5) were drawing. `WATER.md` §1 puts the whole weight on
    // the shape, so the threshold is capped below 1 and the noise always gets to bite the edge.
    if (patch * 0.82 + shore * 0.18 > Math.min(share * 2, WATER_FILL_CAP)) return
    candidate.add(`${col},${row}`)
  })

  // 2 · Only the real BODIES of it. A puddle of one or two cells reads as wet dirt, not as water you have to
  //     go around, and it is what made the map hard to read.
  return bodiesOf(candidate).filter(body => body.size >= SWAMP_MIN_POOL)
}

/**
 * A PUDDLE UNDER A TRUNK IS NOT A PUDDLE.
 *
 * The films are laid in the WATER layer and the trees are planted in OBJECTS after it, so a trunk can land on
 * a cell that already carries one. The cell then blocks while holding nothing but a film, which reads to
 * anything asking as "blocked by a flag rather than by what stands in it", and it is invisible anyway with a
 * tree standing on it. Run last, once everything that blocks has been placed.
 */
function dropDrownedFilms(ctx: ArchetypeContext): void {
  const kept: StageProp[] = []
  for (const prop of ctx.props) {
    if (prop.label === 'water_still' && ctx.collision[prop.row]?.[prop.col]) {
      const key = `${prop.col},${prop.row}`
      ctx.pools.delete(key)
      ctx.still.delete(key)
      ctx.wet.delete(key)
      continue
    }
    kept.push(prop)
  }
  ctx.props.length = 0
  ctx.props.push(...kept)
}

/** A HOLLOW FULL OF STANDING WATER: a translucent film laid over the floor, which keeps walking as floor. The
 *  share the backend serves is untouched, so a swamp is as wet as it was. */
function layPoolFilm(ctx: ArchetypeContext, body: ReadonlySet<string>, pal: GeneratorPalette | undefined): void {
  const { collision, floorColors } = ctx
  for (const key of body) {
    const { col, row } = toCell(key)
    // NOT UNDER SOMETHING SOLID. A puddle is water lying on open ground you can walk through, so a cell that
    // is already blocked does not get one: leaving it there produced a cell that was blocked and held nothing
    // but a film, which is the "blocked by a flag rather than by what stands in it" defect exactly.
    if (collision[row][col]) continue
    // `ctx.pools`, and NOT `ctx.water`, for the same reason a lake is kept out of it: that set is the channel.
    // The jungle used to put its films in there and it was harmless while the jungle was the only layout with
    // any, because its creek was carved first and dwarfed them. It is not harmless now that every layout has
    // them: measured on a woodland asked for a WOODEN bridge, the crossing pass was handed the films along
    // with the channel and laid a dirt ford instead. What keeps a plant out of a puddle is `ctx.wet`, which
    // is set below, and that has always been the field for it.
    ctx.pools.add(key)
    ctx.still.add(key)
    // A PUDDLE IS FLUSH WITH THE FLOOR; a channel surface is not.
    //
    // Measured before changing anything: a pool ALREADY sits at elevation 0, is ALREADY walkable (149 of 149
    // cells) and is already translucent. What made it read as recessed is mine from earlier the same day. I
    // gave `water` a height of 0.5 so a RIVER surface would sit under its bank rim, and a pool lays that same
    // label, so a puddle drew a 0.45-tileW slab standing PROUD of the floor with dark sides, which the eye
    // reads as a basin. One label cannot be both a sunken channel and a flush puddle.
    //
    // A PUDDLE HAS ITS OWN LABEL.
    //
    // This laid `water_shallow`, which is the RIVER's wadeable edge, so a pool and a channel wore one tile. It
    // also claimed in this very comment that the label was height 0.0, and the database has never said so: it
    // was 1.0 in both styles, so every puddle drew as a one-block cube of water standing on the floor.
    //
    // `water_still` is the puddle: height 0, non-blocking, and NO frames, because standing water has no
    // current. It is still water-ground (`isWaterGround` matches any label containing "water"), so all
    // thirteen consumers behave exactly as before.
    // THE GROUND STAYS. The film is stacked over it (`applyStageToGrid` places every prop at `cellStackTop`),
    // so the walking level is the floor's, unchanged, and the water lies on top of it. Marked wet so the
    // planting passes still keep out, which they used to learn from the ground label.
    ctx.wet.add(key)
    const film = resolveTile(styleCatalog('ascii'), ctx.zone, 'water_still')
    // `grows: false` for the same reason the ford's film carries it: standing water is not something GROWING
    // on the ground, it is water lying on it, and every sweep that clears a way of vegetation reads that flag.
    // Without it a puddle on a path counted as undergrowth on the path.
    ctx.props.push({ col, row, type: 'ground_decor', char: film.char, label: 'water_still', blocking: false, grows: false, color: pal?.swamp ?? pal?.water ?? film.color })
    // NO COLLISION. and
    // earlier:
    //
    // A pool is not a channel. `carveChannel` cuts its bed BELOW the walking floor and `levelTheWater` writes that
    // elevation, which is what makes a river something you go around. A pool sits AT ground level, so the map
    // said walkable and the collision grid said otherwise. The river keeps its bands (see settleWaterDepth);
    // this stamps a wet floor and nothing more.
    // THE FLOOR STAYS THE FLOOR. and then the model, in the
    // own words:
    //
    // Three layers, and this line was collapsing the first two into one. It painted the GROUND the river's
    // blue, so the cell was a walkable meadow wearing water: measured on a swamp jungle, 48 cells of exactly
    // that, which is the "walkable thing that looks like water" it is pointing at. The puddle is the FILM
    // stacked above (`water_still`, stackAt 0 so you neither step up onto it nor drop into it), and the water
    // look belongs to that tile, not to the floor underneath it.
    //
    // Nothing replaces this. Leaving the ground its own colour is not a fallback, it is the absence of an
    // override that should never have been written.
  }
}

/**
 * How coarse the pool noise is, in cells.
 *
 * with image
 * #18, where a swamp is a few big pools with boardwalks and mounds between them. Measured on a swamp jungle
 * before this: THIRTY separate bodies of water on one 40x30 map, twelve of them three cells or smaller, sizes
 * 129, 48, 20, 18, 16, 16, 12, 12 and down. That is a pepper of puddles and it came straight from scoring the
 * noise over a 2x2 patch. Five reads as a hollow full of standing water.
 */
/** The most of a region any body of water may take. Short of 1 on purpose: at 1 the noise stops deciding
 *  anything and the water's outline becomes the region's own straight border. */
const WATER_FILL_CAP = 0.86

const SWAMP_POOL_PATCH = 5
/** Under this many cells it is not a pool, so it never becomes water at all. */
const SWAMP_MIN_POOL = 6

/** The separate 4-connected bodies in a set of cells. */
function bodiesOf(cells: ReadonlySet<string>): Array<Set<string>> {
  const seen = new Set<string>()
  const out: Array<Set<string>> = []
  for (const key of cells) {
    if (seen.has(key)) continue
    seen.add(key)
    const body = new Set<string>([key])
    const stack = [key]
    while (stack.length) {
      const { col, row } = toCell(stack.pop()!)
      for (const [dc, dr] of ORTHO) {
        const k = `${col + dc},${row + dr}`
        if (cells.has(k) && !seen.has(k)) { seen.add(k); body.add(k); stack.push(k) }
      }
    }
    out.push(body)
  }
  return out
}

/** RUINS, fallen masonry in a ruins region. Blocking stone, scattered rather than laid out, because what is
 *  left of a jungle ruin is rubble and the odd standing wall, not a building. */
/** The floor a ruin stands on. The backend files it under `floors`, so nothing plants on a ruin's platform. */
const RUIN_FLOOR = 'ancient_stone'
/** Coarse patch the sites cluster on, exactly as the swamp's pools do. A patch is in or out whole, so a ruin
 *  comes out as a FOOTPRINT rather than as speckle. */
const RUIN_PATCH = 5
/** Smaller than this is rubble, not a building, and gets discarded. */
export const RUIN_MIN_SITE = 6
/** A column every other cell around the edge. REGULAR spacing is the whole difference between masonry and a
 *  pile of stones: nature does not put uprights at a fixed interval. */
const RUIN_COLUMN_STEP = 4

/** How many of a colonnade's columns have come down, as rubble on the floor instead. */
const RUIN_FALLEN = 0.3
/** Share of a platform's interior carrying a fallen block. */
const RUIN_RUBBLE = 0.14

/**
 * RUINS, which are BUILT.
 *
 * That was right, and this pass was the reason. It placed ONE `rock` prop per cell at a 16% roll, so the "ruins"
 * were boulders scattered through the trees: rubble, with no architecture anywhere in it. It also skipped
 * every cell in `open`, which reads like a bug and is not one, because the jungle puts its planned ROUTE cells
 * into `open` and skipping them is what keeps a blocking rock off the paths. Those are two different concerns
 * and they are separated now: `keepOut` holds the route cells, and the clearings are fair game, which is where
 * you can actually see a ruin.
 *
 * A ruin is a platform with columns standing on it. Every piece already exists in both art styles, so none of
 * this waits on new tiles.
 */
function raiseRuins(
  ctx: ArchetypeContext,
  zoneAt: (GeneratorSubZone | undefined)[][],
  water: Set<string>,
  keepOut: ReadonlySet<string> = new Set(),
): void {
  const { cols, rows } = ctx

  // 1 · WHERE a ruin stands. Coherent noise on a coarse patch, the same way the swamp finds its pools.
  const candidate = new Set<string>()
  forEachCell(cols, rows, (col, row) => {
    const share = zoneAt[row][col]?.stone
    if (share === undefined) return
    const key = `${col},${row}`
    if (water.has(key) || keepOut.has(key)) return
    if (shadeNoise(Math.floor(col / RUIN_PATCH) * 2.3 + Math.floor(row / RUIN_PATCH) * 1.7) > share * 1.5) return
    candidate.add(key)
  })

  // 2 · Only the real BODIES of it. One cell of stone is a rock; a building has a footprint.
  for (const body of bodiesOf(candidate)) {
    if (body.size < RUIN_MIN_SITE) continue
    // WHICH PART OF THE RUIN THIS IS. Read at the body's own centre, so one site is one building rather than
    // a chamber that turns into a colonnade halfway across.
    const mid = toCell([...body][Math.floor(body.size / 2)])
    const region = zoneAt[mid.row]?.[mid.col]?.key ?? ''
    ;(RUIN_BUILD[region] ?? stampRuin)(ctx, body, keepOut)
  }
}

/**
 * ONE RUIN: a stone platform, columns at regular intervals around its edge, fallen blocks between them.
 *
 * Collision is never CLEARED here. The canopy has already planted by this point, so clearing a cell would
 * leave a tree standing on walkable ground. The platform is laid only where nothing stands, and `placeProp`
 * refuses an occupied or watery cell on its own.
 */
/**
 * A RUIN IS A BUILT THING, and which built thing depends on which part of the ruin you are standing in.
 *
 * *"a forest with ruins is like machu pichu, like you should have sections where some parts of ruin show and
 * they gradually increase until you reach the actual ruins"*, and `REGIONS.md` §4 already recorded what was
 * missing: *"the `heart` wants a real built thing"*.
 *
 * What stood here was ONE stamp used in all four regions: a stone platform with a pillar every two cells
 * around its edge. At that spacing the columns read as a picket of crates rather than as architecture, and
 * because every region got the same one, a `courts` and an `overgrown` were the same object at two densities.
 *
 * NO NEW ART. `wall_stone` is a full nine-piece autotile family already, the one the buildings are made of,
 * and `pillar` and `rock` are approved props. This composes them, which is what `OBJECT-CONSTRUCTION.md` §2.3
 * means by a composition being a modular kit, and §2.4 by adding a FAMILY rather than branching.
 *
 *   heart      the thing itself: a roofless chamber, walls round its outline with a doorway left in one side
 *   courts     a colonnade: two rows of columns down the long axis of a paved floor, some of them fallen
 *   terraces   the retaining walls that make a terrace a terrace, along its lower edge
 *   overgrown  what is left further out: short broken runs of low wall, and no floor
 */
const RUIN_WALL: MassFamily<string> = {
  topLeft: 'wall_stone_tl', top: 'wall_stone_t', topRight: 'wall_stone_tr',
  edgeLeft: 'wall_stone_l', interior: 'wall_stone_c', edgeRight: 'wall_stone_r',
  bottomLeft: 'wall_stone_bl', bottom: 'wall_stone_b', bottomRight: 'wall_stone_br',
}

/** One cell of standing stone, wearing the piece its neighbours ask for. Blocking, like any wall. */
function makeRuinWall(ctx: ArchetypeContext, col: number, row: number, wall: ReadonlySet<string>): StageProp {
  const label = autotileLabel(RUIN_WALL, (c, r) => wall.has(`${c},${r}`), col, row)
  const tile = resolveTile(styleCatalog('ascii'), ctx.zone, label)
  return { col, row, type: 'ruin_wall', char: tile.char, label, blocking: true, color: tile.color }
}

/** The floor a ruin stands on: walkable stone, so a ruin is somewhere you go INTO rather than around. */
function pave(ctx: ArchetypeContext, body: ReadonlySet<string>, keepOut: ReadonlySet<string>): void {
  for (const key of body) {
    const { col, row } = toCell(key)
    if (keepOut.has(key) || ctx.collision[row][col]) continue
    ctx.ground[row][col] = RUIN_FLOOR
  }
}

/** What has fallen off the walls, scattered over the floor. */
function strewRubble(ctx: ArchetypeContext, body: ReadonlySet<string>, keepOut: ReadonlySet<string>): void {
  for (const key of body) {
    const { col, row } = toCell(key)
    if (keepOut.has(key) || ctx.collision[row][col]) continue
    if (ctx.rand() < RUIN_RUBBLE) placeProp(ctx, makeRock(col, row))
  }
}

/** The cells of a body that lie on its edge, which is where a wall runs. */
function outlineOf(body: ReadonlySet<string>): Set<string> {
  const edge = new Set<string>()
  for (const key of body) {
    const { col, row } = toCell(key)
    if (ORTHO.some(([dc, dr]) => !body.has(`${col + dc},${row + dr}`))) edge.add(key)
  }
  return edge
}

/**
 * THE HEART: a roofless chamber. Wall around the outline, floor inside, and a DOORWAY.
 *
 * The doorway is not decoration: a sealed box is a lump you walk around, and the whole point of the platform
 * is that you go in. It is cut two cells wide on the side nearest the map's south, which is the way in
 * (`DESIGN-ENTRANCES.md`), so you meet the opening rather than the back wall.
 */
function stampChamber(ctx: ArchetypeContext, body: ReadonlySet<string>, keepOut: ReadonlySet<string>): void {
  const wall = outlineOf(body)
  const cells = [...wall].map(toCell)
  const front = Math.max(...cells.map(c => c.row))
  const onFront = cells.filter(c => c.row === front).sort((a, b) => a.col - b.col)
  const door = onFront.slice(Math.max(0, Math.floor(onFront.length / 2) - 1), Math.floor(onFront.length / 2) + 1)
  for (const d of door) wall.delete(`${d.col},${d.row}`)

  pave(ctx, body, keepOut)
  for (const key of wall) {
    const { col, row } = toCell(key)
    if (keepOut.has(key)) continue
    placeProp(ctx, makeRuinWall(ctx, col, row, wall))
  }
  strewRubble(ctx, new Set([...body].filter(k => !wall.has(k))), keepOut)
}

/**
 * THE COURTS: a colonnade. Columns down the two long sides of a paved floor, well apart, and a gap where one
 * has come down. Open in the middle, which is what makes it a court rather than a room.
 */
function stampColonnade(ctx: ArchetypeContext, body: ReadonlySet<string>, keepOut: ReadonlySet<string>): void {
  pave(ctx, body, keepOut)
  const cells = [...body].map(toCell)
  const minCol = Math.min(...cells.map(c => c.col))
  const maxCol = Math.max(...cells.map(c => c.col))
  for (const key of body) {
    const { col, row } = toCell(key)
    if (keepOut.has(key) || ctx.collision[row][col]) continue
    // The two colonnades, and only every fourth cell along them: a column every two cells is a wall.
    if (col !== minCol && col !== maxCol) continue
    if (row % RUIN_COLUMN_STEP !== 0) continue
    if (ctx.rand() < RUIN_FALLEN) { placeProp(ctx, makeRock(col, row)); continue } // this one came down
    placeProp(ctx, makePillar(col, row))
  }
  strewRubble(ctx, body, keepOut)
}

/**
 * THE TERRACES: the retaining wall that holds a step of ground up, along its LOWER edge only, with the floor
 * behind it. A terrace read from the front is a wall; from above it is a field.
 */
function stampTerrace(ctx: ArchetypeContext, body: ReadonlySet<string>, keepOut: ReadonlySet<string>): void {
  pave(ctx, body, keepOut)
  const cells = [...body].map(toCell)
  const front = Math.max(...cells.map(c => c.row))
  const wall = new Set(cells.filter(c => c.row === front).map(c => `${c.col},${c.row}`))
  for (const key of wall) {
    const { col, row } = toCell(key)
    if (keepOut.has(key)) continue
    placeProp(ctx, makeRuinWall(ctx, col, row, wall))
  }
}

/**
 * OVERGROWN: what is left where the wood has taken it back. Short broken runs of wall, no floor under them,
 * so this reads as masonry IN a forest rather than as a building.
 */
function stampBrokenWall(ctx: ArchetypeContext, body: ReadonlySet<string>, keepOut: ReadonlySet<string>): void {
  const wall = new Set<string>()
  for (const key of outlineOf(body)) {
    const { col, row } = toCell(key)
    if (keepOut.has(key) || ctx.collision[row][col]) continue
    // Broken: roughly half of the run is missing, in stretches rather than per cell, so what stands reads as
    // a wall with gaps in it and not as a dotted line.
    if (shadeNoise(Math.floor(col / 3) * 1.7 + Math.floor(row / 3) * 2.9) > 0.5) continue
    wall.add(key)
  }
  for (const key of wall) {
    const { col, row } = toCell(key)
    placeProp(ctx, makeRuinWall(ctx, col, row, wall))
  }
}

/** Which structure each region of a ruin builds. A region the table does not name keeps the plain platform,
 *  so any other template that serves `stone` is unmoved. */
const RUIN_BUILD: Readonly<Record<string, (ctx: ArchetypeContext, body: ReadonlySet<string>, keepOut: ReadonlySet<string>) => void>> = {
  heart: stampChamber,
  courts: stampColonnade,
  terraces: stampTerrace,
  overgrown: stampBrokenWall,
}

/** The plain platform, for a template that serves `stone` without naming which part of a ruin it is. */
function stampRuin(ctx: ArchetypeContext, body: ReadonlySet<string>, keepOut: ReadonlySet<string>): void {
  pave(ctx, body, keepOut)
  for (const key of outlineOf(body)) {
    const { col, row } = toCell(key)
    if (keepOut.has(key) || (col + row) % RUIN_COLUMN_STEP !== 0) continue
    placeProp(ctx, makePillar(col, row))
  }
  strewRubble(ctx, body, keepOut)
}

/** The shaded floor, mottled over coarse patches. Two tones from the served palette so it reads as litter and
 *  shade rather than one fill; the patch size matches the meadow's for the same run-merging reason. */
/**
 * PAINT THE FLOOR. One helper, whatever kind of floor it is.
 *
 * *"instead of having paintJungleFloor it'd expect to just have a paintFloor helper that receives whatever
 * data is required to make the jungle, or maybe the paintFloor has a case inside that says 'when type is X,
 * do this' 'when type is X, do that'. basically, we don't want to have duplicated and redundant and poor
 * performing code"*.
 *
 * There were seven base floor painters, one per variant, and measured against the live catalogue the damage
 * was not the duplication but what it hid: `paintJungleFloor` was the ONLY function in the engine that
 * applied a template's served `palette.floor`, so all five WOODLAND templates served `#6f7f4a` and nothing
 * ever read it. Their field rendered as the season's grass, which is why a woodland path came out darker than
 * the ground beside it when every reference has it lighter.
 *
 * Two kinds of floor, chosen by what the data HAS rather than by which variant asked:
 *
 *   · MOTTLED, when it states tones. Coherent noise over coarse patches picks between them, so the floor
 *     reads as litter and shade rather than one flat fill.
 *   · A GRADIENT, when it states two ends. One tone lerped down the map in steps.
 *
 * States neither and nothing is painted, which is the honest default everywhere here: the tile keeps its own
 * colour rather than this file inventing one.
 */
interface FloorPaint {
  /** The base tone. */
  floor?: string
  /** A second tone the mottle picks, for shade. */
  floorAlt?: string
  /** A third, for litter. */
  litter?: string
  /** How coarse the patches are, in cells. */
  patch?: number
  /** A gradient's top and bottom, for a floor that changes down the map instead of in patches. */
  top?: string
  bottom?: string
  /** How many steps the gradient is quantised into, so it reads as bands rather than a smear. */
  steps?: number
}

const FLOOR_PATCH = 4

function paintFloor(ctx: ArchetypeContext, paint: FloorPaint): void {
  const { cols, rows, floorColors } = ctx
  if (paint.top && paint.bottom) {
    const steps = paint.steps ?? MEADOW_GRADIENT_STEPS
    forEachCell(cols, rows, (col, row) => {
      const t = clamp01(row / Math.max(1, rows - 1))
      floorColors[row][col] = lerpHex(paint.top!, paint.bottom!, Math.round(t * steps) / steps)
    })
    return
  }
  if (!paint.floor) return // the backend states no floor colour, so the tile keeps its own
  const alt = paint.floorAlt ?? paint.floor
  const litter = paint.litter ?? paint.floor
  const patch = paint.patch ?? FLOOR_PATCH
  forEachCell(cols, rows, (col, row) => {
    const n = shadeNoise(Math.floor(col / patch) * 1.7 + Math.floor(row / patch) * 2.3)
    floorColors[row][col] = n > 0.78 ? litter : n > 0.45 ? alt : paint.floor!
  })
}

/** A light gap is the only LIT ground on the map, paint it up off the canopy tone and dress it with whatever
 *  the generator serves for flowers, because a gap is where the saplings and blooms actually are. */
function paintJungleGaps(
  ctx: ArchetypeContext,
  gaps: Set<string>,
  pal: GeneratorPalette | undefined,
  zoneAt?: (GeneratorSubZone | undefined)[][],
): void {
  const lit = pal?.canopyAlt
  const flowers = ctx.nature?.flowers
  const plantable: Cell[] = []
  for (const key of gaps) {
    const { col, row } = toCell(key)
    if (!inBounds(col, row, ctx.cols, ctx.rows)) continue
    if (lit) ctx.floorColors[row][col] = lit // the LIGHT reaches every gap, blooms or not
    if (canPlantBloom(ctx, col, row)) plantable.push({ col, row })
  }
  if (flowers === undefined) return
  // The REGION standing here decides its own blooms; the season answers where a region states none. This is
  // where a swamp's daisies came from: a light gap is the only lit ground in a jungle, so it is where the
  // blooms are, and it had no idea which region it was in. Now they also come in patches and keep off the
  // boardwalks, which is where it found them growing out of the bridge wood.
  for (const cell of pickClustered(ctx, plantable, Math.min(1, flowers * 2), BLOOM_LATTICE)) {
    placeProp(ctx, makeFlower(ctx.rand, ctx.zone, cell.col, cell.row, zoneAt?.[cell.row]?.[cell.col]?.flowers))
  }
}

/**
 * THE CREEK, a watercourse running THROUGH the map, edge to opposite edge, not hugging the perimeter the
 * way the meadow's river does. That difference is the point: a meadow's river frames the view, a jungle's
 * creek is the thing you travel along, so it has to cross the middle.
 */
function carveJungleCreek(ctx: ArchetypeContext, pal: GeneratorPalette | undefined, wide: boolean): Set<string> {
  return carveChannel(ctx, pal, { half: JUNGLE.creekHalf * (wide ? 1.8 : 1), swing: 0.26 })
}

/**
 * RAISE A REGION, so a map has more than one level of ground.
 *
 * A region states its own `level` and every cell in it stands there. The step between two regions becomes a
 * CLIFF, drawn by `drawGridSkirt`, which keys on the elevation differing and never on the floor differing.
 * A region stating no level is flat, so nothing changes for a template that does not ask.
 */
function raiseRegions(ctx: ArchetypeContext, zoneAt: (GeneratorSubZone | undefined)[][]): void {
  forEachCell(ctx.cols, ctx.rows, (col, row) => {
    const level = zoneAt[row][col]?.level
    if (level) ctx.elevation[row][col] = level
  })
}

/**
 * HOW DEEP THIS MAP CUTS ITS CHANNEL, in levels, from the served `depth` option.
 *
 * A gated choice takes `none` when its dependency is off, so a map with no river, or one serving no depth at
 * all, is NOT CUT and reads exactly as it always did. That also keeps the other case honest: A puddle is not a
 * channel, so nothing digs it.
 */






/** An ANIMAL TRACK from a light gap to the water, one cell wide, wandering, and marked open rather than
 *  paved. A jungle has no roads; what it has is the line where the undergrowth happens to be thinnest. */
function traceJungleTrack(ctx: ArchetypeContext, from: Cell, to: Cell, open: Set<string>): void {
  const { cols, rows } = ctx
  let { col, row } = from
  let guard = cols + rows
  while ((col !== to.col || row !== to.row) && guard-- > 0) {
    // Step toward the target on whichever axis is further off, with a wobble, so the track reads as walked
    // rather than surveyed. The guard bounds it: a wobble must never turn into a loop.
    const dc = to.col - col
    const dr = to.row - row
    if (Math.abs(dc) > Math.abs(dr) ? ctx.rand() < 0.82 : ctx.rand() < 0.18) col += Math.sign(dc)
    else row += Math.sign(dr)
    // Widened to the same minimum every other route uses. An animal track is the narrowest thing on the
    // map and it still has to be walkable, which is the whole of the note.
    for (let oc = 0; oc < pathwayWidth(ctx); oc++) {
      for (let or_ = 0; or_ < pathwayWidth(ctx); or_++) {
        const c = col + oc
        const r = row + or_
        if (inBounds(c, r, cols, rows)) open.add(`${c},${r}`)
      }
    }
  }
}

/** UNDERGROWTH, the choked layer between the trunks, and the thing that actually makes a jungle hard to
 *  cross. Density is the served `groundCover`. It BLOCKS, unlike the woodland's ground dressing, which is
 *  the whole distinction: a wood's floor cover is decoration, a jungle's is an obstacle. */
function plantUndergrowth(
  ctx: ArchetypeContext,
  open: Set<string>,
  water: Set<string>,
  pal: GeneratorPalette | undefined,
  zoneAt?: (GeneratorSubZone | undefined)[][],
  /** Multiplier on the served density. 1 means "a share of the cells nothing else claimed", which is what a
   *  woodland wants. A jungle passes `jungleFloorReach` so its number means a share of the whole walkable
   *  floor instead. */
  reach = 1,
): void {
  const cover = ctx.nature?.groundCover
  if (cover === undefined) return
  const { cols, rows, collision, floorColors } = ctx

  // UNDERGROWTH GROWS IN MASSES, NOT AS PEPPER.
  //
  // Rolling per cell was the first version and it was wrong in a way only measurement showed: a 50% per-cell
  // chance turns the floor into swiss cheese, and since undergrowth BLOCKS, the walkable remainder came out
  // as hundreds of disconnected islands, 363 on one seed. Every fix downstream then made it worse. Carpeting
  // the islands filled the map with trees and flattened every formation to the same 0.97 clumping; cutting a
  // track to each one stripped the forest back to 47 trees.
  //
  // A thicket is contiguous. Scoring against the same coherent noise the canopy uses gives connected masses
  // with open ground between them, which is both what undergrowth looks like and what leaves the floor in one
  // piece. Same exact-coverage selection, so the served density is still hit precisely.
  const claimed = new Set<string>()
  for (const key of open) claimed.add(key)
  for (const key of water) claimed.add(key)
  forEachCell(cols, rows, (col, row) => {
    if (collision[row][col]) claimed.add(`${col},${row}`)
  })

  // Per REGION when the map has regions, so dense growth is choked and open canopy is not.
  const groups: Array<{ zone: GeneratorSubZone | undefined; mask: Set<string> }> = zoneAt
    ? uniqueZones(zoneAt).map(zone => ({ zone, mask: new Set([...claimed, ...cellsOutsideZone(ctx, zoneAt, zone)]) }))
    : [{ zone: undefined, mask: claimed }]

  for (const { zone, mask } of groups) {
    const formation = zone?.formation ?? ctx.formation
    const understory = formation?.understory ?? 1
    const density = clamp01(cover * (zone?.undergrowth ?? 1) * understory * reach)
    if (density <= 0) continue
    // A coarser lattice than the canopy's, so undergrowth reads as broad thickets rather than as a second
    // canopy stippled between the trunks.
    // WHICH PLANT the understory is made of is SERVED, per formation. Three of the five formations describe
    // a clear walkable floor in their own notes ("nothing between them", "a clear walkable floor", "clear
    // ground between the groups") and every one of them used to grow the blocking thicket regardless, so the
    // walkable floor those notes describe never existed.
    //
    // A REGION INHERITS ITS PARENT'S PLANT, the same way the generator tree deep-merges everything else. All
    // 19 served sub-zone formations state an `understory` number and none states a tile, so reading only the
    // region's own would have dropped a woodland's glades and its mountain vale straight back onto the
    // thicket. Absent at both levels falls back to `thicket`, so a generator that says nothing anywhere
    // behaves exactly as it did.
    const plant = formation?.understoryTile ?? ctx.formation?.understoryTile ?? 'thicket'
    const thicket = woodlandCanopyField(ctx, mask, density, { lattice: (formation?.lattice ?? DEFAULT_CANOPY_LATTICE) + 3 })
    for (const { col, row } of thicket) {
      // A THICKET stands here, and `placeProp` blocks the cell because the thicket blocks. Stamping collision
      // was the bug: it made a clover into a wall. If the cell cannot take the thicket (water, already blocked)
      // it stays exactly as it was rather than becoming an invisible obstacle.
      placeProp(ctx, makePlant(ctx, col, row, plant))
      if (pal?.undergrowth) floorColors[row][col] = pal.undergrowth
    }
  }
}

/** The distinct sub-zones actually present on a partition map. */
function uniqueZones(zoneAt: (GeneratorSubZone | undefined)[][]): Array<GeneratorSubZone | undefined> {
  const seen = new Set<GeneratorSubZone | undefined>()
  for (const row of zoneAt) for (const zone of row) seen.add(zone)
  return [...seen]
}

/** Every cell NOT in this region, as keys, the mask that confines a pass to one region. */
function cellsOutsideZone(ctx: ArchetypeContext, zoneAt: (GeneratorSubZone | undefined)[][], zone: GeneratorSubZone | undefined): string[] {
  const out: string[] = []
  forEachCell(ctx.cols, ctx.rows, (col, row) => {
    if (zoneAt[row][col] !== zone) out.push(`${col},${row}`)
  })
  return out
}

/** EMERGENTS, the handful of giants standing clear above the canopy, the tallest thing in an Amazon frame.
 *  They are the existing `tree_tall` shape, chosen rather than rolled: a tree anchor already has a vocabulary
 *  for "this one is tall", so an emergent is that, not a new field the stamper would have to learn. */
function plantEmergents(ctx: ArchetypeContext, open: Set<string>, water: Set<string>): void {
  const { cols, rows, collision, trees } = ctx
  const wanted = Math.max(1, Math.round((cols * rows / 1000) * JUNGLE.emergentsPerThousand))
  for (let i = 0; i < wanted; i++) {
    const col = randIntWith(ctx.rand, 2, Math.max(2, cols - 3))
    const row = randIntWith(ctx.rand, 2, Math.max(2, rows - 3))
    const key = `${col},${row}`
    if (open.has(key) || water.has(key)) continue
    plantTree(ctx, { col, row, kind: 'tree_giant', variant: massVariant(col, row) })
    collision[row][col] = true
  }
}

/**
 * The nearest point on the map edge to a cell, where a trail leaves the forest.
 *
 * Nearest rather than random so the spur is short: a trail crossing the whole map to reach a far edge would
 * cut the woodland in half, which is the opposite of what a forest with a road through it should look like.
 */
function nearestEdgeCell(from: Cell, cols: number, rows: number): Cell {
  const options: ReadonlyArray<readonly [number, Cell]> = [
    [from.row, { col: from.col, row: 0 }],
    [rows - 1 - from.row, { col: from.col, row: rows - 1 }],
    [from.col, { col: 0, row: from.row }],
    [cols - 1 - from.col, { col: cols - 1, row: from.row }],
  ]
  return options.reduce((best, next) => (next[0] < best[0] ? next : best))[1]
}

/** A ragged disc of open ground: the radius wobbles per cell, so a clearing's edge reads as natural rather than
 *  as a circle someone drew. */
function carveClearing(ctx: ArchetypeContext, centre: Cell, open: Set<string>): void {
  const { cols, rows } = ctx
  const radius = randIntWith(ctx.rand, WOODLAND.clearingRadius[0], WOODLAND.clearingRadius[1])
  for (let r = centre.row - radius - 1; r <= centre.row + radius + 1; r++) {
    for (let c = centre.col - radius - 1; c <= centre.col + radius + 1; c++) {
      if (!inBounds(c, r, cols, rows)) continue
      const d = Math.hypot(c - centre.col, r - centre.row)
      if (d <= radius - 0.5 + ctx.rand()) open.add(`${c},${r}`)
    }
  }
}

/**
 * Cut a walkable path between two clearings, clearing canopy as it goes.
 *
 * An L with a wobble rather than a straight line: a forest track bends. It walks the column first or the
 * row first at random, so a map does not read as a grid of right angles all turning the same way.
 */
function carveWoodlandPath(ctx: ArchetypeContext, from: Cell, to: Cell, open: Set<string>, trailCells: Set<string>): void {
  const { cols, rows } = ctx
  const colFirst = ctx.rand() < 0.5
  const width = pathwayWidth(ctx)
  const widen = (c: number, r: number) => {
    for (let dr = 0; dr < width; dr++) {
      for (let dc = 0; dc < width; dc++) {
        if (!inBounds(c + dc, r + dr, cols, rows)) continue
        open.add(`${c + dc},${r + dr}`)
        trailCells.add(`${c + dc},${r + dr}`)
      }
    }
  }
  const step = (a: number, b: number) => (a < b ? 1 : -1)
  let { col, row } = from
  const walkCols = () => { while (col !== to.col) { col += step(col, to.col); widen(col, row) } }
  const walkRows = () => { while (row !== to.row) { row += step(row, to.row); widen(col, row) } }
  if (colFirst) { walkCols(); walkRows() } else { walkRows(); walkCols() }
}

/** Lattice spacing for the canopy noise, in cells. Larger = broader stands; 4 gives tree masses a few
 *  cells across, which is what reads as woodland rather than as hedges. */
const DEFAULT_CANOPY_LATTICE = 4

/**
 * Which cells get a tree: exactly `canopy` of the plantable ones, chosen so they clump.
 *
 * Value noise on a coarse lattice, bilinearly interpolated, then the lowest-scoring cells taken. The two
 * properties that matter both fall out of that:
 *
 *  · **Exact coverage.** Taking the lowest N is a selection, not a probability, so a served 0.42 plants
 *    42% of the forest floor every time, no drift from thinning or overlap.
 *  · **Coherence.** Neighbouring cells interpolate from the same lattice corners, so they score alike and
 *    are taken or skipped together. That is what makes a stand a stand.
 *
 * The share is of the PLANTABLE floor, not of the whole grid: a clearing is not somewhere a tree failed to
 * grow, so counting clearings in the denominator would make the density mean less the more clearings a map
 * happened to roll.
 */
function woodlandCanopyField(ctx: ArchetypeContext, open: Set<string>, canopy: number, formation?: GeneratorFormation): Cell[] {
  const { cols, rows, collision } = ctx
  // THE GROUPING. A small lattice scores every few cells differently, so trees land as fine scatter
  // (reference image #10, a wood pasture); a large one makes neighbours score alike, so they land as continuous
  // masses (image #14, a closed canopy). Same density, completely different forest.
  const CANOPY_LATTICE = Math.max(1, Math.round(formation?.lattice ?? DEFAULT_CANOPY_LATTICE))
  // The lattice, one random value per corner, drawn from the layer rng so a seed reproduces the forest.
  const latticeCols = Math.ceil(cols / CANOPY_LATTICE) + 2
  const latticeRows = Math.ceil(rows / CANOPY_LATTICE) + 2
  const corner: number[][] = []
  for (let r = 0; r < latticeRows; r++) {
    const line: number[] = []
    for (let c = 0; c < latticeCols; c++) line.push(ctx.rand())
    corner.push(line)
  }
  const smooth = (t: number) => t * t * (3 - 2 * t) // ease the interpolation so lattice lines do not show
  const noiseAt = (col: number, row: number): number => {
    const gc = col / CANOPY_LATTICE
    const gr = row / CANOPY_LATTICE
    const c0 = Math.floor(gc)
    const r0 = Math.floor(gr)
    const tx = smooth(gc - c0)
    const ty = smooth(gr - r0)
    const a = corner[r0][c0] + (corner[r0][c0 + 1] - corner[r0][c0]) * tx
    const b = corner[r0 + 1][c0] + (corner[r0 + 1][c0 + 1] - corner[r0 + 1][c0]) * tx
    return a + (b - a) * ty
  }

  const scored: { col: number; row: number; n: number }[] = []
  for (let row = 1; row < rows - 1; row++) {
    for (let col = 1; col < cols - 1; col++) {
      if (open.has(`${col},${row}`) || collision[row][col]) continue
      // NOT IN WATER, said out loud instead of relied upon.
      //
      // This used to exclude a pool only because a pool happened to be BLOCKED. The moment a pool at ground
      // level stopped blocking (the ), canopy started planting on the water: measured 23 to 209 trees standing in
      // pools
      // across eight seeds, and their trunks took the cells the ruin's rubble needed, so a seeded ruin lost
      // its fallen blocks.
      //
      // Collision says whether you can WALK there. It is not a description of what is in the cell, and using
      // it as one is why this broke. Every sibling guard here already asks the ground directly.
      if (isWaterGround(ctx.ground[row][col])) continue
      // …NOR IN A PUDDLE. A pool is a film stacked over dry ground now, so the ground label no longer says
      // "wet" and a tree would happily root in one. `ctx.wet` is that fact.
      if (ctx.wet.has(`${col},${row}`)) continue
      scored.push({ col, row, n: noiseAt(col, row) })
    }
  }
  const target = Math.round(scored.length * Math.max(0, Math.min(1, canopy)))
  scored.sort((a, b) => a.n - b.n)

  // SPACING. With no minimum gap the lowest-scoring cells sit shoulder to shoulder and the stand reads as a
  // solid wall, which is right for a closed canopy (reference image #14) and wrong for everything else. A gap of
  // 3 forces the open, individually-readable spacing of a wood pasture (image #10) at the SAME density, // the trees spread out to find room rather than there being fewer of them.
  // SPACING 1 IS A TRAP and the served formations avoid it. Claiming only the four orthogonal neighbours
  // leaves every second cell free, which is a CHECKERBOARD: passable diagonally (how you move in the iso
  // view) and not orthogonally (how you move in top view), so the floor measures as hundreds of separate
  // regions and the repair then has to cut its way through the whole wood. 0 means a mass, 2+ means readable
  // individuals; 1 means a pattern no forest has.
  const gap = Math.max(0, Math.round(formation?.spacing ?? 0))
  if (gap <= 0) return scored.slice(0, target).map(({ col, row }) => ({ col, row }))

  const taken: Cell[] = []
  const claimed = new Set<string>()
  for (const cell of scored) {
    if (taken.length >= target) break
    if (claimed.has(`${cell.col},${cell.row}`)) continue
    taken.push({ col: cell.col, row: cell.row })
    // Claim the disc around it, so nothing else plants inside the gap.
    for (let dr = -gap; dr <= gap; dr++) {
      for (let dc = -gap; dc <= gap; dc++) {
        if (Math.hypot(dc, dr) <= gap) claimed.add(`${cell.col + dc},${cell.row + dr}`)
      }
    }
  }
  return taken
}

/**
 * Scatter the generator's ground cover and flowers across the CLEARINGS only.
 *
 * Both densities come from the backend and both go through the existing prop seams, `makeFlower` and
 * `makeGroundDecor`, so a woodland's dressing is the same data-driven, per-zone, baked-image path the
 * meadow and the town use. `makeGroundDecor` returns null when the loaded tileset carries no decor for
 * the zone; that cell is then simply bare, which is the correct answer to missing data.
 */
function dressWoodlandClearings(
  ctx: ArchetypeContext,
  open: Set<string>,
  zoneAt?: (GeneratorSubZone | undefined)[][],
): void {
  const cover = ctx.nature?.groundCover
  const flowers = ctx.nature?.flowers
  if (cover === undefined && flowers === undefined) return

  // BLOOMS COME IN PATCHES, and never on a way. Every candidate is scored on one coarse lattice and the
  // lowest-scoring share is planted, so a clearing gets beds of flowers rather than an even dusting of them.
  const plantable: Cell[] = []
  for (const key of open) {
    const [c, r] = key.split(',').map(Number)
    if (canPlantBloom(ctx, c, r)) plantable.push({ col: c, row: r })
  }
  const bloomAt = new Set<string>()
  if (flowers !== undefined) {
    for (const cell of pickClustered(ctx, plantable, flowers, BLOOM_LATTICE)) {
      // A clearing's blooms belong to the REGION it sits in, the same rule the jungle's gaps follow.
      placeProp(ctx, makeFlower(ctx.rand, ctx.zone, cell.col, cell.row, zoneAt?.[cell.row]?.[cell.col]?.flowers))
      bloomAt.add(`${cell.col},${cell.row}`)
    }
  }

  // Ground cover stays an even scatter: it is texture underfoot, not an arrangement, and it has never
  // complained about it. It simply keeps off the pathways and out from under the blooms.
  if (cover === undefined) return
  for (const cell of plantable) {
    if (bloomAt.has(`${cell.col},${cell.row}`)) continue
    if (ctx.rand() >= cover) continue
    const decor = makeGroundDecor(ctx.zone, cell.col, cell.row)
    if (decor) placeProp(ctx, decor)
  }
}

// ── 'meadow' + 'meadow_river' layouts (references #14 / #17) ──────────────────
// An OPEN muted-olive clearing framed by a dense tree BORDER, with EXACTLY TWO cobblestone entrances on
// the near (bottom) edge, a loose grid of ornament ZONES (flower / grass / rock-earth patches, "not
// everything is green"), a season floor-colour GRADIENT written as per-cell STATE ("a gradient
// of greens to yellows based on the season"), and, the river variant, a perimeter WATER ring broken only
// at the entrances, with a stone BRIDGE crossing it.
//
// the model: grass + water are a COLOUR on a flat floor tile, TILES are spent only on ORNAMENTS
// (flowers, rocks) + highlights (the bridge). So the whole floor is the flat 'meadow' tile tinted per-cell
// (grass / earth / cobble) or the flat 'water' tile tinted river-blue, both carry a real block HEIGHT, so
// terrain reads as a raised block and every ornament STACKS on top of it (no 0-height tiles emitted).

/** Per-season meadow floor palette: the gradient endpoints (top/light → bottom/dark, an olive greens→
 *  yellows) plus the earth / grass patch tints, the cobblestone entrance tone, and the river + bank
 *  colours, every colour the meadow layouts write as floor STATE. Muted olive around the @meadow_color
 *  #a4ac48 base (sampled from #14/#17). Open/Closed: add a season → add a row. */
interface MeadowPalette {
  top: string; bottom: string; grass: string; earth: string; cobble: string; river: string; bank: string; plot: string
}
const MEADOW_PALETTES: Readonly<Record<ZoneId, MeadowPalette>> = {
  summer: { top: '#b4c05a', bottom: '#8ba341', grass: '#7f9b39', earth: '#b39a72', cobble: '#b7a488', river: '#4f93b3', bank: '#c1a877', plot: '#c6cb92' },
  spring: { top: '#b0c85f', bottom: '#8fb14c', grass: '#7cae44', earth: '#b69c78', cobble: '#bcac90', river: '#57a1bd', bank: '#c8b07d', plot: '#c8cf94' },
  autumn: { top: '#bba750', bottom: '#8f7d38', grass: '#93813a', earth: '#a5875c', cobble: '#b39d82', river: '#4d8aa2', bank: '#b8996e', plot: '#cbbd84' },
  winter: { top: '#ccd6cf', bottom: '#aabbb6', grass: '#b2c1bc', earth: '#8d887e', cobble: '#c1c4bf', river: '#7cb8d8', bank: '#c9ccc5', plot: '#dde4de' },
  desert: { top: '#cabf6c', bottom: '#aea050', grass: '#bcb35c', earth: '#b07f4a', cobble: '#c8b48a', river: '#5aa6b4', bank: '#d3ba80', plot: '#dbd29a' },
  beach: { top: '#c2c86a', bottom: '#a3b24e', grass: '#9fb84a', earth: '#c2a466', cobble: '#cbbf9a', river: '#4bb0c2', bank: '#dcc78e', plot: '#d6da9c' },
  lava: { top: '#8a7f4a', bottom: '#6e5f38', grass: '#726838', earth: '#7a4f3a', cobble: '#8a7d6a', river: '#a25a2a', bank: '#8a5a3a', plot: '#9c916a' },
}

const MEADOW_GRADIENT_STEPS = 7   // coarse ROW gradient bands, few colour breaks + horizontally UNIFORM so compressGround merges each row into ONE run (FPS)
const MEADOW_PATCH = 7            // coarse garden-PATCH size, a tended-field patchwork painted as large uniform regions (merges), not per-cell grid lines
const MEADOW_RIVER_INSET = 5      // river-channel centreline inset from the 3 active edges (top / left / right)
const MEADOW_RIVER_HALF = 1.9     // channel half-width → a ~4-wide winding river (organic, wobbled per position)
const MEADOW_OUTER_BAND = 4       // outer LAND strip depth beyond the river where the sparse framing trees clump
const MEADOW_ENTRANCE_RUN = 11    // how far the cobble path + flower beds reach in from the near edge
const MEADOW_ENTRANCE_FRAC = 0.30 // the single entrance sits left-of-centre on the near (bottom) edge (#24)
const MEADOW_MAX_POCKET = 12      // repair fills only floor pockets ≤ this; the larger land strip beyond the river is kept

/** clamp to [0,1]. */
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
/** Parse #rrggbb → [r,g,b]. */
function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
/** Linear blend of two #rrggbb colours at t∈[0,1] → #rrggbb. Pure. */
function lerpHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexRgb(a)
  const [br, bg, bb] = hexRgb(b)
  const mix = (x: number, y: number): number => Math.round(x + (y - x) * t)
  return `#${[mix(ar, br), mix(ag, bg), mix(ab, bb)].map(v => v.toString(16).padStart(2, '0')).join('')}`
}

/** `meadow_pass` (#26): the open meadow opened on TWO opposite edges (top + bottom), a through-route you can
 *  enter one side and exit the other, distinct from the single-entrance `meadow`. No river. */
/** The meadow's water, bank and deck tones. The WATER comes from the served palette when the template states
 *  one (it does, by depth); the bank and deck keep the meadow's own seasonal tones, which is what they always wore. */
function meadowWater(ctx: ArchetypeContext): GeneratorPalette {
  const pal = MEADOW_PALETTES[ctx.zone] ?? MEADOW_PALETTES.summer
  return {
    water: ctx.palette?.water ?? pal.river,
    waterShallow: ctx.palette?.waterShallow,
    waterDeep: ctx.palette?.waterDeep,
    swamp: ctx.palette?.swamp,
    bank: pal.bank,
    trail: pal.cobble,
  }
}

// THE CURRENT LIVES IN `riverNetwork.ts` NOW. That was right that we did not: 56 water functions
// in this one 5,775-line file. The flow field is the first piece out, and it took its 193 lines with it.


// THE BANKS STAY WITH THEIR LAYOUTS, for now, and it is worth saying why. Moving them to `riverNetwork`
// looked obvious until it was tried: `paintRiverBanks` reads the MEADOW's palette and `jungleBanks` reads
// `JUNGLE.bankDepth`. They are not the river's bank, they are the meadow's and the jungle's, which is
// exactly the kind of thing that makes a seam meaningless if you drag it across anyway. They move when a
// bank width and tone are SERVED, like every other template fact.

/** Sandy BANK highlight on the land cells orthogonally touching the river, the shoreline in #17. */
function paintRiverBanks(ctx: ArchetypeContext, water: Set<string>, pal: MeadowPalette): void {
  const { cols, rows, ground, collision, floorColors } = ctx
  water.forEach(key => {
    const { col, row } = toCell(key)
    for (const [dc, dr] of ORTHO) {
      const c = col + dc
      const r = row + dr
      if (!inBounds(c, r, cols, rows) || isEdge(c, r, cols, rows)) continue
      if (water.has(`${c},${r}`) || collision[r][c] || ground[r][c] !== 'meadow') continue
      floorColors[r][c] = pal.bank
    }
  })
}


/** The walkable BANK either side of the creek, this is the route through a jungle, so it is cleared to a
 *  real width rather than being a one-cell shoreline tint. Returns the bank cells for the open mask. */
function jungleBanks(ctx: ArchetypeContext, water: Set<string>, pal: GeneratorPalette | undefined): Set<string> {
  const { cols, rows, collision, floorColors } = ctx
  const banks = new Set<string>()
  for (const key of water) {
    const { col, row } = toCell(key)
    for (let dr = -JUNGLE.bankDepth; dr <= JUNGLE.bankDepth; dr++) {
      for (let dc = -JUNGLE.bankDepth; dc <= JUNGLE.bankDepth; dc++) {
        const c = col + dc
        const r = row + dr
        if (!inBounds(c, r, cols, rows) || water.has(`${c},${r}`)) continue
        if (Math.hypot(dc, dr) > JUNGLE.bankDepth) continue
        banks.add(`${c},${r}`)
        collision[r][c] = false
        if (pal?.bank) floorColors[r][c] = pal.bank
      }
    }
  }
  return banks
}








/** THE meadow builder, `meadow` (one bottom way, no river), `meadow_river` (one way + perimeter river) and
 *  `meadow_pass` (two opposite pathways, no river). LAYOUT-FIRST: flat floor + season gradient → (river) carve the
 *  perimeter water → sparse framing trees → pave the cobble way(s) → populate the open centre with ornament
 *  zones → keep the floor one region → (river) drop the stone bridge last so the repair can't fill it. */
/**
 * THE MEADOW, IN PHASES, one per layer.
 *
 * It was one function that painted, carved, planted and paved in a single pass. The four below are that same
 * sequence cut at the layer boundaries, with two things that follow from the cut rather than from taste:
 *
 *   · the ORNAMENTS AND TREES now run AFTER the pathways, so they see the pathways and go round them. They used to
 *     run before, and a sweep afterwards pulled the ones that landed in the road back out. `standsOnPathway`
 *     makes that a guard at the moment of placing instead of a repair.
 *   · the RIVER is carved in its own phase before the pathways are drawn, which is the order he asked for:
 *     *"we should have water go first, because then the pathway can footprint the actual navigable layout"*.
 */
function meadowPhases(twoPathways: boolean): VariantPhases {
  return {
    terrain: ctx => {
      floodMeadowFloor(ctx) // flat 'meadow' tile everywhere (a raised, tintable block)
      // ITS OWN PALETTE STILL, because the backend serves a meadow no `palette.floor` to paint from. A
      // gradient is what the meadow has always had; where the tones come from is a data gap, not a code one.
      const meadowPal = MEADOW_PALETTES[ctx.zone] ?? MEADOW_PALETTES.summer
      paintFloor(ctx, { top: meadowPal.top, bottom: meadowPal.bottom })

      // AND ITS REGIONS, which it served and never used. `partitionSubZones` was called by the jungle, then
      // by the woodland when the same gap was found there, and the meadow was left out of both passes: its
      // five sub-zones were parsed, carried on the context and never asked for. A tree reads its region in
      // `leafToneAt`, so with no partition every meadow tree could only ever wear one of the four season
      // shades. Measured in summer, every other biome renders 16 to 20 distinct leaf tones and the meadow
      // rendered FOUR, which is the exact inverse of what its own reference says it is: *"more mix of colors,
      // due to flowers, they even have trees that are orange, pink, more varied"*.
      //
      // The gradient above survives a region that states no tone of its own, which every meadow region does
      // today, so nothing here paints over the approved look. A region that DOES state one means to.
      shapeRegions(ctx)
    },

    water: ctx => {
      const pal = meadowWater(ctx)
      const course = riverCourse(ctx, 'around')
      for (const key of course ? carveRiver(ctx, course, pal) : []) ctx.water.add(key)
      // A `bank` region asks for 12% standing water and this builder had no pool pass, so a bank banked
      // nothing.
      floodRegionPools(ctx, pal)
    },

    pathways: ctx => {
      // The cobble pathways ARE this layout's path network, so they are what a crossing joins to. They land in
      // `ctx.pathwayCells`, which is what every later phase reads to keep off them.
      const routes = ctx.pathwayCells
      if (ctx.routes) {
        // THE GATES ARE THE WAYS. Every one gets a cobble way off its own edge that joins the middle. The
        // lamps and flower beds stay on the way you come IN and on a far-edge way out, because that is where
        // they read as a gateway rather than as scenery.
        paveMeadowRoutes(ctx, ctx.routes, ctx.water, routes)
        paintMeadowGateways(ctx, ctx.routes, ctx.water, routes)
        return
      }
      if (twoPathways) {
        paintMeadowEntrance(ctx, ctx.water, routes, false, 0.5) // near (bottom) cobble way in
        paintMeadowEntrance(ctx, ctx.water, routes, true, 0.5) // and the far one out, aligned, a through-route
        return
      }
      paintMeadowEntrance(ctx, ctx.water, routes) // ONE bottom-left cobble entrance, lamps and flower beds
    },

    objects: ctx => {
      paintMeadowPlots(ctx, ctx.water) // faint tended-field patchwork, a subtle colour
      scatterMeadowOrnaments(ctx, ctx.water) // dirt patches, field stones, tiny flowers, mostly open
      scatterFramingTrees(ctx, ctx.water) // sparse clumps beyond the river and near the bottom corners
      scatterTallGrass(ctx) // walkable long grass, as much as the generator serves
      repairFloorConnectivity(ctx, MEADOW_MAX_POCKET) // fill only TINY stranded pockets
      const course = riverCourse(ctx, 'around')
      // A BRIDGE IS AN OBJECT, and it is the first thing the objects phase owes the pathways: *"if you want to
      // put actual tiles or objects specifically related to pathways, like a bridge to go over a river ...
      // it'll still happen at the end of the process and can be the start of the objects phase"*. After the
      // repair, so the deck is never filled back in.
      if (course) bridgeRiver(ctx, flowingWater(ctx), ctx.pathwayCells, course, meadowWater(ctx))
      strewRegionRuins(ctx) // the stone a region asks for, after the planting
      dropDrownedFilms(ctx) // a puddle under a trunk is not a puddle
      settleWaterDepth(ctx, molten(ctx, meadowWater(ctx)), ctx.pools, ctx.still) // last, once the bridge is down
    },
  }
}

/** Get across the river. With the crossing option on, the span is placed against the path network and paved
 *  back to it (ticket 36); with it off, the plain fixed-column bridge. Either way the map stays ONE place, *  an uncrossable river is two maps, which is never what anyone asked for. */
function crossRiver(ctx: ArchetypeContext, water: Set<string>, routes: Set<string>, joined: boolean): void {
  if (joined && placeRiverCrossing(ctx, water, routes)) return
  placeMeadowBridge(ctx, water)
}

/** Flat 'meadow' floor tile in every cell, a raised, colour-tintable block (its per-cell colour is
 *  written by the floor paint). Overrides the season default so the floor is always the flat tile. */
function floodMeadowFloor(ctx: ArchetypeContext): void {
  forEachCell(ctx.cols, ctx.rows, (col, row) => { ctx.ground[row][col] = 'meadow' })
}

/** Write the season floor-colour GRADIENT as per-cell STATE: a top→bottom olive greens→yellows ramp, quantised
 *  to a handful of ROW BANDS and HORIZONTALLY UNIFORM (no per-column lean). Every cell in a band-row is the
 *  SAME colour, so compressGround merges each row into ONE z-width run, the perf fix (the old col*0.3 diagonal
 *  changed the colour every few columns, so a row broke into ~11 un-mergeable pieces and FPS tanked). The
 *  season top→bottom ramp look is kept; only the subtle diagonal shading is dropped for large mergeable runs. */

/** Paint the WINDING river (river variant): a meandering channel hugging THREE sides, the TOP, LEFT and
 *  RIGHT edges, set in from the edge by a wobbling inset, leaving the NEAR (bottom) edge OPEN for the
 *  entrance and a thin LAND strip BEYOND it (between river and edge) for the framing trees. It is NOT a
 *  4-sided perimeter ring: the channel runs along a centreline inset from the nearest active edge, so it
 *  reads as a river enclosing the meadow on ~3 sides (#24), not a moat. Water cells take the river colour +
 *  BLOCK (the water tile's own collision setting); the land just inside gets a sandy BANK highlight. Returns
 *  the water cell-key set. */
function paintMeadowRiver(ctx: ArchetypeContext): Set<string> {
  const { cols, rows, ground, collision, floorColors } = ctx
  const pal = MEADOW_PALETTES[ctx.zone] ?? MEADOW_PALETTES.summer
  const phase = ctx.rand() * Math.PI * 2
  const phase2 = ctx.rand() * Math.PI * 2
  const water = new Set<string>()
  // The channel centreline meanders along whichever active edge is nearest, parameterised by the coordinate
  // that runs ALONG that edge (col on the top, row on the sides) so the wobble is coherent, not per-cell noise.
  // The outward swing is CLAMPED so the channel never reaches the map edge. Unclamped, the wobble brushed the
  // edge on some seeds and cut the land OUTSIDE the river into pieces only water separated, measured on an
  // around-river woodland, 3 seeds in 6 then needed extra logs to reach them, which is not a river that runs
  // around the edge. Clamped, the strip outside stays one continuous piece and its one bridge reaches all of
  // it. Draw order is unchanged, so the phases, and everything after them, are too.
  const centreInset = (along: number): number =>
    Math.max(MEADOW_RIVER_HALF + 3, MEADOW_RIVER_INSET + 2.4 * Math.sin(along * 0.23 + phase) + 1.2 * Math.sin(along * 0.11 + phase2))
  forEachCell(cols, rows, (col, row) => {
    const dTop = row
    const dLeft = col
    const dRight = cols - 1 - col
    const d = Math.min(dTop, dLeft, dRight) // nearest of the THREE active edges (bottom excluded → open near edge)
    if (d > MEADOW_RIVER_INSET + MEADOW_RIVER_HALF + 2) return // deep interior → no river
    const along = d === dTop ? col : row
    if (Math.abs(d - centreInset(along)) > MEADOW_RIVER_HALF) return // outside the channel band → land
    ground[row][col] = 'water'
    collision[row][col] = true // water BLOCKS
    // THE ONE TONE, flat. This quantised a ripple shade over ~3x3 patches, which is still a colour lottery
    // across one river:
    //
    // The old comment defended the patches on FPS grounds, because `compressGround` merges only floors sharing
    // a tile AND a colour. A FLAT colour merges strictly better than patches do, so the performance argument
    // points the same way as the look: one river, one run.
    floorColors[row][col] = pal.river
    water.add(`${col},${row}`)
  })
  paintRiverBanks(ctx, water, pal)
  return water
}


/** SPARSE framing trees: natural CLUMPS in the outer LAND band beyond the river (hugging the top / left /
 *  right edges, where the river variant leaves a thin strip) plus a few near the bottom corners. The trees
 *  are BEYOND the river, framing the open meadow, NOT a dense wall ringing it (the #22 mistake). Blue-noise
 *  spaced; never in the river. For the no-river `meadow` this same band gives the loose treeline of #14. */
/** A meadow region this wooded stops being framing and becomes a stand of its own, so it grows in the middle
 *  of the map as well as round the rim. An orchard and a hedgerow are both above it; a pasture is not. */
const MEADOW_WOODED_REGION = 0.55

function scatterFramingTrees(ctx: ArchetypeContext, water: Set<string>): void {
  const { cols, rows, collision } = ctx
  const placed: Cell[] = []
  const attempts = Math.floor(cols * rows * 0.7)
  for (let i = 0; i < attempts; i++) {
    const col = randIntWith(ctx.rand, 1, cols - 2)
    const row = randIntWith(ctx.rand, 1, rows - 2)
    if (water.has(`${col},${row}`) || collision[row][col]) continue
    const dTop = row
    const dLeft = col
    const dRight = cols - 1 - col
    const dBottom = rows - 1 - row
    const d3 = Math.min(dTop, dLeft, dRight) // nearest of the three FRAMED edges
    const bottomCorner = dBottom <= 3 && Math.min(dLeft, dRight) <= 6
    // THE REGION DECIDES HOW WOODED IT IS, and where it is wooded enough the trees leave the frame.
    //
    // This placed by POSITION only: a band round three edges, and the centre kept clear whatever grew there.
    // So a meadow's `orchard` at canopy 0.9 and its `pasture` at 0.1 came out with the same trees, and its
    // five regions measured as one place. A region that states no canopy is framed exactly as before.
    const green = ctx.zoneAt?.[row]?.[col]?.canopy
    const framed = d3 <= MEADOW_OUTER_BAND + 2 || bottomCorner
    if (!framed && (green ?? 0) < MEADOW_WOODED_REGION) continue // the open centre stays open, unless a region is a wood
    if (ctx.rand() > (bottomCorner ? 0.3 : 0.42) * (green ?? 1)) continue
    // HOW FAR APART THIS REGION PLANTS THEM, which is the knob that actually decides a meadow's density.
    //
    // A fixed spacing of 2 saturates: past a certain probability every extra attempt is refused by the gap
    // rule, so a region at canopy 0.1 and one at 0.9 came out with the same trees (measured 0.21 against
    // 0.24). `spacing` is served per region and means exactly this, and it is what makes an ORCHARD read as
    // planted rows and a PASTURE as a field with the odd tree in it.
    const apart = ctx.zoneAt?.[row]?.[col]?.formation?.spacing ?? 2
    if (placed.some(p => Math.abs(p.col - col) < apart && Math.abs(p.row - row) < apart)) continue
    stampMeadowClump(ctx, col, row, water, bottomCorner)
    placed.push({ col, row })
  }
}

/** Stamp a small tree CLUMP (1-3 trees) around an anchor so the treeline reads as natural groups, not evenly
 *  sprinkled dots. Bottom-corner clumps lean to the tall shape (a conifer silhouette, per #24). Never on water. */
function stampMeadowClump(ctx: ArchetypeContext, col: number, row: number, water: Set<string>, tall: boolean): void {
  const spots: ReadonlyArray<readonly [number, number]> = [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1]]
  const n = 1 + randIntWith(ctx.rand, 0, 1)
  let done = 0
  for (const [dc, dr] of spots) {
    if (done >= n) break
    const c = col + dc
    const r = row + dr
    if (!inBounds(c, r, ctx.cols, ctx.rows) || isEdge(c, r, ctx.cols, ctx.rows)) continue
    if (water.has(`${c},${r}`) || ctx.collision[r][c]) continue
    stampMeadowTree(ctx, c, r, tall)
    done++
  }
}

/** Record ONE meadow tree anchor (like stampTree), a random living shape (a tall conifer for corner clumps),
 *  a canopy tone, blocking only its trunk cell. Mostly living so the meadow reads green; a HARSH season
 *  sprinkles a little dead wood. */
const HARSH_ZONES: ReadonlySet<ZoneId> = new Set<ZoneId>(['autumn', 'winter', 'lava'])
function stampMeadowTree(ctx: ArchetypeContext, col: number, row: number, tall: boolean): void {
  const { zone, trees, collision } = ctx
  if (!isLandCell(ctx, col, row)) return // land-only: no tree in water
  if (standsOnPathway(ctx, col, row)) return // and no tree in a road
  const variant = randIntWith(ctx.rand, 0, canopyCount(styleCatalog('ascii'), zone) - 1)
  // The green/verdant reference meadows show NO bare snags, only a HARSH season sprinkles a little dead wood.
  const dead = HARSH_ZONES.has(zone) && ctx.rand() < DEAD_TREE_CHANCE[zone] * 0.4
  const kind: LivingTreeKind | 'tree_dead' = dead ? 'tree_dead' : tall ? 'tree_tall' : pickLivingTree(ctx.rand(), speciesAt(ctx, col, row))
  plantTree(ctx, { col, row, kind, variant })
  collision[row][col] = true
}

/** The planned network as a cobble way across the meadow: cleared of whatever the framing and ornament passes
 *  dropped on it, then painted the cobble tone on the flat meadow floor: a COLOUR, not a tile, like every other
 *  way in this layout paves. */
function paveMeadowRoutes(ctx: ArchetypeContext, plan: RoutePlan, water: Set<string>, routes: Set<string>): void {
  const tone = wayTone(ctx) ?? (MEADOW_PALETTES[ctx.zone] ?? MEADOW_PALETTES.summer).cobble
  const lane = new Set<string>()
  for (const key of plan.cells) if (!water.has(key)) lane.add(key)
  // CLEARING AND CLAIMING ALWAYS HAPPEN. A way has to be clear of what was planted on it and has to be
  // claimed so nothing plants there later, whoever ends up painting the surface.
  clearMeadowCells(ctx, lane)
  for (const key of lane) routes.add(key)
  // THE SURFACE ONLY WHEN NOBODY ELSE IS LAYING ONE, the same guard the woodland's trail already uses.
  //
  // `layPathways` runs straight after this and paints the template's SERVED surface over these very cells, so
  // laying the meadow's own flat floor and seasonal cobble first was the same way drawn twice, with the
  // template's version landing on top. This is the last of the three private pavers that stood beside the
  // shared pathway layer; the woodland's and the jungle's are already gone.
  //
  // A template serving no surface still gets its cobble, which is what keeps a plain meadow looking like a
  // meadow rather than losing its way entirely.
  if (!ctx.pathway?.surface) {
    for (const key of lane) {
      const { col, row } = toCell(key)
      if (!inBounds(col, row, ctx.cols, ctx.rows)) continue
      ctx.ground[row][col] = 'meadow'
    }
    tintCells(ctx, lane, tone)
  }
  deckRoutes(ctx, plan, water, tone)
}

/** Pave the ONE bottom-left entrance LANE with cobblestone (the flat 'meadow' floor tinted the cobble tone, *  a colour, not a tile) from the near edge inward, lined with colourful flower beds + lamp posts (the lit
 *  cobble way in #24). Clears any framing tree/prop off the lane first, so the way in is always a clean
 *  opening. */
/** The meadow's pathways out: its cobble lane, its beds, its lamps, on whichever edge each gate sits. */
function paintMeadowGateways(ctx: ArchetypeContext, plan: RoutePlan, water: ReadonlySet<string>, routes: Set<string>): void {
  // THE WAY'S OWN TONE, not the season's cobble. A gateway is the way continuing to the border, and these
  // two painted a different material from the way they open onto: measured, a meadow wore its park path
  // across the middle and seasonal cobble for the last eleven cells at every gate.
  const pal = MEADOW_PALETTES[ctx.zone] ?? MEADOW_PALETTES.summer
  paintGateways(ctx, plan, water, routes, { ground: 'meadow', paving: wayTone(ctx) ?? pal.cobble, flank: bedsAndLamps })
}

/**
 * The meadow's one way out when it planned no routes, cut here the way `gateOn` cuts a planned one: the
 * SERVED width, centred, on the near edge. It used to hand `paintGateway` a single cell and let it spread
 * itself 5 wide off a constant, which is the second width PATHWAYS.md §3 forbids.
 */
function paintMeadowEntrance(ctx: ArchetypeContext, water: Set<string>, routes: Set<string>, fromTop = false, frac = MEADOW_ENTRANCE_FRAC): void {
  const pal = MEADOW_PALETTES[ctx.zone] ?? MEADOW_PALETTES.summer
  const width = pathwayWidth(ctx)
  const half = Math.floor(width / 2)
  const centre = clamp(Math.floor(ctx.cols * frac), half + 1, ctx.cols - (width - half) - 1)
  const row = fromTop ? 0 : ctx.rows - 1
  const cells: Cell[] = []
  for (let k = -half; k < width - half; k++) cells.push({ col: centre + k, row })
  paintGateway(ctx, {
    side: fromTop ? 'north' : 'south',
    cells,
    ground: 'meadow',
    paving: wayTone(ctx) ?? pal.cobble,
    flank: bedsAndLamps,
  }, water, routes)
}

/** Drop a flower into a lane-side bed cell (open meadow only), a light stochastic scatter so the beds read
 *  as tended borders, not a solid wall of blooms. */
function plantFlowerBed(ctx: ArchetypeContext, col: number, row: number): void {
  const { cols, rows, collision, ground } = ctx
  if (!inBounds(col, row, cols, rows) || collision[row][col] || ground[row][col] !== 'meadow') return
  if (ctx.rand() < 0.55) placeProp(ctx, makeFlower(ctx.rand, ctx.zone, col, row))
}

// The ornament ZONE kinds sprinkled over the open centre, weighted so flowers dominate and rock/earth
// accent (so "not everything is green"), a loose grid of tended plots like #14/#17.
type MeadowOrnament = 'flowers' | 'grass' | 'earth' | 'rock'
const MEADOW_ORNAMENTS: ReadonlyArray<{ kind: MeadowOrnament; weight: number }> = [
  { kind: 'earth', weight: 20 }, { kind: 'grass', weight: 30 }, { kind: 'flowers', weight: 28 }, { kind: 'rock', weight: 22 },
]
const MEADOW_ORNAMENT_WEIGHT = MEADOW_ORNAMENTS.reduce((s, o) => s + o.weight, 0)

/** Weighted pick of an ornament kind from a [0,1) roll (same shape as pickLivingTree). Pure. */
function pickOrnamentKind(rand: number): MeadowOrnament {
  let roll = rand * MEADOW_ORNAMENT_WEIGHT
  for (const o of MEADOW_ORNAMENTS) {
    if (roll < o.weight) return o.kind
    roll -= o.weight
  }
  return MEADOW_ORNAMENTS[0].kind
}

/** Scatter a LOOSE GRID of small ornament ZONES over the open centre (#14/#17): flower patches, darker
 *  grass tufts, and rock / bare-earth patches, "not everything is green". Each zone is a small blob of a
 *  single kind on a coarse jittered grid, so the meadow reads as tended plots, not confetti. */
function scatterMeadowOrnaments(ctx: ArchetypeContext, water: Set<string>): void {
  const { cols, rows } = ctx
  const step = 8
  const inset = MEADOW_OUTER_BAND + 2 // keep ornaments in the open meadow, off the river/edge band
  for (let gy = inset; gy < rows - inset; gy += step) {
    for (let gx = inset; gx < cols - inset; gx += step) {
      if (ctx.rand() < 0.5) continue // mostly OPEN, leave wide gaps between the few tended plots (#24)
      const cc = clamp(gx + randIntWith(ctx.rand, 0, step - 3), 1, cols - 2)
      const cr = clamp(gy + randIntWith(ctx.rand, 0, step - 3), 1, rows - 2)
      // AND NOT IN A MOWN ONE. An orchard's floor is kept clear under the trees and a pasture's is not, which
      // is the difference between the two words. This scattered the same tufts and stones over both, and they
      // outnumbered the grass enough to decide what each region reads as: measured, a pasture and an orchard
      // both came out as the same ground.
      if (ctx.rand() > (ctx.zoneAt?.[cr]?.[cc]?.undergrowth ?? 1)) continue
      placeMeadowOrnamentZone(ctx, cc, cr, pickOrnamentKind(ctx.rand()), water)
    }
  }
}

/** Faint tended-field PATCHWORK painted as per-cell floor COLOUR (#24): a coarse checkerboard of large
 *  MEADOW_PATCH×MEADOW_PATCH patches, half of them nudged toward a pale plot tone, so the open field reads as
 *  tended garden plots, a colour on the flat floor, never a tile. Coarsened from the old per-cell grid LINES
 *  (which broke every floor run every 6 cells → the FPS hit): each patch is ONE flat tone across a large
 *  region, so compressGround still merges the floor into runs. Skips water / paved / blocked cells; ornaments
 *  painted after can override. */
function paintMeadowPlots(ctx: ArchetypeContext, water: Set<string>): void {
  const { cols, rows, ground, collision, floorColors } = ctx
  const pal = MEADOW_PALETTES[ctx.zone] ?? MEADOW_PALETTES.summer
  forEachCell(cols, rows, (col, row) => {
    if (isEdge(col, row, cols, rows) || water.has(`${col},${row}`) || collision[row][col]) return
    if (ground[row][col] !== 'meadow') return
    if (((Math.floor(col / MEADOW_PATCH) + Math.floor(row / MEADOW_PATCH)) & 1) === 0) return // only the alternate patches
    const base = floorColors[row][col] ?? pal.grass
    tintFloorCell(ctx, col, row, lerpHex(base, pal.plot, 0.16)) // faint, whole-patch tone
  })
}

// One cell of an ornament zone, dispatched by kind (Open/Closed: add a kind = add a row). Each reads a
// clear meadow cell and either tints the floor (grass/earth) or stacks a sparse ornament prop on top.
/**
 * TINT A FLOOR CELL, unless a pathway is what is standing on it.
 *
 * *"objects are put in the free spaces that the map has after pathways and river has run"*. The objects phase
 * runs after the ways are drawn now, so every tint it lays has to leave them alone. Measured the moment the
 * meadow was split: its plot patchwork repainted straight over the cobble, and a way that was one colour all
 * the way across came out in three.
 */
function tintFloorCell(ctx: ArchetypeContext, col: number, row: number, colour: string): void {
  if (standsOnPathway(ctx, col, row)) return
  ctx.floorColors[row][col] = colour
}

const MEADOW_ORNAMENT_CELL: Readonly<Record<MeadowOrnament, (ctx: ArchetypeContext, col: number, row: number, pal: MeadowPalette) => void>> = {
  flowers: (ctx, col, row) => { if (ctx.rand() < 0.7) placeProp(ctx, makeFlower(ctx.rand, ctx.zone, col, row)) },
  grass: (ctx, col, row, pal) => {
    const base = ctx.floorColors[row][col] ?? pal.grass
    tintFloorCell(ctx, col, row, lerpHex(base, meadowTint(pal.grass, col, row), 0.3)) // a gentle mottle, not a blob
  },
  earth: (ctx, col, row, pal) => { tintFloorCell(ctx, col, row, mutedEarth(ctx, col, row, pal)) },
  rock: (ctx, col, row, pal) => {
    tintFloorCell(ctx, col, row, mutedEarth(ctx, col, row, pal)) // bare earth under the rocks
    if (ctx.rand() < 0.22) placeProp(ctx, makeMeadowRock(ctx, col, row)) // a few LIGHT-grey field stones, sparse
  },
}

// Light warm-grey field stones for the meadow (the boulder tile tinted a pale rock tone), NOT the dark
// cave rockShade makeRock uses, so a meadow rock reads like the pale stones in #14/#17, not a black cube.
const MEADOW_ROCK_SHADES: ReadonlyArray<string> = ['#a49c90', '#9a9188', '#ab9f8e', '#928a80']
function makeMeadowRock(ctx: ArchetypeContext, col: number, row: number): StageProp {
  return { ...makeRock(col, row), color: MEADOW_ROCK_SHADES[randIntWith(ctx.rand, 0, MEADOW_ROCK_SHADES.length - 1)] }
}

/** A SUBTLE per-cell tone jitter for an ornament patch, a coherent position hash mapped to a value CENTRED
 *  on 0.5 (t∈[0.42,0.58]) so varyIntensity nudges the colour a touch lighter/darker, never crushing it to
 *  black (which passing t≈0 would do). Keeps a patch reading as its base tan/green, just mottled. */
function meadowTint(base: string, col: number, row: number): string {
  return varyIntensity(base, 0.42 + shadeNoise(col * 1.9 + row * 2.3) * 0.16)
}

/** A MUTED dirt tone for an earth/rock patch, the tan `earth` blended back toward the cell's own green floor
 *  so the patch reads as a soft brown mottle (like #24's subtle dirt), not a saturated tan block. */
function mutedEarth(ctx: ArchetypeContext, col: number, row: number, pal: MeadowPalette): string {
  const base = ctx.floorColors[row][col] ?? pal.grass
  return lerpHex(base, meadowTint(pal.earth, col, row), 0.55)
}

/** Paint ONE ornament zone, a small blob (radius 1) of a single kind on clear open meadow, never on
 *  water / trees / paved cells. Flowers may spread one cell wider (a fuller bloom cluster). */
function placeMeadowOrnamentZone(ctx: ArchetypeContext, cc: number, cr: number, kind: MeadowOrnament, water: Set<string>): void {
  const { cols, rows, ground, collision } = ctx
  const pal = MEADOW_PALETTES[ctx.zone] ?? MEADOW_PALETTES.summer
  const radius = kind === 'flowers' ? 1 + randIntWith(ctx.rand, 0, 1) : 1
  const paint = MEADOW_ORNAMENT_CELL[kind]
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const col = cc + dx
      const row = cr + dy
      if (!inBounds(col, row, cols, rows) || isEdge(col, row, cols, rows)) continue
      if (dx * dx + dy * dy > radius * radius + 1) continue
      if (water.has(`${col},${row}`) || collision[row][col] || ground[row][col] !== 'meadow') continue
      paint(ctx, col, row, pal)
    }
  }
}

/** A stone BRIDGE crossing the river at the TOP-RIGHT (#24): a deck spanning the top-edge water column in a
 *  cobble tone, carrying a real bridge composition (recordBridgeSpan), linking the open meadow to the land
 *  strip beyond the river. Drawn AFTER repairFloorConnectivity so its walkable deck is never filled back to
 *  forest; clears any tree/prop on the deck. It used to lay a run of flat `bridge` TILES and this comment
 *  outlived that, which is the single-tile-as-an-object mistake described in itself. */
function placeMeadowBridge(ctx: ArchetypeContext, water: Set<string>): void {
  const { cols, rows } = ctx
  const bridgeCol = Math.floor(cols * 0.72) // top-right, over the top-edge river arm (#24)
  const span: number[] = []
  for (let row = 0; row < rows; row++) if (water.has(`${bridgeCol},${row}`)) span.push(row)
  if (span.length === 0) return
  const rowsToDeck = [Math.min(...span) - 1, ...span, Math.max(...span) + 1]
  const deck = new Set<string>()
  // A DECK IS AS WIDE AS THE THING IT CARRIES. This laid THREE cells across, and a bridge composition is
  // `CROSSING_ROWS` (4) deep: a rail, two walking rows, a rail. `recordBridgeSpan` refuses a deck too narrow
  // to hold one, silently, so asking for a wooden bridge got a flat crossing and no bridge. Measured over 8
  // seeds and 3 courses: wood and stone built a bridge on 6 of 8, and every single miss was `across 3 < 4`.
  for (const row of rowsToDeck) for (let w = -DECK_HALF; w < CROSSING_ROWS - DECK_HALF; w++) deck.add(`${bridgeCol + w},${row}`)
  // The meadow's own cobble, stated here rather than defaulted inside layDeck, a stone bridge over a
  // meadow river is this layout's design, not something every caller should inherit.
  layDeck(ctx, deck, (MEADOW_PALETTES[ctx.zone] ?? MEADOW_PALETTES.summer).cobble)
  // …and the STRUCTURE on it. This function's own doc calls itself "a stone BRIDGE crossing the river", so it
  // is the one deck of the six that most obviously needs a real bridge. The deck runs along +row here (it
  // spans the top-edge arm at a fixed column), so the span axis is rows, not cols.
  // The WET EXTENT along the span axis, which here is rows at a fixed column: the bridge is placed over the
  // water rather than centred in the deck, so both ends land on a bank.
  recordBridgeSpan(ctx, deck, false, { from: Math.min(...span), to: Math.max(...span) })
}

/**
 * THE CROSSING, JOINED TO THE PATHS (ticket 36).
 *
 * `placeMeadowBridge` spans the river at a FIXED column, wherever that lands. On a meadow it happens to land
 * near the way in; in a wood it lands wherever it lands, so you get a deck in the middle of the trees with no
 * route to it. That is the defect it named, and it is a placement problem, not a missing feature.
 *
 * This one works the other way round: start from the ROUTE the layout already paved, span the river at its
 * narrowest point beside it, and pave a spur from each bank back to the nearest route cell. The deck ends up
 * part of the path network rather than a bridge that happens to exist.
 *
 * Returns false when there is nothing to join to (no route, or no water beside it) so the caller can fall
 * back to the plain bridge, a river still has to be crossable either way.
 */
function placeRiverCrossing(ctx: ArchetypeContext, water: Set<string>, routes: Set<string>): boolean {
  if (water.size === 0 || routes.size === 0) return false
  const meet = closestPair(routes, water)
  if (!meet) return false

  // Span whichever way the river is NARROWER here, the perimeter river runs along the top as a horizontal
  // arm and down the sides as vertical ones, so the deck's axis cannot be assumed.
  const across = (dc: number, dr: number) => waterReach(water, meet.to, dc, dr)
  const horizontal = 1 + across(1, 0) + across(-1, 0) <= 1 + across(0, 1) + across(0, -1)
  const axis: readonly [number, number] = horizontal ? [1, 0] : [0, 1]
  const perp: readonly [number, number] = horizontal ? [0, 1] : [1, 0]

  // One dry cell beyond the water at each end, so the deck has a landing rather than stopping in the river.
  const back = across(-axis[0], -axis[1]) + 1
  const forward = across(axis[0], axis[1]) + 1
  const at = (i: number): Cell => ({ col: meet.to.col + axis[0] * i, row: meet.to.row + axis[1] * i })
  const deck = new Set<string>()
  for (let i = -back; i <= forward; i++) {
    const cell = at(i)
    // As wide as the bridge it has to hold, see the note on the meadow's deck above.
    for (let w = -DECK_HALF; w < CROSSING_ROWS - DECK_HALF; w++) deck.add(`${cell.col + perp[0] * w},${cell.row + perp[1] * w}`)
  }
  if (![...deck].some(key => inBounds(toCell(key).col, toCell(key).row, ctx.cols, ctx.rows))) return false
  // A crossing wears the route it joins: the template's own trail tone when it serves one, and the meadow's
  // stone when it does not, because a bridge over a meadow river IS cobble. That is this layout's design
  // choice, not a stand-in for a served value it failed to read.
  layDeck(ctx, deck, wayTone(ctx) ?? (MEADOW_PALETTES[ctx.zone] ?? MEADOW_PALETTES.summer).cobble)
  // …and a real BRIDGE standing on it. `horizontal` is the deck's own axis, decided above by which way the
  // river is narrower here, so the bridge lies ACROSS the water rather than along it.
  // The WET EXTENT along the deck's own axis. `back`/`forward` each already step one cell onto dry land, so
  // the water is what lies between them, and that is what the span has to reach across.
  // ALONG THE CENTRE LINE, not across the whole band.
  //
  // This asked every cell of the deck, and a deck is a BAND: on a river running at an angle the band's outer
  // lanes meet the water further up and down the axis than the crossing itself does, so the measured extent
  // came out wider than the water the bridge actually has to reach over, and the span chosen for it
  // overhung its own run. The crossing's centre line is where the crossing is.
  const wetAlong: number[] = []
  for (let i = -back; i <= forward; i++) {
    const cell = at(i)
    if (water.has(`${cell.col},${cell.row}`)) wetAlong.push(horizontal ? cell.col : cell.row)
  }
  if (wetAlong.length > 0) {
    recordBridgeSpan(ctx, deck, horizontal, { from: Math.min(...wetAlong), to: Math.max(...wetAlong) })
  }

  // JOIN IT. Both banks, because a crossing you can only reach from one side is a pier.
  for (const end of [at(-back), at(forward)]) {
    const target = nearestCell(end, routes)
    if (target) carveSpur(ctx, end, target, water)
  }
  return true
}

/** The closest cell in `a` to any cell in `b`, as the pair. Both sets are map-sized at most, so the plain
 *  double loop is cheaper than the spatial index it would take to beat it. */
function closestPair(a: Iterable<string>, b: Iterable<string>): { from: Cell; to: Cell } | null {
  const targets = [...b].map(toCell)
  let best: { from: Cell; to: Cell } | null = null
  let bestD = Infinity
  for (const key of a) {
    const from = toCell(key)
    for (const to of targets) {
      const d = (from.col - to.col) ** 2 + (from.row - to.row) ** 2
      if (d >= bestD) continue
      bestD = d
      best = { from, to }
    }
  }
  return best
}

/** The cell in `keys` nearest `from`, or null when there are none. */
function nearestCell(from: Cell, keys: Iterable<string>): Cell | null {
  let best: Cell | null = null
  let bestD = Infinity
  for (const key of keys) {
    const cell = toCell(key)
    const d = (cell.col - from.col) ** 2 + (cell.row - from.row) ** 2
    if (d >= bestD) continue
    bestD = d
    best = cell
  }
  return best
}


/** Turn a set of cells into walkable deck: clear what stands on them and lay the crossing this map is built
 *  with. Shared by every crossing (the bridge, the joined crossing, fallen logs, a route over water) so they all
 *  read alike, and each cell is remembered in `ctx.decks`. */
/** The shortest run worth building a bridge over: one cell of water and a landing at each end. */







/** Pave an L-shaped spur from the bridge landing to the route it joins, wearing the TILE AND COLOUR of that
 *  route cell, so the spur looks like the path it runs into (a forest trail in a wood, cobble on a meadow)
 *  without this code knowing which layout called it. Never paves over water; the deck is what crosses that. */
function carveSpur(ctx: ArchetypeContext, from: Cell, to: Cell, water: Set<string>): void {
  const { cols, rows, ground, floorColors } = ctx
  if (!inBounds(to.col, to.row, cols, rows)) return
  const tile = ground[to.row][to.col]
  const tone = floorColors[to.row][to.col]

  const lane = new Set<string>()
  const width = pathwayWidth(ctx)
  const widen = (col: number, row: number) => {
    for (let dc = 0; dc < width; dc++)
      for (let dr = 0; dr < width; dr++) lane.add(`${col + dc},${row + dr}`)
  }
  const step = (a: number, b: number) => (a < b ? 1 : -1)
  let { col, row } = from
  widen(col, row)
  while (col !== to.col) { col += step(col, to.col); widen(col, row) }
  while (row !== to.row) { row += step(row, to.row); widen(col, row) }

  const paveable = new Set([...lane].filter(key => {
    const cell = toCell(key)
    return inBounds(cell.col, cell.row, cols, rows) && !water.has(key)
  }))
  clearMeadowCells(ctx, paveable) // a spur through the trees has to actually clear them
  for (const key of paveable) {
    const cell = toCell(key)
    ground[cell.row][cell.col] = tile
    floorColors[cell.row][cell.col] = tone
  }
}

/** Remove every tree anchor + prop on the given cell keys and clear their collision, the surgical "make
 *  these cells bare walkable floor" op the bridge uses so its deck reads clean. */
function clearMeadowCells(ctx: ArchetypeContext, keys: Set<string>): void {
  ctx.trees.splice(0, ctx.trees.length, ...ctx.trees.filter(t => !keys.has(`${t.col},${t.row}`)))
  ctx.props.splice(0, ctx.props.length, ...ctx.props.filter(p => !keys.has(`${p.col},${p.row}`)))
  keys.forEach(key => {
    const { col, row } = toCell(key)
    if (inBounds(col, row, ctx.cols, ctx.rows)) ctx.collision[row][col] = false
  })
}

/** Framing-tree clumps can pinch off a tiny floor pocket. Any SMALL floor region (≤ maxPocket cells) outside
 *  the largest connected floor becomes tree mass, so the navigable meadow has no stranded gaps. LARGE
 *  disconnected regions are LEFT alone, the land strip BEYOND the river (#24) is a deliberate separate area
 *  (open grass + the sparse framing trees), not a pocket to carpet. Canopy tops are a separate walkable
 *  layer, excluded. */
function repairFloorConnectivity(ctx: ArchetypeContext, maxPocket = Infinity): void {
  const { collision, zone, cols, rows, trees: anchors } = ctx
  const isFloor = (col: number, row: number): boolean => inBounds(col, row, cols, rows) && !collision[row][col]

  const seen = new Set<string>()
  const regions: Set<string>[] = []
  let largest = new Set<string>()
  forEachCell(cols, rows, (col, row) => {
    if (!isFloor(col, row) || seen.has(`${col},${row}`)) return
    const region = flood(isFloor, col, row, seen)
    regions.push(region)
    if (region.size > largest.size) largest = region
  })
  for (const region of regions) {
    if (region === largest || region.size > maxPocket) continue // keep the meadow + the intentional outer strip
    // A pocket the WATER cut off is not a mistake, it is a MOUND. Reference image #18 is mounds with boardwalks
    // between them, so carpeting one with tree mass deletes the very thing you are meant to stand on. Left
    // alone here, and `joinStrandedRegions` planks out to it.
    if (waterBound(ctx, region)) continue
    region.forEach(key => {
      const { col, row } = toCell(key)
      collision[row][col] = true
      anchors.push({ col, row, kind: pickLivingTree(shadeNoise(col * 17 + row * 43), speciesAt(ctx, col, row)), variant: massVariant(col, row) % canopyCount(styleCatalog('ascii'), zone) }) // tiny dead pocket → forest fills it
    })
  }
}

/** Is this pocket ringed by WATER rather than closed in by trees: more of its border is wet than dry. */
function waterBound(ctx: ArchetypeContext, region: ReadonlySet<string>): boolean {
  let wet = 0
  let dry = 0
  for (const key of region) {
    const { col, row } = toCell(key)
    for (const [dc, dr] of ORTHO) {
      const c = col + dc
      const r = row + dr
      if (!inBounds(c, r, ctx.cols, ctx.rows) || region.has(`${c},${r}`)) continue
      if (isWaterGround(ctx.ground[r][c])) wet++
      else dry++
    }
  }
  return wet > dry
}


/** The biggest connected region of floor cells (4-neighbour), as a key set. Used by the cave / boss
 *  archetypes to keep the carved floor one navigable region. */
function largestFloorRegion(isFloor: (c: number, r: number) => boolean, cols: number, rows: number): Set<string> {
  const seen = new Set<string>()
  let best = new Set<string>()
  forEachCell(cols, rows, (col, row) => {
    if (!isFloor(col, row)) return
    if (seen.has(`${col},${row}`)) return
    const region = flood(isFloor, col, row, seen)
    if (region.size > best.size) best = region
  })
  return best
}

/** L-shaped, 2-wide corridor between two cells. */
function carveCorridor(trees: boolean[][], a: Cell, b: Cell): void {
  carveHorizontal(trees, a.col, b.col, a.row)
  carveVertical(trees, b.col, a.row, b.row)
}

// Corridors and gates are carved this many cells wide → clear, visible, navigable
// lanes (top-down view has no iso depth to see between trees).
const PATH_WIDTH = 5

/** Clear a band of trees perpendicular to a corridor cell. */
function clearBand(trees: boolean[][], col: number, row: number, vertical: boolean): void {
  const half = Math.floor(PATH_WIDTH / 2)
  for (let w = -half; w <= half; w++) {
    const c = vertical ? col + w : col
    const r = vertical ? row : row + w
    if (r >= 0 && r < trees.length && c >= 0 && c < trees[r].length) trees[r][c] = false
  }
}

function carveHorizontal(trees: boolean[][], fromCol: number, toCol: number, row: number): void {
  const step = toCol >= fromCol ? 1 : -1
  for (let col = fromCol; col !== toCol + step; col += step) {
    clearBand(trees, col, row, false) // band spans rows (perpendicular to a horizontal run)
  }
}

// A tree is a stacked COMPOSITION (see TreeAnchor): the trunk sits at the anchor cell (levels 0-1) and the
// canopy blob stacks ABOVE it (levels 2-3). The canopy is WALKABLE overhead (you walk under the tree), so a
// tree occupies only its trunk cell for collision/placement, no ground footprint beyond the anchor.

// Per-zone chance a scattered glade tree is a leafless snag, harsher zones have
// more dead wood (charred lava, frost-killed frozen) than the lush verdant.
// Bare/dead trees by season: many in winter (leafless), a good share in autumn,
// few in the green seasons.
const DEAD_TREE_CHANCE: Readonly<Record<ZoneId, number>> = {
  spring: 0.06, summer: 0.08, autumn: 0.28, winter: 0.45, desert: 0.4, beach: 0.1, lava: 0.5,
}

/** A tree fits when its trunk cell is in-bounds and on currently-open ground. The canopy is walkable overhead
 *  (it occupies no ground), so only the anchor cell matters; isolated-pocket repair is handled by
 *  repairFloorConnectivity. */
function treeFits(collision: boolean[][], baseCol: number, baseRow: number, cols: number, rows: number): boolean {
  return inBounds(baseCol, baseRow, cols, rows) && !collision[baseRow][baseCol]
}

/**
 * NOTHING GROWS IN THE RIVER, and this is the one place that decides it.
 *
 * *"please fix the trees being planted on the river, river DOESN'T HAVE TREES IN THE EDGE"*, asked twice.
 *
 * Measured before the fix, on a 60x40 map at one seed: 12 to 20 trees standing in the channel on EVERY
 * template, towns included, and almost all of them in the dug part rather than in a pool.
 *
 * The canopy field already refused water and said so in its own comment. It was never the only placer: eight
 * separate sites push onto `ctx.trees` and exactly one of them checked the ground. A rule that lives in one
 * of eight callers is not a rule, so it lives at the COMMIT instead and every placer goes through here.
 *
 * `ctx.water` as well as the label, because the two disagree at different points in the build: the river
 * layer records its cells before some passes have painted them, and a ford carries a route label over water
 * it never stopped owning.
 */
export function plantTree(ctx: ArchetypeContext, tree: TreeAnchor): boolean {
  if (!inBounds(tree.col, tree.row, ctx.cols, ctx.rows)) return false
  if (ctx.water.has(`${tree.col},${tree.row}`)) return false
  if (isWaterGround(ctx.ground[tree.row][tree.col])) return false
  if (ctx.wet.has(`${tree.col},${tree.row}`)) return false
  // NOTHING GROWS ON A CROSSING. A deck is the way over the water, landings included: the band reaches a cell
  // of bank at each end on purpose so it has something to stand on, and those cells are dry, so every rule
  // above lets a trunk through onto one. `canPlantBloom` has consulted `ctx.decks` for exactly this reason;
  // trees never did, and a flanking trunk came down on a bridge's landing and shut the bridge.
  if (ctx.decks.has(`${tree.col},${tree.row}`)) return false
  // NOTHING IS WRITTEN INTO THE END CELLS OF A PATHWAY.
  //
  // Layer 3 recorded them (GENERATION-SPEC §5.1 gives it "where the exits are"), and this is the COMMIT every
  // one of the eleven placers passes through, which is the same reason the water rules live here rather than
  // in each of them. `claimed` catches the passes that read it; this catches the ones that do not.
  //
  // Bounded to the gate's own cells, a couple of dozen on a 1,600 cell map, so it cannot thin a wood. A
  // guard on the whole pathway CAN, and did: it emptied every map. PATHWAYS.md §4.
  if (ctx.exitCells.has(`${tree.col},${tree.row}`)) return false
  // A caller that already chose a colour keeps it; everything else is dressed here, so the rule lives at the
  // COMMIT rather than in eight separate placers.
  ctx.trees.push({ ...tree, leafColor: tree.leafColor ?? leafToneAt(ctx, tree) })
  return true
}

/**
 * WHAT COLOUR THIS TREE IS, from the three axes, resolved once where the tree is committed.
 *
 * The season picks the shade (four per zone, indexed by the tree's own `variant`, which is where a stand's
 * tonal variety comes from), the biome bends its hue and brightness, and the region the tree stands in
 * shifts it a little further by how much light reaches there. `foliageColor` holds the arithmetic and the
 * reasoning; this only gathers the three inputs.
 *
 * Every input is SERVED. A generator with no foliage palette gets the season shade unchanged, so nothing
 * that looked right before moves.
 */
function leafToneAt(ctx: ArchetypeContext, tree: TreeAnchor): string | undefined {
  const shade = canopyShade(styleCatalog('ascii'), ctx.zone, tree.variant)
  const region = ctx.zoneAt?.[tree.row]?.[tree.col]
  return foliageColor(
    shade,
    { leaf: ctx.palette?.leaf, seasonality: ctx.palette?.leafSeasonality, value: ctx.palette?.leafValue },
    { leafHue: region?.leafHue, leafValue: region?.leafValue },
  )
}

/**
 * A tree's trunk cell must stand on UNPAVED ground, not the paved plaza, driveways, or roads. `treeFits` guards
 * collision; this guards the GROUND, so a tree never lands on the town square. (The canopy is walkable overhead
 * and occupies no ground, so only the trunk cell is checked.) Pure, reads `ground` only.
 */
export function treeColumnClearsPaving(ground: string[][], col: number, baseRow: number): boolean {
  // PAVING IS BOTH KINDS: a built floor and a road. `path_stone` is filed under `roads` by the backend, not
  // `floors`, so asking only one of the two let a trunk stand in the middle of a plaza path.
  const g = ground[baseRow]?.[col]
  return !isBuiltFloor(g) && !isRoadGround(g)
}

/** Record a TREE anchor (trunk-base cell + composition kind + canopy shade). The generator no longer bakes flat
 *  tree cells; at load applyStageToGrid stamps the composition (stampComposition) into per-cell heightLevel-
 *  stacked DB tiles, the SAME lego model buildings use, so every tree tile is selectable and 100% backend-
 *  driven. The canopy is walkable overhead, so collision here blocks only the trunk cell, matching the stamp. */
function stampTree(ctx: ArchetypeContext, baseCol: number, baseRow: number, dead = false): void {
  const { collision, zone, trees, cols, rows } = ctx
  if (!isLandCell(ctx, baseCol, baseRow)) return // land-only: no tree in water
  if (standsOnPathway(ctx, baseCol, baseRow)) return // and no tree in a road
  const variant = randIntWith(ctx.rand, 0, canopyCount(styleCatalog('ascii'), zone) - 1) // this tree's canopy tone (green…pink)
  const kind = dead ? 'tree_dead' : pickLivingTree(ctx.rand(), speciesAt(ctx, baseCol, baseRow)) // random shape variant (standard/tall/small/round/bush)
  // ONLY A TREE THAT WAS ACTUALLY PLANTED BLOCKS. The commit refuses a cell for several reasons (water, a
  // wet cell, a crossing, the end cells of a way) and this blocked the cell regardless, so a refusal left an
  // impassable square with nothing standing in it.
  if (!plantTree(ctx, { col: baseCol, row: baseRow, kind, variant })) return
  if (inBounds(baseCol, baseRow, cols, rows)) collision[baseRow][baseCol] = true // only the trunk cell blocks
}

/** Flood-fill the open cells, keep the single largest clearing, and fill the rest
 *  with trees so no isolated pockets remain. Returns the kept clearing. */
function keepLargestClearing(trees: boolean[][], cols: number, rows: number): Set<string> {
  const seen = new Set<string>()
  let largest = new Set<string>()
  forEachCell(cols, rows, (col, row) => {
    if (trees[row][col]) return
    if (seen.has(`${col},${row}`)) return
    const region = floodOpen(trees, col, row, cols, rows)
    region.forEach(k => seen.add(k))
    if (region.size > largest.size) largest = region
  })
  forEachCell(cols, rows, (col, row) => {
    if (!trees[row][col] && !largest.has(`${col},${row}`)) trees[row][col] = true
  })
  return largest
}

function floodOpen(trees: boolean[][], startCol: number, startRow: number, cols: number, rows: number): Set<string> {
  const region = new Set<string>([`${startCol},${startRow}`])
  const stack: Cell[] = [{ col: startCol, row: startRow }]
  while (stack.length > 0) {
    const { col, row } = stack.pop()!
    for (const [dx, dy] of ORTHO) {
      const c = col + dx
      const r = row + dy
      const key = `${c},${r}`
      if (!inBounds(c, r, cols, rows)) continue
      if (trees[r][c]) continue
      if (region.has(key)) continue
      region.add(key)
      stack.push({ col: c, row: r })
    }
  }
  return region
}

function carveVertical(trees: boolean[][], col: number, fromRow: number, toRow: number): void {
  const step = toRow >= fromRow ? 1 : -1
  for (let row = fromRow; row !== toRow + step; row += step) {
    clearBand(trees, col, row, true) // band spans cols (perpendicular to a vertical run)
  }
}

// ── temple archetype (a real SEASONAL DUNGEON, Zelda/Tomb-of-Sargeras style) ──
// A room-and-corridor dungeon: distinct ROOMS wired into a connected network by
// narrow CORRIDORS, a south ENTRANCE hall (spawn), a grand north BOSS chamber with a
// central ALTAR + pillar ring, pillared side halls, wall torches, seasonal hazards
// (spike traps + water/ice/lava/sand-trap pools), and a narratively-locked boss
// gateway + key. Flood-fill repair guarantees ONE connected floor every seed.
// The SEASON drives the whole look: floor + wall tone, hazard terrain, torch/altar
// glow. Every feature KIND maps to an ASCII glyph+colour AND an emoji tint (temple_wall
// → 🧱, pillar → 🏛️, altar → 🗿, torch → 🔥, hazard → 🔺, key → 🗝️; see game/artStyle.ts).
// TemplePalette + TEMPLE_PALETTES now live in zones.ts (single source of truth for palette data).

/** A dungeon room: a carved rectangle with a role. entrance = south spawn hall; boss = the
 *  grand north altar chamber; hall = a pillared side room. */
interface TempleRoom extends Rect {
  role: 'entrance' | 'boss' | 'hall'
}

const TEMPLE_CORRIDOR_HALF = 1 // → 3-wide corridors (narrow dungeon halls, not open forest lanes)

const roomCentre = (room: Rect): Cell => ({ col: room.col + Math.floor(room.w / 2), row: room.row + Math.floor(room.h / 2) })

/**
 * A TEMPLE, IN PHASES. Its corridors ARE its pathways, so carving the rooms and the ways between them is the
 * structure, the masonry around them is terrain, and the altar, the pillars, the torches, the hazards and the
 * gate are what is placed in it.
 */
const templePhases: VariantPhases = {
  terrain: ctx => {
    const { cols, rows, zone } = ctx
    const pal = templePalette(zone) ?? templePalette('summer')
    if (!pal) { console.warn('[generate] no temple palette served, nothing built'); return }
    forEachCell(cols, rows, (col, row) => { ctx.ground[row][col] = pal.floor })

    const wall = makeGrid(cols, rows, () => true)
    const plan = ctx.routes ?? null
    const rooms = plan ? templeRoomsFromPlan(ctx, plan) : templeRooms(cols, rows)
    rooms.forEach(room => carveTempleRoom(wall, room, cols, rows))
    if (plan) carveTempleWays(wall, plan, cols, rows)
    else connectTempleRooms(wall, rooms, cols, rows)
    forEachCell(cols, rows, (col, row) => {
      if (isEdge(col, row, cols, rows)) wall[row][col] = true
    })
    commitTempleWalls(ctx, wall, pal)
    ctx.templeRooms = rooms
  },

  objects: ctx => {
    const pal = templePalette(ctx.zone) ?? templePalette('summer')
    const rooms = ctx.templeRooms
    if (!pal || !rooms) return
    const plan = ctx.routes ?? null
    const boss = rooms.find(r => r.role === 'boss')!
    const entrance = rooms.find(r => r.role === 'entrance')!

    paintTempleInlay(ctx, rooms, pal)
    rooms.forEach(room => {
      if (room.role !== 'entrance') placePillaredHall(ctx, room, pal)
    })
    placeAltarChamber(ctx, boss, pal)
    placeTorches(ctx, rooms, pal)
    placeTempleHazards(ctx, rooms, pal, plan?.cells ?? new Set())
    sealStrandedFloor(ctx, (col, row) => makeTempleWall(col, row, pal.wall))
    if (plan) { placeSanctumGate(ctx, boss, rooms, plan, pal); return }
    placeLockedDoorAndKey(ctx, boss, entrance, rooms, pal)
  },
}

/** Lay out the dungeon rooms: a south ENTRANCE hall (spawn), a grand north BOSS chamber, and a
 *  row of pillared side HALLS across the middle band. Deterministic sizes, jittered positions. */
/**
 * THE PLAN IS THE TEMPLE, once the generator says how many pathways run through it.
 *
 * The research: a Zelda dungeon is a spider (entrance, hub, legs, each leg ending somewhere worth reaching, the
 * boss locked off the hub), and WoW's lesson is that each of those places should look like somewhere rather than
 * like the end of a corridor. So the SANCTUM takes the plan's deepest point, the chapels take the other stops,
 * and the entrance hall takes the way in. What used to be here was a fixed list: a boss rect at the top, an
 * entrance rect at the bottom and three halls on a lane formula, connected by corridors of its own devising.
 *
 * The altar stays in the north half, which is what its suite holds it to, so the sanctum takes the most
 * NORTHERN place the plan offers and is nudged north if even that sits south of the middle.
 */
function templeRoomAt(centre: RouteCell, w: number, h: number, cols: number, rows: number, role: TempleRoom['role']): TempleRoom {
  return {
    col: clamp(centre.col - Math.floor(w / 2), 1, Math.max(1, cols - 1 - w)),
    row: clamp(centre.row - Math.floor(h / 2), 1, Math.max(1, rows - 1 - h)),
    w,
    h,
    role,
  }
}

function templeRoomsFromPlan(ctx: ArchetypeContext, plan: RoutePlan): TempleRoom[] {
  const { cols, rows } = ctx
  const places = [plan.hub, ...plan.deadEnds]
  const deepest = places.reduce((a, b) => (b.row < a.row ? b : a))

  const sanctum = templeRoomAt(deepest, clamp(Math.floor(cols * 0.42), 8, cols - 4), clamp(Math.floor(rows * 0.3), 6, rows - 4), cols, rows, 'boss')
  if (sanctum.row + Math.floor(sanctum.h / 2) >= Math.floor(rows / 2)) {
    sanctum.row = clamp(Math.floor(rows / 2) - sanctum.h, 1, Math.max(1, rows - 1 - sanctum.h))
  }

  const entrance = templeRoomAt(plan.entrance.inside, clamp(Math.floor(cols * 0.3), 6, cols - 4), clamp(Math.floor(rows * 0.2), 4, rows - 4), cols, rows, 'entrance')
  const chapelW = clamp(Math.floor(cols * 0.22), 5, 12)
  const chapelH = clamp(Math.floor(rows * 0.22), 4, 10)
  const chapels = places.filter(place => place !== deepest).map(place => templeRoomAt(place, chapelW, chapelH, cols, rows, 'hall'))
  return [sanctum, entrance, ...chapels]
}

/** The halls ARE the planned pathways: carve the band the plan painted, never the border. */
function carveTempleWays(wall: boolean[][], plan: RoutePlan, cols: number, rows: number): void {
  for (const key of plan.cells) {
    const { col, row } = toCell(key)
    if (inBounds(col, row, cols, rows) && !isEdge(col, row, cols, rows)) wall[row][col] = false
  }
}

/**
 * THE LOCK, AND A KEY YOU CAN REACH WITHOUT IT.
 *
 * That is the one invariant a lock-and-key dungeon has to hold (Boris the Brave's piece on them is blunt about
 * it: every lock needs a reachable key, or the dungeon is unsolvable). So the gate goes on the sanctum's OWN
 * corridor, the nearest planned cell outside its walls, and the key goes in a chapel, which hangs off the hub
 * rather than off the sanctum. A one-room temple has nothing to lock and gets neither.
 */
function placeSanctumGate(ctx: ArchetypeContext, sanctum: TempleRoom, rooms: TempleRoom[], plan: RoutePlan, pal: TemplePalette): void {
  const { collision, cols, rows } = ctx
  const chapel = rooms.find(room => room.role === 'hall')
  if (!chapel) return
  const insideSanctum = (col: number, row: number) =>
    col >= sanctum.col && col < sanctum.col + sanctum.w && row >= sanctum.row && row < sanctum.row + sanctum.h
  const centre = roomCentre(sanctum)
  const gate = [...plan.spine]
    .map(toCell)
    .filter(cell => inBounds(cell.col, cell.row, cols, rows) && !collision[cell.row][cell.col] && !insideSanctum(cell.col, cell.row))
    .reduce<Cell | null>((best, cell) => (best === null || manhattan(cell, centre) < manhattan(best, centre) ? cell : best), null)
  if (!gate) return
  ctx.props.push(makeGateway(gate.col, gate.row, pal.pillar)) // walkable, see makeGateway
  const kc = roomCentre(chapel)
  if (inBounds(kc.col, kc.row, cols, rows) && !collision[kc.row][kc.col]) ctx.props.push(makeKey(kc.col, kc.row))
}

function templeRooms(cols: number, rows: number): TempleRoom[] {
  const rooms: TempleRoom[] = []
  // Grand boss chamber, centred near the top.
  const bw = clamp(Math.floor(cols * 0.42), 8, cols - 6)
  const bh = clamp(Math.floor(rows * 0.30), 6, rows - 10)
  const boss: TempleRoom = { col: Math.floor((cols - bw) / 2), row: 2, w: bw, h: bh, role: 'boss' }
  rooms.push(boss)

  // Entrance hall, centred near the bottom (the spawn region).
  const ew = clamp(Math.floor(cols * 0.30), 6, cols - 6)
  const eh = clamp(Math.floor(rows * 0.20), 4, rows - 10)
  const entrance: TempleRoom = { col: Math.floor((cols - ew) / 2), row: rows - 2 - eh, w: ew, h: eh, role: 'entrance' }
  rooms.push(entrance)

  // Side halls across the middle band between boss + entrance.
  const midTop = boss.row + boss.h + 1
  const midBot = entrance.row - 1
  const bandH = Math.max(4, midBot - midTop)
  const hallH = clamp(Math.floor(bandH * 0.7), 4, 8)
  const hallW = clamp(Math.floor(cols * 0.22), 5, 10)
  const midRow = clamp(midTop + randInt(0, Math.max(0, bandH - hallH)), 1, rows - hallH - 1)
  const lanes = [0.16, 0.5, 0.84]
  lanes.forEach(frac => {
    const col = clamp(Math.floor(cols * frac - hallW / 2), 1, cols - hallW - 1)
    const jitter = randInt(-1, 1)
    rooms.push({ col, row: clamp(midRow + jitter, 1, rows - hallH - 1), w: hallW, h: hallH, role: 'hall' })
  })
  return rooms
}

/** Carve a room's rectangle open (skips the solid map border). */
function carveTempleRoom(wall: boolean[][], room: Rect, cols: number, rows: number): void {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const col = room.col + dx
      const row = room.row + dy
      if (inBounds(col, row, cols, rows) && !isEdge(col, row, cols, rows)) wall[row][col] = false
    }
  }
}

/** Nearest-neighbour spanning tree of corridors + a couple of extra links (loops), so the rooms
 *  form a navigable NETWORK rather than a single line (the Zelda "hub + legs" topology). */
function connectTempleRooms(wall: boolean[][], rooms: TempleRoom[], cols: number, rows: number): void {
  if (rooms.length < 2) return
  const linked = [rooms[0]]
  const pending = rooms.slice(1)
  while (pending.length > 0) {
    let best = { from: linked[0], index: 0, dist: Infinity }
    pending.forEach((room, index) => {
      linked.forEach(from => {
        const dist = manhattan(roomCentre(from), roomCentre(room))
        if (dist < best.dist) best = { from, index, dist }
      })
    })
    carveTempleCorridor(wall, roomCentre(best.from), roomCentre(pending[best.index]), cols, rows)
    linked.push(pending.splice(best.index, 1)[0])
  }
  // A couple of loop links so the dungeon isn't a pure tree.
  for (let i = 0; i < Math.min(2, rooms.length - 1); i++) {
    const a = rooms[randInt(0, rooms.length - 1)]
    const b = rooms[randInt(0, rooms.length - 1)]
    if (a !== b) carveTempleCorridor(wall, roomCentre(a), roomCentre(b), cols, rows)
  }
}

/** L-shaped, 3-wide corridor between two cells (never clears the sealed border). */
function carveTempleCorridor(wall: boolean[][], a: Cell, b: Cell, cols: number, rows: number): void {
  const clear = (col: number, row: number, vertical: boolean): void => {
    for (let w = -TEMPLE_CORRIDOR_HALF; w <= TEMPLE_CORRIDOR_HALF; w++) {
      const c = vertical ? col + w : col
      const r = vertical ? row : row + w
      if (inBounds(c, r, cols, rows) && !isEdge(c, r, cols, rows)) wall[r][c] = false
    }
  }
  const stepC = b.col >= a.col ? 1 : -1
  for (let col = a.col; col !== b.col + stepC; col += stepC) clear(col, a.row, false)
  const stepR = b.row >= a.row ? 1 : -1
  for (let row = a.row; row !== b.row + stepR; row += stepR) clear(b.col, row, true)
}

/** Commit the seasonal stone walls: every wall cell becomes a blocking temple_wall prop. */
function commitTempleWalls(ctx: ArchetypeContext, wall: boolean[][], pal: TemplePalette): void {
  const { props, collision, cols, rows } = ctx
  forEachCell(cols, rows, (col, row) => {
    if (!wall[row][col]) return
    props.push(makeTempleWall(col, row, pal.wall))
    collision[row][col] = true
  })
}

/** Ornate CHECKER inlay over the room floors, alternate the season's floor + accent tile so a
 *  temple reads as a tiled hall, not a flat slab. Floor cells only (never repaints a wall). */
function paintTempleInlay(ctx: ArchetypeContext, rooms: TempleRoom[], pal: TemplePalette): void {
  const { ground, collision, cols, rows } = ctx
  rooms.forEach(room => {
    for (let dy = 0; dy < room.h; dy++) {
      for (let dx = 0; dx < room.w; dx++) {
        const col = room.col + dx
        const row = room.row + dy
        if (!inBounds(col, row, cols, rows) || collision[row][col]) continue
        ground[row][col] = (row + col) % 2 === 0 ? pal.floor : pal.accent
      }
    }
  })
}

/** A colonnade lining a room's two long sides (one cell in), pillars every other row, leaving the
 *  central aisle clear, the pillared-hall look. Guarded (never on the door/aisle). */
function placePillaredHall(ctx: ArchetypeContext, room: TempleRoom, pal: TemplePalette): void {
  if (room.w < 5 || room.h < 4) return
  const left = room.col + 1
  const right = room.col + room.w - 2
  for (let row = room.row + 1; row < room.row + room.h - 1; row += 2) {
    placeProp(ctx, makePillar(left, row, pal.pillar))
    placeProp(ctx, makePillar(right, row, pal.pillar))
  }
}

/** The grand boss chamber: a central ALTAR flanked by braziers, ringed by pillars, the
 *  set-piece the dungeon builds toward. */
function placeAltarChamber(ctx: ArchetypeContext, boss: TempleRoom, pal: TemplePalette): void {
  const c = roomCentre(boss)
  placeProp(ctx, makeAltar(c.col, c.row, pal.altar))
  placeProp(ctx, makeBrazier(c.col - 2, c.row))
  placeProp(ctx, makeBrazier(c.col + 2, c.row))
  // a pillar ring around the altar (corners of a 5×5 box), + torches at the chamber corners
  for (const [dc, dr] of [[-2, -2], [2, -2], [-2, 2], [2, 2]] as const) {
    placeProp(ctx, makePillar(c.col + dc, c.row + dr, pal.pillar))
  }
  placeProp(ctx, makeTorch(boss.col + 1, boss.row + 1, pal.torch))
  placeProp(ctx, makeTorch(boss.col + boss.w - 2, boss.row + 1, pal.torch))
}

/** Wall torches lighting each room, dropped at the interior corners (non-blocking sconces). */
function placeTorches(ctx: ArchetypeContext, rooms: TempleRoom[], pal: TemplePalette): void {
  rooms.forEach(room => {
    if (room.w < 4 || room.h < 3) return
    const corners: Cell[] = [
      { col: room.col + 1, row: room.row + 1 },
      { col: room.col + room.w - 2, row: room.row + 1 },
      { col: room.col + 1, row: room.row + room.h - 2 },
      { col: room.col + room.w - 2, row: room.row + room.h - 2 },
    ]
    corners.forEach(cell => placeProp(ctx, makeTorch(cell.col, cell.row, pal.torch)))
  })
}

/** Seasonal hazards: spike-trap tiles scattered on hall floors (non-blocking) + one hazard POOL
 *  per side hall (blocking per season, kept inside the room interior so it can't gate a corridor).
 *  The entrance + boss chambers stay hazard-free (clean spawn + fair boss arena). */
/**
 * Seasonal hazards, and the cells they must not touch.
 *
 * Measured, not assumed: a chapel's planned way ENDS at the chapel's centre, and the pool stamps at that same
 * centre, so the pool sat on the corridor's mouth. The repair then walled the pocket off, the stop came out
 * unreachable and its key was never placed, because the cell it would have gone on was water. Three seeds out
 * of three. The cave learned the same lesson an hour earlier: a way wins over water.
 */
function placeTempleHazards(ctx: ArchetypeContext, rooms: TempleRoom[], pal: TemplePalette, keepOut: ReadonlySet<string> = new Set()): void {
  const { collision, props, cols, rows } = ctx
  const occupied = new Set(props.map(p => `${p.col},${p.row}`))
  rooms.forEach(room => {
    if (room.role !== 'hall') return
    // a hazard pool near the room centre (radius 1-2), confined to the room interior.
    stampTemplePool(ctx, room, pal, keepOut)
    // a few spike traps on remaining floor cells of the room interior.
    const spikes = 2 + randInt(0, 3)
    for (let i = 0; i < spikes; i++) {
      const col = randInt(room.col + 1, room.col + room.w - 2)
      const row = randInt(room.row + 1, room.row + room.h - 2)
      if (!inBounds(col, row, cols, rows) || collision[row][col]) continue
      if (occupied.has(`${col},${row}`)) continue
      props.push(makeHazard(col, row, pal.spikeChar, pal.spikeColor))
      occupied.add(`${col},${row}`)
    }
  })
}

/** One organic hazard pool inside a room's interior (never spilling onto the room edge/corridor),
 *  painted only over floor cells. Blocking per season (ice stays walkable). */
function stampTemplePool(ctx: ArchetypeContext, room: TempleRoom, pal: TemplePalette, keepOut: ReadonlySet<string> = new Set()): void {
  const { ground, collision, cols, rows } = ctx
  const c = roomCentre(room)
  const radius = 1 + randInt(0, 1)
  const phase = Math.random() * Math.PI * 2
  for (let dr = -radius; dr <= radius; dr++) {
    for (let dc = -radius; dc <= radius; dc++) {
      const col = c.col + dc
      const row = c.row + dr
      // stay strictly inside the room interior so the pool can't seal a doorway/corridor.
      if (col <= room.col + 1 || col >= room.col + room.w - 2) continue
      if (row <= room.row + 1 || row >= room.row + room.h - 2) continue
      if (!inBounds(col, row, cols, rows) || collision[row][col]) continue
      if (keepOut.has(`${col},${row}`)) continue // never on a planned way: that is the corridor's mouth
      const reach = radius * (1 + 0.25 * Math.sin(Math.atan2(dr, dc) * 3 + phase))
      if (dc * dc + dr * dr > reach * reach) continue
      ground[row][col] = pal.pool
      collision[row][col] = pal.poolBlocks
    }
  }
}

/** Flood-fill the walkable floor and fill every cell OUTSIDE the largest region with wall, so
 *  the dungeon floor is always ONE connected region, even after blocking hazard pools. */

/** The (narratively) locked boss GATEWAY, a walkable threshold prop at the corridor mouth just
 *  south of the boss chamber, and its KEY, dropped on a side-hall floor. Both guarded + optional
 *  (skipped when no clear cell is found), and WALKABLE so connectivity is never broken. */
function placeLockedDoorAndKey(ctx: ArchetypeContext, boss: TempleRoom, entrance: TempleRoom, rooms: TempleRoom[], pal: TemplePalette): void {
  const { collision, cols, rows } = ctx
  const gateCol = roomCentre(boss).col
  for (let row = boss.row + boss.h; row < entrance.row; row++) {
    if (!inBounds(gateCol, row, cols, rows) || collision[row][gateCol]) continue
    ctx.props.push(makeGateway(gateCol, row, pal.pillar)) // walkable, see makeGateway
    break
  }
  const hall = rooms.find(r => r.role === 'hall')
  if (!hall) return
  const kc = roomCentre(hall)
  if (inBounds(kc.col, kc.row, cols, rows) && !collision[kc.row][kc.col]) ctx.props.push(makeKey(kc.col, kc.row))
}

// ── cave archetype (a real SEASONAL cavern) ─────────────────────────────────
// Cellular automata (the 4-5 rule, per docs/ALGORITHMS.md §2) carves an ORGANIC
// cavern; flood-fill keeps ONE connected floor; a south ENTRANCE chamber joins it.
// The SEASON drives the whole look + features: floor + wall tone, water/ice/lava
// pools, crystal colour, and whether moss + mushrooms grow. Every feature cell KIND
// maps to an ASCII glyph+colour AND an emoji tint (rock → 🪨, crystal → 💎, mushroom →
// 🍄, pool ground → 🟦; see game/artStyle.ts), so a cave reads in ASCII and Emoji.
const CAVE_FILL = 0.45 // initial random rock probability (40-50% range)
const CAVE_ITERATIONS = 5 // smoothing passes (4-5 gives crisp caverns)

// CavePalette + CAVE_PALETTES now live in zones.ts (single source of truth for palette data).

// The south ENTRANCE, a guaranteed clear starting chamber joined to the cavern.
const ENTRANCE_HALF = 3 // → a 7-wide chamber
const ENTRANCE_HEIGHT = 4

/**
 * A CAVE IS A SPIDER, once the generator says how many pathways run through it.
 *
 * The research was asked for says the same thing twice. A Zelda dungeon is a SPIDER: an entrance, a hub (the
 * body), legs off it, each leg ending somewhere worth reaching, the boss locked off the hub. The "1 exit and 3
 * pathways" IS that spider. WoW's lesson is rhythm, a short run and then a place that looks like somewhere, so
 * every stop gets a CHAMBER rather than a corridor end. Warcraft 3's is the chokepoint, so a gallery pinches
 * and opens along its length, which the plan's SPINE makes safe to do.
 *
 * What this used to be: one cellular-automata blob with a chamber cut into its south edge, and no notion of
 * where you came in or where you could go next. A generator that serves no pathways still gets exactly that.
 */
const CAVE_HUB_RADIUS = [4, 6] as const
const CAVE_STOP_RADIUS = [3, 4] as const
const CAVE_MOUTH_RADIUS = 2
/** Above this the gallery carries its full width; below it it pinches to the spine alone. A chokepoint. */
const CAVE_PINCH = 0.42

/** A blobby chamber: a disc whose radius wobbles per cell, so it reads as a cave rather than a room. The border
 *  is never touched: a cave is enclosed, and its pathways out are MOUTHS, not holes in the rock. */
function carveCaveChamber(rock: boolean[][], centre: RouteCell, radius: number, cols: number, rows: number, rand: Rng, into: Set<string>): void {
  for (let r = centre.row - radius - 1; r <= centre.row + radius + 1; r++) {
    for (let c = centre.col - radius - 1; c <= centre.col + radius + 1; c++) {
      if (!inBounds(c, r, cols, rows) || isEdge(c, r, cols, rows)) continue
      if (Math.hypot(c - centre.col, r - centre.row) > radius - 0.5 + rand()) continue
      rock[r][c] = false
      into.add(`${c},${r}`)
    }
  }
}

/** The spider: a mouth inside every gate, a chamber at the hub and at every stop, galleries between them that
 *  pinch and open. The spine is carved unconditionally, so nothing here can seal a leg off. */
function carveCaveSpider(ctx: ArchetypeContext, rock: boolean[][], plan: RoutePlan): Set<string> {
  const { cols, rows, rand } = ctx
  const chambers = new Set<string>()
  carveCaveChamber(rock, plan.hub, randIntWith(rand, CAVE_HUB_RADIUS[0], CAVE_HUB_RADIUS[1]), cols, rows, rand, chambers)
  for (const stop of plan.deadEnds) {
    carveCaveChamber(rock, stop, randIntWith(rand, CAVE_STOP_RADIUS[0], CAVE_STOP_RADIUS[1]), cols, rows, rand, chambers)
  }
  for (const gate of plan.gates) carveCaveChamber(rock, gate.inside, CAVE_MOUTH_RADIUS, cols, rows, rand, chambers)

  for (const key of plan.spine) {
    const { col, row } = toCell(key)
    if (inBounds(col, row, cols, rows) && !isEdge(col, row, cols, rows)) rock[row][col] = false
  }
  for (const key of plan.cells) {
    if (plan.spine.has(key)) continue
    const { col, row } = toCell(key)
    if (!inBounds(col, row, cols, rows) || isEdge(col, row, cols, rows)) continue
    if (shadeNoise(col * 0.71 + row * 1.31) < CAVE_PINCH) continue // a chokepoint: the spine alone, here
    rock[row][col] = false
  }
  return chambers
}

/** The mouth chamber as a rect, for the passes that reason about "north of the way in". */
const mouthRect = (gate: Gate): Rect => ({
  col: gate.inside.col - CAVE_MOUTH_RADIUS,
  row: gate.inside.row - CAVE_MOUTH_RADIUS,
  w: CAVE_MOUTH_RADIUS * 2 + 1,
  h: CAVE_MOUTH_RADIUS * 2 + 1,
})

/**
 * A CAVE, IN PHASES. Its tunnels ARE its pathways, so the carve is the structure phase and the rock around it
 * is terrain. An interior serves no river option, so its water is the pools its own palette asks for.
 */
const cavePhases: VariantPhases = {
  terrain: ctx => {
    const { cols, rows, zone } = ctx
    const pal = cavePalette(zone) ?? cavePalette('summer')
    if (!pal) { console.warn('[generate] no cave palette served, nothing built'); return }
    forEachCell(cols, rows, (col, row) => { ctx.ground[row][col] = pal.floor })

    const plan = ctx.routes ?? null
    let rock: boolean[][]
    if (plan) {
      rock = makeGrid(cols, rows, () => true)
      ctx.caveChambers = carveCaveSpider(ctx, rock, plan)
      ctx.caveEntrance = mouthRect(plan.entrance)
    } else {
      rock = makeGrid(cols, rows, () => Math.random() < CAVE_FILL)
      for (let i = 0; i < CAVE_ITERATIONS; i++) rock = smoothCave(rock, cols, rows)
      const cavern = keepLargestClearing(rock, cols, rows) // true = rock
      ctx.caveEntrance = carveEntranceChamber(rock, cols, rows)
      joinEntranceToCavern(rock, ctx.caveEntrance, cavern, cols, rows)
    }
    forEachCell(cols, rows, (col, row) => {
      if (isEdge(col, row, cols, rows)) rock[row][col] = true
    })
    commitCaveWalls(ctx, rock, pal)
  },

  water: ctx => {
    const pal = cavePalette(ctx.zone) ?? cavePalette('summer')
    if (!pal || !ctx.caveEntrance) return
    carveCavePools(ctx, pal, ctx.caveEntrance, ctx.caveChambers ?? new Set<string>())
  },

  pathways: ctx => {
    const pal = cavePalette(ctx.zone) ?? cavePalette('summer')
    if (!pal || !ctx.caveEntrance) return
    if (ctx.routes) keepSpineOpen(ctx, ctx.routes, pal)
    reopenCaveEntrance(ctx, pal, ctx.caveEntrance)
    sealStrandedFloor(ctx, (col, row) => makeRockFace(col, row, pal.wall))
  },

  objects: ctx => {
    const pal = cavePalette(ctx.zone) ?? cavePalette('summer')
    if (!pal) return
    paintFloorAccents(ctx, pal)
    scatterCrystalClusters(ctx, pal)
    if (pal.mushrooms) placeMushroomPatch(ctx, pal)
    scatterCaveRubble(ctx, pal)
  },
}

/** Carve the guaranteed south entrance chamber (a clear starting region just inside
 *  the border, centred on the map). Returns its rect so pools/spawn stay clear of it. */
function carveEntranceChamber(rock: boolean[][], cols: number, rows: number): Rect {
  const w = ENTRANCE_HALF * 2 + 1
  const centerCol = Math.floor(cols / 2)
  const col0 = clamp(centerCol - ENTRANCE_HALF, 1, cols - 1 - w)
  const h = Math.min(ENTRANCE_HEIGHT, rows - 2)
  const row0 = rows - 1 - h // just inside the south border (bottom row is the wall)
  for (let r = row0; r < row0 + h; r++) {
    for (let c = col0; c < col0 + w; c++) {
      if (inBounds(c, r, cols, rows) && !isEdge(c, r, cols, rows)) rock[r][c] = false
    }
  }
  return { col: col0, row: row0, w, h }
}

/** Open a wide corridor from the entrance mouth to the nearest cavern cell, so the
 *  starting chamber always reaches the single connected cavern. */
function joinEntranceToCavern(rock: boolean[][], entrance: Rect, cavern: Set<string>, cols: number, rows: number): void {
  const mouth: Cell = { col: entrance.col + Math.floor(entrance.w / 2), row: entrance.row }
  const cells = [...cavern].map(toCell)
  if (cells.length === 0) {
    carveVertical(rock, mouth.col, mouth.row, 1) // no cavern (tiny map) → cut straight up
    return
  }
  const target = cells.reduce((a, b) => (manhattan(mouth, b) < manhattan(mouth, a) ? b : a))
  carveCorridor(rock, mouth, target)
}

/** Commit the seasonal rock walls: every rock cell becomes a blocking wall prop. */
/** Re-open the plan's centre line after the pools: a flooded gallery is a severed leg, and the repair below
 *  would answer it by filling the far side in. */
function keepSpineOpen(ctx: ArchetypeContext, plan: RoutePlan, pal: CavePalette): void {
  const { cols, rows } = ctx
  const open = new Set<string>()
  for (const key of plan.spine) {
    const { col, row } = toCell(key)
    if (inBounds(col, row, cols, rows) && !isEdge(col, row, cols, rows)) open.add(key)
  }
  clearMeadowCells(ctx, open) // drops whatever was placed there and clears the collision
  for (const key of open) {
    const { col, row } = toCell(key)
    ctx.ground[row][col] = pal.floor
  }
}

function commitCaveWalls(ctx: ArchetypeContext, rock: boolean[][], pal: CavePalette): void {
  const { props, collision, cols, rows } = ctx
  forEachCell(cols, rows, (col, row) => {
    if (!rock[row][col]) return
    props.push(makeRockFace(col, row, pal.wall))
    collision[row][col] = true
  })
}

/** Stamp 1-3 seasonal pools onto cavern FLOOR (never carving into rock walls), north
 *  of the entrance. Water + lava block (routed around); frozen ice stays walkable. */
function carveCavePools(ctx: ArchetypeContext, pal: CavePalette, entrance: Rect, keepOut: ReadonlySet<string> = new Set()): void {
  const { collision, cols, rows } = ctx
  const count = 1 + Math.floor(Math.random() * 3)
  const maxRow = Math.max(4, entrance.row - 2) // keep pools clear of the entrance chamber
  for (let i = 0; i < count; i++) {
    let seed: Cell | null = null
    for (let tries = 0; tries < 40 && !seed; tries++) {
      const col = randInt(3, cols - 4)
      const row = randInt(3, maxRow)
      if (!collision[row][col] && !keepOut.has(`${col},${row}`)) seed = { col, row }
    }
    if (seed) stampPool(ctx, pal, seed.col, seed.row, keepOut)
  }
}

/** One organic pool disc (a wobbling radius so it reads natural, not a clean circle),
 *  painted only over existing floor cells. */
/** A pool, and the cells it must not touch.
 *
 * `keepOut` is how a CHAMBER stays dry: the hub is where the pathways meet and a stop is the room at the end of
 * one, and a room you arrive in should not be a lake. Measured before this existed: ten of the twenty five
 * cells around the hub came out as water. The temple's own pool has the same discipline in the other
 * direction, staying strictly inside its room so it cannot seal a doorway. */
function stampPool(ctx: ArchetypeContext, pal: CavePalette, cc: number, cr: number, keepOut: ReadonlySet<string> = new Set()): void {
  const { ground, collision, cols, rows } = ctx
  const radius = 2 + Math.floor(Math.random() * 2) // 2-3
  const phase = Math.random() * Math.PI * 2
  for (let dr = -radius - 1; dr <= radius + 1; dr++) {
    for (let dc = -radius - 1; dc <= radius + 1; dc++) {
      const col = cc + dc
      const row = cr + dr
      if (!inBounds(col, row, cols, rows) || isEdge(col, row, cols, rows)) continue
      if (collision[row][col]) continue // pool sits on floor, never punches through a wall
      if (keepOut.has(`${col},${row}`)) continue // a chamber stays dry
      const reach = radius * (1 + 0.22 * Math.sin(Math.atan2(dr, dc) * 3 + phase))
      if (dc * dc + dr * dr > reach * reach) continue
      ground[row][col] = pal.pool
      collision[row][col] = pal.poolBlocks
    }
  }
}

/** Flood-fill the walkable floor and fill every cell OUTSIDE the largest region with
 *  rock, so the cavern floor is always ONE connected region (no unreachable pockets),
 *  even after blocking pools carve the space. */
/**
 * WALL OFF EVERY POCKET OF FLOOR YOU CANNOT WALK TO, in whatever the place is built of.
 *
 * This was written twice, `repairCaveFloor` and `repairTempleFloor`, identical line for line except for which
 * wall it pushed. An interior answers a stranded pocket by filling it back in with its own masonry, which is
 * one policy; the outdoors answers it differently (`repairFloorConnectivity` bounds the pocket by size and
 * leaves the far bank of a river alone), which is a second policy and stays its own function.
 */
function sealStrandedFloor(ctx: ArchetypeContext, wall: (col: number, row: number) => StageProp): void {
  const { collision, props, cols, rows } = ctx
  const isFloor = (col: number, row: number): boolean => inBounds(col, row, cols, rows) && !collision[row][col]
  const largest = largestFloorRegion(isFloor, cols, rows)
  forEachCell(cols, rows, (col, row) => {
    if (!isFloor(col, row) || largest.has(`${col},${row}`)) return
    collision[row][col] = true
    props.push(wall(col, row)) // a pocket you cannot reach is a hole in the map, so it stops being floor
  })
}

/** Re-join the entrance chamber to the main cavern if a pool severed the corridor between them.
 *
 *  `joinEntranceToCavern` opens that corridor while the map is still a rock grid, but the pools are stamped
 *  AFTER it, and a blocking pool (water/lava) laid across the corridor cuts the entrance off. The floor
 *  repair then keeps the largest region and fills the rest, so the thing it filled was the way in. Measured
 *  on a 120-seed sweep: 4 caves had a fully sealed entrance chamber.
 *
 *  Carving here (rather than teaching the pools to avoid the corridor) keeps the fix where the invariant is:
 *  the entrance must reach the cavern, whatever the pools did. A no-op when they are already connected. */
function reopenCaveEntrance(ctx: ArchetypeContext, pal: CavePalette, entrance: Rect): void {
  const { collision, cols, rows } = ctx
  const isFloor = (col: number, row: number): boolean => inBounds(col, row, cols, rows) && !collision[row][col]
  const mouth: Cell = { col: entrance.col + Math.floor(entrance.w / 2), row: entrance.row }
  // Opening a cell means clearing the rock prop standing there too, or a wall stays drawn over walkable floor.
  const open = (col: number, row: number): void => {
    if (!inBounds(col, row, cols, rows) || isEdge(col, row, cols, rows)) return
    collision[row][col] = false
    ctx.ground[row][col] = pal.floor
    // SPLICE, never reassign: other passes hold a destructured `const { props } = ctx` reference, so swapping
    // the array out orphans their pushes into a detached list (it silently emptied the crystals/mushrooms).
    for (let i = ctx.props.length - 1; i >= 0; i--) {
      const pr = ctx.props[i]
      if (pr.col === col && pr.row === row && pr.blocking) ctx.props.splice(i, 1)
    }
  }

  // 1 · The CHAMBER is floor by definition, it is the room you arrive in. A pool that grew south into it
  //     (they seed north of it, but they spread) left it part-filled, and a half-buried entrance is the same
  //     defect as a severed one. Restore the room the carve intended before worrying about the corridor.
  for (let r = entrance.row; r < entrance.row + entrance.h; r++)
    for (let c = entrance.col; c < entrance.col + entrance.w; c++) open(c, r)

  // 2 · …and JOIN it to the main cavern, if a pool landed across the corridor that used to reach it.
  const largest = largestFloorRegion(isFloor, cols, rows)
  if (largest.size === 0 || largest.has(`${mouth.col},${mouth.row}`)) return // already connected, the common case
  const target = [...largest].map(toCell).reduce((a, b) => (manhattan(mouth, b) < manhattan(mouth, a) ? b : a), toCell([...largest][0]))
  for (let c = Math.min(mouth.col, target.col); c <= Math.max(mouth.col, target.col); c++) open(c, mouth.row)
  for (let r = Math.min(mouth.row, target.row); r <= Math.max(mouth.row, target.row); r++) open(target.col, r)
}

/**
 * Moss, fallen leaves or dune as ORNAMENTS, the way the meadow sprinkles its plots: a few small patches on a
 * loose grid (the meadow's own spacing). It used to roll every floor cell against `accentChance`, which textured a
 * fifth of the floor; `accentChance` is now
 * the chance a grid slot grows a patch, so the served number still says how mossy a season's caves are.
 */
function paintFloorAccents(ctx: ArchetypeContext, pal: CavePalette): void {
  const { ground, collision, cols, rows } = ctx
  for (let gy = 1; gy < rows - 1; gy += CAVE_ORNAMENT_STEP) {
    for (let gx = 1; gx < cols - 1; gx += CAVE_ORNAMENT_STEP) {
      if (Math.random() >= pal.accentChance) continue
      const cc = clamp(gx + randIntWith(Math.random, 0, CAVE_ORNAMENT_STEP - 3), 1, cols - 2)
      const cr = clamp(gy + randIntWith(Math.random, 0, CAVE_ORNAMENT_STEP - 3), 1, rows - 2)
      forEachInPatch(cc, cr, (col, row) => {
        if (!inBounds(col, row, cols, rows) || collision[row][col] || ground[row][col] !== pal.floor) return
        ground[row][col] = pal.accent
      })
    }
  }
}

/** The meadow's plot spacing (`scatterMeadowOrnaments`), reused so a cave's ornaments sit as far apart. */
const CAVE_ORNAMENT_STEP = 8

/** The 3x3 patch around a centre, the size of one meadow ornament plot. */
function forEachInPatch(cc: number, cr: number, visit: (col: number, row: number) => void): void {
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) visit(cc + dc, cr + dr)
}

/** Scatter 2-4 crystal CLUSTERS, each a small blob of gems grown near a wall (a random
 *  walk from a floor cell that touches rock), tinted by the season. Non-blocking. */
function scatterCrystalClusters(ctx: ArchetypeContext, pal: CavePalette): void {
  const { collision, props, cols, rows } = ctx
  const occupied = new Set(props.map(p => `${p.col},${p.row}`))
  const clusters = 2 + Math.floor(Math.random() * 3)
  for (let i = 0; i < clusters; i++) {
    const seed = findFloorNearWall(ctx, occupied)
    if (!seed) continue
    growBlob(seed, 3 + Math.floor(Math.random() * 4), collision, occupied, cols, rows, (col, row) =>
      props.push(makeCrystal(col, row, pal.crystal)),
    )
  }
}

/** Grow ONE clustered mushroom patch on a damp floor spot, dampening the ground to moss
 *  under it where the season is mossy. A real patch (5-12 caps), non-blocking. */
function placeMushroomPatch(ctx: ArchetypeContext, pal: CavePalette): void {
  const { ground, collision, props, cols, rows } = ctx
  const occupied = new Set(props.map(p => `${p.col},${p.row}`))
  const seed = findFloorNearWall(ctx, occupied) ?? firstWalkable(collision, cols, rows)
  growBlob(seed, 5 + Math.floor(Math.random() * 8), collision, occupied, cols, rows, (col, row) => {
    props.push(makeMushroom(col, row))
    if (pal.accent === 'cave_moss' && ground[row][col] === pal.floor) ground[row][col] = pal.accent
  })
}

/** Sprinkle non-blocking stalagmites / rubble / pebbles over the cavern floor so it
 *  reads as living rock rather than empty grey. Tinted from the season's wall tone. */
function scatterCaveRubble(ctx: ArchetypeContext, pal: CavePalette): void {
  const { ground, collision, props, cols, rows } = ctx
  const occupied = new Set(props.map(p => `${p.col},${p.row}`))
  const tone = pal.wall[0]
  forEachCell(cols, rows, (col, row) => {
    if (isEdge(col, row, cols, rows)) return
    if (collision[row][col]) return
    if (occupied.has(`${col},${row}`)) return
    if (ground[row][col] !== pal.floor && ground[row][col] !== pal.accent) return // not on pools
    if (Math.random() > 0.14) return
    props.push(makeCaveDecor(col, row, tone))
  })
}

/** A random floor cell that orthogonally touches a rock wall (where crystals/mushrooms
 *  grow), avoiding cells already holding a prop. Null if none found in a bounded search. */
function findFloorNearWall(ctx: ArchetypeContext, occupied: Set<string>): Cell | null {
  const { collision, cols, rows } = ctx
  for (let tries = 0; tries < 60; tries++) {
    const col = randInt(2, cols - 3)
    const row = randInt(2, rows - 3)
    if (collision[row][col] || occupied.has(`${col},${row}`)) continue
    if (ORTHO.some(([dc, dr]) => collision[row + dr]?.[col + dc])) return { col, row }
  }
  return null
}

/** Random-walk a small blob of `size` cells from `seed`, invoking `place` on each free,
 *  in-bounds floor cell, the shared clustered-placement helper for crystals + mushrooms. */
function growBlob(
  seed: Cell,
  size: number,
  collision: boolean[][],
  occupied: Set<string>,
  cols: number,
  rows: number,
  place: (col: number, row: number) => void,
): void {
  let { col, row } = seed
  let placed = 0
  for (let guard = 0; placed < size && guard < size * 5; guard++) {
    if (inBounds(col, row, cols, rows) && !collision[row][col] && !occupied.has(`${col},${row}`)) {
      place(col, row)
      occupied.add(`${col},${row}`)
      placed++
    }
    col += randInt(-1, 1)
    row += randInt(-1, 1)
  }
}

/** One double-buffered cellular-automata pass (never updates in place). */
function smoothCave(rock: boolean[][], cols: number, rows: number): boolean[][] {
  const next = makeGrid(cols, rows, () => false)
  forEachCell(cols, rows, (col, row) => {
    next[row][col] = nextRockState(rock, col, row, cols, rows)
  })
  return next
}

/** The 4-5 rule: a rock stays rock with >=4 rock neighbours; floor turns to rock
 *  with >=5 rock neighbours (Moore 8-neighbourhood, OOB counts as rock). */
function nextRockState(rock: boolean[][], col: number, row: number, cols: number, rows: number): boolean {
  const walls = countRockNeighbours(rock, col, row, cols, rows)
  if (rock[row][col]) return walls >= 4
  return walls >= 5
}

function countRockNeighbours(rock: boolean[][], col: number, row: number, cols: number, rows: number): number {
  let n = 0
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dc === 0 && dr === 0) continue
      const c = col + dc
      const r = row + dr
      if (!inBounds(c, r, cols, rows) || rock[r][c]) n++ // OOB counts as rock
    }
  }
  return n
}

// ── boss-stage archetype (an ARENA, per GENERATION-SPEC §3 boss-room): a large
//    central open room, walled all around, a short entrance corridor from the
//    south edge, and a single boss anchor at the far/north side. ──────────────
const ARENA_MARGIN = 3 // cells of wall between the arena and the grid edge
const ARENA_CORRIDOR_WIDTH = 4

/**
 * A BOSS STAGE, IN PHASES. The arena walls are terrain, the corridor in is the pathway, and the boss anchor
 * and the dressing are objects.
 */
const bossStagePhases: VariantPhases = {
  terrain: ctx => {
    const { cols, rows } = ctx
    const arena = arenaRect(cols, rows)
    const wall = makeGrid(cols, rows, () => true)
    openArena(wall, arena)
    openEntranceCorridor(wall, arena, rows)
    commitArenaWalls(ctx, wall)
    paveArena(ctx, arena)
  },

  objects: ctx => {
    const arena = arenaRect(ctx.cols, ctx.rows)
    placeBossAnchor(ctx, arena)
    decorateArena(ctx, arena)
    scatterGroundCover(ctx, 0.15) // light detail on any unpaved ground around the arena (skips stone)
  },
}

/** Floor the open arena with ancient stone (reads as a built hall, not raw ground). */
function paveArena(ctx: ArchetypeContext, arena: Rect): void {
  const { ground, collision, cols, rows } = ctx
  for (let dy = 0; dy < arena.h; dy++) {
    for (let dx = 0; dx < arena.w; dx++) {
      const c = arena.col + dx
      const r = arena.row + dy
      if (inBounds(c, r, cols, rows) && !collision[r][c]) ground[r][c] = ARENA_STONE
    }
  }
}

/** A deliberate arena: corner braziers, a boss dais (flanking pillars), a rune ring
 *  around the centre, and a sparse approach colonnade, aisle + entrance stay open. */
function decorateArena(ctx: ArchetypeContext, arena: Rect): void {
  const { ground, collision, cols, rows } = ctx
  const cx = arenaCenterCol(arena)
  const centerRow = arena.row + Math.floor(arena.h / 2)

  placeProp(ctx, makeBrazier(arena.col + 1, arena.row + 1))
  placeProp(ctx, makeBrazier(arena.col + arena.w - 2, arena.row + 1))
  placeProp(ctx, makeBrazier(arena.col + 1, arena.row + arena.h - 2))
  placeProp(ctx, makeBrazier(arena.col + arena.w - 2, arena.row + arena.h - 2))

  placeProp(ctx, makePillar(cx - 2, arena.row + 1)) // dais flanking the boss
  placeProp(ctx, makePillar(cx + 2, arena.row + 1))

  const ringR = Math.max(2, Math.min(arena.w, arena.h) / 2 - 3)
  for (let a = 0; a < 360; a += 18) {
    const c = Math.round(cx + Math.cos((a * Math.PI) / 180) * ringR)
    const r = Math.round(centerRow + Math.sin((a * Math.PI) / 180) * ringR * 0.7)
    if (inBounds(c, r, cols, rows) && !collision[r][c]) ground[r][c] = 'rune_floor'
  }

  for (let r = arena.row + 4; r < arena.row + arena.h - 3; r += 3) {
    placeProp(ctx, makePillar(cx - 4, r))
    placeProp(ctx, makePillar(cx + 4, r))
  }
}

interface Rect {
  col: number
  row: number
  w: number
  h: number
}

const arenaRect = (cols: number, rows: number): Rect => ({
  col: ARENA_MARGIN,
  row: ARENA_MARGIN,
  w: Math.max(1, cols - ARENA_MARGIN * 2),
  h: Math.max(1, rows - ARENA_MARGIN * 2),
})

const arenaCenterCol = (arena: Rect): number => arena.col + Math.floor(arena.w / 2)

/** Clear the arena rectangle open. */
function openArena(wall: boolean[][], arena: Rect): void {
  for (let dy = 0; dy < arena.h; dy++) {
    for (let dx = 0; dx < arena.w; dx++) {
      wall[arena.row + dy][arena.col + dx] = false
    }
  }
}

/** A short corridor from the south edge up into the arena's bottom. */
function openEntranceCorridor(wall: boolean[][], arena: Rect, rows: number): void {
  const center = arenaCenterCol(arena)
  const half = Math.floor(ARENA_CORRIDOR_WIDTH / 2)
  for (let row = arena.row + arena.h; row < rows; row++) {
    for (let w = -half; w <= half; w++) {
      const col = center + w
      if (col >= 0 && col < wall[row].length) wall[row][col] = false
    }
  }
}

function commitArenaWalls(ctx: ArchetypeContext, wall: boolean[][]): void {
  const { props, collision, cols, rows } = ctx
  forEachCell(cols, rows, (col, row) => {
    // An arena's boundary is a WALL. It was `makeRock`, so it was drawn as a ring of boulders lying on the
    // floor rather than as something you cannot get past, the same mistake the cave's walls carried.
    if (!wall[row][col]) return
    props.push(makeRockFace(col, row, rockShades()))
    collision[row][col] = true
  })
}

/** The lone boss anchor at the far (north) side of the arena, centered. */
function placeBossAnchor(ctx: ArchetypeContext, arena: Rect): void {
  const { props, collision } = ctx
  const col = arenaCenterCol(arena)
  const row = arena.row + 1 // one cell in from the north wall
  props.push(makeBossAnchor(col, row))
  collision[row][col] = true
}

/** Just inside the entrance: the way in is where you start. Null when this map planned no pathways, or when the cell
 *  ended up blocked anyway, and then the old chain picks the spawn. */
function routeSpawn(ctx: ArchetypeContext): { col: number; row: number } | null {
  const inside = ctx.routes?.entrance.inside
  if (!inside || !inBounds(inside.col, inside.row, ctx.cols, ctx.rows)) return null
  return ctx.collision[inside.row][inside.col] ? null : { col: inside.col, row: inside.row }
}

// ── spawn selection (guard-clause fallback chain) ───────────────────
function chooseSpawn(buildings: PlacedBuilding[], collision: boolean[][], cols: number, rows: number): Cell {
  return (
    spawnInFrontOfVillage(buildings, collision, cols, rows) ??
    walkableNearCenter(collision, cols, rows) ??
    firstWalkable(collision, cols, rows)
  )
}

function spawnInFrontOfVillage(
  buildings: PlacedBuilding[],
  collision: boolean[][],
  cols: number,
  rows: number,
): Cell | null {
  if (buildings.length === 0) return null
  const mid = buildings[Math.floor(buildings.length / 2)]
  const col = Math.min(cols - 1, mid.col + Math.floor(mid.length / 2))
  const row = Math.min(rows - 1, mid.row + 3)
  if (collision[row][col]) return null
  return { col, row }
}

/** Spiral out from the grid center to the nearest walkable cell. */
function walkableNearCenter(collision: boolean[][], cols: number, rows: number): Cell | null {
  const cc = Math.floor(cols / 2)
  const cr = Math.floor(rows / 2)
  for (let radius = 0; radius < Math.max(cols, rows); radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (radius > 0 && Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue
        const col = cc + dx
        const row = cr + dy
        if (inBounds(col, row, cols, rows) && !collision[row][col]) return { col, row }
      }
    }
  }
  return null
}

function firstWalkable(collision: boolean[][], cols: number, rows: number): Cell {
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (!collision[row][col]) return { col, row }
    }
  }
  return { col: 0, row: 0 }
}

// ── visual mapping (shared by the template mapper + the live-grid applier) ──
export interface StagePaint {
  ground: { col: number; row: number; type: string; color?: string }[]
  assets: { col: number; row: number; char: string; type: string; color: string; blocking: boolean; label?: string; baseShadow?: boolean; buildingType?: string; edge?: BuildingEdge; footprint?: number; height?: number }[]
}

export function stagePaint(stage: StageData): StagePaint {
  const ground: StagePaint['ground'] = []
  const assets: StagePaint['assets'] = []
  stage.buildings.forEach(b => paintBuildingGround(b, ground))
  stage.props.forEach(p =>
    assets.push({ col: p.col, row: p.row, char: p.char, type: p.type, color: p.color, blocking: p.blocking, label: p.label, baseShadow: p.baseShadow, buildingType: p.buildingType, edge: p.edge, footprint: p.footprint, height: p.height }),
  )
  return { ground, assets }
}

// Step from a building's door toward the road it faces (across the setback front-yard).
const FACING_STEP: Readonly<Record<Facing, readonly [number, number]>> = {
  south: [0, 1],
  north: [0, -1],
  east: [1, 0],
  west: [-1, 0],
}

/** A building's ground: a DRIVEWAY (path_stone) crossing the setback yard from the door to its
 *  street. NO plaza is painted under the footprint anymore, the small footprint is fully covered
 *  by its own building cells (a roof from above), and the surrounding yard stays the natural ground
 *  (grass). This kills the old facade-height-deep plaza sprawl. */
function paintBuildingGround(b: PlacedBuilding, ground: StagePaint['ground']): void {
  const [dc, dr] = FACING_STEP[b.facing]
  // The setback yard cell in front of EACH door cell, paved as the driveway, a 2-wide door gets a
  // 2-wide drive so the paving matches the full (now fully walkable) entrance.
  // Flat, like every other open floor, wearing the paving stone's colour.
  for (const door of b.doorCells) {
    const col = door.col + dc
    const row = door.row + dr
    ground.push({ col, row, type: FLAT_FLOOR, color: groundTileColor(PLAZA_STONE, col, row) })
  }
}

export interface StageTemplatePayload {
  name: string
  groundData: string[][]
  heightData: number[][]
  assetsData: Array<Record<string, unknown>>
  connectors: Connector[]
  cols: number
  rows: number
  cellSize: number
  isoScale: number
  spawnCol: number
  spawnRow: number
}

/** Expand ONE recorded composition ANCHOR (a tree, a building, a decor piece) into the per-cell tile records a
 *  SAVE carries, through the SAME per-cell mapping the LIVE stamp uses (`compositionCellRender`), so what was
 *  generated is what reloads. Cherry-picking the fields here is what broke the round-trip: dropping the cell's
 *  `settings` collapsed the 2-wide entrance to one block and broke the roof's z-width span, and forcing
 *  `height: 1` stood the flat doorstep up as a kerb. Cells outside the map are skipped; `rotation` is the
 *  building's facing quarter-turns (0 for trees/decor, which are never rotated).
 *
 *  A vertical RUN is NOT collapsed here (span 1): the backend authors same-tile runs pre-collapsed as one
 *  `settings.scaleY` cell (TILESET-AUTHORING §3 "minimal cells"), so the live stamp's run-collapse is a
 *  no-op safety net and both paths emit the same blocks. */
function anchorAssets(stage: StageData, kind: string, anchorCol: number, anchorRow: number, variant: number, rotation: number): Array<Record<string, unknown>> {
  const comp = resolveComposition(styleCatalog('ascii'), kind)
  if (!comp) return []
  const { w, h } = comp.footprint
  // The composition lands ON TOP of the floor tile at its anchor, the SAME level the live stamp gets from the
  // shared stack (`cellStackTop`): 1 on a raised meadow/water floor so a trunk sits on the block top, 0 on a flat
  // town floor so settlements save byte-identical. A floor is a tile, so this is just its block height.
  const baseLevel = groundBlockHeight(stage.ground[anchorRow]?.[anchorCol] ?? '')
  const assets: Array<Record<string, unknown>> = []
  for (const c of comp.cells) {
    const off = rotation ? rotateFootprintOffset(c.dx, c.dy, w, h, rotation) : { dx: c.dx, dy: c.dy }
    const col = anchorCol + off.dx
    const row = anchorRow + off.dy
    if (col < 0 || row < 0 || col >= stage.cols || row >= stage.rows) continue
    const tile = resolveTile(styleCatalog('ascii'), stage.zone, c.label, variant)
    assets.push({
      art: [tile.char],
      col,
      row,
      type: kind,
      blocking: !c.walkable,
      color: tile.color,
      label: c.label,
      footprint: undefined,
      tileOverride: undefined,
      ...compositionCellRender(comp, c, tile, 1, rotation, baseLevel),
    })
  }
  return assets
}

/** Map StageData onto the persisted Template shape so the editor can render it.
 *  Terrain height stays 0, blocks are collision, not elevation. */
export function stageToTemplate(stage: StageData, name: string): StageTemplatePayload {
  const groundData = stage.ground.map(r => [...r])
  // RELIEF SURVIVES A SAVE. This was a field of zeros, so a dug channel was flat again the moment you
  // reloaded. `elevation` absent → zeros, exactly as before.
  const heightData = stage.collision.map((r, row) => r.map((_, col) => stage.elevation?.[row]?.[col] ?? 0))
  const paint = stagePaint(stage)
  paint.ground.forEach(g => {
    groundData[g.row][g.col] = g.type
  })
  const assetsData: Array<Record<string, unknown>> = paint.assets.map(a => ({
    art: [a.char],
    col: a.col,
    row: a.row,
    type: a.type,
    blocking: a.blocking,
    color: a.color,
    // NO hardcoded height, the renderer reads each tile's OWN block-height from the DB (a flat decor is 0.1,
    // a standing prop ≥1), so a saved generated map matches the LIVE applyStageToGrid path (which also leaves
    // height to the tile). Height is DATA, never forced here.
    label: a.label,
    footprint: a.footprint,
    // The prop lands ON TOP of its floor tile, the SAME level the live path gets from the shared stack
    // (`cellStackTop`): 0 on a flat town floor, 1 on a height-1 meadow, so a saved ornament sits on the raised
    // floor with no embed. A floor is a tile, so this is just its block height.
    heightLevel: groundBlockHeight(stage.ground[a.row]?.[a.col] ?? ''),
    // Keep the curated catalog skin the live grid stamps (applyStageToGrid) so a SAVED generated map
    // reloads with the same palette tiles, same per-zone/role dispatch, so the two paths never diverge.
    tileOverride: stagePropTileOverride(stage.zone, a.type),
    // Per-instance render for standing props (a flower = single billboard, height 1), the SAME override the
    // live grid applies, so save/load matches. Spreads height + settings.display when the type has one.
    ...generatedPropRender(a.type, a.label),
  }))

  // TREES, BUILDINGS and DECOR (the plaza centrepiece + the street lamps) are all recorded as composition
  // ANCHORS, the generator places no baked props for them. Expand each through the SAME per-cell path the
  // live grid stamps (stampComposition), so a saved stage carries exactly what was generated: the doorstep's
  // flat floor height, the entrance + roof z-width spans, the wall piers' collapsed heights, the fountain's
  // animation. A building is rotated to face its road; trees/decor are never rotated.
  for (const t of stage.trees) assetsData.push(...anchorAssets(stage, t.kind, t.col, t.row, t.variant, 0))
  for (const b of stage.buildings) {
    // b.col + b.row are the footprint TOP-LEFT col and BOTTOM row → back the row off its height to reach the
    // composition's top-left anchor.
    assetsData.push(...anchorAssets(stage, b.kind, b.col, b.row - (b.height - 1), 0, facingRotation(b.facing)))
  }
  // …and the anchor's own rotation, so a SAVED bridge lies the way it was generated. This passed 0, which
  // would have straightened every bridge on reload while the live map showed it correctly: the worst kind of
  // half-wired field, because only a save-and-reload would reveal it.
  for (const c of stage.compositions) assetsData.push(...anchorAssets(stage, c.kind, c.col, c.row, c.variant ?? 0, c.rotation ?? 0))

  return {
    name,
    groundData,
    heightData,
    assetsData,
    connectors: stage.connectors,
    cols: stage.cols,
    rows: stage.rows,
    cellSize: 16,
    isoScale: 1.4,
    spawnCol: stage.spawn.col,
    spawnRow: stage.spawn.row,
  }
}
