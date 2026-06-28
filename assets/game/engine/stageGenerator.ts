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
import { composeBuilding, ComposedBuilding, BuildingType } from './buildingComposer'
import { planVillage, type VillageLayout, type Settlement, type Plot, type Facing } from './villageLayout'
import { ZONE_PALETTES, ZoneId } from './zones'
import { autotileLabel, isWalkable, TREE_MASS_FAMILY, type CellLabel } from './cellLabels'
import { cellTile, TREE_CANOPY_SHADES, groundDecor } from './cellTileset'
import { varyIntensity } from './colors'
import type { Connector } from '@/lib/api'

export type VariantId = 'village' | 'town' | 'city' | 'forest' | 'cave' | 'temple' | 'boss-stage'

/** General forest LAYOUT the user steers; the generator randomizes the rest.
 *  'passages' = the default multi-passage forest (today's behavior). */
export type ForestLayout = 'passages' | 'open' | 'lake'

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
  /** The planner's road-derived facing — the iso render orients the billboard by this. */
  facing: Facing
  doorCells: { col: number; row: number }[]
  facade: ComposedBuilding
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
}

type Cell = { col: number; row: number }
type Plant = (col: number, row: number) => void

// ── small pure helpers ──────────────────────────────────────────────
const randInt = (min: number, max: number): number => min + Math.floor(Math.random() * (max - min + 1))
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))
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

// A labeled cell's appearance (glyph + zone-tint) comes from the tileset; its
// collision comes from the label. The tileset is the single authority for how a
// (zone, label) pair looks — see cellTileset.ts. Trees and buildings differ only
// by their StageProp `type` (used by the editor/renderer for grouping).
const makeLabeledCell = (
  zone: ZoneId,
  col: number,
  row: number,
  label: CellLabel,
  type: 'tree' | 'building',
  variant = 0,
): StageProp => {
  const tile = cellTile(zone, label, variant)
  return { col, row, type, char: tile.char, blocking: !isWalkable(label), color: tile.color, label }
}

// A deterministic [0,1) value from a seed — drives leaf/flower intensity variety WITHOUT
// consuming the layout RNG, so generation stays reproducible. Coherent per seed.
const shadeNoise = (seed: number): number => {
  const h = Math.abs(Math.sin(seed * 12.9898) * 43758.5453)
  return h - Math.floor(h)
}

// Tree parts that keep their bark/dead tone — only the CANOPY gets leaf-tone variety.
const TRUNK_LABELS = new Set<string>(['tree_stem', 'tree_stem_bottom', 'tree_snag'])

/** One labeled tree cell — label drives glyph + collision; `variant` picks the canopy
 *  tonal shade. Canopy leaves additionally get a per-TREE (per-column) intensity shift so a
 *  forest reads in many tones of one base color; seeding by `col` keeps every cell of a
 *  vertical glade tree one tone (so some trees read darker, some lighter — never noisy). */
// Glade-tree column cells STACKED above the trunk base (crown / leaves / upper trunk): a
// shadow under these would float at canopy height, so they cast none. EVERY other tree cell
// — autotiled mass/thicket cells (each renders its own grounded tree), the trunk base, a
// snag — sits on its own ground and casts a shadow, so no tree floats even when stacked.
const NO_SHADOW_LABELS = new Set<string>(['tree_crown', 'tree_leaf', 'tree_leaf_top', 'tree_stem'])

const makeTreeCell = (zone: ZoneId, col: number, row: number, label: CellLabel, variant = 0): StageProp => {
  const cell = makeLabeledCell(zone, col, row, label, 'tree', variant)
  const baseShadow = !NO_SHADOW_LABELS.has(label) || undefined
  if (TRUNK_LABELS.has(label)) return { ...cell, baseShadow }
  // Per-tree (per-column) leaf-tone shift only — NO opacity (translucent trees let entities
  // show through + blur the scene); the canopy reads in many tones of one solid color.
  return { ...cell, color: varyIntensity(cell.color, shadeNoise(col + 0.5)), baseShadow }
}

/** One labeled building cell — mirrors makeTreeCell; the LABEL drives walkability. */
// ── per-type building colors — a distinct ROOF per type so a town reads at a glance, with
//    dark doors + glassy windows so those ornaments stand out. cellTile's zone tint stays on
//    the glyph; the COLOR comes from here.
interface BuildingPalette { roof: string; wall: string; door: string; window: string }
const HOUSE_ROOFS = ['#a83a2e', '#8a5a36', '#717680'] // red / brown / gray — houses vary
const BUILDING_PALETTES: Readonly<Record<BuildingType, BuildingPalette>> = {
  house: { roof: '#a83a2e', wall: '#d8c49a', door: '#241810', window: '#8fc4e6' },
  'big-house': { roof: '#5a6e8c', wall: '#cfc6b4', door: '#1e2630', window: '#a8d4ee' }, // squarer "building", cool roof
  store: { roof: '#2f6fb8', wall: '#e2dcc8', door: '#26414f', window: '#a8dcf2' }, // blue roof
  hospital: { roof: '#3fa86a', wall: '#f0f0ea', door: '#2a3a2a', window: '#cfeede' }, // green roof, white walls
  cathedral: { roof: '#7a5aa0', wall: '#d8d0c0', door: '#241828', window: '#c4a8ea' },
  temple: { roof: '#b08a3a', wall: '#d8cca0', door: '#33240f', window: '#ecc868' },
  castle: { roof: '#5f6068', wall: '#b6b2aa', door: '#15151a', window: '#9fb2cc' },
}

/** Color for one facade cell by the building's TYPE + the cell's label. Houses vary their
 *  roof tone (red / brown / gray) by their anchor so a street isn't monotone. Pure. */
export function buildingCellColor(type: BuildingType, label: CellLabel, anchorSeed: number): string {
  const pal = BUILDING_PALETTES[type] ?? BUILDING_PALETTES.house
  if (label === 'roof' || label === 'roof_top') {
    if (type !== 'house') return pal.roof
    return HOUSE_ROOFS[Math.floor(shadeNoise(anchorSeed + 0.3) * HOUSE_ROOFS.length) % HOUSE_ROOFS.length]
  }
  if (label === 'door') return pal.door
  if (label === 'window') return pal.window
  return pal.wall
}

const makeBuildingCell = (zone: ZoneId, col: number, row: number, label: CellLabel, color?: string): StageProp => {
  const cell = makeLabeledCell(zone, col, row, label, 'building')
  return color ? { ...cell, color } : cell
}

// A canopy tonal variant for a tree-MASS cell, derived from its position so the
// canopy varies in coherent ~2×2 patches (contrast without per-cell noise).
const massVariant = (col: number, row: number): number =>
  Math.floor(col / 2) * 7 + Math.floor(row / 2) * 13

/** One blocking biome-feature cell (mountain / peak / spill) — appearance from
 *  the tileset's per-zone feature palette (ember crater in lava, snowcap + blue
 *  waterfall otherwise). Always blocks (it's terrain). */
const makeFeatureCell = (zone: ZoneId, col: number, row: number, label: CellLabel): StageProp => {
  const tile = cellTile(zone, label)
  return { col, row, type: 'feature', char: tile.char, blocking: true, color: tile.color, label }
}

// Walkable flower variants. SPRING bursts into many shapes + colors (a meadow in
// bloom); SUMMER keeps a smaller, deeper-toned set. Zones absent here don't flower.
type FlowerKind = { char: string; color: string }
const SPRING_FLOWERS: ReadonlyArray<FlowerKind> = [
  { char: '✿', color: '#ff8fc8' }, // pink bloom
  { char: '❀', color: '#ffd24a' }, // buttercup
  { char: '✾', color: '#c89bff' }, // lilac
  { char: '❁', color: '#ff7a7a' }, // poppy
  { char: '✽', color: '#ffffff' }, // daisy
  { char: '❋', color: '#7ad0ff' }, // bluebell
]
const SUMMER_FLOWERS: ReadonlyArray<FlowerKind> = [
  { char: '*', color: '#ff88cc' },
  { char: '✿', color: '#ffd24a' },
]
const FLOWERS_BY_ZONE: Partial<Record<ZoneId, ReadonlyArray<FlowerKind>>> = {
  spring: SPRING_FLOWERS,
  summer: SUMMER_FLOWERS,
}

const makeFlower = (zone: ZoneId, col: number, row: number): StageProp => {
  const set = FLOWERS_BY_ZONE[zone] ?? SUMMER_FLOWERS
  const pick = set[randInt(0, set.length - 1)]
  // Each flower gets its own intensity tone (per-cell) for a naturally varied meadow — tone only, no opacity.
  return { col, row, type: 'flower', char: pick.char, blocking: false, color: varyIntensity(pick.color, shadeNoise(col * 2.7 + row * 3.1)) }
}

// Tonal rock shades (+ a little char texture) so cave/arena walls aren't one flat
// grey — the same idea as TREE_CANOPY_SHADES for the forest.
const ROCK_SHADES = ['#3a3340', '#332e3a', '#443b50', '#2c2832', '#3d3543'] as const
const rockShade = (col: number, row: number): string => ROCK_SHADES[Math.abs(col * 7 + row * 13) % ROCK_SHADES.length]

const makeRock = (col: number, row: number): StageProp => ({
  col,
  row,
  type: 'rock',
  char: Math.abs(col * 5 + row * 3) % 7 === 0 ? '▒' : '▓',
  blocking: true,
  color: rockShade(col, row),
})

// Non-blocking cave-floor decor: stalagmites, crystals, rubble — scattered so a
// cavern reads as a living cave, not flat grey walls + empty floor.
const CAVE_DECOR: ReadonlyArray<{ char: string; color: string }> = [
  { char: 'ʌ', color: '#5a5266' }, // stalagmite
  { char: '♦', color: '#7ad0ff' }, // crystal (cyan)
  { char: '◊', color: '#b48cff' }, // crystal (violet)
  { char: '∴', color: '#4a4450' }, // rubble
  { char: '·', color: '#6a6276' }, // pebbles
]
const makeCaveDecor = (col: number, row: number): StageProp => {
  const d = CAVE_DECOR[randInt(0, CAVE_DECOR.length - 1)]
  return { col, row, type: 'cave_decor', char: d.char, blocking: false, color: d.color }
}

// Non-blocking zone GROUND DECOR (grass/litter/pebbles/embers) — the density layer.
const makeGroundDecor = (zone: ZoneId, col: number, row: number): StageProp => {
  const d = groundDecor(zone, Math.abs(col * 7 + row * 13))
  return { col, row, type: 'ground_decor', char: d.char, blocking: false, color: d.color }
}

/** Fill most empty, walkable, non-edge cells with non-blocking zone ground decor so a
 *  stage reads DENSE instead of blank. Skips cells that already hold a prop, and leaves
 *  ~(1-density) of cells clear so the floor still reads as navigable. Decor never blocks,
 *  so walkable connectivity is unchanged. */
// Built/paved floors should NOT get nature decor (no grass on marble) — they're
// already detailed by their tile pattern.
const BUILT_FLOOR: ReadonlySet<string> = new Set(['marble', 'gold_tile', 'ancient_stone', 'plaza', 'path_stone', 'rune_floor'])

function scatterGroundCover(ctx: ArchetypeContext, density = 0.18): void {
  const { props, collision, ground, cols, rows, zone } = ctx
  const occupied = new Set(props.map(p => `${p.col},${p.row}`))
  const fill: StageProp[] = []
  forEachCell(cols, rows, (col, row) => {
    if (isEdge(col, row, cols, rows)) return
    if (collision[row][col]) return // walkable floor only
    if (BUILT_FLOOR.has(ground[row][col])) return // keep paved/tiled floors clean
    if (occupied.has(`${col},${row}`)) return // don't cover trees / buildings / decor
    if (Math.random() > density) return // breathing room
    fill.push(makeGroundDecor(zone, col, row))
  })
  props.push(...fill)
}

// Structural decor for temple / boss arena / village (readable single-glyph props).
const makePillar = (col: number, row: number): StageProp => ({ col, row, type: 'pillar', char: '║', blocking: true, color: '#cbb68c' })
const makeBrazier = (col: number, row: number): StageProp => ({ col, row, type: 'brazier', char: 'Φ', blocking: true, color: '#ff8a3a' })
const makeAltar = (col: number, row: number): StageProp => ({ col, row, type: 'altar', char: '‡', blocking: true, color: '#ffe7a8' })
const makeWell = (col: number, row: number): StageProp => ({ col, row, type: 'well', char: '◉', blocking: true, color: '#5b8bbf' })
const makeFountain = (col: number, row: number): StageProp => ({ col, row, type: 'fountain', char: '⊙', blocking: true, color: '#5fbce0' })
const makeLamp = (col: number, row: number): StageProp => ({ col, row, type: 'lamp', char: '†', blocking: true, color: '#ffd27a' })

/** Place a prop iff the cell is in-bounds + not already blocked; set collision when blocking. */
function placeProp(ctx: ArchetypeContext, prop: StageProp): void {
  const { props, collision, cols, rows } = ctx
  if (!inBounds(prop.col, prop.row, cols, rows)) return
  if (collision[prop.row][prop.col]) return
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
  cols: number
  rows: number
  /** The user-steered forest layout; only placeForest reads it. */
  layout: ForestLayout
}

const ARCHETYPES: Partial<Record<VariantId, (ctx: ArchetypeContext) => void>> = {
  village: placeVillage,
  town: placeTown,
  city: placeCity,
  forest: placeForest,
  temple: placeTemple,
  cave: placeCave,
  'boss-stage': placeBossStage,
}

export function generateStage(opts: GenerateOptions): StageData {
  const { zone, variant } = opts
  const cols = opts.cols ?? 40
  const rows = opts.rows ?? 40
  const layout = opts.layout ?? 'passages'
  const palette = ZONE_PALETTES[zone]

  const ground = makeGrid(cols, rows, () => palette.groundTypes[0])
  const collision = makeGrid(cols, rows, () => false)
  const buildings: PlacedBuilding[] = []
  const props: StageProp[] = []

  const ctx: ArchetypeContext = { zone, ground, collision, buildings, props, cols, rows, layout }
  ARCHETYPES[variant]?.(ctx)
  addTerrainTransitions(ctx) // blended shorelines / lava banks over the painted ground

  return {
    zone,
    variant,
    cols,
    rows,
    ground,
    collision,
    buildings,
    props,
    connectors: [],
    spawn: chooseSpawn(buildings, collision, cols, rows),
  }
}

// ── village archetype ───────────────────────────────────────────────
// Nature density by settlement — villages are leafy, cities mostly paved (town in between).
const NATURE_MULT: Record<Settlement, number> = { village: 1, town: 0.55, city: 0.28 }

// Hoisted function decls (not const arrows) so ARCHETYPES above can reference them.
function placeVillage(ctx: ArchetypeContext): void {
  placeSettlement(ctx, 'village')
}
function placeTown(ctx: ArchetypeContext): void {
  placeSettlement(ctx, 'town')
}
function placeCity(ctx: ArchetypeContext): void {
  placeSettlement(ctx, 'city')
}

/**
 * Stamp a settlement from its planned layout: carve the streets, place the typed buildings,
 * add the plaza + lamps, fill nature around. The SAME logic for village/town/city — only the
 * layout scale (roads/buildings) + the nature density differ, both driven by `settlement`.
 */
function placeSettlement(ctx: ArchetypeContext, settlement: Settlement): void {
  const { buildings, ground, cols, rows } = ctx
  // 1. PLAN a logical layout (roads + typed plots), then STAMP it (villageLayout.planVillage).
  const layout = planVillage(cols, rows, Math.random, settlement)
  // Carve the streets into the ground as walkable path_stone.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (layout.roads[r][c]) ground[r][c] = 'path_stone'
    }
  }
  // 2. Stamp a building at each plot — each carries its TYPE + FACING. plot.row/plot.col are the
  //    MIN-ROW/MIN-COL (top-left) of the small `length × depth` footprint rect; placeBuilding blocks
  //    every footprint cell (a roof from above) EXCEPT the road-facing door cell (walkable).
  for (const plot of layout.plots) {
    const facade = composeBuilding({ type: plot.type, length: plot.length })
    const rect = footprintRect(plot)
    if (!rectInBounds(rect, cols, rows)) continue // planner's rectClear guarantees this; stay safe
    buildings.push(placeBuilding(ctx, facade, plot, rect))
  }
  // 3. Plaza (well/fountain) + lamps; trees fill the rest, scaled by settlement (cities sparser).
  villageDecor(ctx, layout)
  fillVillageNature(ctx, layout, NATURE_MULT[settlement])
  scatterGroundCover(ctx, 0.12) // light grass/flowers; skips paved streets
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
    const col = randInt(2, cols - 3)
    const row = randInt(TREE_HEIGHT, rows - 3)
    if (BUILT_FLOOR.has(ground[row][col])) continue
    // the tree's WHOLE column must avoid streets + buildings — a door is walkable, so a trunk
    // could otherwise rise into it from BELOW and block it.
    let clearColumn = true
    for (let h = 0; h < TREE_HEIGHT; h++) {
      const rr = row - h
      if (layout.roads[rr]?.[col] || nearBuilding.has(`${col},${rr}`)) {
        clearColumn = false
        break
      }
    }
    if (!clearColumn) continue
    if (!treeFits(collision, col, row, cols, rows)) continue
    const sideDist = Math.min(col, cols - 1 - col) // distance from the LEFT/RIGHT edge
    const edgeDist = Math.min(sideDist, row, rows - 1 - row)
    // Denser toward the SIDES — the village sits in a clearing framed by forest left & right — but
    // the INTERIOR stays leafy too (a Pokémon-style town nestled in trees, not bare lots).
    const p = (sideDist < 5 ? 0.78 : edgeDist < 4 ? 0.6 : edgeDist < 9 ? 0.4 : 0.26) * natureMult
    if (Math.random() > p) continue
    if (placed.some(t => Math.abs(t.col - col) < minDist && Math.abs(t.row - row) < minDist)) continue
    stampTree(ctx, col, row, Math.random() < DEAD_TREE_CHANCE[ctx.zone], Math.random() < 0.45)
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
  for (const b of ctx.buildings) {
    const top = b.row - (b.height - 1)
    for (let r = top; r <= b.row; r++) for (let c = b.col; c < b.col + b.length; c++) buildingCells.add(`${c},${r}`)
  }
  const decorFree = (c: number, r: number): boolean =>
    !collision[r]?.[c] && !layout.roads[r]?.[c] && !buildingCells.has(`${c},${r}`)
  // Plaza centrepiece — a well or a fountain — just below the first street, if the cell is clear.
  const cx = clamp(Math.floor(cols / 2), 2, cols - 3)
  const cy = clamp(streetRows[0] + 3, 0, rows - 2)
  if (decorFree(cx, cy)) {
    placeProp(ctx, Math.random() < 0.5 ? makeFountain(cx, cy) : makeWell(cx, cy))
  }
  // Lamp posts every ~6 cells along each street's frontage gaps (never on a road or building).
  for (const sr of streetRows) {
    const frontage = sr - 1
    for (let c = 5; c < cols - 4; c += 6) {
      if (decorFree(c, frontage)) placeProp(ctx, makeLamp(c, frontage))
    }
  }
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

/** The single DOOR cell — the centre of the footprint's ROAD-FACING edge (walkable; the building's
 *  one way in). Every other footprint cell blocks. Mirrors villageLayout's door geometry. */
function doorCell(facing: Facing, rect: FootRect): Cell {
  const midCol = rect.col + Math.floor(rect.w / 2)
  const midRow = rect.row + Math.floor(rect.h / 2)
  if (facing === 'south') return { col: midCol, row: rect.row + rect.h - 1 } // road below → bottom edge
  if (facing === 'north') return { col: midCol, row: rect.row } // road above → top edge
  if (facing === 'east') return { col: rect.col + rect.w - 1, row: midRow } // road right → right edge
  return { col: rect.col, row: midRow } // west: road left → left edge
}

/**
 * Stamp a building's small GROUND FOOTPRINT (`rect`, width × depth): every cell BLOCKS (collision
 * true) and emits a building prop — a roof from above — EXCEPT the single road-facing DOOR cell,
 * which stays WALKABLE (collision false). This is the shared collision blueprint all three views
 * read: walls/roof block, the door is the way in. The facade's vertical elevation is NOT stamped on
 * the ground anymore — the iso/2D renders raise it from `facade` over this footprint.
 */
function placeBuilding(
  ctx: ArchetypeContext,
  facade: ComposedBuilding,
  plot: Plot,
  rect: FootRect,
): PlacedBuilding {
  const door = doorCell(plot.facing, rect)
  for (let row = rect.row; row < rect.row + rect.h; row++) {
    for (let col = rect.col; col < rect.col + rect.w; col++) {
      stampFootprintCell(ctx, plot.type, col, row, col === door.col && row === door.row, rect.col)
    }
  }
  // `row` = the rect's BOTTOM row; `length`/`height` = the rect's grid span (cols×rows), so the
  // nature math + the iso/2D per-cell skip read the real small footprint regardless of facing.
  return { type: plot.type, col: rect.col, row: rect.row + rect.h - 1, length: rect.w, height: rect.h, depth: plot.depth, facing: plot.facing, doorCells: [door], facade }
}

/** Emit one footprint building cell at (col,row) and set its collision: the door is walkable, every
 *  other cell blocks (a roof from above). The label drives the top-view glyph; collision is set
 *  explicitly here (the door is a deliberate walkable exception, unlike isWalkable's defaults). */
function stampFootprintCell(
  ctx: ArchetypeContext,
  type: BuildingType,
  col: number,
  row: number,
  isDoor: boolean,
  anchorCol: number,
): void {
  const { props, collision, zone, cols, rows } = ctx
  if (!inBounds(col, row, cols, rows)) return
  const label: CellLabel = isDoor ? 'door' : 'roof'
  const color = buildingCellColor(type, label, anchorCol)
  const cell = makeBuildingCell(zone, col, row, label, color)
  props.push({ ...cell, blocking: !isDoor, buildingType: type })
  collision[row][col] = !isDoor
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
  // The user steers the GENERAL layout; the chosen builder randomizes the rest.
  // Dispatch map (Open/Closed) — add a layout = add a row, no if/else chain.
  FOREST_LAYOUTS[ctx.layout](ctx)
}

/** Forest layout builders, keyed by the user-steered ForestLayout. Each one runs
 *  on the already-floored ctx and is fully responsible for trees/lake/repair.
 *  Open/Closed: register a layout here, no dispatcher edits. */
const FOREST_LAYOUTS: Readonly<Record<ForestLayout, (ctx: ArchetypeContext) => void>> = {
  passages: layoutPassages,
  open: layoutOpenGlade,
  lake: layoutLake,
}

/** The default multi-passage forest: distributed clearing rooms wired into a
 *  connected corridor network, tree masses filling the negative space, glades
 *  and cover scattered in. Unchanged from the original placeForest body. */
function layoutPassages(ctx: ArchetypeContext): void {
  const { cols, rows } = ctx

  // LAYOUT FIRST: divide the map into distributed sections, wire them into a
  // connected network, link it to the edges — THEN populate with elements.
  const trees = makeGrid(cols, rows, () => true) // start fully forested
  const rooms = layoutForestRooms(cols, rows)
  rooms.forEach(room => carveRoom(trees, room, cols, rows))
  connectRooms(trees, rooms)
  const clearing = keepLargestClearing(trees, cols, rows)
  carveGates(trees, clearing, cols, rows) // south entrance + north exit
  // Erode the canopy to a navigable density. Zone-scaled: a solid-passages forest
  // was ~45% trees; this drops it ~25% (and makes spring airier than summer).
  thinForestForZone(trees, cols, rows, ctx.zone, 4)

  commitTrees(ctx, trees) // tree masses fill the negative space
  markGrassZones(ctx, rooms) // some sections become tall-grass
  scatterGladeTrees(ctx) // a few trees dotting the clearings
  scatterClearingCover(ctx) // flowers + stray mid-grass
  repairFloorConnectivity(ctx) // glade trunks can pinch off a pocket → keep one floor
}

// ── 'open' layout: a big open glade, easy to traverse — far fewer trees than
//    'passages'. The whole interior is clear floor; only a sparse ring of tree
//    clumps hugs the edges, so the middle stays a wide-open clearing. ──────────
const OPEN_EDGE_BAND = 3 // how deep from the border tree clumps may sit
const OPEN_CLUMP_CHANCE = 0.12 // per eligible edge cell → sparse clumps, a clearly open glade

/** Sparse tree clumps around the edges over a wide-open middle. Trees start in a
 *  thin border band only, the largest clearing is kept, then the same glade pass
 *  dots a few standalone trees in. Many fewer trees than the passages layout. */
function layoutOpenGlade(ctx: ArchetypeContext): void {
  const { cols, rows } = ctx
  const trees = makeGrid(cols, rows, () => false) // start fully OPEN (the glade)
  seedEdgeClumps(trees, cols, rows)
  const clearing = keepLargestClearing(trees, cols, rows)
  carveGates(trees, clearing, cols, rows) // keep south/north edges reachable

  commitTrees(ctx, trees) // the sparse edge clumps
  scatterGladeTrees(ctx, 0.45) // a FEW standalone trees — the glade stays clearly open
  scatterClearingCover(ctx) // flowers + stray mid-grass over the open floor
  repairFloorConnectivity(ctx) // keep the floor one region
}

/** Fill only a thin border band with random tree clumps, leaving the interior
 *  open. Edge cells stay solid (the map border); the band just inside is sparse. */
function seedEdgeClumps(trees: boolean[][], cols: number, rows: number): void {
  forEachCell(cols, rows, (col, row) => {
    if (isEdge(col, row, cols, rows)) {
      trees[row][col] = true // solid map border, like every other layout
      return
    }
    if (!withinEdgeBand(col, row, cols, rows)) return // interior stays open glade
    if (Math.random() < OPEN_CLUMP_CHANCE) trees[row][col] = true
  })
}

const withinEdgeBand = (col: number, row: number, cols: number, rows: number): boolean =>
  col < OPEN_EDGE_BAND || row < OPEN_EDGE_BAND || col >= cols - OPEN_EDGE_BAND || row >= rows - OPEN_EDGE_BAND

// ── 'lake' layout: a forest ringed around a central LAKE of the zone's hazard
//    terrain (frozen→ice walkable, verdant→water blocking, lava→lava blocking).
//    Trees fill the surround; the floor around the lake stays one region. ──────
const LAKE_RADIUS_FACTOR = 0.28 // lake radius as a fraction of the smaller axis

/** Per-zone lake terrain: the hazard ground type painted into the lake cells, and
 *  whether the lake blocks. Frozen ice is walkable (for now; swim/skate later);
 *  water + lava block. Lookup table, not an if/else chain. */
interface LakeTerrain {
  ground: string
  blocks: boolean
}

const LAKE_TERRAIN: Readonly<Record<ZoneId, LakeTerrain>> = {
  spring: { ground: 'water', blocks: true }, // water blocks unless you can swim
  summer: { ground: 'water', blocks: true },
  autumn: { ground: 'water', blocks: true },
  winter: { ground: 'ice_water', blocks: false }, // ice: walkable now, skate/swim later
  desert: { ground: 'water', blocks: true }, // a rare oasis
  beach: { ground: 'water', blocks: true }, // the sea
  lava: { ground: 'lava', blocks: true }, // molten — always blocks
}

/** A NAVIGABLE forest with a central hazard lake. The surround is carved with the
 *  same distributed room+corridor network the passages layout uses — so the lake
 *  sits in a real, walkable forest (plenty of land to balance the hazard) instead
 *  of a solid wall of trees with only a pond punched out. The lake disc is then
 *  stamped with the zone's hazard terrain (blocking per zone) and the floor is
 *  repaired to one connected region around it. */
function layoutLake(ctx: ArchetypeContext): void {
  const { cols, rows } = ctx
  const trees = makeGrid(cols, rows, () => true) // start fully forested
  const lake = lakeCells(cols, rows)
  const lakeKeys = new Set(lake.map(c => `${c.col},${c.row}`))

  // 1. Carve a navigable forest AROUND the lake — distributed rooms wired into a
  //    corridor network (independent of the lake), so both sides connect on land.
  const rooms = layoutForestRooms(cols, rows)
  rooms.forEach(room => carveRoom(trees, room, cols, rows))
  connectRooms(trees, rooms)

  // 2. Open the lake body, a walkable lakeside clearing, and wide edge↔lake gates
  //    so the waterside is a real shore joined to the network.
  lake.forEach(({ col, row }) => {
    trees[row][col] = false // no trees in the water
  })
  openLakeside(trees, lakeKeys, cols, rows)
  carveLakeGates(trees, lakeKeys, cols, rows)

  // 3. Finish like passages: keep one region (fill stray pockets), gate to the map
  //    edges, erode mass edges for visibility.
  const clearing = keepLargestClearing(trees, cols, rows)
  carveGates(trees, clearing, cols, rows)
  thinForestForZone(trees, cols, rows, ctx.zone, 3)

  commitTrees(ctx, trees) // tree masses fill the negative space
  markGrassZones(ctx, rooms) // some clearings become tall-grass
  scatterGladeTrees(ctx) // a few standalone trees dot the clearings
  scatterClearingCover(ctx) // flowers + stray mid-grass

  paintLake(ctx, lake) // stamp the lake (blocking per zone) so the repair sees its
  //   real collision and never connects the map *through* still-open water/lava
  //   (which would strand the far side once it blocks). Strips trees/cover on lake.
  carveLakeShore(ctx, lake) // guarantee a 1-cell walkable ring even after paint
  placeLakeFeature(ctx, lake) // a volcano (lava) / waterfall-mountain (water/ice) by the shore
  repairFloorConnectivity(ctx) // …THEN repair the surround into ONE region: ice stays
  //   walkable floor; water/lava is routed around via the shore + gates, and any
  //   pocket the lake stranded is filled so the floor is always connected.
}

/** Open a walkable lakeside clearing: clear trees within a couple of cells of the
 *  lake so the shore is a navigable band (joined to the surrounding forest), not a
 *  bare 1-cell sliver. Skips the lake itself and the solid map border. */
const LAKESIDE_BAND = 2
function openLakeside(trees: boolean[][], lakeKeys: Set<string>, cols: number, rows: number): void {
  lakeKeys.forEach(key => {
    const { col, row } = toCell(key)
    for (let dr = -LAKESIDE_BAND; dr <= LAKESIDE_BAND; dr++) {
      for (let dc = -LAKESIDE_BAND; dc <= LAKESIDE_BAND; dc++) {
        const c = col + dc
        const r = row + dr
        if (lakeKeys.has(`${c},${r}`)) continue
        if (!inBounds(c, r, cols, rows) || isEdge(c, r, cols, rows)) continue
        trees[r][c] = false
      }
    }
  })
}

/** Open wide lanes from the lake to the south and north edges (PATH_WIDTH bands,
 *  like carveGates) so the lake+shore are joined to the map's main floor and can
 *  never be sealed off into a discarded pocket by the surrounding tree ring. */
function carveLakeGates(trees: boolean[][], lakeKeys: Set<string>, cols: number, rows: number): void {
  const cells = [...lakeKeys].map(toCell)
  if (cells.length === 0) return
  const south = cells.reduce((a, b) => (b.row > a.row ? b : a))
  const north = cells.reduce((a, b) => (b.row < a.row ? b : a))
  const east = cells.reduce((a, b) => (b.col > a.col ? b : a))
  const west = cells.reduce((a, b) => (b.col < a.col ? b : a))
  carveVertical(trees, south.col, south.row, rows - 1)
  carveVertical(trees, north.col, north.row, 0)
  carveHorizontal(trees, east.col, cols - 1, east.row)
  carveHorizontal(trees, west.col, 0, west.row)
}

/** The lake's cells: a centered body with an ORGANIC outline — the radius wobbles
 *  with angle (two sine harmonics at a random phase) so it reads like a natural
 *  lake / lava flow, not a geometric disc. The radius is a single-valued function
 *  of angle, so the region stays star-shaped from the center → always contiguous. */
function lakeCells(cols: number, rows: number): Cell[] {
  const cc = Math.floor(cols / 2)
  const cr = Math.floor(rows / 2)
  const radius = Math.max(2, Math.floor(Math.min(cols, rows) * LAKE_RADIUS_FACTOR))
  const phaseA = Math.random() * Math.PI * 2
  const phaseB = Math.random() * Math.PI * 2
  const wobble = (angle: number): number =>
    1 + 0.2 * Math.sin(angle * 3 + phaseA) + 0.12 * Math.sin(angle * 5 + phaseB)
  // Hard cap so the lake always leaves a walkable margin to every border — a
  // continuous ring of land can then encircle it, so no region ever connects ONLY
  // through the (blocking) lake and gets stranded/filled into a solid forest.
  const maxReach = Math.min(cc, cr) - LAKE_BORDER_MARGIN
  const cells: Cell[] = []
  forEachCell(cols, rows, (col, row) => {
    if (isEdge(col, row, cols, rows)) return // never touch the map border
    const dx = col - cc
    const dy = row - cr
    const reach = Math.min(radius * wobble(Math.atan2(dy, dx)), maxReach)
    if (dx * dx + dy * dy <= reach * reach) cells.push({ col, row })
  })
  return cells
}
const LAKE_BORDER_MARGIN = 4 // walkable cells kept between the lake and each border

/** Stamp the lake: paint each cell the zone's hazard ground and set collision per
 *  the zone (water/lava block, ice walkable). Clears any tree prop on those cells
 *  so the lake reads as open water, not canopy. Guard-claused, no nesting. */
function paintLake(ctx: ArchetypeContext, lake: Cell[]): void {
  const { ground, collision, props, zone } = ctx
  const terrain = LAKE_TERRAIN[zone]
  const lakeKeys = new Set(lake.map(c => `${c.col},${c.row}`))
  const kept = props.filter(p => !lakeKeys.has(`${p.col},${p.row}`)) // drop trees in the lake
  props.length = 0
  props.push(...kept)
  lake.forEach(({ col, row }) => {
    ground[row][col] = terrain.ground
    collision[row][col] = terrain.blocks
  })
}

/** Open a one-cell walkable shore around the lake so its tree ring can't seal the
 *  floor off. Only ground cells (not the lake itself, not the border) are freed. */
function carveLakeShore(ctx: ArchetypeContext, lake: Cell[]): void {
  const { collision, props, cols, rows } = ctx
  const lakeKeys = new Set(lake.map(c => `${c.col},${c.row}`))
  const shore = shoreCells(lakeKeys, cols, rows)
  if (shore.size === 0) return
  const kept = props.filter(p => !shore.has(`${p.col},${p.row}`)) // remove trees on the shore
  props.length = 0
  props.push(...kept)
  shore.forEach(key => {
    const { col, row } = toCell(key)
    collision[row][col] = false
  })
}

/** Ground cells orthogonally adjacent to the lake (the shore ring), excluding the
 *  lake and the map border. Returns a key set. */
function shoreCells(lakeKeys: Set<string>, cols: number, rows: number): Set<string> {
  const shore = new Set<string>()
  lakeKeys.forEach(key => {
    const { col, row } = toCell(key)
    for (const [dc, dr] of ORTHO) {
      const c = col + dc
      const r = row + dr
      const neighbour = `${c},${r}`
      if (lakeKeys.has(neighbour)) continue
      if (!inBounds(c, r, cols, rows) || isEdge(c, r, cols, rows)) continue
      shore.add(neighbour)
    }
  })
  return shore
}

// A signature biome FEATURE anchoring the lake: a mountain massif on the north
// shore (a volcano in lava — ember-crowned, lava spilling in; a snow-capped peak
// with a waterfall otherwise). Coherence: "lava near a volcano, water near a
// waterfall/mountains." All cells block.
const FEATURE_HEIGHT = 4 // rows from apex (narrow) down to the base near the shore
const FEATURE_HALF = 3 // half-width at the base → a 7-wide cone

/** Raise the lake's feature massif just north of the water, with a 2-cell spill
 *  (lava flow / waterfall) running from its base into the lake. Drops any prop on
 *  the footprint, then stamps blocking feature cells. */
function placeLakeFeature(ctx: ArchetypeContext, lake: Cell[]): void {
  const { props, collision, zone, cols, rows } = ctx
  if (lake.length === 0) return
  const north = lake.reduce((a, b) => (b.row < a.row ? b : a)) // lake's north-edge cell
  const apexCol = clamp(north.col, FEATURE_HALF + 1, cols - FEATURE_HALF - 2)
  const baseRow = north.row - 1
  const apexRow = baseRow - (FEATURE_HEIGHT - 1)
  if (apexRow < 1) return // not enough land north of the lake (shouldn't happen given the margin)

  // Build the cone, keyed by cell so the spill can override mountain cells. The
  // whole feature stays on LAND (rows ≤ baseRow, just above the lake) so it never
  // turns walkable lake terrain (ice) into a blocker — it meets the shore, not the
  // water. Spill = the flow down the cone's lower-centre face.
  const cellMap = new Map<string, CellLabel>()
  for (let r = apexRow; r <= baseRow; r++) {
    const half = Math.round(((r - apexRow) / (FEATURE_HEIGHT - 1)) * FEATURE_HALF)
    for (let c = apexCol - half; c <= apexCol + half; c++) {
      cellMap.set(`${c},${r}`, r === apexRow && c === apexCol ? 'peak' : 'mountain')
    }
  }
  cellMap.set(`${apexCol},${baseRow}`, 'spill') // flow reaching the shore
  if (baseRow - 1 > apexRow) cellMap.set(`${apexCol},${baseRow - 1}`, 'spill')

  const kept = props.filter(p => !cellMap.has(`${p.col},${p.row}`))
  props.length = 0
  props.push(...kept)
  cellMap.forEach((label, key) => {
    const { col, row } = toCell(key)
    if (!inBounds(col, row, cols, rows) || isEdge(col, row, cols, rows)) return
    props.push(makeFeatureCell(zone, col, row, label))
    collision[row][col] = true
  })
}

/** Glade-tree trunks can pinch off a tiny floor pocket. Any ground cell outside the
 *  largest connected floor region becomes tree mass, so the navigable floor is always
 *  ONE region. Canopy tops (tree_leaf_top) are a separate walkable layer — excluded. */
function repairFloorConnectivity(ctx: ArchetypeContext): void {
  const { collision, props, zone, cols, rows } = ctx
  const canopyTop = new Set(
    props.filter(p => p.label === 'tree_leaf_top').map(p => `${p.col},${p.row}`),
  )
  const isFloor = (col: number, row: number): boolean =>
    inBounds(col, row, cols, rows) && !collision[row][col] && !canopyTop.has(`${col},${row}`)

  const largest = largestFloorRegion(isFloor, cols, rows)
  forEachCell(cols, rows, (col, row) => {
    if (!isFloor(col, row)) return
    if (largest.has(`${col},${row}`)) return
    collision[row][col] = true
    props.push(makeTreeCell(zone, col, row, 'tree_interior', massVariant(col, row))) // dead pocket → forest fills it
  })
}

const FLOOR_DIRS: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]]

/** The biggest connected region of floor cells (4-neighbour), as a key set. */
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

interface ForestRoom {
  col: number
  row: number
  w: number
  h: number
  role: 'clearing' | 'grass' // 'grass' rooms become tall-grass zones
}

/** A 3×3 grid of slots, each (mostly) holding a jittered room — divides the map
 *  into many distributed sections of varied size and role. */
function layoutForestRooms(cols: number, rows: number): ForestRoom[] {
  const rooms: ForestRoom[] = []
  const slotsX = 3
  const slotsY = 3
  const slotW = Math.floor(cols / slotsX)
  const slotH = Math.floor(rows / slotsY)
  for (let sy = 0; sy < slotsY; sy++) {
    for (let sx = 0; sx < slotsX; sx++) {
      if (Math.random() < 0.06) continue // rarely skip a slot — keeps dense outliers down
      const w = randInt(6, Math.max(6, slotW - 2)) // larger clearings → fewer trees overall
      const h = randInt(6, Math.max(6, slotH - 2))
      const col = clamp(sx * slotW + randInt(1, Math.max(1, slotW - w)), 1, cols - w - 1)
      const row = clamp(sy * slotH + randInt(1, Math.max(1, slotH - h)), 1, rows - h - 1)
      const role: ForestRoom['role'] = Math.random() < 0.4 ? 'grass' : 'clearing'
      rooms.push({ col, row, w, h, role })
    }
  }
  return rooms
}

const roomCenter = (room: ForestRoom): Cell => ({
  col: room.col + Math.floor(room.w / 2),
  row: room.row + Math.floor(room.h / 2),
})

/** Clear a room's rectangle open (skips the solid border). */
function carveRoom(trees: boolean[][], room: ForestRoom, cols: number, rows: number): void {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const col = room.col + dx
      const row = room.row + dy
      if (inBounds(col, row, cols, rows) && !isEdge(col, row, cols, rows)) trees[row][col] = false
    }
  }
}

/** Nearest-neighbour spanning tree + a couple of extra links for loops, so the
 *  sections form a navigable NETWORK rather than a single path. */
function connectRooms(trees: boolean[][], rooms: ForestRoom[]): void {
  if (rooms.length < 2) return
  const linked = [rooms[0]]
  const pending = rooms.slice(1)
  while (pending.length > 0) {
    const next = nearestPending(linked, pending)
    carveCorridor(trees, roomCenter(next.from), roomCenter(pending[next.index]))
    linked.push(pending.splice(next.index, 1)[0])
  }
  const loops = Math.min(2, rooms.length - 1)
  for (let i = 0; i < loops; i++) {
    const a = rooms[randInt(0, rooms.length - 1)]
    const b = rooms[randInt(0, rooms.length - 1)]
    if (a !== b) carveCorridor(trees, roomCenter(a), roomCenter(b))
  }
}

function nearestPending(linked: ForestRoom[], pending: ForestRoom[]): { from: ForestRoom; index: number } {
  let best = { from: linked[0], index: 0, dist: Infinity }
  pending.forEach((room, index) => {
    linked.forEach(from => {
      const dist = manhattan(roomCenter(from), roomCenter(room))
      if (dist < best.dist) best = { from, index, dist }
    })
  })
  return best
}

const manhattan = (a: Cell, b: Cell): number => Math.abs(a.col - b.col) + Math.abs(a.row - b.row)

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

/** Mark 'grass'-role rooms as tall-grass zones (encounter grass). */
function markGrassZones(ctx: ArchetypeContext, rooms: ForestRoom[]): void {
  const { ground, collision, cols, rows } = ctx
  const accent = ZONE_PALETTES[ctx.zone].groundTypes[1] // frozen→ice, lava→rock, verdant→tall grass
  rooms.forEach(room => {
    if (room.role !== 'grass') return
    for (let dy = 0; dy < room.h; dy++) {
      for (let dx = 0; dx < room.w; dx++) {
        const col = room.col + dx
        const row = room.row + dy
        if (inBounds(col, row, cols, rows) && !collision[row][col]) ground[row][col] = accent
      }
    }
  })
}

// A standalone glade tree spans this many cells vertically: trunk base, trunk,
// canopy, walkable canopy top (bottom → top). Each cell carries its own label so
// the canopy occupies — and correctly blocks — the cells its art covers, instead
// of a single base cell whose tall canopy used to overlap "free" cells above.
// A standalone tree is fully SOLID: trunk → leaf → solid crown (no passable
// cell). The whole column blocks, so you can't step "into" the leaves.
/** Thick-trunk glyph for MATURE trees (matches Tileset.ts `trunk_thick`); young
 *  trees keep the thin `│` from the tree_stem label. */
const TRUNK_BIG = '║'
const TREE_COLUMN: readonly CellLabel[] = ['tree_stem_bottom', 'tree_stem', 'tree_leaf', 'tree_crown']
// A dead/bare tree: a tall trunk topped by a leafless snag (no walkable canopy).
// Same height as a living tree so placement (treeFits) is shared.
const DEAD_TREE_COLUMN: readonly CellLabel[] = ['tree_stem_bottom', 'tree_stem', 'tree_stem', 'tree_snag']
const TREE_HEIGHT = TREE_COLUMN.length

// Per-zone chance a scattered glade tree is a leafless snag — harsher zones have
// more dead wood (charred lava, frost-killed frozen) than the lush verdant.
// Bare/dead trees by season: many in winter (leafless), a good share in autumn,
// few in the green seasons.
const DEAD_TREE_CHANCE: Readonly<Record<ZoneId, number>> = {
  spring: 0.06, summer: 0.08, autumn: 0.28, winter: 0.45, desert: 0.4, beach: 0.1, lava: 0.5,
}

// Per-zone forest density (1 = densest canopy). Drives extra erosion passes + the
// glade-tree count, so a deep SUMMER forest reads denser than an airy SPRING one,
// and arid zones (desert/beach) are sparse scrub. Tuned to land ~25% below the old
// flat ~45% coverage. Open/Closed: add a zone → add a row.
const FOREST_DENSITY: Readonly<Record<ZoneId, number>> = {
  summer: 1.0, autumn: 0.8, winter: 0.62, spring: 0.35, lava: 0.58, beach: 0.38, desert: 0.22,
}

/** Erode the tree mass `basePasses` times, PLUS extra passes scaled by how sparse
 *  the zone should be — fewer trees overall and a clear spring(sparse)/summer(dense)
 *  split. Each pass only erodes cells touching open floor, so the floor stays one
 *  connected region. */
function thinForestForZone(trees: boolean[][], cols: number, rows: number, zone: ZoneId, basePasses: number): void {
  const extra = Math.round((1 - FOREST_DENSITY[zone]) * 4)
  for (let i = 0; i < basePasses + extra; i++) thinForest(trees, cols, rows)
}

/** Sparse, blue-noise-spaced MULTI-CELL trees dotting the open clearings
 *  (dart-throw with a minimum spacing — a lightweight Poisson-disk per
 *  docs/ALGORITHMS.md). Each tree stamps its full vertical extent. */
function scatterGladeTrees(ctx: ArchetypeContext, densityMul = 1): void {
  const { collision, cols, rows } = ctx
  const placed: Cell[] = []
  const minDist = 5 // wide spacing → clearings stay open and navigable
  // sparser in airy/arid zones; the open glade passes a low mul so it stays open
  const attempts = Math.floor(cols * rows * 0.08 * FOREST_DENSITY[ctx.zone] * densityMul)
  for (let i = 0; i < attempts; i++) {
    const col = randInt(2, cols - 3)
    const row = randInt(TREE_HEIGHT, rows - 3) // leave headroom above the base for the canopy
    if (!treeFits(collision, col, row, cols, rows)) continue
    if (placed.some(p => Math.abs(p.col - col) < minDist && Math.abs(p.row - row) < minDist)) continue
    // ~45% of living trees are mature (thick trunk); the rest young (thin trunk).
    stampTree(ctx, col, row, Math.random() < DEAD_TREE_CHANCE[ctx.zone], Math.random() < 0.45)
    placed.push({ col, row })
  }
}

/** A vertical tree fits when its WHOLE column is in-bounds and on currently-open
 *  ground — including the canopy top, so it never punches a walkable hole through
 *  the solid forest mass or stacks two props on one cell — AND the walkable top
 *  keeps an open lateral neighbour, so it never becomes an isolated pocket. */
function treeFits(collision: boolean[][], baseCol: number, baseRow: number, cols: number, rows: number): boolean {
  const topRow = baseRow - (TREE_HEIGHT - 1)
  if (!inBounds(baseCol, topRow, cols, rows)) return false
  for (let i = 0; i < TREE_HEIGHT; i++) {
    if (collision[baseRow - i][baseCol]) return false
  }
  return hasOpenLateralNeighbour(collision, baseCol, topRow, cols, rows)
}

/** True if the cell has an open (walkable) horizontal neighbour — keeps a stamped
 *  canopy top reachable from the surrounding clearing. */
function hasOpenLateralNeighbour(collision: boolean[][], col: number, row: number, cols: number, rows: number): boolean {
  const left = inBounds(col - 1, row, cols, rows) && !collision[row][col - 1]
  const right = inBounds(col + 1, row, cols, rows) && !collision[row][col + 1]
  return left || right
}

/** Stamp a multi-cell labeled tree upward from its base; per-label collision via
 *  isWalkable. A living tree's only walkable cell is its canopy top; a `dead`
 *  snag is solid all the way up. One canopy shade per tree (no intra-tree mess). */
function stampTree(ctx: ArchetypeContext, baseCol: number, baseRow: number, dead = false, big = false): void {
  const { props, collision, zone } = ctx
  const column = dead ? DEAD_TREE_COLUMN : TREE_COLUMN
  const variant = randInt(0, TREE_CANOPY_SHADES[zone].length - 1) // this tree's tone
  column.forEach((label, i) => {
    const row = baseRow - i
    const cell = makeTreeCell(zone, baseCol, row, label, variant)
    // Small vs BIG trunk actually shows now: a mature tree gets the thick trunk (║),
    // a young/sapling tree keeps the thin (│). Label/collision stay the same.
    if (big && label === 'tree_stem') cell.char = TRUNK_BIG
    props.push(cell)
    collision[row][baseCol] = !isWalkable(label)
  })
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

/** Open a south entrance and a north exit, linking the clearing to both edges. */
function carveGates(trees: boolean[][], clearing: Set<string>, cols: number, rows: number): void {
  const cells = [...clearing].map(toCell)
  if (cells.length === 0) return
  const south = cells.reduce((a, b) => (b.row > a.row ? b : a))
  const north = cells.reduce((a, b) => (b.row < a.row ? b : a))
  carveVertical(trees, south.col, south.row, rows - 1)
  carveVertical(trees, north.col, north.row, 0)
}

function carveVertical(trees: boolean[][], col: number, fromRow: number, toRow: number): void {
  const step = toRow >= fromRow ? 1 : -1
  for (let row = fromRow; row !== toRow + step; row += step) {
    clearBand(trees, col, row, true) // band spans cols (perpendicular to a vertical run)
  }
}

/** Commit the forest tree-mass: AUTOTILE each filled cell to a 9-piece
 *  edge/corner/interior label (8-neighbour, per docs/ALGORITHMS.md), then set
 *  collision from its label. Out-of-bounds counts as NOT tree (an edge). */
function commitTrees(ctx: ArchetypeContext, trees: boolean[][]): void {
  const { props, collision, zone, cols, rows } = ctx
  const isTree = (col: number, row: number): boolean => inBounds(col, row, cols, rows) && trees[row][col]
  forEachCell(cols, rows, (col, row) => {
    if (!trees[row][col]) return
    const label = autotileLabel(TREE_MASS_FAMILY, isTree, col, row)
    props.push(makeTreeCell(zone, col, row, label, massVariant(col, row)))
    collision[row][col] = !isWalkable(label)
  })
}

/** Erode tree-mass edges (cells touching open) to cut density ~25% for
 *  visibility, keeping the open network connected (eroded cells join it). */
function thinForest(trees: boolean[][], cols: number, rows: number): void {
  const drop: Cell[] = []
  forEachCell(cols, rows, (col, row) => {
    if (!trees[row][col]) return
    if (isEdge(col, row, cols, rows)) return // keep the solid border
    if (!touchesOpen(trees, col, row)) return // keep mass interiors solid
    if (Math.random() < 0.5) drop.push({ col, row })
  })
  drop.forEach(c => {
    trees[c.row][c.col] = false
  })
}

function touchesOpen(trees: boolean[][], col: number, row: number): boolean {
  return ORTHO.some(([dx, dy]) => trees[row + dy]?.[col + dx] === false)
}

/** Short-grass clearings get mid-level grass patches + walkable flowers. */
function scatterClearingCover(ctx: ArchetypeContext): void {
  const { ground, collision, props, zone, cols, rows } = ctx
  const accent = ZONE_PALETTES[zone].groundTypes[1]
  const flowersAllowed = FLOWERS_BY_ZONE[zone] !== undefined // only the flowering zones bloom
  forEachCell(cols, rows, (col, row) => {
    if (isEdge(col, row, cols, rows)) return
    if (collision[row][col]) return
    const roll = Math.random()
    if (roll < 0.16) {
      ground[row][col] = accent // mid-level accent ground (zone-themed)
      return
    }
    if (flowersAllowed && roll < 0.22) props.push(makeFlower(zone, col, row))
  })
  scatterGroundCover(ctx, 0.1) // light non-blocking floor tufts — keep the forest floor clean + readable
}

// ── temple archetype (a grand columned hall on a paved approach) ────
function placeTemple(ctx: ArchetypeContext): void {
  const { buildings, cols, rows } = ctx
  const facade = composeBuilding({ type: 'temple' })
  if (facade.length + 4 > cols) return // grid too small for a temple
  const col = Math.floor((cols - facade.length) / 2)
  // Anchor on the ground row; clamp so the small footprint clears the top edge and the paved
  // approach below still fits. South-facing: door down toward the hall, so the footprint top-left
  // sits depth-1 rows above the ground (door) row.
  const row = clamp(Math.floor(rows * 0.4), facade.depth, rows - 4)
  const plot: Plot = { col, row: row - (facade.depth - 1), type: 'temple', length: facade.length, depth: facade.depth, height: facade.height, facing: 'south' }
  const placed = placeBuilding(ctx, facade, plot, footprintRect(plot))
  buildings.push(placed)

  const doorCol = placed.doorCells[0]?.col ?? col + Math.floor(facade.length / 2)
  templeHall(ctx, doorCol, row + 1, facade.length)
  scatterGroundCover(ctx, 0.15) // light litter over the grounds around the hall (skips marble)
}

/** A grand colonnaded hall below the temple door: an ornate checkered floor, an
 *  altar flanked by braziers at the head, and a colonnade lining both sides. */
function templeHall(ctx: ArchetypeContext, doorCol: number, fromRow: number, facadeLen: number): void {
  const { ground, cols, rows } = ctx
  const halfW = clamp(Math.floor(facadeLen / 2), 3, 6)
  for (let r = fromRow; r < rows - 1; r++) {
    for (let w = -halfW; w <= halfW; w++) {
      const c = doorCol + w
      if (inBounds(c, r, cols, rows)) ground[r][c] = (r + c) % 2 === 0 ? 'marble' : 'gold_tile'
    }
  }
  // altar + flanking braziers at the head of the hall
  placeProp(ctx, makeAltar(doorCol, fromRow + 1))
  placeProp(ctx, makeBrazier(doorCol - 2, fromRow + 1))
  placeProp(ctx, makeBrazier(doorCol + 2, fromRow + 1))
  // colonnade lining both sides, leaving the central aisle clear
  for (let r = fromRow + 3; r < rows - 2; r += 2) {
    placeProp(ctx, makePillar(doorCol - halfW, r))
    placeProp(ctx, makePillar(doorCol + halfW, r))
  }
}

// ── cave archetype (cellular automata, the 4-5 rule, per docs/ALGORITHMS.md §2):
//    ~45% random rock fill → 4-5 smoothing passes (OOB counts as rock) → keep the
//    single largest cavern (the rest fills back to rock) → carve a guaranteed
//    south gate so the spawn area reaches the cavern. Randomized per run. ──────
const CAVE_FILL = 0.45 // initial random rock probability (40-50% range)
const CAVE_ITERATIONS = 5 // smoothing passes (4-5 gives crisp caverns)

function placeCave(ctx: ArchetypeContext): void {
  const { cols, rows } = ctx

  // LAYOUT FIRST: carve the cavern skeleton, keep one connected region, then gate
  // it to the south edge — only after the shape is fixed do we commit props.
  let rock = makeGrid(cols, rows, () => Math.random() < CAVE_FILL)
  for (let i = 0; i < CAVE_ITERATIONS; i++) rock = smoothCave(rock, cols, rows)
  const cavern = keepLargestClearing(rock, cols, rows) // reuse: true = blocked
  carveCaveGate(rock, cavern, cols, rows)

  commitRocks(ctx, rock) // rock walls fill the negative space (blocking props)
  scatterCaveDecor(ctx)
  scatterGroundCover(ctx, 0.22) // occasional dust / pebbles / embers across the cavern floor
}

/** Sprinkle non-blocking decor (stalagmites/crystals/rubble) over the cavern floor. */
function scatterCaveDecor(ctx: ArchetypeContext): void {
  const { props, collision, cols, rows } = ctx
  forEachCell(cols, rows, (col, row) => {
    if (collision[row][col]) return // floor cells only
    if (Math.random() > 0.3) return // stalagmites/crystals; ground cover fills the rest
    props.push(makeCaveDecor(col, row))
  })
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

/** Open a wide gate from the south edge up to the cavern's lowest cell so the
 *  spawn area (bottom) is guaranteed to reach the single connected cavern. */
function carveCaveGate(rock: boolean[][], cavern: Set<string>, cols: number, rows: number): void {
  const cells = [...cavern].map(toCell)
  if (cells.length === 0) return
  const south = cells.reduce((a, b) => (b.row > a.row ? b : a))
  carveVertical(rock, south.col, south.row, rows - 1) // PATH_WIDTH band, joins the cavern
}

function commitRocks(ctx: ArchetypeContext, rock: boolean[][]): void {
  const { props, collision, cols, rows } = ctx
  forEachCell(cols, rows, (col, row) => {
    if (!rock[row][col]) return
    props.push(makeRock(col, row))
    collision[row][col] = true
  })
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
  assets: { col: number; row: number; char: string; type: string; color: string; blocking: boolean; label?: string; baseShadow?: boolean; buildingType?: string }[]
}

export function stagePaint(stage: StageData): StagePaint {
  const ground: StagePaint['ground'] = []
  const assets: StagePaint['assets'] = []
  stage.buildings.forEach(b => paintBuildingGround(b, ground))
  stage.props.forEach(p =>
    assets.push({ col: p.col, row: p.row, char: p.char, type: p.type, color: p.color, blocking: p.blocking, label: p.label, baseShadow: p.baseShadow, buildingType: p.buildingType }),
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
  const door = b.doorCells[0]
  if (!door) return
  const [dc, dr] = FACING_STEP[b.facing]
  // The setback yard cell between the door and the road, paved as the driveway.
  ground.push({ col: door.col + dc, row: door.row + dr, type: 'path_stone' })
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

/** Map StageData onto the persisted Template shape so the editor can render it.
 *  Terrain height stays 0 — blocks are collision, not elevation. */
export function stageToTemplate(stage: StageData, name: string): StageTemplatePayload {
  const groundData = stage.ground.map(r => [...r])
  const heightData = stage.collision.map(r => r.map(() => 0))
  const paint = stagePaint(stage)
  paint.ground.forEach(g => {
    groundData[g.row][g.col] = g.type
  })
  const assetsData = paint.assets.map(a => ({
    art: [a.char],
    col: a.col,
    row: a.row,
    type: a.type,
    blocking: a.blocking,
    color: a.color,
    height: 0,
    label: a.label,
  }))

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
