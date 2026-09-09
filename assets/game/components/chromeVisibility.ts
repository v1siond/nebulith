/**
 * WHEN IS THE EDITOR CHROME ON SCREEN — the single answer.
 *
 * The page asked this in six places, in three slightly different shapes, and §5.2 makes consolidating them
 * the prerequisite for the Week-2 bar split: splitting one top bar into a PROJECT bar and a VIEW bar doubles
 * the regions that must agree about it, and a condition copied seven times is a condition that will drift.
 *
 * Three questions, because there are genuinely three:
 *   - `chromeVisible`        — the editing furniture (bars, sidebars, inspector).
 *   - `canvasOverlayVisible` — things drawn ON the map, which the flow view also covers.
 *   - `chromeRestoreVisible` — the "show the UI again" button, the exact complement while editing.
 *
 * Pure predicates: no React, no DOM.
 */

/** Everything the question depends on. */
export interface ChromeState {
  /** The user's Preview toggle — false means "hide all the furniture". */
  showSidebars: boolean
  /** Play mode owns the screen: canvas + HUD only. */
  playMode: boolean
  /** The full-screen games overlay is open. */
  showGamesView: boolean
  /** The full-screen level-graph overlay is open. It covers the CANVAS, not the chrome. */
  showFlowView: boolean
}

/**
 * The editing chrome is up. Deliberately NOT gated on the flow view: that overlay replaces the canvas while
 * the bars stay put, which is why the copies that added `!showFlowView` were describing a different question.
 */
export function chromeVisible(state: ChromeState): boolean {
  return state.showSidebars && !state.showGamesView && !state.playMode
}

/** An overlay drawn on the MAP (the canvas mode chip): the chrome is up AND the canvas is actually showing. */
export function canvasOverlayVisible(state: ChromeState): boolean {
  return chromeVisible(state) && !state.showFlowView
}

/**
 * The "show UI again" affordance — visible exactly when the user hid the chrome themselves, never when play
 * mode or the games overlay hid it for their own reasons (each of those has its own way out).
 */
export function chromeRestoreVisible(state: ChromeState): boolean {
  return !state.showSidebars && !state.showGamesView && !state.playMode
}
