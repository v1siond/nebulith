/**
 * THE RAIL IS A TABLIST — every mode must resolve to a tab that exists.
 *
 * This suite exists because of a real defect, not a hypothetical one. `RAIL_BY_MODE` mapped the resting
 * state (`select` — nothing armed) to a rail id `'select'`. The approved design then DELETED that entry
 * ("it acts on no object, so it is not a tool"). Nothing failed: the mapping still compiled, because
 * `'select'` is a member of the `RailId` union whether or not any band lists it. The visible result was
 * that the editor opened with no tab selected and an EMPTY 352px library column — every branch that
 * renders the panel gates on `activeRailId`, and no branch equals `'select'`.
 *
 * TypeScript cannot catch it: the union is the vocabulary, the bands are the MENU, and a vocabulary word
 * that is not on the menu is a perfectly valid value. So it is asserted here instead.
 */
import { EDITOR_BANDS, RAIL_BY_MODE, RAIL_IDS, type EditorMode } from '@/components/game/editorConfig'

const MODES: readonly EditorMode[] = ['select', 'paint', 'unit', 'building', 'connector']

describe('every canvas mode resolves to a rail entry that exists', () => {
  it.each(MODES)('%s maps to a declared entry', mode => {
    const id = RAIL_BY_MODE[mode]
    expect(RAIL_IDS.has(id)).toBe(true)
  })

  it('covers every mode — a new mode with no rail home would blank the panel', () => {
    expect(Object.keys(RAIL_BY_MODE).sort()).toEqual([...MODES].sort())
  })

  it('sends the resting state to the rail’s first entry, New world', () => {
    // Nothing armed is the state a fresh page load is in, so this mapping IS the editor's landing panel.
    expect(RAIL_BY_MODE.select).toBe(EDITOR_BANDS[0].items[0].id)
    expect(RAIL_BY_MODE.select).toBe('generate')
  })
})

describe('RAIL_IDS mirrors the bands', () => {
  it('holds exactly the ids the bands declare, and nothing the union merely allows', () => {
    expect([...RAIL_IDS].sort()).toEqual(['characters', 'generate', 'hud', 'objects', 'rules', 'terrain'])
  })

  it('does not hold the two entries the design removed', () => {
    expect(RAIL_IDS.has('select')).toBe(false)
    expect(RAIL_IDS.has('artstyle')).toBe(false)
  })
})
