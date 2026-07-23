/**
 * THE structural map-edit boundary.
 *
 * Undo used to be OPT-IN PER HANDLER: each edit had to remember to call `checkpointHistory()` itself, and
 * `removeSelectedTile` didn't — so removing a tile could not be undone. Every new handler was another chance
 * to forget. Routing structural edits through `editMap` moves the snapshot INTO the boundary: an edit cannot
 * change the map without a checkpoint landing first, by construction rather than by discipline.
 *
 * User's rule: "it should be a global thing that works for anything on the map and tile related … anything
 * related to adding, removing, replacing tiles, anything that is related to building the map". Settings
 * tweaks (colour/size/shape/pose/…) deliberately do NOT route here — "is ok to not have settings yet" — a
 * slider drag fires continuously and would flood the bounded history.
 */

/** Run one STRUCTURAL map edit (add / remove / replace a tile) with undo captured first.
 *
 *  The checkpoint is taken BEFORE `mutate` so Ctrl+Z restores the map as it was; `onChanged` runs after, for
 *  the render/version bump. Unconditional: a mutation that turns out to be a no-op still snapshots, so the
 *  history never desyncs from what the user saw. */
export function editMap(checkpoint: () => void, mutate: () => void, onChanged?: () => void): void {
  checkpoint()
  mutate()
  onChanged?.()
}
