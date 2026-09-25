/**
 * HOW BIG A MAP CAN BE, which is to say, as big as you type.
 *
 * There is no maximum here, and there must never be one again. Three have been removed now, each one
 * turning a performance characteristic into a rule about what the user is allowed to want:
 *
 *  · The GENERATOR's served range (`rows 24-35` for Meadow) was used as a cap, so a requested 40 silently
 *    became 35. It is now only what the random roll picks from.
 *  · An engine cap of 100 per side rejected 400 × 240 outright, and because the inputs validated against
 *    it, the panel could not even count the cells, printing `400 × 240 =, cells`.
 *  · `MAP_SIZE_MAX = 100` came BACK as a "temporary bound while the renderer catches up". It disabled the
 *    resize button above 100 while `Grid.changeset/2` validated only `greater_than: 0`, so React refused
 *    a map the backend would have saved, on a number React invented. Phase 1 of `docs/SPEC.md` names it
 *    in its DELETE line, and it outlived the phase by months.
 *
 * `docs/SPEC.md` law 12, quoting him directly: *"none of the sliders should be limited... the react side
 * just reacts the values of the backend and allow us to change them in the state, as simple as that."*
 * A limit that belongs anywhere belongs in a served column, not in this file.
 *
 * What remains is a structural FLOOR of one cell, because a grid with no cells is not a grid, and the
 * backend agrees (`greater_than: 0`). It is stated rather than silently applied: nothing here may quietly
 * change a number the user typed.
 *
 * Gated by `test/e2e/the_frontend_sets_no_limits_test.exs`, which types a size above the old ceiling into
 * the real panel and reads back the saved row.
 */

/** The open map's size, as the panel shows it. */
export interface MapSize {
  cols: number
  rows: number
  cellSize: number
}

/** A grid must have at least one cell, and a cell at least one pixel. The structural limits, and the only
 *  ones: they match what the backend's changeset already enforces rather than inventing a second rule. */
export const MAP_SIZE_MIN = 1
export const CELL_SIZE_MIN = 1

/** True when `n` is a real number of at least `lo`. A half-typed input (NaN) is not. */
export function atLeast(n: number, lo: number): boolean {
  return Number.isFinite(n) && n >= lo
}

/** Is every number of this size one the engine can actually build? */
export function mapSizeValid(size: MapSize): boolean {
  return (
    atLeast(size.cols, MAP_SIZE_MIN) &&
    atLeast(size.rows, MAP_SIZE_MIN) &&
    atLeast(size.cellSize, CELL_SIZE_MIN)
  )
}

/** Why a size is not buildable, in the panel's own words, or null when it is fine. Said out loud rather
 *  than applied silently: a number quietly rewritten under you is the bug this file was created for. */
export function mapSizeProblem(size: MapSize): string | null {
  for (const [_axis, n] of [['Columns', size.cols], ['Rows', size.rows]] as const) {
    if (!Number.isFinite(n)) continue
    if (n < MAP_SIZE_MIN) return 'A map needs at least one cell on each side.'
  }
  return null
}

/** How many cells a size describes, the number the panel prints. */
export function cellCount(size: MapSize): number | null {
  if (!atLeast(size.cols, MAP_SIZE_MIN) || !atLeast(size.rows, MAP_SIZE_MIN)) return null
  return Math.floor(size.cols) * Math.floor(size.rows)
}

const floor = (n: number, lo: number, whenUnset: number): number =>
  Number.isFinite(n) ? Math.max(Math.floor(n), lo) : whenUnset

/**
 * Hold a requested size above the structural floor, and nowhere else.
 *
 * The number you typed wins. `fallback` is used only for a number that is not a number at all, a cleared
 * or half-typed input, so that building with an empty field keeps the map's current value instead of
 * collapsing it to 1.
 */
export function clampMapSize(size: MapSize, fallback: MapSize): MapSize {
  return {
    cols: floor(size.cols, MAP_SIZE_MIN, fallback.cols),
    rows: floor(size.rows, MAP_SIZE_MIN, fallback.rows),
    cellSize: floor(size.cellSize, CELL_SIZE_MIN, fallback.cellSize),
  }
}
