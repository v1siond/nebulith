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
import { planVillage, type VillageLayout, type Settlement, type Plot, type Facing, type PlazaRect } from './villageLayout'
import { stagePropTileOverride, ZONE_PALETTES, ZoneId } from './zones'
import { autotileLabel, isWalkable, TREE_MASS_FAMILY, type CellLabel } from './cellLabels'
import { TREE_CANOPY_SHADES, groundDecor } from './cellTileset'
import { resolveTile } from './tileset/tileset'
import { isRoadGround } from './buildingEditor'
import { ASCII_TILESET } from './tileset/asciiTileset'
import { varyIntensity } from './colors'
import type { Connector } from '@/lib/api'
import { clamp, randInt, manhattan } from '@/lib/math'

export type VariantId = 'town' | 'city' | 'forest' | 'cave' | 'temple' | 'boss-stage'

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
  const tile = resolveTile(ASCII_TILESET, zone, label, variant) // LOADS from the tileset, not hardcoded cellTile
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
// DARK, solid roof tones (real shingle/tile colors) — deep red, dark brown, charcoal-slate, dark
// green, dark maroon. The roof glyph is drawn a shade darker still so it reads on these.
const HOUSE_ROOFS = ['#6e2820', '#523322', '#33383f', '#2f4233', '#5a2a30']
// Real-house exterior wall colors (warm + muted, like painted siding) so a street has variety.
const HOUSE_WALLS = ['#e6d6b0', '#b9c4a6', '#d0b596', '#aebfcc', '#d9b48c', '#c9c0b2', '#cf9f8f']
const HOUSE_DOORS = ['#3a2414', '#2a1810', '#23303f', '#2e2a1a', '#402028'] // dark wood / navy / green-black — always darker than the wall
const BUILDING_PALETTES: Readonly<Record<BuildingType, BuildingPalette>> = {
  house: { roof: '#6e2820', wall: '#d8c49a', door: '#241810', window: '#8fc4e6' },
  'big-house': { roof: '#3f4d63', wall: '#cfc6b4', door: '#1e2630', window: '#a8d4ee' }, // squarer "building", dark cool roof
  store: { roof: '#235a96', wall: '#e2dcc8', door: '#26414f', window: '#a8dcf2' }, // dark blue roof
  hospital: { roof: '#2f7e50', wall: '#f0f0ea', door: '#2a3a2a', window: '#cfeede' }, // dark green roof, white walls
  cathedral: { roof: '#7a5aa0', wall: '#d8d0c0', door: '#241828', window: '#c4a8ea' },
  temple: { roof: '#b08a3a', wall: '#d8cca0', door: '#33240f', window: '#ecc868' },
  castle: { roof: '#5f6068', wall: '#b6b2aa', door: '#15151a', window: '#9fb2cc' },
}

// ── wall MATERIALS — a building's walls are a real material, not all "wood". Each material is a TILE
//    (the emoji ridden onto the wall faces under a reskin) + its own colour range. HOUSES roll a
//    material per building (seeded, so a street MIXES wood/brick/stone/plaster); civic types keep an
//    identity material. PLASTER has no texture tile, so its painted colour reads flat (like the roof).
export type WallMaterial = 'wood' | 'brick' | 'stone' | 'plaster'

interface MaterialDef { emoji: string; image?: string; walls: readonly string[] }
export const WALL_MATERIALS: Readonly<Record<WallMaterial, MaterialDef>> = {
  // wood 🪵 + stone 🪨 are Unicode-13 glyphs Segoe lacks (they tofu to [?]) → render them from a Noto
  // image instead (the emoji stays as ASCII/label fallback). brick 🧱 renders fine → glyph. plaster = none.
  wood: { emoji: '🟫', image: '/tiles/emoji/noto/emoji_u1f7eb.png', walls: ['#9c6b3f', '#8a5a34', '#a67a48', '#7d5330'] }, // 🟫 clean brown wall (🪵 log read as ugly); warm browns
  brick: { emoji: '🧱', image: '/tiles/emoji/noto/emoji_u1f9f1.png', walls: ['#b0603a', '#a5542f', '#9c4e30', '#b56a44'] }, // Noto brick image (cleaner than the chunky Segoe glyph)
  stone: { emoji: '🪨', image: '/tiles/emoji/noto/emoji_u1faa8.png', walls: ['#8f8a82', '#7c776f', '#9a958c', '#847e75'] }, // muted greys
  plaster: { emoji: '', walls: HOUSE_WALLS }, // painted siding — colour only, no texture tile
}

// House rolls one of these per building; every other type maps to a fixed identity material.
const HOUSE_MATERIALS: readonly WallMaterial[] = ['wood', 'brick', 'stone', 'plaster']
const CIVIC_MATERIAL: Readonly<Record<Exclude<BuildingType, 'house'>, WallMaterial>> = {
  'big-house': 'brick',
  store: 'brick',
  hospital: 'plaster', // white painted clinic
  cathedral: 'stone',
  temple: 'stone',
  castle: 'stone',
}

/** The wall material for a building — deterministic. Houses vary per building (seeded on anchorSeed,
 *  so a street mixes materials); every other type has a fixed identity material. Pure. */
export function buildingWallMaterial(type: BuildingType, anchorSeed: number): WallMaterial {
  if (type !== 'house') return CIVIC_MATERIAL[type]
  return HOUSE_MATERIALS[Math.floor(shadeNoise(anchorSeed + 0.9) * HOUSE_MATERIALS.length) % HOUSE_MATERIALS.length]
}

/** The wall TILE (emoji) for a building's material under a reskin — '' for plaster (no texture; the
 *  painted colour reads flat). The renderer rides this on the wall faces instead of one global brick. */
export function wallMaterialTile(type: BuildingType, anchorSeed: number): string {
  return WALL_MATERIALS[buildingWallMaterial(type, anchorSeed)].emoji
}

/** The wall IMAGE (a Noto png) for a building's material under a reskin — set for wood/stone (whose
 *  🪵/🪨 glyphs tofu on Segoe), undefined for brick (glyph renders fine) and plaster (colour only).
 *  The renderer draws this on the wall faces; the emoji is the ASCII/label fallback. Pure. */
export function wallMaterialImage(type: BuildingType, anchorSeed: number): string | undefined {
  return WALL_MATERIALS[buildingWallMaterial(type, anchorSeed)].image
}

/** Color for one facade cell by the building's TYPE + the cell's label. HOUSES vary per building
 *  (anchorSeed) so a street isn't monotone: a roof tone (red / brown / gray), a wall shade, and a
 *  dark door tone — the door always darker than + different from the wall. Store / hospital stay
 *  deterministic so their identity (white+blue / green+white) reads at a glance. Pure. */
export function buildingCellColor(type: BuildingType, label: CellLabel, anchorSeed: number): string {
  const pal = BUILDING_PALETTES[type] ?? BUILDING_PALETTES.house
  const isHouse = type === 'house'
  if (label === 'roof' || label === 'roof_top') {
    if (!isHouse) return pal.roof
    return HOUSE_ROOFS[Math.floor(shadeNoise(anchorSeed + 0.3) * HOUSE_ROOFS.length) % HOUSE_ROOFS.length]
  }
  if (label === 'door') {
    if (!isHouse) return pal.door
    return HOUSE_DOORS[Math.floor(shadeNoise(anchorSeed + 0.7) * HOUSE_DOORS.length) % HOUSE_DOORS.length]
  }
  if (label === 'window') return pal.window
  // walls: a house takes its MATERIAL's colour range (wood browns / stone greys / brick reds / painted
  // plaster) varied per building; every other type keeps its identity tone.
  if (!isHouse) return pal.wall
  const matWalls = WALL_MATERIALS[buildingWallMaterial(type, anchorSeed)].walls
  return matWalls[Math.floor(shadeNoise(anchorSeed + 0.1) * matWalls.length) % matWalls.length]
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
  const tile = resolveTile(ASCII_TILESET, zone, label) // LOADS from the tileset, not hardcoded cellTile
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

// ── cave feature cells (all SEASONAL) — every KIND maps to an ASCII glyph+color AND
//    an emoji tint (see game/artStyle.ts): wall/rubble → 🪨, crystal → 💎, mushroom → 🍄.
// Non-blocking cave-floor DECOR: stalagmites + rubble + pebbles, tinted from the
// season's rock tone so they read as living rock against the cavern walls.
const CAVE_DECOR: ReadonlyArray<string> = ['ʌ', '∧', '∴', '·'] // stalagmite / slim / rubble / pebbles
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
  blocking: false,
  color: varyIntensity(tint, shadeNoise(col * 3.1 + row * 1.9)),
})

// A cave mushroom (damp seasons only) — a red/tan toadstool on the floor. Non-blocking.
const MUSHROOM_TONES = ['#d24a4a', '#c98a52', '#e0a0c0'] as const
const makeMushroom = (col: number, row: number): StageProp => ({
  col, row, type: 'mushroom', char: '♠', blocking: false,
  color: MUSHROOM_TONES[Math.abs(col * 3 + row * 5) % MUSHROOM_TONES.length],
})

// One blocking cave WALL cell — the rock boundary + internal formations. Tonal per
// season (pale ice-rock in winter, warm sandstone in desert, charred basalt in lava,
// mossy grey otherwise) so a cavern reads by season the way the forest does.
const makeCaveWall = (col: number, row: number, shades: readonly string[]): StageProp => ({
  col, row, type: 'rock',
  char: Math.abs(col * 5 + row * 3) % 7 === 0 ? '▒' : '▓',
  blocking: true,
  color: shades[Math.abs(col * 7 + row * 13) % shades.length],
})

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
    if (BUILT_FLOOR.has(ground[row][col]) || isRoadGround(ground[row][col])) return // keep paved floors + ROADS clean (no clover on streets)
    if (occupied.has(`${col},${row}`)) return // don't cover trees / buildings / decor
    if (Math.random() > density) return // breathing room
    fill.push(makeGroundDecor(zone, col, row))
  })
  props.push(...fill)
}

// Structural decor for temple / boss arena / village (readable single-glyph props).
const makePillar = (col: number, row: number, color = '#cbb68c'): StageProp => ({ col, row, type: 'pillar', char: '║', blocking: true, color })
const makeBrazier = (col: number, row: number): StageProp => ({ col, row, type: 'brazier', char: 'Φ', blocking: true, color: '#ff8a3a' })
const makeAltar = (col: number, row: number, color = '#ffe7a8'): StageProp => ({ col, row, type: 'altar', char: '‡', blocking: true, color })

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
const makeTorch = (col: number, row: number, color: string): StageProp => ({ col, row, type: 'torch', char: 'ϯ', blocking: false, color })

// A floor HAZARD — spike/pit trap tile. Non-blocking (you CAN step on it — it would deal
// damage in play), so hazards never disconnect the dungeon floor. Season-tinted.
const makeHazard = (col: number, row: number, char: string, color: string): StageProp => ({ col, row, type: 'hazard', char, blocking: false, color })

// The boss-door KEY — a collectible on the floor of a side room. Non-blocking.
const makeKey = (col: number, row: number): StageProp => ({ col, row, type: 'key', char: '⚷', blocking: false, color: '#ffd24a' })

// A gateway/threshold prop marking the (narratively locked) boss door — WALKABLE (label
// 'door'), so it reskins as 🚪 and the floor stays one connected region.
const makeGateway = (col: number, row: number, color: string): StageProp => ({ col, row, type: 'door', char: '∏', blocking: false, color, label: 'door' })
// The town-square centrepiece — ONE big fountain prop carrying its `footprint` (the basin spans
// footprint×footprint cells, centred on this cell). The render draws a single tiered fountain over
// the whole plaza; the other footprint cells are blocked directly in the collision grid (no prop), so
// it never reads as N clustered mini-wells.
const makeTownFountain = (col: number, row: number, footprint: number): StageProp => ({ col, row, type: 'fountain', char: '⊙', blocking: true, color: '#5fbce0', footprint })
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

// ── settlement archetype ─────────────────────────────────────────────
// Nature density by settlement — a town is leafy (lots of trees around the lots); a city is mostly
// paved. Towns lean green here per design.
const NATURE_MULT: Record<Settlement, number> = { town: 1.15, city: 0.4 }

// Hoisted function decls (not const arrows) so ARCHETYPES above can reference them.
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
      if (layout.roads[r][c]) ground[r][c] = 'road' // place the dark-gray ROAD tile (was brown path_stone); brown path_stone is freed for building bases / accents
    }
  }
  // 2. Stamp a building at each plot — each carries its TYPE + FACING. plot.row/plot.col are the
  //    MIN-ROW/MIN-COL (top-left) of the small `length × depth` footprint rect; placeBuilding blocks
  //    every footprint cell (a roof from above) EXCEPT the road-facing door cell (walkable).
  for (const plot of layout.plots) {
    // Roll for a wide door — only "unlocks" inside composeBuilding for a >=3-floor even-width building.
    // `seed` (the plot's stable position) drives the seeded peaked-vs-box roof roll for store/hospital, so a
    // town shows a deterministic MIX of peaked + box for them (composeBuilding bakes the choice into cells).
    const facade = composeBuilding({ type: plot.type, length: plot.length, wideDoor: Math.random() < 0.5, seed: plot.col + plot.row })
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
    // The tree's WHOLE 4-cell column — canopy included, not just the trunk base — must clear PAVED floors
    // (the stone plaza, driveways, roads). A tree planted on grass just south of the town square used to
    // rise its canopy UP over the paved plaza + fountain (the "trees weirdly in the centre, not on grass"
    // bug); checking every column cell keeps the whole tree off the square.
    if (!treeColumnClearsPaving(ground, col, row)) continue
    // …and off buildings — a door is walkable, so a trunk could otherwise rise into it from BELOW.
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
    const p = (sideDist < 5 ? 0.82 : edgeDist < 4 ? 0.66 : edgeDist < 9 ? 0.52 : 0.36) * natureMult
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
  // Lamp posts every ~6 cells along each street's frontage gaps (never on a road or building).
  for (const sr of streetRows) {
    const frontage = sr - 1
    for (let c = 5; c < cols - 4; c += 6) {
      if (decorFree(c, frontage)) placeProp(ctx, makeLamp(c, frontage))
    }
  }
}

/** Stamp the town SQUARE the planner reserved dead-centre BEFORE the houses: pave the whole block
 *  path_stone, then drop ONE big fountain (rarely a pond) at its centre. The fountain is a SINGLE
 *  prop spanning a central odd-sized basin (collision-blocked, you walk the paved ring around it) —
 *  not N clustered mini-structures. A pond fills the same central basin with water instead. */
function placeCentrepiece(ctx: ArchetypeContext, plaza: PlazaRect | null): void {
  if (!plaza) return
  const { cols, rows, ground, collision } = ctx
  const { c0, r0, size } = plaza
  // Pave the whole square as a walkable stone plaza (the ring you stroll around the fountain).
  for (let r = r0; r < r0 + size; r++)
    for (let c = c0; c < c0 + size; c++) if (inBounds(c, r, cols, rows)) ground[r][c] = 'path_stone'

  // The basin is a centred ODD block (a clean centre cell) leaving a ≥1-cell paved ring to walk.
  const basin = size >= 7 ? 5 : 3
  const bc = c0 + Math.floor((size - basin) / 2)
  const br = r0 + Math.floor((size - basin) / 2)
  const centreCol = bc + Math.floor(basin / 2)
  const centreRow = br + Math.floor(basin / 2)

  // The basin BLOCKS (you walk the paved ring around it). The plain roofed well + the flat water pond
  // are dropped — a real town square gets a real fountain (per the references), so the centrepiece is
  // ALWAYS ONE fountain, never a cluster of mini-wells.
  for (let r = br; r < br + basin; r++)
    for (let c = bc; c < bc + basin; c++) if (inBounds(c, r, cols, rows)) collision[r][c] = true
  // ONE fountain prop, centred, carrying the basin span so the render draws a SINGLE big fountain
  // over the whole basin (a wide basin + tiered column + animated jets), not N per-cell structures.
  ctx.props.push(makeTownFountain(centreCol, centreRow, basin))
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
 * The walkable DOOR cells — the building's way in — on the footprint's ROAD-FACING edge. Every OTHER
 * footprint cell blocks.
 *
 * The DRAWN door is `door.width` cells wide (2 on even frontages, #49). AXIS-ALIGNED (south/north) 2D
 * facades draw the door at its full width, so the walkable opening must be that wide too — otherwise a
 * 2-wide door has a walkable half and a blocked half and you "walk between two tiles but not the actual
 * entrance". The door is CENTRED, so its facade span [door.x, door.x+width) maps straight onto the edge's
 * frontage cells (rect.w == facade.length for south/north). ROTATED (east/west) 2D facades collapse the
 * door to a SINGLE edge cell (draw2DBuilding maps one road-edge column to the facade door, the rest to
 * wall), so the opening stays 1 cell there — matching what's drawn (no walk-through-wall).
 */
export function doorCells(facing: Facing, rect: FootRect, door: { x: number; width: number }): Cell[] {
  const midRow = rect.row + Math.floor(rect.h / 2)
  if (facing === 'east') return [{ col: rect.col + rect.w - 1, row: midRow }] // road right → right edge
  if (facing === 'west') return [{ col: rect.col, row: midRow }] // road left → left edge
  const row = facing === 'south' ? rect.row + rect.h - 1 : rect.row // road below/above → bottom/top edge
  const cells: Cell[] = []
  for (let i = 0; i < door.width; i++) cells.push({ col: rect.col + door.x + i, row })
  return cells
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
  const doors = doorCells(plot.facing, rect, facade.door)
  const isDoor = new Set(doors.map(d => `${d.col},${d.row}`))
  // Wall block height = the facade's BODY rows (rows carrying wall/window/door), mirroring
  // facadeToFootprint so a generated building matches a hand-placed one.
  const floors = Math.max(1, facade.cells.filter(r => r.some(k => k === 'wall' || k === 'window' || k === 'door')).length)
  for (let row = rect.row; row < rect.row + rect.h; row++) {
    for (let col = rect.col; col < rect.col + rect.w; col++) {
      ctx.ground[row][col] = 'path_stone' // brown stone BASE under the building — brown path_stone, freed from roads (§2b)
      stampFootprintCell(ctx, plot.type, col, row, isDoor.has(`${col},${row}`), rect.col, rect, floors)
    }
  }
  // `row` = the rect's BOTTOM row; `length`/`height` = the rect's grid span (cols×rows), so the
  // nature math + the iso/2D per-cell skip read the real small footprint regardless of facing.
  return { type: plot.type, col: rect.col, row: rect.row + rect.h - 1, length: rect.w, height: rect.h, depth: plot.depth, facing: plot.facing, doorCells: doors, facade }
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
  rect: FootRect,
  floors: number,
): void {
  const { props, collision, zone, cols, rows } = ctx
  if (!inBounds(col, row, cols, rows)) return
  // Per-cell tile model (2D+3D tileset): the PERIMETER becomes WALL (rises `floors` blocks in iso) so the
  // iso/2D render can build the box out of tiles; the road-facing cell stays the flat walkable DOOR; the
  // INTERIOR stays a flat ROOF cell. Collision is UNCHANGED (whole footprint blocks except the door) — the
  // design's walkable-floor interior is a separate, later step. Was: one filled roof-rect.
  const perimeter = col === rect.col || col === rect.col + rect.w - 1 || row === rect.row || row === rect.row + rect.h - 1
  const label: CellLabel = isDoor ? 'door' : perimeter ? 'wall' : 'roof'
  const height = label === 'wall' ? floors : 0
  const color = buildingCellColor(type, label, anchorCol)
  const cell = makeBuildingCell(zone, col, row, label, color)
  props.push({ ...cell, blocking: !isDoor, height, buildingType: type, edge: footprintEdgeClass(col, row, rect) })
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

/**
 * A tree's WHOLE vertical column (trunk base → canopy top) must stand on UNPAVED ground — not just its
 * trunk base. `treeFits` only guards collision; this guards the GROUND. A tree planted on grass just
 * south of the town square used to rise its canopy up over the paved plaza + fountain (the "trees weirdly
 * in the centre, not on grass, collision mixing with the fountain" bug) because only the anchor cell was
 * checked for paving. Rejecting a column with ANY paved cell keeps the whole tree off the square, roads,
 * and driveways. Pure — reads `ground` only.
 */
export function treeColumnClearsPaving(ground: string[][], col: number, baseRow: number): boolean {
  for (let h = 0; h < TREE_HEIGHT; h++) {
    if (BUILT_FLOOR.has(ground[baseRow - h]?.[col])) return false
  }
  return true
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

// ── temple archetype (a real SEASONAL DUNGEON, Zelda/Tomb-of-Sargeras style) ──
// A room-and-corridor dungeon: distinct ROOMS wired into a connected network by
// narrow CORRIDORS, a south ENTRANCE hall (spawn), a grand north BOSS chamber with a
// central ALTAR + pillar ring, pillared side halls, wall torches, seasonal hazards
// (spike traps + water/ice/lava/sand-trap pools), and a narratively-locked boss
// gateway + key. Flood-fill repair guarantees ONE connected floor every seed.
// The SEASON drives the whole look: floor + wall tone, hazard terrain, torch/altar
// glow. Every feature KIND maps to an ASCII glyph+colour AND an emoji tint (temple_wall
// → 🧱, pillar → 🏛️, altar → 🗿, torch → 🔥, hazard → 🔺, key → 🗝️; see game/artStyle.ts).
interface TemplePalette {
  /** main paved dungeon floor tile. */
  floor: string
  /** checker-inlay accent tile (the ornate tiled look). */
  accent: string
  /** tonal wall colours — the stone boundary + inner walls, varied per cell (disjoint per season). */
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
const TEMPLE_PALETTES: Readonly<Record<ZoneId, TemplePalette>> = {
  spring: { floor: 'temple_floor', accent: 'cave_moss', wall: ['#5b6a52', '#53614b', '#4c5945', '#616e58'], pillar: '#b9c6a6', torch: '#ffb24a', altar: '#d8f0b0', pool: 'water', poolBlocks: true, spikeChar: '▲', spikeColor: '#6a9f4a' },
  summer: { floor: 'ancient_stone', accent: 'marble', wall: ['#7a736a', '#6f6860', '#847c72', '#655f57'], pillar: '#e6ddc8', torch: '#ff9a3a', altar: '#ffe7a8', pool: 'water', poolBlocks: true, spikeChar: '▲', spikeColor: '#c0402a' },
  autumn: { floor: 'ancient_stone', accent: 'gold_tile', wall: ['#6a5540', '#5f4c3a', '#74604a', '#544433'], pillar: '#d8c090', torch: '#ff8a3a', altar: '#ffcf8a', pool: 'water', poolBlocks: true, spikeChar: '▲', spikeColor: '#b5602a' },
  winter: { floor: 'frost', accent: 'ice', wall: ['#5a6a7a', '#647486', '#516070', '#6d7d8e'], pillar: '#bcd6e6', torch: '#8fd0ff', altar: '#dff0ff', pool: 'ice_water', poolBlocks: false, spikeChar: '❆', spikeColor: '#bfe8f5' },
  desert: { floor: 'sandstone', accent: 'sand', wall: ['#b08a52', '#c2975c', '#9c7a46', '#b89060'], pillar: '#e2c88a', torch: '#ffc24a', altar: '#ffe6a0', pool: 'sand_trap', poolBlocks: true, spikeChar: '▲', spikeColor: '#c99a52' },
  beach: { floor: 'sandstone', accent: 'temple_floor', wall: ['#9a8a6a', '#a89a78', '#8a7c5e', '#b0a284'], pillar: '#d8c9a4', torch: '#ffb86a', altar: '#ffe6c0', pool: 'water', poolBlocks: true, spikeChar: '▲', spikeColor: '#a8926a' },
  lava: { floor: 'basalt', accent: 'obsidian', wall: ['#2e2824', '#3a322c', '#241f1c', '#332b26'], pillar: '#8a6a52', torch: '#ff5a1f', altar: '#ff9a5a', pool: 'lava', poolBlocks: true, spikeChar: '▲', spikeColor: '#ff6a2a' },
}

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

interface CavePalette {
  /** base cave-floor ground tile (a GROUND_COLORS key that renders in the live engine). */
  floor: string
  /** patchy floor accent (moss / fallen leaves / dune / ash). */
  accent: string
  /** fraction of floor cells that take the accent — how mossy/leafy the cave reads. */
  accentChance: number
  /** tonal wall colours — the rock boundary + internal formations, varied per cell. */
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
const CAVE_PALETTES: Readonly<Record<ZoneId, CavePalette>> = {
  spring: { floor: 'cave_floor', accent: 'cave_moss', accentChance: 0.14, wall: ['#4c4a44', '#565248', '#42403a', '#514d46'], pool: 'water', poolBlocks: true, crystal: '#e79ec8', mushrooms: true },
  summer: { floor: 'cave_floor', accent: 'cave_moss', accentChance: 0.24, wall: ['#46493f', '#3f463a', '#4e5145', '#3a3f36'], pool: 'water', poolBlocks: true, crystal: '#5fd0e0', mushrooms: true },
  autumn: { floor: 'cave_floor', accent: 'autumn_leaves', accentChance: 0.16, wall: ['#5a4a38', '#6a5540', '#4e4030', '#5f4c3a'], pool: 'water', poolBlocks: true, crystal: '#e0a020', mushrooms: true },
  winter: { floor: 'frost', accent: 'ice', accentChance: 0.2, wall: ['#5a6a7a', '#647486', '#516070', '#6d7d8e'], pool: 'ice_water', poolBlocks: false, crystal: '#bfe8f5', mushrooms: false },
  desert: { floor: 'sand', accent: 'sandstone', accentChance: 0.2, wall: ['#b08a52', '#c2975c', '#9c7a46', '#b89060'], pool: 'water', poolBlocks: true, crystal: '#e8c060', mushrooms: false },
  beach: { floor: 'sand', accent: 'cave_floor', accentChance: 0.16, wall: ['#9a8a6a', '#a89a78', '#8a7c5e', '#b0a284'], pool: 'water', poolBlocks: true, crystal: '#7fd0c0', mushrooms: false },
  lava: { floor: 'basalt', accent: 'ash', accentChance: 0.22, wall: ['#2e2824', '#3a322c', '#241f1c', '#332b26'], pool: 'lava', poolBlocks: true, crystal: '#ff7a30', mushrooms: false },
}

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
    footprint: a.footprint,
    // Keep the curated catalog skin the live grid stamps (applyStageToGrid) so a SAVED generated map
    // reloads with the same palette tiles — same per-zone/role dispatch, so the two paths never diverge.
    tileOverride: stagePropTileOverride(stage.zone, a.type),
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
