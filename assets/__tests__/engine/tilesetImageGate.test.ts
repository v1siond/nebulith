/**
 * THE FIX under test: the render gate must stay closed until the baked tile IMAGES are DECODED, not merely
 * until the tileset JSON installs. When the old gate opened on JSON alone, the first painted frame found
 * every `tileImage(src)` still undecoded and fell back to the tile's GLYPH — building faces tiled with the
 * brick emoji (a repeated S-like mark that reads as "a stack of brown crates"), an un-drawn hero, off trees
 * — for the ~1s the PNGs were decoding. loadTilesetsFromBackend now awaits `preloadTileImages` before it
 * resolves, so the gate the editor keys off it only opens once the rasters are ready.
 *
 * These are behavioural unit tests (real modules, mocked Image/fetch): the gate WAITS for decode, and once
 * an image is decoded the render takes the image path — the tiled-glyph flash can no longer fire. The full
 * fresh-load-with-saved-map proof is the recorded video (per-frame, on the running editor).
 */
import { preloadTileImages, tileImage } from '@/engine/render/shared'
import { fillIsoFaceWithTile } from '@/engine/render/iso'
import { loadTilesetsFromBackend } from '@/engine/tileset/tilesetLoader'
import { EMOJI_TILESET, setEmojiTileset } from '@/engine/tileset/emojiTileset'
import { NEBULITH_API } from '@/lib/nebulithApi'

const ORIGIN = NEBULITH_API.replace(/\/api\/?$/, '')
const RealImage = (global as { Image: unknown }).Image
const realFetch = global.fetch
const tick = () => new Promise((r) => setTimeout(r))

// An Image whose decode() only completes when the test FLUSHES it — lets us assert the gate is still
// closed while a raster decodes and opens the moment it lands.
class DeferredImage {
  static pending: Array<() => void> = []
  static flush(): void { const p = DeferredImage.pending; DeferredImage.pending = []; p.forEach((fn) => fn()) }
  complete = false
  naturalWidth = 0
  naturalHeight = 0
  src = ''
  decode(): Promise<void> {
    return new Promise<void>((resolve) => {
      DeferredImage.pending.push(() => { this.complete = true; this.naturalWidth = 64; this.naturalHeight = 64; resolve() })
    })
  }
}

interface Rec { ctx: CanvasRenderingContext2D; glyphs: string[]; images: unknown[] }
function recordingCtx(): Rec {
  const glyphs: string[] = []
  const images: unknown[] = []
  const ctx = {
    fillStyle: '#000', font: '', textAlign: '' as CanvasTextAlign, textBaseline: '' as CanvasTextBaseline, globalAlpha: 1,
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, transform() {},
    fillText(ch: string) { glyphs.push(ch) },
    drawImage(src: unknown) { images.push(src) },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, glyphs, images }
}

afterEach(() => {
  ;(global as { Image: unknown }).Image = RealImage
  ;(global as { fetch: typeof fetch }).fetch = realFetch
  setEmojiTileset({})
  DeferredImage.pending = []
})

describe('preloadTileImages — the decode seam the gate waits on', () => {
  test('holds until EVERY image decodes, then the shared cache tileImage reads is ready', async () => {
    ;(global as { Image: unknown }).Image = DeferredImage
    const a = '/probe/preload-a.png', b = '/probe/preload-b.png'
    let resolved = false
    const p = preloadTileImages([a, b]).then(() => { resolved = true })
    await tick()
    expect(resolved).toBe(false)      // both rasters still decoding → the caller (the gate) stays blocked
    expect(tileImage(a)).toBeNull()   // undecoded → the render would fall to the glyph HERE (the flash)
    DeferredImage.flush()
    await p
    expect(resolved).toBe(true)
    expect(tileImage(a)).not.toBeNull() // decoded → the render now takes the image path
    expect(tileImage(b)).not.toBeNull()
  })

  test('a missing/broken raster never wedges the gate (decode rejects → swallowed)', async () => {
    class FailingImage {
      complete = false; naturalWidth = 0; naturalHeight = 0; src = ''
      decode(): Promise<void> { return Promise.reject(new Error('404')) }
    }
    ;(global as { Image: unknown }).Image = FailingImage
    await expect(preloadTileImages(['/probe/broken.png'])).resolves.toBeUndefined() // resolves despite the failure
  })
})

describe('loadTilesetsFromBackend — the gate opens on DECODED images, not just the JSON', () => {
  test('the load promise stays pending after the JSON installs, until the baked PNG decodes', async () => {
    ;(global as { Image: unknown }).Image = DeferredImage
    const IMG = '/tiles/emoji/gate_probe.png'
    const payload = {
      data: [{
        key: 'emoji', name: 'Emoji', id: 1, data: {},
        tiles: { gate_probe: { emoji: '🧱', image_url: IMG, height: 1, category: 'buildings', title: 'Probe', settings: { color: '#888888' } } },
        compositions: {},
      }],
    }
    ;(global as { fetch: typeof fetch }).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => payload }) as unknown as typeof fetch

    let done = false
    const p = loadTilesetsFromBackend().then((r) => { done = true; return r })
    await tick(); await tick()

    expect(EMOJI_TILESET.gate_probe).toBeDefined() // the JSON has installed...
    expect(done).toBe(false)                       // ...but the gate has NOT opened — it's awaiting the image decode
    const src = ORIGIN + IMG
    expect(tileImage(src)).toBeNull()              // raster not ready yet

    DeferredImage.flush()
    const loaded = await p
    expect(done).toBe(true)                        // decoded → the load resolves → the gate opens
    expect(loaded).toContain('emoji')
    expect(tileImage(src)).not.toBeNull()          // the baked image was decoded BEFORE the gate opened
  })
})

describe('the render takes the image path once decoded — the tiled-glyph flash cannot fire', () => {
  test('a decoded wall image draws the IMAGE on every face, never the tiled brick glyph', () => {
    class ReadyImage { complete = true; naturalWidth = 64; naturalHeight = 64; src = ''; decode() { return Promise.resolve() } }
    ;(global as { Image: unknown }).Image = ReadyImage
    const src = '/tiles/emoji/wall_ready.png'
    expect(tileImage(src)).not.toBeNull() // synchronously decoded
    const rec = recordingCtx()
    fillIsoFaceWithTile(rec.ctx, { x: 0, y: 0 }, { x: 64, y: 0 }, { x: 0, y: 64 }, { char: '🧱', color: '#ffffff', image: { kind: 'image', src } }, 2, 3)
    expect(rec.images.length).toBe(6)     // 2×3 image tiling — the wall face is the baked IMAGE
    expect(rec.glyphs).not.toContain('🧱') // the brick glyph (the wrong render) is NOT drawn
  })

  test('an UNdecoded image tiles the glyph across the face — the exact flash the preload gate prevents', () => {
    class PendingImage { complete = false; naturalWidth = 0; naturalHeight = 0; src = ''; decode() { return new Promise<void>(() => {}) } }
    ;(global as { Image: unknown }).Image = PendingImage
    const src = '/tiles/emoji/wall_pending.png'
    expect(tileImage(src)).toBeNull() // raster not ready
    const rec = recordingCtx()
    fillIsoFaceWithTile(rec.ctx, { x: 0, y: 0 }, { x: 64, y: 0 }, { x: 0, y: 64 }, { char: 'S', color: '#b5651d', image: { kind: 'image', src } }, 2, 3)
    expect(rec.images.length).toBe(0)
    expect(rec.glyphs.filter((g) => g === 'S').length).toBe(6) // the repeated glyph on the face = the wrong render
  })

  test('a tile with NO image still draws its glyph — the kept after-load neutral render for an unknown label', () => {
    const rec = recordingCtx()
    fillIsoFaceWithTile(rec.ctx, { x: 0, y: 0 }, { x: 64, y: 0 }, { x: 0, y: 64 }, { char: '?', color: '#ffffff' }, 1, 1)
    expect(rec.images.length).toBe(0)
    expect(rec.glyphs).toContain('?') // genuinely image-less → glyph (a real data gap AFTER load, not a pre-load placeholder)
  })
})
