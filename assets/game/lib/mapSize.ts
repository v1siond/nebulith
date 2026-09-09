/**
 * HOW BIG A MAP CAN BE — which is to say, as big as you type.
 *
 * Alexander, 2026-09-09: *"this shouldn't be a limitation, our generators should be versatile enough and
 * random enough to do a forest as big as what I put"* and *"the previous limits where caused by poor
 * optimization."*
 *
 * So there is no maximum here. There were two of them before, and both were wrong for the same reason —
 * each turned a performance characteristic into a rule about what the user is allowed to want:
 *
 *  · The GENERATOR's served range (`rows 24–35` for Meadow) was used as a cap, so a requested 40 silently
 *    became 35. It is now only what the random roll picks from.
 *  · An engine cap of 100 per side rejected 400 × 240 outright — and because the inputs validated against
 *    it, the panel could not even count the cells, printing `400 × 240 = — cells`.
 *
 * What remains is a structural FLOOR of one cell, because a grid with no cells is not a grid. It is stated
 * rather than silently applied: nothing here may quietly change a number the user typed.
 *
 * A very large map does render slowly today. That is a rendering problem to fix in the renderer — the cell
 * walk is per-frame and unwindowed — not a reason to refuse the map.
 */

/** The open map's size, as the panel shows it. */
export interface MapSize {
  cols: number
  rows: number
  cellSize: number
}

/** A grid must have at least one cell, and a cell at least one pixel. The only structural limits. */
export const MAP_SIZE_MIN = 1
export const CELL_SIZE_MIN = 1

/** True when `n` is a real number of at least `lo`. A half-typed input (NaN) is not. */
export function atLeast(n: number, lo: number): boolean {
  return Number.isFinite(n) && n >= lo
}

/** Is every number of this size one the engine can actually build? */
export function mapSizeValid(size: MapSize): boolean {
  return atLeast(size.cols, MAP_SIZE_MIN) && atLeast(size.rows, MAP_SIZE_MIN) && atLeast(size.cellSize, CELL_SIZE_MIN)
}

/** How many cells a size describes — the number the panel prints. */
export function cellCount(size: MapSize): number | null {
  if (!atLeast(size.cols, MAP_SIZE_MIN) || !atLeast(size.rows, MAP_SIZE_MIN)) return null
  return Math.floor(size.cols) * Math.floor(size.rows)
}

const floor = (n: number, lo: number, whenUnset: number): number =>
  Number.isFinite(n) ? Math.max(Math.floor(n), lo) : whenUnset

/**
 * Hold a requested size above the structural floor, and nowhere else.
 *
 * The number you typed wins. `fallback` is used only for a number that is not a number at all — a cleared
 * or half-typed input — so that building with an empty field keeps the map's current value instead of
 * collapsing it to 1.
 */
export function clampMapSize(size: MapSize, fallback: MapSize): MapSize {
  return {
    cols: floor(size.cols, MAP_SIZE_MIN, fallback.cols),
    rows: floor(size.rows, MAP_SIZE_MIN, fallback.rows),
    cellSize: floor(size.cellSize, CELL_SIZE_MIN, fallback.cellSize),
  }
}
