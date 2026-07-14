/**
 * ROUTING GUARDRAIL (Phase 2) — the RENDERERS must DRAW from the resolved tiles, not from hardcoded
 * colors/shapes/glyphs that bypass the tileset. tileCoverage.test.ts proves every identifier RESOLVES
 * to a tile; this proves the draw sites actually USE it.
 *
 * Under the EMOJI style each previously-hardcoded world draw must produce a tile — a baked IMAGE
 * (ctx.drawImage) for image tiles, or the tile's own emoji glyph for glyph-only tiles (roof 🟥,
 * fountain ⛲) — NEVER the old fillRect blueprint / procedural arcs / ◊ / raw frame glyph. Under ASCII
 * the passthrough look is preserved (◊ portal, blueprint roof, procedural fountain, \ | / frame glyph).
 *
 * A decoded image is normally unavailable headless (tileImage → null → glyph fallback), so we stub
 * Image (complete + naturalWidth) so an IMAGE tile genuinely reaches ctx.drawImage — and force offscreen
 * 2D contexts to null so the tint/recolour helpers fall back cleanly to that same drawImage / plain glyph.
 */
import { drawConnectorMarker, drawAttackAnimFrame, drawProjectileGlyph } from '@/engine/render/shared'
import { drawIsoAssetAscii } from '@/engine/render/iso'
import { makeBuilding } from '@/engine/buildingEditor'
import { EMOJI_STYLE, ASCII_STYLE } from '@/game/artStyle'
import type { GridAsset } from '@/engine/IsometricGrid'
import type { AttackAnim, AnimFrame } from '@/engine/attackAnimations'

beforeAll(() => {
  // A decodable image so tileImage(src) is truthy → an IMAGE tile reaches ctx.drawImage.
  class MockImage {
    complete = true
    naturalWidth = 64
    naturalHeight = 64
    src = ''
  }
  ;(global as unknown as { Image: unknown }).Image = MockImage
  // No real 2D offscreen in jsdom → the tint/scratch helpers (tintedImage / fillTintedGlyph / tintedGlyphSprite)
  // take their fallback path (raw image / plain glyph), so a tile still lands on the recording ctx.
  ;(HTMLCanvasElement.prototype as unknown as { getContext: () => null }).getContext = () => null
})

interface Rec {
  ctx: CanvasRenderingContext2D
  glyphs: string[]
  images: number
  fills: number
  strokes: number
  rects: number
}
function recordingCtx(): Rec {
  const glyphs: string[] = []
  const c = { images: 0, fills: 0, strokes: 0, rects: 0 }
  const ctx = {
    fillStyle: '#000', strokeStyle: '#000', font: '', lineWidth: 1, lineCap: '', globalAlpha: 1,
    textAlign: '' as CanvasTextAlign, textBaseline: '' as CanvasTextBaseline,
    save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    rect() {}, clip() {}, ellipse() {}, arc() {}, quadraticCurveTo() {},
    translate() {}, rotate() {}, scale() {}, transform() {},
    createRadialGradient() { return { addColorStop() {} } },
    stroke() { c.strokes++ }, fill() { c.fills++ }, fillRect() { c.rects++ }, strokeRect() { c.strokes++ },
    fillText(ch: string) { glyphs.push(ch) },
    drawImage() { c.images++ },
    measureText() { return { width: 10 } as TextMetrics },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, glyphs, get images() { return c.images }, get fills() { return c.fills }, get strokes() { return c.strokes }, get rects() { return c.rects } } as Rec
}

const asset = (over: Partial<GridAsset>): GridAsset => ({ art: ['?'], col: 3, row: 3, type: 'x', ...over })

// ── G5 · connector / portal marker ────────────────────────────────────────────────────────────
describe('G5 connector marker routes through the tile (all views share drawConnectorMarker)', () => {
  test('EMOJI → the 🌀 connector tile IMAGE (drawImage), never the hardcoded ◊', () => {
    const r = recordingCtx()
    drawConnectorMarker(r.ctx, EMOJI_STYLE, 100, 100, 20)
    expect(r.images).toBeGreaterThanOrEqual(1)
    expect(r.glyphs).not.toContain('◊')
  })
  test('ASCII → the ◊ glyph, no tile image', () => {
    const r = recordingCtx()
    drawConnectorMarker(r.ctx, ASCII_STYLE, 100, 100, 20)
    expect(r.glyphs).toContain('◊')
    expect(r.images).toBe(0)
  })
})

// ── G4 · projectiles ──────────────────────────────────────────────────────────────────────────
describe('G4 projectile routes the glyph → its baked arrow/bullet/dart tile', () => {
  test('EMOJI → the ➤ arrow tile IMAGE (drawImage), not fillText', () => {
    const r = recordingCtx()
    drawProjectileGlyph(r.ctx, '➤', 100, 100, 0, 0, 10, 0, EMOJI_STYLE, 20, '#ffe9a8')
    expect(r.images).toBeGreaterThanOrEqual(1)
    expect(r.glyphs).not.toContain('➤')
  })
  test('ASCII → the rotated ➤ glyph, no tile image (byte-identical to before)', () => {
    const r = recordingCtx()
    drawProjectileGlyph(r.ctx, '➤', 100, 100, 0, 0, 10, 0, ASCII_STYLE, 20, '#ffe9a8')
    expect(r.glyphs).toEqual(['➤'])
    expect(r.images).toBe(0)
  })
  test('no style arg → glyph (back-compat with the existing projectile call sites)', () => {
    const r = recordingCtx()
    drawProjectileGlyph(r.ctx, '•', 100, 100, 0, 0, 10, 0)
    expect(r.glyphs).toEqual(['•'])
    expect(r.images).toBe(0)
  })
})

// ── G4 · attack-swing animations ────────────────────────────────────────────────────────────────
describe('G4 attack animation routes the ability → its FX tile', () => {
  const anim = (): AttackAnim => ({ kind: 'slash', animation: 'fire-slash', fromX: 0, fromZ: 0, toX: 10, toZ: 0, start: 0, durationMs: 200 })
  const frame = (): AnimFrame => ({ char: '/', x: 0, z: 0, color: '#ff7a2a', angle: 0.4 })

  test('EMOJI → the fire-slash tile IMAGE (drawImage), keeping the arc rotation, not the \\|/ glyph', () => {
    const r = recordingCtx()
    drawAttackAnimFrame(r.ctx, anim(), frame(), EMOJI_STYLE, 100, 100, 24)
    expect(r.images).toBeGreaterThanOrEqual(1)
    expect(r.glyphs).not.toContain('/')
  })
  test('ASCII → the frame glyph, no tile image', () => {
    const r = recordingCtx()
    drawAttackAnimFrame(r.ctx, anim(), frame(), ASCII_STYLE, 100, 100, 24)
    expect(r.glyphs).toContain('/')
    expect(r.images).toBe(0)
  })
  test('a basic attack with NO ability animation stays the frame glyph even under emoji', () => {
    const r = recordingCtx()
    const basic: AttackAnim = { kind: 'shot', fromX: 0, fromZ: 0, toX: 10, toZ: 0, start: 0, durationMs: 360 }
    drawAttackAnimFrame(r.ctx, basic, { char: '➤', x: 0, z: 0, color: '#cfd8e3' }, EMOJI_STYLE, 100, 100, 24)
    expect(r.glyphs).toContain('➤')
    expect(r.images).toBe(0)
  })
})

// ── G3 · well (3D from the tile) + boss (a prop) in iso ─────────────────────────────────────────
describe('G3 well/boss route through resolveDraw in iso (no procedural / raw-glyph branch under emoji)', () => {
  test('EMOJI well → a 3D tile BLOCK: the well tile IMAGE on filled faces (depth preserved), not drawIsoWellFountain', () => {
    const r = recordingCtx()
    drawIsoAssetAscii(r.ctx, 100, 100, asset({ type: 'well', art: ['O'] }), 22, 11, 0, false, 'day', EMOJI_STYLE)
    expect(r.images).toBeGreaterThanOrEqual(1) // the well.png sheared onto the block faces
    expect(r.fills).toBeGreaterThanOrEqual(3) // 3D depth: two side faces + a top cap
  })
  test('ASCII well → its TILE glyph (asset.art), NOT a bespoke procedural basin drawer', () => {
    const r = recordingCtx()
    drawIsoAssetAscii(r.ctx, 100, 100, asset({ type: 'well', art: ['O'] }), 22, 11, 0, false, 'day', ASCII_STYLE)
    expect(r.images).toBe(0)
    expect(r.glyphs).toContain('O') // renders the asset's tile glyph via the generic path — no fountain/well drawer
  })
  test('EMOJI boss → its 👹 tile IMAGE (drawImage), not the raw art glyph', () => {
    const r = recordingCtx()
    drawIsoAssetAscii(r.ctx, 100, 100, asset({ type: 'boss', art: ['Ω'] }), 22, 11, 0, false, 'day', EMOJI_STYLE)
    expect(r.images).toBeGreaterThanOrEqual(1)
    expect(r.glyphs).not.toContain('Ω')
  })
  test('ASCII boss → the raw art glyph, no tile image', () => {
    const r = recordingCtx()
    drawIsoAssetAscii(r.ctx, 100, 100, asset({ type: 'boss', art: ['Ω'] }), 22, 11, 0, false, 'day', ASCII_STYLE)
    expect(r.glyphs).toContain('Ω')
    expect(r.images).toBe(0)
  })
})

// (Top-view fountain no longer has a dedicated drawer — it renders as its tile via the generic per-cell
//  pass in renderTopView, like every other asset. The bespoke drawTopFountain/drawTopTownFountain are gone.)
