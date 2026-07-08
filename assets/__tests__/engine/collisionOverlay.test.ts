/**
 * The iso COLLISION overlay (renderDebugOverlays) must draw its red diamond at the SAME size the ground
 * tiles + building-footprint cubes use — the render's ALREADY-ZOOMED tileW/tileH — so the tints fill each
 * cell edge-to-edge with no gaps at any zoom. The bug this guards: the half-extent used to be recomputed
 * off the UNZOOMED grid.isoScale, so a zoomed-in view drew diamonds SMALLER than the cells (visible gaps).
 *
 * We record the diamond's four vertices and assert its half-extents equal the tileW/tileH passed in — not
 * the grid.isoScale default — and that only a BLOCKED cell tints (a clear cell draws no red).
 */
import { renderDebugOverlays } from '@/engine/render/iso'
import { IsometricGrid } from '@/engine/IsometricGrid'
import type { PlayerState } from '@/game/runtime/player'

interface Filled { style: string; pts: [number, number][] }

// A recording canvas mock: accumulates the current path (moveTo/lineTo) and, on fill(), snapshots the
// fillStyle + the path points so we can read back the collision diamond's exact geometry.
function recordingCtx() {
  const fills: Filled[] = []
  let path: [number, number][] = []
  const ctx = {
    fillStyle: '#000', font: '', textAlign: '' as CanvasTextAlign, textBaseline: '' as CanvasTextBaseline,
    save() {}, restore() {},
    beginPath() { path = [] },
    moveTo(x: number, y: number) { path.push([x, y]) },
    lineTo(x: number, y: number) { path.push([x, y]) },
    closePath() {},
    fill() { fills.push({ style: String(this.fillStyle), pts: path.slice() }) },
    fillRect() {}, fillText() {}, rect() {}, clip() {},
    measureText() { return { width: 10 } as TextMetrics },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills }
}

const RED = 'rgba(255, 0, 0, 0.4)'
const CELL = 16
// Player at cell (10,10) so the scan window (~±6 cells) covers it; the blocked cell renders on-screen.
const player = { x: 10 * CELL, z: 10 * CELL } as PlayerState

// A toScreen that puts ONE target cell at a fixed on-screen centre and shoves every other cell far
// off-canvas, so exactly one red diamond is recorded (the cull in renderDebugOverlays drops the rest).
const centreOn = (col: number, row: number, at: { x: number; y: number }) =>
  (wx: number, wz: number) => (wx / CELL === col && wz / CELL === row ? at : { x: 9999, y: 9999 })

function grid20(): IsometricGrid {
  return new IsometricGrid({ cols: 20, rows: 20, cellSize: CELL, isoScale: 1.4 })
}

describe('renderDebugOverlays — collision diamonds fill cells at the render zoom', () => {
  test('the red diamond half-extents equal the PASSED (zoomed) tileW/tileH, not the grid.isoScale default', () => {
    const grid = grid20()
    grid.setCollision(10, 10, true)
    const { ctx, fills } = recordingCtx()
    const centre = { x: 300, y: 200 }
    // A zoom-inflated size, deliberately unequal to the unzoomed default (16·1.4·0.71 ≈ 15.9 / ·0.36 ≈ 8.06).
    const tileW = 40, tileH = 20

    renderDebugOverlays(ctx, 640, 400, grid, player, centreOn(10, 10, centre), CELL, false, tileW, tileH)

    const red = fills.filter(f => f.style === RED)
    expect(red).toHaveLength(1) // exactly the one blocked cell tinted
    // Diamond vertices in draw order: top, right, bottom, left — each offset from the cell centre by the
    // passed half-extents. This is the fix: the size follows the render's zoomed tileW/tileH.
    expect(red[0].pts).toEqual([
      [centre.x, centre.y - tileH],
      [centre.x + tileW, centre.y],
      [centre.x, centre.y + tileH],
      [centre.x - tileW, centre.y],
    ])
    // Restated as half-extents so a future regression to the unzoomed formula fails loudly.
    const xs = red[0].pts.map(p => p[0]), ys = red[0].pts.map(p => p[1])
    expect(Math.max(...xs) - centre.x).toBe(tileW)
    expect(centre.x - Math.min(...xs)).toBe(tileW)
    expect(Math.max(...ys) - centre.y).toBe(tileH)
    expect(centre.y - Math.min(...ys)).toBe(tileH)
  })

  test('a CLEAR cell draws no red diamond (only blocked cells tint)', () => {
    const grid = grid20() // nothing blocked
    const { ctx, fills } = recordingCtx()
    renderDebugOverlays(ctx, 640, 400, grid, player, centreOn(10, 10, { x: 300, y: 200 }), CELL, false, 40, 20)
    expect(fills.filter(f => f.style === RED)).toHaveLength(0)
  })

  test('back-compat: omitting tileW/tileH falls back to the grid.isoScale diamond (still tints)', () => {
    const grid = grid20()
    grid.setCollision(10, 10, true)
    const { ctx, fills } = recordingCtx()
    renderDebugOverlays(ctx, 640, 400, grid, player, centreOn(10, 10, { x: 300, y: 200 }), CELL, false)
    const red = fills.filter(f => f.style === RED)
    expect(red).toHaveLength(1)
    const xs = red[0].pts.map(p => p[0])
    expect(Math.max(...xs) - 300).toBeCloseTo(CELL * grid.isoScale * 0.71) // the documented default
  })
})
