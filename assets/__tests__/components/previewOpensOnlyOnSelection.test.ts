/**
 * THE PREVIEW OPENS WHEN SOMETHING IS SELECTED, AND AT NO OTHER TIME.
 *
 * *"preview modal is always open, I only want to open when an actual element is selected"*, and after it came
 * back the same day: *"preview is once again, loading when nothing is selected...regression"*.
 *
 * Twice, because the rule was never written down as a rule. It lived in two React effects, one of which
 * opened the window on every rail change, and an effect FIRES ON MOUNT, so the first frame of a fresh editor
 * opened it over the map with nothing picked. These cases pin the sentence instead of the effects.
 */
import { armedSubject, hasArmedSelection, shouldOpenPreview } from '@/components/game/previewOpening'

const NOTHING = { buildingTool: null, armedTileId: null, unitTileId: null }

describe('nothing is selected', () => {
  it('a fresh editor does not open it', () => {
    expect(shouldOpenPreview(NOTHING)).toBe(false)
  })

  it('and an absent field is the same as an empty one', () => {
    expect(shouldOpenPreview({})).toBe(false)
    expect(shouldOpenPreview({ buildingTool: '', armedTileId: '', unitTileId: '' })).toBe(false)
  })

  it('CHANGING RAIL IS NOT SELECTING. This is the regression, both times.', () => {
    // The subject changes, because the rail is part of it, and the window still must not open.
    const before = armedSubject('generate', NOTHING)
    const after = armedSubject('tiles', NOTHING)
    expect(before).not.toBe(after)
    expect(shouldOpenPreview(NOTHING)).toBe(false)
  })
})

describe('something is selected', () => {
  it.each([
    ['a building tool', { buildingTool: 'house' }],
    ['a tile', { armedTileId: 'grass' }],
    ['a unit', { unitTileId: 'brute' }],
  ])('%s opens it', (_what, armed) => {
    expect(shouldOpenPreview(armed)).toBe(true)
    expect(hasArmedSelection(armed)).toBe(true)
  })

  it('and picking a DIFFERENT thing is a new reason to look, so the subject changes', () => {
    const a = armedSubject('tiles', { armedTileId: 'grass' })
    const b = armedSubject('tiles', { armedTileId: 'water' })
    expect(a).not.toBe(b)
  })

  it('on whichever rail you are on, so closing it on one panel does not mute the others', () => {
    for (const rail of ['generate', 'tiles', 'objects', 'units']) {
      expect(shouldOpenPreview({ armedTileId: 'grass' })).toBe(true)
      expect(armedSubject(rail, { armedTileId: 'grass' })).toContain(rail)
    }
  })
})
