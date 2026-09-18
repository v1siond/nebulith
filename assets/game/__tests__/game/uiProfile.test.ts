/**
 * THE PLAYER-UI PROFILE, the HUD, keys and bars as backend data.
 *
 * Every property here is one of the answers to the UI spec, so the tests read as
 * the decisions rather than as implementation detail.
 */
import {
  activeBars, bindingsFor, installUiProfile, layoutFor, playerMay, uiActions, uiProfile,
} from '@/game/uiProfile'

const PAYLOAD = {
  data: {
    actions: [
      { key: 'move_up', category: 'movement', label: 'Move up', defaultChord: 'W / ↑', position: 0 },
      { key: 'power_1', category: 'combat', label: 'Power 1', defaultChord: '1', position: 1 },
    ],
    profile: {
      key: 'default', name: 'Default', gameId: null,
      playerMay: { keys: true, layout: false, settings: true },
      bindings: [
        { actionKey: 'move_up', input: 'KeyW', editable: true, position: 0 },
        { actionKey: 'move_up', input: 'ArrowUp', editable: true, position: 1 },
        { actionKey: 'power_1', input: 'Digit1', editable: true, position: 2 },
      ],
      elements: [
        { elementKey: 'vitals', form: 'Desktop', placement: { a: 'BL', x: 16, y: 16 }, editable: true },
        { elementKey: 'vitals', form: 'Mobile', placement: { a: 'BL', x: 8, y: 8 }, editable: true },
      ],
      bars: [
        { name: 'Powers', position: 0, rows: 1, cols: 4, settings: {}, condition: null, slots: [] },
        { name: 'Vehicle', position: 1, rows: 1, cols: 4, settings: {}, condition: { when: 'vehicle' }, slots: [] },
      ],
    },
  },
}

describe('the profile in force', () => {
  it('is EMPTY until the backend answers, nothing is invented', () => {
    installUiProfile({})
    expect(uiProfile()).toBeNull()
    expect(uiActions()).toEqual([])
    expect(layoutFor('Desktop')).toEqual({})
  })

  it('carries the action catalog and the profile together', () => {
    installUiProfile(PAYLOAD)
    expect(uiActions().map(a => a.key)).toEqual(['move_up', 'power_1'])
    expect(uiProfile()?.name).toBe('Default')
  })
})

describe('bindings, more than one per action is an ALTERNATE, not a conflict', () => {
  beforeEach(() => installUiProfile(PAYLOAD))

  it('returns every input bound to an action', () => {
    expect(bindingsFor('move_up').map(b => b.input)).toEqual(['KeyW', 'ArrowUp'])
  })

  it('returns nothing for an action nobody bound', () => {
    expect(bindingsFor('jump')).toEqual([])
  })
})

describe('layouts, desktop and mobile are two layouts, not one scaled down', () => {
  beforeEach(() => installUiProfile(PAYLOAD))

  it('keys each form separately', () => {
    expect(layoutFor('Desktop').vitals).toEqual({ a: 'BL', x: 16, y: 16 })
    expect(layoutFor('Mobile').vitals).toEqual({ a: 'BL', x: 8, y: 8 })
  })
})

describe('bars, unlimited, never paged, and swapped in by condition', () => {
  beforeEach(() => installUiProfile(PAYLOAD))

  it('a bar with NO condition is always up', () => {
    expect(activeBars(() => false).map(b => b.name)).toEqual(['Powers'])
  })

  it('a conditional bar joins it when its condition holds', () => {
    expect(activeBars(c => c.when === 'vehicle').map(b => b.name)).toEqual(['Powers', 'Vehicle'])
  })
})

describe('what a PLAYER may change is the author\'s call', () => {
  beforeEach(() => installUiProfile(PAYLOAD))

  it('reads the author\'s limits', () => {
    expect(playerMay('keys')).toBe(true)
    expect(playerMay('layout')).toBe(false)
  })

  it('treats an unstated permission as NO, a player may not do what the author never allowed', () => {
    installUiProfile({ data: { actions: [], profile: { ...PAYLOAD.data.profile, playerMay: {} } } })
    expect(playerMay('keys')).toBe(false)
    expect(playerMay('layout')).toBe(false)
  })
})
