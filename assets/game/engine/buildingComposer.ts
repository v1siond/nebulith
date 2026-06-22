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

export type BuildingCellKind = 'wall' | 'window' | 'door' | 'roof' | 'empty'

export type BuildingType =
  | 'house'
  | 'big-house'
  | 'store'
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
  /** Facade grid, cells[row][col]; row 0 is the top (roof), last row is ground. */
  cells: BuildingCellKind[][]
}

// Locked minimums (GENERATION-SPEC §1)
const MIN_LENGTH = 8
const MIN_BODY_ROWS = 3
const ROOF_ROWS = 1
const MIN_HEIGHT = MIN_BODY_ROWS + ROOF_ROWS // 4
const FLOOR_BODY = 3 // body cells added per floor
const MIN_DOOR = 2

interface TypeSpec {
  baseLength: number
  floors: number
  doorWidth: number
}

// Per-type sizing (GENERATION-SPEC §2 — starting values, tune visually later).
const TYPE_SPECS: Record<BuildingType, TypeSpec> = {
  house: { baseLength: 8, floors: 1, doorWidth: 2 },
  'big-house': { baseLength: 12, floors: 2, doorWidth: 2 },
  store: { baseLength: 10, floors: 1, doorWidth: 3 },
  cathedral: { baseLength: 14, floors: 3, doorWidth: 3 },
  temple: { baseLength: 16, floors: 2, doorWidth: 4 },
  castle: { baseLength: 24, floors: 3, doorWidth: 4 },
}

export function composeBuilding(spec: BuildingSpec = {}): ComposedBuilding {
  const type = spec.type ?? 'house'
  const ts = TYPE_SPECS[type] ?? TYPE_SPECS.house

  const floors = Math.max(1, Math.floor(spec.floors ?? ts.floors))
  const length = Math.max(MIN_LENGTH, spec.length ?? ts.baseLength)
  const height = Math.max(MIN_HEIGHT, floors * FLOOR_BODY + ROOF_ROWS)
  const doorWidth = Math.max(MIN_DOOR, ts.doorWidth)
  const doorHeight = MIN_DOOR

  // Start every cell as roof (top rows) or wall (body rows).
  const cells: BuildingCellKind[][] = []
  for (let row = 0; row < height; row++) {
    const cols: BuildingCellKind[] = []
    for (let col = 0; col < length; col++) {
      cols.push(row < ROOF_ROWS ? 'roof' : 'wall')
    }
    cells.push(cols)
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
    cells,
  }
}
