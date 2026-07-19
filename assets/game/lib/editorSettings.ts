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

/** The whole store: modal id → its saved geometry. */
export type EditorSettings = Record<string, PanelGeometry>

const BASE = `${NEBULITH_API}/editor_settings`

/** Load every saved panel geometry as a `key → {x,y,w,h}` map (called once on editor mount). */
export async function getEditorSettings(): Promise<EditorSettings> {
  const res = await fetch(BASE)
  if (!res.ok) throw new Error(`Failed to load editor settings: ${res.statusText}`)
  const data = await res.json()
  return (data.editorSettings ?? {}) as EditorSettings
}

/** Upsert one panel's geometry under its modal id (called on drag/resize end, debounced). */
export async function saveEditorSetting(key: string, value: PanelGeometry): Promise<PanelGeometry> {
  const res = await fetch(`${BASE}/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  })
  if (!res.ok) throw new Error(`Failed to save editor setting "${key}": ${res.statusText}`)
  const data = await res.json()
  return data.value as PanelGeometry
}
