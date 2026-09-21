/**
 * REAL-CANVAS tests for `shape: 'cone'`.
 *
 * A conifer and a cypress are not round. With only square and circle on offer, every conifer in the
 * catalogue was lying about its silhouette, so the column admits a third shape (docs/SPEC.md §3.2) and
 * the engine has to be able to draw it.
 *
 * MODEL, the same one the ball follows: the tile draws its NORMAL cube, art and per-face shading and
 * all, and a CLIP decides the outline. So a cone is not a repainted solid and needs no lighting of its
 * own; it is the block seen through a tapered hole.
 *
 * What the pixels have to show:
 *   - it TAPERS: the top of the form is much narrower than its base. That is the whole point, and it is
 *     what distinguishes a cone from both the square and the ball.
 *   - it is not the ball: at the very top a cone is narrower than a circle of the same extent.
 *   - it is not the square: a square fills its top corners and a cone does not.
 *   - it still has a BASE with real width, so a cypress is a cone and not a needle.
 *   - the tile's ART survives the clip, a two-band tile still shows both bands.
 */
import { installRealCanvas, type RealCanvasHarness } from '@/__tests__/helpers/realCanvas'
import { drawIsoConeBlock, drawIsoRoundedBlock, drawIsoTileBlock, roundedBlockEllipse } from '@/engine/render/iso'
import type { ImageVisual } from '@/game/artStyle'
import type { Canvas } from '@napi-rs/canvas'

let H: RealCanvasHarness

const GREEN = '#00c800'
const BLUE = '#1030ff'
const BANDS = '/tiles/emoji/__cone_bands.png'

const TW = 40, TH = 20, BH = 44, CX = 140, CY = 190
const { cx: BCX, cy: BCY, rx: RX, ry: RY } = roundedBlockEllipse({ x: CX, y: CY }, TW, TH, BH, 1)

const bandsDv = (): { char: string; color: string; image: ImageVisual } => ({
  char: '?', color: '#ffffff', image: { kind: 'image', src: BANDS },
})

beforeAll(async () => {
  H = installRealCanvas().harness
  H.registerBands(BANDS, GREEN, BLUE)
  await H.warm([BANDS])
})

/** How wide the drawn form is on one scanline: the span between its leftmost and rightmost opaque pixel. */
function widthAtRow(canvas: Canvas, y: number): number {
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D
  const { data, width } = ctx.getImageData(0, y, canvas.width, 1)
  let first = -1
  let last = -1
  for (let x = 0; x < width; x++) {
    if (data[x * 4 + 3] >= 128) {
      if (first < 0) first = x
      last = x
    }
  }
  return first < 0 ? 0 : last - first + 1
}

const drawn = (shape: 'cone' | 'circle' | 'square'): Canvas => {
  const canvas = H.makeCanvas(320, 320)
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D
  const dv = bandsDv()

  if (shape === 'cone') drawIsoConeBlock(ctx, { x: CX, y: CY }, TW, TH, BH, 1, dv, undefined)
  if (shape === 'circle') drawIsoRoundedBlock(ctx, { x: CX, y: CY }, TW, TH, BH, 1, dv, undefined)
  if (shape === 'square') drawIsoTileBlock(ctx, { x: CX, y: CY }, TW, TH, BH, 1, dv, undefined)

  return canvas
}

// A row near the top of the form, and one near its base.
const NEAR_TOP = Math.round(BCY - RY * 0.72)
const NEAR_BASE = Math.round(BCY + RY * 0.55)

describe('shape: cone', () => {
  it('tapers: it is far narrower at the top than at the base', () => {
    const canvas = drawn('cone')
    const top = widthAtRow(canvas, NEAR_TOP)
    const base = widthAtRow(canvas, NEAR_BASE)

    expect(base).toBeGreaterThan(0)
    expect(top).toBeLessThan(base * 0.6)
  })

  it('still has a base with real width, so a cypress is a cone and not a needle', () => {
    const base = widthAtRow(drawn('cone'), NEAR_BASE)

    expect(base).toBeGreaterThan(RX) // wider than half the block's own extent
  })

  it('is not the ball: narrower at the top than a circle of the same extent', () => {
    const cone = widthAtRow(drawn('cone'), NEAR_TOP)
    const ball = widthAtRow(drawn('circle'), NEAR_TOP)

    expect(cone).toBeLessThan(ball)
  })

  it('is not the square: a cube fills its top corners and a cone does not', () => {
    const cone = widthAtRow(drawn('cone'), NEAR_TOP)
    const cube = widthAtRow(drawn('square'), NEAR_TOP)

    expect(cone).toBeLessThan(cube)
  })

  it("keeps the tile's art: a two-band tile still shows both bands", () => {
    const canvas = drawn('cone')
    const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)

    let green = 0
    let blue = 0
    for (let i = 0; i < width * height; i++) {
      const [r, g, b, a] = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2], data[i * 4 + 3]]
      if (a < 128) continue
      if (g > r + 40 && g > b + 40) green++
      if (b > r + 40 && b > g + 40) blue++
    }

    expect(green).toBeGreaterThan(0)
    expect(blue).toBeGreaterThan(0)
  })
})
