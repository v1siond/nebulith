/**
 * REAL-CANVAS tests for the per-tile SHAPE setting (`shape: 'square' | 'circle'`). `circle` takes the SAME
 * cuboid and BENDS ITS CORNERS into a smooth rounded silhouette (Alexander: "ALL I WANT WITH THE SHAPE IS TO
 * MANIPULATE THE SIDES OF THE CUBOID, selecting circle shape should bend the corners OF THE CUBOID to form a
 * circle … the cube/cuboid is just a tile, painted on all sides of the block/cell").
 *
 * MODEL: `shape: 'circle'` draws the tile's NORMAL cube (its baked art painted on all three shaded faces) and
 * then CLIPS the silhouette to an ELLIPSE of the block's OWN projected extent — so the corners are rounded away
 * but the shape stays PROPORTIONAL to the block: a TALL block → a TALL OVAL (an egg standing up), a unit cube →
 * a rounder blob. It is NOT a repainted sphere: there is no spherical relight, no single flat surface, and no
 * fixed circle (rx==ry). These render to a real rasteriser (@napi-rs/canvas) and read the PIXELS:
 *   • the form is ROUND (its bounding-box corners are transparent; a rect would fill them) and its centre is filled;
 *   • the silhouette is PROPORTIONAL — a tall (height-3) block's rounded silhouette is clearly TALLER than wide,
 *     a unit (height-1) block's is roughly square: the aspect follows the block, never a fixed 1:1;
 *   • the tile's ART survives — a TWO-BAND tile (green top, blue bottom) drawn as a circle still shows BOTH bands;
 *   • the cuboid's NORMAL per-face shading is KEPT — the top face is brighter than the front walls, and the two
 *     front walls differ from each other (real 3 faces, NOT one uniformly-lit ball);
 *   • the tile keeps its BACKGROUND COLOUR where the art is transparent (the cube fills colour then paints art);
 *   • the colour SETTING still FILTERS the tile (a magenta colour → a magenta form; a green baked image is
 *     recoloured, never left green), in BOTH emoji + ascii styles, positive + negative.
 */
import { installRealCanvas, type RealCanvasHarness } from '@/__tests__/helpers/realCanvas'
import { drawIsoRoundedBlock, drawIsoTileBlock, drawIsoAssetAscii } from '@/engine/render/iso'
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

// Rounded-block geometry — the SAME dims the display-mode cube test uses. drawIsoRoundedBlock clips the cube to
// an ellipse of the block's own extent: rx = TW, ry = BH/2 + TH, centred at (CX, CY - BH/2). So:
const TW = 40, TH = 20, BH = 44, CX = 140, CY = 190
const RX = TW, RY = BH / 2 + TH        // 40, 42
const BCX = CX, BCY = CY - BH / 2      // 140, 168
// The rounded block's tight bounding box.
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
/** The tight opaque bounding box (alpha ≥ 128) inside a scan window — the aspect-ratio probe. */
function opaqueBounds(canvas: Canvas, x: number, y: number, w: number, h: number): { w: number; h: number } {
  const { data } = canvas.getContext('2d').getImageData(x, y, w, h)
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      if (data[(py * w + px) * 4 + 3] < 128) continue
      if (px < minX) minX = px
      if (px > maxX) maxX = px
      if (py < minY) minY = py
      if (py > maxY) maxY = py
    }
  }
  if (maxX < 0) return { w: 0, h: 0 }
  return { w: maxX - minX + 1, h: maxY - minY + 1 }
}

describe('shape = circle: ROUNDS the cuboid (bounding-box corners cut) but keeps it filled', () => {
  test('the centre is filled but every bounding-box CORNER is transparent — a round form, not a rectangle', () => {
    const cv = H.makeCanvas(300, 280)
    const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D
    drawIsoRoundedBlock(ctx, { x: CX, y: CY }, TW, TH, BH, 1, { char: 'o', color: MAGENTA }, MAGENTA)
    // Centre of the block → solid fill (the cube's painted faces show through the round clip).
    expect(regionOpaque(cv, BCX - 5, BCY - 5, 10, 10)).toBeGreaterThan(90) // ~all 100 px opaque
    // All four corners of the bounding box → EMPTY (a cube/rect would paint pixels here; the round clip cuts them).
    expect(regionOpaque(cv, BB.x, BB.y, 10, 10)).toBe(0)                       // top-left
    expect(regionOpaque(cv, BB.x + BB.w - 10, BB.y, 10, 10)).toBe(0)           // top-right
    expect(regionOpaque(cv, BB.x, BB.y + BB.h - 10, 10, 10)).toBe(0)           // bottom-left
    expect(regionOpaque(cv, BB.x + BB.w - 10, BB.y + BB.h - 10, 10, 10)).toBe(0) // bottom-right
  })

  test('the round form fills far less of its bounding box than a solid rectangle (the round-silhouette signature)', () => {
    const cv = H.makeCanvas(300, 280)
    drawIsoRoundedBlock(cv.getContext('2d') as unknown as CanvasRenderingContext2D, { x: CX, y: CY }, TW, TH, BH, 1, { char: 'o', color: MAGENTA }, MAGENTA)
    const fill = regionOpaque(cv, BB.x, BB.y, BB.w, BB.h) / (BB.w * BB.h)
    expect(fill).toBeGreaterThan(0.5)  // a rounded solid, clearly filled
    expect(fill).toBeLessThan(0.85)    // but clearly NOT a full rectangle — the corners are cut

    // Contrast: a solid rectangle over the SAME box fills nearly all of it — proves the ratio test discriminates.
    const rectCv = H.makeCanvas(300, 280)
    const rctx = rectCv.getContext('2d') as unknown as CanvasRenderingContext2D
    rctx.fillStyle = MAGENTA
    rctx.fillRect(BB.x, BB.y, BB.w, BB.h)
    expect(regionOpaque(rectCv, BB.x, BB.y, BB.w, BB.h) / (BB.w * BB.h)).toBeGreaterThan(0.98)
  })
})

describe('shape = circle is PROPORTIONAL to the block — the rounded silhouette follows the cuboid, never a fixed 1:1', () => {
  test('a TALL (height-3) block rounds to a TALL OVAL; a UNIT (height-1) block to a roughly-square blob', () => {
    // TALL: n=3 → ry = 3*BH/2 + TH = 86, rx = 40 → the silhouette bbox is ~80 wide × ~172 tall (an egg standing up).
    const tallCv = H.makeCanvas(300, 280)
    drawIsoRoundedBlock(tallCv.getContext('2d') as unknown as CanvasRenderingContext2D, { x: CX, y: CY }, TW, TH, BH, 3, { char: 'o', color: MAGENTA }, MAGENTA)
    const tall = opaqueBounds(tallCv, 90, 30, 110, 200)
    // UNIT: n=1 → ry = 42, rx = 40 → the silhouette bbox is ~80 × ~84 (roughly square).
    const unitCv = H.makeCanvas(300, 280)
    drawIsoRoundedBlock(unitCv.getContext('2d') as unknown as CanvasRenderingContext2D, { x: CX, y: CY }, TW, TH, BH, 1, { char: 'o', color: MAGENTA }, MAGENTA)
    const unit = opaqueBounds(unitCv, 90, 110, 110, 120)

    const tallRatio = tall.h / tall.w
    const unitRatio = unit.h / unit.w
    expect(tall.w).toBeGreaterThan(0)
    expect(unit.w).toBeGreaterThan(0)
    // The tall block's oval is clearly TALLER than wide (the block's proportions carried into the silhouette).
    expect(tallRatio).toBeGreaterThan(1.6)
    // The unit block's is roughly square — NOT a tall oval — so the aspect is NOT fixed; it follows the block.
    expect(unitRatio).toBeLessThan(1.3)
    // And the taller block yields a decisively taller silhouette than the unit block (aspect tracks height).
    expect(tallRatio).toBeGreaterThan(unitRatio * 1.4)
    // Same footprint → same WIDTH; only the height changed. Proves it did NOT balloon into a bigger circle.
    expect(Math.abs(tall.w - unit.w)).toBeLessThan(8)
  })
})

describe('shape = circle KEEPS the tile painting AND the cuboid face shading', () => {
  test('a two-band tile drawn as a circle still shows BOTH bands (the ART survives the round clip)', () => {
    const cv = H.makeCanvas(300, 280)
    // No tint → the baked image paints raw, so its OWN two colours prove the tile art is preserved.
    drawIsoRoundedBlock(cv.getContext('2d') as unknown as CanvasRenderingContext2D, { x: CX, y: CY }, TW, TH, BH, 1, bandsDv(), undefined)
    const s = H.scan(cv)
    expect(s.opaque).toBeGreaterThan(300) // the round form is drawn
    expect(s.greenish).toBeGreaterThan(0) // the tile's TOP band shows
    expect(s.blueish).toBeGreaterThan(0)  // and its BOTTOM band shows — the painting is intact under the round clip
  })

  test('the CUBOID face shading is kept — top face brighter than the walls, and the two walls differ (3 real faces, not a uniform ball)', () => {
    const cv = H.makeCanvas(300, 280)
    // Solid colour, no glyph/image → the faces render as clean per-face shades (top full, left/right darkened).
    drawIsoRoundedBlock(cv.getContext('2d') as unknown as CanvasRenderingContext2D, { x: CX, y: CY }, TW, TH, BH, 1, { char: '', color: MAGENTA }, MAGENTA)
    const topLum = regionMeanLum(cv, CX - 6, 143, 12, 10)   // the bright TOP diamond face
    const leftLum = regionMeanLum(cv, 111, 181, 8, 8)       // the front-LEFT wall
    const rightLum = regionMeanLum(cv, 161, 181, 8, 8)      // the front-RIGHT wall
    expect(topLum).toBeGreaterThan(leftLum + 15)  // top face is the only undarkened face → clearly brightest
    expect(topLum).toBeGreaterThan(rightLum + 15)
    // A uniformly-lit ball would light both walls the same; the cuboid's per-face shading makes them DIFFER.
    expect(leftLum).toBeGreaterThan(rightLum + 5)
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

  test('emoji: a MAGENTA-colour tile → a MAGENTA rounded block; the GREEN baked image is recoloured, never left green', () => {
    const cv = H.makeCanvas(260, 300)
    drawIsoAssetAscii(cv.getContext('2d') as unknown as CanvasRenderingContext2D, 130, 210, asset({ color: MAGENTA }), 30, 15, 0, false, 'day', EMOJI_STYLE)
    const s = H.scan(cv)
    expect(s.opaque).toBeGreaterThan(300) // the rounded block is drawn
    expect(s.magentaish).toBeGreaterThan(0)
    expect(s.greenish).toBe(0)            // the green image is filtered to the colour setting, not left green
  })

  test('ascii: the SAME magenta colour setting drives the rounded block (one path per style)', () => {
    const cv = H.makeCanvas(260, 300)
    // Default style arg = ASCII_STYLE; pass it explicitly for clarity.
    drawIsoAssetAscii(cv.getContext('2d') as unknown as CanvasRenderingContext2D, 130, 210, asset({ color: MAGENTA }), 30, 15, 0, false, 'day', ASCII_STYLE)
    const s = H.scan(cv)
    expect(s.opaque).toBeGreaterThan(300)
    expect(s.magentaish).toBeGreaterThan(0)
    expect(s.greenish).toBe(0)
  })

  test('negative: with NO colour set, the block falls back to grey — NOT magenta, and still not green', () => {
    const cv = H.makeCanvas(260, 300)
    drawIsoAssetAscii(cv.getContext('2d') as unknown as CanvasRenderingContext2D, 130, 210, asset({}), 30, 15, 0, false, 'day', EMOJI_STYLE)
    const s = H.scan(cv)
    expect(s.opaque).toBeGreaterThan(300) // still a rounded block
    expect(s.magentaish).toBe(0)          // no colour setting → not magenta
    expect(s.greenish).toBe(0)            // and the green baked image is filtered to grey, never shown green
  })
})

// ── 2D front elevation (draw2DLabeledCell): shape=circle clips the SAME cell face to an ellipse, keeping its
//    painting/colour, only rounding the silhouette (the flat analogue of the iso rounded block). ──
describe('2D: shape = circle rounds the cell face but keeps its painting', () => {
  const LABEL = '__shape_2d_water__'
  const SRC = '/tiles/emoji/__shape_2d.png'
  // A big cell so the ellipse clip is easy to read. draw2DLabeledCell(x, baseY, tileW, tileH): drawW = tileW,
  // drawH = tileH (scale 1), cy = baseY - drawH/2. The cell BOX is [x-drawW/2 .. x+drawW/2] × [baseY-drawH .. baseY].
  const X = 150, BASEY = 210, TW2 = 100, TH2 = 120
  const boxX = X - TW2 / 2, boxTop = BASEY - TH2 // {100, 90}
  const asset = (over: Partial<GridAsset>): GridAsset => ({ art: ['o'], col: 3, row: 3, type: 'building', height: 1, label: LABEL, color: MAGENTA, ...over })

  beforeAll(async () => {
    EMOJI_TILESET[LABEL] = { char: '🧱', color: '#b05030', image: SRC, height: 1 }
    H.registerSolid(SRC, GREEN)
    await H.warm([SRC])
  })
  afterAll(() => { delete EMOJI_TILESET[LABEL] })

  test('circle: the cell CENTRE shows the tile (magenta-filtered) but the box CORNERS are cut transparent', () => {
    const cv = H.makeCanvas(320, 260)
    draw2DLabeledCell(cv.getContext('2d') as unknown as CanvasRenderingContext2D, X, BASEY, TW2, TH2, asset({ shape: 'circle' }), EMOJI_STYLE)
    // centre → painted (the tile face, colour-filtered to the magenta setting)
    expect(regionOpaque(cv, X - 5, BASEY - TH2 / 2 - 5, 10, 10)).toBeGreaterThan(90)
    const s = H.scan(cv)
    expect(s.magentaish).toBeGreaterThan(0) // the colour setting still filters the face
    expect(s.greenish).toBe(0)              // the green baked image is recoloured, not shown raw
    // the four corners of the square cell box → cut away by the round clip
    expect(regionOpaque(cv, boxX, boxTop, 8, 8)).toBe(0)
    expect(regionOpaque(cv, boxX + TW2 - 8, boxTop, 8, 8)).toBe(0)
    expect(regionOpaque(cv, boxX, boxTop + TH2 - 8, 8, 8)).toBe(0)
    expect(regionOpaque(cv, boxX + TW2 - 8, boxTop + TH2 - 8, 8, 8)).toBe(0)
  })

  test('square (default): the SAME cell FILLS its box corners — proving circle changed only the form', () => {
    const cv = H.makeCanvas(320, 260)
    draw2DLabeledCell(cv.getContext('2d') as unknown as CanvasRenderingContext2D, X, BASEY, TW2, TH2, asset({}), EMOJI_STYLE)
    // a square cell paints the whole rect — its corners are opaque (the circle cut them)
    expect(regionOpaque(cv, boxX, boxTop, 8, 8)).toBeGreaterThan(50)
    expect(regionOpaque(cv, boxX + TW2 - 8, boxTop + TH2 - 8, 8, 8)).toBeGreaterThan(50)
  })
})

// ── The rounded block KEEPS THE BACKGROUND COLOUR. The cube face fills the tile's colour THEN paints the art on
//    top, so the whole face reads the colour even where the (emoji) art is transparent. Rounding it must keep that
//    — an emoji tile's transparent gaps must show the tile's background colour, never the dark scene through it. ──
describe('shape = circle KEEPS THE BACKGROUND COLOUR where the art is transparent (cube parity)', () => {
  const CENTER = '/tiles/emoji/__shape_centered.png'
  // A tile whose ART is a GREEN square in the MIDDLE on an otherwise TRANSPARENT field — like an emoji that
  // covers only part of its cell. The transparent border is exactly where "the background colour" must show.
  beforeAll(async () => {
    H.registerCentered(CENTER, GREEN)
    await H.warm([CENTER])
  })
  // NO tint → the fill colour is dv.color and the art stays its own GREEN, so the two are DISTINGUISHABLE in the
  // pixels: the block BODY must read the fill colour, the centred art the green. (In real use tint == the colour;
  // splitting them here is what lets the test prove the fill is actually painted, not just the tinted art.)
  const centeredDv = (fill: string): { char: string; color: string; image: ImageVisual } =>
    ({ char: '', color: fill, image: { kind: 'image', src: CENTER } })

  test('the rounded block carries BOTH the tile colour fill (blue) AND the art (green) — the background is not lost', () => {
    const cv = H.makeCanvas(300, 280)
    drawIsoRoundedBlock(cv.getContext('2d') as unknown as CanvasRenderingContext2D, { x: CX, y: CY }, TW, TH, BH, 1, centeredDv(BLUE), undefined)
    const s = H.scan(cv)
    // The source art is a GREEN square on a TRANSPARENT field, so the ONLY way BLUE reaches the pixels is the
    // FACE FILL painted into those transparent gaps — blueish > 0 proves the background colour is NOT lost.
    expect(s.blueish).toBeGreaterThan(0)  // the tile's background colour fills the faces (the transparent gaps)
    expect(s.greenish).toBeGreaterThan(0) // the centred art survives on top of the fill
  })

  test('rounded block ≙ cube: BOTH show the colour fill (blue) AND the art (green) for the SAME tile', () => {
    // The cube: colour fill + art on top — the reference the rounded block must match.
    const cubeCv = H.makeCanvas(300, 280)
    drawIsoTileBlock(cubeCv.getContext('2d') as unknown as CanvasRenderingContext2D, { x: CX, y: CY }, TW, TH, BH, 1, centeredDv(BLUE), undefined)
    const cube = H.scan(cubeCv)
    expect(cube.blueish).toBeGreaterThan(0) // background colour fill
    expect(cube.greenish).toBeGreaterThan(0) // art on top

    const roundCv = H.makeCanvas(300, 280)
    drawIsoRoundedBlock(roundCv.getContext('2d') as unknown as CanvasRenderingContext2D, { x: CX, y: CY }, TW, TH, BH, 1, centeredDv(BLUE), undefined)
    const round = H.scan(roundCv)
    expect(round.blueish).toBeGreaterThan(0) // the rounded block carries the SAME background colour as the cube
    expect(round.greenish).toBeGreaterThan(0) // and the SAME art
  })

  test('the colour SETTING (tint) still fills the block — a magenta-set centred-art tile → a magenta body', () => {
    const cv = H.makeCanvas(300, 280)
    // With a tint the whole tile (fill + art) recolours to magenta, exactly like the cube — no green survives.
    drawIsoRoundedBlock(cv.getContext('2d') as unknown as CanvasRenderingContext2D, { x: CX, y: CY }, TW, TH, BH, 1, centeredDv('#888888'), MAGENTA)
    const s = H.scan(cv)
    expect(s.magentaish).toBeGreaterThan(0)
    expect(s.greenish).toBe(0) // the green art is recoloured to the setting, never left green
    // and a face point off the centred art is filled (the magenta background), not transparent.
    const bx = Math.round(BCX + RX * 0.7)
    expect(regionOpaque(cv, bx - 3, BCY - 3, 6, 6)).toBeGreaterThan(20)
  })
})

// ── 2D/Top route their circle/square through the SAME shared dispatch (drawFlatTileForShape) iso uses — no
//    per-view `if (shape === 'circle')`. This tests the SEAM directly: given a face painter, the map either
//    paints it plain (square/undefined) or clips it round (circle) — the corners bent away, no relight. ──
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
