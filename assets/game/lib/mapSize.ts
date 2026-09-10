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
 * A CEILING is back, at his word — Alexander, 2026-09-10: *"let's limit maps to 100x100 for now."* Note the
 * "for now": this is a deliberate, temporary bound while the renderer catches up, not a return to the old
 * rule. It is stated in ONE place so lifting it is a one-line change, and the panel reports it rather than
 * silently rewriting what you typed.
 */

/** The open map's size, as the panel shows it. */
export interface MapSize {
  cols: number
  rows: number
  cellSize: number
}

/** A grid must have at least one cell, and a cell at least one pixel. The structural limits. */
export const MAP_SIZE_MIN = 1
export const CELL_SIZE_MIN = 1

/** The largest map either side may be, for now (Alexander, 2026-09-10). Temporary: raise or drop this one
 *  constant when the renderer no longer cares. */
export const MAP_SIZE_MAX = 100

/** True when `n` is a real number of at least `lo`. A half-typed input (NaN) is not. */
export function atLeast(n: number, lo: number): boolean {
  return Number.isFinite(n) && n >= lo
}

/** True when `n` is a real number within [lo, hi]. */
export function within(n: number, lo: number, hi: number): boolean {
  return Number.isFinite(n) && n >= lo && n <= hi
}

/** Is every number of this size one the engine can actually build? */
export function mapSizeValid(size: MapSize): boolean {
  return (
    within(size.cols, MAP_SIZE_MIN, MAP_SIZE_MAX) &&
    within(size.rows, MAP_SIZE_MIN, MAP_SIZE_MAX) &&
    atLeast(size.cellSize, CELL_SIZE_MIN)
  )
}

/** Why a size is not buildable, in the panel's own words — or null when it is fine. Said out loud rather
 *  than applied silently: a number quietly rewritten under you is the bug this file was created for. */
export function mapSizeProblem(size: MapSize): string | null {
  for (const [axis, n] of [['Columns', size.cols], ['Rows', size.rows]] as const) {
    if (!Number.isFinite(n)) continue
    if (n < MAP_SIZE_MIN) return 'A map needs at least one cell on each side.'
    if (n > MAP_SIZE_MAX) return `${axis} is ${Math.floor(n)} — maps are limited to ${MAP_SIZE_MAX} cells per side for now.`
  }
  return null
}

/** How many cells a size describes — the number the panel prints. */
export function cellCount(size: MapSize): number | null {
  if (!atLeast(size.cols, MAP_SIZE_MIN) || !atLeast(size.rows, MAP_SIZE_MIN)) return null
  return Math.floor(size.cols) * Math.floor(size.rows)
}

const floor = (n: number, lo: number, whenUnset: number): number =>
  Number.isFinite(n) ? Math.max(Math.floor(n), lo) : whenUnset

const bound = (n: number, lo: number, hi: number, whenUnset: number): number =>
  Number.isFinite(n) ? Math.min(Math.max(Math.floor(n), lo), hi) : whenUnset

/**
 * Hold a requested size above the structural floor, and nowhere else.
 *
 * The number you typed wins. `fallback` is used only for a number that is not a number at all — a cleared
 * or half-typed input — so that building with an empty field keeps the map's current value instead of
 * collapsing it to 1.
 */
export function clampMapSize(size: MapSize, fallback: MapSize): MapSize {
  return {
    cols: bound(size.cols, MAP_SIZE_MIN, MAP_SIZE_MAX, fallback.cols),
    rows: bound(size.rows, MAP_SIZE_MIN, MAP_SIZE_MAX, fallback.rows),
    cellSize: floor(size.cellSize, CELL_SIZE_MIN, fallback.cellSize),
  }
}
