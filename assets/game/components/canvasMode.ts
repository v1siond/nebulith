/**
 * THE CANVAS MODE — what will my next click do?
 *
 * Design principle §4.1.7: "Modes are visible on the canvas, not implied by which panel is open."
 * §4.9 turns that into a small always-visible chip that states the current mode AND its one
 * non-obvious gesture (Alt-click erases, click a cell, Shift+drag for many).
 *
 * Pure, so the wording is testable and the chip cannot disagree with the canvas: the precedence
 * below is the SAME order `templates.tsx` derives `editorMode` in — connector > composition >
 * character > paint > select. A chip that ranked them differently would describe a click the canvas
 * does not make.
 */
import { type EntityTool } from './editorConfig'

/** The armed-tool state the chip reads. Everything else about the editor is irrelevant to it. */
export interface CanvasModeState {
  /** Connector authoring is on — a canvas click adds/edits a connection. */
  connectorMode: boolean
  /** The composition kind armed for stamping (`house_4`, `fountain`…), or null. */
  buildingTool: string | null
  /** The armed character tool — a kind to place, `erase`, `collision`, or null. */
  entityTool: EntityTool
  /** The label of the tile the paint brush holds, or null when the brush is empty. */
  armedTileLabel: string | null
}

/** One chip: an icon, what mode you are in, and how to work it. */
export interface CanvasModeChip {
  glyph: string
  what: string
  how: string
}

/** How you leave any armed mode. Every armed chip ends with it (§4.9's chips all do). */
const ESCAPE_HINT = 'Esc'

/** What each character tool DOES, spelled out. A dispatch map rather than an article-guessing template:
 *  "erase" is a verb not a kind, and the right article differs per kind ("the player", "an npc"). Typed
 *  as a total Record so adding an `EntityKind` is a compile error here until it has a sentence. */
const CHARACTER_MODES: Record<NonNullable<EntityTool>, string> = {
  player: 'Placing the player',
  npc: 'Placing an npc',
  enemy: 'Placing an enemy',
  erase: 'Removing characters',
  collision: 'Blocking cells',
}

/**
 * Describe the armed mode. Guard clauses in canvas precedence order — the first armed tool wins,
 * exactly as the canvas handlers resolve a click.
 */
export function describeCanvasMode(state: CanvasModeState): CanvasModeChip {
  if (state.connectorMode) {
    return { glyph: '↗', what: 'Placing a connection', how: `click a cell · ${ESCAPE_HINT}` }
  }
  if (state.buildingTool) {
    return { glyph: '⧉', what: `Placing "${state.buildingTool}"`, how: `click a cell · ${ESCAPE_HINT}` }
  }
  if (state.entityTool) {
    return { glyph: '☻', what: CHARACTER_MODES[state.entityTool], how: `click a cell · ${ESCAPE_HINT}` }
  }
  if (state.armedTileLabel) {
    return { glyph: '▢', what: `Painting "${state.armedTileLabel}"`, how: `Alt-click erases · ${ESCAPE_HINT}` }
  }
  return { glyph: '↖', what: 'Select', how: 'Shift+drag for many · Alt for cell' }
}
