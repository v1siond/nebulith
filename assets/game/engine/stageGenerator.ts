/**
 * Stage generator for Nebulith (GENERATION-SPEC §3).
 *
 * Turns a small input — (zone, variant) — into coherent StageData: themed
 * ground, archetype layouts (modeled on real reference levels), collision
 * (blocks are logical, not elevation), props, and a walkable spawn.
 *
 * Pure logic (no rendering, no IsometricGrid mutation) so it is unit-testable
 * and reusable by the editor, the template mapper, and the eventual AI generator.
 */
import { styleCatalog, styleTile } from '@/engine/tileset/styleTiles'
import { type BuildingType } from './buildingTypes'
import { buildingCompositionKind, buildingDoorOffset, facingRotation, isRoadGround, rotateFootprintOffset } from './buildingCatalog'
import { composedKind } from '@/lib/buildingSizes'
import { type BuildingSizes, type SettlementTuning, planVillage, type VillageLayout, type Settlement, type Plot, type Facing, type PlazaRect } from './villageLayout'
// The planner is pure: it takes the building sizes rather than reading them. They come from the BACKEND
// compositions (buildingCatalog resolves them), so deepening a building in Elixir moves the plots with it.
import { BACKEND_BUILDING_SIZES } from './buildingCatalog'
import { type GeneratorCrossing, type GeneratorFormation, type GeneratorPalette, type GeneratorSubZone, type GeneratorTreeWeight, type GeneratorOptionValue } from '@/lib/generatorCatalog'
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
import { autotilePosition, type CellLabel } from './cellLabels'
import { resolveTile, resolveComposition, canopyCount, pickGroundDecor, type TileDisplay } from './tileset/tileset'
import { groundKind } from '@/game/artStyle'
import { resolveTileHeight } from './tileset/tileHeight'

/** The block height of the FLOOR tile at a ground slug — a floor is a TILE, so this is the shared height
 *  primitive (`resolveTileHeight`), read style-identically from the ascii twin. The SAVE path bakes it as the
 *  level a stamped composition/prop lands at, because it serializes StageData WITHOUT a grid; the LIVE path gets
 *  the identical value from the real stack (`cellStackTop`). No `floorStackLift` special case — just a tile's height. */
function groundBlockHeight(slug: string): number {
  return resolveTileHeight(styleTile('ascii', slug) ?? styleTile('ascii', groundKind(slug)), undefined)
}
// The ONE per-cell mapping the live composition stamp uses — the save path expands its anchors through it too,
// so a generated stage RELOADS exactly as it was stamped (height / z-width / scale / pose / animations).
import { compositionCellRender } from '@/game/runtime/composition'
import { varyIntensity } from './colors'
import { groundTileColor } from './tileset/groundColor'
import type { Connector } from '@/lib/api'
import { clamp, randInt, randIntWith, manhattan, makeRng, type Rng } from '@/lib/math'
import { planRoutes, resolveWays, type Gate, type RouteCell, type RoutePlan } from '@/engine/pathNetwork'

export type VariantId = 'town' | 'city' | 'forest' | 'cave' | 'temple' | 'boss-stage'

/**
 * The independent GENERATION LAYERS a stage is built from — the "macro" randomize scopes the user
 * steers (whole map vs just this layer). Each maps to a seedable pass over the current grid:
 *   layout    — terrain/ground distribution + roads/plots (the "map without structures nor nature"),
 *   buildings — the compositions stamped on the layout's plots,
 *   nature    — trees / bushes / flowers / ground cover,
 *   decor     — small props (plaza centrepiece, lamp posts),
 *   units     — enemy/npc scatter (owned by the editor's entity store, not the generator).
 * A given layer re-rolls in isolation by handing it a fresh seed while the others keep theirs.
 */
export type LayerId = 'layout' | 'buildings' | 'nature' | 'decor' | 'units'
export const LAYER_IDS: readonly LayerId[] = ['layout', 'buildings', 'nature', 'decor', 'units']

/** The engine-owned layers (units are scattered by the editor). Each settlement pass draws from its
 *  own seedable rng so one layer re-rolls without disturbing the others. */
export type EngineLayerId = Exclude<LayerId, 'units'>
type LayerRngs = Record<EngineLayerId, Rng>

/** General forest LAYOUT the user steers; the generator randomizes the rest. The old passages/open/lake
 *  generators were RETIRED (Alexander) — the forest now builds one of the meadow layouts, and a plain generate
 *  with no explicit layout RANDOMLY picks one (seeded). All are registered in FOREST_LAYOUTS. `meadow_pass` is a
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
  /** Cell-label naming this cell's part (e.g. tree_leaf_top, tree_interior).
   *  Drives per-label collision + the eventual ASCII→tileset mapping. */
  label?: string
  /** For building cells: the building's TYPE (store/hospital/…), so the render can
   *  badge the apex (a "STORE" marquee, a red hospital cross). */
  buildingType?: string
  /** For building cells: the cell's corner/edge/interior class within the footprint
   *  rect (nw/n/ne/w/interior/e/sw/s/se) — the directional info a tileset maps. */
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
  /** Logical GROUND depth (perpendicular to the facade) — drives the iso box z-extrusion and is
   *  DECOUPLED from the facade's vertical elevation (`facade.height`). */
  depth: number
  /** The planner's road-derived facing — the building composition is stamped rotated to face this road. */
  facing: Facing
  doorCells: { col: number; row: number }[]
  /** The backend composition NAME (e.g. `house_4`, `store_5`) this plot stamps — the data-driven
   *  replacement for the retired `facade: ComposedBuilding`. applyStageToGrid stamps it via
   *  stampBuildingComposition, rotated to `facing`. */
  kind: string
}

/** A TREE anchor — the trunk-base cell + which composition (tree / tree_dead) + its canopy shade. The
 *  generator RECORDS these (it does not bake flat tree props); at load applyStageToGrid re-stamps each via
 *  stampComposition into per-cell heightLevel-stacked DB tiles — the SAME model buildings use (a PlacedBuilding
 *  is stamped by stampBuildingComposition). That makes every tree tile individually SELECTABLE + backend-driven. */
export interface TreeAnchor {
  col: number
  row: number
  /** A living-tree SHAPE variant (2-tile trunk+leaf composition: standard / tall / small / round, or a
   *  trunkless bush) picked by pickLivingTree so a stand shows variety — used for ALL living trees (glade AND
   *  forest-mass). tree_dead = a leafless snag, UNCHANGED (kept blocking so dead trees still obstruct). */
  kind: LivingTreeKind | 'tree_dead'
  variant: number
}

/** A generic COMPOSITION anchor — a named backend composition (fountain / …) stamped at load, the SAME
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
  /** Non-tree, non-building compositions (the plaza fountain today) — stamped at load. */
  compositions: CompositionAnchor[]
  /** Per-cell FLOOR COLOUR the generator writes as STATE (the meadow season gradient + earth/cobble/river
   *  patches) — MAP-MODEL §4: colour is per-cell DATA the generator PICKS, the render READS (never derives).
   *  `undefined` at a cell = use the ground tile's own DB colour (groundTileColor). applyStageToGrid +
   *  stageToTemplate read it so live + saved maps carry the same gradient. */
  floorColors: (string | undefined)[][]
  /**
   * PER-CELL ELEVATION, in levels, 0 being the walking floor and NEGATIVE being dug out.
   *
   * Alexander, 2026-09-11: *"we need the river without water, which is negative height compared to walking
   * floor / then inside that we put water with X height it can be < 1, but not walkable"*, and *"we have the
   * grid height precisely to deal with things like this we need to implement relieve/relief"*.
   *
   * The grid has carried a per-cell height since the beginning and it has always been all zeros, because
   * `applyStageToGrid` wrote 0 into every cell of every generate and the save path wrote a field of zeros.
   * This is where a generator says otherwise. Absent, or absent at a cell, means flat, which is what every
   * template does today, so nothing changes for one that does not ask.
   */
  elevation?: number[][]
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
  /** The generator's options as the person set them (`{river: true}`) — a variation, not a new template. */
  options?: Readonly<Record<string, GeneratorOptionValue>>
  /**
   * WHICH SHAPE of its kind this map builds: a forest's `woodland`, a settlement's `modern_city`.
   *
   * A plain string, not `ForestLayout`, since 2026-09-11: a settlement's presets are its LOOKS now
   * (Alexander: *"instead of "town" "city" we'd have modern city, swamp village, etc"*), and passing
   * `modern_city` through a type called ForestLayout would be a lie the compiler happily told. Only
   * `placeForest` resolves it today, and it checks membership before it does.
   */
  layout?: string
  /** Per-layer SEED. A layer given a seed draws from a reproducible `makeRng(seed)` stream; a layer
   *  left out draws from the global `Math.random` (today's behaviour). This is the macro-randomize
   *  seam: re-roll one layer by changing only its seed and regenerating — the other layers, fed the
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
   * and nothing read it, so every value in it had a hand-kept twin in `villageLayout` — `houseWidths`,
   * `plazaSize`, `setback`, `roadWidth`, `lotGap`, `maxPerFrontage`, `buildingCap`, `houseRange` and
   * `houseWidths`. The whole block passes through now; absent → the planner uses its own defaults.
   */
  settlement?: SettlementTuning
  /** The served COLOURS for this template (`config.palette`). Absent → this generator states none and the
   *  layout paints nothing, keeping the ground tile's own colour. Never substituted for here. */
  palette?: GeneratorPalette
  /** The REGIONS this template partitions itself into (`config.subZones`). Absent → one uniform map. */
  subZones?: readonly GeneratorSubZone[]
  /** How this template DISTRIBUTES its trees (`config.formation`) — grouping, spacing, understory. */
  formation?: GeneratorFormation
  /** WHICH trees grow here (`config.trees`). Named `treeMix` because the stage already has a `trees` list,
   *  the anchors. Absent → the global weighted table. */
  treeMix?: readonly GeneratorTreeWeight[]
  /** What a river is crossed on, by kind (`config.crossings`), picked by the `bridge` option. */
  crossings?: Readonly<Record<string, GeneratorCrossing>>
  /**
   * Where footprints come from. Alexander, 2026-09-09: *"even the footprint should come from backend, then
   * frontend draws."* Defaults to the composition-backed source so a caller that does not care (every
   * test) is unaffected.
   */
  buildingSizes?: BuildingSizes
}

/**
 * How much stuff a generator wants on the ground, as fractions of its cells.
 *
 * `canopy` is new and is what makes a FOREST a forest: the share of cells carrying a tree. The meadow
 * layouts do not read it — they are clearings by definition, framed rather than filled.
 */
export interface NatureDensity {
  /** Grass / ground-cover ornaments, 0–1. */
  groundCover?: number
  /** Flowers, 0–1. */
  flowers?: number
  /** Tree cover, 0–1. A woodland reads as woodland from about 0.35 up. */
  canopy?: number
  /** The share of open floor standing in walkable LONG GRASS, 0 to 1. Absent means none. */
  tallGrass?: number
}

type Cell = { col: number; row: number }
type Plant = (col: number, row: number) => void

// ── small pure helpers ──────────────────────────────────────────────
const inBounds = (col: number, row: number, cols: number, rows: number): boolean =>
  col >= 0 && col < cols && row >= 0 && row < rows
const isEdge = (col: number, row: number, cols: number, rows: number): boolean =>
  col === 0 || row === 0 || col === cols - 1 || row === rows - 1

function makeGrid<T>(cols: number, rows: number, fill: () => T): T[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, fill))
}

function forEachCell(cols: number, rows: number, visit: (col: number, row: number) => void): void {
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) visit(col, row)
  }
}

// A deterministic [0,1) value from a seed — drives leaf/flower intensity variety WITHOUT
// consuming the layout RNG, so generation stays reproducible. Coherent per seed.
const shadeNoise = (seed: number): number => {
  const h = Math.abs(Math.sin(seed * 12.9898) * 43758.5453)
  return h - Math.floor(h)
}

// A canopy tonal variant for a tree-MASS cell, derived from its position so the
// canopy varies in coherent ~2×2 patches (contrast without per-cell noise).
const massVariant = (col: number, row: number): number =>
  Math.floor(col / 2) * 7 + Math.floor(row / 2) * 13

/** Pick a living-tree composition kind by WEIGHT from a [0,1) roll — `Math.random()` for the glade/town
 *  scatter, a position hash for the coherent forest mass. This is the randomization the ticket asks for:
 *  a stand shows standard / tall / small / round trees + bushes instead of one repeated shape. Pure +
 *  injectable (tests pass explicit rolls to prove the full spread). */
export function pickLivingTree(rand: number, mix?: readonly GeneratorTreeWeight[]): LivingTreeKind {
  // A template's OWN species first. Alexander, 2026-09-11: *"we're using the same for all forest variations,
  // but that's not good"* — every forest rolled this one global table, so a jungle grew what a meadow grew.
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

/** One blocking biome-feature cell (mountain / peak / spill) — appearance from
 *  the tileset's per-zone feature palette (ember crater in lava, snowcap + blue
 *  waterfall otherwise). Always blocks (it's terrain). */
// Walkable flowers read from the zone's curated bloom set (ZONE_FLOWERS in zones.ts).
/**
 * A THICKET: the undergrowth you cannot push through, drawn as itself.
 *
 * Alexander, 2026-09-11: *"some collisions are actually dumb lol, we are using collissions in flowers / like, I
 * get it on trees, but flowers? come on, let's have some common sense when doing these generators / it's easy to
 * know which things should be walkable and which shouldn't."* The undergrowth pass used to place the same little
 * clover a meadow uses and then stamp `collision = true` over it, so what you saw was walkable and what you hit
 * was a wall. This is the thing that blocks, and it looks like it.
 */
const makeThicket = (zone: ZoneId, col: number, row: number): StageProp => {
  const tile = resolveTile(styleCatalog('ascii'), zone, 'thicket')
  return { col, row, type: 'thicket', char: tile.char, label: 'thicket', blocking: true, color: tile.color }
}

/** LONG GRASS you walk INTO: *"look pokemon they ahve regular grass and regular roads, but ALSO, have different
 *  type of long grass where pokemon appears, that long grass is walkable"*. Walkable, so `placeProp` leaves the
 *  cell open. */
const makeTallGrass = (zone: ZoneId, col: number, row: number): StageProp => {
  const tile = resolveTile(styleCatalog('ascii'), zone, 'tall_grass')
  return { col, row, type: 'tall_grass', char: tile.char, label: 'tall_grass', blocking: false, color: tile.color }
}

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
    if (BUILT_FLOOR.has(ground[row][col]) || isRoadGround(ground[row][col])) return // keep paving and roads clear
    if (occupied.has(`${col},${row}`)) return
    if (shadeNoise(Math.floor(col / TALL_GRASS_PATCH) * 2.3 + Math.floor(row / TALL_GRASS_PATCH) * 3.7) > share) return
    placeProp(ctx, makeTallGrass(ctx.zone, col, row))
  })
}

const makeFlower = (rng: Rng, zone: ZoneId, col: number, row: number, regionSet?: readonly FlowerKind[]): StageProp => {
  // A REGION's own blooms beat the season's. Alexander, 2026-09-12: *"does that look like a swamp to you?? where
  // have you seen swamps with white flowers??"*. A sub-zone could already say which SPECIES grow in it
  // (`trees`) and had no way to say which BLOOMS, so a swamp planted the season's set, and summer's carries
  // `✽ #f4f4ec`, a near-white. Measured in a swamp jungle before this: whites among the blooms, as he saw.
  const set = regionSet ?? zoneFlowers(zone) ?? defaultFlowers()
  const pick: FlowerKind = set[randIntWith(rng, 0, set.length - 1)] // seeded pick — the caller passes its layer rng so the pass stays reproducible
  // Each flower gets its own intensity tone (per-cell) for a naturally varied meadow — tone only, no opacity.
  // LABEL 'flower' routes it through the label→image path (render/shared.labelTileImage) so it draws the BAKED
  // flower tile in EVERY style (ascii + emoji), colour-composited — never a per-style glyph (ASCII_STYLE.map is
  // empty, so a label-less prop would fall to the legacy '+' glyph drawer). The colour stays a per-instance tint.
  return { col, row, type: 'flower', char: pick.char, label: 'flower', blocking: false, color: varyIntensity(pick.color, shadeNoise(col * 2.7 + row * 3.1)) }
}

/** Per-instance RENDER the generator stamps onto specific prop TYPES — the SAME per-asset settings a hand-painter
 *  would set (they ride the normal stage save/load; NO tile-definition change, NO migration). A flower stands as
 *  ONE centered billboard a block tall (`display: 'single'` + `height: 1`) with a TRANSPARENT block — just the
 *  bloom shows, no coloured cube around it. A type with no entry keeps the tile's own flat render, as before. */
export const GENERATED_PROP_RENDER: Readonly<Record<string, { height?: number; display?: TileDisplay; transparent?: boolean; scale?: number }>> = {
  // A flower AND a scattered ground-decor bloom both render as ONE small SINGLE billboard with a TRANSPARENT
  // block (Alexander 2026-07-27: "make flowers single transparent and slightly smaller… I used zoom 1") — so a
  // daisy shows as a small bloom on the grass, NOT a coloured cube. scale < 1 = slightly smaller than a full cell.
  flower: { height: 1, display: 'single', transparent: true, scale: 0.85 },
  ground_decor: { height: 1, display: 'single', transparent: true, scale: 0.85 },
}

/** The GridAsset overrides (`height` + `scale` + `settings`) a generated prop of `type` carries — ONE source BOTH
 *  the live grid (applyStageToGrid) and the saved payload (stageToTemplate) apply, so the two paths never diverge.
 *  Returns {} for a type with no override (the default tile-driven flat render). */
export function generatedPropRender(type: string): { height?: number; scale?: number; settings?: { display?: TileDisplay; transparent?: boolean } } {
  const o = GENERATED_PROP_RENDER[type]
  if (!o) return {}
  const out: { height?: number; scale?: number; settings?: { display?: TileDisplay; transparent?: boolean } } = {}
  if (o.height !== undefined) out.height = o.height
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
  label: 'rock', // baked 'rock' tile (both styles) — draws the image, not the '▓' glyph, under ascii
  blocking: true,
  color: rockShade(col, row),
})

// ── cave feature cells (all SEASONAL) — every KIND maps to an ASCII glyph+color AND
//    an emoji tint (see game/artStyle.ts): wall/rubble → 🪨, crystal → 💎, mushroom → 🍄.
// Non-blocking cave-floor DECOR: stalagmites + rubble + pebbles, tinted from the
// season's rock tone so they read as living rock against the cavern walls.
const makeCaveDecor = (col: number, row: number, tone: string): StageProp => ({
  col, row, type: 'cave_decor',
  char: caveDecor()[Math.abs(col * 5 + row * 7) % caveDecor().length],
  blocking: false,
  color: varyIntensity(tone, shadeNoise(col * 1.7 + row * 2.3)),
})

// A crystal-cluster cell — a glowing gem tinted by the season (blossom-violet spring,
// cyan summer, amber autumn, icy winter, gold desert, ember lava). Non-blocking.
const makeCrystal = (col: number, row: number, tint: string): StageProp => ({
  col, row, type: 'crystal',
  char: Math.abs(col + row) % 2 === 0 ? '◆' : '◇',
  label: 'crystal', // baked 'crystal' tile (both styles) — draws the image, not the '◆' glyph, under ascii
  blocking: false,
  color: varyIntensity(tint, shadeNoise(col * 3.1 + row * 1.9)),
})

// A cave mushroom (damp seasons only) — a red/tan toadstool on the floor. Non-blocking.
// Cap tone from the zone-data mushroomTones() palette (zones.ts).
const makeMushroom = (col: number, row: number): StageProp => ({
  col, row, type: 'mushroom', char: '♠', label: 'mushroom', blocking: false,
  color: mushroomTones()[Math.abs(col * 3 + row * 5) % mushroomTones().length],
})

// One blocking cave WALL cell — the rock boundary + internal formations. Tonal per
// season (pale ice-rock in winter, warm sandstone in desert, charred basalt in lava,
// mossy grey otherwise) so a cavern reads by season the way the forest does.
const makeCaveWall = (col: number, row: number, shades: readonly string[]): StageProp => ({
  col, row, type: 'rock',
  char: Math.abs(col * 5 + row * 3) % 7 === 0 ? '▒' : '▓',
  label: 'rock', // baked 'rock' tile (both styles) — cave walls draw the image, not the '▓' glyph, under ascii
  blocking: true,
  color: shades[Math.abs(col * 7 + row * 13) % shades.length],
})

// Non-blocking zone GROUND DECOR (grass/litter/pebbles/embers) — the density layer. Each decor variant
// is a backend TILE (category 'decor', its own settings.colors per zone); pickGroundDecor selects one
// deterministically from the loaded tileset and resolves its glyph + zone colour. Null when the tileset
// carries no decor for the zone (e.g. before load) — the caller then skips the cell.
export const makeGroundDecor = (zone: ZoneId, col: number, row: number): StageProp | null => {
  const d = pickGroundDecor(styleCatalog('ascii'), zone, col, row)
  if (!d) return null
  // Carry the decor tile's LABEL so the render resolves its BAKED image (labelTileImage) per active style —
  // decor draws its own tile image, colour-composited, NOT a glyph (see render/shared.groundDecorImage).
  return { col, row, type: 'ground_decor', char: d.char, blocking: false, color: d.color, label: d.label }
}

/** Fill most empty, walkable, non-edge cells with non-blocking zone ground decor so a
 *  stage reads DENSE instead of blank. Skips cells that already hold a prop, and leaves
 *  ~(1-density) of cells clear so the floor still reads as navigable. Decor never blocks,
 *  so walkable connectivity is unchanged. */
// Built/paved floors should NOT get nature decor (no grass on marble) — they're
// already detailed by their tile pattern.
const BUILT_FLOOR: ReadonlySet<string> = new Set(['marble', 'gold_tile', 'ancient_stone', 'plaza', 'path_stone', 'rune_floor'])

function scatterGroundCover(ctx: ArchetypeContext, density = 0.18, layout?: VillageLayout): void {
  const { props, collision, ground, cols, rows, zone } = ctx
  const occupied = new Set(props.map(p => `${p.col},${p.row}`))
  const fill: StageProp[] = []
  forEachCell(cols, rows, (col, row) => {
    if (isEdge(col, row, cols, rows)) return
    if (collision[row][col]) return // walkable floor only
    if (isWaterGround(ground[row][col])) return // land-only: no ground cover in water
    if (BUILT_FLOOR.has(ground[row][col]) || isRoadGround(ground[row][col]) || layout?.roads[row]?.[col]) return // keep paved floors + ROADS clean (roads are colour-only now → layout.roads)
    if (occupied.has(`${col},${row}`)) return // don't cover trees / buildings / decor
    if (ctx.rand() > density) return // breathing room
    const prop = makeGroundDecor(zone, col, row)
    if (prop) fill.push(prop) // no decor tile for this zone (tileset not loaded) → leave the cell bare
  })
  props.push(...fill)
}

/** Scatter standing BLOOMS over a settlement's OPEN grass (skips edges, collisions, paved/built floor, roads, and
 *  cells already holding a prop). Only flowering zones bloom (ZONE_FLOWERS). Each rides GENERATED_PROP_RENDER →
 *  a single billboard a block tall — so the town's grass gets actual flowers, not just the flat ground tufts
 *  scatterGroundCover lays down. */
function scatterFlowers(ctx: ArchetypeContext, density: number, layout?: VillageLayout): void {
  const { props, collision, ground, cols, rows, zone } = ctx
  if (zoneFlowers(zone) === undefined) return // non-flowering zone → no blooms
  const occupied = new Set(props.map(p => `${p.col},${p.row}`))
  const fresh: StageProp[] = []
  forEachCell(cols, rows, (col, row) => {
    if (isEdge(col, row, cols, rows)) return
    if (collision[row][col]) return // walkable grass only
    if (isWaterGround(ground[row][col])) return // land-only: no blooms in water
    if (BUILT_FLOOR.has(ground[row][col]) || isRoadGround(ground[row][col]) || layout?.roads[row]?.[col]) return // keep streets/paved clean (roads are colour-only now → layout.roads)
    if (occupied.has(`${col},${row}`)) return // don't cover trees / buildings / decor
    if (ctx.rand() > density) return
    fresh.push(makeFlower(ctx.rand, zone, col, row)) // seeded pick → the nature layer stays reproducible per-seed
  })
  props.push(...fresh)
}

// Structural decor for temple / boss arena / village (readable single-glyph props). Glyph + fallback
// colour come from the zone-data propArt() table (zones.ts); a caller passes the zone's tint to override.
const makePillar = (col: number, row: number, color = propArt().pillar.color): StageProp => ({ col, row, type: 'pillar', char: propArt().pillar.char, blocking: true, color })
const makeBrazier = (col: number, row: number): StageProp => ({ col, row, type: 'brazier', char: propArt().brazier.char, blocking: true, color: propArt().brazier.color })
const makeAltar = (col: number, row: number, color = propArt().altar.color): StageProp => ({ col, row, type: 'altar', char: propArt().altar.char, blocking: true, color })

// ── temple-interior feature cells (all SEASONAL) — every KIND maps to an ASCII glyph+color
//    AND an emoji tint (see game/artStyle.ts): temple_wall → 🧱, pillar → 🏛️, altar → 🗿,
//    torch → 🔥, hazard → 🔺, key → 🗝️, the gateway door → 🚪.
// One blocking temple WALL cell — the dungeon's stone boundary + inner walls, tinted per
// season (mossy marble in spring, sandstone in desert, frozen blue in winter, basalt in lava)
// so a temple reads by season the way the cavern does.
const makeTempleWall = (col: number, row: number, shades: readonly string[]): StageProp => ({
  col, row, type: 'temple_wall',
  char: Math.abs(col * 5 + row * 3) % 6 === 0 ? '▓' : '█',
  blocking: true,
  color: shades[Math.abs(col * 7 + row * 13) % shades.length],
})

// A wall TORCH — a mounted flame lighting the halls. Non-blocking (a sconce you pass under),
// so it can never pinch off the walkable floor.
const makeTorch = (col: number, row: number, color: string): StageProp => ({ col, row, type: 'torch', char: propArt().torch.char, blocking: false, color })

// A floor HAZARD — spike/pit trap tile. Non-blocking (you CAN step on it — it would deal
// damage in play), so hazards never disconnect the dungeon floor. Season-tinted.
const makeHazard = (col: number, row: number, char: string, color: string): StageProp => ({ col, row, type: 'hazard', char, blocking: false, color })

// The boss-door KEY — a collectible on the floor of a side room. Non-blocking.
const makeKey = (col: number, row: number): StageProp => ({ col, row, type: 'key', char: '⚷', blocking: false, color: '#ffd24a' })

// A gateway/threshold prop marking the (narratively locked) boss door — WALKABLE (label
// 'door'), so it reskins as 🚪 and the floor stays one connected region.
const makeGateway = (col: number, row: number, color: string): StageProp => ({ col, row, type: 'door', char: '∏', blocking: false, color, label: 'door' })
// The two town-square WATER VARIANTS, each a backend COMPOSITION (rim + water) stamped at load — no special
// prop. Each footprint MUST match its Nebulith composition so the plaza reserve/centre matches what the stamp
// fills: the small `well` (5w × 3d, a 1×3 water line) vs the grand `fountain` (5w × 5d, a 3×3 water grid).
const CENTREPIECE_FOOTPRINT = { well: { w: 5, h: 3 }, fountain: { w: 5, h: 5 } } as const
type Centrepiece = keyof typeof CENTREPIECE_FOOTPRINT
// Pick the water variant by settlement SIZE (kept simple): a small town square gets the modest `well` (3
// animated water columns), a grand city square gets the big `fountain` (a 3×3 basin, its centre 3 animated).
// The plaza side is the settlement tell — PLAZA_SIZE is town 5 / city 7 (villageLayout), so ≥6 ⇒ city.
const pickCentrepiece = (plazaSize: number): Centrepiece => (plazaSize >= 6 ? 'fountain' : 'well')
/** How many of a settlement's lamps are FAILING (flickering) bulbs — a SMALL, RANDOM *absolute* count, NEVER a
 *  fraction of the lamp count (Alexander: "the flicker should be a random thing that only 1 or 2 lamps get and
 *  it's not even 100% of the time"). Usually 1, sometimes 2, occasionally 0 — so it stays "only 1 or 2" whether
 *  the settlement has 6 lamps or 20. The old per-cell ratio hash tagged ~a quarter of every map's lamps (a town
 *  got 2–3, a city 3–4 flickering — reading as "all of them"). Drawn from the DECOR rng, so a decor re-roll
 *  picks a different tiny set. */
function failingLampTarget(rand: Rng): number {
  const r = rand()
  if (r < 0.25) return 0
  return r < 0.8 ? 1 : 2
}

/** Flip a tiny RANDOM subset of the placed lamps to the flickering `lamp_post_failing` variant, leaving the rest
 *  the steady `lamp_post` (lit at night, dark in day). The subset is an ABSOLUTE count (failingLampTarget, ≤ 2),
 *  chosen with a partial Fisher–Yates over the decor rng — independent of how many lamps exist, so the flicker
 *  stays a rare minority on a town AND a city, and re-rolls with the decor layer. */
function markFailingLamps(rand: Rng, lamps: CompositionAnchor[]): void {
  const target = Math.min(lamps.length, failingLampTarget(rand))
  const order = lamps.map((_, i) => i)
  for (let i = 0; i < target; i++) {
    const j = i + Math.floor(rand() * (order.length - i))
    ;[order[i], order[j]] = [order[j], order[i]]
    lamps[order[i]].kind = 'lamp_post_failing'
  }
}

/** Record a STEADY LIGHT POST at (col,row) as a composition anchor — a `post` base (level 0) + the `lamp` on top
 *  (level 1) — and pre-block its 1×1 cell so generation-time decor (trees) stays off it, exactly like
 *  placeCentrepiece pre-blocks the fountain. Returns the recorded anchor (or null if it didn't fit) so the
 *  caller can flip a tiny random subset to the failing variant afterwards (markFailingLamps). applyStageToGrid
 *  stamps it via stampComposition, the SAME data path the fountain uses, so ascii and emoji render the IDENTICAL
 *  post+lamp structure (only the tile art differs). */
function placeLampPost(ctx: ArchetypeContext, col: number, row: number): CompositionAnchor | null {
  if (!inBounds(col, row, ctx.cols, ctx.rows) || ctx.collision[row][col]) return null
  if (!isLandCell(ctx, col, row)) return null // land-only: no lamp post in water
  const anchor: CompositionAnchor = { kind: 'lamp_post', col, row }
  ctx.compositions.push(anchor)
  ctx.collision[row][col] = true
  return anchor
}

/** Place a prop iff the cell is in-bounds + not already blocked; set collision when blocking. */
function placeProp(ctx: ArchetypeContext, prop: StageProp): void {
  const { props, collision, cols, rows } = ctx
  if (!inBounds(prop.col, prop.row, cols, rows)) return
  if (collision[prop.row][prop.col]) return
  if (!isLandCell(ctx, prop.col, prop.row)) return // land-only: no prop (flower / rock / …) in water
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
// touches water/ice/lava, stamp a non-blocking edge decor — a shoreline ripple, a
// frosty rim, or a charred ember crust — so coastlines/lava banks read as blended.
const WATER_LIKE = new Set(['water', 'ice_water', 'oasis', 'koi'])
const LAVA_LIKE = new Set(['lava', 'magma'])

/** THE reusable LAND-ONLY guard (Alexander): NOTHING — a prop, tree, lamp, ornament, rock, unit or spawn — may
 *  sit on a WATER cell; only the bridge deck crosses water. Reads the GROUND directly so every generator + the
 *  placement primitives share ONE check instead of a per-type special case. A cell is water when its ground tile
 *  is water-like (the meadow river, a lake, oasis, koi pond, deep/ice water, …). */
const isWaterGround = (g: string | undefined): boolean => !!g && (WATER_LIKE.has(g) || g.includes('water'))
const isLandCell = (ctx: ArchetypeContext, col: number, row: number): boolean =>
  inBounds(col, row, ctx.cols, ctx.rows) && !isWaterGround(ctx.ground[row][col])

function edgeDecor(neighbourType: string, col: number, row: number): StageProp | null {
  // ANY water, not the four names in WATER_LIKE. The depth pass renames a cell `water_shallow` or `water_deep`,
  // so a deep pool used to border the land with no shoreline at all, which is half of why his swamp read as
  // *"really really confusing"*: nothing marked where the water began.
  // WATER IS A REAL TILE NOW. It used to return a single `≈` prop with a hardcoded colour whichever side the
  // water was on; `shorePiece` picks one of the 8 baked edge/corner pieces instead. Lava keeps its ember.
  if (isWaterGround(neighbourType)) return null
  if (LAVA_LIKE.has(neighbourType)) {
    return { col, row, type: 'ember', char: '▒', blocking: false, color: '#d2691e' }
  }
  return null
}

/**
 * THE SHORELINE, as real tiles instead of a character.
 *
 * Alexander, 2026-09-12: *"you usually need border and animation"*. These are the 8 baked edge and corner
 * pieces (`shore_*`, named the way `canopy_*` and `wall_stone_*` already are), picked by the SAME 9-piece
 * autotile scheme trees and buildings use, so a bank reads as a bank and a corner reads as a corner.
 *
 * There is no `_c` piece: the centre of water is the water tile itself, so a land cell with water on no side
 * is not a shore at all.
 */
const SHORE_SUFFIX: Readonly<Record<string, string>> = {
  'TOP-LEFT': 'tl', TOP: 't', 'TOP-RIGHT': 'tr',
  LEFT: 'l', RIGHT: 'r',
  'BOTTOM-LEFT': 'bl', BOTTOM: 'b', 'BOTTOM-RIGHT': 'br',
}

/**
 * The shore piece for a LAND cell that touches water, or null when it touches none.
 *
 * The LAND is the autotile mass, so an OPEN side is where the water is and the piece faces it. Out of bounds
 * counts as LAND on purpose: off-map is not water, and treating it as open made a map-edge cell pick a corner
 * piece with no water anywhere near it.
 *
 * It goes out as `ground_decor` carrying the piece's LABEL, which is the seam that draws a flat overlay sheared
 * onto the ground diamond and resolves its baked image per active style (`groundDecorImage`). A labelled prop of
 * any other type would take the labelled-tile path and stand a BLOCK up on the bank.
 */
function shorePiece(ctx: ArchetypeContext, col: number, row: number): StageProp | null {
  const { ground, cols, rows, zone } = ctx
  const wet = (c: number, r: number): boolean => inBounds(c, r, cols, rows) && isWaterGround(ground[r][c])
  if (!ORTHO.some(([dc, dr]) => wet(col + dc, row + dr))) return null
  const notWater = (c: number, r: number): boolean => !inBounds(c, r, cols, rows) || !isWaterGround(ground[r][c])
  const suffix = SHORE_SUFFIX[autotilePosition(notWater, col, row)]
  if (!suffix) return null // INTERIOR: no open side, so there is no edge to draw
  // Frost keeps the winter look the character version had, as a per-cell COLOUR the render reads.
  const icy = ORTHO.some(([dc, dr]) => inBounds(col + dc, row + dr, cols, rows) && ground[row + dr][col + dc] === 'ice_water')
  return { col, row, type: 'ground_decor', char: '', label: `shore_${suffix}`, blocking: false, color: zone === 'winter' || icy ? '#bfe6f5' : '#eaf8ff' }
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
      // WATER first, as a positioned piece read from all four neighbours rather than the first one found.
      const shore = shorePiece(ctx, col, row)
      if (shore) {
        edges.push(shore)
        occupied.add(`${col},${row}`)
        continue
      }
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
  /** The crossing this map is built with, decided the first time a deck is laid. null → the classic deck. */
  crossing?: GeneratorCrossing | null
  cols: number
  rows: number
  /** The generator's served nature densities, or undefined when it states none. A layout must treat an
   *  absent value as "no opinion" and never substitute a number of its own — see the compliance rule. */
  nature?: NatureDensity
  /** The served settlement tuning — every number the backend states about a settlement's shape. */
  settlement?: SettlementTuning
  /** The served COLOURS for this template. What makes an Amazonas not a pine wood — every colour in a forest
   *  used to come from the SEASON, so two different forests in spring were painted identically. */
  palette?: GeneratorPalette
  /** The REGIONS this template partitions itself into — open canopy, dense growth, swamp, ruins. A jungle is
   *  not one uniform density, it is several kinds of ground you walk between. */
  subZones?: readonly GeneratorSubZone[]
  /** How the trees are DISTRIBUTED — a wood pasture, an even-aged stand and a closed canopy differ in this,
   *  not in how many trees they hold. */
  formation?: GeneratorFormation
  /** The species this template grows. A jungle is not a meadow with more trees in it. */
  treeMix?: readonly GeneratorTreeWeight[]
  /** What a river is crossed on, by kind (`config.crossings`), picked by the `bridge` option. */
  crossings?: Readonly<Record<string, GeneratorCrossing>>
  /** Where footprints come from — see `GenerateOptions.buildingSizes`. */
  buildingSizes?: BuildingSizes
  /** The user-steered shape of this kind of place, or undefined for a plain generate (placeForest then
   *  random-picks a meadow layout). Only placeForest resolves it, and it checks membership first. */
  layout: string | undefined
  /** The generator's OPTIONS as the person set them — `{river: true}`. A layout reads the ones it knows. */
  options: Readonly<Record<string, GeneratorOptionValue>> | undefined
  /** The ways through this map, planned BEFORE anything was planted. Undefined → this generator serves no ways
   *  and the layout built exactly the map it always did. */
  routes?: RoutePlan
  /** The active pass's random source. Defaults to `Math.random`; a seeded layer swaps in its own
   *  `makeRng(seed)` stream so the pass reproduces. EVERY stochastic helper draws from this, never
   *  from `Math.random` directly, so a pass is pure given its rng. */
  rand: Rng
}

/** A ctx viewing the same grid through a DIFFERENT random source — the one seam that lets each
 *  settlement pass run on its own seed while sharing the grid it mutates. */
const withRand = (ctx: ArchetypeContext, rand: Rng): ArchetypeContext => ({ ...ctx, rand })

const ARCHETYPES: Partial<Record<VariantId, (ctx: ArchetypeContext, rngs: LayerRngs) => void>> = {
  town: placeTown,
  city: placeCity,
  forest: placeForest,
  temple: placeTemple,
  cave: placeCave,
  'boss-stage': placeBossStage,
}

// ── the floor is a colour ────────────────────────────────────────────────
// Alexander, 2026-09-11: *"look how we handle the floor in meadow, just using different colors and only using the
// floor tiles as ornaments, that's how we wanna do it on all other templates too"*.
//
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

const seasonGround = (ctx: ArchetypeContext): string | undefined => zonePalette(ctx.zone)?.groundTypes[0]

/** The OPEN-GROUND labels of each kind of place, read from the served palettes where they come from there. */
const FLOOR_MATERIALS: Readonly<Record<VariantId, (ctx: ArchetypeContext) => ReadonlyArray<string | undefined>>> = {
  town: ctx => [seasonGround(ctx), PLAZA_STONE],
  city: ctx => [seasonGround(ctx), PLAZA_STONE],
  forest: ctx => [seasonGround(ctx), zonePalette(ctx.zone)?.trail],
  cave: ctx => [(cavePalette(ctx.zone) ?? cavePalette('summer'))?.floor],
  temple: ctx => {
    const pal = templePalette(ctx.zone) ?? templePalette('summer')
    return [pal?.floor, pal?.accent]
  },
  'boss-stage': ctx => [seasonGround(ctx), ARENA_STONE],
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
const layerRng = (seeds: GenerateOptions['seeds'], layer: EngineLayerId): Rng => {
  const seed = seeds?.[layer]
  return seed === undefined ? Math.random : makeRng(seed)
}

/**
 * A PLAIN COLOUR TO WORK ON: every cell the flat floor tile, one colour, and nothing else in it.
 *
 * Alexander, 2026-09-11: *"when you land on a new map, I see the grid base full of random tiles, It'd like to
 * just have a solid color to work on, it can be brown, green like meadow, whatever, just don't use tiles at all,
 * plain color grid base ready to edit"*. Landing on a new template used to lay down a whole generated town.
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

export function generateStage(opts: GenerateOptions): StageData {
  const { zone, variant } = opts
  const cols = opts.cols ?? 40
  const rows = opts.rows ?? 40
  const layout = opts.layout // undefined → placeForest randomly picks a meadow layout (seeded)
  // THE SEASON'S OWN GROUND, from the backend. No palette → no ground: a generate with an unloaded catalog
  // produces an empty map and says so, rather than inventing a green the author never chose.
  const palette = zonePalette(zone)
  if (!palette) console.warn(`[generate] the backend serves no "${zone}" season — the map has no ground`)

  const ground = makeGrid(cols, rows, () => palette?.groundTypes[0] ?? '')
  const collision = makeGrid(cols, rows, () => false)
  const floorColors = makeGrid<string | undefined>(cols, rows, () => undefined)
  // Flat until a pass digs or raises. Alexander, 2026-09-11: *"we have the grid height precisely to deal with
  // things like this we need to implement relieve/relief"*.
  const elevation = makeGrid(cols, rows, () => 0)
  const buildings: PlacedBuilding[] = []
  const props: StageProp[] = []
  const trees: TreeAnchor[] = []
  const compositions: CompositionAnchor[] = []

  // One rng per engine layer. When no seeds are supplied they all alias `Math.random`, so the pass
  // order draws the exact same sequence as before the split — the behaviour-preservation guarantee.
  const rngs: LayerRngs = {
    layout: layerRng(opts.seeds, 'layout'),
    buildings: layerRng(opts.seeds, 'buildings'),
    nature: layerRng(opts.seeds, 'nature'),
    decor: layerRng(opts.seeds, 'decor'),
  }
  // Single-pass archetypes (forest/cave/temple/boss) read `ctx.rand`; the layout rng is their source.
  const ctx: ArchetypeContext = { zone, ground, collision, floorColors, elevation, buildings, props, trees, compositions, cols, rows, layout, options: opts.options, nature: opts.nature, settlement: opts.settlement, palette: opts.palette, subZones: opts.subZones, formation: opts.formation, treeMix: opts.treeMix, crossings: opts.crossings, decks: new Set<string>(), buildingSizes: opts.buildingSizes, rand: rngs.layout }
  ARCHETYPES[variant]?.(ctx, rngs)
  flattenFloors(ctx, FLOOR_MATERIALS[variant]?.(ctx) ?? [])
  addTerrainTransitions(ctx) // blended shorelines / lava banks over the painted ground

  return {
    zone,
    variant,
    cols,
    rows,
    ground,
    collision,
    floorColors,
    elevation,
    buildings,
    props,
    trees,
    compositions,
    connectors: [],
    // WHERE YOU COME IN. A map that planned its ways puts you just inside its entrance, which is the whole point
    // of an entrance; a map that planned none keeps the old choice, so every existing template is unmoved.
    spawn: routeSpawn(ctx) ?? chooseSpawn(buildings, collision, cols, rows),
    routes: ctx.routes ?? null,
  }
}

// ── settlement archetype ─────────────────────────────────────────────
// Nature density by settlement — a town is leafy (lots of trees around the lots); a city is mostly
// paved. Towns lean green here per design.
const NATURE_MULT: Record<Settlement, number> = { town: 1.15, city: 0.4 }

// Hoisted function decls (not const arrows) so ARCHETYPES above can reference them.
function placeTown(ctx: ArchetypeContext, rngs: LayerRngs): void {
  placeSettlement(ctx, 'town', rngs)
}
function placeCity(ctx: ArchetypeContext, rngs: LayerRngs): void {
  placeSettlement(ctx, 'city', rngs)
}

/**
 * Compose a settlement from independent, SEEDABLE layer passes (GENERATION-SPEC §"layer passes"):
 * the layout skeleton → buildings on its plots → decor → nature. Each pass runs on its own rng
 * (`rngs.<layer>`), so a single layer re-rolls in isolation; run together with aliased `Math.random`
 * rngs they reproduce today's town exactly. Order is load-bearing: layout carves roads BEFORE
 * buildings reserve plots, and decor paves the plaza BEFORE nature plants, so no tree lands on the
 * square — the same order this generator always ran, just named + separable now.
 */
function placeSettlement(ctx: ArchetypeContext, settlement: Settlement, rngs: LayerRngs): void {
  const layout = layoutPass(withRand(ctx, rngs.layout), settlement)
  buildingsPass(withRand(ctx, rngs.buildings), layout)
  decorPass(withRand(ctx, rngs.decor), layout)
  naturePass(withRand(ctx, rngs.nature), layout, settlement)
}

/**
 * LAYOUT pass — the "map without structures nor nature": plan a logical road/plot skeleton + a
 * central plaza (villageLayout.planVillage) and carve the streets into the ground as the dark-gray
 * ROAD tile. Returns the plan the later passes build on. This is the layer a "randomize layout only"
 * re-rolls; the caller then clears buildings + nature so only roads/plots/ground remain.
 */
export function layoutPass(ctx: ArchetypeContext, settlement: Settlement): VillageLayout {
  const { ground, cols, rows } = ctx
  // A building's SIZE is backend data (the composition footprints). With none loaded there is no size to plan
  // and nothing to stamp, so the settlement gets NO buildings — a size is never invented (MAP-MODEL §8). Say it
  // out loud: an empty town is a data problem, and the one thing worse than no buildings is silent no buildings.
  if (BACKEND_BUILDING_SIZES.lengthOf('house') === null) {
    console.warn(
      '[stageGenerator] no building compositions are loaded — planting NO buildings. The sizes come from ' +
        '/api/tilesets, which has not installed the tileset yet.',
    )
  }
  const layout = planVillage(cols, rows, ctx.rand, ctx.buildingSizes ?? BACKEND_BUILDING_SIZES, settlement, ctx.settlement)
  // WHAT THIS PLACE PAVES WITH. Alexander, 2026-09-11: *"a town doesn't have roads, it has pathways of stone,
  // cities do have pathways a skycraoppers"*. It was `road` for a town and a city alike, so a village had
  // asphalt through it. The place says it now; with nothing served it stays the road it always was.
  const streets = ctx.settlement?.streets ?? 'road'
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Roads are a COLOUR on the ground BLOCK, not a separate ROAD tile (Alexander #34/#48: "remove the tiles
      // from the roads, we can use color"). The base ground stays (a height-1 block) and is tinted asphalt, so a
      // road is FLUSH with the grass — no raised road-tile trench. Road IDENTITY lives in `layout.roads` (read by
      // placement + scatter), never re-derived from the ground kind.
      if (layout.roads[r][c]) ctx.floorColors[r][c] = groundTileColor(streets, c, r)
    }
  }
  return layout
}

/**
 * BUILDINGS pass — stamp one typed composition on each plot the layout reserved. plot.row/plot.col
 * are the MIN-ROW/MIN-COL of the small `length × depth` footprint rect; placeBuilding blocks every
 * footprint cell (a roof from above) EXCEPT the road-facing door. The composition KIND is a plot
 * decision (its type + facade length name house_4 / store_5 …); per-building appearance variety
 * (material / roof / wall colour) is rolled at load (applyStageToGrid), which is what a
 * "randomize buildings only" re-rolls.
 */
export function buildingsPass(ctx: ArchetypeContext, layout: VillageLayout): void {
  const { buildings, cols, rows } = ctx
  for (const plot of layout.plots) {
    // THE FOOTPRINT THE PLOT ROLLED decides the building, not a baked name. `composedKind` names the
    // composition the backend will lay out for that size; `buildingCompositionKind` named the nearest
    // AUTHORED one, which is the snap Alexander asked to remove — *"we randomize the footprint and house
    // adapts to it."* The editor composes every kind this pass names before the stamp runs.
    const kind = ctx.buildingSizes?.defaultOf
      ? composedKind(plot.type, { w: plot.length, h: plot.depth })
      : buildingCompositionKind(plot.type, plot.length)
    const rect = footprintRect(plot)
    if (!rectInBounds(rect, cols, rows)) continue // planner's rectClear guarantees this; stay safe
    buildings.push(placeBuilding(ctx, plot, rect, kind))
  }
}

/** DECOR pass — the town SQUARE (well/fountain) + street lamps along the frontages. */
export function decorPass(ctx: ArchetypeContext, layout: VillageLayout): void {
  villageDecor(ctx, layout)
}

/** NATURE pass — trees ringing the lots (denser toward the edges) + a light scatter of grass /
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
 * Fill the non-road, non-building cells with trees — denser toward the map EDGES so the
 * village sits in a leafy clearing ringed by forest, sparse in the built core. Reuses the
 * glade-tree stamper (full vertical extent) with blue-noise spacing; never on a street.
 */
function fillVillageNature(ctx: ArchetypeContext, layout: VillageLayout, natureMult = 1): void {
  const { collision, ground, buildings, cols, rows } = ctx
  // Cells occupied by (or hugging) a building — never plant a tree here, so doors + facades
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
    // buildings/roads — a door is walkable, so treeFits alone would happily plant a tree on it. The canopy is
    // walkable overhead, so only the trunk cell is checked.
    if (!treeColumnClearsPaving(ground, col, row)) continue
    if (layout.roads[row]?.[col] || nearBuilding.has(`${col},${row}`)) continue
    if (!treeFits(collision, col, row, cols, rows)) continue
    const sideDist = Math.min(col, cols - 1 - col) // distance from the LEFT/RIGHT edge
    const edgeDist = Math.min(sideDist, row, rows - 1 - row)
    // Denser toward the SIDES — the village sits in a clearing framed by forest left & right — but
    // the INTERIOR stays leafy too (a Pokémon-style town nestled in trees, not bare lots).
    const p = (sideDist < 5 ? 0.82 : edgeDist < 4 ? 0.66 : edgeDist < 9 ? 0.52 : 0.36) * natureMult
    if (ctx.rand() > p) continue
    if (placed.some(t => Math.abs(t.col - col) < minDist && Math.abs(t.row - row) < minDist)) continue
    stampTree(ctx, col, row, ctx.rand() < DEAD_TREE_CHANCE[ctx.zone])
    placed.push({ col, row })
  }
}

/** A village square below the houses: a central well, flanking lamp-posts, and a
 *  short fence line — turns "houses on grass" into a place. */
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
  // check — but a lamp there would block the entrance or stand in the paved drive. Exclude both.
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
  // BEFORE the houses — the settlement's focal landmark, not a leftover-space afterthought.
  placeCentrepiece(ctx, layout.plaza)
  // Lamp posts every ~6 cells along each street's frontage gaps (never on a road or building). Each is a
  // COMPOSITION (post base + lamp on top) stamped at load — NOT a single lamp prop — so both art styles render
  // the same post+lamp structure. Every lamp is placed STEADY; AFTER placement a tiny random subset (≤2) is
  // flipped to the flickering variant, so "only 1 or 2 lamps" flicker no matter how many the settlement has.
  const lamps: CompositionAnchor[] = []
  for (const sr of streetRows) {
    const frontage = sr - 1
    for (let c = 5; c < cols - 4; c += 6) {
      if (!decorFree(c, frontage)) continue
      const anchor = placeLampPost(ctx, c, frontage)
      if (anchor) lamps.push(anchor)
    }
  }
  markFailingLamps(ctx.rand, lamps)
}

/** Stamp the town SQUARE the planner reserved dead-centre BEFORE the houses: pave the whole block
 *  path_stone, then drop ONE big fountain (rarely a pond) at its centre. The fountain is a SINGLE
 *  prop spanning a central odd-sized basin (collision-blocked, you walk the paved ring around it) —
 *  not N clustered mini-structures. A pond fills the same central basin with water instead. */
function placeCentrepiece(ctx: ArchetypeContext, plaza: PlazaRect | null): void {
  if (!plaza) return
  const { cols, rows, ground, collision } = ctx
  const { c0, r0, size } = plaza
  // Pave the whole square as a walkable stone plaza (the ring you stroll around the basin).
  for (let r = r0; r < r0 + size; r++)
    for (let c = c0; c < c0 + size; c++) if (inBounds(c, r, cols, rows)) ground[r][c] = PLAZA_STONE

  // The centrepiece is a COMPOSITION (rim + water), not a special prop: pick the variant by settlement size,
  // record its anchor centred in the square (footprint TOP-LEFT, the origin stampComposition places from).
  // Pre-block its footprint so generation-time decor (lamps/trees) stays off it; the stamp re-derives
  // collision from its cells at load.
  const kind = pickCentrepiece(size)
  const { w: fw, h: fh } = CENTREPIECE_FOOTPRINT[kind]
  const fc0 = c0 + Math.floor((size - fw) / 2)
  const fr0 = r0 + Math.floor((size - fh) / 2)
  for (let r = fr0; r < fr0 + fh; r++)
    for (let c = fc0; c < fc0 + fw; c++) if (inBounds(c, r, cols, rows)) collision[r][c] = true
  ctx.compositions.push({ kind, col: fc0, row: fr0, variant: 0 })
}

/** Footprint rect type — the cells a building actually occupies on the grid. */
interface FootRect {
  col: number
  row: number
  w: number
  h: number
}

/** The oriented GROUND footprint rect for a plot: south/north run length×depth (cols×rows); east/west
 *  swap to depth×length. `plot.col`/`plot.row` are the rect's top-left. Mirrors villageLayout's
 *  `footprint`, so the stamp lands exactly on the small road-free plot the planner reserved. */
function footprintRect(plot: Plot): FootRect {
  const horizontal = plot.facing === 'south' || plot.facing === 'north'
  return { col: plot.col, row: plot.row, w: horizontal ? plot.length : plot.depth, h: horizontal ? plot.depth : plot.length }
}

const rectInBounds = (rect: FootRect, cols: number, rows: number): boolean =>
  rect.col >= 0 && rect.row >= 0 && rect.col + rect.w <= cols && rect.row + rect.h <= rows

/**
 * A building cell's CORNER / EDGE / INTERIOR class within its GROUND footprint rect —
 * the directional sub-classification a real tileset needs (a corner tile ≠ an edge
 * tile ≠ an interior fill tile). The 9 classes laid out on the rect:
 *
 *     nw   n   ne
 *      w   ·   e        (· = interior)
 *     sw   s   se
 *
 * Derived from the cell's position in the grid-aligned footprint rect (length × depth),
 * NOT facade-relative — so it maps straight onto the cells a tileset paints on the ground.
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
// labels can guide future tile replacement. The format is `<TYPE> <POSITION>` — the same
// scheme buildings already use ("BUILDING NE") generalized to every multi-cell asset, and
// IDENTICAL across the top / 2D / iso views because all three build their captions through
// these PURE helpers (no view computes a label on its own).

// A footprint edge CLASS (n/s/e/w/nw/ne/sw/se/interior) → the ONE shared POSITION vocabulary
// (TOP/BOTTOM/LEFT/RIGHT + hyphenated corners + INTERIOR) that terrain autotiling also uses, so a
// building/fountain cell reads the SAME token format as a grass cell — the consistency the tileset
// swap needs. Mirrors cellLabels.SLOT_TOKEN (compass class ↔ autotile slot).
const EDGE_TOKEN: Readonly<Record<string, string>> = {
  n: 'TOP', s: 'BOTTOM', e: 'RIGHT', w: 'LEFT',
  nw: 'TOP-LEFT', ne: 'TOP-RIGHT', sw: 'BOTTOM-LEFT', se: 'BOTTOM-RIGHT',
  interior: 'INTERIOR',
}

/** The POSITION token for a footprint cell — corner/edge/interior CLASS → the shared display token
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
// maps its 9-piece leaf label to a canopy SIDE (NW…SE / INTERIOR) — so a tree mass labels exactly
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
 *  token — footprintSide for footprint elements, treeSubpart for trees, '' for single-cell assets. */
export function labelForCell(type: string, pos = ''): string {
  const t = type.toUpperCase()
  return pos ? `${t} ${pos}` : t
}

/**
 * Where ONE facade offset lands on the grid, per facing — the SAME quarter-turn `rotateFootprintOffset`
 * applies when the stamp rotates a south-baked composition to face its road. A door tile authored at
 * `(dx, dy = depth-1)` rotates to: south → the bottom edge at +dx; north (180°) → the top edge mirrored;
 * west (90° CW) → the left edge at row +dx; east (270°) → the right edge mirrored down the rows. Deriving
 * the opening through the SAME geometry is what stops it drifting from the doorway that gets drawn.
 * Dispatch map, not an if/else chain — a new facing is a new row here.
 */
const DOOR_CELL_AT: Readonly<Record<Facing, (rect: FootRect, offset: number) => Cell>> = {
  south: (rect, offset) => ({ col: rect.col + offset, row: rect.row + rect.h - 1 }),
  north: (rect, offset) => ({ col: rect.col + rect.w - 1 - offset, row: rect.row }),
  west: (rect, offset) => ({ col: rect.col, row: rect.row + offset }),
  east: (rect, offset) => ({ col: rect.col + rect.w - 1, row: rect.row + rect.h - 1 - offset }),
}

/**
 * The walkable DOOR cells — the building's way in — on the footprint's ROAD-FACING edge. Every OTHER
 * footprint cell blocks.
 *
 * The opening spans the FULL drawn door on EVERY facing (G7: *"the walk-in ENTRANCE opening must ALWAYS
 * match the door's width"*). `door` is the composition's own door span along its south-baked facade
 * (`buildingDoorOffset`), and each offset in `[door.x, door.x + width)` is mapped through `DOOR_CELL_AT` —
 * the stamp's own rotation — so a 2-door facade opens BOTH cells wherever it faces. East/west used to
 * collapse to a single mid-edge cell on the grounds that `draw2DBuilding` drew only one door column there;
 * that drawer is gone (H2 dead-code sweep) and buildings now render through the generic per-cell
 * composition path in all three views, so a rotated 2-door facade really does stamp two door tiles down
 * its edge — one walkable cell left the other half walled off.
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
 * are, which the backend builds from the one `door_cols/1` list that also places the entrance apron — so
 * doors, apron and opening can only ever agree.
 *
 * DEGRADED FALLBACK: the tileset holder starts EMPTY and is filled from `/api/tilesets` at load
 * (MAP-MODEL §8), so an un-loaded (or unknown) kind has no readable door span. We still open a 1-cell
 * centred entrance — a building with NO opening would seal the player out of the stage entirely — but we
 * WARN, because that width is a guess and a wide door would come out half-walled. The shipped app never
 * takes this path: the editor's render gate blocks until the tilesets are installed, so every real
 * generate reads the composition. (It is reachable from a unit test that skips the tileset fixture.)
 */
function facadeDoorSpan(kind: string, facadeLength: number): { x: number; width: number } {
  const span = buildingDoorOffset(kind)
  if (span) return span
  console.warn(
    `[stageGenerator] composition "${kind}" is not in the loaded tileset — opening a GUESSED 1-cell entrance ` +
      `at the facade centre. The real door span is unknown until /api/tilesets installs the tileset.`,
  )
  return { x: Math.floor(facadeLength / 2), width: 1 }
}

/**
 * Reserve a building's small GROUND FOOTPRINT (`rect`, width × depth): pave a stone base and BLOCK every
 * footprint cell (collision true) EXCEPT the road-facing DOOR cells, which stay WALKABLE. This is
 * the collision blueprint spawn/enemy placement reads BEFORE the stamp; the building's actual tiles are
 * stamped from its composition at load (applyStageToGrid → stampBuildingComposition), so we emit NO
 * per-cell building props here — the composition IS the tiles. Returns the placed building's metadata
 * (kind + footprint + door + facing) the nature/decor passes and the load-time stamp use.
 */
function placeBuilding(
  ctx: ArchetypeContext,
  plot: Plot,
  rect: FootRect,
  kind: string,
): PlacedBuilding {
  const { ground, collision, cols, rows } = ctx
  // The walkable entrance + its driveway span the composition's REAL door — an even facade is baked with a
  // centred 2-wide doorway, so a hardcoded 1-cell opening walled off half of it (G7).
  const doors = doorCells(plot.facing, rect, facadeDoorSpan(kind, plot.length))
  const isDoor = new Set(doors.map(d => `${d.col},${d.row}`))
  // A building is a ROOM, not a solid obstacle: its SHELL blocks (walls + windows — you don't walk through a
  // window), the DOORWAY is the way in, and the INTERIOR is walkable floor you move around on. Blanket-blocking
  // the whole rect (the old `!isDoor` line) let the hero stand in the doorway and go nowhere — Alexander,
  // Image #5: "I can't navigate inside the house". Per-cell truth still comes from the composition's own
  // `walkable` flags when it stamps; the generator must not pre-seal what the composition leaves open.
  const lastCol = rect.col + rect.w - 1
  const lastRow = rect.row + rect.h - 1
  for (let row = rect.row; row <= lastRow; row++) {
    for (let col = rect.col; col <= lastCol; col++) {
      if (!inBounds(col, row, cols, rows)) continue
      ground[row][col] = 'path_stone' // brown stone BASE under the building (freed from roads, §2b)
      const shell = col === rect.col || col === lastCol || row === rect.row || row === lastRow
      collision[row][col] = shell && !isDoor.has(`${col},${row}`)
    }
  }
  // `row` = the rect's BOTTOM row; `length`/`height` = the rect's grid span (cols×rows), so the nature
  // math + the load-time stamp read the real small footprint (and its TOP-LEFT) regardless of facing.
  return { type: plot.type, col: rect.col, row: rect.row + rect.h - 1, length: rect.w, height: rect.h, depth: plot.depth, facing: plot.facing, doorCells: doors, kind }
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
  // The forest builds one of the MEADOW layouts (Alexander retired the old passages/open/lake
  // generators). An explicit meadow layout is honoured; a plain generate (no/legacy layout) RANDOMLY
  // picks one — seeded from ctx.rand, so it's reproducible per seed. Dispatch map (Open/Closed).
  // A layout this forest does not know (a settlement's `modern_city`, or nothing at all) rolls a meadow, the
  // same fallback a plain generate always had.
  const named = ctx.layout as ForestLayout | undefined
  const layout = named && FOREST_LAYOUTS[named] ? named : pickMeadowLayout(ctx.rand, ctx.nature)
  FOREST_LAYOUTS[layout]!(ctx)
}

/**
 * Pick a forest layout at random (seeded via the caller's rng) — the forest's default when the user hasn't
 * steered one.
 *
 * ONLY LAYOUTS WHOSE PREREQUISITES ARE MET. `woodland` needs a served `nature.canopy` and correctly plants
 * nothing without it; putting it in the pool unconditionally meant a plain `generateStage({variant:
 * 'forest'})` could roll it and hand back an empty field. That is worse than the old behaviour, because it
 * fails only sometimes — it broke six existing generator tests exactly one run in four.
 *
 * A layout that cannot run is not a candidate. The alternative — letting it run and inventing a canopy
 * density — is the hardcoded fallback the compliance rule forbids.
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
const forestWater = (ctx: ArchetypeContext, legacy: RiverCourse): { river: RiverCourse | null; crossing: boolean } => ({
  river: riverCourse(ctx, legacy),
  crossing: ctx.options?.crossing === true,
})

/**
 * THE RIVER'S COURSE. Alexander, 2026-09-11: *"variants of river usage, maybe it's traversable, maybe it's
 * dividing the map in two half, maybe it's around the map, etc right now is super random, and while I want
 * and think the randomness is good, we need to parametize it a bit more"*.
 *
 *   · `through` — winds across the map edge to edge, and is easy to cross in several places
 *   · `divides` — cuts the map in two, and can be crossed at exactly ONE place
 *   · `around`  — runs around the edge, leaving the way in open
 */
export type RiverCourse = 'through' | 'divides' | 'around'
const RIVER_COURSES: readonly RiverCourse[] = ['through', 'divides', 'around']

/** Resolve the served `river` option to a course, or null for no river. `random` is one of the choices, not
 *  the only behaviour, which is the whole of his note. An old boolean recipe (`river: true`) keeps the river
 *  its layout always had, so a saved map does not change under anyone. */
function riverCourse(ctx: ArchetypeContext, legacy: RiverCourse): RiverCourse | null {
  return resolveRiverCourse(ctx.options?.river, legacy, ctx.rand)
}

/** The pure half of `riverCourse`, exported so "random" can be tested as a DISTRIBUTION rather than guessed
 *  from what a map happens to look like. */
export function resolveRiverCourse(value: GeneratorOptionValue | undefined, legacy: RiverCourse, rand: Rng): RiverCourse | null {
  if (value === undefined || value === false || value === 'none') return null
  if (value === true) return legacy
  if (value === 'random') return RIVER_COURSES[randIntWith(rand, 0, RIVER_COURSES.length - 1)]
  return (RIVER_COURSES as readonly string[]).includes(value) ? (value as RiverCourse) : null
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
    digChannel(ctx, water) // the one course that does not come through carveChannel
    return water
  }
  // `divides` is wide and nearly straight across the middle, so it reads as a barrier; `through` meanders.
  return course === 'divides'
    ? carveChannel(ctx, pal, { half: 2.3, swing: 0.05, horizontal: true })
    : carveChannel(ctx, pal, { half: 1.6, swing: 0.26 })
}

/**
 * Get across it, the way its course says. Several crossings make `through` traversable; exactly ONE makes
 * `divides` a real division; `around` keeps the bridge it always had over its near arm.
 */
function bridgeRiver(ctx: ArchetypeContext, water: Set<string>, routes: Set<string>, course: RiverCourse, joined: boolean, pal: GeneratorPalette | undefined): void {
  if (course === 'around') { crossRiver(ctx, water, routes, joined); return }
  if (joined && placeRiverCrossing(ctx, water, routes)) {
    // The crossing sits ON the path network; a river that is easy to cross gets fords elsewhere too.
    if (course === 'through') fellLogsAcross(ctx, water, pal, [0.2, 0.8])
    return
  }
  fellLogsAcross(ctx, water, pal, course === 'divides' ? [0.5] : [0.25, 0.55, 0.85])
}

/** Forest layout builders, keyed by the user-steered ForestLayout. Each runs on the already-floored ctx
 *  and is fully responsible for the floor gradient / trees / river / ornaments / repair.
 *  Open/Closed: register a layout here, no dispatcher edits. */
const FOREST_LAYOUTS: Readonly<Partial<Record<ForestLayout, (ctx: ArchetypeContext) => void>>> = {
  // A RIVER IS AN OPTION, not a layout. Alexander, 2026-09-10: *"every time we add a new template, the
  // list grows ... that's not sustainable. Instead, we should just have extra options for each template"*.
  // It was already an option INSIDE the builder — `layoutWoodland(ctx, {river: true})` — and only the
  // catalog row and the layout string duplicated per combination. Now the option reaches the builder from
  // the generator's declared options, and `woodland_river` / `meadow_river` are gone as layouts.
  woodland: ctx => layoutWoodland(ctx, { ...forestWater(ctx, 'around'), routes: plannedRoutes(ctx) }),
  // A JUNGLE HAS ITS OWN BUILDER. It used to share the woodland's with heavier numbers, and Alexander was
  // right that density is not the difference: *"there's a huge difference between amazonas and a pines
  // forest"*. Light gaps instead of clearings, a creek instead of trails, blocking undergrowth, emergents.
  jungle: ctx => layoutJungle(ctx, { ...forestWater(ctx, 'through'), routes: plannedRoutes(ctx) }),
  meadow: ctx => buildMeadow(ctx, { ...forestWater(ctx, 'around'), twoWays: false, routes: plannedRoutes(ctx) }),
  meadow_pass: layoutMeadowPass,
}

// ── 'woodland' layout — an ACTUAL forest ──────────────────────────────────────
//
// Alexander, 2026-09-09: *"plus generators aren't good either, like the meadow is not a forest, it doesn't
// look like one."* He is right, and the measurement was blunt: the Forest category's presets produced
// ~10% tree cover scattered at random over an open field. That is a lawn with shrubs on it. Worse, the
// category described itself as "Open meadow and tree masses" and `forest_meadow` as "tree masses filling
// the rest" — both promising something the code never built. `scatterFramingTrees` says so in its own
// comment: *"trees only frame the edges; the centre stays open"*.
//
// A meadow framed by trees is a fine thing and it stays. It is simply not a forest, so the category now
// leads with one.
//
// THE INVERSION. A meadow decides where trees are ALLOWED (a band near the edges) and leaves the rest
// empty. A woodland decides where they are ABSENT — trees are the field, and clearings are carved out of
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

/** Woodland tuning that is NOT the generator's to state — the shape of the algorithm, not its dial. */
const WOODLAND = {
  /**
   * Clearings per 1,000 cells.
   *
   * Alexander, 2026-09-09: *"the woodland is bad, in the sense that, the forest is generated without any
   * roads, there's no way to navigate it."* Two clearings on a small map gave ONE trail between them, which
   * is not a network. Raised so a map always has somewhere to go as well as somewhere to stand.
   */
  clearingsPerThousand: 5,
  /** A clearing's radius range, in cells. */
  clearingRadius: [2, 5] as const,
  /** How wide a path through the trees is. Two cells so a unit never threads a one-cell gap. */
  // Alexander, 2026-09-11: *"the paths through should be, at least 2-3 grid cells wide, in order to walk
  // normally"*. It was 2, the bottom of what he asked for, and a 2-wide corridor with a tree leaning into it
  // walks like a 1-wide one. 3 is the width you can actually move down.
  pathWidth: 3,
} as const

/** What a forest layout is built with: the water options, and the ways through the map. */
interface ForestBuild {
  /** The river's COURSE, or null for none. */
  river?: RiverCourse | null
  /** Put the river's crossing ON the path network rather than at a fixed span. */
  crossing?: boolean
  /** The planned ways in, out and through. null → this generator serves none and the layout builds as it always did. */
  routes?: RoutePlan | null
}

/**
 * THE WAYS THROUGH, resolved once so the three forest layouts cannot drift apart on what an exit or a pathway is.
 *
 * Alexander, 2026-09-11, on a generated map: *"there's no clear pathway at all, nothing that indicates potential
 * connection with other place"*, and *"these paths aren't NOT considered when making the forests, we should always
 * have paths firsts, and ensure the rest is build around it"*. So this runs BEFORE a tree is planted and the plan
 * it returns is the frame the layout builds around, rather than something cut between clearings afterwards.
 *
 * A generator that serves neither count returns null and its layout builds the map it always did, so every saved
 * recipe is untouched.
 */
function plannedRoutes(ctx: ArchetypeContext): RoutePlan | null {
  const ways = resolveWays(ctx.options, ctx.rand)
  if (!ways) return null
  ctx.routes = planRoutes(ctx.cols, ctx.rows, ways, ctx.rand, WOODLAND.pathWidth)
  return ctx.routes
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
 *  Alexander, 2026-09-09: *"add a woodland + river variant too."* Mirrors the meadow pair — one builder, an
 *  options object — so the two never drift apart. A JUNGLE is not here: it is the same STRUCTURE at a heavier
 *  served density, so it is a preset over this builder, not a fourth code path (see FOREST_LAYOUTS). */
function layoutWoodland(ctx: ArchetypeContext, opts: ForestBuild = {}): void {
  const { cols, rows, collision, ground, zone, trees } = ctx
  const canopy = ctx.nature?.canopy
  if (canopy === undefined) {
    console.warn('[generate] this generator serves no `nature.canopy`, so a woodland has no tree density to build from — nothing planted')
    return
  }

  const floor = zonePalette(zone)?.groundTypes[0] ?? ''
  forEachCell(cols, rows, (col, row) => { ground[row][col] = floor })

  // 0a · THE REGIONS. Alexander, 2026-09-11: *"woodland with meadow is the same as mountain forest..."*, and
  //      then 2026-09-12: *"fix 105 properly"*.
  //
  //      I gave glades its stands and meadows and reported the ticket done, and it did NOTHING: only
  //      `layoutJungle` ever called `partitionSubZones`, so a woodland's served regions were parsed and
  //      dropped. Served-and-ignored, the exact defect I keep finding elsewhere, this time mine.
  //
  //      Both forest layouts share the one mechanism now. `subZoneCanopyField` runs `woodlandCanopyField`
  //      once per region, so a map with no regions takes the same single call it always did.
  const zones = leadRegion(ctx, ctx.subZones)
  const zoneAt = partitionSubZones(ctx, zones)
  paintSubZoneFloors(ctx, zoneAt)

  // 0b · RELIEF: a region may stand ABOVE the rest of the map. Alexander, 2026-09-12: *"we need to have
  //      support for different levels of terrain, relieve in spanish"*. A region that states no level is flat,
  //      so every existing template is unmoved.
  raiseRegions(ctx, zoneAt)

  // 0 · THE RIVER, if this variant has one — carved BEFORE anything is planted, so its cells are already
  //     spoken for. It joins `open` (the not-plantable mask) rather than getting its own check, which is why
  //     the canopy pass below needs no river branch at all: water is simply somewhere a tree cannot go.
  const open = new Set<string>()
  const water = opts.river ? carveRiver(ctx, opts.river, ctx.palette) : new Set<string>()
  for (const key of water) open.add(key)

  // 1 · CLEARINGS, as a mask, so the canopy pass can simply avoid them. Deciding the holes before
  //     the fill is cheaper and more controllable than planting everything and cutting back.
  // The corridor cells specifically. `open` also holds the clearings, and paving those would turn every
  // glade into a courtyard — a trail is the route BETWEEN them.
  const trailCells = new Set<string>()
  const clearings: Cell[] = []

  // 1a · THE PATHS, FIRST. *"we should always have paths firsts, and ensure the rest is build around it"*. When
  //      the generator serves the ways, the network is already decided: its cells join `open` so nothing can be
  //      planted on them, and they are paved in step 2b with the rest. A GLADE goes where the paths meet and at
  //      every stop, so a pathway that is not an exit ends somewhere worth walking to rather than in a wall of
  //      trunks. That is where a closed or gated section will go.
  if (opts.routes) {
    for (const key of opts.routes.cells) { open.add(key); trailCells.add(key) }
    clearings.push(opts.routes.hub, ...opts.routes.deadEnds)
    for (const centre of clearings) carveClearing(ctx, centre, open)
  }

  const wanted = Math.max(2, Math.round((cols * rows / 1000) * WOODLAND.clearingsPerThousand))
  for (let i = 0; i < wanted; i++) {
    const centre = {
      col: randIntWith(ctx.rand, 3, Math.max(3, cols - 4)),
      row: randIntWith(ctx.rand, 3, Math.max(3, rows - 4)),
    }
    clearings.push(centre)
    carveClearing(ctx, centre, open)
  }

  // 2 · TRAILS joining the clearings in a chain, so every one is reachable from every other, plus a spur
  //     from the first and last clearing to the map EDGE — a forest you cannot enter or leave is a room.
  //
  //     Alexander, 2026-09-09: *"there's no way to navigate it."* The first version stopped here and only
  //     removed canopy, so a trail was an absence rather than a route: nothing marked it, nothing paved it,
  //     and with two clearings there was one of them. Now the corridors are PAVED (step 2b) and there are
  //     enough of them to form a network.
  for (let i = 1; i < clearings.length; i++) carveWoodlandPath(ctx, clearings[i - 1], clearings[i], open, trailCells)
  // The two spurs to the nearest EDGE are what a forest with no plan uses to avoid being a sealed room. With a
  // plan the gates already run off the border, and a spur would be a way out nobody asked for.
  if (!opts.routes && clearings.length > 0) {
    carveWoodlandPath(ctx, clearings[0], nearestEdgeCell(clearings[0], cols, rows), open, trailCells)
    const last = clearings[clearings.length - 1]
    carveWoodlandPath(ctx, last, nearestEdgeCell(last, cols, rows), open, trailCells)
  }

  // 2b · PAVE them. A trail has to be visible to be a trail — this is the half that was missing. The tile
  //      comes from the zone's palette, so a season can pave its trails differently without a branch here.
  const trail = zonePalette(zone)?.trail ?? ''
  for (const key of trailCells) {
    const [c, r] = key.split(',').map(Number)
    // Not over the river: a trail tile laid on water leaves a blocked stripe of path across it, which is
    // neither a river nor a way over one. Water is crossed on a deck.
    // A trail never paves WATER, of any name. The exact `!== 'water'` let a trail run straight over a puddle
    // once pools began laying `water_shallow`.
    if (inBounds(c, r, cols, rows) && !isWaterGround(ground[r][c])) ground[r][c] = trail
  }

  // 2c · AND PLANK IT where the river runs across it. After the paving, never before: the paving skips water,
  //      so a deck laid first would be paved straight back over.
  if (opts.routes) deckRoutes(ctx, opts.routes, water, ctx.palette?.trail)

  // 3 · CANOPY everywhere else — chosen, not thrown.
  //
  //     Two attempts failed here and both failures are worth keeping, because they are the same mistake
  //     twice: treating a density as an input to a lossy process instead of as the outcome.
  //
  //       (a) `clumps = cells * canopy / radius²`, run that many times. Gave 27% for a configured 42%:
  //           thinning, overlap and clearing-skips all ate cells with nothing accounting for them.
  //       (b) Random anchors until a planted-count target was hit. Hit the number, but the distribution
  //           was ruinous — the loop terminated as soon as the count filled, so wherever the early darts
  //           happened to land became dense forest and the rest of the map stayed bare grass.
  //
  //     So: score EVERY plantable cell with spatially-coherent noise, then take the lowest-scoring
  //     `target` of them. Coverage is exact by construction, and it clumps because neighbouring cells
  //     score alike. Nothing is random-walked and nothing terminates early.
  const field = zones.length > 0
    ? subZoneCanopyField(ctx, open, canopy, zoneAt, zones)
    : woodlandCanopyField(ctx, open, canopy, ctx.formation)
  for (const { col, row } of field) {
    // A region's OWN species where it states them, the template's otherwise: a stand of columns beside a
    // meadow of gnarled singles is the difference you can actually see.
    const kind: LivingTreeKind | 'tree_dead' = ctx.rand() < 0.06 ? 'tree_dead' : pickLivingTree(ctx.rand(), zoneAt[row][col]?.trees ?? ctx.treeMix)
    trees.push({ col, row, kind, variant: massVariant(col, row) })
    collision[row][col] = true // the trunk blocks; the canopy is walkable overhead, as everywhere else
  }

  // 4 · The clearings get whatever ground cover and flowers the generator asked for. Absent → bare.
  dressWoodlandClearings(ctx, open, zoneAt)
  scatterTallGrass(ctx) // patches of walkable long grass, as much as the generator serves

  // 4b · UNDERSTORY between the trunks, when the formation asks for one. Image #15 is a woodland whose hard
  //      part is the FLOOR — deep green growth you cannot walk through, with a narrow trail cut through it —
  //      and no amount of canopy tuning produces that, because it is not about the canopy. A formation that
  //      states no understory runs nothing here, so an ordinary wood is unchanged.
  if (ctx.formation?.understory !== undefined) {
    plantUndergrowth(ctx, open, water, ctx.palette, zoneAt)
    // Undergrowth BLOCKS, so this pinches the floor into islands (363 on one seed). They are joined in step
    // 7, AFTER the river is bridged — see there for why the order matters.
  }

  // 5 · KEEP THE FLOOR ONE PLACE. A river can strand a pocket of forest floor behind it, and a pocket you
  //     cannot walk to is a hole in the map. Only the river variant needs this — a plain woodland carves no
  //     water — and it runs BEFORE the bridge so the repair can never fill the deck back in. Same bound and
  //     same ordering as the meadow's, because it is the same problem.
  if (opts.river) repairFloorConnectivity(ctx, MEADOW_MAX_POCKET)

  // 6 · THE CROSSING, last — a river you cannot cross splits the forest in two, and the deck has to be laid
  //     after the planting so nothing puts a trunk back on it. Same ordering reason as the meadow's.
  //     The trails carved in step 2 are this layout's path network, so a joined crossing lands on one of them
  //     rather than in the middle of the trees — which is the whole of ticket 36.
  if (opts.river) bridgeRiver(ctx, water, trailCells, opts.river, opts.crossing === true, ctx.palette)

  // 7 · ONE PLACE, cutting tracks through the brush to anything the undergrowth walled off. AFTER the bridge,
  //     and that order is a fix, not a preference: run before it, the join saw the far bank of a river as a
  //     stray region and cut a track straight across the water, which made the river walkable. A region the
  //     water separates is joined by its crossing, never by a track.
  if (ctx.formation?.understory !== undefined) joinStrandedRegions(ctx)

  // 8 · The water settles by depth, last.
  settleWaterDepth(ctx, ctx.palette)

  void collision
  void trees
}

// ── 'jungle' — a JUNGLE, not a dense woodland ─────────────────────────────────
//
// Alexander, 2026-09-10: *"right now a jungle is basically the same as woodland in the app, there's not a
// single difference between them"*, *"like there's a huge difference between amazonas and a pines forest"*,
// *"a jungle should follow real jungle patterns"*.
//
// He was right and I had shipped exactly what he objected to: `layoutWoodland` with heavier numbers. Density
// is not the difference between the Amazon and a pine wood. The STRUCTURE is, and it inverts in four ways:
//
//   · A wood has CLEARINGS cut into it, open ground you can walk. A jungle has none. What it has is LIGHT
//     GAPS where a giant fell, small and irregular, and they are the only places the sun reaches the floor.
//   · A wood has TRAILS, straight-ish routes between places. A jungle has no roads. You move along the
//     WATER, so the creek and its banks ARE the route through the map.
//   · A wood's floor is walkable between the trunks. A jungle's is choked — UNDERGROWTH is its own blocking
//     layer, and it is what makes a jungle hard rather than the trunks.
//   · A wood is lit from above and shaded below. A jungle is the other way round: the canopy is the brightest
//     thing on the map because it is the layer getting the sun, and the floor lives in permanent shade.
//
// All four are here. The colours come from the SERVED palette, never from a constant in this file.

const JUNGLE = {
  /** light gaps per 1000 cells — far fewer than the woodland's clearings, and they are not walkable routes. */
  gapsPerThousand: 2.2,
  /** a fallen-giant gap is small: this radius, wobbled. A wood's clearing is 2-5. */
  gapRadius: [2, 3] as const,
  /** the creek's half-width → a ~3 wide watercourse. */
  creekHalf: 1.5,
  /** how far the walkable bank reaches back from the water on each side. */
  bankDepth: 2,
  /** emergent giants per 1000 cells — the few trees standing above the canopy. */
  emergentsPerThousand: 1.6,
}

/**
 * THE JUNGLE. Floor → creek → light gaps → canopy → undergrowth → keep it one place.
 *
 * Ordered so each pass can simply avoid what the ones before it claimed: the creek and the gaps join `open`
 * before the canopy is scored, exactly as the woodland's clearings do, which is why neither the canopy nor
 * the undergrowth pass needs to know what water or a gap is.
 */
function layoutJungle(ctx: ArchetypeContext, opts: ForestBuild = {}): void {
  const { cols, rows, collision, ground, trees } = ctx
  const canopy = ctx.nature?.canopy
  if (canopy === undefined) {
    console.warn('[generate] this generator serves no `nature.canopy`, so a jungle has no tree density to build from — nothing planted')
    return
  }
  const pal = ctx.palette

  // 0 · THE FLOOR, in permanent shade. Mottled over coarse patches rather than one flat fill, because a
  //     jungle floor is litter and roots and standing shade, not lawn. Absent palette → the tile's own colour.
  const floor = zonePalette(ctx.zone)?.groundTypes[0] ?? ''
  forEachCell(cols, rows, (col, row) => { ground[row][col] = floor })
  paintJungleFloor(ctx, pal)

  // 0b · THE REGIONS. A jungle is not one uniform density, it is several kinds of ground you walk between —
  //      open canopy, dense growth, swamp, ruins. Served by the backend, so which regions exist and how much
  //      of the map each claims is data. Absent → one uniform jungle, exactly as before.
  // The region the person picked LEADS this map (Alexander, 2026-09-11: *"on jungle we have "regions" in it,
  // but it's badly implemented, we should just have variations, similar to "which jungle" "which region""*).
  const zones = leadRegion(ctx, ctx.subZones)
  const zoneAt = partitionSubZones(ctx, zones)
  paintSubZoneFloors(ctx, zoneAt)
  // ONE mechanism for both forests: a jungle plateau is the same idea as a wooded ridge. No region serves a
  // level yet, so this is inert until one does.
  raiseRegions(ctx, zoneAt)

  const open = new Set<string>()

  // 1 · THE CREEK — the route through, and the only reliable one. A jungle map without water is a map with
  //     no way across it, so this is not gated on the river OPTION the way the woodland's is: the option
  //     decides whether a WOOD has a river, but a jungle IS built around its watercourse. The option still
  //     reads, and turns the creek into a full river (wider, with a crossing).
  // No course picked → the jungle's own narrow creek; `through` → the same creek, wide; the other courses
  // carve their own channel. A jungle always has water — the option only says what KIND.
  const water = opts.river === 'through' ? carveJungleCreek(ctx, pal, true)
    : opts.river ? carveRiver(ctx, opts.river, pal)
    : carveJungleCreek(ctx, pal, false)
  // 1b · SWAMP POOLS — standing water where a swamp region says so. They join the same water set the creek
  //      is in, so every later pass treats a pool exactly as it treats the channel.
  const pools = floodSwampPools(ctx, zoneAt, pal)
  for (const key of pools) water.add(key)
  const banks = jungleBanks(ctx, water, pal)
  for (const key of banks) open.add(key)

  // 2 · LIGHT GAPS where a giant came down. Small, irregular, and dressed brighter than the floor around
  //     them — they are the only lit ground on the map.
  const gaps = new Set<string>()
  const wanted = Math.max(1, Math.round((cols * rows / 1000) * JUNGLE.gapsPerThousand))
  for (let i = 0; i < wanted; i++) {
    const centre = { col: randIntWith(ctx.rand, 3, Math.max(3, cols - 4)), row: randIntWith(ctx.rand, 3, Math.max(3, rows - 4)) }
    const radius = randIntWith(ctx.rand, JUNGLE.gapRadius[0], JUNGLE.gapRadius[1])
    for (let r = centre.row - radius - 1; r <= centre.row + radius + 1; r++) {
      for (let c = centre.col - radius - 1; c <= centre.col + radius + 1; c++) {
        if (!inBounds(c, r, cols, rows) || water.has(`${c},${r}`)) continue
        if (Math.hypot(c - centre.col, r - centre.row) <= radius - 0.5 + ctx.rand()) {
          gaps.add(`${c},${r}`)
          open.add(`${c},${r}`)
        }
      }
    }
  }
  paintJungleGaps(ctx, gaps, pal, zoneAt)

  // 3 · AN ANIMAL TRACK joining each gap to the water. Not a road and not paved — it is simply the line of
  //     least undergrowth, so it reads as a way through rather than as a path someone built. Without it a
  //     light gap is a pocket you cannot reach, which the repair below would then carpet over.
  const nearestWater = (from: Cell) => nearestCell(from, banks.size > 0 ? banks : water)
  for (const key of gaps) {
    const cell = toCell(key)
    const target = nearestWater(cell)
    if (target) traceJungleTrack(ctx, cell, target, open)
  }

  // 3b · THE PATHS, FIRST. Decided before any of this and claimed here, so neither the canopy nor the
  //      undergrowth can plant on them. A jungle has no roads, but his image #16 is exactly the complaint that a
  //      map shows no way through it, so the network is a trodden track: clear, and painted in the SERVED trail
  //      tone so you can SEE it. A generator that serves no trail colour still gets a clear track, unpainted.
  if (opts.routes) {
    // Every planned cell, the wet ones too: `open` is what the canopy, the undergrowth, the ruins and the
    // emergents all treat as spoken for, and a tree planted on a boardwalk is a blocked pathway.
    for (const key of opts.routes.cells) open.add(key)
    paveRoutes(ctx, opts.routes, water, pal?.trail)
    deckRoutes(ctx, opts.routes, water, pal?.trail)
  }

  // 4 · THE CANOPY over everything else — the same exact-coverage field the woodland uses, because choosing
  //     the lowest-scoring N cells is the right way to hit a density whatever the forest. Run PER REGION so
  //     dense growth is genuinely denser than open canopy on the same map, rather than the whole map sharing
  //     one number. A map with no regions runs it once, which is the old behaviour exactly.
  const field = zones.length > 0
    ? subZoneCanopyField(ctx, open, canopy, zoneAt, zones)
    : woodlandCanopyField(ctx, open, canopy, ctx.formation)
  for (const { col, row } of field) {
    const kind: LivingTreeKind | 'tree_dead' = ctx.rand() < 0.04 ? 'tree_dead' : pickLivingTree(ctx.rand(), zoneAt[row][col]?.trees ?? ctx.treeMix)
    trees.push({ col, row, kind, variant: massVariant(col, row) })
    collision[row][col] = true
  }

  // 5 · UNDERGROWTH between the trunks — the layer a wood does not have. Its density is the served
  //     `groundCover` scaled by the region, which is why dense growth is a wall and open canopy is not.
  plantUndergrowth(ctx, open, water, pal, zoneAt)

  // 5b · RUINS where a ruins region says so: a stone platform with columns on it. The planned routes are
  //      kept out explicitly, which is what used to be done by skipping all of `open` and cost us every ruin
  //      in the clearings.
  raiseRuins(ctx, zoneAt, water, opts.routes?.cells ?? new Set<string>())

  // 6 · EMERGENTS — the few giants standing clear above the canopy. Recorded as taller tree anchors.
  plantEmergents(ctx, open, water)

  // 7 · CROSS THE CREEK. Measured before this existed: the creek ran edge to edge through the middle and
  //     split the jungle into two halves that never met — 6 regions, the largest holding 49% of the walkable
  //     ground, against the woodland's single region holding 100%. A map in halves is two maps.
  //
  //     The crossings are FALLEN LOGS, not a stone bridge: a jungle has no masonry, and the thing you
  //     actually cross a creek on is a tree that came down over it. Same walkable deck underneath, wearing
  //     the palette's trail tone instead of cobble.
  if (opts.river) bridgeRiver(ctx, water, open, opts.river, opts.crossing === true, pal)
  else fellLogsAcross(ctx, water, pal)

  // 8 · KEEP IT ONE PLACE, by CUTTING TO the strays rather than carpeting them. The undergrowth pass blocks
  //     half the floor, which pinches regions off behind it. Filling those in is the meadow's answer and it
  //     costs play area; on a jungle the honest answer is a track, because a track is exactly what gets you
  //     through undergrowth. Measured over 150 seeds: 1 map came out at 83% connected before this, none
  //     after, and no map loses ground to it.
  repairFloorConnectivity(ctx, JUNGLE_MAX_POCKET)
  joinStrandedRegions(ctx)

  // 9 · The creek settles by depth, last; the swamp pools stay blocking and turn blue-green.
  settleWaterDepth(ctx, pal, pools)
}

/** Paint a route network in a served tone, so a way through is something you can SEE rather than merely walk.
 *  Water is skipped: a path laid over water is neither a path nor a river, water is crossed on a deck. */
function paveRoutes(ctx: ArchetypeContext, plan: RoutePlan, water: ReadonlySet<string>, tone: string | undefined): void {
  if (!tone) return
  for (const key of plan.cells) {
    const { col, row } = toCell(key)
    if (!inBounds(col, row, ctx.cols, ctx.rows) || water.has(key)) continue
    ctx.floorColors[row][col] = tone
  }
}

/** How big a stranded pocket the jungle repair absorbs. Higher than the meadow's 12 because undergrowth
 *  closes pockets the meadow's framing trees never would, and a choked pocket is not a feature. */
const JUNGLE_MAX_POCKET = 40

/**
 * CUT A TRACK to anything left stranded, until the whole floor is one place.
 *
 * `repairFloorConnectivity` answers a stranded pocket by filling it in. That is right for a meadow, where a
 * pocket is a mistake, and wrong for a jungle, where it is simply ground the undergrowth closed off — the
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
      found.push(floodFloor(isFloor, col, row, seen))
    })
    if (found.length <= 1) return
    found.sort((a, b) => b.size - a.size)
    const mainCells = [...found[0]].map(toCell)

    // EVERY stray in one pass — dense undergrowth pinches the floor into many small islands, and one per pass
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

/** The first right-angle route into the main region that touches no water — every main cell, nearest first,
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
 * route that merely runs beside it) or, for a route that has to cross, laid as a log deck — never cleared
 * into a walkable stripe of river.
 */
function cutRoute(ctx: ArchetypeContext, route: readonly Cell[], bridgeWater: boolean): void {
  const wet = new Set<string>()
  const dry = new Set<string>()
  for (const { col, row } of route) {
    for (let dc = 0; dc < WOODLAND.pathWidth; dc++) {
      for (let dr = 0; dr < WOODLAND.pathWidth; dr++) {
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
  if (bridgeWater && wet.size > 0) layDeck(ctx, wet, ctx.palette?.trail)
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
 * FALLEN LOGS over the creek — the crossings that keep the two banks one place.
 *
 * Placed along the creek's run rather than at a fixed point, because a creek that meanders has no single
 * "middle", and two of them so a crossing is never a long detour.
 */
function fellLogsAcross(ctx: ArchetypeContext, water: Set<string>, pal: GeneratorPalette | undefined, fractions: readonly number[] = [0.32, 0.72]): void {
  if (water.size === 0) return
  const cells = [...water].map(toCell)
  // Which way the creek RUNS — the axis it spans more of. The log lies across the other one.
  const cols = cells.map(c => c.col)
  const rows = cells.map(c => c.row)
  const vertical = Math.max(...rows) - Math.min(...rows) >= Math.max(...cols) - Math.min(...cols)
  const along = (c: Cell) => (vertical ? c.row : c.col)
  const lo = Math.min(...cells.map(along))
  const hi = Math.max(...cells.map(along))

  for (const frac of fractions) {
    const at = Math.round(lo + (hi - lo) * frac)
    // Every water cell on that line, plus one dry cell past each end so the log lands on both banks.
    const band = cells.filter(c => along(c) === at)
    if (band.length === 0) continue
    const across = (c: Cell) => (vertical ? c.col : c.row)
    const from = Math.min(...band.map(across)) - 1
    const to = Math.max(...band.map(across)) + 1
    const deck = new Set<string>()
    for (let a = from; a <= to; a++) {
      for (let w = -1; w <= 1; w++) {
        const col = vertical ? a : at + w
        const row = vertical ? at + w : a
        if (inBounds(col, row, ctx.cols, ctx.rows)) deck.add(`${col},${row}`)
      }
    }
    layDeck(ctx, deck, pal?.trail)
    // The woodland's and jungle's crossings come through HERE, not through placeRiverCrossing, which only runs
    // when the `crossing` option joins one to the paths. Fixing only that one would have left a bridge absent
    // from the common case, which is exactly the map in his screenshots. `vertical` is the CREEK's long axis
    // and this deck runs across it, so the span lies along +col when the creek runs down the map.
    //
    // THREE of the six `layDeck` callers get a bridge: this one, placeRiverCrossing, and placeMeadowBridge.
    // The other three stay bare ON PURPOSE, because they are PATHWAYS over water rather than spans: `cutRoute`
    // decks the wet cells of a route it is carving, and `deckRoutes` is the swamp BOARDWALK (*"the boardwalk
    // over the pools IS the pathway there"*). He draws that line himself: a dirt pathway (#62) is not a bridge.
    recordBridgeSpan(ctx, deck, vertical)
  }
}

/**
 * THE SUB-ZONE MAP — which region each cell belongs to.
 *
 * Alexander, 2026-09-10: *"the generator shoudl be smart enough to identify different patterns of jungles for
 * example, open zones, dense zones, zones with swamp ... zone with ruins"*, and on the shape (2026-09-11):
 * regions inside ONE map, so you walk out of the open canopy into dense growth without loading anything.
 *
 * Nearest-seed partition: scatter a seed per region, every cell joins its closest. That gives irregular
 * organic borders for free, which matters — a jungle does not change character along a straight line. The
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

function partitionSubZones(ctx: ArchetypeContext, zones: readonly GeneratorSubZone[]): (GeneratorSubZone | undefined)[][] {
  const { cols, rows } = ctx
  const map: (GeneratorSubZone | undefined)[][] = Array.from({ length: rows }, () => new Array(cols).fill(undefined))
  if (zones.length === 0) return map

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
    // A region's OWN grouping first, the template's as the fallback — a swamp is spaced like a pasture even
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

/** Paint each region's own floor tone, so the border between open canopy and dense growth is visible from
 *  above. A region that states no floor colour keeps whatever the base floor pass gave it. */
function paintSubZoneFloors(ctx: ArchetypeContext, zoneAt: (GeneratorSubZone | undefined)[][]): void {
  forEachCell(ctx.cols, ctx.rows, (col, row) => {
    const tone = zoneAt[row][col]?.floor
    if (tone) ctx.floorColors[row][col] = tone
  })
}

/** SWAMP POOLS — standing water in a swamp region. Not a channel: pools sit in hollows, so they are blobs
 *  scored off the same coherent noise the canopy uses rather than scattered per cell. */
function floodSwampPools(ctx: ArchetypeContext, zoneAt: (GeneratorSubZone | undefined)[][], pal: GeneratorPalette | undefined): Set<string> {
  const { cols, rows, ground, collision, floorColors } = ctx

  // 1 · WHERE the water stands. Coherent noise on a COARSE patch, so a pool comes out as a sheet.
  const candidate = new Set<string>()
  forEachCell(cols, rows, (col, row) => {
    const share = zoneAt[row][col]?.pools
    if (share === undefined) return
    // NOT THE CREEK. The creek is carved first and blocks its cells; a pool blob painted over the top of it
    // left cells reading as swamp-green standing water while behaving as river. Measured on a swamp jungle:
    // 21 swamp-toned cells, 9 of them blocked, and one `water` label carrying two different tones.
    //
    // Alexander, 2026-09-12: *"water looks weird and is inconsistent"*. This is one of the ways it was: the
    // tone said puddle and the collision said channel. A pool is standing water in a hollow, so it takes only
    // cells the channel has not already claimed, and swamp tone now means exactly one thing.
    if (isWaterGround(ground[row][col])) return
    if (shadeNoise(Math.floor(col / SWAMP_POOL_PATCH) * 1.9 + Math.floor(row / SWAMP_POOL_PATCH) * 2.7) > share * 2) return
    candidate.add(`${col},${row}`)
  })

  // 2 · Only the real BODIES of it. A puddle of one or two cells reads as wet dirt, not as water you have to
  //     go around, and it is what made the map hard to read.
  const pools = new Set<string>()
  for (const body of bodiesOf(candidate)) {
    if (body.size < SWAMP_MIN_POOL) continue
    for (const key of body) pools.add(key)
  }

  // 3 · Lay it. The share the backend serves is untouched: the same noise at the same threshold, measured over
  //     a coarser patch, so a swamp is as wet as it was and simply legible.
  for (const key of pools) {
    const { col, row } = toCell(key)
    // A PUDDLE IS FLUSH WITH THE FLOOR; a channel surface is not. Alexander, 2026-09-12: *"the green walkable
    // water is also below floor level, when that's not the case, in fact a puddle of water is at floor level, a
    // little bit transparent over other tiles walkable floor tiles"*.
    //
    // Measured before changing anything: a pool ALREADY sits at elevation 0, is ALREADY walkable (149 of 149
    // cells) and is already translucent. What made it read as recessed is mine from earlier the same day. I
    // gave `water` a height of 0.5 so a RIVER surface would sit under its bank rim, and a pool lays that same
    // label, so a puddle drew a 0.45-tileW slab standing PROUD of the floor with dark sides, which the eye
    // reads as a basin. One label cannot be both a sunken channel and a flush puddle.
    //
    // `water_shallow` is height 0.0, non-blocking, and still water-ground, so all thirteen `isWaterGround`
    // consumers behave exactly as before. That is deliberately NOT the bigger change of clearing the water
    // label altogether: dropping it would let tall grass, ground cover, blooms, the terrain transitions and the
    // shoreline all flood into a puddle at once.
    ground[row][col] = 'water_shallow'
    // NO COLLISION. Alexander, 2026-09-12, on the green water: *"I can't walk throug the green one, even when
    // the floor makes it seems like I should, specially considering the floor is at the same level"*, and
    // earlier: *"we still want to be able to use water outside of rivers, usually i'l be like water puddles,
    // walkable"*.
    //
    // A pool is not a channel. `carveChannel` cuts its bed BELOW the walking floor and `digChannel` writes that
    // elevation, which is what makes a river something you go around. A pool sits AT ground level, so the map
    // said walkable and the collision grid said otherwise. The river keeps its bands (see settleWaterDepth);
    // this stamps a wet floor and nothing more.
    // The SAME water colour a channel wears. `varyIntensity(…, 0.4)` darkened it ~6%, so a puddle sat beside a
    // river in a near-but-not-quite blue, one more of the mixed colours he flagged. A SWAMP pool is the one
    // pool that legitimately differs (the served blue-green, applied by settleWaterDepth).
    if (pal?.water) floorColors[row][col] = pal.water
  }
  return pools
}

/**
 * How coarse the pool noise is, in cells.
 *
 * Alexander, 2026-09-11: *"the swamp water is still really really confusing and poorly optimized"*, with image
 * #18, where a swamp is a few big pools with boardwalks and mounds between them. Measured on a swamp jungle
 * before this: THIRTY separate bodies of water on one 40x30 map, twelve of them three cells or smaller, sizes
 * 129, 48, 20, 18, 16, 16, 12, 12 and down. That is a pepper of puddles and it came straight from scoring the
 * noise over a 2x2 patch. Five reads as a hollow full of standing water.
 */
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

/** RUINS — fallen masonry in a ruins region. Blocking stone, scattered rather than laid out, because what is
 *  left of a jungle ruin is rubble and the odd standing wall, not a building. */
/** The floor a ruin stands on. Already in `BUILT_FLOOR`, so nothing plants on a ruin's platform. */
const RUIN_FLOOR = 'ancient_stone'
/** Coarse patch the sites cluster on, exactly as the swamp's pools do. A patch is in or out whole, so a ruin
 *  comes out as a FOOTPRINT rather than as speckle. */
const RUIN_PATCH = 5
/** Smaller than this is rubble, not a building, and gets discarded. */
export const RUIN_MIN_SITE = 6
/** A column every other cell around the edge. REGULAR spacing is the whole difference between masonry and a
 *  pile of stones: nature does not put uprights at a fixed interval. */
const RUIN_COLUMN_STEP = 2
/** Share of a platform's interior carrying a fallen block. */
const RUIN_RUBBLE = 0.14

/**
 * RUINS, which are BUILT.
 *
 * Alexander, 2026-09-11: *"jungle ruins doesn't have any ruins..."*.
 *
 * He was right, and this pass was the reason. It placed ONE `rock` prop per cell at a 16% roll, so the "ruins"
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
    stampRuin(ctx, body, keepOut)
  }
}

/**
 * ONE RUIN: a stone platform, columns at regular intervals around its edge, fallen blocks between them.
 *
 * Collision is never CLEARED here. The canopy has already planted by this point, so clearing a cell would
 * leave a tree standing on walkable ground. The platform is laid only where nothing stands, and `placeProp`
 * refuses an occupied or watery cell on its own.
 */
function stampRuin(ctx: ArchetypeContext, body: ReadonlySet<string>, keepOut: ReadonlySet<string>): void {
  const { ground, collision } = ctx

  // the platform: walkable stone, so a ruin is somewhere you go INTO rather than around
  for (const key of body) {
    const { col, row } = toCell(key)
    if (keepOut.has(key) || collision[row][col]) continue
    ground[row][col] = RUIN_FLOOR
  }

  // the columns, on the platform's EDGE at a fixed step
  for (const key of body) {
    const { col, row } = toCell(key)
    if (keepOut.has(key)) continue
    if (!ORTHO.some(([dc, dr]) => !body.has(`${col + dc},${row + dr}`))) continue
    if ((col + row) % RUIN_COLUMN_STEP !== 0) continue
    placeProp(ctx, makePillar(col, row))
  }

  // and what has fallen off them
  for (const key of body) {
    const { col, row } = toCell(key)
    if (keepOut.has(key) || collision[row][col]) continue
    if (ctx.rand() < RUIN_RUBBLE) placeProp(ctx, makeRock(col, row))
  }
}

/** The shaded floor, mottled over coarse patches. Two tones from the served palette so it reads as litter and
 *  shade rather than one fill; the patch size matches the meadow's for the same run-merging reason. */
function paintJungleFloor(ctx: ArchetypeContext, pal: GeneratorPalette | undefined): void {
  if (!pal?.floor) return // the backend states no floor colour → keep the tile's own
  const { cols, rows, floorColors } = ctx
  const alt = pal.floorAlt ?? pal.floor
  const litter = pal.litter ?? pal.floor
  forEachCell(cols, rows, (col, row) => {
    const n = shadeNoise(Math.floor(col / 4) * 1.7 + Math.floor(row / 4) * 2.3)
    floorColors[row][col] = n > 0.78 ? litter : n > 0.45 ? alt : pal.floor
  })
}

/** A light gap is the only LIT ground on the map — paint it up off the canopy tone and dress it with whatever
 *  the generator serves for flowers, because a gap is where the saplings and blooms actually are. */
function paintJungleGaps(
  ctx: ArchetypeContext,
  gaps: Set<string>,
  pal: GeneratorPalette | undefined,
  zoneAt?: (GeneratorSubZone | undefined)[][],
): void {
  const lit = pal?.canopyAlt
  const flowers = ctx.nature?.flowers
  for (const key of gaps) {
    const { col, row } = toCell(key)
    if (!inBounds(col, row, ctx.cols, ctx.rows)) continue
    if (lit) ctx.floorColors[row][col] = lit
    // The REGION standing here decides its own blooms; the season answers where a region states none. This is
    // where a swamp's daisies came from: a light gap is the only lit ground in a jungle, so it is where the
    // blooms are, and it had no idea which region it was in.
    if (flowers !== undefined && ctx.rand() < flowers * 2) {
      placeProp(ctx, makeFlower(ctx.rand, ctx.zone, col, row, zoneAt?.[row]?.[col]?.flowers))
    }
  }
}

/**
 * THE CREEK — a watercourse running THROUGH the map, edge to opposite edge, not hugging the perimeter the
 * way the meadow's river does. That difference is the point: a meadow's river frames the view, a jungle's
 * creek is the thing you travel along, so it has to cross the middle.
 */
function carveJungleCreek(ctx: ArchetypeContext, pal: GeneratorPalette | undefined, wide: boolean): Set<string> {
  return carveChannel(ctx, pal, { half: JUNGLE.creekHalf * (wide ? 1.8 : 1), swing: 0.26 })
}

/**
 * RAISE A REGION, so a map has more than one level of ground.
 *
 * Alexander, 2026-09-12: *"we need to have support for different levels of terrain, relieve in spanish"*.
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
 * Alexander, 2026-09-11: *"we need the river without water, which is negative height compared to walking
 * floor / then inside that we put water with X height it can be < 1, but not walkable"*, and *"river depth is
 * confgiuravble ... we want to control everyhting"*.
 *
 * A gated choice takes `none` when its dependency is off, so a map with no river, or one serving no depth at
 * all, is NOT CUT and reads exactly as it always did. That also keeps his other case honest: *"we still want
 * to be able to use water outside of rivers, usually i'l be like water puddles, walkable"*. A puddle is not a
 * channel, so nothing digs it.
 */
const CHANNEL_DEPTH: Readonly<Record<string, number>> = { '1': 1, '2': 2 }

function channelDepth(ctx: ArchetypeContext): number {
  const served = ctx.options?.depth
  return typeof served === 'string' ? CHANNEL_DEPTH[served] ?? 0 : 0
}

/**
 * CUT THE CHANNEL: every bed cell drops below the walking floor.
 *
 * Collision is NOT touched here. `carveChannel` already blocks a water cell, and a second opinion about
 * walkability in a second place is how the ten `=== 'water'` conditionals came to exist.
 */
function digChannel(ctx: ArchetypeContext, water: ReadonlySet<string>): void {
  const depth = channelDepth(ctx)
  if (depth === 0) return
  for (const key of water) {
    const { col, row } = toCell(key)
    // RELATIVE to whatever the ground already stands at, so a river crossing a raised region cuts into THAT
    // region rather than snapping to an absolute depth. At level 0 the two are identical, which is every map
    // that states no relief.
    if (inBounds(col, row, ctx.cols, ctx.rows)) ctx.elevation[row][col] -= depth
  }
}

/** The shape of a channel: how wide, how far it wanders, and optionally which way it must run. */
interface ChannelShape {
  half: number
  /** how far the centreline wanders, as a share of the map's width across it */
  swing: number
  /** force it to run left to right (cutting top from bottom). Absent → rolled. */
  horizontal?: boolean
}

/** A watercourse running edge to edge through the map — the jungle's creek, and the `through` and `divides`
 *  rivers. The draw order is unchanged when nothing is forced, so the jungle's creek is byte-identical. */
function carveChannel(ctx: ArchetypeContext, pal: GeneratorPalette | undefined, shape: ChannelShape): Set<string> {
  const { cols, rows, ground, collision, floorColors } = ctx
  const water = new Set<string>()
  const half = shape.half
  const vertical = shape.horizontal === undefined ? ctx.rand() < 0.5 : !shape.horizontal
  const span = vertical ? rows : cols
  const across = vertical ? cols : rows
  const phase = ctx.rand() * Math.PI * 2
  const phase2 = ctx.rand() * Math.PI * 2
  // The centreline wanders across the map as it runs down it — two sine terms so the meander is irregular
  // rather than a wave, kept off the edges so the creek never degenerates into a border.
  const centre = (along: number): number => {
    const mid = across / 2
    const swing = across * shape.swing
    return mid + swing * Math.sin(along * 0.14 + phase) + swing * 0.4 * Math.sin(along * 0.31 + phase2)
  }
  for (let along = 0; along < span; along++) {
    const c = centre(along)
    for (let off = Math.floor(c - half); off <= Math.ceil(c + half); off++) {
      if (Math.abs(off - c) > half) continue
      const col = vertical ? off : along
      const row = vertical ? along : off
      if (!inBounds(col, row, cols, rows)) continue
      ground[row][col] = 'water'
      collision[row][col] = true
      // FLAT, not noisy. This used to vary the intensity per 3x3 block from a position hash, which is a
      // per-cell colour lottery inside one river: *"not different currents, nor different colors mixed"*.
      // `settleWaterDepth` overwrites channel cells afterwards anyway, so the noise was also wasted work.
      if (pal?.water) floorColors[row][col] = pal.water
      water.add(`${col},${row}`)
    }
  }
  // Every channel-carved course comes through here: `through`, `divides`, and the jungle's creek.
  digChannel(ctx, water)
  return water
}

/** The walkable BANK either side of the creek — this is the route through a jungle, so it is cleared to a
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

/** An ANIMAL TRACK from a light gap to the water — one cell wide, wandering, and marked open rather than
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
    // map and it still has to be walkable, which is the whole of his note.
    for (let oc = 0; oc < WOODLAND.pathWidth; oc++) {
      for (let or_ = 0; or_ < WOODLAND.pathWidth; or_++) {
        const c = col + oc
        const r = row + or_
        if (inBounds(c, r, cols, rows)) open.add(`${c},${r}`)
      }
    }
  }
}

/** UNDERGROWTH — the choked layer between the trunks, and the thing that actually makes a jungle hard to
 *  cross. Density is the served `groundCover`. It BLOCKS, unlike the woodland's ground dressing, which is
 *  the whole distinction: a wood's floor cover is decoration, a jungle's is an obstacle. */
function plantUndergrowth(
  ctx: ArchetypeContext,
  open: Set<string>,
  water: Set<string>,
  pal: GeneratorPalette | undefined,
  zoneAt?: (GeneratorSubZone | undefined)[][],
): void {
  const cover = ctx.nature?.groundCover
  if (cover === undefined) return
  const { cols, rows, collision, floorColors } = ctx

  // UNDERGROWTH GROWS IN MASSES, NOT AS PEPPER.
  //
  // Rolling per cell was the first version and it was wrong in a way only measurement showed: a 50% per-cell
  // chance turns the floor into swiss cheese, and since undergrowth BLOCKS, the walkable remainder came out
  // as hundreds of disconnected islands — 363 on one seed. Every fix downstream then made it worse. Carpeting
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
    const density = clamp01(cover * (zone?.undergrowth ?? 1) * understory)
    if (density <= 0) continue
    // A coarser lattice than the canopy's, so undergrowth reads as broad thickets rather than as a second
    // canopy stippled between the trunks.
    const thicket = woodlandCanopyField(ctx, mask, density, { lattice: (formation?.lattice ?? DEFAULT_CANOPY_LATTICE) + 3 })
    for (const { col, row } of thicket) {
      // A THICKET stands here, and `placeProp` blocks the cell because the thicket blocks. Stamping collision
      // was the bug: it made a clover into a wall. If the cell cannot take the thicket (water, already blocked)
      // it stays exactly as it was rather than becoming an invisible obstacle.
      placeProp(ctx, makeThicket(ctx.zone, col, row))
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

/** Every cell NOT in this region, as keys — the mask that confines a pass to one region. */
function cellsOutsideZone(ctx: ArchetypeContext, zoneAt: (GeneratorSubZone | undefined)[][], zone: GeneratorSubZone | undefined): string[] {
  const out: string[] = []
  forEachCell(ctx.cols, ctx.rows, (col, row) => {
    if (zoneAt[row][col] !== zone) out.push(`${col},${row}`)
  })
  return out
}

/** EMERGENTS — the handful of giants standing clear above the canopy, the tallest thing in an Amazon frame.
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
    trees.push({ col, row, kind: 'tree_giant', variant: massVariant(col, row) })
    collision[row][col] = true
  }
}

/**
 * The nearest point on the map edge to a cell — where a trail leaves the forest.
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
  const widen = (c: number, r: number) => {
    for (let dr = 0; dr < WOODLAND.pathWidth; dr++) {
      for (let dc = 0; dc < WOODLAND.pathWidth; dc++) {
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
 *    42% of the forest floor every time — no drift from thinning or overlap.
 *  · **Coherence.** Neighbouring cells interpolate from the same lattice corners, so they score alike and
 *    are taken or skipped together. That is what makes a stand a stand.
 *
 * The share is of the PLANTABLE floor, not of the whole grid: a clearing is not somewhere a tree failed to
 * grow, so counting clearings in the denominator would make the density mean less the more clearings a map
 * happened to roll.
 */
function woodlandCanopyField(ctx: ArchetypeContext, open: Set<string>, canopy: number, formation?: GeneratorFormation): Cell[] {
  const { cols, rows, collision } = ctx
  // THE GROUPING. Alexander, 2026-09-11: *"there's different ways in which trees and nature is distributed
  // across these zones"*. A small lattice scores every few cells differently, so trees land as fine scatter
  // (his image #10, a wood pasture); a large one makes neighbours score alike, so they land as continuous
  // masses (image #14, a closed canopy). Same density, completely different forest.
  const CANOPY_LATTICE = Math.max(1, Math.round(formation?.lattice ?? DEFAULT_CANOPY_LATTICE))
  // The lattice — one random value per corner, drawn from the layer rng so a seed reproduces the forest.
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
      // level stopped blocking (his *"I can't walk throug the green one, even when the floor makes it seems
      // like I should"*), canopy started planting on the water: measured 23 to 209 trees standing in pools
      // across eight seeds, and their trunks took the cells the ruin's rubble needed, so a seeded ruin lost
      // its fallen blocks.
      //
      // Collision says whether you can WALK there. It is not a description of what is in the cell, and using
      // it as one is why this broke. Every sibling guard here already asks the ground directly.
      if (isWaterGround(ctx.ground[row][col])) continue
      scored.push({ col, row, n: noiseAt(col, row) })
    }
  }
  const target = Math.round(scored.length * Math.max(0, Math.min(1, canopy)))
  scored.sort((a, b) => a.n - b.n)

  // SPACING. With no minimum gap the lowest-scoring cells sit shoulder to shoulder and the stand reads as a
  // solid wall, which is right for a closed canopy (his image #14) and wrong for everything else. A gap of
  // 3 forces the open, individually-readable spacing of a wood pasture (image #10) at the SAME density —
  // the trees spread out to find room rather than there being fewer of them.
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
 * Both densities come from the backend and both go through the existing prop seams — `makeFlower` and
 * `makeGroundDecor` — so a woodland's dressing is the same data-driven, per-zone, baked-image path the
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
  for (const key of open) {
    const [c, r] = key.split(',').map(Number)
    if (!inBounds(c, r, ctx.cols, ctx.rows) || ctx.collision[r][c]) continue
    if (flowers !== undefined && ctx.rand() < flowers) {
      // A clearing's blooms belong to the REGION it sits in, the same rule the jungle's gaps follow.
      placeProp(ctx, makeFlower(ctx.rand, ctx.zone, c, r, zoneAt?.[r]?.[c]?.flowers))
      continue
    }
    if (cover === undefined || ctx.rand() >= cover) continue
    const decor = makeGroundDecor(ctx.zone, c, r)
    if (decor) placeProp(ctx, decor)
  }
}

// ── 'meadow' + 'meadow_river' layouts (references #14 / #17) ──────────────────
// An OPEN muted-olive clearing framed by a dense tree BORDER, with EXACTLY TWO cobblestone entrances on
// the near (bottom) edge, a loose grid of ornament ZONES (flower / grass / rock-earth patches — "not
// everything is green"), a season floor-colour GRADIENT written as per-cell STATE (Alexander: "a gradient
// of greens to yellows based on the season"), and — the river variant — a perimeter WATER ring broken only
// at the entrances, with a stone BRIDGE crossing it.
//
// Alexander's model: grass + water are a COLOUR on a flat floor tile, TILES are spent only on ORNAMENTS
// (flowers, rocks) + highlights (the bridge). So the whole floor is the flat 'meadow' tile tinted per-cell
// (grass / earth / cobble) or the flat 'water' tile tinted river-blue — both carry a real block HEIGHT, so
// terrain reads as a raised block and every ornament STACKS on top of it (no 0-height tiles emitted).

/** Per-season meadow floor palette: the gradient endpoints (top/light → bottom/dark, an olive greens→
 *  yellows) plus the earth / grass patch tints, the cobblestone entrance tone, and the river + bank
 *  colours — every colour the meadow layouts write as floor STATE. Muted olive around the @meadow_color
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

const MEADOW_GRADIENT_STEPS = 7   // coarse ROW gradient bands — few colour breaks + horizontally UNIFORM so compressGround merges each row into ONE run (FPS)
const MEADOW_PATCH = 7            // coarse garden-PATCH size — a tended-field patchwork painted as large uniform regions (merges), not per-cell grid lines
const MEADOW_RIVER_INSET = 5      // river-channel centreline inset from the 3 active edges (top / left / right)
const MEADOW_RIVER_HALF = 1.9     // channel half-width → a ~4-wide winding river (organic, wobbled per position)
const MEADOW_OUTER_BAND = 4       // outer LAND strip depth beyond the river where the sparse framing trees clump
const MEADOW_ENTRANCE_HALF = 2    // entrance lane half-width → a 5-wide cobble way (matches PATH_WIDTH)
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

function layoutMeadow(ctx: ArchetypeContext): void { buildMeadow(ctx, { river: null, twoWays: false }) }
/** `meadow_pass` (#26): the open meadow opened on TWO opposite edges (top + bottom) — a through-route you can
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

/**
 * SETTLE THE WATER BY DEPTH, once the map is otherwise finished.
 *
 * Alexander, 2026-09-11: *"I only want light blue for walkable water, different layers of darkblue for the deeper
 * waters and we can have some share of blue-green for swamp, the thing is, right now the green used makes it look
 * like a floor instead of water and it's confusing"*.
 *
 *   · the edge you can WADE is shallow: light blue, walkable
 *   · past it the water is ordinary, and further in DEEP and darker; both block
 *   · a swamp pool stays as it is (blocking), recoloured blue-green
 *
 * It runs LAST, after the trails, the bridges and the connectivity joins. Everything before it still sees plain
 * water, so none of that logic changes, and the shallows are only ever hung off ground you could already reach
 * (`wadeableShallows`), so no map comes out more or less connected than it went in.
 */
function settleWaterDepth(ctx: ArchetypeContext, pal: GeneratorPalette | undefined, pools: ReadonlySet<string> = new Set()): void {
  const { ground, collision, floorColors } = ctx
  const depth = waterDepth(ctx, pools)
  const wadeable = wadeableShallows(ctx, depth)
  // FROZEN OVER. Alexander, 2026-09-12: *"in winter, rivers are ice and we can walk over them, which mean, we
  // just remove collissions and add the ice physics we haven't developed yet"*. `frozen_water` already exists as
  // a label in both styles, named for exactly this, so the season lays a different TILE rather than the same
  // water with an exception bolted on.
  //
  // HONEST ABOUT WHERE THIS BELONGS: reading the season here is the same shape of frontend conditional the data
  // audit indicts elsewhere. The durable home is a served answer on the tile, which is also what makes the ice
  // physics possible later. It reads the zone for now because nothing serves it yet.
  const frozen = ctx.zone === 'winter'
  // ONE SURFACE COLOUR for the whole channel. Alexander, 2026-09-12, with his reference image: *"top is one
  // color and bottom is another color, but consistent, not different currents, nor different colors mixed"*,
  // after *"we need to use the tiles consistently, right now water tiles is far from consistent making it look
  // random"*.
  //
  // MEASURED before changing it, on a seed-5 `divides` river: 120 cells `#4f93b3`, 108 `#8ccbe8`, 38 `#2a5f8a`
  // three blues at 45/41/14% inside ONE river. And all three drew the SAME picture, because a floor resolves
  // its art through `groundKind`, which collapses every band to `water`. So the bands were never different
  // water; they were one tile wearing three tints. The "bottom" colour he asks for is the map BODY beneath the
  // surface, which `groundSideColor` already derives from it, so one tone here delivers both halves of the rule.
  //
  // THIS REVERSES the per-depth shading he asked for on 2026-09-11 (*"I only want light blue for walkable
  // water, different layers of darkblue for the deeper waters"*). The newest instruction wins. The band still
  // decides the LABEL and what you can wade through, so the shallows stay walkable. They just stop being a
  // different colour, which means the wadeable edge now needs the shoreline to mark it, not a hue.
  for (const [key, d] of depth) {
    const { col, row } = toCell(key)
    const band = waterBand(d, wadeable.has(key))
    ground[row][col] = frozen ? 'frozen_water' : band.label
    collision[row][col] = frozen ? false : !band.walkable
    if (pal?.water) floorColors[row][col] = pal.water
  }
  if (!pal?.swamp) return
  for (const key of pools) {
    const { col, row } = toCell(key)
    // WATER-GROUND, not one spelling of it. This tested `=== 'water'` and silently stopped applying the swamp
    // tone the moment a pool started laying `water_shallow` (its flush height), so every pool came out wearing
    // the plain river blue. The rule is written twenty lines up in this very file: ask what the ground IS, never
    // which of its names it happens to carry.
    if (isWaterGround(ground[row]?.[col])) floorColors[row][col] = pal.swamp
  }
}

// A band decides the LABEL and whether you can wade it. It used to decide a COLOUR too (`tone`), which is what
// put three blues in one river; the surface now takes one served tone (see settleWaterDepth).
interface WaterBand { label: string; walkable: boolean }
const WATER_BANDS: Readonly<Record<'shallow' | 'open' | 'deep', WaterBand>> = {
  shallow: { label: 'water_shallow', walkable: true },
  open: { label: 'water', walkable: false },
  deep: { label: 'water_deep', walkable: false },
}
/** How many cells in from the bank the water turns deep. */
const DEEP_WATER_FROM = 3

function waterBand(depth: number, wadeable: boolean): WaterBand {
  if (wadeable) return WATER_BANDS.shallow
  if (depth >= DEEP_WATER_FROM) return WATER_BANDS.deep
  return WATER_BANDS.open
}

/**
 * How far each channel cell is from the nearest bank, counted orthogonally (1 = touching it). A bridge is not a
 * bank, so the water beside a deck keeps the depth of the river around it instead of ringing the deck with
 * shallows. The map edge is not a bank either, so a river running off the map stays deep there. Swamp pools are
 * left out, they are their own kind of water.
 */
function waterDepth(ctx: ArchetypeContext, pools: ReadonlySet<string>): Map<string, number> {
  const { cols, rows, ground } = ctx
  // The CHANNEL is water that is not a pool. `pools` already excludes them explicitly, so this is the same
  // answer as before; it asks what the ground is rather than which name it wears, for the same reason as above.
  const isChannel = (c: number, r: number) => inBounds(c, r, cols, rows) && isWaterGround(ground[r][c]) && !pools.has(`${c},${r}`)
  // A BANK is dry land. Testing `!== 'water'` made a swamp POOL count as a bank the moment pools started
  // laying `water_shallow`, which would have made the channel read as shallow wherever a puddle touched it.
  const isBank = (c: number, r: number) => inBounds(c, r, cols, rows) && !isWaterGround(ground[r][c]) && !ctx.decks.has(`${c},${r}`)
  const depth = new Map<string, number>()
  const queue: Cell[] = []
  forEachCell(cols, rows, (col, row) => {
    if (!isChannel(col, row) || !ORTHO.some(([dc, dr]) => isBank(col + dc, row + dr))) return
    depth.set(`${col},${row}`, 1)
    queue.push({ col, row })
  })
  for (let i = 0; i < queue.length; i++) {
    const { col, row } = queue[i]
    const next = depth.get(`${col},${row}`)! + 1
    for (const [dc, dr] of ORTHO) {
      const c = col + dc
      const r = row + dr
      if (!isChannel(c, r) || depth.has(`${c},${r}`)) continue
      depth.set(`${c},${r}`, next)
      queue.push({ col: c, row: r })
    }
  }
  return depth
}

/**
 * Which bank-side cells you may WADE. One only when it hangs off exactly ONE stretch of dry ground, so the
 * shallows can never become a way across: banks the river keeps apart stay apart, and the bridge stays THE
 * crossing. Measured without this: a narrow river is shallow on both sides with nothing left between, and a
 * "divides" map could be waded straight over. A cell touching no walkable ground (only trunks or rocks) stays
 * open water too, or it would be a puddle you could never reach.
 *
 * Grown outward from the banks until nothing more can join, so a shallow cell can hang off another one.
 */
function wadeableShallows(ctx: ArchetypeContext, depth: ReadonlyMap<string, number>): Set<string> {
  const area = dryAreas(ctx)
  const joined = new Map<string, number>()
  const pending = new Set([...depth].filter(([, d]) => d === 1).map(([key]) => key))
  for (let grew = true; grew;) {
    grew = false
    for (const key of pending) {
      const { col, row } = toCell(key)
      const touching = new Set<number>()
      for (const [dc, dr] of ORTHO) {
        const id = area.get(`${col + dc},${row + dr}`) ?? joined.get(`${col + dc},${row + dr}`)
        if (id !== undefined) touching.add(id)
      }
      if (touching.size === 0) continue
      pending.delete(key)
      if (touching.size > 1) continue
      joined.set(key, [...touching][0])
      grew = true
    }
  }
  return new Set(joined.keys())
}

/** Every walkable dry cell, labelled by the stretch of ground it belongs to. Bridges are left out on purpose:
 *  the question is what the WATER keeps apart. */
function dryAreas(ctx: ArchetypeContext): Map<string, number> {
  const { cols, rows, ground, collision } = ctx
  const isDry = (c: number, r: number) =>
    inBounds(c, r, cols, rows) && !collision[r][c] && ground[r][c] !== 'water' && !ctx.decks.has(`${c},${r}`)
  const seen = new Set<string>()
  const area = new Map<string, number>()
  let next = 0
  forEachCell(cols, rows, (col, row) => {
    if (!isDry(col, row) || seen.has(`${col},${row}`)) return
    const id = next++
    for (const key of floodFloor(isDry, col, row, seen)) area.set(key, id)
  })
  return area
}

function layoutMeadowPass(ctx: ArchetypeContext): void { buildMeadow(ctx, { river: null, twoWays: true, routes: plannedRoutes(ctx) }) }

interface MeadowBuild {
  /** The river's COURSE, or null for none. An option on the generator, not a layout of its own. */
  river: RiverCourse | null
  /** Put the river's crossing ON the path network instead of at the fixed top-right span (ticket 36). */
  crossing?: boolean
  /** Open TWO opposite cobble ways (top + bottom) for a through-route (`meadow_pass`) instead of one bottom way. */
  twoWays: boolean
  /** The planned ways in, out and through. Present → the gates ARE the ways and `twoWays` is moot. */
  routes?: RoutePlan | null
}

/** THE meadow builder — `meadow` (one bottom way, no river), `meadow_river` (one way + perimeter river) and
 *  `meadow_pass` (two opposite ways, no river). LAYOUT-FIRST: flat floor + season gradient → (river) carve the
 *  perimeter water → sparse framing trees → pave the cobble way(s) → populate the open centre with ornament
 *  zones → keep the floor one region → (river) drop the stone bridge last so the repair can't fill it. */
function buildMeadow(ctx: ArchetypeContext, opts: MeadowBuild): void {
  floodMeadowFloor(ctx)                          // flat 'meadow' tile everywhere (a raised, tintable block)
  paintMeadowGradient(ctx)                        // season olive greens→yellows as per-cell floor STATE
  const water = opts.river ? carveRiver(ctx, opts.river, meadowWater(ctx)) : new Set<string>() // the river along the course the option picked
  paintMeadowPlots(ctx, water)                    // faint tended-field patchwork (a subtle colour)
  scatterMeadowOrnaments(ctx, water)              // subtle dirt/earth patches, a few field stones, tiny flowers — mostly open
  scatterFramingTrees(ctx, water)                 // SPARSE tree clumps BEYOND the river (top/left/right) + a few near the bottom corners
  // The cobble ways ARE this layout's path network, so they are what a joined crossing joins to.
  const routes = new Set<string>()
  if (opts.routes) {
    // THE GATES ARE THE WAYS. Every one of them gets a cobble way that runs off its own edge and joins the
    // middle, which is what his image #16 had none of. The lamps and flower beds stay on the way you come IN,
    // and on a far-edge way out, because that is where they read as a gateway rather than as scenery.
    paveMeadowRoutes(ctx, opts.routes, water, routes)
    paintMeadowEntrance(ctx, water, routes, false, opts.routes.entrance.inside.col / ctx.cols)
    for (const gate of opts.routes.gates) {
      if (gate.side === 'north') paintMeadowEntrance(ctx, water, routes, true, gate.inside.col / ctx.cols)
    }
  } else if (opts.twoWays) {
    paintMeadowEntrance(ctx, water, routes, false, 0.5) // near (bottom) cobble way in
    paintMeadowEntrance(ctx, water, routes, true, 0.5)  // far (top) cobble way out — opposite edge, aligned → a through-route (#26)
  } else {
    paintMeadowEntrance(ctx, water, routes)       // ONE bottom-left cobble entrance, lamp posts + flower beds
  }
  scatterTallGrass(ctx)                           // patches of walkable long grass, as much as the generator serves
  repairFloorConnectivity(ctx, MEADOW_MAX_POCKET) // fill only TINY stranded pockets; the land strip beyond the river stays (decor)
  if (opts.river) bridgeRiver(ctx, water, routes, opts.river, opts.crossing === true, meadowWater(ctx)) // after repair, so the deck is never filled back in
  settleWaterDepth(ctx, meadowWater(ctx)) // last, once the bridge is down
}

/** Get across the river. With the crossing option on, the span is placed against the path network and paved
 *  back to it (ticket 36); with it off, the plain fixed-column bridge. Either way the map stays ONE place —
 *  an uncrossable river is two maps, which is never what anyone asked for. */
function crossRiver(ctx: ArchetypeContext, water: Set<string>, routes: Set<string>, joined: boolean): void {
  if (joined && placeRiverCrossing(ctx, water, routes)) return
  placeMeadowBridge(ctx, water)
}

/** Flat 'meadow' floor tile in every cell — a raised, colour-tintable block (its per-cell colour is
 *  written by paintMeadowGradient). Overrides the season default so the floor is always the flat tile. */
function floodMeadowFloor(ctx: ArchetypeContext): void {
  forEachCell(ctx.cols, ctx.rows, (col, row) => { ctx.ground[row][col] = 'meadow' })
}

/** Write the season floor-colour GRADIENT as per-cell STATE: a top→bottom olive greens→yellows ramp, quantised
 *  to a handful of ROW BANDS and HORIZONTALLY UNIFORM (no per-column lean). Every cell in a band-row is the
 *  SAME colour, so compressGround merges each row into ONE z-width run — the perf fix (the old col*0.3 diagonal
 *  changed the colour every few columns, so a row broke into ~11 un-mergeable pieces and FPS tanked). The
 *  season top→bottom ramp look is kept; only the subtle diagonal shading is dropped for large mergeable runs. */
function paintMeadowGradient(ctx: ArchetypeContext): void {
  const { cols, rows } = ctx
  const pal = MEADOW_PALETTES[ctx.zone] ?? MEADOW_PALETTES.summer
  forEachCell(cols, rows, (col, row) => {
    const t = clamp01(row / Math.max(1, rows - 1))
    const q = Math.round(t * MEADOW_GRADIENT_STEPS) / MEADOW_GRADIENT_STEPS
    ctx.floorColors[row][col] = lerpHex(pal.top, pal.bottom, q)
  })
}

/** Paint the WINDING river (river variant): a meandering channel hugging THREE sides — the TOP, LEFT and
 *  RIGHT edges — set in from the edge by a wobbling inset, leaving the NEAR (bottom) edge OPEN for the
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
  // edge on some seeds and cut the land OUTSIDE the river into pieces only water separated — measured on an
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
    // across one river: *"not different currents, nor different colors mixed"* (Alexander, 2026-09-12).
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

/** Sandy BANK highlight on the land cells orthogonally touching the river — the shoreline in #17. */
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

/** SPARSE framing trees: natural CLUMPS in the outer LAND band beyond the river (hugging the top / left /
 *  right edges — where the river variant leaves a thin strip) plus a few near the bottom corners. The trees
 *  are BEYOND the river, framing the open meadow, NOT a dense wall ringing it (the #22 mistake). Blue-noise
 *  spaced; never in the river. For the no-river `meadow` this same band gives the loose treeline of #14. */
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
    if (d3 > MEADOW_OUTER_BAND + 2 && !bottomCorner) continue // trees only frame the edges; the centre stays open
    if (ctx.rand() > (bottomCorner ? 0.3 : 0.42)) continue
    if (placed.some(p => Math.abs(p.col - col) < 2 && Math.abs(p.row - row) < 2)) continue
    stampMeadowClump(ctx, col, row, water, bottomCorner)
    placed.push({ col, row })
  }
}

/** Stamp a small tree CLUMP (1–3 trees) around an anchor so the treeline reads as natural groups, not evenly
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

/** Record ONE meadow tree anchor (like stampTree) — a random living shape (a tall conifer for corner clumps),
 *  a canopy tone, blocking only its trunk cell. Mostly living so the meadow reads green; a HARSH season
 *  sprinkles a little dead wood. */
const HARSH_ZONES: ReadonlySet<ZoneId> = new Set<ZoneId>(['autumn', 'winter', 'lava'])
function stampMeadowTree(ctx: ArchetypeContext, col: number, row: number, tall: boolean): void {
  const { zone, trees, collision } = ctx
  if (!isLandCell(ctx, col, row)) return // land-only: no tree in water
  const variant = randIntWith(ctx.rand, 0, canopyCount(styleCatalog('ascii'), zone) - 1)
  // The green/verdant reference meadows show NO bare snags — only a HARSH season sprinkles a little dead wood.
  const dead = HARSH_ZONES.has(zone) && ctx.rand() < DEAD_TREE_CHANCE[zone] * 0.4
  const kind: LivingTreeKind | 'tree_dead' = dead ? 'tree_dead' : tall ? 'tree_tall' : pickLivingTree(ctx.rand(), ctx.treeMix)
  trees.push({ col, row, kind, variant })
  collision[row][col] = true
}

/** The planned network as a cobble way across the meadow: cleared of whatever the framing and ornament passes
 *  dropped on it, then painted the cobble tone on the flat meadow floor: a COLOUR, not a tile, like every other
 *  way in this layout paves. */
function paveMeadowRoutes(ctx: ArchetypeContext, plan: RoutePlan, water: Set<string>, routes: Set<string>): void {
  const pal = MEADOW_PALETTES[ctx.zone] ?? MEADOW_PALETTES.summer
  const lane = new Set<string>()
  for (const key of plan.cells) if (!water.has(key)) lane.add(key)
  clearMeadowCells(ctx, lane)
  for (const key of lane) {
    const { col, row } = toCell(key)
    if (!inBounds(col, row, ctx.cols, ctx.rows)) continue
    ctx.ground[row][col] = 'meadow'
    ctx.floorColors[row][col] = pal.cobble
    routes.add(key)
  }
  deckRoutes(ctx, plan, water, pal.cobble)
}

/** Pave the ONE bottom-left entrance LANE with cobblestone (the flat 'meadow' floor tinted the cobble tone —
 *  a colour, not a tile) from the near edge inward, lined with colourful flower beds + lamp posts (the lit
 *  cobble way in #24). Clears any framing tree/prop off the lane first, so the way in is always a clean
 *  opening. */
function paintMeadowEntrance(ctx: ArchetypeContext, water: Set<string>, routes: Set<string>, fromTop = false, frac = MEADOW_ENTRANCE_FRAC): void {
  const { cols, rows, ground, collision, floorColors, zone } = ctx
  const pal = MEADOW_PALETTES[zone] ?? MEADOW_PALETTES.summer
  const g = clamp(Math.floor(cols * frac), MEADOW_ENTRANCE_HALF + 1, cols - MEADOW_ENTRANCE_HALF - 2)
  // The lane runs IN from the chosen edge — depth d = 0 at the edge (top row 0, or the bottom row) growing inward.
  const rowAt = (d: number): number => (fromTop ? d : rows - 1 - d)
  // Clear the lane (trees/props the framing pass may have dropped) so the cobble way is a real opening.
  const lane = new Set<string>()
  for (let d = 0; d < MEADOW_ENTRANCE_RUN; d++)
    for (let w = -MEADOW_ENTRANCE_HALF; w <= MEADOW_ENTRANCE_HALF; w++) lane.add(`${g + w},${rowAt(d)}`)
  // Never the water in it. Clearing a river cell's collision makes the river WALKABLE, and a river on the
  // `through` course can run straight across this lane. The old perimeter river left the near edge open, so
  // it never reached here, which is why this only showed once the courses existed.
  for (const key of [...lane]) if (water.has(key)) lane.delete(key)
  clearMeadowCells(ctx, lane)
  for (let d = 0; d < MEADOW_ENTRANCE_RUN; d++) {
    const row = rowAt(d)
    for (let w = -MEADOW_ENTRANCE_HALF; w <= MEADOW_ENTRANCE_HALF; w++) {
      const c = g + w
      if (!inBounds(c, row, cols, rows) || water.has(`${c},${row}`) || collision[row][c]) continue
      ground[row][c] = 'meadow'
      floorColors[row][c] = pal.cobble
      routes.add(`${c},${row}`)
    }
    plantFlowerBed(ctx, g - MEADOW_ENTRANCE_HALF - 1, row) // beds hug both sides of the lane
    plantFlowerBed(ctx, g + MEADOW_ENTRANCE_HALF + 1, row)
  }
  // Lamp posts flanking the way (the lit cobble path in #24) — a pair near the edge and a pair a few cells in.
  // placeLampPost blocks its own cell, so they never sit on the walkable lane.
  for (const d of [2, Math.min(MEADOW_ENTRANCE_RUN - 2, 7)]) {
    placeLampPost(ctx, g - MEADOW_ENTRANCE_HALF - 1, rowAt(d))
    placeLampPost(ctx, g + MEADOW_ENTRANCE_HALF + 1, rowAt(d))
  }
}

/** Drop a flower into a lane-side bed cell (open meadow only) — a light stochastic scatter so the beds read
 *  as tended borders, not a solid wall of blooms. */
function plantFlowerBed(ctx: ArchetypeContext, col: number, row: number): void {
  const { cols, rows, collision, ground } = ctx
  if (!inBounds(col, row, cols, rows) || collision[row][col] || ground[row][col] !== 'meadow') return
  if (ctx.rand() < 0.55) placeProp(ctx, makeFlower(ctx.rand, ctx.zone, col, row))
}

// The ornament ZONE kinds sprinkled over the open centre — weighted so flowers dominate and rock/earth
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
 *  grass tufts, and rock / bare-earth patches — "not everything is green". Each zone is a small blob of a
 *  single kind on a coarse jittered grid, so the meadow reads as tended plots, not confetti. */
function scatterMeadowOrnaments(ctx: ArchetypeContext, water: Set<string>): void {
  const { cols, rows } = ctx
  const step = 8
  const inset = MEADOW_OUTER_BAND + 2 // keep ornaments in the open meadow, off the river/edge band
  for (let gy = inset; gy < rows - inset; gy += step) {
    for (let gx = inset; gx < cols - inset; gx += step) {
      if (ctx.rand() < 0.5) continue // mostly OPEN — leave wide gaps between the few tended plots (#24)
      const cc = clamp(gx + randIntWith(ctx.rand, 0, step - 3), 1, cols - 2)
      const cr = clamp(gy + randIntWith(ctx.rand, 0, step - 3), 1, rows - 2)
      placeMeadowOrnamentZone(ctx, cc, cr, pickOrnamentKind(ctx.rand()), water)
    }
  }
}

/** Faint tended-field PATCHWORK painted as per-cell floor COLOUR (#24): a coarse checkerboard of large
 *  MEADOW_PATCH×MEADOW_PATCH patches, half of them nudged toward a pale plot tone — so the open field reads as
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
    floorColors[row][col] = lerpHex(base, pal.plot, 0.16) // faint, whole-patch tone
  })
}

// One cell of an ornament zone, dispatched by kind (Open/Closed: add a kind = add a row). Each reads a
// clear meadow cell and either tints the floor (grass/earth) or stacks a sparse ornament prop on top.
const MEADOW_ORNAMENT_CELL: Readonly<Record<MeadowOrnament, (ctx: ArchetypeContext, col: number, row: number, pal: MeadowPalette) => void>> = {
  flowers: (ctx, col, row) => { if (ctx.rand() < 0.7) placeProp(ctx, makeFlower(ctx.rand, ctx.zone, col, row)) },
  grass: (ctx, col, row, pal) => {
    const base = ctx.floorColors[row][col] ?? pal.grass
    ctx.floorColors[row][col] = lerpHex(base, meadowTint(pal.grass, col, row), 0.3) // a gentle darker-green mottle, not a hard blob
  },
  earth: (ctx, col, row, pal) => { ctx.floorColors[row][col] = mutedEarth(ctx, col, row, pal) },
  rock: (ctx, col, row, pal) => {
    ctx.floorColors[row][col] = mutedEarth(ctx, col, row, pal) // bare earth under the rocks
    if (ctx.rand() < 0.22) placeProp(ctx, makeMeadowRock(ctx, col, row)) // a few LIGHT-grey field stones, sparse
  },
}

// Light warm-grey field stones for the meadow (the boulder tile tinted a pale rock tone) — NOT the dark
// cave rockShade makeRock uses, so a meadow rock reads like the pale stones in #14/#17, not a black cube.
const MEADOW_ROCK_SHADES: ReadonlyArray<string> = ['#a49c90', '#9a9188', '#ab9f8e', '#928a80']
function makeMeadowRock(ctx: ArchetypeContext, col: number, row: number): StageProp {
  return { ...makeRock(col, row), color: MEADOW_ROCK_SHADES[randIntWith(ctx.rand, 0, MEADOW_ROCK_SHADES.length - 1)] }
}

/** A SUBTLE per-cell tone jitter for an ornament patch — a coherent position hash mapped to a value CENTRED
 *  on 0.5 (t∈[0.42,0.58]) so varyIntensity nudges the colour a touch lighter/darker, never crushing it to
 *  black (which passing t≈0 would do). Keeps a patch reading as its base tan/green, just mottled. */
function meadowTint(base: string, col: number, row: number): string {
  return varyIntensity(base, 0.42 + shadeNoise(col * 1.9 + row * 2.3) * 0.16)
}

/** A MUTED dirt tone for an earth/rock patch — the tan `earth` blended back toward the cell's own green floor
 *  so the patch reads as a soft brown mottle (like #24's subtle dirt), not a saturated tan block. */
function mutedEarth(ctx: ArchetypeContext, col: number, row: number, pal: MeadowPalette): string {
  const base = ctx.floorColors[row][col] ?? pal.grass
  return lerpHex(base, meadowTint(pal.earth, col, row), 0.55)
}

/** Paint ONE ornament zone — a small blob (radius 1) of a single kind on clear open meadow, never on
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

/** A stone BRIDGE crossing the river at the TOP-RIGHT (#24) — a 3-wide run of walkable 'bridge' tiles
 *  spanning the top-edge water column, with a cobble tone, linking the open meadow to the land strip beyond
 *  the river. Drawn AFTER repairFloorConnectivity so its walkable deck is never filled back to forest; clears
 *  any tree/prop on the deck. */
function placeMeadowBridge(ctx: ArchetypeContext, water: Set<string>): void {
  const { cols, rows } = ctx
  const bridgeCol = Math.floor(cols * 0.72) // top-right, over the top-edge river arm (#24)
  const span: number[] = []
  for (let row = 0; row < rows; row++) if (water.has(`${bridgeCol},${row}`)) span.push(row)
  if (span.length === 0) return
  const rowsToDeck = [Math.min(...span) - 1, ...span, Math.max(...span) + 1]
  const deck = new Set<string>()
  for (const row of rowsToDeck) for (let w = -1; w <= 1; w++) deck.add(`${bridgeCol + w},${row}`)
  // The meadow's own cobble, stated here rather than defaulted inside layDeck — a stone bridge over a
  // meadow river is this layout's design, not something every caller should inherit.
  layDeck(ctx, deck, (MEADOW_PALETTES[ctx.zone] ?? MEADOW_PALETTES.summer).cobble)
  // …and the STRUCTURE on it. This function's own doc calls itself "a stone BRIDGE crossing the river", so it
  // is the one deck of the six that most obviously owes him a real bridge. The deck runs along +row here (it
  // spans the top-edge arm at a fixed column), so the span axis is rows, not cols.
  recordBridgeSpan(ctx, deck, false)
}

/**
 * THE CROSSING, JOINED TO THE PATHS (ticket 36). Alexander, 2026-09-10: *"rivers need crossings connected to
 * the paths"*.
 *
 * `placeMeadowBridge` spans the river at a FIXED column, wherever that lands. On a meadow it happens to land
 * near the way in; in a wood it lands wherever it lands, so you get a deck in the middle of the trees with no
 * route to it. That is the defect he named, and it is a placement problem, not a missing feature.
 *
 * This one works the other way round: start from the ROUTE the layout already paved, span the river at its
 * narrowest point beside it, and pave a spur from each bank back to the nearest route cell. The deck ends up
 * part of the path network rather than a bridge that happens to exist.
 *
 * Returns false when there is nothing to join to (no route, or no water beside it) so the caller can fall
 * back to the plain bridge — a river still has to be crossable either way.
 */
function placeRiverCrossing(ctx: ArchetypeContext, water: Set<string>, routes: Set<string>): boolean {
  if (water.size === 0 || routes.size === 0) return false
  const meet = closestPair(routes, water)
  if (!meet) return false

  // Span whichever way the river is NARROWER here — the perimeter river runs along the top as a horizontal
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
    for (let w = -1; w <= 1; w++) deck.add(`${cell.col + perp[0] * w},${cell.row + perp[1] * w}`)
  }
  if (![...deck].some(key => inBounds(toCell(key).col, toCell(key).row, ctx.cols, ctx.rows))) return false
  // A crossing wears the route it joins: the template's own trail tone when it serves one, and the meadow's
  // stone when it does not, because a bridge over a meadow river IS cobble. That is this layout's design
  // choice, not a stand-in for a served value it failed to read.
  layDeck(ctx, deck, ctx.palette?.trail ?? (MEADOW_PALETTES[ctx.zone] ?? MEADOW_PALETTES.summer).cobble)
  // …and a real BRIDGE standing on it. `horizontal` is the deck's own axis, decided above by which way the
  // river is narrower here, so the bridge lies ACROSS the water rather than along it.
  recordBridgeSpan(ctx, deck, horizontal)

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

/** How many consecutive water cells lie beyond `at` in direction (dc, dr) — how far the river reaches that way. */
function waterReach(water: Set<string>, at: Cell, dc: number, dr: number): number {
  let n = 0
  let { col, row } = at
  while (water.has(`${col + dc},${row + dr}`)) {
    col += dc
    row += dr
    n++
  }
  return n
}

/** Turn a set of cells into walkable deck: clear what stands on them and lay the crossing this map is built
 *  with. Shared by every crossing (the bridge, the joined crossing, fallen logs, a route over water) so they all
 *  read alike, and each cell is remembered in `ctx.decks`. */
/** The shortest run worth building a bridge over: one cell of water and a landing at each end. */
const MIN_BRIDGE_SPAN = 3

/**
 * RECORD A BRIDGE over a deck run. Alexander, 2026-09-12, in capitals: *"AND THE BRIDGES ARE STILL NOT
 * BRIDGES COMPOSITIONS / we should have actual BRIDGE"*, with a wooden arch, a steel truss and a sheet of ten
 * variations.
 *
 * The flat deck STAYS. It is laid first by the caller and this adds the structure on top, which keeps every
 * connectivity guarantee intact (a crossing is still a crossing whatever span the river turns out to be) and
 * means no run can come out uncrossable because no composition happened to fit it.
 *
 * The span is asked of the CATALOG, descending, rather than read from a list here: whatever spans the backend
 * ships are the spans used, so authoring `bridge_wood_9` needs no frontend change. A crossing that names no
 * composition records nothing, which is how a DIRT PATH stays a path (his #62, *"this is a dirt pathway"*).
 *
 * Rotation: a bridge is authored `span x 3` running along +dx, so a deck lying along +row turns one quarter
 * (`rotateOffsetCW` maps it to `3 x span`, anchor still top-left). The anchor is the run's top-left corner,
 * nudged by half the slack so the abutments sit on the landings rather than in the water.
 */
function recordBridgeSpan(ctx: ArchetypeContext, deck: ReadonlySet<string>, spanAlongCol: boolean): void {
  const family = crossingStyle(ctx)?.composition
  if (!family) return
  const cells = [...deck].map(toCell).filter(c => inBounds(c.col, c.row, ctx.cols, ctx.rows))
  if (cells.length === 0) return
  const minCol = Math.min(...cells.map(c => c.col))
  const minRow = Math.min(...cells.map(c => c.row))
  const runLength = spanAlongCol
    ? Math.max(...cells.map(c => c.col)) - minCol + 1
    : Math.max(...cells.map(c => c.row)) - minRow + 1
  for (let span = runLength; span >= MIN_BRIDGE_SPAN; span--) {
    const kind = `${family}_${span}`
    if (!resolveComposition(styleCatalog('ascii'), kind)) continue
    const offset = Math.floor((runLength - span) / 2)
    ctx.compositions.push({
      kind,
      col: spanAlongCol ? minCol + offset : minCol,
      row: spanAlongCol ? minRow : minRow + offset,
      variant: 0,
      rotation: spanAlongCol ? 0 : 1,
    })
    return
  }
}

function layDeck(ctx: ArchetypeContext, deck: Set<string>, tone: string | undefined): void {
  const { cols, rows, ground, collision, floorColors } = ctx
  const style = crossingStyle(ctx)
  clearMeadowCells(ctx, deck)
  for (const key of deck) {
    const { col, row } = toCell(key)
    if (!inBounds(col, row, cols, rows)) continue
    ground[row][col] = style?.tile ?? 'bridge'
    collision[row][col] = false
    ctx.decks.add(key)
    // A DECK SPANS THE CHANNEL, it does not lie in the bottom of it. The dig runs inside `carveChannel`, which
    // is before any crossing is laid, so a deck cell was still carrying the bed's negative elevation and a
    // bridge came out sunk in the water. Measured on a `divides` river: 14 of its cells.
    ctx.elevation[row][col] = 0
    // A served crossing wears its own colour (or the tile it names in `colorOf`), written over whatever the
    // cell wore as water. The classic deck keeps the caller's tone, and with no tone leaves the colour alone:
    // a default here would be a hardcoded fallback for a SERVED value.
    if (style) floorColors[row][col] = groundTileColor(style.colorOf ?? style.tile, col, row) || undefined
    else if (tone) floorColors[row][col] = tone
  }
}

/**
 * PLANK THE WAY WHERE IT CROSSES WATER.
 *
 * Alexander, 2026-09-11: *"if we're going to have water blocked zones, we must have clear pathways to navigate
 * them"*, with his swamp (image #18) as the example, the boardwalk over the pools IS the pathway there.
 *
 * The water is carved without knowing where the paths run, so a creek or a pool can land straight on a gate and
 * leave a way out that nobody can use (measured: three jungle seeds in eight). Every planned cell that came out
 * wet gets a deck, which is the same crossing the map uses everywhere else, so it wears the served kind too.
 */
function deckRoutes(ctx: ArchetypeContext, plan: RoutePlan, water: ReadonlySet<string>, tone: string | undefined): void {
  const wet = new Set<string>()
  for (const key of plan.cells) if (water.has(key)) wet.add(key)
  if (wet.size > 0) layDeck(ctx, wet, tone)
}

/**
 * THE KIND OF CROSSING. Alexander, 2026-09-11: *"on the "bridges" that we use on rivers, we must have multiple
 * variations too / it can be a simple dirt path, it can be an actual bridge, which again, are multiple
 * variations"*. One per map, so every crossing on it matches, picked the first time a deck is laid.
 */
function crossingStyle(ctx: ArchetypeContext): GeneratorCrossing | undefined {
  if (ctx.crossing === undefined) ctx.crossing = resolveCrossing(ctx.options?.bridge, ctx.crossings, ctx.rand) ?? null
  return ctx.crossing ?? undefined
}

/** The pure half of `crossingStyle`. `random` picks one of the served kinds; an option the map was not built
 *  with (an older recipe) keeps the classic deck, so a saved map does not change under anyone. */
export function resolveCrossing(
  value: GeneratorOptionValue | undefined,
  crossings: Readonly<Record<string, GeneratorCrossing>> | undefined,
  rand: Rng,
): GeneratorCrossing | undefined {
  if (!crossings || typeof value !== 'string') return undefined
  if (value !== 'random') return crossings[value]
  const kinds = Object.keys(crossings)
  return kinds.length > 0 ? crossings[kinds[randIntWith(rand, 0, kinds.length - 1)]] : undefined
}

/** Pave an L-shaped spur from the bridge landing to the route it joins, wearing the TILE AND COLOUR of that
 *  route cell — so the spur looks like the path it runs into (a forest trail in a wood, cobble on a meadow)
 *  without this code knowing which layout called it. Never paves over water; the deck is what crosses that. */
function carveSpur(ctx: ArchetypeContext, from: Cell, to: Cell, water: Set<string>): void {
  const { cols, rows, ground, floorColors } = ctx
  if (!inBounds(to.col, to.row, cols, rows)) return
  const tile = ground[to.row][to.col]
  const tone = floorColors[to.row][to.col]

  const lane = new Set<string>()
  const widen = (col: number, row: number) => {
    for (let dc = 0; dc < WOODLAND.pathWidth; dc++)
      for (let dr = 0; dr < WOODLAND.pathWidth; dr++) lane.add(`${col + dc},${row + dr}`)
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

/** Remove every tree anchor + prop on the given cell keys and clear their collision — the surgical "make
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
 *  disconnected regions are LEFT alone — the land strip BEYOND the river (#24) is a deliberate separate area
 *  (open grass + the sparse framing trees), not a pocket to carpet. Canopy tops are a separate walkable
 *  layer — excluded. */
function repairFloorConnectivity(ctx: ArchetypeContext, maxPocket = Infinity): void {
  const { collision, zone, cols, rows, trees: anchors } = ctx
  const isFloor = (col: number, row: number): boolean => inBounds(col, row, cols, rows) && !collision[row][col]

  const seen = new Set<string>()
  const regions: Set<string>[] = []
  let largest = new Set<string>()
  forEachCell(cols, rows, (col, row) => {
    if (!isFloor(col, row) || seen.has(`${col},${row}`)) return
    const region = floodFloor(isFloor, col, row, seen)
    regions.push(region)
    if (region.size > largest.size) largest = region
  })
  for (const region of regions) {
    if (region === largest || region.size > maxPocket) continue // keep the meadow + the intentional outer strip
    // A pocket the WATER cut off is not a mistake, it is a MOUND. His image #18 is mounds with boardwalks
    // between them, so carpeting one with tree mass deletes the very thing you are meant to stand on. Left
    // alone here, and `joinStrandedRegions` planks out to it.
    if (waterBound(ctx, region)) continue
    region.forEach(key => {
      const { col, row } = toCell(key)
      collision[row][col] = true
      anchors.push({ col, row, kind: pickLivingTree(shadeNoise(col * 17 + row * 43), ctx.treeMix), variant: massVariant(col, row) % canopyCount(styleCatalog('ascii'), zone) }) // tiny dead pocket → forest fills it
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

const FLOOR_DIRS: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]]

/** The biggest connected region of floor cells (4-neighbour), as a key set. Used by the cave / boss
 *  archetypes to keep the carved floor one navigable region. */
function largestFloorRegion(isFloor: (c: number, r: number) => boolean, cols: number, rows: number): Set<string> {
  const seen = new Set<string>()
  let best = new Set<string>()
  forEachCell(cols, rows, (col, row) => {
    if (!isFloor(col, row)) return
    if (seen.has(`${col},${row}`)) return
    const region = floodFloor(isFloor, col, row, seen)
    if (region.size > best.size) best = region
  })
  return best
}

function floodFloor(
  isFloor: (c: number, r: number) => boolean,
  startCol: number,
  startRow: number,
  seen: Set<string>,
): Set<string> {
  const region = new Set<string>()
  const stack: Cell[] = [{ col: startCol, row: startRow }]
  seen.add(`${startCol},${startRow}`)
  while (stack.length > 0) {
    const { col, row } = stack.pop()!
    region.add(`${col},${row}`)
    for (const [dc, dr] of FLOOR_DIRS) {
      const c = col + dc
      const r = row + dr
      const key = `${c},${r}`
      if (seen.has(key)) continue
      if (!isFloor(c, r)) continue
      seen.add(key)
      stack.push({ col: c, row: r })
    }
  }
  return region
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
// tree occupies only its trunk cell for collision/placement — no ground footprint beyond the anchor.

// Per-zone chance a scattered glade tree is a leafless snag — harsher zones have
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
 * A tree's trunk cell must stand on UNPAVED ground — not the paved plaza, driveways, or roads. `treeFits` guards
 * collision; this guards the GROUND, so a tree never lands on the town square. (The canopy is walkable overhead
 * and occupies no ground, so only the trunk cell is checked.) Pure — reads `ground` only.
 */
export function treeColumnClearsPaving(ground: string[][], col: number, baseRow: number): boolean {
  return !BUILT_FLOOR.has(ground[baseRow]?.[col])
}

/** Record a TREE anchor (trunk-base cell + composition kind + canopy shade). The generator no longer bakes flat
 *  tree cells; at load applyStageToGrid stamps the composition (stampComposition) into per-cell heightLevel-
 *  stacked DB tiles — the SAME lego model buildings use, so every tree tile is selectable and 100% backend-
 *  driven. The canopy is walkable overhead, so collision here blocks only the trunk cell — matching the stamp. */
function stampTree(ctx: ArchetypeContext, baseCol: number, baseRow: number, dead = false): void {
  const { collision, zone, trees, cols, rows } = ctx
  if (!isLandCell(ctx, baseCol, baseRow)) return // land-only: no tree in water
  const variant = randIntWith(ctx.rand, 0, canopyCount(styleCatalog('ascii'), zone) - 1) // this tree's canopy tone (green…pink)
  const kind = dead ? 'tree_dead' : pickLivingTree(ctx.rand(), ctx.treeMix) // random shape variant (standard/tall/small/round/bush)
  trees.push({ col: baseCol, row: baseRow, kind, variant })
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

const ORTHO: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

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

const toCell = (key: string): Cell => {
  const [col, row] = key.split(',').map(Number)
  return { col, row }
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

function placeTemple(ctx: ArchetypeContext): void {
  const { cols, rows, zone } = ctx
  // Falls back to SUMMER's palette, as it always did — but by READING it, since the table is backend data
  // now. No palette at all (the catalog has not answered) and there is nothing to draw a temple from.
  const pal = templePalette(zone) ?? templePalette('summer')
  if (!pal) { console.warn('[generate] no temple palette served — nothing built'); return }

  // 1. Repaint the whole ground to the seasonal temple floor; start fully walled (solid stone).
  forEachCell(cols, rows, (col, row) => {
    ctx.ground[row][col] = pal.floor
  })
  const wall = makeGrid(cols, rows, () => true)

  // 2. Carve the ROOMS. With ways served they come FROM the plan (sanctum at its deepest point, chapels at the
  //    other stops, the hall at the way in); without, the fixed list this always used.
  const plan = plannedRoutes(ctx)
  const rooms = plan ? templeRoomsFromPlan(ctx, plan) : templeRooms(cols, rows)
  rooms.forEach(room => carveTempleRoom(wall, room, cols, rows))

  // 3. Wire them together. The planned ways ARE the halls when there are ways; otherwise the old corridors.
  if (plan) carveTempleWays(wall, plan, cols, rows)
  else connectTempleRooms(wall, rooms, cols, rows)

  // 4. Seal the map border so the dungeon is fully enclosed.
  forEachCell(cols, rows, (col, row) => {
    if (isEdge(col, row, cols, rows)) wall[row][col] = true
  })

  // 5. Commit the seasonal stone walls (blocking) over the negative space.
  commitTempleWalls(ctx, wall, pal)

  const boss = rooms.find(r => r.role === 'boss')!
  const entrance = rooms.find(r => r.role === 'entrance')!

  // 6. Ornate checker inlay over the room floors (the tiled temple look).
  paintTempleInlay(ctx, rooms, pal)

  // 7. Pillared halls — colonnades lining every room but the entrance (kept clear for spawn).
  rooms.forEach(room => {
    if (room.role !== 'entrance') placePillaredHall(ctx, room, pal)
  })

  // 8. The grand BOSS chamber: a central altar, flanking braziers, a pillar ring.
  placeAltarChamber(ctx, boss, pal)

  // 9. Wall torches lighting the halls.
  placeTorches(ctx, rooms, pal)

  // 10. Seasonal HAZARDS — spike traps on room floors + water/ice/lava/sand-trap pools (kept out
  //     of the entrance + boss chambers so the critical path is never gated).
  placeTempleHazards(ctx, rooms, pal, plan?.cells ?? new Set())

  // 11. Guarantee ONE connected floor — fill any pocket a blocking pool stranded with wall.
  repairTempleFloor(ctx, pal)

  // 12. The narratively-locked GATEWAY (a walkable threshold) + its KEY. On a planned temple the gate sits on
  //      the sanctum's own corridor and the key in a chapel, so the key is reachable WITHOUT crossing the gate.
  if (plan) placeSanctumGate(ctx, boss, rooms, plan, pal)
  else placeLockedDoorAndKey(ctx, boss, entrance, rooms, pal)
}

/** Lay out the dungeon rooms: a south ENTRANCE hall (spawn), a grand north BOSS chamber, and a
 *  row of pillared side HALLS across the middle band. Deterministic sizes, jittered positions. */
/**
 * THE PLAN IS THE TEMPLE, once the generator says how many ways run through it.
 *
 * Alexander, 2026-09-11: *"caves and temples are BAD, they should be completely re-imagined ... research temple
 * types and how they've been built in other games, like world of warcraft, warcraft 3, zelda"*.
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

/** The halls ARE the planned ways: carve the band the plan painted, never the border. */
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

/** Ornate CHECKER inlay over the room floors — alternate the season's floor + accent tile so a
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
 *  central aisle clear — the pillared-hall look. Guarded (never on the door/aisle). */
function placePillaredHall(ctx: ArchetypeContext, room: TempleRoom, pal: TemplePalette): void {
  if (room.w < 5 || room.h < 4) return
  const left = room.col + 1
  const right = room.col + room.w - 2
  for (let row = room.row + 1; row < room.row + room.h - 1; row += 2) {
    placeProp(ctx, makePillar(left, row, pal.pillar))
    placeProp(ctx, makePillar(right, row, pal.pillar))
  }
}

/** The grand boss chamber: a central ALTAR flanked by braziers, ringed by pillars — the
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

/** Wall torches lighting each room — dropped at the interior corners (non-blocking sconces). */
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
    // a hazard pool near the room centre (radius 1–2), confined to the room interior.
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

/** Flood-fill the walkable floor and fill every cell OUTSIDE the largest region with wall — so
 *  the dungeon floor is always ONE connected region, even after blocking hazard pools. */
function repairTempleFloor(ctx: ArchetypeContext, pal: TemplePalette): void {
  const { collision, props, cols, rows } = ctx
  const isFloor = (col: number, row: number): boolean => inBounds(col, row, cols, rows) && !collision[row][col]
  const largest = largestFloorRegion(isFloor, cols, rows)
  forEachCell(cols, rows, (col, row) => {
    if (!isFloor(col, row)) return
    if (largest.has(`${col},${row}`)) return
    collision[row][col] = true
    props.push(makeTempleWall(col, row, pal.wall)) // stranded pocket → wall it off
  })
}

/** The (narratively) locked boss GATEWAY — a walkable threshold prop at the corridor mouth just
 *  south of the boss chamber — and its KEY, dropped on a side-hall floor. Both guarded + optional
 *  (skipped when no clear cell is found), and WALKABLE so connectivity is never broken. */
function placeLockedDoorAndKey(ctx: ArchetypeContext, boss: TempleRoom, entrance: TempleRoom, rooms: TempleRoom[], pal: TemplePalette): void {
  const { collision, cols, rows } = ctx
  const gateCol = roomCentre(boss).col
  for (let row = boss.row + boss.h; row < entrance.row; row++) {
    if (!inBounds(gateCol, row, cols, rows) || collision[row][gateCol]) continue
    ctx.props.push(makeGateway(gateCol, row, pal.pillar)) // walkable — see makeGateway
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

// The south ENTRANCE — a guaranteed clear starting chamber joined to the cavern.
const ENTRANCE_HALF = 3 // → a 7-wide chamber
const ENTRANCE_HEIGHT = 4

/**
 * A CAVE IS A SPIDER, once the generator says how many ways run through it.
 *
 * Alexander, 2026-09-11: *"caves and temples are BAD, they should be completely re-imagined, just like we did
 * with forests, we should research temple types and how they've been built in other games, like world of
 * warcraft, warcraft 3, zelda, etc"*, and *"I can generate a cave with 1 exit and 3 pathways to simulate
 * entrance, then I continue doing the same until I reach a part where is just 1 exit no pathway, which is the
 * end of the cave"*.
 *
 * The research he asked for says the same thing twice. A Zelda dungeon is a SPIDER: an entrance, a hub (the
 * body), legs off it, each leg ending somewhere worth reaching, the boss locked off the hub. His "1 exit and 3
 * pathways" IS that spider. WoW's lesson is rhythm, a short run and then a place that looks like somewhere, so
 * every stop gets a CHAMBER rather than a corridor end. Warcraft 3's is the chokepoint, so a gallery pinches
 * and opens along its length, which the plan's SPINE makes safe to do.
 *
 * What this used to be: one cellular-automata blob with a chamber cut into its south edge, and no notion of
 * where you came in or where you could go next. A generator that serves no ways still gets exactly that.
 */
const CAVE_HUB_RADIUS = [4, 6] as const
const CAVE_STOP_RADIUS = [3, 4] as const
const CAVE_MOUTH_RADIUS = 2
/** Above this the gallery carries its full width; below it it pinches to the spine alone. A chokepoint. */
const CAVE_PINCH = 0.42

/** A blobby chamber: a disc whose radius wobbles per cell, so it reads as a cave rather than a room. The border
 *  is never touched: a cave is enclosed, and its ways out are MOUTHS, not holes in the rock. */
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

function placeCave(ctx: ArchetypeContext): void {
  const { cols, rows, zone } = ctx
  const pal = cavePalette(zone) ?? cavePalette('summer')
  if (!pal) { console.warn('[generate] no cave palette served — nothing built'); return }

  // 1. Repaint the whole ground to the seasonal cave floor (walls cover their cells).
  forEachCell(cols, rows, (col, row) => {
    ctx.ground[row][col] = pal.floor
  })

  const plan = plannedRoutes(ctx)
  let rock: boolean[][]
  let entrance: Rect
  // The rooms you stand in: the hub, every stop, every mouth. A pool belongs in the cavern AROUND them.
  let chambers: ReadonlySet<string> = new Set<string>()

  if (plan) {
    // 2. THE SPIDER, carved out of solid rock: chambers where you arrive, where the ways meet, and where each
    //    one ends; galleries between them.
    rock = makeGrid(cols, rows, () => true)
    chambers = carveCaveSpider(ctx, rock, plan)
    entrance = mouthRect(plan.entrance)
  } else {
    // 2. CA cavern skeleton → keep ONE connected cavern (stray pockets fill back to rock).
    rock = makeGrid(cols, rows, () => Math.random() < CAVE_FILL)
    for (let i = 0; i < CAVE_ITERATIONS; i++) rock = smoothCave(rock, cols, rows)
    const cavern = keepLargestClearing(rock, cols, rows) // true = rock

    // 3. Carve the south entrance chamber and join it to the cavern with a wide corridor.
    entrance = carveEntranceChamber(rock, cols, rows)
    joinEntranceToCavern(rock, entrance, cavern, cols, rows)
  }

  // 4. Seal the map border so the cavern is fully ENCLOSED (the CA can leave stray
  //    open border cells; force them rock — the interior floor is repaired below).
  forEachCell(cols, rows, (col, row) => {
    if (isEdge(col, row, cols, rows)) rock[row][col] = true
  })

  // 5. Commit the seasonal rock walls (blocking) over the negative space.
  commitCaveWalls(ctx, rock, pal)

  // 6. Seasonal water / ice / lava pools in the cavern (kept north of the entrance).
  carveCavePools(ctx, pal, entrance, chambers)

  // 6b. A pool never cuts a gallery. The same rule the forests got: where a planned way meets water the way
  //     wins (there it is planked, here the cave simply does not flood its own corridor).
  if (plan) keepSpineOpen(ctx, plan, pal)

  // 7. Guarantee ONE connected floor — but RE-OPEN the way in first. A pool can land across the corridor
  //    that joins the entrance chamber to the cavern, and the repair below keeps the LARGEST region, so the
  //    severed entrance was the pocket it filled: ~3% of caves came out with no entrance at all. Reconnecting
  //    before repairing means the entrance is part of the kept region by construction.
  reopenCaveEntrance(ctx, pal, entrance)
  repairCaveFloor(ctx, pal)

  // 8. Populate: moss/leaf accents, crystal clusters, a mushroom patch, floor rubble.
  paintFloorAccents(ctx, pal)
  scatterCrystalClusters(ctx, pal)
  if (pal.mushrooms) placeMushroomPatch(ctx, pal)
  scatterCaveRubble(ctx, pal)
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
    props.push(makeCaveWall(col, row, pal.wall))
    collision[row][col] = true
  })
}

/** Stamp 1–3 seasonal pools onto cavern FLOOR (never carving into rock walls), north
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
 * `keepOut` is how a CHAMBER stays dry: the hub is where the ways meet and a stop is the room at the end of
 * one, and a room you arrive in should not be a lake. Measured before this existed: ten of the twenty five
 * cells around the hub came out as water. The temple's own pool has the same discipline in the other
 * direction, staying strictly inside its room so it cannot seal a doorway. */
function stampPool(ctx: ArchetypeContext, pal: CavePalette, cc: number, cr: number, keepOut: ReadonlySet<string> = new Set()): void {
  const { ground, collision, cols, rows } = ctx
  const radius = 2 + Math.floor(Math.random() * 2) // 2–3
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
 *  rock — so the cavern floor is always ONE connected region (no unreachable pockets),
 *  even after blocking pools carve the space. */
function repairCaveFloor(ctx: ArchetypeContext, pal: CavePalette): void {
  const { collision, props, cols, rows } = ctx
  const isFloor = (col: number, row: number): boolean => inBounds(col, row, cols, rows) && !collision[row][col]
  const largest = largestFloorRegion(isFloor, cols, rows)
  forEachCell(cols, rows, (col, row) => {
    if (!isFloor(col, row)) return
    if (largest.has(`${col},${row}`)) return
    collision[row][col] = true
    props.push(makeCaveWall(col, row, pal.wall)) // stranded pocket → rock
  })
}

/** Re-join the entrance chamber to the main cavern if a pool severed the corridor between them.
 *
 *  `joinEntranceToCavern` opens that corridor while the map is still a rock grid, but the pools are stamped
 *  AFTER it — and a blocking pool (water/lava) laid across the corridor cuts the entrance off. The floor
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

  // 1 · The CHAMBER is floor by definition — it is the room you arrive in. A pool that grew south into it
  //     (they seed north of it, but they spread) left it part-filled, and a half-buried entrance is the same
  //     defect as a severed one. Restore the room the carve intended before worrying about the corridor.
  for (let r = entrance.row; r < entrance.row + entrance.h; r++)
    for (let c = entrance.col; c < entrance.col + entrance.w; c++) open(c, r)

  // 2 · …and JOIN it to the main cavern, if a pool landed across the corridor that used to reach it.
  const largest = largestFloorRegion(isFloor, cols, rows)
  if (largest.size === 0 || largest.has(`${mouth.col},${mouth.row}`)) return // already connected — the common case
  const target = [...largest].map(toCell).reduce((a, b) => (manhattan(mouth, b) < manhattan(mouth, a) ? b : a), toCell([...largest][0]))
  for (let c = Math.min(mouth.col, target.col); c <= Math.max(mouth.col, target.col); c++) open(c, mouth.row)
  for (let r = Math.min(mouth.row, target.row); r <= Math.max(mouth.row, target.row); r++) open(target.col, r)
}

/**
 * Moss, fallen leaves or dune as ORNAMENTS, the way the meadow sprinkles its plots: a few small patches on a
 * loose grid (the meadow's own spacing). It used to roll every floor cell against `accentChance`, which textured a
 * fifth of the floor; Alexander, 2026-09-11: *"only using the floor tiles as ornaments"*. `accentChance` is now
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

/** Scatter 2–4 crystal CLUSTERS — each a small blob of gems grown near a wall (a random
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
 *  under it where the season is mossy. A real patch (5–12 caps), non-blocking. */
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
 *  in-bounds floor cell — the shared clustered-placement helper for crystals + mushrooms. */
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

function placeBossStage(ctx: ArchetypeContext): void {
  const { cols, rows } = ctx
  const arena = arenaRect(cols, rows)

  // LAYOUT FIRST: wall everything, open the central arena, drive an entrance
  // corridor in from the south, then drop the single boss anchor.
  const wall = makeGrid(cols, rows, () => true)
  openArena(wall, arena)
  openEntranceCorridor(wall, arena, rows)

  commitArenaWalls(ctx, wall)
  paveArena(ctx, arena)
  placeBossAnchor(ctx, arena)
  decorateArena(ctx, arena)
  scatterGroundCover(ctx, 0.15) // light detail on any unpaved ground around the arena (skips stone)
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
 *  around the centre, and a sparse approach colonnade — aisle + entrance stay open. */
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
    if (!wall[row][col]) return
    props.push(makeRock(col, row))
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

/** Just inside the entrance: the way in is where you start. Null when this map planned no ways, or when the cell
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
 *  street. NO plaza is painted under the footprint anymore — the small footprint is fully covered
 *  by its own building cells (a roof from above), and the surrounding yard stays the natural ground
 *  (grass). This kills the old facade-height-deep plaza sprawl. */
function paintBuildingGround(b: PlacedBuilding, ground: StagePaint['ground']): void {
  const [dc, dr] = FACING_STEP[b.facing]
  // The setback yard cell in front of EACH door cell, paved as the driveway — a 2-wide door gets a
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
 *  SAVE carries — through the SAME per-cell mapping the LIVE stamp uses (`compositionCellRender`), so what was
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
  // The composition lands ON TOP of the floor tile at its anchor — the SAME level the live stamp gets from the
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
 *  Terrain height stays 0 — blocks are collision, not elevation. */
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
    // NO hardcoded height — the renderer reads each tile's OWN block-height from the DB (a flat decor is 0.1,
    // a standing prop ≥1), so a saved generated map matches the LIVE applyStageToGrid path (which also leaves
    // height to the tile). Height is DATA, never forced here.
    label: a.label,
    footprint: a.footprint,
    // The prop lands ON TOP of its floor tile — the SAME level the live path gets from the shared stack
    // (`cellStackTop`): 0 on a flat town floor, 1 on a height-1 meadow, so a saved ornament sits on the raised
    // floor with no embed. A floor is a tile, so this is just its block height.
    heightLevel: groundBlockHeight(stage.ground[a.row]?.[a.col] ?? ''),
    // Keep the curated catalog skin the live grid stamps (applyStageToGrid) so a SAVED generated map
    // reloads with the same palette tiles — same per-zone/role dispatch, so the two paths never diverge.
    tileOverride: stagePropTileOverride(stage.zone, a.type),
    // Per-instance render for standing props (a flower = single billboard, height 1) — the SAME override the
    // live grid applies, so save/load matches. Spreads height + settings.display when the type has one.
    ...generatedPropRender(a.type),
  }))

  // TREES, BUILDINGS and DECOR (the plaza centrepiece + the street lamps) are all recorded as composition
  // ANCHORS — the generator places no baked props for them. Expand each through the SAME per-cell path the
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
