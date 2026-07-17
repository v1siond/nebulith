/**
 * REAL-CANVAS tests for the per-tile DISPLAY MODE (settings.display = "all-faces" | "single").
 *
 * MODEL (nebulith MAP-MODEL §4/§8, TILE-BACKEND-MIGRATION §5/§7): a tile is a baked backend IMAGE resolved
 * by label; `display` is a per-tile SETTING that only changes WHERE / HOW MANY TIMES that SAME image is drawn
 * on the block — it never introduces a glyph.
 *   • "all-faces" (DEFAULT) paints the tile on the block's top + two visible side faces (drawIsoTileBlock).
 *   • "single" draws ONE centered instance INSIDE the block volume (a billboard at the block centre) over a
 *     plain, shaded block SHELL — the "single water droplet floating in the block" case (Image #33).
 *
 * These render to a real rasteriser (@napi-rs/canvas) and read the PIXELS: with a GREEN baked-tile stand-in on
 * a WHITE (native, untinted) block, "all-faces" must show GREEN on the left + right + top face regions, while
 * "single" must leave the SIDE-face regions the plain WHITE shell (no green) and show the ONE green tile only
 * at the block centre. Colour-filtering is asserted separately (a magenta tile comes back magenta in BOTH modes).
 */
import { installRealCanvas, type RealCanvasHarness } from '@/__tests__/helpers/realCanvas'
import { drawIsoTileBlock, drawIsoSingleTileBlock, drawIsoAssetAscii } from '@/engine/render/iso'
import { SINGLE_TILE_FRAC } from '@/engine/render/shared'
import { EMOJI_STYLE } from '@/game/artStyle'
import { EMOJI_TILESET } from '@/engine/tileset/emojiTileset'
import type { GridAsset } from '@/engine/IsometricGrid'
import type { Canvas } from '@napi-rs/canvas'

let H: RealCanvasHarness

const GREEN = '#00c800'
const WHITE = '#ffffff'
const MAGENTA = '#ff00ff'

// Cube geometry: base diamond centre + half-extents (in px). Chosen so the face regions and the centre
// billboard land at known, non-overlapping coordinates (see the region boxes below).
const TW = 40, TH = 20, BH = 44
const CX = 140, CY = 190

beforeAll(() => { H = installRealCanvas().harness })

/** Count clearly-GREEN opaque pixels in a sub-rect (the "green tile image is present here" signal). */
function regionGreen(canvas: Canvas, x: number, y: number, w: number, h: number): number {
  const { data } = canvas.getContext('2d').getImageData(x, y, w, h)
  let green = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    const r = data[i], g = data[i + 1], b = data[i + 2]
    if (g > r + 40 && g > b + 40) green++
  }
  return green
}

// Face + centre region boxes for the cube above (verified against isoBlockFaces: left face x<CX, right face
// x>CX, top diamond at CY-BH; the single billboard is centred at (CX, CY-BH/2) at SINGLE_TILE_FRAC of width).
const LEFT = { x: 104, y: 172, w: 10, h: 16 }   // left side face, LEFT of the centre billboard (x < 116)
const RIGHT = { x: 166, y: 172, w: 10, h: 16 }  // right side face, RIGHT of the centre billboard (x > 164)
const TOP = { x: 134, y: 142, w: 12, h: 8 }     // top diamond region
const CENTRE = { x: 134, y: 162, w: 12, h: 12 } // block-volume centre (where the single tile floats)

describe('display = "all-faces" (default): the tile image is painted on all THREE faces', () => {
  test('a GREEN tile on a native (untinted) block shows GREEN on left + right + top face regions', async () => {
    const src = '/tiles/probe/display-allfaces.png'
    H.registerSolid(src, GREEN)
    await H.warm([src])
    const cv = H.makeCanvas(280, 260)
    const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D
    // tint = undefined → the image draws NATIVE (green) on every face; dv.color WHITE is the face-fill under it.
    drawIsoTileBlock(ctx, { x: CX, y: CY }, TW, TH, BH, 1, { char: '🌊', color: WHITE, image: { kind: 'image', src } }, undefined)
    expect(regionGreen(cv, LEFT.x, LEFT.y, LEFT.w, LEFT.h)).toBeGreaterThan(0)   // green on the LEFT face
    expect(regionGreen(cv, RIGHT.x, RIGHT.y, RIGHT.w, RIGHT.h)).toBeGreaterThan(0) // green on the RIGHT face
    expect(regionGreen(cv, TOP.x, TOP.y, TOP.w, TOP.h)).toBeGreaterThan(0)       // green on the TOP face
  })
})

describe('display = "single": ONE centered tile INSIDE the block, NOT on the side faces', () => {
  test('the SIDE faces are the plain WHITE shell (no green) and the ONE green tile is at the centre', async () => {
    const src = '/tiles/probe/display-single.png'
    H.registerSolid(src, GREEN)
    await H.warm([src])
    const cv = H.makeCanvas(280, 260)
    const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D
    drawIsoSingleTileBlock(ctx, { x: CX, y: CY }, TW, TH, BH, 1, { char: '🌊', color: WHITE, image: { kind: 'image', src } }, undefined)
    // The side faces are the plain shell fill — NO tile image painted on them.
    expect(regionGreen(cv, LEFT.x, LEFT.y, LEFT.w, LEFT.h)).toBe(0)
    expect(regionGreen(cv, RIGHT.x, RIGHT.y, RIGHT.w, RIGHT.h)).toBe(0)
    // Exactly ONE tile, at the block-volume centre.
    expect(regionGreen(cv, CENTRE.x, CENTRE.y, CENTRE.w, CENTRE.h)).toBeGreaterThan(0)
  })

  test('single paints FAR less of the tile than all-faces (one billboard vs three faces)', async () => {
    const src = '/tiles/probe/display-count.png'
    H.registerSolid(src, GREEN)
    await H.warm([src])
    const dv = { char: '🌊', color: WHITE, image: { kind: 'image' as const, src } }

    const allCv = H.makeCanvas(280, 260)
    drawIsoTileBlock(allCv.getContext('2d') as unknown as CanvasRenderingContext2D, { x: CX, y: CY }, TW, TH, BH, 1, dv, undefined)
    const single = H.makeCanvas(280, 260)
    drawIsoSingleTileBlock(single.getContext('2d') as unknown as CanvasRenderingContext2D, { x: CX, y: CY }, TW, TH, BH, 1, dv, undefined)

    const allGreen = regionGreen(allCv, 0, 0, 280, 260)
    const singleGreen = regionGreen(single, 0, 0, 280, 260)
    expect(singleGreen).toBeGreaterThan(0)          // the single tile is present
    expect(allGreen).toBeGreaterThan(0)             // the all-faces paint is present
    expect(singleGreen).toBeLessThan(allGreen * 0.6) // one billboard << three faces
  })
})

describe('colour still FILTERS the image in BOTH modes (drawIsoAssetAscii label path, end-to-end)', () => {
  const LABEL = '__disp_water__'
  const SRC = '/tiles/emoji/__disp_water.png'
  const asset = (over: Partial<GridAsset>): GridAsset => ({ art: ['?'], col: 3, row: 3, type: 'water', height: 1, label: LABEL, color: MAGENTA, scale: 3, ...over })

  beforeAll(async () => {
    EMOJI_TILESET[LABEL] = { char: '🌊', color: '#2f6fbf', image: SRC, height: 1 }
    H.registerSolid(SRC, GREEN) // a green baked tile; the asset's magenta colour must FILTER it
    await H.warm([SRC])
  })
  afterAll(() => { delete EMOJI_TILESET[LABEL] })

  test('all-faces: a GREEN tile on a MAGENTA asset comes back magenta, no green survives', () => {
    const cv = H.makeCanvas(260, 300)
    drawIsoAssetAscii(cv.getContext('2d') as unknown as CanvasRenderingContext2D, 130, 210, asset({}), 30, 15, 0, false, 'day', EMOJI_STYLE)
    const s = H.scan(cv)
    expect(s.opaque).toBeGreaterThan(300)
    expect(s.greenish).toBe(0)
    expect(s.magentaish).toBeGreaterThan(0)
  })

  test('single: the ONE centered tile is ALSO filtered to magenta (colour is a setting in both modes)', () => {
    const cv = H.makeCanvas(260, 300)
    drawIsoAssetAscii(cv.getContext('2d') as unknown as CanvasRenderingContext2D, 130, 210, asset({ settings: { display: 'single' } }), 30, 15, 0, false, 'day', EMOJI_STYLE)
    const s = H.scan(cv)
    expect(s.opaque).toBeGreaterThan(300)
    expect(s.greenish).toBe(0)                  // the single tile's image is filtered, no native green left
    expect(s.magentaish).toBeGreaterThan(0)
  })
})

describe('SINGLE_TILE_FRAC is an inset (< 1) so the block shell stays visible around the single tile', () => {
  test('the fraction is between 0 and 1', () => {
    expect(SINGLE_TILE_FRAC).toBeGreaterThan(0)
    expect(SINGLE_TILE_FRAC).toBeLessThan(1)
  })
})
