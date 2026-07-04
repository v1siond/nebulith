/**
 * Building composer for Nebulith stages.
 *
 * Produces a legal multi-cell building FACADE from a small spec, enforcing the
 * locked architecture rules (see nebulith/docs/GENERATION-SPEC.md):
 *   - height >= 4 cells: >= 3 body + 1 roof; +3 cells per extra floor
 *   - length >= 8 cells
 *   - door 2 cells tall, CENTRED + symmetric with the windows (2 cols wide on even facades, 1 on odd)
 *
 * Pure logic (no rendering / no grid mutation) so it can be unit-tested and
 * reused by the stage generator and the editor preview.
 */
import { CellLabel } from './cellLabels'

export type BuildingCellKind = 'wall' | 'window' | 'door' | 'roof' | 'empty'

export type BuildingType =
  | 'house'
  | 'big-house'
  | 'store'
  | 'hospital'
  | 'cathedral'
  | 'temple'
  | 'castle'

export interface BuildingSpec {
  type?: BuildingType
  /** Number of floors; each floor is 3 body cells. Min 1. */
  floors?: number
  /** Optional length override (still clamped to the type/min minimum). */
  length?: number
}

export interface ComposedBuilding {
  type: BuildingType
  length: number
  height: number
  /** GROUND footprint depth — cells perpendicular to the facade (away from the road). Small and
   *  roughly square-ish; DECOUPLED from `height` (the facade's vertical elevation, iso-only). */
  depth: number
  /** Door rectangle in facade coords. y is the top row of the door. */
  door: { x: number; y: number; width: number; height: number }
  /** The single apex roof cell (top row, centered) — the ONE walkable roof tile
   *  (maps to `roof_top`, mirroring a tree's walkable `tree_leaf_top`). */
  roofTop: { x: number; y: number }
  /** Facade grid, cells[row][col]; row 0 is the top (roof), last row is ground. */
  cells: BuildingCellKind[][]
}

// Houses scale down to 2-wide cottages (and up to n blocks); other types keep their type width.
const MIN_LENGTH = 2
const MIN_BODY_ROWS = 3
const ROOF_ROWS = 2 // two roof rows so a peaked (triangle) roof reads vs a flat (squared) one
const MIN_HEIGHT = MIN_BODY_ROWS + ROOF_ROWS // 5
const FLOOR_BODY = 3 // body cells added per floor
const MIN_DOOR_WIDTH = 1 // a door may be a single cell — it must MATCH the 1-cell walkable entrance
const DOOR_HEIGHT = 2 // doors stay 2 cells tall (a doorway, not a window) regardless of width

interface TypeSpec {
  baseLength: number
  floors: number
  doorWidth: number
  /** GROUND depth — perpendicular footprint extent (away from the road). Small / square-ish,
   *  NOT the facade height. House 3, big-house 4, store 4, hospital 4, cathedral/temple 5, castle 6. */
  depth: number
}

// Per-type sizing (GENERATION-SPEC §2 — starting values, tune visually later).
// House/store/hospital/big-house get a SINGLE-cell door so the drawn facade door lines up
// exactly with the 1-cell walkable entrance + path_stone driveway (see doorX below). Grand
// structures (cathedral/temple/castle) keep a wide ceremonial doorway.
const TYPE_SPECS: Record<BuildingType, TypeSpec> = {
  house: { baseLength: 4, floors: 1, doorWidth: 1, depth: 3 },
  'big-house': { baseLength: 6, floors: 2, doorWidth: 1, depth: 4 },
  store: { baseLength: 5, floors: 1, doorWidth: 1, depth: 4 },
  hospital: { baseLength: 6, floors: 2, doorWidth: 1, depth: 4 },
  cathedral: { baseLength: 7, floors: 3, doorWidth: 3, depth: 5 },
  temple: { baseLength: 8, floors: 3, doorWidth: 3, depth: 4 }, // tall, wide, colonnaded landmark
  castle: { baseLength: 12, floors: 3, doorWidth: 4, depth: 6 },
}

// Houses (and grand temples/cathedrals) get a PEAKED triangle roof; everything else a FLAT
// squared roof. Drives the roof-cell shape below.
const PEAKED_ROOF: ReadonlySet<BuildingType> = new Set<BuildingType>(['house', 'temple', 'cathedral'])

/** One roof cell: a flat roof fills the row; a peaked roof narrows toward the apex above a
 *  full-width eave (the bottom roof row), leaving empty corners → a triangle silhouette. */
function roofCellKind(col: number, row: number, apexX: number, peaked: boolean): BuildingCellKind {
  if (!peaked || row === ROOF_ROWS - 1) return 'roof'
  return Math.abs(col - apexX) <= row ? 'roof' : 'empty'
}

export function composeBuilding(spec: BuildingSpec = {}): ComposedBuilding {
  const type = spec.type ?? 'house'
  const ts = TYPE_SPECS[type] ?? TYPE_SPECS.house

  const floors = Math.max(1, Math.floor(spec.floors ?? ts.floors))
  const length = Math.max(MIN_LENGTH, spec.length ?? ts.baseLength)
  // Cap the roof-top at the grass base's WIDTH (the only base dimension DRAWN in 2D): a building never
  // towers over its own footprint — total facade height <= length. Floors add height only until they hit
  // that width cap (a tall building needs a WIDE base), and never below the structural minimum (3 body +
  // 2 roof). This is the "height of the building — the top roof — capped at the size of the grass base
  // in 2D" rule: a 6-wide hospital caps at 6 (was 8), a 7-wide cathedral at 7 (was 11).
  const height = Math.max(MIN_HEIGHT, Math.min(floors * FLOOR_BODY + ROOF_ROWS, length))
  // A 1-cell door can't sit CENTRED on an EVEN facade (no middle column), which reads asymmetric
  // against the mirrored windows (#49). For those door types widen to the two middle columns (2 wide)
  // on even widths and keep a 1-cell centre column on odd — always centred, always symmetric. The
  // widened door still covers the walkable entrance at floor(length/2), so #40 stays fixed. Ceremonial
  // types keep their authored wide doorway.
  const centredDoor = ts.doorWidth === 1
  const doorWidth = centredDoor
    ? (length % 2 === 0 ? 2 : 1)
    : Math.min(Math.max(MIN_DOOR_WIDTH, ts.doorWidth), Math.max(1, length - 1)) // ≥1 wall column
  const doorHeight = DOOR_HEIGHT

  // Roof rows (peaked → narrowing triangle, flat → full-width squared) then the wall body.
  const apexX = Math.floor(length / 2)
  const peaked = PEAKED_ROOF.has(type)
  const cells: BuildingCellKind[][] = []
  for (let row = 0; row < height; row++) {
    const cellRow: BuildingCellKind[] = []
    for (let col = 0; col < length; col++) {
      cellRow.push(row >= ROOF_ROWS ? 'wall' : roofCellKind(col, row, apexX, peaked))
    }
    cells.push(cellRow)
  }

  // Windows on body rows above the door band — placed in MIRRORED pairs around the centre so the
  // facade reads symmetric (never bunched to one side), for any width. A TEMPLE instead reads as a
  // COLONNADE: every other column is an open bay (a 'window' gap) between solid wall pillars, so the
  // grand facade is a row of columns — distinct from a house's punched windows.
  const colonnade = type === 'temple'
  for (let row = ROOF_ROWS; row < height - doorHeight; row++) {
    if (colonnade) {
      for (let col = 1; col < length; col += 2) cells[row][col] = 'window' // bays between pillars
      continue
    }
    for (let col = 1; col < length / 2; col += 2) {
      cells[row][col] = 'window'
      cells[row][length - 1 - col] = 'window' // mirror
    }
  }

  // Door: doorWidth x doorHeight, planted at the bottom and CENTRED — equal wall margins either side
  // (2*doorX + doorWidth == length) so it reads symmetric with the mirrored windows. That span always
  // contains floor(length/2), the column stageGenerator's walkable doorCell + driveway sit on, so the
  // drawn door still lines up with the entrance for any length. Ceremonial (wide) doors keep ≥1 wall
  // column each side.
  const doorX = Math.max(centredDoor ? 0 : 1, Math.floor((length - doorWidth) / 2))
  const doorY = height - doorHeight
  for (let row = doorY; row < height; row++) {
    for (let col = doorX; col < doorX + doorWidth; col++) {
      cells[row][col] = 'door'
    }
  }

  return {
    type,
    length,
    height,
    depth: ts.depth,
    door: { x: doorX, y: doorY, width: doorWidth, height: doorHeight },
    roofTop: { x: Math.floor(length / 2), y: 0 },
    cells,
  }
}

// ── facade-cell → CellLabel mapping (the keystone, building side) ──────────
// Each facade cell carries a descriptive part LABEL — the same per-cell model
// trees use — so a building occupies (and labels) ALL the cells its art covers,
// and per-label collision (cellLabels.isWalkable) decides what blocks. The ONE
// walkable roof tile is the apex (top-center); every other roof cell blocks,
// mirroring a tree's single walkable `tree_leaf_top` above blocking leaves.
//
// Dispatch map, not an if/else chain (Open/Closed: add a kind = add a row). The
// apex roof override is positional, so it is applied by `facadeLabel` before the
// table — the table holds the kind→label default.
const KIND_TO_LABEL: Readonly<Record<Exclude<BuildingCellKind, 'empty'>, CellLabel>> = {
  roof: 'roof',
  wall: 'wall',
  door: 'door',
  window: 'window',
}

/** True for the single apex roof cell (top-center) — the lone walkable roof_top. */
const isRoofTop = (b: ComposedBuilding, col: number, row: number): boolean =>
  col === b.roofTop.x && row === b.roofTop.y

/**
 * The CellLabel for one facade cell. `'empty'` cells have no part and return
 * `null` (the caller emits nothing for them). The apex roof tile is `roof_top`
 * (walkable); all other cells defer to the kind→label table.
 */
export function facadeLabel(b: ComposedBuilding, col: number, row: number): CellLabel | null {
  const kind = b.cells[row][col]
  if (kind === 'empty') return null
  if (kind === 'roof' && isRoofTop(b, col, row)) return 'roof_top'
  return KIND_TO_LABEL[kind]
}

/**
 * The full facade as a CellLabel grid (`labels[row][col]`), one label per cell
 * (or `null` for an empty cell). Exactly one cell is `roof_top` — the apex.
 * Pure: derives entirely from the composed facade, no mutation.
 */
export function facadeLabels(b: ComposedBuilding): (CellLabel | null)[][] {
  return b.cells.map((rowCells, row) => rowCells.map((_, col) => facadeLabel(b, col, row)))
}

/** One 90° CLOCKWISE turn of a cell grid: R×C → C×R, result[i][j] = M[R-1-j][i]. Pure. */
function rotate90CW<T>(cells: T[][]): T[][] {
  const rows = cells.length
  const cols = cells[0]?.length ?? 0
  const result: T[][] = []
  for (let c = 0; c < cols; c++) {
    const out: T[] = []
    for (let r = rows - 1; r >= 0; r--) out.push(cells[r][c])
    result.push(out)
  }
  return result
}

/**
 * Rotate a facade cell grid by `rotations` × 90° CLOCKWISE (negatives + values ≥4 wrap).
 * A facade has its door on the BOTTOM edge, so the four turn counts land the door on the
 * four road-facing sides — 0 → bottom (south), 1 → left (west), 2 → top (north), 3 → right
 * (east) — letting the 2D view point a building's door at its street. Pure, non-mutating.
 */
export function rotateCells<T>(cells: T[][], rotations: number): T[][] {
  const turns = ((rotations % 4) + 4) % 4
  let out: T[][] = cells.map(row => [...row])
  for (let t = 0; t < turns; t++) out = rotate90CW(out)
  return out
}
