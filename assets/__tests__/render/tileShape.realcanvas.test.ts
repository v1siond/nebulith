/**
 * REAL-CANVAS tests for the per-tile SHAPE setting (`shape: 'square' | 'circle'`) — `circle` renders a REAL
 * isometric SPHERE (Alexander: "literally just make the tile cube a sphere … the actual shape changes, not
 * simulated"), while KEEPING the tile's painting.
 *
 * MODEL: `shape: 'circle'` clips to the TRUE round silhouette and paints the tile's art as ONE smooth surface
 * (a single image, NOT the three cube faces — so there are no face seams), then radial-shades it into a 3D ball.
 * So a circle tile shows the tile's art on a genuine sphere — NOT a flat solid ball, NOT a flat disc, and NOT
 * the old clipped-cube (whose face seams read as a rounded cube). These render to a real rasteriser
 * (@napi-rs/canvas) and read the PIXELS:
 *   • the form is ROUND (its bounding-box corners are transparent; a rect would fill them) and its centre is filled;
 *   • the tile's ART survives — a TWO-BAND tile (green top, blue bottom) drawn as a circle still shows BOTH bands
 *     in the ball body (the old solid ball showed neither — it was one flat colour);
 *   • NO cube seams — the two-band art reads as ONE horizontally-split surface (top green + bottom blue on BOTH
 *     the left and right of the ball), which three sheared cube faces (a vertical centre seam) never produce;
 *   • the ball is SHADED (a bright highlight up-left, a dark rim — a 3D sphere, not a flat disc);
 *   • the colour SETTING still FILTERS the tile (a magenta colour → a magenta ball; a green baked image is
 *     recoloured, never left green), in BOTH emoji + ascii styles, positive + negative.
 */
import { installRealCanvas, type RealCanvasHarness } from '@/__tests__/helpers/realCanvas'
import { drawIsoBall, drawIsoTileBlock, drawIsoAssetAscii } from '@/engine/render/iso'
import { drawFlatTileForShape } from '@/engine/render/shared'
import { draw2DLabeledCell } from '@/engine/render/topdown'
import { EMOJI_STYLE, ASCII_STYLE } from '@/game/artStyle'
import { EMOJI_TILESET } from '@/engine/tileset/emojiTileset'
import type { GridAsset } from '@/engine/IsometricGrid'
import type { ImageVisual } from '@/game/artStyle'
import type { Canvas } from '@napi-rs/canvas'

let H: RealCanvasHarness

const MAGENTA = '#ff00ff'
const GREEN = '#00c800'
const BLUE = '#1030ff'

// Ball geometry — the SAME dims the display-mode cube test uses. drawIsoBall inscribes the ball in the cube's
// volume: rx = TW, ry = BH/2 + TH, centred at (CX, CY - BH/2). So:
const TW = 40, TH = 20, BH = 44, CX = 140, CY = 190
const RX = TW, RY = BH / 2 + TH        // 40, 42
const BCX = CX, BCY = CY - BH / 2      // 140, 168
// The ball's tight bounding box.
const BB = { x: BCX - RX, y: BCY - RY, w: 2 * RX, h: 2 * RY } // {100,126,80,84}

const BANDS = '/tiles/emoji/__shape_bands.png'
const bandsDv = (): { char: string; color: string; image: ImageVisual } => ({ char: '?', color: '#ffffff', image: { kind: 'image', src: BANDS } })

beforeAll(async () => {
  H = installRealCanvas().harness
  H.registerBands(BANDS, GREEN, BLUE) // a two-band tile: green top, blue bottom — its ART must survive the round
  await H.warm([BANDS])
})

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
/** The DOMINANT band colour in a sub-rect: 'green' / 'blue' / 'none' — the "which two-band half is here" probe. */
function regionBand(canvas: Canvas, x: number, y: number, w: number, h: number): 'green' | 'blue' | 'none' {
  const { data } = canvas.getContext('2d').getImageData(x, y, w, h)
  let g = 0, b = 0, n = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    n++
    const r = data[i], gg = data[i + 1], bb = data[i + 2]
    if (gg > r + 40 && gg > bb + 40) g++
    if (bb > r + 40 && bb > gg + 40) b++
  }
  if (n === 0) return 'none'
  if (g > b && g > n * 0.3) return 'green'
  if (b > g && b > n * 0.3) return 'blue'
  return 'none'
}

describe('shape = circle: ROUNDS the form (bounding-box corners cut) but keeps the tile filled', () => {
  test('the centre is filled but every bounding-box CORNER is transparent — a round form, not a rectangle', () => {
    const cv = H.makeCanvas(300, 280)
    const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D
    drawIsoBall(ctx, { x: CX, y: CY }, TW, TH, BH, 1, { char: 'o', color: MAGENTA }, MAGENTA)
    // Centre of the ball → solid fill (the cube's painting shows through the round clip).
    expect(regionOpaque(cv, BCX - 5, BCY - 5, 10, 10)).toBeGreaterThan(90) // ~all 100 px opaque
    // All four corners of the ball's bounding box → EMPTY (a cube/rect would paint pixels here; the round clip cuts them).
    expect(regionOpaque(cv, BB.x, BB.y, 10, 10)).toBe(0)                       // top-left
    expect(regionOpaque(cv, BB.x + BB.w - 10, BB.y, 10, 10)).toBe(0)           // top-right
    expect(regionOpaque(cv, BB.x, BB.y + BB.h - 10, 10, 10)).toBe(0)           // bottom-left
    expect(regionOpaque(cv, BB.x + BB.w - 10, BB.y + BB.h - 10, 10, 10)).toBe(0) // bottom-right
  })

  test('the round form fills far less of its bounding box than a solid rectangle (the round-silhouette signature)', () => {
    const ballCv = H.makeCanvas(300, 280)
    drawIsoBall(ballCv.getContext('2d') as unknown as CanvasRenderingContext2D, { x: CX, y: CY }, TW, TH, BH, 1, { char: 'o', color: MAGENTA }, MAGENTA)
    const ballFill = regionOpaque(ballCv, BB.x, BB.y, BB.w, BB.h) / (BB.w * BB.h)
    expect(ballFill).toBeGreaterThan(0.5)  // a rounded solid, clearly filled
    expect(ballFill).toBeLessThan(0.85)    // but clearly NOT a full rectangle — the corners are cut

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
    expect(highlight).toBeGreaterThan(rim + 15) // a real luminance gradient (3D), not one flat fill
  })
})

describe('shape = circle KEEPS the tile painting — the fix for "we lose the tiles painting"', () => {
  test('a two-band tile drawn as a circle still shows BOTH bands (the ART survives; NOT a flat solid ball)', () => {
    const cv = H.makeCanvas(300, 280)
    // No tint → the baked image paints raw, so its OWN two colours prove the tile art is preserved.
    drawIsoBall(cv.getContext('2d') as unknown as CanvasRenderingContext2D, { x: CX, y: CY }, TW, TH, BH, 1, bandsDv(), undefined)
    const s = H.scan(cv)
    expect(s.opaque).toBeGreaterThan(300) // the round form is drawn
    expect(s.greenish).toBeGreaterThan(0) // the tile's TOP band shows — a solid ball would show neither
    expect(s.blueish).toBeGreaterThan(0)  // and its BOTTOM band shows — the painting is intact under the round clip
  })

  test('NO cube seams — the two-band art reads as ONE horizontally-split surface (not three sheared faces)', () => {
    const cv = H.makeCanvas(300, 280)
    drawIsoBall(cv.getContext('2d') as unknown as CanvasRenderingContext2D, { x: CX, y: CY }, TW, TH, BH, 1, bandsDv(), undefined)
    const topY = Math.round(BCY - RY * 0.35), botY = Math.round(BCY + RY * 0.35)
    const lx = Math.round(BCX - RX * 0.5), rx = Math.round(BCX + RX * 0.5)
    // At a fixed height, the LEFT and RIGHT of the ball show the SAME band → one flat surface. A clipped CUBE
    // would split left/right into two differently-shaded FACES (a vertical centre seam), never clean H-bands.
    expect(regionBand(cv, lx - 4, topY - 4, 8, 8)).toBe('green') // top band, left
    expect(regionBand(cv, rx - 4, topY - 4, 8, 8)).toBe('green') // top band, right — SAME band as the left
    expect(regionBand(cv, lx - 4, botY - 4, 8, 8)).toBe('blue')  // bottom band, left
    expect(regionBand(cv, rx - 4, botY - 4, 8, 8)).toBe('blue')  // bottom band, right — SAME band as the left
  })
})

describe('shape = circle honours the colour SETTING per style (emoji + ascii), positive + negative', () => {
  const LABEL = '__shape_water__'
  const SRC = '/tiles/emoji/__shape_water.png'
  const asset = (over: Partial<GridAsset>): GridAsset => ({ art: ['o'], col: 3, row: 3, type: 'water', height: 1, label: LABEL, scale: 3, shape: 'circle', ...over })

  beforeAll(async () => {
    EMOJI_TILESET[LABEL] = { char: '🌊', color: '#2f6fbf', image: SRC, height: 1 }
    H.registerSolid(SRC, GREEN) // a GREEN baked tile — the colour setting must RECOLOUR it (never leave it green)
    await H.warm([SRC])
  })
  afterAll(() => { delete EMOJI_TILESET[LABEL] })

  test('emoji: a MAGENTA-colour tile → a MAGENTA ball; the GREEN baked image is recoloured, never left green', () => {
    const cv = H.makeCanvas(260, 300)
    drawIsoAssetAscii(cv.getContext('2d') as unknown as CanvasRenderingContext2D, 130, 210, asset({ color: MAGENTA }), 30, 15, 0, false, 'day', EMOJI_STYLE)
    const s = H.scan(cv)
    expect(s.opaque).toBeGreaterThan(300) // the ball is drawn
    expect(s.magentaish).toBeGreaterThan(0)
    expect(s.greenish).toBe(0)            // the green image is filtered to the colour setting, not left green
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

  test('negative: with NO colour set, the ball falls back to grey — NOT magenta, and still not green', () => {
    const cv = H.makeCanvas(260, 300)
    drawIsoAssetAscii(cv.getContext('2d') as unknown as CanvasRenderingContext2D, 130, 210, asset({}), 30, 15, 0, false, 'day', EMOJI_STYLE)
    const s = H.scan(cv)
    expect(s.opaque).toBeGreaterThan(300) // still a ball
    expect(s.magentaish).toBe(0)          // no colour setting → not magenta
    expect(s.greenish).toBe(0)            // and the green baked image is filtered to grey, never shown green
  })
})

// ── 2D front elevation (draw2DLabeledCell): shape=circle clips the SAME cell face to an ellipse, keeping its
//    painting/colour, only rounding the silhouette (the flat analogue of the iso ball). ──
describe('2D: shape = circle rounds the cell face but keeps its painting', () => {
  const LABEL = '__shape_2d_water__'
  const SRC = '/tiles/emoji/__shape_2d.png'
  // A big cell so the ellipse clip is easy to read. draw2DLabeledCell(x, baseY, tileW, tileH): drawW = tileW,
  // drawH = tileH (scale 1), cy = baseY - drawH/2. The cell BOX is [x-drawW/2 .. x+drawW/2] × [baseY-drawH .. baseY].
  const X = 150, BASEY = 210, TW = 100, TH = 120
  const boxX = X - TW / 2, boxTop = BASEY - TH // {100, 90}
  const asset = (over: Partial<GridAsset>): GridAsset => ({ art: ['o'], col: 3, row: 3, type: 'building', height: 1, label: LABEL, color: MAGENTA, ...over })

  beforeAll(async () => {
    EMOJI_TILESET[LABEL] = { char: '🧱', color: '#b05030', image: SRC, height: 1 }
    H.registerSolid(SRC, GREEN)
    await H.warm([SRC])
  })
  afterAll(() => { delete EMOJI_TILESET[LABEL] })

  test('circle: the cell CENTRE shows the tile (magenta-filtered) but the box CORNERS are cut transparent', () => {
    const cv = H.makeCanvas(320, 260)
    draw2DLabeledCell(cv.getContext('2d') as unknown as CanvasRenderingContext2D, X, BASEY, TW, TH, asset({ shape: 'circle' }), EMOJI_STYLE)
    // centre → painted (the tile face, colour-filtered to the magenta setting)
    expect(regionOpaque(cv, X - 5, BASEY - TH / 2 - 5, 10, 10)).toBeGreaterThan(90)
    const s = H.scan(cv)
    expect(s.magentaish).toBeGreaterThan(0) // the colour setting still filters the face
    expect(s.greenish).toBe(0)              // the green baked image is recoloured, not shown raw
    // the four corners of the square cell box → cut away by the round clip
    expect(regionOpaque(cv, boxX, boxTop, 8, 8)).toBe(0)
    expect(regionOpaque(cv, boxX + TW - 8, boxTop, 8, 8)).toBe(0)
    expect(regionOpaque(cv, boxX, boxTop + TH - 8, 8, 8)).toBe(0)
    expect(regionOpaque(cv, boxX + TW - 8, boxTop + TH - 8, 8, 8)).toBe(0)
  })

  test('square (default): the SAME cell FILLS its box corners — proving circle changed only the form', () => {
    const cv = H.makeCanvas(320, 260)
    draw2DLabeledCell(cv.getContext('2d') as unknown as CanvasRenderingContext2D, X, BASEY, TW, TH, asset({}), EMOJI_STYLE)
    // a square cell paints the whole rect — its corners are opaque (the circle cut them)
    expect(regionOpaque(cv, boxX, boxTop, 8, 8)).toBeGreaterThan(50)
    expect(regionOpaque(cv, boxX + TW - 8, boxTop + TH - 8, 8, 8)).toBeGreaterThan(50)
  })
})

// ── DELIVERABLE 1: the sphere KEEPS THE BACKGROUND COLOUR. The cube face fills the tile's colour THEN paints the
//    art on top, so the whole face reads the colour even where the (emoji) art is transparent. The sphere lost
//    that fill — an emoji tile's transparent gaps showed the dark scene through the ball ("we lost the background
//    color"). It must now fill colour + art like the cube, only shaped round. ──
describe('shape = circle KEEPS THE BACKGROUND COLOUR where the art is transparent (the cube-parity fix)', () => {
  const CENTER = '/tiles/emoji/__shape_centered.png'
  // A tile whose ART is a GREEN square in the MIDDLE on an otherwise TRANSPARENT field — like an emoji that
  // covers only part of its cell. The transparent border is exactly where "the background colour" must show.
  beforeAll(async () => {
    H.registerCentered(CENTER, GREEN)
    await H.warm([CENTER])
  })
  // NO tint → the fill colour is dv.color and the art stays its own GREEN, so the two are DISTINGUISHABLE in the
  // pixels: the ball BODY must read the fill colour, the CENTRE the green art. (In real use tint == the colour;
  // splitting them here is what lets the test prove the fill is actually painted, not just the tinted art.)
  const centeredDv = (fill: string): { char: string; color: string; image: ImageVisual } =>
    ({ char: '', color: fill, image: { kind: 'image', src: CENTER } })

  test('the sphere BODY is filled with the tile colour where the art is transparent — NOT dark/transparent', () => {
    const cv = H.makeCanvas(300, 280)
    drawIsoBall(cv.getContext('2d') as unknown as CanvasRenderingContext2D, { x: CX, y: CY }, TW, TH, BH, 1, centeredDv(BLUE), undefined)
    // CENTRE → the green art survives ON TOP of the fill (art is still drawn).
    expect(regionBand(cv, BCX - 4, BCY - 4, 8, 8)).toBe('green')
    // A BODY point between the centre art and the rim — where the SOURCE image is TRANSPARENT — must be the
    // tile's BLUE background colour. Before the fix this was empty (the sphere lost the fill). rx=40 → +28 is
    // inside the ball but outside the centred art square.
    const bx = Math.round(BCX + RX * 0.7)
    expect(regionOpaque(cv, bx - 3, BCY - 3, 6, 6)).toBeGreaterThan(20) // filled, not transparent
    expect(regionBand(cv, bx - 3, BCY - 3, 6, 6)).toBe('blue')          // and it is the tile's background colour
  })

  test('sphere ≙ cube: BOTH show the colour fill (blue) AND the art (green) for the SAME tile', () => {
    // The cube face: colour fill + art on top — the reference the sphere must match.
    const cubeCv = H.makeCanvas(300, 280)
    drawIsoTileBlock(cubeCv.getContext('2d') as unknown as CanvasRenderingContext2D, { x: CX, y: CY }, TW, TH, BH, 1, centeredDv(BLUE), undefined)
    const cube = H.scan(cubeCv)
    expect(cube.blueish).toBeGreaterThan(0) // background colour fill
    expect(cube.greenish).toBeGreaterThan(0) // art on top

    const ballCv = H.makeCanvas(300, 280)
    drawIsoBall(ballCv.getContext('2d') as unknown as CanvasRenderingContext2D, { x: CX, y: CY }, TW, TH, BH, 1, centeredDv(BLUE), undefined)
    const ball = H.scan(ballCv)
    expect(ball.blueish).toBeGreaterThan(0) // the sphere carries the SAME background colour as the cube
    expect(ball.greenish).toBeGreaterThan(0) // and the SAME art
  })

  test('the colour SETTING (tint) still fills the ball — a magenta-set centred-art tile → a magenta body', () => {
    const cv = H.makeCanvas(300, 280)
    // With a tint the whole tile (fill + art) recolours to magenta, exactly like the cube — no green survives.
    drawIsoBall(cv.getContext('2d') as unknown as CanvasRenderingContext2D, { x: CX, y: CY }, TW, TH, BH, 1, centeredDv('#888888'), MAGENTA)
    const s = H.scan(cv)
    expect(s.magentaish).toBeGreaterThan(0)
    expect(s.greenish).toBe(0) // the green art is recoloured to the setting, never left green
    // and the body between art and rim is filled (the magenta background), not transparent.
    const bx = Math.round(BCX + RX * 0.7)
    expect(regionOpaque(cv, bx - 3, BCY - 3, 6, 6)).toBeGreaterThan(20)
  })
})

// ── DELIVERABLE 3: 2D/Top route their circle/square through the SAME shared dispatch (drawFlatTileForShape) iso
//    uses — no per-view `if (shape === 'circle')`. This tests the SEAM directly: given a face painter, the map
//    either paints it plain (square/undefined) or clips it round + shades (circle). ──
describe('shape dispatch (drawFlatTileForShape): the shared flat shape seam for 2D + Top', () => {
  const DCX = 150, DCY = 130, DRX = 60, DRY = 60
  const paintFace = (ctx: CanvasRenderingContext2D): void => {
    ctx.fillStyle = MAGENTA
    ctx.fillRect(DCX - DRX, DCY - DRY, DRX * 2, DRY * 2) // a full rect — the drawer decides if its corners survive
  }

  test("'circle' clips the face ROUND — centre kept, bounding-box corners cut", () => {
    const cv = H.makeCanvas(320, 260)
    const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D
    drawFlatTileForShape(ctx, 'circle', () => paintFace(ctx), DCX, DCY, DRX, DRY)
    expect(regionOpaque(cv, DCX - 4, DCY - 4, 8, 8)).toBeGreaterThan(50) // centre painted
    expect(regionOpaque(cv, DCX - DRX, DCY - DRY, 8, 8)).toBe(0)          // top-left corner cut by the round clip
    expect(regionOpaque(cv, DCX + DRX - 8, DCY + DRY - 8, 8, 8)).toBe(0)  // bottom-right corner cut
  })

  test("'square' and undefined both paint the PLAIN face — corners FILLED (the same default drawer)", () => {
    for (const shape of ['square', undefined] as const) {
      const cv = H.makeCanvas(320, 260)
      const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D
      drawFlatTileForShape(ctx, shape, () => paintFace(ctx), DCX, DCY, DRX, DRY)
      expect(regionOpaque(cv, DCX - 4, DCY - 4, 8, 8)).toBeGreaterThan(50)       // centre painted
      expect(regionOpaque(cv, DCX - DRX, DCY - DRY, 8, 8)).toBeGreaterThan(50)   // corner FILLED — no round clip
      expect(regionOpaque(cv, DCX + DRX - 8, DCY + DRY - 8, 8, 8)).toBeGreaterThan(50)
    }
  })
})
