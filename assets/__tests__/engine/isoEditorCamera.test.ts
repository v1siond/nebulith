/**
 * THE EDITOR'S ISO CAMERA under 4-way rotation (ticket #75).
 *
 * Alexander: "the rotate button or action … just rotates the map horizontally, changing the front perspective
 * of the map and showing a different side of it" / "we can rotate the corners, 4 corners, 4 rotation options,
 * all faces of the map are visible."
 *
 * `iso.ts` already rotates the RENDER (isoCameraRotation.test.ts covers that). The editor page carried its OWN
 * copy of the iso math in `screenToCell` and `cellToCanvas` — facing-blind, so on a rotated map a click landed
 * on a mirrored/transposed cell and the on-canvas toolbar drifted off the selection. `isoEditorCamera` is that
 * math extracted into one pure seam both call sites now read, so this file can prove:
 *
 *   1. Facing 0 is INERT — the seam reproduces, to the bit, the formulas the page used before (clamped AND
 *      unclamped, since the render clamps only in play mode).
 *   2. The anchor the editor draws overlays at is the RENDER's own diamond centre, one tile-height down — at
 *      every facing, checked against a real render()'s recorded silhouettes, not against itself.
 *   3. screen→cell is the EXACT inverse of cell→screen at all 4 facings, for every cell of a NON-SQUARE map
 *      (an odd facing swaps the view dims, so a dims bug cannot hide behind a square).
 *   4. Rotating really re-maps the screen: one fixed pixel resolves to a different world cell per facing.
 *
 * Deterministic camera idiom copied from isoCameraRotation.test.ts: cellSize 100 / isoScale 1, so every
 * expected pixel is exact.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { isoEditorCamera, isoEditorCellAt, isoEditorCellAnchor, type IsoEditorView } from '@/game/editor/isoEditorCamera'
import { render, isoRecordedGeom, isoWorldCellToScreen } from '@/engine/render/iso'
import { isoCameraFocus } from '@/engine/render/shared'
import type { Orientation } from '@/engine/render/isoOrientation'
import { IsometricGrid, type GridAsset } from '@/engine/IsometricGrid'
import { ASCII_STYLE } from '@/game/artStyle'
import type { PlayerState } from '@/game/runtime/player'

const CELL = 100, W = 800, H = 600, ISO = 1
const TILE_H = CELL * ISO * 0.36
// Non-square on purpose — an odd facing swaps the view dims.
const COLS = 5, ROWS = 3
const PCOL = 2, PROW = 1 // the camera sits on the map centre, its own centre in every oriented frame
const FACINGS: Orientation[] = [0, 1, 2, 3]
const CORNERS: readonly [number, number][] = [[0, 0], [COLS - 1, 0], [COLS - 1, ROWS - 1], [0, ROWS - 1]]

const view = (facing: Orientation, clampCamera = false): IsoEditorView => ({
  canvasW: W, canvasH: H, cellSize: CELL, isoScale: ISO,
  playerX: PCOL * CELL, playerZ: PROW * CELL, camOffsetX: 0, camOffsetY: 0,
  cols: COLS, rows: ROWS, facing, clampCamera,
})

// ── The EXACT formulas templates.tsx carried inline before the extraction (facing-blind, facing 0 only) ──
function legacyFocus(v: IsoEditorView): { fc: number; fr: number } {
  const S = v.isoScale * 0.71, T = v.isoScale * 0.36
  const pPad = v.canvasW / (2 * v.cellSize * S)
  const qPad = v.canvasH / (2 * v.cellSize * T)
  const rawFc = (v.playerX - v.camOffsetX) / v.cellSize
  const rawFr = (v.playerZ - v.camOffsetY) / v.cellSize
  return v.clampCamera ? isoCameraFocus(rawFc, rawFr, pPad, qPad, v.cols, v.rows) : { fc: rawFc, fr: rawFr }
}

function legacyScreenToCell(x: number, y: number, v: IsoEditorView): { col: number; row: number } {
  const S = v.isoScale * 0.71, T = v.isoScale * 0.36
  const { fc, fr } = legacyFocus(v)
  const a = (x - v.canvasW / 2) / S
  const b = (y - v.canvasH / 2) / T
  return {
    col: Math.floor(((a + b) / 2 + fc * v.cellSize) / v.cellSize),
    row: Math.floor(((b - a) / 2 + fr * v.cellSize) / v.cellSize),
  }
}

function legacyCellToCanvas(col: number, row: number, v: IsoEditorView): { x: number; y: number } {
  const S = v.isoScale * 0.71, T = v.isoScale * 0.36
  const { fc, fr } = legacyFocus(v)
  const cc = col + 0.5, rr = row + 0.5
  const a = ((cc - fc) - (rr - fr)) * v.cellSize
  const b = ((cc - fc) + (rr - fr)) * v.cellSize
  return { x: a * S + v.canvasW / 2, y: b * T + v.canvasH / 2 }
}

/** A no-op ctx — the tile GEOMETRY the assertions read is independent of the pixels drawn. */
function mockCtx(): CanvasRenderingContext2D {
  const ctx = {
    fillStyle: '#000', strokeStyle: '#000', font: '', textAlign: '' as CanvasTextAlign,
    textBaseline: '' as CanvasTextBaseline, lineWidth: 1, lineCap: '' as CanvasLineCap, globalAlpha: 1,
    save() {}, restore() {}, rotate() {}, translate() {}, scale() {}, setLineDash() {},
    transform() {}, setTransform() {}, resetTransform() {}, getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } },
    beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, bezierCurveTo() {}, arc() {},
    ellipse() {}, closePath() {}, fill() {}, stroke() {}, clip() {}, rect() {}, drawImage() {},
    createLinearGradient() { return { addColorStop() {} } }, createRadialGradient() { return { addColorStop() {} } },
    createPattern() { return null }, putImageData() {}, getImageData() { return { data: [] } },
    fillRect() {}, strokeRect() {}, fillText() {}, strokeText() {}, measureText() { return { width: 10 } as TextMetrics },
  }
  return ctx as unknown as CanvasRenderingContext2D
}

const cornerBlocks = (): GridAsset[] =>
  CORNERS.map(([col, row]) => ({ art: ['#'], col, row, type: 'wall', label: 'wall', height: 1, color: '#8a8a8a' }))

/** Draw one iso frame with the SAME camera `view(facing)` describes, so the two can be compared. */
function renderIso(facing: Orientation): void {
  const grid = new IsometricGrid({ cols: COLS, rows: ROWS, cellSize: CELL, isoScale: ISO })
  grid.setAssets(cornerBlocks())
  render({
    ctx: mockCtx(), w: W, h: H, grid,
    player: { x: PCOL * CELL, z: PROW * CELL, moving: false } as PlayerState,
    time: 0, camOffset: { x: 0, y: 0 }, entities: [], enemyCombat: new Map(), hitMarkers: [], now: 0,
    zoom: 1, attackAnims: [], connectors: [], quests: [], projectiles: [], dayNight: 'day',
    attackReach: 1, style: ASCII_STYLE, clampCamera: false, cameraFacing: facing,
  })
}

/** The base-diamond centre the RENDERER actually put the block at, read back from its own recorded geometry. */
function drawnAnchor(col: number, row: number): { x: number; y: number } {
  const g = isoRecordedGeom(col, row, 0)
  if (!g || g.kind !== 'cube') throw new Error(`no cube recorded at ${col},${row}`)
  const [left, , right] = g.base
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 }
}

const near = (a: { x: number; y: number }, b: { x: number; y: number }): void => {
  expect(a.x).toBeCloseTo(b.x, 6)
  expect(a.y).toBeCloseTo(b.y, 6)
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('1 — facing 0 is INERT (regression guard: the editor projections the page shipped with)', () => {
  test('isoEditorCellAnchor reproduces the old inline cellToCanvas, clamped and unclamped', () => {
    for (const clamp of [false, true]) {
      const v = view(0, clamp)
      for (let col = 0; col < COLS; col++) {
        for (let row = 0; row < ROWS; row++) near(isoEditorCellAnchor(col, row, v), legacyCellToCanvas(col, row, v))
      }
    }
  })

  test('isoEditorCellAt reproduces the old inline screenToCell, clamped and unclamped', () => {
    for (const clamp of [false, true]) {
      const v = view(0, clamp)
      for (let x = 40; x < W; x += 97) {
        for (let y = 30; y < H; y += 71) {
          expect({ x, y, ...isoEditorCellAt(x, y, v) }).toEqual({ x, y, ...legacyScreenToCell(x, y, v) })
        }
      }
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('2 — the editor camera IS the render camera, at every facing', () => {
  test('the anchor is the RENDERED diamond centre, one tile-height down (the +0.5/+0.5 convention)', () => {
    for (const facing of FACINGS) {
      renderIso(facing)
      const v = view(facing)
      for (const [col, row] of CORNERS) {
        const drawn = drawnAnchor(col, row)
        near(isoEditorCellAnchor(col, row, v), { x: drawn.x, y: drawn.y + TILE_H })
      }
    }
  })

  test('a click on a corner block\'s RENDERED position resolves to THAT world cell, at every facing', () => {
    for (const facing of FACINGS) {
      renderIso(facing)
      const v = view(facing)
      for (const [col, row] of CORNERS) {
        const drawn = drawnAnchor(col, row)
        expect({ facing, ...isoEditorCellAt(drawn.x, drawn.y, v) }).toEqual({ facing, col, row })
      }
    }
  })

  test('isoEditorCamera hands the engine projection the SAME focus, so the two agree cell-for-cell', () => {
    for (const facing of FACINGS) {
      const v = view(facing)
      const cam = isoEditorCamera(v)
      for (let col = 0; col < COLS; col++) {
        for (let row = 0; row < ROWS; row++) {
          const engine = isoWorldCellToScreen(col, row, cam, COLS, ROWS, facing)
          near(isoEditorCellAnchor(col, row, v), { x: engine.x, y: engine.y + TILE_H })
        }
      }
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('3 — screen→cell is the EXACT inverse of cell→screen at all 4 facings', () => {
  test('every cell of the non-square map round-trips, unclamped (dev) and clamped (play)', () => {
    for (const clamp of [false, true]) {
      for (const facing of FACINGS) {
        const v = view(facing, clamp)
        for (let col = 0; col < COLS; col++) {
          for (let row = 0; row < ROWS; row++) {
            const p = isoEditorCellAnchor(col, row, v)
            // The anchor sits a tile-height BELOW the diamond centre — lift back to the centre before picking,
            // exactly as a click on the middle of the cell would.
            expect({ clamp, facing, ...isoEditorCellAt(p.x, p.y - TILE_H, v) }).toEqual({ clamp, facing, col, row })
          }
        }
      }
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('4 — rotating really re-maps the screen (the deorient runs)', () => {
  test('the viewport centre is always the camera cell, but a neighbouring pixel differs per facing', () => {
    expect(isoEditorCellAt(W / 2, H / 2, view(0))).toEqual({ col: PCOL, row: PROW })
    const offCentre = { x: W / 2 + CELL * ISO * 0.71, y: H / 2 }
    const resolved = FACINGS.map(f => JSON.stringify(isoEditorCellAt(offCentre.x, offCentre.y, view(f))))
    expect(new Set(resolved).size).toBe(4)
  })

  test('the back corner (0,0) — unreachable-looking at facing 0 — is picked at its own spot after a half turn', () => {
    renderIso(2)
    const drawn = drawnAnchor(0, 0)
    expect(isoEditorCellAt(drawn.x, drawn.y, view(2))).toEqual({ col: 0, row: 0 })
    // …and its OLD pixel now belongs to the opposite corner: the map really turned.
    renderIso(0)
    const oldSpot = drawnAnchor(0, 0)
    expect(isoEditorCellAt(oldSpot.x, oldSpot.y, view(2))).toEqual({ col: COLS - 1, row: ROWS - 1 })
  })
})
