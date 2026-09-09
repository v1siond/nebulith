/**
 * ASCII AND EMOJI MUST RUN THE SAME ENGINE — measured at the canvas API.
 *
 * Alexander: *"I don't understand why ASCII style is so slow and with fps < 15, my only guess is that it's
 * NOT using the same emoji engine, and instead is running through some old legacy shitty code."*
 *
 * He was right. Under ASCII, `visualForTileId`/`tilesForStyle` threw the tile's baked image away and the
 * kind→image rescue was gated to `FLOOR_TYPE`, so a placed tile arrived with `dv.image === undefined`. That
 * meant:
 *   · the single-block cube SPRITE CACHE (`cubeBlockSprite`) is gated on `dv.image` → never hit under ASCII,
 *     so every cell re-drew 3 faces LIVE, every frame;
 *   · `fillIsoFaceWithTile`'s glyph branch does `beginPath + rect + clip + fillText` PER FACE (the image
 *     branch deliberately skips the clip — its own comment calls it "a real hotspot");
 *   · a label-less prop fell through to the deleted per-type glyph drawers, which called `ctx.measureText`
 *     per asset per frame.
 *
 * These tests count the actual canvas calls for the SAME assets in both styles. They fail loudly if ASCII
 * regains a glyph/clip/measureText path, or if the sprite cache stops catching it.
 */
import { loadedStyleIds, styleTiles } from '@/engine/tileset/styleTiles'
import { installRealCanvas, type RealCanvasHarness } from '@/__tests__/helpers/realCanvas'
import { installSeedTileset } from '@/__tests__/helpers/tilesetSeed'
import { drawIsoAssetAscii } from '@/engine/render/iso'
import { ASCII_STYLE, EMOJI_STYLE, type Style } from '@/game/artStyle'
import type { GridAsset } from '@/engine/IsometricGrid'

let H: RealCanvasHarness
const TW = 30, TH = 15

/** Every canvas method call, counted by name. */
type Calls = Record<string, number>

function recording(ctx: CanvasRenderingContext2D): { ctx: CanvasRenderingContext2D; calls: Calls } {
  const calls: Calls = {}
  const proxy = new Proxy(ctx as unknown as Record<string, unknown>, {
    get(target, prop: string) {
      const v = target[prop]
      if (typeof v !== 'function') return v
      return (...args: unknown[]) => {
        calls[prop] = (calls[prop] ?? 0) + 1
        return (v as (...a: unknown[]) => unknown).apply(target, args)
      }
    },
    set(target, prop: string, value) { target[prop] = value; return true },
  })
  return { ctx: proxy as unknown as CanvasRenderingContext2D, calls }
}

const asset = (over: Partial<GridAsset>): GridAsset =>
  ({ art: ['Q'], col: 3, row: 3, color: '#8bd', height: 1, ...over } as unknown as GridAsset)

/** Draw `n` copies of an asset (as a field of identical cells does) and report the canvas-call profile. */
function profile(style: Style, a: GridAsset, n = 40): Calls {
  const cv = H.makeCanvas(400, 400)
  const { ctx, calls } = recording(cv.getContext('2d') as unknown as CanvasRenderingContext2D)
  for (let i = 0; i < n; i++) drawIsoAssetAscii(ctx, 60 + (i % 8) * 30, 80 + Math.floor(i / 8) * 30, a, TW, TH, 0, false, 'day', style)
  return calls
}

/** Every baked src any loaded style references, so the harness can pre-decode them.
 *
 *  ONE loop over the styles, reading ONE field. An earlier version read `t.image` for emoji and
 *  `t.image.src` for ascii — a per-style branch inside the very suite that exists to prove there is no
 *  per-style branch. It silently registered no ascii rasters, so every ascii assertion below measured an
 *  un-decoded image rather than the engine. */
function allSrcs(): string[] {
  const out = new Set<string>()
  for (const style of loadedStyleIds()) {
    for (const t of Object.values(styleTiles(style))) if (t.image) out.add(t.image)
  }
  return [...out]
}

beforeAll(async () => {
  H = installRealCanvas().harness
  installSeedTileset()
  // Register a real raster for every tile src (the harness fakes the network), then decode them — the
  // production loader does exactly this before the render gate opens (tilesetLoader → preloadTileImages).
  for (const src of allSrcs()) H.registerSolid(src, '#ffffff')
  await H.warm(allSrcs())
})

describe('a placed tile draws through the IMAGE path in BOTH styles', () => {
  // The kinds that used to have bespoke frontend ASCII glyph art (ISO_ASCII_DRAWERS).
  const TYPES = ['tree', 'lamp', 'lantern', 'bush', 'npc', 'flower', 'rock', 'decoration', 'crate']

  for (const type of TYPES) {
    it(`${type}: ASCII draws images and never falls into a glyph/measureText path`, () => {
      const calls = profile(ASCII_STYLE, asset({ type }))
      expect(calls.drawImage ?? 0).toBeGreaterThan(0)
      expect(calls.fillText ?? 0).toBe(0)
      expect(calls.measureText ?? 0).toBe(0)
    })

    it(`${type}: the ASCII and EMOJI call profiles match call-for-call`, () => {
      expect(profile(ASCII_STYLE, asset({ type }))).toEqual(profile(EMOJI_STYLE, asset({ type })))
    })
  }
})

describe('the cube-sprite cache catches ASCII exactly as it catches emoji', () => {
  it('drawing 40 identical height-1 blocks costs ~1 blit each — no per-face clip', () => {
    for (const style of [ASCII_STYLE, EMOJI_STYLE]) {
      const calls = profile(style, asset({ type: 'tree' }), 40)
      // A cached cube is ONE drawImage per cell. A cache MISS would re-draw 3 faces per cell
      // (3 fillQuad + 3 sheared drawImage), i.e. ≥3× the drawImages and a pile of beginPath/fill.
      expect(calls.drawImage).toBeLessThanOrEqual(40 + 3) // 40 blits (+ the one-off sprite bake)
      expect(calls.clip ?? 0).toBe(0)                     // the clip hotspot is image-path-free
    }
  })
})

describe('a labeled composition cell resolves its own tile image in both styles', () => {
  it('a wall_brick_c cell paints an image, not a glyph, under ASCII', () => {
    const calls = profile(ASCII_STYLE, asset({ type: 'building', label: 'wall_brick_c' }))
    expect(calls.drawImage ?? 0).toBeGreaterThan(0)
    expect(calls.fillText ?? 0).toBe(0)
  })

  it('and the two styles agree call-for-call', () => {
    const a = asset({ type: 'building', label: 'wall_brick_c' })
    expect(profile(ASCII_STYLE, a)).toEqual(profile(EMOJI_STYLE, a))
  })
})

// ── negative path ──────────────────────────────────────────────────────────────
describe('the last-resort glyph plate — the ONE no-tile path, identical in both styles', () => {
  // `unmapped_thing` has no entry in TYPE_KIND, so assetKind → 'ground', which no tileset carries a tile
  // for. This is the only way to reach the glyph plate, and it must be reached the SAME way in both styles.
  const orphan = asset({ type: 'unmapped_thing', art: ['#'], label: undefined })

  it('draws the asset’s glyph rather than leaving the cell blank', () => {
    const calls = profile(ASCII_STYLE, orphan, 1)
    expect(calls.fillText).toBeGreaterThan(0)
    expect(calls.drawImage ?? 0).toBe(0)
  })

  it('is NOT an ASCII-only path — emoji reaches it identically', () => {
    expect(profile(ASCII_STYLE, orphan, 1)).toEqual(profile(EMOJI_STYLE, orphan, 1))
  })
})
