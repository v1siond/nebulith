/**
 * WHEN THE EDITOR CHROME IS VISIBLE — one derivation, not six copies.
 *
 * §5.2 names this as the de-risking step that must come BEFORE the bar split: "every gate
 * `showSidebars && !showGamesView && !playMode` is duplicated across four JSX regions; consolidate into
 * one `chromeVisible` derivation first." There are actually SIX sites, and they had drifted into three
 * different shapes — the mode chip also excludes the flow view, the restore button is the inverse. Splitting
 * the top bar into a PROJECT bar and a VIEW bar doubles the number of regions asking this question, so the
 * question gets exactly one answer first.
 *
 * Pure predicates over a tiny state object, so every combination is cheap to pin.
 */
import { canvasOverlayVisible, chromeRestoreVisible, chromeVisible, type ChromeState } from '@/components/game/chromeVisibility'

const state = (over: Partial<ChromeState> = {}): ChromeState => ({
  showSidebars: true,
  playMode: false,
  showGamesView: false,
  showFlowView: false,
  ...over,
})

describe('chromeVisible — the editing chrome (bars, sidebars, inspector)', () => {
  it('shows while editing', () => {
    expect(chromeVisible(state())).toBe(true)
  })

  it.each([
    ['the UI is hidden (Preview)', { showSidebars: false }],
    ['play mode is on', { playMode: true }],
    ['the games overlay is open', { showGamesView: true }],
  ])('hides when %s', (_label, over) => {
    expect(chromeVisible(state(over))).toBe(false)
  })

  it('STAYS visible in the flow view — the flow overlay covers the canvas, not the chrome', () => {
    expect(chromeVisible(state({ showFlowView: true }))).toBe(true)
  })

  it('hides when several reasons apply at once', () => {
    expect(chromeVisible(state({ playMode: true, showGamesView: true }))).toBe(false)
  })
})

describe('canvasOverlayVisible — things drawn ON the map (the mode chip)', () => {
  it('follows the chrome', () => {
    expect(canvasOverlayVisible(state())).toBe(true)
    expect(canvasOverlayVisible(state({ playMode: true }))).toBe(false)
  })

  it('ALSO hides under the flow view — that overlay owns the canvas', () => {
    expect(canvasOverlayVisible(state({ showFlowView: true }))).toBe(false)
  })

  it('is never visible when the chrome is not', () => {
    for (const over of [{ showSidebars: false }, { playMode: true }, { showGamesView: true }]) {
      expect(canvasOverlayVisible(state(over))).toBe(false)
    }
  })
})

describe('chromeRestoreVisible — the "show UI again" button', () => {
  it('appears exactly when the user hid the UI while editing', () => {
    expect(chromeRestoreVisible(state({ showSidebars: false }))).toBe(true)
  })

  it('does NOT appear in play mode or the games overlay — those hide the chrome for their own reasons', () => {
    expect(chromeRestoreVisible(state({ showSidebars: false, playMode: true }))).toBe(false)
    expect(chromeRestoreVisible(state({ showSidebars: false, showGamesView: true }))).toBe(false)
  })

  it('is the exact complement of chromeVisible while editing', () => {
    for (const showSidebars of [true, false]) {
      const s = state({ showSidebars })
      expect(chromeRestoreVisible(s)).toBe(!chromeVisible(s))
    }
  })

  it('never shows at the same time as the chrome', () => {
    const combos: Partial<ChromeState>[] = [
      {}, { showSidebars: false }, { playMode: true }, { showGamesView: true },
      { showSidebars: false, playMode: true }, { showFlowView: true },
    ]
    for (const over of combos) {
      const s = state(over)
      expect(chromeVisible(s) && chromeRestoreVisible(s)).toBe(false)
    }
  })
})
