/**
 * IS THE MAP IN FRONT OF YOU SAVED? (§4.4, and Week 3's prerequisite per §5.3.)
 *
 * Two things need this answer and neither could ask it before:
 *   - the LEVEL SWITCHER, which must not throw away edits when you step to another level — §5.3 rates it
 *     medium risk for exactly this reason: "switching a template inside a game already works but does not
 *     prompt about unsaved changes. Needs a dirty-tracker first — there isn't one today";
 *   - the SAVE BUTTON, which §4.4 turns from a bare verb into a status + action:
 *     `● Saved 12s ago` / `● Unsaved changes` / `Saving…`.
 *
 * Pure: the hook that owns the state is thin around this, so every phrasing and every "would this lose
 * work?" decision is unit-testable without React.
 */

export interface SaveState {
  /** Edits have happened since the last successful save (or since load). */
  dirty: boolean
  /** A save is in flight right now. */
  saving: boolean
  /** When the last successful save landed, or null if this map has never been saved. */
  savedAt: number | null
}

/** How the status reads. `tone` drives the dot's colour — a warning must never look like an OK. */
export interface SaveStatus {
  label: string
  tone: 'ok' | 'warning' | 'busy'
  /** Would abandoning this map right now lose work? What the level switcher asks before it steps. */
  wouldLoseWork: boolean
}

/** "just now" under a second, then seconds, then whole minutes. */
function agoLabel(elapsedMs: number): string {
  if (elapsedMs < 1000) return 'just now'
  const seconds = Math.floor(elapsedMs / 1000)
  return seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ago`
}

/**
 * Describe the save state at `now`. Precedence is deliberate: an in-flight save outranks dirtiness (the user
 * pressed the button — tell them it is happening, and a switch would not lose work because the write is
 * already going out), and dirtiness outranks "never saved" (the actionable fact is the unsaved edits).
 */
export function describeSaveState(state: SaveState, now: number): SaveStatus {
  if (state.saving) return { label: 'Saving…', tone: 'busy', wouldLoseWork: false }
  if (state.dirty) return { label: 'Unsaved changes', tone: 'warning', wouldLoseWork: true }
  if (state.savedAt === null) return { label: 'Not saved yet', tone: 'warning', wouldLoseWork: false }
  return { label: `Saved ${agoLabel(now - state.savedAt)}`, tone: 'ok', wouldLoseWork: false }
}
