/**
 * REAL-CANVAS test harness (@napi-rs/canvas).
 *
 * jsdom's canvas is a stub — `getContext('2d')` returns null and there is no real `getImageData`,
 * so a colour/tint bug that only shows up in PIXELS is invisible to the jsdom render tests. This
 * harness wires the production render path onto a real rasteriser so a test can read back the actual
 * pixels a cube face is painted with:
 *
 *   • `global.Image`  → a registry-backed napi Image, so `tileImage()` (which does `new Image()`,
 *     `img.src = url`, then checks `complete`/`naturalWidth`) resolves a real, drawable raster for a
 *     registered URL — standing in for a baked backend tile PNG.
 *   • `document.createElement('canvas')` → a real napi canvas, so the render code's OWN offscreen
 *     canvases (`tintedImage`, the cube-sprite cache, the ground-sprite cache) rasterise for real.
 *
 * A registered image decodes ASYNCHRONOUSLY (napi decodes `img.src = buffer` off-thread), so a test
 * MUST `await warm([...srcs])` after installing the tileset and BEFORE rendering — that primes
 * `tileImage`'s cache with fully-decoded rasters. Rendering before the decode would draw a
 * transparent (not-yet-ready) image and is the caller's bug, not the renderer's.
 */
import { createCanvas, Image as NapiImage, type Canvas, type SKRSContext2D } from '@napi-rs/canvas'
import { tileImage } from '@/engine/render/shared'

const nativeSrc = Object.getOwnPropertyDescriptor(NapiImage.prototype, 'src')!

// Registered URL → encoded PNG bytes. A registry-backed Image forwards its (native) decode to these.
const registry = new Map<string, Buffer>()

/** An Image subclass wired to the registry: `img.src = url` decodes the registered PNG for that url
 *  (napi decodes a Buffer natively), so the production `new Image(); img.src = url` path resolves a
 *  real raster exactly as it would against a real HTTP tile in the browser. */
function RegistryImage(this: unknown): NapiImage {
  const img = new NapiImage()
  Object.defineProperty(img, 'src', {
    configurable: true,
    get() { return (img as unknown as { __key?: string }).__key },
    set(v: string) {
      ;(img as unknown as { __key?: string }).__key = v
      const buf = registry.get(v)
      nativeSrc.set!.call(img, buf ?? v)
    },
  })
  return img
}

let installed = false
let origCreateElement: typeof document.createElement | null = null

// When on, canvases created via `document.createElement('canvas')` (the render code's OWN offscreen
// canvases) throw on getImageData — faithfully simulating a canvas TAINTED by a cross-origin tile image,
// which is what the real backend-served PNGs do (getImageData → SecurityError). The main render target
// (makeCanvas) is never wrapped, so a test can still read its pixels.
let taintOffscreen = false

export interface RealCanvasHarness {
  /** Make a solid-fill square PNG (an emoji/ascii baked tile stand-in) and register it at `src`. */
  registerSolid(src: string, color: string, size?: number): void
  /** Make a two-band PNG (top half `top`, bottom half `bottom`) and register it — a non-monochrome tile. */
  registerBands(src: string, top: string, bottom: string, size?: number): void
  /** Prime `tileImage`'s cache with fully-decoded rasters for these srcs. MUST await before rendering. */
  warm(srcs: string[]): Promise<void>
  /** A real drawable canvas to render into. */
  makeCanvas(w: number, h: number): Canvas
  /** Scan a canvas and summarise the opaque pixels (for tint assertions). */
  scan(canvas: Canvas): PixelScan
  /** Simulate cross-origin taint: the render code's offscreen canvases throw on getImageData (as a
   *  browser does after drawing a CORS-less backend tile PNG). Models the exact real-app failure mode. */
  setTaint(on: boolean): void
}

export interface PixelScan {
  opaque: number
  meanR: number
  meanG: number
  meanB: number
  /** pixels that read clearly GREEN (G noticeably above R and B) — the "untinted green tile" signature. */
  greenish: number
  /** pixels that read clearly MAGENTA (R and B high, G low) — the "recoloured toward magenta" signature. */
  magentaish: number
  /** pixels that read clearly BLUE (B above R and G) — e.g. an untinted window-glass pane. */
  blueish: number
}

function encodeSolid(color: string, size: number): Buffer {
  const c = createCanvas(size, size)
  const ctx = c.getContext('2d')
  ctx.fillStyle = color
  ctx.fillRect(0, 0, size, size)
  return c.toBuffer('image/png')
}

function encodeBands(top: string, bottom: string, size: number): Buffer {
  const c = createCanvas(size, size)
  const ctx = c.getContext('2d')
  ctx.fillStyle = top
  ctx.fillRect(0, 0, size, Math.floor(size / 2))
  ctx.fillStyle = bottom
  ctx.fillRect(0, Math.floor(size / 2), size, size - Math.floor(size / 2))
  return c.toBuffer('image/png')
}

/** Install the real-canvas globals. Call in `beforeAll`; call the returned `restore` in `afterAll`. */
export function installRealCanvas(): { harness: RealCanvasHarness; restore: () => void } {
  if (!installed) {
    ;(globalThis as unknown as { Image: unknown }).Image = RegistryImage
    if (typeof window !== 'undefined') (window as unknown as { Image: unknown }).Image = RegistryImage
    origCreateElement = document.createElement.bind(document)
    document.createElement = ((tag: string, opts?: unknown) => {
      if (String(tag).toLowerCase() === 'canvas') return makeOffscreen()
      return origCreateElement!(tag as 'div', opts as ElementCreationOptions)
    }) as typeof document.createElement
    installed = true
  }

  const harness: RealCanvasHarness = {
    registerSolid(src, color, size = 64) { registry.set(src, encodeSolid(color, size)) },
    registerBands(src, top, bottom, size = 64) { registry.set(src, encodeBands(top, bottom, size)) },
    async warm(srcs) {
      for (const s of srcs) tileImage(s) // create + kick off the native decode, cache the Image
      await new Promise((r) => setTimeout(r, 60)) // let the async decode finish so the raster is drawable
      for (const s of srcs) tileImage(s) // resolve again now that it's complete (idempotent — same cached Image)
    },
    makeCanvas(w, h) { return createCanvas(w, h) },
    scan(canvas) { return scanPixels(canvas) },
    setTaint(on) { taintOffscreen = on },
  }
  return { harness, restore: () => { taintOffscreen = false } }
}

/** An offscreen canvas for the render code (via `document.createElement('canvas')`). In taint mode its
 *  2D context throws on getImageData — exactly like a canvas tainted by a cross-origin tile PNG. */
function makeOffscreen(): HTMLCanvasElement {
  const cv = createCanvas(300, 150)
  if (!taintOffscreen) return cv as unknown as HTMLCanvasElement
  const realGetContext = cv.getContext.bind(cv) as (t: string) => unknown
  ;(cv as unknown as { getContext: (t: string) => unknown }).getContext = (t: string) => {
    const ctx = realGetContext(t)
    if (t === '2d' && ctx) {
      ;(ctx as { getImageData: () => never }).getImageData = () => {
        throw new DOMException('Tainted canvas (cross-origin) — getImageData blocked', 'SecurityError')
      }
    }
    return ctx
  }
  return cv as unknown as HTMLCanvasElement
}

function scanPixels(canvas: Canvas): PixelScan {
  const ctx = canvas.getContext('2d') as SKRSContext2D
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  let opaque = 0, sr = 0, sg = 0, sb = 0, greenish = 0, magentaish = 0, blueish = 0
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]
    if (a < 128) continue
    const r = data[i], g = data[i + 1], b = data[i + 2]
    opaque++
    sr += r; sg += g; sb += b
    if (g > r + 40 && g > b + 40) greenish++          // clearly green (untinted leaf)
    if (r > g + 40 && b > g + 40) magentaish++         // clearly magenta (recoloured)
    if (b > r + 40 && b > g + 40) blueish++            // clearly blue (untinted window glass)
  }
  const n = Math.max(1, opaque)
  return { opaque, meanR: sr / n, meanG: sg / n, meanB: sb / n, greenish, magentaish, blueish }
}
