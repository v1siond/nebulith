/**
 * A tiny, PURE undo/redo stack — the map-agnostic core of the editor's Ctrl+Z / Ctrl+Y history (Alexander:
 * "ctrl + y and ctrl + z functionalities … 4-5 steps forward and backwards"). It holds two lists of opaque
 * snapshots (`past` = states you can step BACK to, `future` = states you can step FORWARD to) and never touches
 * the grid itself, so it unit-tests without React or a canvas. The caller supplies the SNAPSHOT + RESTORE of
 * the live map (see mapSnapshot.ts); this module just shuffles snapshots between the two stacks and enforces
 * the bound.
 *
 * Model — checkpoint BEFORE the edit: each user edit calls `checkpoint(present)` first, pushing the pre-edit
 * state onto `past` and dropping the redo branch. `undo`/`redo` then move the live `present` across the two
 * stacks. `limit` caps how many steps you can take each way (the oldest is dropped, ring-buffer style).
 */
export interface History<T> {
  past: T[]
  future: T[]
}

/** How many edits you can step back/forward — the "4-5 steps" Alexander asked for (kept ≥ 4). */
export const HISTORY_LIMIT = 5

export function createHistory<T>(): History<T> {
  return { past: [], future: [] }
}

export function canUndo<T>(h: History<T>): boolean {
  return h.past.length > 0
}

export function canRedo<T>(h: History<T>): boolean {
  return h.future.length > 0
}

/** Record `present` as an undo checkpoint BEFORE an edit mutates the map: push it onto `past`, DROP the redo
 *  branch (a fresh edit invalidates any undone-but-not-redone future), and cap `past` to `limit` (drop the
 *  oldest). Pure — returns a new History. */
export function checkpoint<T>(h: History<T>, present: T, limit: number): History<T> {
  const past = [...h.past, present]
  if (past.length > limit) past.splice(0, past.length - limit) // keep the newest `limit` (ring buffer)
  return { past, future: [] }
}

/** Step BACK one edit: pop the newest `past` state to restore, and push the current `present` onto `future`
 *  so a later redo can return to it. Returns the new History and the snapshot to restore — `restored` is null
 *  when there's nothing to undo, so the caller leaves the map untouched. Pure. */
export function undo<T>(h: History<T>, present: T, limit: number): { history: History<T>; restored: T | null } {
  if (h.past.length === 0) return { history: h, restored: null }
  const restored = h.past[h.past.length - 1]
  const past = h.past.slice(0, -1)
  const future = [present, ...h.future]
  if (future.length > limit) future.length = limit
  return { history: { past, future }, restored }
}

/** Step FORWARD one undone edit: pop the newest `future` state to restore, pushing `present` back onto `past`.
 *  The mirror of {@link undo}. `restored` is null when there's nothing to redo. Pure. */
export function redo<T>(h: History<T>, present: T, limit: number): { history: History<T>; restored: T | null } {
  if (h.future.length === 0) return { history: h, restored: null }
  const restored = h.future[0]
  const future = h.future.slice(1)
  const past = [...h.past, present]
  if (past.length > limit) past.splice(0, past.length - limit)
  return { history: { past, future }, restored }
}
