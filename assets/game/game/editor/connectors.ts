/**
 * CONNECTOR EDITING, the pure decision behind "open the Connectors panel straight into the editing view".
 *
 * Opening the panel with an active cell SELECTION should land directly in the authoring FORM (no second
 * click). This module answers that from plain data, given the selected cells and the saved connectors, * so the page just applies the result to its React state. Mirrors the canvas connector-click routing:
 *   - a saved connector overlapping the selection LOADS (its whole cell set + its saved form);
 *   - otherwise the selection ITSELF becomes a fresh connector.
 * Kept pure + here so the "one click → editing view" behaviour is unit-testable without the React page.
 */
import type { Connector } from '@/lib/api'

/** A fresh connector form (the default a brand-new connector starts on, matches the canvas click path). */
export const FRESH_CONNECTOR_FORM: Partial<Connector> = { interaction: 'walk', spawnCol: 25, spawnRow: 25, targetTemplateId: '' }

export interface ConnectorEditStart {
  /** the keystone cell to arm as the edited connector (a cell of the selection / loaded connector). */
  editing: { col: number; row: number }
  /** the form to load into the editor, a loaded connector's saved fields, or a fresh default. */
  form: Partial<Connector>
  /** the cells the editor should keep selected (the loaded connector's full set, or the selection as-is). */
  cells: { col: number; row: number }[]
}

/** Decide how opening the Connectors panel should ENTER the editing view for the ACTIVE selection, so the
 *  panel shows the authoring form on the first click. Returns null when there is NO selection, the panel
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

/**
 * THE CONNECTOR EVERY EXIT IS BORN WITH.
 *
 * *"automatically add rules/triggers to go to another template when reaching the exit cells... I just want to
 * click and select the template"*, and *"I want ALL cells from the exit setup, not 1, not 2, if the pathways
 * has 4 cells width, then we'd setup 4 cells on the exit"*.
 *
 * An exit is the one place on a map whose MEANING is "somewhere else", so it arrives wired: one connector per
 * gate, holding EVERY cell of that gate, on `walk`, with no target. The only thing left to do is pick the
 * template it leads to, which is the single decision that cannot be inferred.
 *
 * The cells come from the plan's own gates, so the count follows the SERVED pathway width by construction:
 * `gateOn` cuts exactly `width` cells and this takes all of them. A width of 4 gives 4, never 3.
 * `GENERATION-SPEC.md` §5.2 puts the width in the structure layer, which is where these come from.
 *
 * Pure: the page applies the result to its React state.
 */
export function exitConnectors(gates: readonly { side: string; cells: readonly { col: number; row: number }[] }[]): Connector[] {
  return gates
    .filter(gate => gate.cells.length > 0)
    .map(gate => ({
      ...FRESH_CONNECTOR_FORM,
      // EVERY cell of the gate, so stepping onto any lane of the way leaves the map, not just the middle one.
      cells: gate.cells.map(({ col, row }) => ({ col, row })),
      interaction: 'walk' as const,
      // Unset on purpose: the target is his to choose, and an invented one would be a wrong answer that looks
      // like a real one.
      targetTemplateId: '',
      spawnCol: FRESH_CONNECTOR_FORM.spawnCol ?? 25,
      spawnRow: FRESH_CONNECTOR_FORM.spawnRow ?? 25,
    }))
}
