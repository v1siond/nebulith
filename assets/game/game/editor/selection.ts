/**
 * Pure selection-SET logic behind cell/block selection in every view. The editor's mouse handlers compute the
 * NEXT selection set from a gesture through THESE functions — so "batch a rectangle", "additively extend it",
 * and "add a single cell" live in ONE tested place instead of scattered inline in the React handlers.
 *
 * Keys are "col,row" (a flat CELL) or "col,row,level" (a raised BLOCK), matching the render's selection outline.
 * Nothing here mutates its inputs.
 */

export interface Cell { col: number; row: number }

/** The "col,row" keys of the INCLUSIVE rectangle spanned by two corner cells (corner order doesn't matter). */
export function rectSelectionKeys(a: Cell, b: Cell): Set<string> {
  const minCol = Math.min(a.col, b.col), maxCol = Math.max(a.col, b.col)
  const minRow = Math.min(a.row, b.row), maxRow = Math.max(a.row, b.row)
  const keys = new Set<string>()
  for (let r = minRow; r <= maxRow; r++) for (let c = minCol; c <= maxCol; c++) keys.add(`${c},${r}`)
  return keys
}

/** Extend a selection with a rectangle. `additive` → UNION with the existing set (select 4, then 4 more → 8);
 *  else → just the rectangle (a fresh drag replaces). Never mutates `base`. */
export function applyRectSelection(base: ReadonlySet<string>, a: Cell, b: Cell, additive: boolean): Set<string> {
  const rect = rectSelectionKeys(a, b)
  if (!additive) return rect
  const next = new Set(base)
  for (const k of rect) next.add(k)
  return next
}

/** Extend a selection with a single cell/block key. `additive` → add to the set; else → replace with just it. */
export function applyCellSelection(base: ReadonlySet<string>, key: string, additive: boolean): Set<string> {
  if (!additive) return new Set([key])
  const next = new Set(base)
  next.add(key)
  return next
}
