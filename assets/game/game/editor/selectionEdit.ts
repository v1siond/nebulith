/**
 * Helpers for the multi-select Property panel. When several elements are selected (e.g. 4–5 trees, a run
 * of floor cells), a control shows the value they SHARE, or a "mixed" state when they differ. Pure — the
 * grid mutation (applying an edit to every selected cell) stays in the page where the grid/state live.
 */
import type { IsometricGrid } from '@/engine/IsometricGrid'
import { deriveCellCollision, getStack } from '@/engine/cellStack'

/** The value shared by EVERY selected item, or `null` when they differ (mixed) or the list is empty. */
export function commonValue<T>(values: readonly T[]): T | null {
  if (values.length === 0) return null
  const [first] = values
  return values.every((v) => v === first) ? first : null
}

/** Collision summary across the selection: `true` = all blocked, `false` = all clear, `null` = mixed/empty. */
export function commonBool(values: readonly boolean[]): boolean | null {
  return commonValue(values)
}

/** Parse `"col,row"` selection keys into numeric cell coords (skips malformed keys). */
export function cellsFromKeys(keys: Iterable<string>): { col: number; row: number }[] {
  const out: { col: number; row: number }[] = []
  for (const key of keys) {
    const [c, r] = key.split(',').map(Number)
    if (Number.isFinite(c) && Number.isFinite(r)) out.push({ col: c, row: r })
  }
  return out
}

/** Inspector "Remove tile" → delete the EXACT block the user has SELECTED (selectedTileLevel, 1-based-into-
 *  the-stack: 0 = floor, i>=1 = stackedAssetsAt(...)[i-1]) from every selected cell, then re-derive that
 *  cell's collision from whatever remains. The floor is NEVER removable from this control — level 0 is a
 *  no-op, so a selected floor tile can't be deleted out from under the user (⌥Alt/paint-clear already own
 *  clearing the ground; this is the counterpart for a SPECIFIC stacked block, mirroring
 *  tileBrush.removeAssetAtLevel but driven by the Inspector's selection state instead of a pointer level). */
export function removeSelectedBlock(grid: IsometricGrid, cells: { col: number; row: number }[], selectedTileLevel: number): void {
  if (selectedTileLevel === 0) return
  for (const { col, row } of cells) {
    const target = [...grid.getAssetsAtCell(col, row)].sort((a, b) => (a.heightLevel ?? 0) - (b.heightLevel ?? 0))[selectedTileLevel - 1]
    if (!target) continue
    grid.removeAssetsWhere(a => a === target)
    grid.setCollision(col, row, deriveCellCollision(getStack(grid, col, row)))
  }
}
