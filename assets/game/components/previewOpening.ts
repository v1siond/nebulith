/**
 * WHEN THE PREVIEW WINDOW OPENS.
 *
 * *"preview modal is always open, I only want to open when an actual element is selected"* (2026-09-15), and
 * again the same day after it came back: *"preview is once again, loading when nothing is selected...
 * regression"*.
 *
 * It regressed because the rule lived in two React effects and neither of them was the rule. One opened the
 * window on every rail change, and a React effect ALSO FIRES ON MOUNT, so with nothing armed and no rail
 * touched it ran once on the first frame and put the window over the map.
 *
 * The rule is one sentence and it is here so it can be tested: the window opens when something is ARMED.
 * Not on mount, not on a rail change, and not on a hover, because a hover is not a decision and reopening a
 * window you just shut every time the cursor crossed the library would be its own bug.
 */

/** What the editor can have armed. Any one of them is a selection; none of them is not. */
export interface ArmedState {
  /** A building tool, if one is picked. */
  buildingTool?: string | null
  /** The tile armed for painting. */
  armedTileId?: string | null
  /** The unit armed for placing. */
  unitTileId?: string | null
}

/** Is anything actually selected? This is the whole gate. */
export function hasArmedSelection(armed: ArmedState): boolean {
  return !!armed.buildingTool || !!armed.armedTileId || !!armed.unitTileId
}

/**
 * The identity of what is armed, so a change of SELECTION is what reopens the window rather than any
 * re-render. Changing rail alone does not change this.
 */
export function armedSubject(railId: string, armed: ArmedState): string {
  return `${railId}:${armed.buildingTool ?? ''}:${armed.armedTileId ?? ''}:${armed.unitTileId ?? ''}`
}

/** Should the window open for this state? The answer the effect asks for, in one place. */
export function shouldOpenPreview(armed: ArmedState): boolean {
  return hasArmedSelection(armed)
}

/**
 * WHY A PEEK HAPPENED, for the panels that peek a world rather than arm a tool.
 *
 *  · `pick`    the person clicked the thing. A decision.
 *  · `hover`   the cursor crossed it. Not a decision.
 *  · `resting` the panel is drawing what is already chosen: a mount, a season change, a re-render.
 */
export type PeekReason = 'pick' | 'hover' | 'resting'

/**
 * Should this peek put the window back on screen? Only a pick.
 *
 * A pick opens the window EVERY time, including the second click on the same thing. That is why this reads
 * the REASON rather than a change of subject: clicking what is already picked changes no state, and it still
 * has to bring the window back, which is what replaced the separate reopen button.
 *
 * The other two reasons are the regression this module exists to prevent. `resting` fires on mount, and a
 * window that reopens every time the cursor crosses a card is the bug a `hover` would be.
 */
export function shouldOpenPreviewOnPeek(reason: PeekReason): boolean {
  return reason === 'pick'
}
