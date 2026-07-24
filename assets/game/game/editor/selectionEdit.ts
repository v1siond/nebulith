/**
 * Helpers for the multi-select Property panel. When several elements are selected (e.g. 4–5 trees, a run
 * of floor cells), a control shows the value they SHARE, or a "mixed" state when they differ. Pure — the
 * grid mutation (applying an edit to every selected cell) stays in the page where the grid/state live.
 */
import { type GridAsset, type IsometricGrid } from '@/engine/IsometricGrid'
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

/** Parse ONE selection key into its cell + optional stack slot. A key is either a specific TILE
 *  (`"col,row,stackIndex"`) or a bare CELL (`"col,row"`, no slot). Returns null for a malformed key. */
export function parseSelectionKey(key: string): { col: number; row: number; stackIndex?: number } | null {
  const [col, row, stackIndex] = key.split(',').map(Number)
  if (!Number.isFinite(col) || !Number.isFinite(row)) return null
  return Number.isFinite(stackIndex) ? { col, row, stackIndex } : { col, row }
}

/** A per-cell edit target: the cell + the stack SLOT the edit should act on. */
export interface SelectionTileTarget { col: number; row: number; index: number }

/** Turn a selection into per-cell edit targets that each use the tile's OWN stack slot — the fix for "edits hit
 *  the wrong tile in the stack" (Alexander: "a few of the tiles I selected changed the tile located at the bottom
 *  instead of the one selected"). Every selection key already carries the picked tile's slot, so a multi-select
 *  edits/replaces each cell's SELECTED tile — NEVER a single global level forced onto every cell (which landed on
 *  the bottom/floor tile). A bare `"col,row"` key (a flat rectangle drag with no specific tile) falls back to
 *  `fallbackIndex` — the Inspector's `selectedTileLevel`. Mirrors {@link removeSelectedBlock}'s per-key resolution.
 *  Malformed keys are skipped. */
export function resolveSelectionTargets(keys: Iterable<string>, fallbackIndex: number): SelectionTileTarget[] {
  const out: SelectionTileTarget[] = []
  for (const key of keys) {
    const parsed = parseSelectionKey(key)
    if (!parsed) continue
    out.push({ col: parsed.col, row: parsed.row, index: parsed.stackIndex ?? fallbackIndex })
  }
  return out
}

/** Inspector "Remove tile" → delete the EXACT tile(s) the user has SELECTED, one per selection KEY, then
 *  re-derive each touched cell's collision from whatever remains. Each key carries the tile's OWN STACK INDEX
 *  (its slot in the cell's ordered stack — the same per-tile identity the pick + highlight use), so a
 *  multi-select removes EVERY selected tile, exactly the one picked — never a global stack-index applied to all
 *  cells and never a same-level neighbour:
 *   • "col,row,stackIndex" → the tile at that slot (`getAssetsAtCell[stackIndex]`). A tall collapsed wall is
 *     ONE asset at ONE slot, so its single key removes the whole wall.
 *   • the FLOOR/base tile is removed exactly like ANY other tile (uniform — MAP-MODEL §4: everything on the map
 *     is a tile); removing the base can leave the cell empty. Only a bare "col,row" cell key with no stack index
 *     is a no-op here (nothing specific selected).
 *  Mirrors tileBrush.removeAssetAtLevel's collision re-derive, but driven by the Inspector's selection keys. */
export function removeSelectedBlock(grid: IsometricGrid, keys: Iterable<string>): void {
  // Resolve EVERY target against the CURRENT stack FIRST, then delete by reference — removing a tile shifts the
  // remaining slots, so two keys on the SAME cell ("6,6,1" + "6,6,2") must both be looked up before any deletion.
  const targets = new Set<GridAsset>()
  const touched = new Map<string, { col: number; row: number }>()
  for (const key of keys) {
    const parsed = parseSelectionKey(key)
    if (!parsed || parsed.stackIndex === undefined) continue // bare "col,row" cell key → nothing to remove
    const { col, row, stackIndex } = parsed
    const target = grid.getAssetsAtCell(col, row)[stackIndex]
    if (!target) continue // no tile at that slot → nothing to remove
    targets.add(target)
    touched.set(`${col},${row}`, { col, row })
  }
  if (targets.size === 0) return
  grid.removeAssetsWhere(a => targets.has(a))
  for (const { col, row } of touched.values()) {
    grid.setCollision(col, row, deriveCellCollision(getStack(grid, col, row)))
  }
}
