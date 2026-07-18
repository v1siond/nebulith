/**
 * FIGURE VITALS GEOMETRY — the HP bar + name label must sit TIGHT to the unit's head, "like ascii art
 * style" (Alexander), in every view + both styles. The bug: `drawFigureVitals` was fed a `figureTop`
 * derived from the ASCII multi-row figure height (`art.length * lineHeight`) even when an EMOJI/image
 * sprite was drawn — a short billboard grounded near the feet — so the bar floated ~3-5 cells ABOVE the
 * emoji head. The fix passes the ACTUAL drawn-sprite top, so the bar hugs the head in every branch.
 *
 * These drive the REAL view drawers (drawIsoEntity, drawTopEntity) onto a recording 2D context and read
 * back the drawn coordinates: the HP-bar body rect (its unique '#3a1414' fill) vs the drawn sprite (the
 * emoji glyph's y, or — under ascii — the top figure glyph). The vertical gap between them must be a
 * TIGHT band of the head (well under one cell), NOT the old multi-cell float.
 */
import { drawIsoEntity } from '@/engine/render/iso'
import { drawTopEntity } from '@/engine/render/topdown'
import { drawFigureVitals, VITALS_HEAD_GAP_PX, VITALS_NAME_COLOR } from '@/engine/render/shared'
import { EMOJI_STYLE, ASCII_STYLE } from '@/game/artStyle'
import type { Entity } from '@/game/types'

// The HP-bar BODY rect (drawHpBar's second fillRect) — its fill colour is unique, so we find the bar's
// bottom edge unambiguously in either style. The emoji glyph the enemy draws under EMOJI mode.
const HP_BODY_FILL = '#3a1414'
const ENEMY_EMOJI = '👾'

interface RectRec { x: number; y: number; w: number; h: number; fill: string }
interface TextRec { text: string; x: number; y: number; fill: string }

interface Rec {
  ctx: CanvasRenderingContext2D
  rects: RectRec[]
  texts: TextRec[]
}

/** A minimal recording 2D context: records fillRect + fillText (with the fill live at call time) and
 *  no-ops everything else the drawers touch, so a real render runs headless and we can measure it. */
function recCtx(): Rec {
  const rects: RectRec[] = []
  const texts: TextRec[] = []
  const state = { fillStyle: '#000000' as string }
  const noop = () => {}
  const ctx = {
    get fillStyle() { return state.fillStyle },
    set fillStyle(v: string) { state.fillStyle = v },
    strokeStyle: '#000', font: '', textAlign: 'left', textBaseline: 'alphabetic',
    globalAlpha: 1, lineWidth: 1, globalCompositeOperation: 'source-over',
    shadowBlur: 0, shadowColor: '#000', lineDashOffset: 0, miterLimit: 10, imageSmoothingEnabled: true,
    save: noop, restore: noop, beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
    arc: noop, arcTo: noop, ellipse: noop, rect: noop, fill: noop, stroke: noop, clip: noop,
    translate: noop, scale: noop, rotate: noop, setTransform: noop, resetTransform: noop, transform: noop,
    setLineDash: noop, strokeRect: noop, strokeText: noop, drawImage: noop, putImageData: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    measureText: (t: string) => ({ width: t.length * 8 }),
    fillRect: (x: number, y: number, w: number, h: number) => { rects.push({ x, y, w, h, fill: state.fillStyle }) },
    fillText: (text: string, x: number, y: number) => { texts.push({ text, x, y, fill: state.fillStyle }) },
  } as unknown as CanvasRenderingContext2D
  return { ctx, rects, texts }
}

/** The HP bar's BODY rect (unique fill), or throws when it wasn't drawn — its bottom edge is the bar's
 *  lowest point, the thing that must hug the head. */
function hpBarBottom(rects: RectRec[]): number {
  const body = rects.find(r => r.fill === HP_BODY_FILL)
  if (!body) throw new Error('HP bar body rect not drawn')
  return body.y + body.h
}

/** A bare enemy with NO enemyType → under EMOJI it resolves to the base 👾 GLYPH (no image), so the glyph
 *  branch runs and we can read the sprite's on-screen y. Under ASCII it draws the multi-row block figure. */
function enemy(): Entity {
  return {
    id: 'e1', kind: 'enemy', col: 3, row: 3, name: 'Slime',
    baseStats: { strength: 5, intelligence: 1, defense: 2, maxHp: 30 },
  } as Entity
}

describe('drawFigureVitals — the shared tight-to-head contract', () => {
  it('places the HP bar body exactly VITALS_HEAD_GAP_PX above the passed head y', () => {
    const { ctx, rects } = recCtx()
    const headY = 200
    const barHeight = 6
    drawFigureVitals(ctx, 100, headY, 30, barHeight, 12, 1, 'Hero')
    // The bar body's BOTTOM sits the small fixed gap above the head — the whole point of the fix.
    expect(headY - hpBarBottom(rects)).toBe(VITALS_HEAD_GAP_PX)
  })

  it('stacks the name label ABOVE the bar (never below the head)', () => {
    const { ctx, rects, texts } = recCtx()
    const headY = 200
    drawFigureVitals(ctx, 100, headY, 30, 6, 12, 1, 'Hero')
    const name = texts.find(t => t.fill === VITALS_NAME_COLOR && t.text === 'Hero')
    expect(name).toBeDefined()
    // Name is above the bar, and the bar is above the head → the whole stack hugs the head from above.
    expect(name!.y).toBeLessThan(hpBarBottom(rects))
    expect(hpBarBottom(rects)).toBeLessThanOrEqual(headY)
  })
})

describe('EMOJI enemy — the bar hugs the short billboard, not a phantom ascii stack', () => {
  it('iso: HP bar sits within ~one cell of the emoji sprite (not multi-cell above)', () => {
    const { ctx, rects, texts } = recCtx()
    const tileH = 32
    drawIsoEntity(ctx, 200, 200, enemy(), tileH, undefined, 0, false, /*inRange*/ true, false, EMOJI_STYLE)
    const sprite = texts.find(t => t.text === ENEMY_EMOJI)
    expect(sprite).toBeDefined() // the emoji billboard actually drew (glyph branch)
    const gap = sprite!.y - hpBarBottom(rects) // emoji CENTRE y minus the bar bottom (bar is above → +ve)
    expect(gap).toBeGreaterThan(0)
    expect(gap).toBeLessThan(tileH * 1.2) // TIGHT — the old ascii-height lift put this at ~5·tileH
  })

  it('2D: HP bar sits within ~one cell of the emoji sprite (not multi-cell above)', () => {
    const { ctx, rects, texts } = recCtx()
    const tileSize = 40
    drawTopEntity(ctx, 200, 200, tileSize, enemy(), undefined, 0, false, /*inRange*/ true, false, EMOJI_STYLE)
    const sprite = texts.find(t => t.text === ENEMY_EMOJI)
    expect(sprite).toBeDefined()
    const gap = sprite!.y - hpBarBottom(rects)
    expect(gap).toBeGreaterThan(0)
    expect(gap).toBeLessThan(tileSize * 1.2)
  })
})

describe('ASCII enemy — the bar still hugs the block figure’s own head', () => {
  it('iso: HP bar sits just above the top figure glyph (within one row)', () => {
    const { ctx, rects, texts } = recCtx()
    const tileH = 32
    const lineHeight = tileH * 1.4
    drawIsoEntity(ctx, 200, 200, enemy(), tileH, undefined, 0, false, /*inRange*/ true, false, ASCII_STYLE)
    // The figure glyphs are every non-name text with visible ink; the topmost (min y) is the head row.
    // Exclude the name label — its fg is VITALS_NAME_COLOR and its drop-shadow is pure '#000000' (the
    // block figure's own shadow is 'rgba(0,0,0,0.55)', so real figure rows survive this filter).
    const figureGlyphs = texts.filter(t => t.fill !== VITALS_NAME_COLOR && t.fill !== '#000000' && t.text.trim() !== '')
    expect(figureGlyphs.length).toBeGreaterThan(0)
    const topGlyphY = Math.min(...figureGlyphs.map(t => t.y))
    const gap = topGlyphY - hpBarBottom(rects)
    expect(gap).toBeGreaterThan(0) // bar is above the figure's head, not overlapping it
    expect(gap).toBeLessThan(lineHeight * 1.3) // and within a row of it — tight, not floating
  })
})
