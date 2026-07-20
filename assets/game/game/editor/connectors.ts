/**
 * CONNECTOR EDITING — the pure decision behind "open the Connectors panel straight into the editing view".
 *
 * Opening the panel with an active cell SELECTION should land directly in the authoring FORM (no second
 * click). This module answers that from plain data — given the selected cells and the saved connectors —
 * so the page just applies the result to its React state. Mirrors the canvas connector-click routing:
 *   - a saved connector overlapping the selection LOADS (its whole cell set + its saved form);
 *   - otherwise the selection ITSELF becomes a fresh connector.
 * Kept pure + here so the "one click → editing view" behaviour is unit-testable without the React page.
 */
import type { Connector } from '@/lib/api'

/** A fresh connector form (the default a brand-new connector starts on — matches the canvas click path). */
export const FRESH_CONNECTOR_FORM: Partial<Connector> = { interaction: 'walk', spawnCol: 25, spawnRow: 25, targetTemplateId: '' }

export interface ConnectorEditStart {
  /** the keystone cell to arm as the edited connector (a cell of the selection / loaded connector). */
  editing: { col: number; row: number }
  /** the form to load into the editor — a loaded connector's saved fields, or a fresh default. */
  form: Partial<Connector>
  /** the cells the editor should keep selected (the loaded connector's full set, or the selection as-is). */
  cells: { col: number; row: number }[]
}

/** Decide how opening the Connectors panel should ENTER the editing view for the ACTIVE selection, so the
 *  panel shows the authoring form on the first click. Returns null when there is NO selection — the panel
 *  then just stays armed (authoring on), ready for the user to click a cell and draw. */
export function connectorEditFromSelection(
  selected: readonly { col: number; row: number }[],
  connectors: readonly Connector[],
): ConnectorEditStart | null {
  if (selected.length === 0) return null
  const existing = connectors.find(c => c.cells.some(p => selected.some(s => s.col === p.col && s.row === p.row)))
  if (existing) {
    const [keystone] = existing.cells
    return { editing: { col: keystone.col, row: keystone.row }, form: { ...existing }, cells: existing.cells }
  }
  const [keystone] = selected
  return { editing: { col: keystone.col, row: keystone.row }, form: { ...FRESH_CONNECTOR_FORM }, cells: [...selected] }
}
