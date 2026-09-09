/**
 * THE SAVE STATE — Week 3's prerequisite (§5.3, §4.4).
 *
 * §5.3 rates the level switcher *medium* risk for one reason: "Switching a template inside a game already
 * works but does **not** prompt about unsaved changes. Needs a dirty-tracker first — there isn't one today."
 * So before a `◀ Level 3 of 5 ▶` stepper can exist, the editor has to know whether the map in front of you
 * has edits that a switch would throw away.
 *
 * §4.4 then turns that same state into the button itself: the top bar's Save stops being a bare verb and
 * becomes a STATUS + action — `● Saved 12s ago` / `● Unsaved changes` / `Saving…`. This is the pure
 * description of that; the hook that owns the state is thin around it.
 */
import { describeSaveState, type SaveState } from '@/game/editor/saveState'

const NOW = 1_700_000_000_000
const state = (over: Partial<SaveState> = {}): SaveState => ({
  dirty: false,
  saving: false,
  savedAt: NOW - 12_000,
  ...over,
})

describe('what the button says', () => {
  it('reports an in-flight save above everything else', () => {
    // Saving wins even while dirty: the user pressed the button, so tell them it is happening.
    expect(describeSaveState(state({ saving: true, dirty: true }), NOW).label).toBe('Saving…')
  })

  it('warns about unsaved edits', () => {
    expect(describeSaveState(state({ dirty: true }), NOW).label).toBe('Unsaved changes')
  })

  it('says how long ago it saved', () => {
    expect(describeSaveState(state(), NOW).label).toBe('Saved 12s ago')
  })

  it('says "just now" for a save younger than a second, not "0s ago"', () => {
    expect(describeSaveState(state({ savedAt: NOW - 200 }), NOW).label).toBe('Saved just now')
  })

  it('switches to minutes past a minute', () => {
    expect(describeSaveState(state({ savedAt: NOW - 95_000 }), NOW).label).toBe('Saved 1m ago')
    expect(describeSaveState(state({ savedAt: NOW - 3_600_000 }), NOW).label).toBe('Saved 60m ago')
  })

  it('says nothing has been saved yet when it never has', () => {
    expect(describeSaveState(state({ savedAt: null }), NOW).label).toBe('Not saved yet')
  })

  it('treats a never-saved map with edits as unsaved changes, not "not saved yet"', () => {
    expect(describeSaveState(state({ savedAt: null, dirty: true }), NOW).label).toBe('Unsaved changes')
  })
})

describe('the tone drives the dot colour — a warning must not read as OK', () => {
  it('is a warning while dirty', () => {
    expect(describeSaveState(state({ dirty: true }), NOW).tone).toBe('warning')
  })

  it('is neutral while saving', () => {
    expect(describeSaveState(state({ saving: true }), NOW).tone).toBe('busy')
  })

  it('is OK once clean', () => {
    expect(describeSaveState(state(), NOW).tone).toBe('ok')
  })

  it('is a warning when nothing was ever saved', () => {
    expect(describeSaveState(state({ savedAt: null }), NOW).tone).toBe('warning')
  })
})

describe('whether a switch would lose work', () => {
  it('blocks nothing when the map is clean', () => {
    expect(describeSaveState(state(), NOW).wouldLoseWork).toBe(false)
  })

  it('flags a dirty map — this is what the level switcher must ask about', () => {
    expect(describeSaveState(state({ dirty: true }), NOW).wouldLoseWork).toBe(true)
  })

  it('does NOT flag while a save is in flight — the work is being written right now', () => {
    expect(describeSaveState(state({ dirty: true, saving: true }), NOW).wouldLoseWork).toBe(false)
  })
})
