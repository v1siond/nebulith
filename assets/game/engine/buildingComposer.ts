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
  /** Caller's roll to ALLOW a 2-wide centred door. Only takes effect on a >=3-floor, even-width
   *  building (the possibility "unlocks" at 3 floors); ignored otherwise. */
  wideDoor?: boolean
  /** A STABLE per-building seed (e.g. its col/row). Drives the seeded peaked-vs-box roof roll for the
   *  types that can go either way (store/hospital) — so a town shows a deterministic MIX. Absent → the
   *  optional-peaked types default to a box roof (back-compat). */
  seed?: number
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
  // Hospitals are big, so their entrance is always at least 2×2 (2 wide × the 2-tall DOOR_HEIGHT) — a
  // wide civic doorway, not a single-cell house door.
  hospital: { baseLength: 6, floors: 2, doorWidth: 2, depth: 4 },
  cathedral: { baseLength: 7, floors: 3, doorWidth: 3, depth: 5 },
  temple: { baseLength: 8, floors: 3, doorWidth: 3, depth: 4 }, // tall, wide, colonnaded landmark
  castle: { baseLength: 12, floors: 3, doorWidth: 4, depth: 6 },
}

// Houses + the grand temples/cathedrals ALWAYS get a PEAKED (triangle/gable) roof. Store + hospital
// can go EITHER way — a peaked or a box roof, rolled per building on a seed (see peakedFromSeed) so a
// town shows a MIX. Everything else stays box. Drives the roof-cell shape below.
const PEAKED_ROOF: ReadonlySet<BuildingType> = new Set<BuildingType>(['house', 'temple', 'cathedral'])
const OPTIONAL_PEAKED_ROOF: ReadonlySet<BuildingType> = new Set<BuildingType>(['store', 'hospital'])

// A deterministic [0,1) value from a seed — the SAME hash the stage generator's shadeNoise uses, so the
// peaked-vs-box roll is stable per building (keyed on a stable per-building seed) and reproducible in tests.
const seededUnit = (seed: number): number => {
  const h = Math.abs(Math.sin(seed * 12.9898) * 43758.5453)
  return h - Math.floor(h)
}

/** Whether an optional-peaked type (store/hospital) rolls a PEAKED roof for this building. Seeded +
 *  deterministic, so the SAME building always decides the same way — and since the composed `cells` carry
 *  the result (empty corners ⇒ peaked), the 2D and iso renders read the SAME choice. No seed ⇒ box. */
function peakedFromSeed(type: BuildingType, seed: number | undefined): boolean {
  if (!OPTIONAL_PEAKED_ROOF.has(type) || seed === undefined) return false
  return seededUnit(seed + 0.137) < 0.5
}

/** One roof cell: a flat roof fills the row; a peaked roof narrows toward the apex above a
 *  full-width eave (the bottom roof row), leaving empty corners → a triangle silhouette. */
function roofCellKind(col: number, row: number, apexX: number, peaked: boolean): BuildingCellKind {
  if (!peaked || row === ROOF_ROWS - 1) return 'roof'
  return Math.abs(col - apexX) <= row ? 'roof' : 'empty'
}

/** The window COLUMNS for a facade of the given width: symmetric about the centre, each kept ≥1 wall from
 *  the next AND from its mirror (never a glass grid, never a doubled centre), and NEVER empty for a real
 *  facade — a narrow wall still gets one window (a real house always has windows). Pure + tested; the exact
 *  count/spacing AESTHETIC is tuned against the real render later. */
export function windowColumns(length: number): number[] {
  const cols = new Set<number>()
  for (let c = 1; length - 1 - 2 * c >= 2; c += 2) { cols.add(c); cols.add(length - 1 - c) } // symmetric spaced pairs
  if (cols.size === 0 && length >= 3) cols.add(Math.floor(length / 2)) // too narrow for a pair → one window
  return [...cols].sort((a, z) => a - z)
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
  // A wide (2-cell) centred door only UNLOCKS for a tall building (>=3 floors) on an EVEN frontage, and
  // even then it's the caller's roll (spec.wideDoor) — a possibility, not automatic. Short buildings and
  // odd frontages keep a 1-cell door. Ceremonial types keep their authored wide doorway. Entrance +
  // driveway derive from this door rect (doorCells), so a 1-wide door stays aligned either way.
  const centredDoor = ts.doorWidth === 1
  const wideDoorUnlocked = floors >= 3 && length % 2 === 0 && !!spec.wideDoor
  const doorWidth = centredDoor
    ? (wideDoorUnlocked ? 2 : 1)
    : Math.min(Math.max(MIN_DOOR_WIDTH, ts.doorWidth), Math.max(1, length - 1)) // ≥1 wall column
  const doorHeight = DOOR_HEIGHT

  // Roof rows (peaked → narrowing triangle, flat → full-width squared) then the wall body.
  const apexX = Math.floor(length / 2)
  const peaked = PEAKED_ROOF.has(type) || peakedFromSeed(type, spec.seed)
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
    // ONE window ROW per STOREY (a storey = FLOOR_BODY body rows; the top body row of each storey carries the
    // windows). windowColumns gives symmetric, spaced, never-empty columns — so EVERY house has windows on
    // every floor (fixes the no-window regression), never a glass grid. Since height ≥ MIN_HEIGHT there is
    // always at least the row at ROOF_ROWS (offset 0), so a house can never end up windowless.
    if ((row - ROOF_ROWS) % FLOOR_BODY !== 0) continue
    for (const col of windowColumns(length)) cells[row][col] = 'window'
  }

  // Door: doorWidth x doorHeight, planted at the bottom and CENTRED on the walkable entrance COLUMN —
  // floor(length/2), the exact cell doorCellFor (the collision door + the 2D entrance chevron + the iso
  // door) sits on, and where the driveway crosses. Centring the door SPAN on that column guarantees the
  // drawn door always COVERS the walkable cell — the old `floor((length - doorWidth)/2)` centred the span
  // but left a 1-wide door on an EVEN frontage one column LEFT of floor(length/2), so the drawn door + its
  // driveway landed off the entrance the collision opened (the reported "door not at the entrance, free
  // collision doesn't match" bug). Symmetric parities (even/even, odd/odd, the 2-wide centred door) are
  // unchanged; only the mismatched 1-wide-even case shifts one cell right onto its walkable entrance.
  // Ceremonial (wide) doors keep ≥1 wall column each side.
  const doorX = Math.max(centredDoor ? 0 : 1, Math.floor(length / 2) - Math.floor(doorWidth / 2))
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
