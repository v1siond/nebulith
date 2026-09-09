/**
 * THE SHORTCUT TABLE — one source for the editor's key dispatch AND the `? Help` sheet.
 *
 * The games-page UX design (§4.9) asks for a help sheet "built from ONE exported table so it can
 * never drift from the handlers". A table that only *describes* the handlers is a second copy that
 * rots, so this table IS the dispatcher: the page's keydown chain asks `matchEditorAction(e)` which
 * action fired and runs its effect, and the sheet renders the same rows. Add a shortcut here and
 * both the behaviour and the documentation follow — there is no second list to remember.
 *
 * Three kinds of row live here, because the editor has three kinds of input:
 *   - EDITOR_ACTIONS — dispatched keydown chords the page handles (`matchEditorAction`).
 *   - MOUSE_ROWS     — gestures bound on the canvas element, documented only.
 *   - MOVE_KEYS      — the play loop's key→direction table, imported by the loop itself.
 * Abilities and quick-slot items are not literals at all: they are per-entity loadout DATA, so the
 * sheet reads them live (`helpSheetGroups`) and a rebind shows up in the sheet with no code change.
 *
 * Pure module — no React, no DOM beyond the KeyboardEvent fields it reads.
 */
import { defaultAbilityLoadout, type AbilityBinding } from './abilities'
import { DEFAULT_SPECIAL_KEYS } from './loadout'
import type { MoveDir } from './runtime/cameraMovement'

// ── groups ───────────────────────────────────────────────────────────────────────────────────────

/** The sheet's three columns (§4.9): how you look around, how you edit, how you play. */
export type ShortcutGroupId = 'move' | 'edit' | 'play'

export interface ShortcutGroupDef {
  id: ShortcutGroupId
  title: string
}

/** The groups, in the order the sheet lays them out. */
export const SHORTCUT_GROUPS: readonly ShortcutGroupDef[] = [
  { id: 'move', title: 'Move around' },
  { id: 'edit', title: 'Edit' },
  { id: 'play', title: 'Play' },
]

/** One rendered line of the sheet: what you press, and what it does. */
export interface ShortcutRow {
  chord: string
  does: string
}

export interface ShortcutGroup extends ShortcutGroupDef {
  rows: readonly ShortcutRow[]
}

// ── the dispatched editor keys ───────────────────────────────────────────────────────────────────

/** Every keydown action the editor dispatches. One id per behaviour the page implements. */
export type EditorActionId = 'copy' | 'paste' | 'inventory' | 'quests' | 'randomize' | 'cycleTarget' | 'escape'

export interface EditorAction {
  id: EditorActionId
  /** The `KeyboardEvent.key` values that fire it. Letters list both cases: keydown delivers "I" while
   *  shift is held, and the page's shortcuts are all shift-agnostic. */
  keys: readonly string[]
  /** Requires Ctrl (or Cmd). Chords without it must NOT fire while Ctrl is held, so the two sets
   *  never collide (Ctrl+R is the browser's reload, not the editor's randomize). */
  ctrl?: true
  /** What the sheet shows in the key column. */
  chord: string
  /** What the sheet shows in the action column — also the row's identity in the anti-drift test. */
  does: string
  group: ShortcutGroupId
}

/** The dispatch table. `matchEditorAction` walks it; the sheet prints it. */
export const EDITOR_ACTIONS: readonly EditorAction[] = [
  { id: 'copy', keys: ['c'], ctrl: true, chord: 'Ctrl+C', does: 'copy tiles', group: 'edit' },
  { id: 'paste', keys: ['v'], ctrl: true, chord: 'Ctrl+V', does: 'paste tiles at the cursor', group: 'edit' },
  { id: 'randomize', keys: ['r', 'R'], chord: 'R', does: 'randomize the selection', group: 'edit' },
  { id: 'cycleTarget', keys: ['Tab'], chord: 'Tab', does: 'next enemy (Shift+Tab goes back)', group: 'edit' },
  { id: 'escape', keys: ['Escape'], chord: 'Esc', does: 'disarm, then deselect', group: 'edit' },
  { id: 'inventory', keys: ['i', 'I'], chord: 'I', does: 'inventory', group: 'edit' },
  { id: 'quests', keys: ['q', 'Q'], chord: 'Q', does: 'quest log', group: 'edit' },
]

/** The minimal shape `matchEditorAction` reads — a real `KeyboardEvent` satisfies it. */
interface KeyChord {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  target: EventTarget | null
}

/** Is the event aimed at something the user is TYPING into? Shortcuts must never steal those keys. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null
  if (!el) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true
}

/**
 * Which editor action this keydown fires, or `null` for "not ours — let it through".
 *
 * Guards, in order: never while typing; never with Alt held (Alt is the canvas's erase/cell modifier,
 * so Alt+Ctrl+C must not copy); then Ctrl-ness must match the row exactly.
 */
export function matchEditorAction(e: KeyChord): EditorActionId | null {
  if (isTypingTarget(e.target)) return null
  if (e.altKey) return null
  const ctrl = e.ctrlKey || e.metaKey
  const hit = EDITOR_ACTIONS.find(a => a.keys.includes(e.key) && !!a.ctrl === ctrl)
  return hit ? hit.id : null
}

// ── movement: the play loop's own binding table ──────────────────────────────────────────────────

/**
 * Key → SCREEN direction for the player. The loop reads this directly (`moveWorldDelta` turns the
 * screen direction into a world delta for the current camera facing), so the sheet documents the
 * same array the game moves by. Order is the sheet's reading order: up, down, left, right.
 */
export const MOVE_KEYS: readonly (readonly [readonly string[], MoveDir])[] = [
  [['ArrowUp', 'w'], 'up'],
  [['ArrowDown', 's'], 'down'],
  [['ArrowLeft', 'a'], 'left'],
  [['ArrowRight', 'd'], 'right'],
]

/** Held-key literals the loop reads directly for the non-directional verbs. */
export const SPRINT_KEY = 'Shift'
export const JUMP_KEY = ' '
export const INTERACT_KEYS: readonly string[] = ['e', 'Enter']
export const ATTACK_KEY = 'f'
export const SPECIAL_ATTACK_KEY = 'g'

// ── documented-only rows ─────────────────────────────────────────────────────────────────────────

/** Canvas gestures. Bound as element handlers, not keydown, so they are documented rather than dispatched. */
const MOUSE_ROWS: readonly (ShortcutRow & { group: ShortcutGroupId })[] = [
  { chord: 'Drag', does: 'pan', group: 'move' },
  { chord: 'Wheel', does: 'zoom', group: 'move' },
  { chord: '↻ / drag', does: 'rotate', group: 'move' },
  { chord: 'Click', does: 'select', group: 'edit' },
  { chord: 'Click again', does: 'cycle behind', group: 'edit' },
  { chord: 'Shift+drag', does: 'select many', group: 'edit' },
  { chord: 'Alt+click', does: 'the cell under a unit', group: 'edit' },
  { chord: 'Alt+click', does: 'erase (brush armed)', group: 'edit' },
]

/** Undo/redo live in `useEditorHistory`'s own listener, not the page's chain. */
const HISTORY_ROWS: readonly (ShortcutRow & { group: ShortcutGroupId })[] = [
  { chord: 'Ctrl+Z / Ctrl+Y', does: 'undo / redo', group: 'edit' },
]

/** Held-key play verbs, read straight out of the loop's key accumulator. */
const PLAY_ROWS: readonly (ShortcutRow & { group: ShortcutGroupId })[] = [
  { chord: 'W A S D / ↑ ↓ ← →', does: 'move', group: 'play' },
  { chord: 'Shift', does: 'run', group: 'play' },
  { chord: 'Space', does: 'jump', group: 'play' },
  { chord: 'E', does: 'interact', group: 'play' },
  { chord: 'F / G', does: 'attack / special', group: 'play' },
]

// ── the sheet ────────────────────────────────────────────────────────────────────────────────────

/** What the sheet needs to know about THIS session's rebindable data. */
export interface HelpSheetContext {
  /** The player's ability bindings — each carries its own (rebindable) trigger key. */
  abilities?: readonly AbilityBinding[]
  /** The player's quick-slot trigger keys, in slot order. */
  specialKeys?: readonly string[]
}

/** "5 – 8" for a contiguous run, "5" for one, and the plain list when it is neither. */
function keyRangeChord(keys: readonly string[]): string {
  if (keys.length === 0) return '—'
  if (keys.length === 1) return keys[0]
  return `${keys[0]} – ${keys[keys.length - 1]}`
}

/** One row per bound ability, naming the ability so the sheet says what the key actually casts. */
function abilityRows(abilities: readonly AbilityBinding[]): ShortcutRow[] {
  return abilities.map(b => ({ chord: b.key, does: `${b.ability.name} (ability ${b.slot})` }))
}

/**
 * The sheet, assembled. Every group is present in the declared order even when empty, so the layout
 * never jumps around between an editor session and a play session.
 */
export function helpSheetGroups(ctx: HelpSheetContext = {}): readonly ShortcutGroup[] {
  const abilities = ctx.abilities ?? defaultAbilityLoadout()
  const specialKeys = ctx.specialKeys ?? DEFAULT_SPECIAL_KEYS.slice(0, 4)
  const documented = [...MOUSE_ROWS, ...HISTORY_ROWS, ...PLAY_ROWS]

  const byGroup = (id: ShortcutGroupId): ShortcutRow[] => [
    ...documented.filter(r => r.group === id).map(({ chord, does }) => ({ chord, does })),
    ...EDITOR_ACTIONS.filter(a => a.group === id).map(({ chord, does }) => ({ chord, does })),
    ...(id === 'play' ? abilityRows(abilities) : []),
    ...(id === 'play' ? [{ chord: keyRangeChord(specialKeys), does: 'quick-slot items' }] : []),
  ]

  return SHORTCUT_GROUPS.map(g => ({ ...g, rows: byGroup(g.id) }))
}
