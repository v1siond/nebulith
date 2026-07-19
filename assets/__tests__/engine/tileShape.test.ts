/**
 * Per-tile SHAPE ('square' cube default | 'circle' rounded form) — the DATA PATH (round-trip + composition
 * passthrough) and the render ROUTING, proven in jsdom (no real raster needed).
 *
 * `shape` is a per-INSTANCE render SETTING on GridAsset, the sibling of `display`. It:
 *   1. round-trips in Template.assetsData like scaleX/pose (the deserialize shallow-clone carries it).
 *   2. can ship as a composition-CELL default (composition_cells.settings.shape → stampComposition → asset.shape).
 *   3. ROUTES the render: 'circle' draws the SAME cuboid — the tile painted on all THREE faces (its art + per-face
 *      shading kept) — and just CLIPS the silhouette round, bending the cuboid's corners away. It is NOT a
 *      repainted sphere (no single flat surface, no relight). Counted here via a recording context: circle → 3
 *      image draws (the same cube faces) PLUS a rounding clip/ellipse; square → 3 image draws with NO clip. So the
 *      clip discriminates a rounded cuboid from a plain one — both keep the 3 painted faces.
 */
import { stampComposition } from '@/game/runtime/composition'
import { drawIsoAssetAscii, roundedBlockEllipse } from '@/engine/render/iso'
import { pointInPolygon } from '@/engine/render/tileHit'
import { serializeGrid, deserializeToGrid } from '@/lib/api'
import { IsometricGrid, type GridAsset } from '@/engine/IsometricGrid'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'
import { EMOJI_TILESET } from '@/engine/tileset/emojiTileset'
import { EMOJI_STYLE } from '@/game/artStyle'
import type { Composition } from '@/engine/tileset/tileset'

// Minimal TemplateData carrying the given assetsData (other fields unused by the asset path).
const tmpl = (assetsData: unknown[]): any => ({
  id: 't', name: 'n', cols: 4, rows: 4, cellSize: 32, isoScale: 1.4, spawnCol: 0, spawnRow: 0,
  groundData: Array.from({ length: 4 }, () => Array(4).fill('grass')),
  heightData: Array.from({ length: 4 }, () => Array(4).fill(0)),
  assetsData, connectors: [], entities: [], quests: [],
  thumbnail: null, isPublic: false, tags: [], createdAt: '', updatedAt: '',
})

describe('shape round-trips in Template.assetsData like scaleX/pose', () => {
  test('a circle-shape asset survives serialize → JSON wire → deserialize; a default asset stays shape-less', () => {
    const g = new IsometricGrid({ cols: 4, rows: 4, cellSize: 32, isoScale: 1.4 })
    g.assets = [
      { art: ['o'], col: 1, row: 1, type: 'prop', shape: 'circle' } as never,
      { art: ['#'], col: 2, row: 2, type: 'prop' } as never, // no shape → stays a cube
    ]
    const wire = JSON.parse(JSON.stringify(serializeGrid(g).assetsData)) // backend store + reload
    const grid2 = deserializeToGrid(tmpl(wire))
    expect(grid2.assets.find(a => a.col === 1)?.shape).toBe('circle')
    expect(grid2.assets.find(a => a.col === 2)?.shape).toBeUndefined() // absent → default cube, unchanged
  })
})

describe('stampComposition — a composition CELL can ship a default shape (settings.shape → asset.shape)', () => {
  const BALL_LABEL = '__shape_ball__'
  const PLAIN_LABEL = '__shape_plain__'
  const KIND = '__shape_lamp__'

  beforeAll(() => {
    ASCII_TILESET.tiles[BALL_LABEL] = { label: BALL_LABEL, glyph: 'o', position: 'single', walkable: false, colorRole: 'building' }
    ASCII_TILESET.tiles[PLAIN_LABEL] = { label: PLAIN_LABEL, glyph: '#', position: 'single', walkable: false, colorRole: 'building' }
    ;(ASCII_TILESET.compositions as Record<string, Composition>)[KIND] = {
      footprint: { w: 1, h: 2 },
      cells: [
        { dx: 0, dy: 0, level: 0, label: BALL_LABEL, settings: { shape: 'circle' } }, // a globe on top
        { dx: 0, dy: 1, level: 0, label: PLAIN_LABEL }, // a plain cube post — no shape
      ],
    }
  })
  afterAll(() => {
    delete ASCII_TILESET.tiles[BALL_LABEL]
    delete ASCII_TILESET.tiles[PLAIN_LABEL]
    delete (ASCII_TILESET.compositions as Record<string, Composition>)[KIND]
  })

  test('the circle cell → asset.shape === "circle"; the plain cell → no shape (byte-identical to before)', () => {
    const grid = new IsometricGrid({ cols: 8, rows: 8, cellSize: 32, isoScale: 1.4 })
    const placed = stampComposition(grid, KIND, 2, 2, 'spring')
    expect(placed).toBe(2)
    expect(grid.assets.find(a => a.label === BALL_LABEL)?.shape).toBe('circle')
    expect(grid.assets.find(a => a.label === PLAIN_LABEL)?.shape).toBeUndefined()
  })
})

// ── Render ROUTING: drawIsoAssetAscii keeps the 3-face cube ART for BOTH shapes, and adds a rounding clip for
//    circle. The recording ctx counts drawImage (the painted tile faces) AND clip/ellipse (the rounding mask). ──
interface Rec { ctx: CanvasRenderingContext2D; images: unknown[]; clips: number; ellipses: number; curves: number }
function recordingCtx(): Rec {
  const images: unknown[] = []
  const counts = { clips: 0, ellipses: 0, curves: 0 }
  const ctx = {
    fillStyle: '#000', strokeStyle: '#000', font: '', lineWidth: 1, lineCap: '', globalAlpha: 1,
    textAlign: '' as CanvasTextAlign, textBaseline: '' as CanvasTextBaseline,
    save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    quadraticCurveTo() { counts.curves++ }, // the top-front bevel arc — round the last (interior) corner
    rect() {}, clip() { counts.clips++ }, ellipse() { counts.ellipses++ }, arc() {}, translate() {}, rotate() {}, scale() {}, transform() {},
    createLinearGradient() { return { addColorStop() {} } }, createRadialGradient() { return { addColorStop() {} } },
    stroke() {}, fill() {}, fillRect() {}, strokeRect() {}, strokeText() {}, fillText() {},
    drawImage(src: unknown) { images.push(src) },
    measureText() { return { width: 10 } as TextMetrics },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, images, get clips() { return counts.clips }, get ellipses() { return counts.ellipses }, get curves() { return counts.curves } }
}

describe('drawIsoAssetAscii ROUTES on asset.shape (end-to-end)', () => {
  const LABEL = '__shape_emoji_water__'
  const SRC = '/tiles/emoji/__shape_water.png'
  const asset = (over: Partial<GridAsset>): GridAsset => ({ art: ['?'], col: 3, row: 3, type: 'water', height: 1, label: LABEL, color: '#ff00ff', scale: 3, ...over })

  beforeAll(() => {
    class MockImage { complete = true; naturalWidth = 64; naturalHeight = 64; src = '' }
    ;(global as unknown as { Image: unknown }).Image = MockImage
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

  test('default (square) → the tile image is painted on THREE faces (3 image draws) and NO rounding clip', () => {
    const r = recordingCtx()
    drawIsoAssetAscii(r.ctx, 100, 120, asset({}), 22, 11, 0, false, 'day', EMOJI_STYLE)
    expect(r.images.length).toBe(3)
    expect(r.clips).toBe(0) // a plain cube — nothing is clipped
  })

  test('shape "square" is identical to the default (3 image draws, no clip — the cube path)', () => {
    const r = recordingCtx()
    drawIsoAssetAscii(r.ctx, 100, 120, asset({ shape: 'square' }), 22, 11, 0, false, 'day', EMOJI_STYLE)
    expect(r.images.length).toBe(3)
    expect(r.clips).toBe(0)
  })

  test('shape "circle" KEEPS the 3 painted cube faces (3 image draws — same as square), only adds a rounding clip', () => {
    const r = recordingCtx()
    drawIsoAssetAscii(r.ctx, 100, 120, asset({ shape: 'circle' }), 22, 11, 0, false, 'day', EMOJI_STYLE)
    // circle draws the SAME cuboid — the tile painted on all THREE faces (3 image draws, like the cube) — and just
    // rounds the silhouette. NOT 1 (the rejected single flat "sphere" surface that threw the faces away) and NOT 0.
    expect(r.images.length).toBe(3)
  })

  test('shape "circle" ROUNDS the form: it clips to an ellipse the square (cube) path never uses', () => {
    const r = recordingCtx()
    drawIsoAssetAscii(r.ctx, 100, 120, asset({ shape: 'circle' }), 22, 11, 0, false, 'day', EMOJI_STYLE)
    expect(r.clips).toBeGreaterThanOrEqual(1)     // the rounding mask (clipToBall) — bends the cuboid's corners away
    expect(r.ellipses).toBeGreaterThanOrEqual(1)  // that silhouette is an ellipse of the block's own extent
  })

  test('shape "circle" BEVELS the top-front vertex (Image #61): a rounded arc the square path never draws', () => {
    // The outer ellipse clip only rounds the SILHOUETTE; the top face's front point (where the bright top diamond
    // meets the two front walls) is an INTERIOR seam. roundIsoTopFrontCorner overpaints that sharp tip up to a
    // rounded arc (a quadraticCurveTo), so the last angular corner is bent too. The cube path draws no such arc.
    const sq = recordingCtx()
    drawIsoAssetAscii(sq.ctx, 100, 120, asset({ shape: 'square' }), 22, 11, 0, false, 'day', EMOJI_STYLE)
    expect(sq.curves).toBe(0) // a plain cube keeps its sharp top-front vertex — no bevel arc

    const ci = recordingCtx()
    drawIsoAssetAscii(ci.ctx, 100, 120, asset({ shape: 'circle' }), 22, 11, 0, false, 'day', EMOJI_STYLE)
    expect(ci.curves).toBeGreaterThanOrEqual(1) // circle rounds the front vertex with a curved bevel
  })
})

// ── The rounding clip must round EVERY corner (Alexander: the top point, a mid-right side corner, and the bottom
//    were "still sharp"). roundedBlockEllipse must INSCRIBE the block's projected hexagon: every one of the 6
//    silhouette vertices sits OUTSIDE the ellipse (so the clip bends it away — no vertex pokes through), AND the
//    ellipse never crosses an edge (so the whole outline is one smooth oval — no straight-edge/arc kink). ──
describe('roundedBlockEllipse — the clip inscribes the block hexagon so NO corner stays sharp', () => {
  const TW = 40, TH = 20, BH = 44
  const center = { x: 0, y: 0 }

  // The 6-vertex screen silhouette of an n-block iso cuboid (base diamond centred at center.y).
  const hexagon = (n: number) => {
    const stack = n * BH
    return [
      { x: center.x, y: center.y - stack - TH },     // TOP apex (the point Alexander circled)
      { x: center.x + TW, y: center.y - stack },      // upper-right
      { x: center.x + TW, y: center.y },              // MID-RIGHT (the side corner)
      { x: center.x, y: center.y + TH },              // BOTTOM apex
      { x: center.x - TW, y: center.y },              // mid-left
      { x: center.x - TW, y: center.y - stack },      // upper-left
    ]
  }
  const onEllipse = (v: { x: number; y: number }, e: { cx: number; cy: number; rx: number; ry: number }) =>
    ((v.x - e.cx) / e.rx) ** 2 + ((v.y - e.cy) / e.ry) ** 2

  test.each([1, 2, 3, 5])('height %i: every hexagon vertex is OUTSIDE the clip ellipse → each corner is rounded away', (n) => {
    const e = roundedBlockEllipse(center, TW, TH, BH, n)
    for (const v of hexagon(n)) {
      // ratio ≥ 1 ⇒ the vertex lies on/outside the ellipse, so the clip removes it (rounds the corner). The OLD
      // ellipse (ry = stack/2 + TH) put the apex + bottom EXACTLY on it (ratio 1, a sharp point); inscribing
      // pushes them strictly outside.
      expect(onEllipse(v, e)).toBeGreaterThan(1)
    }
  })

  test.each([1, 2, 3, 5])('height %i: the ellipse stays INSIDE the hexagon → the outline is a smooth oval (no straight-edge kink)', (n) => {
    const e = roundedBlockEllipse(center, TW, TH, BH, n)
    const poly = hexagon(n)
    // Walk the ellipse boundary; every point must fall inside the hexagon. If the ellipse poked past a slanted
    // face (the old kink), some boundary point would land OUTSIDE — the sharp mid-right corner.
    for (let i = 0; i < 720; i++) {
      const t = (i / 720) * Math.PI * 2
      const p = { x: e.cx + e.rx * Math.cos(t) * 0.999, y: e.cy + e.ry * Math.sin(t) * 0.999 }
      expect(pointInPolygon(p.x, p.y, poly)).toBe(true)
    }
  })

  test('the OLD ellipse (ry = stack/2 + tileH) POKED past the slanted face — proving the inscribe fix is load-bearing', () => {
    const n = 4, stack = n * BH
    const oldEllipse = { cx: center.x, cy: center.y - stack / 2, rx: TW, ry: stack / 2 + TH }
    const poly = hexagon(n)
    let poked = 0
    for (let i = 0; i < 720; i++) {
      const t = (i / 720) * Math.PI * 2
      const p = { x: oldEllipse.cx + oldEllipse.rx * Math.cos(t), y: oldEllipse.cy + oldEllipse.ry * Math.sin(t) }
      if (!pointInPolygon(p.x, p.y, poly)) poked++
    }
    expect(poked).toBeGreaterThan(0) // the old clip cut across the faces (the kink) — the new inscribed one does not
  })

  test('proportional: taller block → taller oval; the width stays the footprint (rx = tileW), never a fixed circle', () => {
    const unit = roundedBlockEllipse(center, TW, TH, BH, 1)
    const tall = roundedBlockEllipse(center, TW, TH, BH, 4)
    expect(unit.rx).toBe(TW)
    expect(tall.rx).toBe(TW)                  // same footprint → same width
    expect(tall.ry).toBeGreaterThan(unit.ry * 1.5) // clearly taller — the oval follows the block height
  })
})
