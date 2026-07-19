/**
 * REAL-CANVAS tests for the composition placement GHOST — the translucent shadow drawn at the hovered cell
 * BEFORE the click so you see the footprint (how many cells/blocks) and roughly how it looks. Rendered to a
 * real rasteriser and read back in PIXELS:
 *   • ISO: each footprint cell paints a translucent tinted diamond; a raised outline gives a volume hint;
 *   • the tint reads the "can I drop it here?" state — GREEN when valid, RED when blocked;
 *   • FLAT (top-down): each footprint cell paints a translucent tinted square at its screen position;
 *   • an empty footprint draws nothing (nothing armed → no ghost).
 */
import { installRealCanvas, type RealCanvasHarness } from '@/__tests__/helpers/realCanvas'
import { drawCompositionGhostIso } from '@/engine/render/iso'
import { drawCompositionGhostFlat, compositionGhostColors, type CompositionGhost } from '@/engine/render/shared'
import type { Canvas } from '@napi-rs/canvas'

let H: RealCanvasHarness

beforeAll(() => { H = installRealCanvas().harness })

/** Count opaque (alpha ≥ 40) pixels in a sub-rect that read GREEN (g clearly over r) vs RED (r clearly over g). */
function tintCounts(canvas: Canvas, x: number, y: number, w: number, h: number): { opaque: number; green: number; red: number } {
  const { data } = canvas.getContext('2d').getImageData(x, y, w, h)
  let opaque = 0, green = 0, red = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 40) continue
    opaque++
    const r = data[i], g = data[i + 1]
    if (g > r + 20) green++
    if (r > g + 20) red++
  }
  return { opaque, green, red }
}

// A simple, invertible iso projection for the test — col/row → screen. Half-diamond 40×20, 24px per level.
const TW = 40, TH = 20, HS = 24
const toScreen = (col: number, row: number) => ({ x: 200 + (col - row) * TW, y: 160 + (col + row) * TH })

describe('ISO ghost: translucent footprint diamonds, green when valid / red when blocked', () => {
  test('a VALID single-cell ghost paints GREEN over its footprint cell', () => {
    const cv = H.makeCanvas(400, 320)
    const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D
    const ghost: CompositionGhost = { cells: [{ col: 3, row: 3 }], valid: true, height: 2 }
    drawCompositionGhostIso(ctx, ghost, toScreen, TW, TH, HS)
    const p = toScreen(3, 3) // diamond centre
    const t = tintCounts(cv, p.x - TW, p.y - TH - HS, TW * 2, TH * 2 + HS)
    expect(t.opaque).toBeGreaterThan(0)   // the ghost drew something
    expect(t.green).toBeGreaterThan(0)    // and it reads green (valid)
    expect(t.red).toBe(0)                 // not red
  })

  test('a BLOCKED (invalid) ghost paints RED instead — the same footprint, a different read', () => {
    const cv = H.makeCanvas(400, 320)
    const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D
    const ghost: CompositionGhost = { cells: [{ col: 3, row: 3 }], valid: false, height: 2 }
    drawCompositionGhostIso(ctx, ghost, toScreen, TW, TH, HS)
    const p = toScreen(3, 3)
    const t = tintCounts(cv, p.x - TW, p.y - TH - HS, TW * 2, TH * 2 + HS)
    expect(t.opaque).toBeGreaterThan(0)
    expect(t.red).toBeGreaterThan(0)      // reads red (blocked)
    expect(t.green).toBe(0)
  })

  test('a multi-cell footprint paints at EACH cell (both cells drawn, not just one)', () => {
    const cv = H.makeCanvas(400, 320)
    const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D
    const ghost: CompositionGhost = { cells: [{ col: 2, row: 2 }, { col: 4, row: 2 }], valid: true, height: 1 }
    drawCompositionGhostIso(ctx, ghost, toScreen, TW, TH, HS)
    const a = toScreen(2, 2), b = toScreen(4, 2)
    expect(tintCounts(cv, a.x - TW, a.y - TH, TW * 2, TH * 2).green).toBeGreaterThan(0)
    expect(tintCounts(cv, b.x - TW, b.y - TH, TW * 2, TH * 2).green).toBeGreaterThan(0)
  })

  test('an EMPTY footprint draws nothing (nothing armed → no ghost)', () => {
    const cv = H.makeCanvas(400, 320)
    const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D
    drawCompositionGhostIso(ctx, { cells: [], valid: true, height: 1 }, toScreen, TW, TH, HS)
    expect(tintCounts(cv, 0, 0, 400, 320).opaque).toBe(0)
  })
})

describe('FLAT ghost (top-down): a translucent tinted square per footprint cell', () => {
  const cellTL = (col: number, row: number) => ({ x: 10 + col * 24, y: 10 + row * 24 })

  test('a valid footprint paints GREEN squares at each cell', () => {
    const cv = H.makeCanvas(240, 160)
    const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D
    const ghost: CompositionGhost = { cells: [{ col: 2, row: 2 }, { col: 3, row: 2 }], valid: true, height: 1 }
    drawCompositionGhostFlat(ctx, ghost, cellTL, 24)
    for (const c of ghost.cells) {
      const p = cellTL(c.col, c.row)
      const t = tintCounts(cv, p.x, p.y, 24, 24)
      expect(t.opaque).toBeGreaterThan(0)
      expect(t.green).toBeGreaterThan(0)
    }
  })

  test('an invalid footprint paints RED squares', () => {
    const cv = H.makeCanvas(240, 160)
    const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D
    drawCompositionGhostFlat(ctx, { cells: [{ col: 2, row: 2 }], valid: false, height: 1 }, cellTL, 24)
    const p = cellTL(2, 2)
    const t = tintCounts(cv, p.x, p.y, 24, 24)
    expect(t.red).toBeGreaterThan(0)
    expect(t.green).toBe(0)
  })
})

describe('compositionGhostColors — the validity tint contract', () => {
  test('valid is a green fill/edge; invalid is a red fill/edge', () => {
    const ok = compositionGhostColors(true)
    const bad = compositionGhostColors(false)
    expect(ok.fill).toMatch(/rgba\(90, 220, 140/)  // green
    expect(bad.fill).toMatch(/rgba\(240, 90, 90/)  // red
    expect(ok).not.toEqual(bad)
  })
})
