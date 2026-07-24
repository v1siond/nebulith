/**
 * isoEditorCamera — the map editor's ISO camera and its two projections, in ONE pure seam.
 *
 * WHY it exists: the editor page (templates.tsx) used to re-derive the iso diamond math inline in BOTH
 * `screenToCell` (click → cell) and `cellToCanvas` (cell → the pixel overlays anchor at). Those copies were
 * facing-blind, so the moment the camera rotated (#75) a click resolved to a mirrored/transposed cell and the
 * quick-action toolbar drifted off the selection. Everything here delegates to the engine's `isoViewFocus` /
 * `isoWorldCellToScreen` / `isoScreenToWorldCell` — the SAME functions `render()` draws with — so the click,
 * the overlays and the pixels read one camera and cannot drift apart.
 *
 * Pure and dependency-free of React/canvas: the page passes what it knows at click time, this returns numbers.
 */
import { isoViewFocus, isoWorldCellToScreen, isoScreenToWorldCell, type IsoFlatCamera } from '@/engine/render/iso'
import type { Orientation } from '@/engine/render/isoOrientation'

/** Everything the editor knows about the live iso frame. Mirrors what the RAF loop hands `render()`. */
export interface IsoEditorView {
  /** Canvas BACKING-STORE size — the space the render and the tile registry work in (not CSS pixels). */
  canvasW: number
  canvasH: number
  cellSize: number
  /** The ZOOMED iso scale the render uses: `grid.isoScale * isoZoom`. */
  isoScale: number
  /** The followed player, in world units (the render's camera target). */
  playerX: number
  playerZ: number
  /** Drag-to-pan offset, in world units. */
  camOffsetX: number
  camOffsetY: number
  cols: number
  rows: number
  /** Which of the map's 4 corners the camera looks from — quarter-turns CW. 0 = the default view. */
  facing: Orientation
  /** The render clamps the camera to the map ONLY in play mode; dev mode pans freely. Must match it. */
  clampCamera: boolean
}

/** Half the diamond's height in screen px — the offset the editor's cell anchor sits below the centre. */
function tileHalfHeight(v: IsoEditorView): number {
  return v.cellSize * v.isoScale * 0.36
}

/** The flat iso camera for this frame: the viewport, the cell size, the zoomed scale and the VIEW-FRAME focus
 *  (rotated by `facing`, then clamped against the ORIENTED dims — an odd facing swaps cols/rows). */
export function isoEditorCamera(v: IsoEditorView): IsoFlatCamera {
  const pPad = v.canvasW / (2 * v.cellSize * v.isoScale * 0.71)
  const qPad = v.canvasH / (2 * v.cellSize * v.isoScale * 0.36)
  // Same split as the render: orient the player focus, apply the pan (camOffset) un-rotated — so a click
  // resolves to the same cell whatever the camera facing, and the pan never spins the picker either.
  const { fc, fr } = isoViewFocus(v.playerX / v.cellSize, v.playerZ / v.cellSize, v.camOffsetX / v.cellSize, v.camOffsetY / v.cellSize, pPad, qPad, v.cols, v.rows, v.facing, v.clampCamera)
  return { w: v.canvasW, h: v.canvasH, cellSize: v.cellSize, isoScale: v.isoScale, fc, fr }
}

/** Canvas-internal pixel → the WORLD cell under it. Out-of-bounds results are returned as-is; the caller
 *  decides whether a cell off the map is a miss. */
export function isoEditorCellAt(x: number, y: number, v: IsoEditorView): { col: number; row: number } {
  return isoScreenToWorldCell(x, y, isoEditorCamera(v), v.cols, v.rows, v.facing)
}

/** WORLD cell → the canvas-internal point the editor anchors its overlays at.
 *  WHY it is not the diamond centre: the page has always projected the cell's `(col+0.5, row+0.5)` corner —
 *  the halves cancel in x and add exactly one tile-height in y, landing on the ground diamond's FRONT vertex.
 *  Kept bit-identical so the quick-action toolbar and the marquee's coverage test stay where they were. */
export function isoEditorCellAnchor(col: number, row: number, v: IsoEditorView): { x: number; y: number } {
  const p = isoWorldCellToScreen(col, row, isoEditorCamera(v), v.cols, v.rows, v.facing)
  return { x: p.x, y: p.y + tileHalfHeight(v) }
}
