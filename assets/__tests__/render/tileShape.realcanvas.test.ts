/**
 * REAL-CANVAS tests for the per-tile SHAPE setting (`shape: 'square' | 'circle'`) — the "renderer builds a
 * shaded ball" approach.
 *
 * MODEL: just as the iso renderer extrudes a CUBE from a tile, `shape: 'circle'` makes it build a shaded BALL
 * in the SAME volume, TINTED by the tile's colour setting — one code path for every tile + style, NOT a flat
 * masked disc and NOT new baked art. These render to a real rasteriser (@napi-rs/canvas) and read the PIXELS:
 *   • the ball is ROUND (its bounding-box corners are transparent; a rect would fill them) and its centre is filled;
 *   • the ball is SHADED (a bright highlight up-left, a dark rim — a 3D sphere, not a flat disc);
 *   • the colour SETTING drives the ball (a magenta tile → a magenta ball; a green baked image never bleeds
 *     through — the ball is a shaded solid), in BOTH emoji + ascii styles, positive + negative.
 */
import { installRealCanvas, type RealCanvasHarness } from '@/__tests__/helpers/realCanvas'
import { drawIsoBall, drawIsoAssetAscii } from '@/engine/render/iso'
import { EMOJI_STYLE, ASCII_STYLE } from '@/game/artStyle'
import { EMOJI_TILESET } from '@/engine/tileset/emojiTileset'
import type { GridAsset } from '@/engine/IsometricGrid'
import type { Canvas } from '@napi-rs/canvas'

let H: RealCanvasHarness

const MAGENTA = '#ff00ff'
const GREEN = '#00c800'

// Ball geometry — the SAME dims the display-mode cube test uses. drawIsoBall inscribes the ball in the cube's
// volume: rx = TW, ry = BH/2 + TH, centred at (CX, CY - BH/2). So:
const TW = 40, TH = 20, BH = 44, CX = 140, CY = 190
const RX = TW, RY = BH / 2 + TH        // 40, 42
const BCX = CX, BCY = CY - BH / 2      // 140, 168
// The ball's tight bounding box.
const BB = { x: BCX - RX, y: BCY - RY, w: 2 * RX, h: 2 * RY } // {100,126,80,84}

beforeAll(() => { H = installRealCanvas().harness })

/** Opaque-pixel count in a sub-rect (alpha ≥ 128). */
function regionOpaque(canvas: Canvas, x: number, y: number, w: number, h: number): number {
  const { data } = canvas.getContext('2d').getImageData(x, y, w, h)
  let n = 0
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] >= 128) n++
  return n
}
/** Mean luminance of the opaque pixels in a sub-rect (0 when none) — the shading probe. */
function regionMeanLum(canvas: Canvas, x: number, y: number, w: number, h: number): number {
  const { data } = canvas.getContext('2d').getImageData(x, y, w, h)
  let sum = 0, n = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; n++
  }
  return n ? sum / n : 0
}

describe('shape = circle: the renderer builds a ROUND, filled ball (not a square)', () => {
  test('the centre is filled but every bounding-box CORNER is transparent — a disc, not a rectangle', () => {
    const cv = H.makeCanvas(300, 280)
    const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D
    drawIsoBall(ctx, { x: CX, y: CY }, TW, TH, BH, 1, { char: 'o', color: MAGENTA }, MAGENTA)
    // Centre of the ball → solid fill.
    expect(regionOpaque(cv, BCX - 5, BCY - 5, 10, 10)).toBeGreaterThan(90) // ~all 100 px opaque
    // All four corners of the ball's bounding box → EMPTY (a cube/rect would paint pixels here).
    expect(regionOpaque(cv, BB.x, BB.y, 10, 10)).toBe(0)                       // top-left
    expect(regionOpaque(cv, BB.x + BB.w - 10, BB.y, 10, 10)).toBe(0)           // top-right
    expect(regionOpaque(cv, BB.x, BB.y + BB.h - 10, 10, 10)).toBe(0)           // bottom-left
    expect(regionOpaque(cv, BB.x + BB.w - 10, BB.y + BB.h - 10, 10, 10)).toBe(0) // bottom-right
  })

  test('the ball fills ~π/4 of its bounding box (the disc signature) — far less than a solid rectangle', () => {
    const ballCv = H.makeCanvas(300, 280)
    drawIsoBall(ballCv.getContext('2d') as unknown as CanvasRenderingContext2D, { x: CX, y: CY }, TW, TH, BH, 1, { char: 'o', color: MAGENTA }, MAGENTA)
    const ballFill = regionOpaque(ballCv, BB.x, BB.y, BB.w, BB.h) / (BB.w * BB.h)
    expect(ballFill).toBeGreaterThan(0.66) // an ellipse ≈ π/4 ≈ 0.785
    expect(ballFill).toBeLessThan(0.88)    // clearly NOT a full rectangle

    // Contrast: a solid rectangle over the SAME box fills nearly all of it — proves the ratio test discriminates.
    const rectCv = H.makeCanvas(300, 280)
    const rctx = rectCv.getContext('2d') as unknown as CanvasRenderingContext2D
    rctx.fillStyle = MAGENTA
    rctx.fillRect(BB.x, BB.y, BB.w, BB.h)
    expect(regionOpaque(rectCv, BB.x, BB.y, BB.w, BB.h) / (BB.w * BB.h)).toBeGreaterThan(0.98)
  })

  test('the ball is SHADED like a sphere — the up-left highlight is brighter than the down-right rim', () => {
    const cv = H.makeCanvas(300, 280)
    drawIsoBall(cv.getContext('2d') as unknown as CanvasRenderingContext2D, { x: CX, y: CY }, TW, TH, BH, 1, { char: 'o', color: MAGENTA }, MAGENTA)
    const highlight = regionMeanLum(cv, Math.round(BCX - RX * 0.35) - 4, Math.round(BCY - RY * 0.4) - 4, 8, 8)
    const rim = regionMeanLum(cv, Math.round(BCX + RX * 0.5) - 4, Math.round(BCY + RY * 0.5) - 4, 8, 8)
    expect(highlight).toBeGreaterThan(rim + 20) // a real luminance gradient (3D), not one flat fill
  })
})

describe('shape = circle honours the colour SETTING per style (emoji + ascii), positive + negative', () => {
  const LABEL = '__shape_water__'
  const SRC = '/tiles/emoji/__shape_water.png'
  const asset = (over: Partial<GridAsset>): GridAsset => ({ art: ['o'], col: 3, row: 3, type: 'water', height: 1, label: LABEL, scale: 3, shape: 'circle', ...over })

  beforeAll(async () => {
    EMOJI_TILESET[LABEL] = { char: '🌊', color: '#2f6fbf', image: SRC, height: 1 }
    H.registerSolid(SRC, GREEN) // a GREEN baked tile — the ball must NEVER show it (it's a shaded solid)
    await H.warm([SRC])
  })
  afterAll(() => { delete EMOJI_TILESET[LABEL] })

  test('emoji: a MAGENTA-colour tile → a MAGENTA ball; the GREEN baked image never bleeds through', () => {
    const cv = H.makeCanvas(260, 300)
    drawIsoAssetAscii(cv.getContext('2d') as unknown as CanvasRenderingContext2D, 130, 210, asset({ color: MAGENTA }), 30, 15, 0, false, 'day', EMOJI_STYLE)
    const s = H.scan(cv)
    expect(s.opaque).toBeGreaterThan(300) // the ball is drawn
    expect(s.magentaish).toBeGreaterThan(0)
    expect(s.greenish).toBe(0)            // the baked green image is NOT painted onto the ball
  })

  test('ascii: the SAME magenta colour setting drives the ball (one path per style)', () => {
    const cv = H.makeCanvas(260, 300)
    // Default style arg = ASCII_STYLE; pass it explicitly for clarity.
    drawIsoAssetAscii(cv.getContext('2d') as unknown as CanvasRenderingContext2D, 130, 210, asset({ color: MAGENTA }), 30, 15, 0, false, 'day', ASCII_STYLE)
    const s = H.scan(cv)
    expect(s.opaque).toBeGreaterThan(300)
    expect(s.magentaish).toBeGreaterThan(0)
    expect(s.greenish).toBe(0)
  })

  test('negative: with NO colour set, the ball falls back to grey — NOT magenta, and still no green', () => {
    const cv = H.makeCanvas(260, 300)
    drawIsoAssetAscii(cv.getContext('2d') as unknown as CanvasRenderingContext2D, 130, 210, asset({}), 30, 15, 0, false, 'day', EMOJI_STYLE)
    const s = H.scan(cv)
    expect(s.opaque).toBeGreaterThan(300) // still a ball
    expect(s.magentaish).toBe(0)          // no colour setting → not magenta
    expect(s.greenish).toBe(0)            // and the green baked image still never shows
  })
})
