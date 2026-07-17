/**
 * REAL-CANVAS colour-setting tests — the standard the jsdom tests can't meet.
 *
 * MODEL (nebulith MAP-MODEL §4/§8, TILE-BACKEND-MIGRATION §5/§7, TILESET-AUTHORING §1): every tile is a
 * baked backend IMAGE resolved by label; the tile's COLOUR is a per-tile SETTING that FILTERS (recolours)
 * that image via `tintedImage` (luminance-mapped, shading kept). ONE path, every art style — no glyph
 * fallback, no per-type hack. So setting a cell's colour in the editor MUST recolour the baked tile
 * IMAGE on the cube, not merely the cell fill behind it.
 *
 * `compositionImageRender.test.ts` (jsdom) proves recolour by OBJECT IDENTITY only ("the drawn source is
 * a distinct object from the raw image"), which passes for ANY distinct object — including an UNtinted
 * one. These tests render to a real rasteriser (@napi-rs/canvas) and read the PIXELS: a GREEN baked-tile
 * stand-in painted on a cube with `color = magenta` must come back MAGENTA, with no green left.
 */
import { installRealCanvas, type RealCanvasHarness } from '@/__tests__/helpers/realCanvas'
import { drawIsoTileBlock, drawIsoAssetAscii } from '@/engine/render/iso'
import { tileImage, tintedImage, drawStyledImage } from '@/engine/render/shared'
import { EMOJI_STYLE, ASCII_STYLE } from '@/game/artStyle'
import { EMOJI_TILESET } from '@/engine/tileset/emojiTileset'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'
import type { GridAsset } from '@/engine/IsometricGrid'

let H: RealCanvasHarness

const GREEN = '#00c800'
const MAGENTA = '#ff00ff'

beforeAll(() => { H = installRealCanvas().harness })

describe('tintedImage in isolation (the filter primitive)', () => {
  test('recolours a solid GREEN image toward MAGENTA (luminance-mapped)', async () => {
    const src = '/tiles/probe/tinted-green.png'
    H.registerSolid(src, GREEN)
    await H.warm([src])
    const img = tileImage(src)!
    expect(img).toBeTruthy()

    const out = tintedImage(img, src, MAGENTA)
    // Blit the filtered raster onto a real canvas and read it back.
    const cv = H.makeCanvas(64, 64)
    cv.getContext('2d').drawImage(out as unknown as import('@napi-rs/canvas').Image, 0, 0, 64, 64)
    const s = H.scan(cv)
    expect(s.opaque).toBeGreaterThan(0)
    expect(s.magentaish).toBeGreaterThan(0)   // it went magenta
    expect(s.greenish).toBe(0)                // no green survived
    expect(s.meanR).toBeGreaterThan(s.meanG)  // red channel now dominates green
  })
})

/** Render a labeled composition cube exactly as the label path builds it (dv.image + tint), read pixels. */
function renderCubeDirect(imgSrc: string): ReturnType<RealCanvasHarness['scan']> {
  const cv = H.makeCanvas(220, 240)
  const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D
  const dv = { char: '🍃', color: MAGENTA, tint: MAGENTA, image: { kind: 'image' as const, src: imgSrc } }
  drawIsoTileBlock(ctx, { x: 110, y: 150 }, 34, 17, 30, 1, dv, MAGENTA)
  return H.scan(cv)
}

describe('colour recolours the baked tile IMAGE on a cube — drawIsoTileBlock (direct label-cube path)', () => {
  test('EMOJI/generic: a GREEN baked tile on a magenta cube comes back MAGENTA, not green', async () => {
    const src = '/tiles/probe/cube-green.png'
    H.registerSolid(src, GREEN)
    await H.warm([src])
    const s = renderCubeDirect(src)
    // The cube must be visibly present and recoloured — the leaf image itself is magenta, not green.
    expect(s.opaque).toBeGreaterThan(500)
    expect(s.greenish).toBe(0)                    // FAILS pre-fix: the green leaf image is NOT filtered
    expect(s.magentaish).toBeGreaterThan(0)
  })
})

/**
 * THE REAL RUNNING-APP BUG (empirically proven by Playwright): the backend serves tile PNGs on a
 * different origin with NO CORS header, so drawing one onto the recolour canvas TAINTS it and
 * `getImageData` throws SecurityError — the tint was silently dropped and the tile kept its native
 * colour while only the cell fill recoloured. `setTaint(true)` reproduces that exact failure mode.
 * This FAILS pre-fix (the leaf survives green) and PASSES once the recolour needs no pixel read-back.
 */
describe('colour recolours the baked tile IMAGE on a TAINTED cross-origin canvas (the running-app case)', () => {
  beforeAll(() => H.setTaint(true))
  afterAll(() => H.setTaint(false))

  test('tintedImage still recolours a GREEN tile toward MAGENTA when getImageData is blocked', async () => {
    const src = '/tiles/probe/taint-green.png'
    H.registerSolid(src, GREEN)
    await H.warm([src])
    const img = tileImage(src)!
    const out = tintedImage(img, src, MAGENTA)
    const cv = H.makeCanvas(64, 64)
    cv.getContext('2d').drawImage(out as unknown as import('@napi-rs/canvas').Image, 0, 0, 64, 64)
    const s = H.scan(cv)
    expect(s.greenish).toBe(0)                 // FAILS pre-fix: tainted → getImageData throws → untinted green
    expect(s.magentaish).toBeGreaterThan(0)
  })

  test('a GREEN emoji leaf cube set to magenta recolours the leaf IMAGE (not just the fill)', () => {
    const src = '/tiles/probe/taint-cube-green.png'
    H.registerSolid(src, GREEN)
    const cv = H.makeCanvas(220, 240)
    const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D
    const dv = { char: '🍃', color: MAGENTA, tint: MAGENTA, image: { kind: 'image' as const, src } }
    // warm is sync-safe here because registerSolid ran; ensure decode via a microtask before render:
    return H.warm([src]).then(() => {
      drawIsoTileBlock(ctx, { x: 110, y: 150 }, 34, 17, 30, 1, dv, MAGENTA)
      const s = H.scan(cv)
      expect(s.opaque).toBeGreaterThan(500)
      expect(s.greenish).toBe(0)               // FAILS pre-fix: leaf stays green on a magenta cube
      expect(s.magentaish).toBeGreaterThan(0)
    })
  })
})

const labeledAsset = (label: string, color: string): GridAsset =>
  ({ art: ['?'], col: 3, row: 3, type: 'leaf', height: 1, label, color, scale: 3 } as GridAsset)

describe('colour recolours the baked tile IMAGE on a cube — drawIsoAssetAscii label path (end-to-end)', () => {
  const EMOJI_LABEL = '__rc_emoji_leaf__'
  const ASCII_LABEL = '__rc_ascii_leaf__'
  const EMOJI_SRC = '/tiles/emoji/__rc_leaf.png'
  const ASCII_SRC = '/tiles/ascii/__rc_leaf.png'

  beforeAll(async () => {
    EMOJI_TILESET[EMOJI_LABEL] = { char: '🍃', color: '#2f8f3f', image: EMOJI_SRC, height: 1 }
    ASCII_TILESET.tiles[ASCII_LABEL] = { label: ASCII_LABEL, glyph: '#', position: 'single', walkable: false, colorRole: 'canopy', image: { kind: 'image', src: ASCII_SRC } }
    H.registerSolid(EMOJI_SRC, GREEN)
    H.registerSolid(ASCII_SRC, '#ffffff') // ascii tiles bake as white tint-targets
    await H.warm([EMOJI_SRC, ASCII_SRC])
  })
  afterAll(() => { delete EMOJI_TILESET[EMOJI_LABEL]; delete ASCII_TILESET.tiles[ASCII_LABEL] })

  test('EMOJI: a leaf cube set to magenta recolours the leaf IMAGE (not just the cell fill)', () => {
    const cv = H.makeCanvas(240, 260)
    const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D
    drawIsoAssetAscii(ctx, 120, 170, labeledAsset(EMOJI_LABEL, MAGENTA), 30, 15, 0, false, 'day', EMOJI_STYLE)
    const s = H.scan(cv)
    expect(s.opaque).toBeGreaterThan(500)
    expect(s.greenish).toBe(0)                 // FAILS pre-fix: leaf stays green on a magenta cube
    expect(s.magentaish).toBeGreaterThan(0)
  })

  test('ASCII: a white leaf tile set to magenta recolours the tile IMAGE to magenta', () => {
    const cv = H.makeCanvas(240, 260)
    const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D
    drawIsoAssetAscii(ctx, 120, 170, labeledAsset(ASCII_LABEL, MAGENTA), 30, 15, 0, false, 'day', ASCII_STYLE)
    const s = H.scan(cv)
    expect(s.opaque).toBeGreaterThan(500)
    expect(s.magentaish).toBeGreaterThan(0)    // white → magenta
  })
})

describe('per-art-style scenarios — stacked, multi-detail, and NEGATIVE cases', () => {
  const STACK_LABEL = '__rc_stack_leaf__'
  const WINDOW_LABEL = '__rc_window__'
  const STACK_SRC = '/tiles/emoji/__rc_stack.png'
  const WINDOW_SRC = '/tiles/emoji/__rc_window.png'
  const NATIVE_SRC = '/tiles/emoji/__rc_native.png'

  beforeAll(async () => {
    EMOJI_TILESET[STACK_LABEL] = { char: '🍃', color: '#2f8f3f', image: STACK_SRC, height: 1 }
    EMOJI_TILESET[WINDOW_LABEL] = { char: '🪟', color: '#7fb4d8', image: WINDOW_SRC, height: 1 }
    H.registerSolid(STACK_SRC, GREEN)
    H.registerBands(WINDOW_SRC, '#3060c0', '#ffffff') // a window: blue glass over a white frame
    H.registerSolid(NATIVE_SRC, GREEN)
    await H.warm([STACK_SRC, WINDOW_SRC, NATIVE_SRC])
  })
  afterAll(() => { delete EMOJI_TILESET[STACK_LABEL]; delete EMOJI_TILESET[WINDOW_LABEL] })

  test('EMOJI: colour recolours a tile on a STACKED/scaled cell (leaf @ scaleY 2)', () => {
    const cv = H.makeCanvas(260, 300)
    const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D
    const stacked = { art: ['?'], col: 3, row: 3, type: 'leaf', height: 1, label: STACK_LABEL, color: MAGENTA, scale: 2, scaleY: 2 } as GridAsset
    drawIsoAssetAscii(ctx, 130, 210, stacked, 30, 15, 0, false, 'day', EMOJI_STYLE)
    const s = H.scan(cv)
    expect(s.opaque).toBeGreaterThan(500)
    expect(s.greenish).toBe(0)                 // the taller stack's leaf image is recoloured on every face
    expect(s.magentaish).toBeGreaterThan(0)
  })

  test('EMOJI: colour filters a MULTI-DETAIL tile (window: blue glass + white frame) — the WHOLE image', () => {
    const cv = H.makeCanvas(240, 260)
    const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D
    const win = { art: ['?'], col: 3, row: 3, type: 'window', height: 1, label: WINDOW_LABEL, color: MAGENTA, scale: 3 } as GridAsset
    drawIsoAssetAscii(ctx, 120, 170, win, 30, 15, 0, false, 'day', EMOJI_STYLE)
    const s = H.scan(cv)
    expect(s.opaque).toBeGreaterThan(500)
    expect(s.blueish).toBe(0)                  // the blue glass pane recoloured (colour applies to the window image)
    expect(s.magentaish).toBeGreaterThan(0)
  })

  test('NEGATIVE: a billboard tile with NO colour set renders its NATIVE image unchanged (not recoloured)', () => {
    const cv = H.makeCanvas(80, 80)
    const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D
    const img = tileImage(NATIVE_SRC)!
    drawStyledImage(ctx, { kind: 'image', src: NATIVE_SRC }, 40, 40, 64) // no tint arg → native
    const s = H.scan(cv)
    expect(s.greenish).toBeGreaterThan(0)      // stays GREEN — no colour set, so the native image is untouched
    expect(s.magentaish).toBe(0)
    expect(img).toBeTruthy()
  })

  test('NEGATIVE: an unparseable colour is ignored — tintedImage returns the native image (no throw)', async () => {
    const src = '/tiles/emoji/__rc_badcolor.png'
    H.registerSolid(src, GREEN)
    await H.warm([src])
    const img = tileImage(src)!
    const out = tintedImage(img, src, 'not-a-real-colour') // unparseable → return the image untouched
    expect(out).toBe(img)
  })
})
