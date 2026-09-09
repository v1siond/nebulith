/**
 * THE ONE SHORTCUT TABLE (games-page UX design §4.9, §5.1).
 *
 * The design asks for a help sheet "built from ONE exported table so it can never drift from the
 * handlers". A table that merely *describes* the handlers is a second copy that rots, so the table
 * IS the dispatcher: `matchEditorAction` is what the page's keydown chain calls, and the same rows
 * render the sheet. These tests pin both halves of that contract:
 *
 *   1. the matcher fires on the REAL chords the editor handles (and on nothing else),
 *   2. every dispatched action is documented in the sheet — the anti-drift guard,
 *   3. the play rows read LIVE loadout data, so rebinding an ability rebinds the sheet.
 */
import {
  EDITOR_ACTIONS,
  MOVE_KEYS,
  SHORTCUT_GROUPS,
  helpSheetGroups,
  isTypingTarget,
  matchEditorAction,
} from '@/game/shortcuts'
import { defaultAbilityLoadout, getAbility } from '@/game/abilities'

/** A KeyboardEvent-shaped stub — the matcher only reads these five fields. */
const ev = (key: string, mods: { ctrl?: boolean; meta?: boolean; alt?: boolean; shift?: boolean } = {}, target: unknown = null) =>
  ({ key, ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, altKey: !!mods.alt, shiftKey: !!mods.shift, target }) as unknown as KeyboardEvent

const fieldOfType = (tagName: string) => ({ tagName, isContentEditable: false })

import { installAbilityRegistry } from '@/game/abilities'
import liveAbilities from '@/__tests__/fixtures/abilities.json'

beforeEach(() => installAbilityRegistry(liveAbilities.data as never))

describe('matchEditorAction dispatches the editor keys the page actually handles', () => {
  it('matches the plain single-key actions', () => {
    expect(matchEditorAction(ev('i'))).toBe('inventory')
    expect(matchEditorAction(ev('q'))).toBe('quests')
    expect(matchEditorAction(ev('r'))).toBe('randomize')
    expect(matchEditorAction(ev('Tab'))).toBe('cycleTarget')
    expect(matchEditorAction(ev('Escape'))).toBe('escape')
  })

  it('matches the SHIFTED letter too — keydown delivers "I" when shift is held', () => {
    expect(matchEditorAction(ev('I', { shift: true }))).toBe('inventory')
    expect(matchEditorAction(ev('Q', { shift: true }))).toBe('quests')
    expect(matchEditorAction(ev('R', { shift: true }))).toBe('randomize')
  })

  it('matches copy/paste only with Ctrl or Cmd', () => {
    expect(matchEditorAction(ev('c', { ctrl: true }))).toBe('copy')
    expect(matchEditorAction(ev('v', { meta: true }))).toBe('paste')
    expect(matchEditorAction(ev('c'))).toBeNull()
    expect(matchEditorAction(ev('v'))).toBeNull()
  })

  it('never fires a Ctrl chord while Alt is held (the page excludes altKey)', () => {
    expect(matchEditorAction(ev('c', { ctrl: true, alt: true }))).toBeNull()
    expect(matchEditorAction(ev('v', { ctrl: true, alt: true }))).toBeNull()
  })

  it('does not claim a Ctrl chord for the plain single-key actions', () => {
    expect(matchEditorAction(ev('i', { ctrl: true }))).toBeNull()
    expect(matchEditorAction(ev('r', { meta: true }))).toBeNull()
  })

  it('returns null for keys the editor does not handle', () => {
    expect(matchEditorAction(ev('w'))).toBeNull()
    expect(matchEditorAction(ev('F5'))).toBeNull()
    expect(matchEditorAction(ev(' '))).toBeNull()
  })
})

describe('typing in a field suppresses every editor shortcut', () => {
  it.each(['INPUT', 'TEXTAREA'])('ignores keys typed into an %s', tag => {
    expect(matchEditorAction(ev('i', {}, fieldOfType(tag)))).toBeNull()
    expect(matchEditorAction(ev('c', { ctrl: true }, fieldOfType(tag)))).toBeNull()
    expect(matchEditorAction(ev('Escape', {}, fieldOfType(tag)))).toBeNull()
  })

  it('ignores keys typed into a contentEditable element', () => {
    const editable = { tagName: 'DIV', isContentEditable: true }
    expect(matchEditorAction(ev('r', {}, editable))).toBeNull()
  })

  it('isTypingTarget answers the same question on its own', () => {
    expect(isTypingTarget(fieldOfType('INPUT') as unknown as EventTarget)).toBe(true)
    expect(isTypingTarget(fieldOfType('DIV') as unknown as EventTarget)).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})

describe('the help sheet cannot drift from the dispatcher', () => {
  const rowsOf = (groups: ReturnType<typeof helpSheetGroups>) => groups.flatMap(g => g.rows)

  it('documents EVERY dispatched editor action', () => {
    const documented = new Set(rowsOf(helpSheetGroups()).map(r => r.does))
    for (const action of EDITOR_ACTIONS) {
      expect(documented.has(action.does)).toBe(true)
    }
  })

  it('renders every declared group, in the design\'s order', () => {
    expect(helpSheetGroups().map(g => g.id)).toEqual(SHORTCUT_GROUPS.map(g => g.id))
  })

  it('gives every row a non-empty chord and description', () => {
    for (const row of rowsOf(helpSheetGroups())) {
      expect(row.chord.length).toBeGreaterThan(0)
      expect(row.does.length).toBeGreaterThan(0)
    }
  })
})

describe('the play rows read live data, not key literals', () => {
  it('names the bound ability and its CURRENT key', () => {
    const rebound = [{ slot: 1 as const, key: '7', ability: getAbility('fire-slash')! }]
    const row = helpSheetGroups({ abilities: rebound }).flatMap(g => g.rows).find(r => r.does.includes('Fire Slash'))
    expect(row?.chord).toBe('7')
  })

  it('falls back to the default loadout when none is passed', () => {
    const chords = helpSheetGroups().flatMap(g => g.rows).map(r => r.chord)
    expect(chords).toContain(defaultAbilityLoadout()[0].key)
  })

  it('lists the quick-slot keys it is given', () => {
    const rows = helpSheetGroups({ specialKeys: ['5', '6'] }).flatMap(g => g.rows)
    expect(rows.some(r => r.chord === '5 – 6')).toBe(true)
  })
})

describe('MOVE_KEYS is the single movement binding the play loop reads', () => {
  it('binds all four screen directions', () => {
    expect(MOVE_KEYS.map(([, dir]) => dir)).toEqual(['up', 'down', 'left', 'right'])
  })

  it('accepts both the arrow key and its WASD twin', () => {
    expect(MOVE_KEYS[0][0]).toEqual(['ArrowUp', 'w'])
    expect(MOVE_KEYS[3][0]).toEqual(['ArrowRight', 'd'])
  })

  it('documents itself in the sheet', () => {
    const rows = helpSheetGroups().flatMap(g => g.rows)
    expect(rows.some(r => r.chord.includes('W') && r.does === 'move')).toBe(true)
  })
})
