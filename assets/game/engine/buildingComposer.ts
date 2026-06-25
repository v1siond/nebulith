/**
 * Building composer for Nebulith stages.
 *
 * Produces a legal multi-cell building FACADE from a small spec, enforcing the
 * locked architecture rules (see nebulith/docs/GENERATION-SPEC.md):
 *   - height >= 4 cells: >= 3 body + 1 roof; +3 cells per extra floor
 *   - length >= 8 cells
 *   - door >= 2x2 cells, at the bottom of the facade
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
  /** Door rectangle in facade coords. y is the top row of the door. */
  door: { x: number; y: number; width: number; height: number }
  /** The single apex roof cell (top row, centered) — the ONE walkable roof tile
   *  (maps to `roof_top`, mirroring a tree's walkable `tree_leaf_top`). */
  roofTop: { x: number; y: number }
  /** Facade grid, cells[row][col]; row 0 is the top (roof), last row is ground. */
  cells: BuildingCellKind[][]
}

// Minimums — buildings read better at HALF the old width, so a town isn't a wall of facades.
const MIN_LENGTH = 4
const MIN_BODY_ROWS = 3
const ROOF_ROWS = 2 // two roof rows so a peaked (triangle) roof reads vs a flat (squared) one
const MIN_HEIGHT = MIN_BODY_ROWS + ROOF_ROWS // 5
const FLOOR_BODY = 3 // body cells added per floor
const MIN_DOOR = 2

interface TypeSpec {
  baseLength: number
  floors: number
  doorWidth: number
}

// Per-type sizing (GENERATION-SPEC §2 — starting values, tune visually later).
const TYPE_SPECS: Record<BuildingType, TypeSpec> = {
  house: { baseLength: 4, floors: 1, doorWidth: 2 },
  'big-house': { baseLength: 6, floors: 2, doorWidth: 2 },
  store: { baseLength: 5, floors: 1, doorWidth: 2 },
  hospital: { baseLength: 6, floors: 2, doorWidth: 2 },
  cathedral: { baseLength: 7, floors: 3, doorWidth: 3 },
  temple: { baseLength: 8, floors: 2, doorWidth: 3 },
  castle: { baseLength: 12, floors: 3, doorWidth: 4 },
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
  const height = Math.max(MIN_HEIGHT, floors * FLOOR_BODY + ROOF_ROWS)
  const doorWidth = Math.max(MIN_DOOR, ts.doorWidth)
  const doorHeight = MIN_DOOR

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

  // Windows on body rows above the door band, skipping the edges.
  for (let row = ROOF_ROWS; row < height - doorHeight; row++) {
    for (let col = 1; col < length - 1; col += 2) {
      cells[row][col] = 'window'
    }
  }

  // Door: doorWidth x doorHeight, centered, planted at the bottom.
  const doorX = Math.max(1, Math.floor((length - doorWidth) / 2))
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
