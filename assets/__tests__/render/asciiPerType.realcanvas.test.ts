/**
 * REAL-CANVAS lock on the legacy per-type ASCII prop art (drawIsoAssetAscii's ISO_ASCII_DRAWERS dispatch map).
 * These types have NO baked ASCII tile (public/tiles has emoji/ only), so under the ASCII style they render
 * frontend-invented glyph art — the FALLBACK the migration still has to replace with backend ASCII tiles. Until
 * then this test pins that art so the dispatch-map restructure (and any future edit) can't silently change it:
 *
 *   1. each type draws opaque pixels (the drawer actually ran),
 *   2. the recorded pick SILHOUETTE matches perTypeStackBounds per type (tree towers 5 layers, lamp/npc 3, …),
 *   3. the dispatch ROUTES distinctly — tree/lamp/bush/npc/flower/rock each render a DIFFERENT signature, so a
 *      type can't quietly fall through to the wrong drawer,
 *   4. a few font-independent colour signatures from the fillRect plates (bush green, npc shadow, lamp bulb).
 *
 * Font glyphs rasterise via a fallback face here, so assertions read the fillRect PLATES + geometry (both
 * font-independent), never exact glyph pixels.
 */
import { installRealCanvas, type RealCanvasHarness } from '@/__tests__/helpers/realCanvas'
import { drawIsoAssetAscii } from '@/engine/render/iso'
import { ASCII_STYLE } from '@/game/artStyle'
import type { GridAsset } from '@/engine/IsometricGrid'
import type { TileGeom } from '@/engine/render/tileHit'
import type { Canvas, SKRSContext2D } from '@napi-rs/canvas'

let H: RealCanvasHarness
const TW = 30, TH = 15
const LINE_H = TH * 1.3
const CX = 140, CY = 240

const asset = (over: Partial<GridAsset>): GridAsset =>
  ({ art: ['Q'], col: 3, row: 3, color: '#8bd', ...over } as unknown as GridAsset)

interface Sig { opaque: number; r: number; g: number; b: number; blackish: number; greenish: number; yellowish: number }

function render(a: GridAsset, groundContact = false): { geom: TileGeom | null; sig: Sig; cv: Canvas } {
  const cv = H.makeCanvas(280, 300)
  const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D
  const geom = drawIsoAssetAscii(ctx, CX, CY, a, TW, TH, 0, groundContact, 'day', ASCII_STYLE)
  const { data } = (cv.getContext('2d') as SKRSContext2D).getImageData(0, 0, cv.width, cv.height)
  let opaque = 0, sr = 0, sg = 0, sb = 0, blackish = 0, greenish = 0, yellowish = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    const r = data[i], g = data[i + 1], b = data[i + 2]
    opaque++; sr += r; sg += g; sb += b
    if (r < 40 && g < 40 && b < 40) blackish++
    if (g > r + 30 && g > b + 30) greenish++
    if (r > 120 && g > 100 && b < 90) yellowish++
  }
  const n = Math.max(1, opaque)
  return { geom, sig: { opaque, r: sr / n, g: sg / n, b: sb / n, blackish, greenish, yellowish }, cv }
}

/** Width/height of a recorded billboard silhouette. */
function bbox(g: TileGeom | null): { w: number; h: number } {
  if (!g || g.kind !== 'poly') throw new Error('expected a recorded billboard poly')
  const xs = g.pts.map(p => p.x), ys = g.pts.map(p => p.y)
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
}

beforeAll(() => { H = installRealCanvas().harness })

describe('legacy per-type ASCII prop art — silhouette matches perTypeStackBounds', () => {
  // [type, groundContact, expected halfW multiple of tileW, expected layer count]
  const CASES: Array<[string, boolean, number, number]> = [
    ['tree', true, 1.1, 5],
    ['lamp', false, 0.5, 3],
    ['lantern', false, 0.5, 3],
    ['npc', false, 0.55, 3],
    ['bush', false, 0.6, 2],
    ['flower', false, 0.6, 1],       // not in the stack table → the default one-layer sprite
    ['rock', false, 0.6, 1],
    ['decoration', false, 0.6, 1],
    ['crate', false, 0.6, 1],        // unmapped → default drawer, default bounds
  ]
  for (const [type, gc, mul, layers] of CASES) {
    it(`${type} draws opaque art and records a ${layers}-layer ${mul}·tileW silhouette`, () => {
      const { geom, sig } = render(asset({ type, art: ['#'] }), gc)
      expect(sig.opaque).toBeGreaterThan(0)
      const b = bbox(geom)
      expect(b.w).toBeCloseTo(2 * TW * mul, 0)
      expect(b.h).toBeCloseTo(layers * LINE_H, 0)
    })
  }
})

describe('legacy per-type ASCII prop art — the dispatch map routes each type to a DISTINCT drawer', () => {
  it('tree / lamp / bush / npc / flower / rock render pairwise-different signatures', () => {
    const sigs = {
      tree: render(asset({ type: 'tree', color: '#2e8b2e' }), true).sig,
      lamp: render(asset({ type: 'lamp' })).sig,
      bush: render(asset({ type: 'bush' })).sig,
      npc: render(asset({ type: 'npc' })).sig,
      flower: render(asset({ type: 'flower', color: '#ff88cc' })).sig,
      rock: render(asset({ type: 'rock' })).sig,
    }
    // A compact fingerprint per type; all six must be unique (no two types collapse to the same drawer).
    const fp = (s: Sig) => `${s.opaque}|${Math.round(s.r)}|${Math.round(s.g)}|${Math.round(s.b)}`
    const prints = Object.values(sigs).map(fp)
    expect(new Set(prints).size).toBe(prints.length)
  })
})

describe('legacy per-type ASCII prop art — font-independent colour signatures (fillRect plates)', () => {
  it('bush paints green foliage plates', () => {
    expect(render(asset({ type: 'bush' })).sig.greenish).toBeGreaterThan(0)
  })
  it('npc drops a black figure shadow', () => {
    expect(render(asset({ type: 'npc' })).sig.blackish).toBeGreaterThan(0)
  })
  it('lamp lights a warm bulb', () => {
    expect(render(asset({ type: 'lamp' })).sig.yellowish).toBeGreaterThan(0)
  })
})
