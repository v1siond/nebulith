/**
 * Editor UI settings client — backend-owned editor chrome state (nebulith `/api/editor_settings`).
 *
 * A tiny key→value store: the key is a stable modal id ("settings" / "animation" / "triggers"),
 * the value is a floating panel's remembered geometry `{x,y,w,h}`. The backend owns this so the
 * editor never hardcodes panel positions — on mount it loads the whole map once, and on every
 * move/resize it upserts the one key (debounced by the caller).
 */
import { NEBULITH_API } from './nebulithApi'

/** A floating panel's saved position + size (screen px). */
export interface PanelGeometry {
  x: number
  y: number
  w: number
  h: number
}

/** A scalar editor setting — the player camera range, a section's open/closed state, … `null` means the
 *  user explicitly turned it OFF, which is different from never having set it. */
export interface SettingValue {
  value: number | string | boolean | null
}

/** Anything the store may hold under a key. The backend column is `:map` (jsonb) and always was — the
 *  frontend simply never modelled more than panel geometry, which is why the camera range had nowhere to
 *  live (§5.1 #7). */
export type EditorSettingValue = PanelGeometry | SettingValue

/** The whole store: setting key → its saved value. */
export type EditorSettings = Record<string, EditorSettingValue>

/** A stored NUMBER, or undefined when the key is unset, cleared, or malformed. A shared store must never
 *  hand the editor a value it cannot use — a bad row is dropped, exactly as a bad games payload is. */
export function readNumberSetting(settings: EditorSettings, key: string): number | undefined {
  const stored = settings[key] as SettingValue | undefined
  if (!stored || typeof stored !== 'object') return undefined
  const value = (stored as SettingValue).value
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** A stored BOOLEAN, or undefined when the key is unset or holds something else.
 *
 * `undefined` and `false` must stay distinguishable: a section the user has never touched takes its
 * designed default (§4.7 opens three of six), while one they explicitly closed stays closed. Collapsing
 * the two would re-open every section on the next reload.
 */
export function readBooleanSetting(settings: EditorSettings, key: string): boolean | undefined {
  const stored = settings[key] as SettingValue | undefined
  if (!stored || typeof stored !== 'object') return undefined
  const value = (stored as SettingValue).value
  return typeof value === 'boolean' ? value : undefined
}

/** A stored panel GEOMETRY, or undefined when the key holds something else. Partial rectangles are
 *  rejected: half a geometry would place a panel off-screen. */
export function readGeometrySetting(settings: EditorSettings, key: string): PanelGeometry | undefined {
  const stored = settings[key] as PanelGeometry | undefined
  if (!stored || typeof stored !== 'object') return undefined
  const { x, y, w, h } = stored
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
  return num(x) && num(y) && num(w) && num(h) ? { x, y, w, h } : undefined
}

const BASE = `${NEBULITH_API}/editor_settings`

/** Load every saved panel geometry as a `key → {x,y,w,h}` map (called once on editor mount). */
export async function getEditorSettings(): Promise<EditorSettings> {
  const res = await fetch(BASE)
  if (!res.ok) throw new Error(`Failed to load editor settings: ${res.statusText}`)
  const data = await res.json()
  return (data.editorSettings ?? {}) as EditorSettings
}

/** Upsert ONE setting under its key (a panel geometry on drag/resize end, a scalar on change). */
export async function saveEditorSetting<T extends EditorSettingValue>(key: string, value: T): Promise<T> {
  const res = await fetch(`${BASE}/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  })
  if (!res.ok) throw new Error(`Failed to save editor setting "${key}": ${res.statusText}`)
  const data = await res.json()
  return data.value as T
}
