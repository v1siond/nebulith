/**
 * THE PLAYER-UI PROFILE, from the backend (`GET /api/ui`).
 *
 * The HUD layout, the keybindings and the action bars were frontend literals: `playerUi.data.ts` held the
 * placements and `shortcuts.ts` the keys. They are a profile now, and the one this serves by default IS the
 * UI shipping today — the seed was generated from those files rather than redesigned.
 *
 * Shaped by Alexander's answers to the UI spec, 2026-09-06:
 *
 * - **one profile per game, plus a default** — *"we'd always offer an easy default set"*. Ask for a game's
 *   profile; a game with none gets the default, and that is not a fallback, it is the design.
 * - **the author limits the player** — `playerMay` says which of keys / layout / settings a player may
 *   change, so a locked game and a fully editable one are the same model with different limits.
 * - **unlimited bars, with conditions** — a bar whose `condition` is null is always up; a rule swaps it in.
 * - **desktop AND mobile** — both layouts live in one profile as separate element rows.
 *
 * Read through functions, never a module const: the profile is empty until the backend answers.
 */
import { NEBULITH_API } from '@/lib/nebulithApi'

/** What the engine can bind. Seeded capability, not per-game taste. */
export interface UiAction {
  key: string
  category: string
  label: string
  defaultChord: string | null
  position: number
}

/** One input bound to one action. Several rows for one action IS an alternate binding. */
export interface UiBinding {
  actionKey: string
  input: string
  editable: boolean
  position: number
}

/** Where one HUD element sits, for one form factor. */
export interface UiElement {
  elementKey: string
  form: 'Desktop' | 'Mobile'
  placement: Record<string, unknown>
  editable: boolean
}

/** One button on a bar. `refKey` null is a deliberate blank, not a gap. */
export interface UiBarSlot {
  slot: number
  refKind: string | null
  refKey: string | null
}

/** One action bar. `condition` null means always up. */
export interface UiBar {
  name: string | null
  position: number
  rows: number
  cols: number
  settings: Record<string, unknown>
  condition: Record<string, unknown> | null
  slots: UiBarSlot[]
}

export interface UiProfile {
  key: string
  name: string
  gameId: string | null
  playerMay: Record<string, boolean>
  bindings: UiBinding[]
  elements: UiElement[]
  bars: UiBar[]
}

let ACTIONS: readonly UiAction[] = []
let PROFILE: UiProfile | null = null

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** Install a served payload. Exported so tests and the loader share one way in. */
export function installUiProfile(body: unknown): void {
  const data = isObject(body) && isObject(body.data) ? body.data : undefined
  ACTIONS = Array.isArray(data?.actions) ? (data.actions as UiAction[]) : []
  PROFILE = isObject(data?.profile) ? (data.profile as unknown as UiProfile) : null
}

/** Fetch and install the profile in force for a game (or the default when no game is given). */
export async function loadUiProfile(gameId?: string): Promise<void> {
  try {
    const url = gameId ? `${NEBULITH_API}/ui?game=${encodeURIComponent(gameId)}` : `${NEBULITH_API}/ui`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    installUiProfile(await res.json())
  } catch (error) {
    console.warn('[ui] the player-UI profile could not be loaded — the HUD has no layout', error)
  }
}

/** Every bindable action, in menu order. Empty until the backend answers. */
export function uiActions(): readonly UiAction[] {
  return ACTIONS
}

/** The profile in force, or null until the backend answers. */
export function uiProfile(): UiProfile | null {
  return PROFILE
}

/** Every binding for one action — more than one is an alternate. */
export function bindingsFor(actionKey: string): readonly UiBinding[] {
  return (PROFILE?.bindings ?? []).filter(b => b.actionKey === actionKey)
}

/** The placements for one form factor, keyed by element. */
export function layoutFor(form: 'Desktop' | 'Mobile'): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {}
  for (const e of PROFILE?.elements ?? []) {
    if (e.form === form) out[e.elementKey] = e.placement
  }
  return out
}

/** The bars that are UP, given what is currently true. A bar with no condition is always up. */
export function activeBars(is: (condition: Record<string, unknown>) => boolean): readonly UiBar[] {
  return (PROFILE?.bars ?? []).filter(b => b.condition === null || is(b.condition))
}

/** Whether the author lets a player change this. Absent permission is NO permission. */
export function playerMay(what: 'keys' | 'layout' | 'settings'): boolean {
  return PROFILE?.playerMay?.[what] === true
}
