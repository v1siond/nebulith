/**
 * Per-tile DISPLAY MODE — the DATA PATH (settings → tileRenderBehavior → asset) and the render ROUTING.
 *
 * `display` is a per-tile render SETTING ("all-faces" | "single") that rides the SAME generic path as
 * fadeNear/cutawayRoof: the API serves the tile's `settings` verbatim; `tileRenderBehavior` extracts the
 * behavior keys onto the placed asset; the render reads `asset.settings.display`. Only the NON-default
 * "single" carries through — "all-faces" / absent leaves `asset.settings` unset, so a default tile is
 * byte-identical to before.
 *
 * This file proves (jsdom, no real raster needed):
 *   1. `tileRenderBehavior` extracts `display` correctly (and never leaks it for the default).
 *   2. `stampComposition` copies a tile's `settings.display` onto the placed asset (settings → asset).
 *   3. `drawIsoAssetAscii` ROUTES on `asset.settings.display`: "single" draws the tile ONCE (a centered
 *      billboard) while "all-faces"/default draws it on all THREE faces — counted via a recording context.
 */
import { tileRenderBehavior } from '@/engine/tileset/tileset'
import { stampComposition } from '@/game/runtime/composition'
import { drawIsoAssetAscii } from '@/engine/render/iso'
import { IsometricGrid, type GridAsset } from '@/engine/IsometricGrid'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'
import { EMOJI_TILESET } from '@/engine/tileset/emojiTileset'
import { EMOJI_STYLE } from '@/game/artStyle'
import type { Composition } from '@/engine/tileset/tileset'

describe('tileRenderBehavior — extracts settings.display (the data extraction)', () => {
  test('absent settings → undefined (a default tile carries nothing)', () => {
    expect(tileRenderBehavior(undefined)).toBeUndefined()
    expect(tileRenderBehavior({})).toBeUndefined()
  })

  test('display "all-faces" carries NOTHING — only the non-default rides through', () => {
    expect(tileRenderBehavior({ display: 'all-faces' })).toBeUndefined()
  })

  test('display "single" → { display: "single" }', () => {
    expect(tileRenderBehavior({ display: 'single' })).toEqual({ display: 'single' })
  })

  test('display rides ALONGSIDE fadeNear/cutawayRoof, not instead of them', () => {
    expect(tileRenderBehavior({ fadeNear: true, display: 'single' })).toEqual({ fadeNear: true, display: 'single' })
    expect(tileRenderBehavior({ fadeNear: true })).toEqual({ fadeNear: true }) // no display key leaks in
  })
})

describe('stampComposition — a composition cell copies its tile\'s settings.display onto the placed asset', () => {
  const SINGLE_LABEL = '__disp_water_single__'
  const PLAIN_LABEL = '__disp_water_plain__'
  const KIND = '__disp_fountain__'

  beforeAll(() => {
    ASCII_TILESET.tiles[SINGLE_LABEL] = { label: SINGLE_LABEL, glyph: '~', position: 'single', walkable: false, colorRole: 'water', settings: { display: 'single' } }
    ASCII_TILESET.tiles[PLAIN_LABEL] = { label: PLAIN_LABEL, glyph: '~', position: 'single', walkable: false, colorRole: 'water' } // no display setting
    ;(ASCII_TILESET.compositions as Record<string, Composition>)[KIND] = {
      footprint: { w: 1, h: 2 },
      cells: [
        { dx: 0, dy: 0, level: 0, label: SINGLE_LABEL },
        { dx: 0, dy: 1, level: 0, label: PLAIN_LABEL },
      ],
    }
  })
  afterAll(() => {
    delete ASCII_TILESET.tiles[SINGLE_LABEL]
    delete ASCII_TILESET.tiles[PLAIN_LABEL]
    delete (ASCII_TILESET.compositions as Record<string, Composition>)[KIND]
  })

  test('the "single" tile → asset.settings.display === "single"; the plain tile → no display (byte-identical)', () => {
    const grid = new IsometricGrid({ cols: 8, rows: 8, cellSize: 32, isoScale: 1.4 })
    const placed = stampComposition(grid, KIND, 2, 2, 'spring')
    expect(placed).toBe(2)
    const single = grid.assets.find(a => a.label === SINGLE_LABEL)
    const plain = grid.assets.find(a => a.label === PLAIN_LABEL)
    expect(single?.settings?.display).toBe('single')
    expect(plain?.settings?.display).toBeUndefined() // a tile that never opted in keeps settings unset
  })
})

// ── Render ROUTING: drawIsoAssetAscii draws the tile ONCE (single) vs on THREE faces (all-faces) ──
// A recording context that counts drawImage calls (each face paint / the single billboard is one drawImage).
interface Rec { ctx: CanvasRenderingContext2D; images: unknown[] }
function recordingCtx(): Rec {
  const images: unknown[] = []
  const ctx = {
    fillStyle: '#000', strokeStyle: '#000', font: '', lineWidth: 1, lineCap: '', globalAlpha: 1,
    textAlign: '' as CanvasTextAlign, textBaseline: '' as CanvasTextBaseline,
    save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    rect() {}, clip() {}, ellipse() {}, arc() {}, translate() {}, rotate() {}, scale() {}, transform() {},
    createLinearGradient() { return { addColorStop() {} } }, createRadialGradient() { return { addColorStop() {} } },
    stroke() {}, fill() {}, fillRect() {}, strokeRect() {}, strokeText() {}, fillText() {},
    drawImage(src: unknown) { images.push(src) },
    measureText() { return { width: 10 } as TextMetrics },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, images }
}

describe('drawIsoAssetAscii ROUTES on asset.settings.display (end-to-end)', () => {
  const LABEL = '__disp_emoji_water__'
  const SRC = '/tiles/emoji/__disp_water.png'
  const asset = (over: Partial<GridAsset>): GridAsset => ({ art: ['?'], col: 3, row: 3, type: 'water', height: 1, label: LABEL, color: '#ff00ff', scale: 3, ...over })

  beforeAll(() => {
    // A synchronously "decoded" image so tileImage(src) is truthy → the image path is reached.
    class MockImage { complete = true; naturalWidth = 64; naturalHeight = 64; src = '' }
    ;(global as unknown as { Image: unknown }).Image = MockImage
    // A minimal working offscreen 2D context so tintedImage completes (mirrors compositionImageRender.test.ts).
    class FakeOffscreenCtx {
      globalCompositeOperation = 'source-over'; fillStyle = '#000'
      drawImage(): void {}; fillRect(): void {}
      getImageData(_x: number, _y: number, w: number, h: number) { return { data: new Uint8ClampedArray(Math.max(4, w * h * 4)) } }
      putImageData(): void {}
    }
    ;(HTMLCanvasElement.prototype as unknown as { getContext: (t: string) => unknown }).getContext = function (t: string) {
      return t === '2d' ? new FakeOffscreenCtx() : null
    }
    EMOJI_TILESET[LABEL] = { char: '🌊', color: '#2f6fbf', image: SRC, height: 1 }
  })
  afterAll(() => { delete EMOJI_TILESET[LABEL] })

  test('default (no settings) → the tile is painted on THREE faces (3 image draws)', () => {
    const r = recordingCtx()
    drawIsoAssetAscii(r.ctx, 100, 120, asset({}), 22, 11, 0, false, 'day', EMOJI_STYLE)
    expect(r.images.length).toBe(3)
  })

  test('display "all-faces" is identical to the default (3 image draws)', () => {
    const r = recordingCtx()
    drawIsoAssetAscii(r.ctx, 100, 120, asset({ settings: { display: 'all-faces' } }), 22, 11, 0, false, 'day', EMOJI_STYLE)
    expect(r.images.length).toBe(3)
  })

  test('display "single" → the tile is drawn ONCE (1 image draw — the centered billboard)', () => {
    const r = recordingCtx()
    drawIsoAssetAscii(r.ctx, 100, 120, asset({ settings: { display: 'single' } }), 22, 11, 0, false, 'day', EMOJI_STYLE)
    expect(r.images.length).toBe(1)
  })
})
