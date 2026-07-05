/**
 * Helpers for the multi-select Property panel. When several elements are selected (e.g. 4–5 trees, a run
 * of floor cells), a control shows the value they SHARE, or a "mixed" state when they differ. Pure — the
 * grid mutation (applying an edit to every selected cell) stays in the page where the grid/state live.
 */

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
