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
import {
  stagePropTileOverride,
  ZONE_PALETTES,
  ZoneId,
  ZONE_FLOWERS,
  DEFAULT_FLOWERS,
  type FlowerKind,
  type LivingTreeKind,
  LIVING_TREE_VARIANTS,
  LIVING_TREE_WEIGHT,
  ROCK_SHADES,
  CAVE_DECOR,
  MUSHROOM_TONES,
  PROP_ART,
  type TemplePalette,
  TEMPLE_PALETTES,
  type CavePalette,
  CAVE_PALETTES,
} from './zones'
// Re-exported so the generator keeps its public tree-shape type (backend palette data now owns it).
export type { LivingTreeKind } from './zones'
import { type CellLabel } from './cellLabels'
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
export type ForestLayout = 'woodland' | 'meadow' | 'meadow_river' | 'meadow_pass'

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
  connectors: Connector[]
  spawn: { col: number; row: number }
}

export interface GenerateOptions {
  zone: ZoneId
  variant: VariantId
  cols?: number
  rows?: number
  /** Steer the general forest layout; the rest is randomized. Default 'passages'
   *  reproduces today's multi-passage forest. Only the forest variant reads it. */
  layout?: ForestLayout
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
   * `bigHouseRange`. The whole block passes through now; absent → the planner uses its own defaults.
   */
  settlement?: SettlementTuning
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
export function pickLivingTree(rand: number): LivingTreeKind {
  let roll = rand * LIVING_TREE_WEIGHT
  for (const v of LIVING_TREE_VARIANTS) {
    if (roll < v.weight) return v.kind
    roll -= v.weight
  }
  return LIVING_TREE_VARIANTS[0].kind
}

/** One blocking biome-feature cell (mountain / peak / spill) — appearance from
 *  the tileset's per-zone feature palette (ember crater in lava, snowcap + blue
 *  waterfall otherwise). Always blocks (it's terrain). */
const makeFeatureCell = (zone: ZoneId, col: number, row: number, label: CellLabel): StageProp => {
  const tile = resolveTile(styleCatalog('ascii'), zone, label) // LOADS from the tileset, not hardcoded cellTile
  return { col, row, type: 'feature', char: tile.char, blocking: true, color: tile.color, label }
}

// Walkable flowers read from the zone's curated bloom set (ZONE_FLOWERS in zones.ts).
const makeFlower = (rng: Rng, zone: ZoneId, col: number, row: number): StageProp => {
  const set = ZONE_FLOWERS[zone] ?? DEFAULT_FLOWERS
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

// Deterministic per-cell pick from the zone-data ROCK_SHADES palette (zones.ts) so cave/arena
// walls read tonal, not one flat grey.
const rockShade = (col: number, row: number): string => ROCK_SHADES[Math.abs(col * 7 + row * 13) % ROCK_SHADES.length]

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
  char: CAVE_DECOR[Math.abs(col * 5 + row * 7) % CAVE_DECOR.length],
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
// Cap tone from the zone-data MUSHROOM_TONES palette (zones.ts).
const makeMushroom = (col: number, row: number): StageProp => ({
  col, row, type: 'mushroom', char: '♠', label: 'mushroom', blocking: false,
  color: MUSHROOM_TONES[Math.abs(col * 3 + row * 5) % MUSHROOM_TONES.length],
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
  if (ZONE_FLOWERS[zone] === undefined) return // non-flowering zone → no blooms
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
// colour come from the zone-data PROP_ART table (zones.ts); a caller passes the zone's tint to override.
const makePillar = (col: number, row: number, color = PROP_ART.pillar.color): StageProp => ({ col, row, type: 'pillar', char: PROP_ART.pillar.char, blocking: true, color })
const makeBrazier = (col: number, row: number): StageProp => ({ col, row, type: 'brazier', char: PROP_ART.brazier.char, blocking: true, color: PROP_ART.brazier.color })
const makeAltar = (col: number, row: number, color = PROP_ART.altar.color): StageProp => ({ col, row, type: 'altar', char: PROP_ART.altar.char, blocking: true, color })

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
const makeTorch = (col: number, row: number, color: string): StageProp => ({ col, row, type: 'torch', char: PROP_ART.torch.char, blocking: false, color })

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

function edgeDecor(zone: ZoneId, neighbourType: string, col: number, row: number): StageProp | null {
  if (WATER_LIKE.has(neighbourType)) {
    const frost = zone === 'winter' || neighbourType === 'ice_water'
    return { col, row, type: 'shore', char: frost ? '∼' : '≈', blocking: false, color: frost ? '#bfe6f5' : '#6fb7d8' }
  }
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
      if (WATER_LIKE.has(here) || LAVA_LIKE.has(here)) continue // decorate LAND only
      if (collision[row][col] || occupied.has(`${col},${row}`)) continue
      for (const [dc, dr] of ORTHO) {
        const c = col + dc
        const r = row + dr
        if (!inBounds(c, r, cols, rows)) continue
        const decor = edgeDecor(zone, ground[r][c], col, row)
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
  cols: number
  rows: number
  /** The generator's served nature densities, or undefined when it states none. A layout must treat an
   *  absent value as "no opinion" and never substitute a number of its own — see the compliance rule. */
  nature?: NatureDensity
  /** The served settlement tuning — every number the backend states about a settlement's shape. */
  settlement?: SettlementTuning
  /** Where footprints come from — see `GenerateOptions.buildingSizes`. */
  buildingSizes?: BuildingSizes
  /** The user-steered forest layout, or undefined for a plain generate (placeForest then random-picks a
   *  meadow layout). Only placeForest reads it. */
  layout: ForestLayout | undefined
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

/** A layer's random source: its own reproducible `makeRng(seed)` when a seed is given, else the
 *  global `Math.random` (today's behaviour, so a plain generate is unchanged). */
const layerRng = (seeds: GenerateOptions['seeds'], layer: EngineLayerId): Rng => {
  const seed = seeds?.[layer]
  return seed === undefined ? Math.random : makeRng(seed)
}

export function generateStage(opts: GenerateOptions): StageData {
  const { zone, variant } = opts
  const cols = opts.cols ?? 40
  const rows = opts.rows ?? 40
  const layout = opts.layout // undefined → placeForest randomly picks a meadow layout (seeded)
  const palette = ZONE_PALETTES[zone]

  const ground = makeGrid(cols, rows, () => palette.groundTypes[0])
  const collision = makeGrid(cols, rows, () => false)
  const floorColors = makeGrid<string | undefined>(cols, rows, () => undefined)
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
  const ctx: ArchetypeContext = { zone, ground, collision, floorColors, buildings, props, trees, compositions, cols, rows, layout, nature: opts.nature, settlement: opts.settlement, buildingSizes: opts.buildingSizes, rand: rngs.layout }
  ARCHETYPES[variant]?.(ctx, rngs)
  addTerrainTransitions(ctx) // blended shorelines / lava banks over the painted ground

  return {
    zone,
    variant,
    cols,
    rows,
    ground,
    collision,
    floorColors,
    buildings,
    props,
    trees,
    compositions,
    connectors: [],
    spawn: chooseSpawn(buildings, collision, cols, rows),
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
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Roads are a COLOUR on the ground BLOCK, not a separate ROAD tile (Alexander #34/#48: "remove the tiles
      // from the roads, we can use color"). The base ground stays (a height-1 block) and is tinted asphalt, so a
      // road is FLUSH with the grass — no raised road-tile trench. Road IDENTITY lives in `layout.roads` (read by
      // placement + scatter), never re-derived from the ground kind.
      if (layout.roads[r][c]) ctx.floorColors[r][c] = groundTileColor('road', c, r)
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
  fillVillageNature(ctx, layout, NATURE_MULT[settlement])
  scatterGroundCover(ctx, 0.12, layout) // light flat ground tufts (clover/leaves); skips paved streets + colour roads
  scatterFlowers(ctx, 0.06, layout) // + a light scatter of STANDING blooms (single billboards, height 1) over open grass
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
    for (let c = c0; c < c0 + size; c++) if (inBounds(c, r, cols, rows)) ground[r][c] = 'path_stone'

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
  const floor = ZONE_PALETTES[zone].groundTypes[0] // zone floor: grass / snow / ash
  forEachCell(cols, rows, (col, row) => {
    ground[row][col] = floor
  })
  // The forest builds one of the MEADOW layouts (Alexander retired the old passages/open/lake
  // generators). An explicit meadow layout is honoured; a plain generate (no/legacy layout) RANDOMLY
  // picks one — seeded from ctx.rand, so it's reproducible per seed. Dispatch map (Open/Closed).
  const layout = ctx.layout && FOREST_LAYOUTS[ctx.layout] ? ctx.layout : pickMeadowLayout(ctx.rand, ctx.nature)
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
  const meadows: readonly ForestLayout[] = ['meadow', 'meadow_river', 'meadow_pass']
  return nature?.canopy === undefined ? meadows : ['woodland', ...meadows]
}

function pickMeadowLayout(rand: Rng, nature: NatureDensity | undefined): ForestLayout {
  const pool = forestLayoutCandidates(nature)
  return pool[randIntWith(rand, 0, pool.length - 1)]
}

/** Forest layout builders, keyed by the user-steered ForestLayout. Each runs on the already-floored ctx
 *  and is fully responsible for the floor gradient / trees / river / ornaments / repair.
 *  Open/Closed: register a layout here, no dispatcher edits. */
const FOREST_LAYOUTS: Readonly<Partial<Record<ForestLayout, (ctx: ArchetypeContext) => void>>> = {
  woodland: layoutWoodland,
  meadow: layoutMeadow,
  meadow_river: layoutMeadowRiver,
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
  pathWidth: 2,
} as const

/**
 * Build a woodland: dense canopy, carved clearings, connected paths.
 *
 * `ctx.nature?.canopy` is the density and it comes from the BACKEND. Absent → nothing is planted and a
 * warning says why, rather than this file inventing a number: a generator that states no canopy has not
 * been configured as a forest, and quietly picking 0.45 here is exactly the hardcoded-fallback the
 * compliance rule forbids.
 */
function layoutWoodland(ctx: ArchetypeContext): void {
  const { cols, rows, collision, ground, zone, trees } = ctx
  const canopy = ctx.nature?.canopy
  if (canopy === undefined) {
    console.warn('[generate] this generator serves no `nature.canopy`, so a woodland has no tree density to build from — nothing planted')
    return
  }

  const floor = ZONE_PALETTES[zone].groundTypes[0]
  forEachCell(cols, rows, (col, row) => { ground[row][col] = floor })

  // 1 · CLEARINGS first, as a mask, so the canopy pass can simply avoid them. Deciding the holes before
  //     the fill is cheaper and more controllable than planting everything and cutting back.
  const open = new Set<string>()
  // The corridor cells specifically. `open` also holds the clearings, and paving those would turn every
  // glade into a courtyard — a trail is the route BETWEEN them.
  const trailCells = new Set<string>()
  const clearings: Cell[] = []
  const wanted = Math.max(2, Math.round((cols * rows / 1000) * WOODLAND.clearingsPerThousand))
  for (let i = 0; i < wanted; i++) {
    const centre = {
      col: randIntWith(ctx.rand, 3, Math.max(3, cols - 4)),
      row: randIntWith(ctx.rand, 3, Math.max(3, rows - 4)),
    }
    const radius = randIntWith(ctx.rand, WOODLAND.clearingRadius[0], WOODLAND.clearingRadius[1])
    clearings.push(centre)
    // A ragged disc, not a circle: the radius wobbles per cell so the edge reads as natural.
    for (let r = centre.row - radius - 1; r <= centre.row + radius + 1; r++) {
      for (let c = centre.col - radius - 1; c <= centre.col + radius + 1; c++) {
        if (!inBounds(c, r, cols, rows)) continue
        const d = Math.hypot(c - centre.col, r - centre.row)
        if (d <= radius - 0.5 + ctx.rand()) open.add(`${c},${r}`)
      }
    }
  }

  // 2 · TRAILS joining the clearings in a chain, so every one is reachable from every other, plus a spur
  //     from the first and last clearing to the map EDGE — a forest you cannot enter or leave is a room.
  //
  //     Alexander, 2026-09-09: *"there's no way to navigate it."* The first version stopped here and only
  //     removed canopy, so a trail was an absence rather than a route: nothing marked it, nothing paved it,
  //     and with two clearings there was one of them. Now the corridors are PAVED (step 2b) and there are
  //     enough of them to form a network.
  for (let i = 1; i < clearings.length; i++) carveWoodlandPath(ctx, clearings[i - 1], clearings[i], open, trailCells)
  if (clearings.length > 0) {
    carveWoodlandPath(ctx, clearings[0], nearestEdgeCell(clearings[0], cols, rows), open, trailCells)
    const last = clearings[clearings.length - 1]
    carveWoodlandPath(ctx, last, nearestEdgeCell(last, cols, rows), open, trailCells)
  }

  // 2b · PAVE them. A trail has to be visible to be a trail — this is the half that was missing. The tile
  //      comes from the zone's palette, so a season can pave its trails differently without a branch here.
  const trail = ZONE_PALETTES[zone].trail
  for (const key of trailCells) {
    const [c, r] = key.split(',').map(Number)
    if (inBounds(c, r, cols, rows)) ground[r][c] = trail
  }

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
  const field = woodlandCanopyField(ctx, open, canopy)
  for (const { col, row } of field) {
    const kind: LivingTreeKind | 'tree_dead' = ctx.rand() < 0.06 ? 'tree_dead' : pickLivingTree(ctx.rand())
    trees.push({ col, row, kind, variant: massVariant(col, row) })
    collision[row][col] = true // the trunk blocks; the canopy is walkable overhead, as everywhere else
  }

  // 4 · The clearings get whatever ground cover and flowers the generator asked for. Absent → bare.
  dressWoodlandClearings(ctx, open)

  void collision
  void trees
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
const CANOPY_LATTICE = 4

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
function woodlandCanopyField(ctx: ArchetypeContext, open: Set<string>, canopy: number): Cell[] {
  const { cols, rows, collision } = ctx
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
      scored.push({ col, row, n: noiseAt(col, row) })
    }
  }
  const target = Math.round(scored.length * Math.max(0, Math.min(1, canopy)))
  scored.sort((a, b) => a.n - b.n)
  return scored.slice(0, target).map(({ col, row }) => ({ col, row }))
}

/**
 * Scatter the generator's ground cover and flowers across the CLEARINGS only.
 *
 * Both densities come from the backend and both go through the existing prop seams — `makeFlower` and
 * `makeGroundDecor` — so a woodland's dressing is the same data-driven, per-zone, baked-image path the
 * meadow and the town use. `makeGroundDecor` returns null when the loaded tileset carries no decor for
 * the zone; that cell is then simply bare, which is the correct answer to missing data.
 */
function dressWoodlandClearings(ctx: ArchetypeContext, open: Set<string>): void {
  const cover = ctx.nature?.groundCover
  const flowers = ctx.nature?.flowers
  if (cover === undefined && flowers === undefined) return
  for (const key of open) {
    const [c, r] = key.split(',').map(Number)
    if (!inBounds(c, r, ctx.cols, ctx.rows) || ctx.collision[r][c]) continue
    if (flowers !== undefined && ctx.rand() < flowers) {
      placeProp(ctx, makeFlower(ctx.rand, ctx.zone, c, r))
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

function layoutMeadow(ctx: ArchetypeContext): void { buildMeadow(ctx, { river: false, twoWays: false }) }
function layoutMeadowRiver(ctx: ArchetypeContext): void { buildMeadow(ctx, { river: true, twoWays: false }) }
/** `meadow_pass` (#26): the open meadow opened on TWO opposite edges (top + bottom) — a through-route you can
 *  enter one side and exit the other, distinct from the single-entrance `meadow`. No river. */
function layoutMeadowPass(ctx: ArchetypeContext): void { buildMeadow(ctx, { river: false, twoWays: true }) }

interface MeadowBuild {
  /** Carve the perimeter WINDING river + a crossing bridge (the `meadow_river` variation). */
  river: boolean
  /** Open TWO opposite cobble ways (top + bottom) for a through-route (`meadow_pass`) instead of one bottom way. */
  twoWays: boolean
}

/** THE meadow builder — `meadow` (one bottom way, no river), `meadow_river` (one way + perimeter river) and
 *  `meadow_pass` (two opposite ways, no river). LAYOUT-FIRST: flat floor + season gradient → (river) carve the
 *  perimeter water → sparse framing trees → pave the cobble way(s) → populate the open centre with ornament
 *  zones → keep the floor one region → (river) drop the stone bridge last so the repair can't fill it. */
function buildMeadow(ctx: ArchetypeContext, opts: MeadowBuild): void {
  floodMeadowFloor(ctx)                          // flat 'meadow' tile everywhere (a raised, tintable block)
  paintMeadowGradient(ctx)                        // season olive greens→yellows as per-cell floor STATE
  const water = opts.river ? paintMeadowRiver(ctx) : new Set<string>() // a WINDING river hugging 3 sides (top/left/right), open near edge
  paintMeadowPlots(ctx, water)                    // faint tended-field patchwork (a subtle colour)
  scatterMeadowOrnaments(ctx, water)              // subtle dirt/earth patches, a few field stones, tiny flowers — mostly open
  scatterFramingTrees(ctx, water)                 // SPARSE tree clumps BEYOND the river (top/left/right) + a few near the bottom corners
  if (opts.twoWays) {
    paintMeadowEntrance(ctx, water, false, 0.5)   // near (bottom) cobble way in
    paintMeadowEntrance(ctx, water, true, 0.5)    // far (top) cobble way out — opposite edge, aligned → a through-route (#26)
  } else {
    paintMeadowEntrance(ctx, water)               // ONE bottom-left cobble entrance, lamp posts + flower beds
  }
  repairFloorConnectivity(ctx, MEADOW_MAX_POCKET) // fill only TINY stranded pockets; the land strip beyond the river stays (decor)
  if (opts.river) placeMeadowBridge(ctx, water)   // a stone bridge crossing the river at the top-right (drawn after repair)
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
  const centreInset = (along: number): number =>
    MEADOW_RIVER_INSET + 2.4 * Math.sin(along * 0.23 + phase) + 1.2 * Math.sin(along * 0.11 + phase2)
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
    // Ripple tone quantised over coarse ~3×3 PATCHES (not per-cell noise) so neighbouring water shares a colour
    // and compressGround merges the river into runs too — same FPS reasoning as the land gradient.
    const ripple = Math.round(shadeNoise(Math.floor(col / 3) * 1.3 + Math.floor(row / 3) * 2.1) * 2) / 2
    floorColors[row][col] = varyIntensity(pal.river, 0.44 + ripple * 0.12) // subtle ripple tone (centred, never crushed)
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
  const kind: LivingTreeKind | 'tree_dead' = dead ? 'tree_dead' : tall ? 'tree_tall' : pickLivingTree(ctx.rand())
  trees.push({ col, row, kind, variant })
  collision[row][col] = true
}

/** Pave the ONE bottom-left entrance LANE with cobblestone (the flat 'meadow' floor tinted the cobble tone —
 *  a colour, not a tile) from the near edge inward, lined with colourful flower beds + lamp posts (the lit
 *  cobble way in #24). Clears any framing tree/prop off the lane first, so the way in is always a clean
 *  opening. */
function paintMeadowEntrance(ctx: ArchetypeContext, water: Set<string>, fromTop = false, frac = MEADOW_ENTRANCE_FRAC): void {
  const { cols, rows, ground, collision, floorColors, zone } = ctx
  const pal = MEADOW_PALETTES[zone] ?? MEADOW_PALETTES.summer
  const g = clamp(Math.floor(cols * frac), MEADOW_ENTRANCE_HALF + 1, cols - MEADOW_ENTRANCE_HALF - 2)
  // The lane runs IN from the chosen edge — depth d = 0 at the edge (top row 0, or the bottom row) growing inward.
  const rowAt = (d: number): number => (fromTop ? d : rows - 1 - d)
  // Clear the lane (trees/props the framing pass may have dropped) so the cobble way is a real opening.
  const lane = new Set<string>()
  for (let d = 0; d < MEADOW_ENTRANCE_RUN; d++)
    for (let w = -MEADOW_ENTRANCE_HALF; w <= MEADOW_ENTRANCE_HALF; w++) lane.add(`${g + w},${rowAt(d)}`)
  clearMeadowCells(ctx, lane)
  for (let d = 0; d < MEADOW_ENTRANCE_RUN; d++) {
    const row = rowAt(d)
    for (let w = -MEADOW_ENTRANCE_HALF; w <= MEADOW_ENTRANCE_HALF; w++) {
      const c = g + w
      if (!inBounds(c, row, cols, rows) || water.has(`${c},${row}`) || collision[row][c]) continue
      ground[row][c] = 'meadow'
      floorColors[row][c] = pal.cobble
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
  const { cols, rows, ground, collision, floorColors } = ctx
  const pal = MEADOW_PALETTES[ctx.zone] ?? MEADOW_PALETTES.summer
  const bridgeCol = Math.floor(cols * 0.72) // top-right, over the top-edge river arm (#24)
  const span: number[] = []
  for (let row = 0; row < rows; row++) if (water.has(`${bridgeCol},${row}`)) span.push(row)
  if (span.length === 0) return
  const rowsToDeck = [Math.min(...span) - 1, ...span, Math.max(...span) + 1]
  const deck = new Set<string>()
  for (const row of rowsToDeck) for (let w = -1; w <= 1; w++) deck.add(`${bridgeCol + w},${row}`)
  clearMeadowCells(ctx, deck) // drop any tree/prop the border/repair left on the deck
  for (const key of deck) {
    const { col, row } = toCell(key)
    if (!inBounds(col, row, cols, rows)) continue
    ground[row][col] = 'bridge'
    collision[row][col] = false // the deck is WALKABLE — you cross the river on it
    floorColors[row][col] = pal.cobble
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
    region.forEach(key => {
      const { col, row } = toCell(key)
      collision[row][col] = true
      anchors.push({ col, row, kind: pickLivingTree(shadeNoise(col * 17 + row * 43)), variant: massVariant(col, row) % canopyCount(styleCatalog('ascii'), zone) }) // tiny dead pocket → forest fills it
    })
  }
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
  const kind = dead ? 'tree_dead' : pickLivingTree(ctx.rand()) // random shape variant (standard/tall/small/round/bush)
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
  const pal = TEMPLE_PALETTES[zone] ?? TEMPLE_PALETTES.summer

  // 1. Repaint the whole ground to the seasonal temple floor; start fully walled (solid stone).
  forEachCell(cols, rows, (col, row) => {
    ctx.ground[row][col] = pal.floor
  })
  const wall = makeGrid(cols, rows, () => true)

  // 2. Carve the ROOMS (south entrance, north boss chamber, pillared side halls).
  const rooms = templeRooms(cols, rows)
  rooms.forEach(room => carveTempleRoom(wall, room, cols, rows))

  // 3. Wire the rooms into a connected NETWORK with narrow corridors (+ a couple of loops).
  connectTempleRooms(wall, rooms, cols, rows)

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
  placeTempleHazards(ctx, rooms, pal)

  // 11. Guarantee ONE connected floor — fill any pocket a blocking pool stranded with wall.
  repairTempleFloor(ctx, pal)

  // 12. The narratively-locked boss GATEWAY (walkable threshold) + its KEY in a side hall.
  placeLockedDoorAndKey(ctx, boss, entrance, rooms, pal)
}

/** Lay out the dungeon rooms: a south ENTRANCE hall (spawn), a grand north BOSS chamber, and a
 *  row of pillared side HALLS across the middle band. Deterministic sizes, jittered positions. */
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
function placeTempleHazards(ctx: ArchetypeContext, rooms: TempleRoom[], pal: TemplePalette): void {
  const { collision, props, cols, rows } = ctx
  const occupied = new Set(props.map(p => `${p.col},${p.row}`))
  rooms.forEach(room => {
    if (room.role !== 'hall') return
    // a hazard pool near the room centre (radius 1–2), confined to the room interior.
    stampTemplePool(ctx, room, pal)
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
function stampTemplePool(ctx: ArchetypeContext, room: TempleRoom, pal: TemplePalette): void {
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

function placeCave(ctx: ArchetypeContext): void {
  const { cols, rows, zone } = ctx
  const pal = CAVE_PALETTES[zone] ?? CAVE_PALETTES.summer

  // 1. Repaint the whole ground to the seasonal cave floor (walls cover their cells).
  forEachCell(cols, rows, (col, row) => {
    ctx.ground[row][col] = pal.floor
  })

  // 2. CA cavern skeleton → keep ONE connected cavern (stray pockets fill back to rock).
  let rock = makeGrid(cols, rows, () => Math.random() < CAVE_FILL)
  for (let i = 0; i < CAVE_ITERATIONS; i++) rock = smoothCave(rock, cols, rows)
  const cavern = keepLargestClearing(rock, cols, rows) // true = rock

  // 3. Carve the south entrance chamber and join it to the cavern with a wide corridor.
  const entrance = carveEntranceChamber(rock, cols, rows)
  joinEntranceToCavern(rock, entrance, cavern, cols, rows)

  // 4. Seal the map border so the cavern is fully ENCLOSED (the CA can leave stray
  //    open border cells; force them rock — the interior floor is repaired below).
  forEachCell(cols, rows, (col, row) => {
    if (isEdge(col, row, cols, rows)) rock[row][col] = true
  })

  // 5. Commit the seasonal rock walls (blocking) over the negative space.
  commitCaveWalls(ctx, rock, pal)

  // 6. Seasonal water / ice / lava pools in the cavern (kept north of the entrance).
  carveCavePools(ctx, pal, entrance)

  // 7. Guarantee ONE connected floor — fill any pocket a pool stranded with rock.
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
function carveCavePools(ctx: ArchetypeContext, pal: CavePalette, entrance: Rect): void {
  const { collision, cols, rows } = ctx
  const count = 1 + Math.floor(Math.random() * 3)
  const maxRow = Math.max(4, entrance.row - 2) // keep pools clear of the entrance chamber
  for (let i = 0; i < count; i++) {
    let seed: Cell | null = null
    for (let tries = 0; tries < 40 && !seed; tries++) {
      const col = randInt(3, cols - 4)
      const row = randInt(3, maxRow)
      if (!collision[row][col]) seed = { col, row }
    }
    if (seed) stampPool(ctx, pal, seed.col, seed.row)
  }
}

/** One organic pool disc (a wobbling radius so it reads natural, not a clean circle),
 *  painted only over existing floor cells. */
function stampPool(ctx: ArchetypeContext, pal: CavePalette, cc: number, cr: number): void {
  const { ground, collision, cols, rows } = ctx
  const radius = 2 + Math.floor(Math.random() * 2) // 2–3
  const phase = Math.random() * Math.PI * 2
  for (let dr = -radius - 1; dr <= radius + 1; dr++) {
    for (let dc = -radius - 1; dc <= radius + 1; dc++) {
      const col = cc + dc
      const row = cr + dr
      if (!inBounds(col, row, cols, rows) || isEdge(col, row, cols, rows)) continue
      if (collision[row][col]) continue // pool sits on floor, never punches through a wall
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

/** Paint patchy seasonal accent ground (moss / fallen leaves / dune) over the floor. */
function paintFloorAccents(ctx: ArchetypeContext, pal: CavePalette): void {
  const { ground, collision, cols, rows } = ctx
  forEachCell(cols, rows, (col, row) => {
    if (isEdge(col, row, cols, rows)) return
    if (collision[row][col]) return // floor only
    if (ground[row][col] !== pal.floor) return // don't repaint pools
    if (Math.random() < pal.accentChance) ground[row][col] = pal.accent
  })
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
      if (inBounds(c, r, cols, rows) && !collision[r][c]) ground[r][c] = 'ancient_stone'
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
  ground: { col: number; row: number; type: string }[]
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
  for (const door of b.doorCells) ground.push({ col: door.col + dc, row: door.row + dr, type: 'path_stone' })
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
  const heightData = stage.collision.map(r => r.map(() => 0))
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
  for (const c of stage.compositions) assetsData.push(...anchorAssets(stage, c.kind, c.col, c.row, c.variant ?? 0, 0))

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
