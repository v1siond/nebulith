/**
 * THE EDITOR-SETTINGS STORE HOLDS MORE THAN PANEL GEOMETRY (§5.1 #7).
 *
 * `/api/editor_settings` is a key → jsonb store — the backend column has always been `:map`. The frontend
 * client, though, was typed `Record<string, PanelGeometry>`, so the only thing that could be persisted was
 * a floating panel's `{x,y,w,h}`. That is why the player camera range still admits, at `templates.tsx:234`,
 * "Not persisted yet — a follow-up": there was nowhere to put it.
 *
 * Widening the value type is the whole fix. These tests pin the reading half — a stored value must survive
 * the round trip, and a MALFORMED one must be ignored rather than trusted into the editor, because this
 * store is shared and a bad row must never break the page (the same rule `parseGames` follows).
 */
import { readNumberSetting, readGeometrySetting, readBooleanSetting } from '@/lib/editorSettings'

describe('readNumberSetting', () => {
  it('reads a stored number back', () => {
    expect(readNumberSetting({ playerRange: { value: 6 } }, 'playerRange')).toBe(6)
  })

  it('returns undefined when the key was never stored', () => {
    expect(readNumberSetting({}, 'playerRange')).toBeUndefined()
  })

  it('treats an explicitly cleared setting as OFF, not as missing', () => {
    // The camera range is a real tri-state: never set, set to a number, or deliberately turned off.
    expect(readNumberSetting({ playerRange: { value: null } }, 'playerRange')).toBeUndefined()
  })

  it.each([
    ['a string', { value: '6' }],
    ['a shape with no value', { cells: 6 }],
    ['not an object at all', 6],
    ['NaN', { value: Number.NaN }],
  ])('ignores %s rather than trusting it', (_label, stored) => {
    expect(readNumberSetting({ playerRange: stored } as never, 'playerRange')).toBeUndefined()
  })
})

describe('readGeometrySetting — the panel geometry the store already held', () => {
  const geo = { x: 10, y: 20, w: 300, h: 200 }

  it('still reads a full geometry', () => {
    expect(readGeometrySetting({ settings: geo }, 'settings')).toEqual(geo)
  })

  it('ignores a partial geometry — half a rectangle would place a panel off-screen', () => {
    expect(readGeometrySetting({ settings: { x: 10, y: 20 } } as never, 'settings')).toBeUndefined()
  })

  it('does not confuse a number setting for a geometry', () => {
    expect(readGeometrySetting({ playerRange: { value: 6 } } as never, 'playerRange')).toBeUndefined()
  })
})

/**
 * `readBooleanSetting` backs the inspector's remembered section state (§4.7, Week 5). Its whole job is to
 * keep "never touched" distinguishable from "explicitly false" — see `sectionIsOpen`, which needs that
 * difference to honour §4.7's defaults without overriding a user who closed a section on purpose.
 */
describe('readBooleanSetting — three states, not two', () => {
  it('reads a stored true and a stored false', () => {
    expect(readBooleanSetting({ 'inspector.section.size': { value: true } }, 'inspector.section.size')).toBe(true)
    expect(readBooleanSetting({ 'inspector.section.size': { value: false } }, 'inspector.section.size')).toBe(false)
  })

  it('is undefined for a key the user has never touched', () => {
    expect(readBooleanSetting({}, 'inspector.section.size')).toBeUndefined()
  })

  it('is undefined for a cleared value — null is not false', () => {
    expect(readBooleanSetting({ 'inspector.section.size': { value: null } }, 'inspector.section.size')).toBeUndefined()
  })

  it('drops a row holding something else, rather than coercing it', () => {
    expect(readBooleanSetting({ playerRange: { value: 6 } }, 'playerRange')).toBeUndefined()
    expect(readBooleanSetting({ 'inspector.section.size': { value: 'true' } } as never, 'inspector.section.size')).toBeUndefined()
    expect(readBooleanSetting({ settings: { x: 1, y: 2, w: 3, h: 4 } }, 'settings')).toBeUndefined()
  })
})
