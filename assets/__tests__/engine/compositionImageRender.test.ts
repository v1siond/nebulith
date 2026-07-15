/**
 * The tileset loader now populates each tile's backend IMAGE (ASCII_TILESET.tiles[label].image is an
 * ImageVisual; EMOJI_TILESET[label].image is a URL string), but the COMPOSITION render path (a labeled
 * tree/building/feature cell drawn as an iso cube / 2D cell / top cell) still drew the glyph, never the
 * image. This proves it now draws the image — mirroring emojiImageTiles.test.ts's setup and
 * tileRouting.test.ts's recordingCtx render-test pattern.
 *
 * The core rule under test:
 *   - ascii tile images are white, TRANSPARENT TINT-TARGETS → the engine must recolour them.
 *   - emoji tile images are ALREADY COLOURED (Noto/baked PNGs) → they must NOT be recoloured.
 *   - no image on the label → falls back to the glyph, never a blank cell/block.
 *
 * Recolour is proven by IDENTITY, not by inspecting pixels: tintedImage(img, src, tint) returns a
 * DISTINCT offscreen canvas object when a tint is given (and the fake 2D context below makes that path
 * succeed instead of degrading to "no document/no context" passthrough); with no tint it returns the raw
 * image untouched. So "the drawn source !== the raw stub image" IS "a tint was applied", and
 * "drawn source === the raw stub image" IS "no tint was applied" — a genuine behavioural assertion.
 */
import { installTilesetPayload } from '@/engine/tileset/tilesetLoader'
import tilesetFixture from '@/__tests__/fixtures/tilesets.json'
import { drawIsoAssetAscii } from '@/engine/render/iso'
import { draw2DLabeledCell } from '@/engine/render/topdown'
import { renderTopView } from '@/engine/render/birdseye'
import { tileImage } from '@/engine/render/shared'
import { IsometricGrid, type GridAsset } from '@/engine/IsometricGrid'
import { EMOJI_STYLE, ASCII_STYLE, type Style } from '@/game/artStyle'
import { EMOJI_TILESET } from '@/engine/tileset/emojiTileset'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'
import type { PlayerState } from '@/game/runtime/player'

const LABEL = '__test_comp_label__'
const NO_IMAGE_LABEL = '__test_comp_no_image__'
const ASCII_SRC = '/tiles/ascii/__test.png'
const EMOJI_SRC = '/tiles/emoji/baked/__test.png'

beforeAll(() => {
  // A synchronously "decoded" image so tileImage(src) is truthy → an IMAGE tile reaches drawImage.
  class MockImage {
    complete = true
    naturalWidth = 64
    naturalHeight = 64
    src = ''
  }
  ;(global as unknown as { Image: unknown }).Image = MockImage
  // A minimal, WORKING offscreen 2D context (unlike tileRouting.test.ts's `() => null`) so tintedImage's
  // draw/getImageData/putImageData sequence actually completes and hands back a genuinely DISTINCT
  // canvas object — the signal this file uses to prove a tint was (or wasn't) applied.
  class FakeOffscreenCtx {
    drawImage(): void {}
    getImageData(_x: number, _y: number, w: number, h: number) {
      return { data: new Uint8ClampedArray(Math.max(4, w * h * 4)) }
    }
    putImageData(): void {}
  }
  ;(HTMLCanvasElement.prototype as unknown as { getContext: (t: string) => unknown }).getContext = function (t: string) {
    return t === '2d' ? new FakeOffscreenCtx() : null
  }
  // The render paints ground from the loaded backend tileset's terrain; install ONLY the ascii entry so
  // ASCII_TILESET has terrain (no longer bundled). Emoji is left as the bundled default on purpose — this
  // suite drives EMOJI_TILESET/EMOJI_STYLE manually, so it must not be rebuilt from the fixture.
  installTilesetPayload((tilesetFixture.data as Parameters<typeof installTilesetPayload>[0]).filter(t => t.key === 'ascii'))
})

beforeEach(() => {
  EMOJI_TILESET[LABEL] = { char: '¤', color: '#334455', image: EMOJI_SRC }
  EMOJI_TILESET[NO_IMAGE_LABEL] = { char: '¥', color: '#112233' } // no image → glyph fallback
  ASCII_TILESET.tiles[LABEL] = { label: LABEL, glyph: '#', position: 'single', walkable: false, colorRole: 'canopy', image: { kind: 'image', src: ASCII_SRC } }
  ASCII_TILESET.tiles[NO_IMAGE_LABEL] = { label: NO_IMAGE_LABEL, glyph: '¥', position: 'single', walkable: false, colorRole: 'canopy' } // no image
})

afterEach(() => {
  delete EMOJI_TILESET[LABEL]
  delete EMOJI_TILESET[NO_IMAGE_LABEL]
  delete ASCII_TILESET.tiles[LABEL]
  delete ASCII_TILESET.tiles[NO_IMAGE_LABEL]
})

interface Rec {
  ctx: CanvasRenderingContext2D
  glyphs: string[]
  images: unknown[]
}
function recordingCtx(): Rec {
  const glyphs: string[] = []
  const images: unknown[] = []
  const ctx = {
    fillStyle: '#000', strokeStyle: '#000', font: '', lineWidth: 1, lineCap: '', globalAlpha: 1,
    textAlign: '' as CanvasTextAlign, textBaseline: '' as CanvasTextBaseline,
    save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    rect() {}, clip() {}, ellipse() {}, arc() {}, quadraticCurveTo() {}, bezierCurveTo() {}, setLineDash() {},
    translate() {}, rotate() {}, scale() {}, transform() {},
    createLinearGradient() { return { addColorStop() {} } },
    createRadialGradient() { return { addColorStop() {} } },
    stroke() {}, fill() {}, fillRect() {}, strokeRect() {}, strokeText() {},
    fillText(ch: string) { glyphs.push(ch) },
    drawImage(src: unknown) { images.push(src) },
    measureText() { return { width: 10 } as TextMetrics },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, glyphs, images }
}

const asset = (over: Partial<GridAsset>): GridAsset => ({ art: ['?'], col: 3, row: 3, type: 'x', height: 1, label: LABEL, ...over })

describe('composition tiles paint their backend IMAGE (tint ascii, never emoji) — iso', () => {
  test('ascii: the label image is drawn AND recoloured to the block tint', () => {
    const rawImg = tileImage(ASCII_SRC)
    const r = recordingCtx()
    drawIsoAssetAscii(r.ctx, 100, 100, asset({ color: '#ff00ff' }), 22, 11, 0, false, 'day', ASCII_STYLE)
    expect(r.images.length).toBeGreaterThan(0) // the image reached drawImage (the cube faces)
    expect(r.images.every((src) => src !== rawImg)).toBe(true) // every face drew the TINTED sprite, not the raw white image
  })

  test('emoji: the label image is drawn but NOT recoloured', () => {
    const rawImg = tileImage(EMOJI_SRC)
    const r = recordingCtx()
    drawIsoAssetAscii(r.ctx, 100, 100, asset({ color: '#ff00ff' }), 22, 11, 0, false, 'day', EMOJI_STYLE)
    expect(r.images.length).toBeGreaterThan(0)
    expect(r.images.every((src) => src === rawImg)).toBe(true) // untouched — a colour-emoji PNG is never recoloured
  })

  test('a label with no image still draws its glyph (never blank)', () => {
    const rAscii = recordingCtx()
    drawIsoAssetAscii(rAscii.ctx, 100, 100, asset({ label: NO_IMAGE_LABEL, art: ['Q'] }), 22, 11, 0, false, 'day', ASCII_STYLE)
    expect(rAscii.images.length).toBe(0)
    expect(rAscii.glyphs).toContain('Q')

    const rEmoji = recordingCtx()
    drawIsoAssetAscii(rEmoji.ctx, 100, 100, asset({ label: NO_IMAGE_LABEL, art: ['Q'] }), 22, 11, 0, false, 'day', EMOJI_STYLE)
    expect(rEmoji.images.length).toBe(0)
    expect(rEmoji.glyphs).toContain(EMOJI_TILESET[NO_IMAGE_LABEL].char)
  })
})

describe('composition tiles paint their backend IMAGE (tint ascii, never emoji) — 2D (draw2DLabeledCell)', () => {
  test('ascii: recoloured image', () => {
    const rawImg = tileImage(ASCII_SRC)
    const r = recordingCtx()
    draw2DLabeledCell(r.ctx, 100, 100, 20, 20, asset({ color: '#00ff88' }), ASCII_STYLE)
    expect(r.images.length).toBeGreaterThan(0)
    expect(r.images.every((src) => src !== rawImg)).toBe(true)
  })

  test('emoji: untinted image', () => {
    const rawImg = tileImage(EMOJI_SRC)
    const r = recordingCtx()
    draw2DLabeledCell(r.ctx, 100, 100, 20, 20, asset({ color: '#00ff88' }), EMOJI_STYLE)
    expect(r.images.length).toBeGreaterThan(0)
    expect(r.images.every((src) => src === rawImg)).toBe(true)
  })

  test('no image → glyph fallback', () => {
    const r = recordingCtx()
    draw2DLabeledCell(r.ctx, 100, 100, 20, 20, asset({ label: NO_IMAGE_LABEL, art: ['Q'] }), ASCII_STYLE)
    expect(r.images.length).toBe(0)
    expect(r.glyphs).toContain('Q')
  })
})

describe('composition tiles paint their backend IMAGE (tint ascii, never emoji) — top (renderTopView)', () => {
  const player = (): PlayerState => ({ x: 5 * 32, z: 5 * 32, moving: false } as PlayerState)
  const gridWith = (label: string, color?: string): IsometricGrid => {
    const grid = new IsometricGrid({ cols: 10, rows: 10, cellSize: 32, isoScale: 1 })
    grid.setAssets([{ art: ['Q'], col: 4, row: 4, type: 'x', height: 1, label, color } as GridAsset])
    return grid
  }
  const run = (ctx: CanvasRenderingContext2D, grid: IsometricGrid, style: Style) =>
    renderTopView(ctx, 480, 480, grid, player(), 1, new Set(), [], false, { x: 0, y: 0 }, [], new Map(), [], 0, [], 'day', style)

  test('ascii: recoloured image', () => {
    const rawImg = tileImage(ASCII_SRC)
    const r = recordingCtx()
    run(r.ctx, gridWith(LABEL, '#00ff88'), ASCII_STYLE)
    expect(r.images.length).toBeGreaterThan(0)
    expect(r.images.every((src) => src !== rawImg)).toBe(true)
  })

  test('emoji: untinted image', () => {
    const rawImg = tileImage(EMOJI_SRC)
    const r = recordingCtx()
    run(r.ctx, gridWith(LABEL, '#00ff88'), EMOJI_STYLE)
    expect(r.images.length).toBeGreaterThan(0)
    expect(r.images.every((src) => src === rawImg)).toBe(true)
  })

  test('no image → glyph fallback', () => {
    const r = recordingCtx()
    run(r.ctx, gridWith(NO_IMAGE_LABEL), ASCII_STYLE)
    expect(r.images.length).toBe(0)
    expect(r.glyphs).toContain('Q')
  })
})
