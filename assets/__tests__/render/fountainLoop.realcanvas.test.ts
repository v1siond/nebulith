/**
 * REAL-CANVAS fountain/well DESYNC evidence — drives the ACTUAL view render functions with the EXACT desynced
 * water animations the backend serves (`/api/tilesets`, captured in the fixture), and measures the drawn water
 * column's rendered HEIGHT (vertical magenta extent) + BASE (bottom row) at controlled clock times, in EMOJI
 * and ASCII. Baked tiles are OS-independent, so this real render IS authoritative for the visible behaviour
 * (the live browser runs this same render code every frame; only the WSL2 headless *surface capture* is frozen,
 * which this bypasses by rendering to a controlled canvas at a controlled clock).
 *
 * The design under test (Alexander): TWO water variants — a small `well` (a 1×3 water line, ALL 3 columns
 * animated) and a large `fountain` (a 3×3 water grid, only the CENTRE ROW of 3 animated, 6 static). In BOTH,
 * EXACTLY 3 columns animate, each the SAME 1→4 sine-yoyo height-grow but with a DISTINCT durationMs +
 * startDelayMs so they pulse OUT of sync ("different duration and delays … realistic fountain water"). The
 * three timings are READ FROM THE REAL FIXTURE, so this test would FAIL if the backend made them identical.
 *
 * What we assert: (1) DESYNC — at a SHARED clock the 3 columns render 3 DIFFERENT heights (a synced baseline,
 * built by giving all three ONE timing, renders EQUAL — the counterfactual). (2) Each column still GROWS its
 * height 1→~4→1 over its OWN period, base PLANTED (grows up, never levitates), never invisible (no opacity).
 */
import { installRealCanvas, type RealCanvasHarness } from '@/__tests__/helpers/realCanvas'
import { render as renderIso } from '@/engine/render/iso'
import { render2D } from '@/engine/render/topdown'
import { IsometricGrid, type GridAsset } from '@/engine/IsometricGrid'
import { EMOJI_STYLE, ASCII_STYLE, type Style } from '@/game/artStyle'
import { EMOJI_TILESET } from '@/engine/tileset/emojiTileset'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'
import type { PlayerState } from '@/game/runtime/player'
import type { Animation } from '@/engine/animation/tileAnimation'
import type { Canvas } from '@napi-rs/canvas'
import * as fs from 'fs'
import * as path from 'path'

let H: RealCanvasHarness
const MAGENTA = '#ff00ff'
const LABEL = '__fountain_probe_tile__'
const SRC = '/tiles/emoji/__fountain_probe.png'
const PLAYER: PlayerState = { x: 40, z: 40, facing: 'down', moving: false, frame: 0 } as PlayerState
const GAP = 400 // the shared loopDelay — only durationMs + startDelayMs desync between columns

// The desynced per-column timings, READ FROM THE REAL BACKEND FIXTURE (the captured /api/tilesets), so this
// test breaks the moment the backend makes the three columns share a timing.
type Timing = { durationMs: number; startDelayMs: number; dx: number; dy: number }
type FixtureCell = { label: string; dx: number; dy: number; animations?: Array<{ durationMs: number; startDelayMs: number }> }
function fixtureWater(compName: string): { water: number; animated: Timing[] } {
  const raw = fs.readFileSync(path.join(__dirname, '../fixtures/tilesets.json'), 'utf8')
  const fx = JSON.parse(raw) as { data: Array<{ key: string; compositions: Record<string, { cells: FixtureCell[] }> }> }
  const ascii = fx.data.find(t => t.key === 'ascii')!
  const cells = ascii.compositions[compName].cells
  const water = cells.filter(c => c.label === 'water_c')
  const animated = water
    .filter(c => c.animations && c.animations.length > 0)
    .map(c => ({ durationMs: c.animations![0].durationMs, startDelayMs: c.animations![0].startDelayMs, dx: c.dx, dy: c.dy }))
  return { water: water.length, animated }
}

// A single magenta water cell carrying ONE yoyo height-grow with the given timing (the backend's scale 1.15,
// placedAt 0 = clock origin). Rendered in isolation so the measured magenta extent IS that column's height.
function makeGrid(dur: number, delay: number): IsometricGrid {
  const grid = new IsometricGrid({ cols: 6, rows: 6, cellSize: 40 })
  const anims: Animation[] = [
    { id: 'fountain_water_grow', name: 'grow', kind: 'settings', durationMs: dur, startDelayMs: delay, loopDelayMs: GAP, loop: true, yoyo: true, ease: 'sine', priority: 1, trigger: { on: 'load' }, tracks: [{ setting: 'height', from: 1, to: 4 }] },
  ]
  grid.assets.push({ art: ['?'], col: 3, row: 3, type: 'water_c', label: LABEL, color: MAGENTA, height: 1, scale: 1.15, placedAt: 0, animations: anims } as GridAsset)
  return grid
}

const W = 520, HH = 720
const isoCanvas = (g: IsometricGrid, clock: number, s: Style): Canvas => { const cv = H.makeCanvas(W, HH); const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D; renderIso({ ctx, w: W, h: HH, grid: g, player: PLAYER, time: clock, camOffset: { x: 0, y: 0 }, entities: [], enemyCombat: new Map(), hitMarkers: [], now: clock, zoom: 1, attackAnims: [], connectors: [], quests: [], projectiles: [], dayNight: 'day', attackReach: 1, style: s }); return cv }
const twoDCanvas = (g: IsometricGrid, clock: number, s: Style): Canvas => { const cv = H.makeCanvas(W, HH); const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D; render2D(ctx, W, HH, g, PLAYER, clock, 2, { x: 0, y: 0 }, [], new Map(), [], [], 'day', [], [], [], 1, s); return cv }

const magentaWeight = (r: number, g: number, b: number): number => Math.max(0, Math.min(r - g, b - g))
/** Vertical extent (block HEIGHT proxy), bottom row (BASE), top row, and total mass of the drawn magenta water. */
function magentaMetrics(cv: Canvas): { extent: number; bottom: number; top: number; mass: number } {
  const { data, width } = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height)
  let minRow = Infinity, maxRow = -Infinity, mass = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    const w = magentaWeight(data[i], data[i + 1], data[i + 2])
    if (w < 40) continue // ignore faint anti-alias fringe so the extent is the solid column
    mass += w
    const row = Math.floor(i / 4 / width)
    if (row < minRow) minRow = row
    if (row > maxRow) maxRow = row
  }
  if (maxRow < 0) return { extent: 0, bottom: -1, top: -1, mass: 0 }
  return { extent: maxRow - minRow, bottom: maxRow, top: minRow, mass: Math.round(mass) }
}

// The measured iso metrics of a column with (dur, delay) at clock `t`, in `style`.
const metricsAt = (dur: number, delay: number, t: number, style: Style) => magentaMetrics(isoCanvas(makeGrid(dur, delay), t, style))
const extentAt = (dur: number, delay: number, t: number, style: Style) => metricsAt(dur, delay, t, style).extent

const hadGrass = '__had_grass_fl__'
beforeAll(async () => {
  H = installRealCanvas().harness
  EMOJI_TILESET[LABEL] = { char: '?', color: '#ffffff', image: SRC, height: 1 }
  H.registerSolid(SRC, '#ffffff')
  await H.warm([SRC])
  if (!ASCII_TILESET.terrain.grass) { ;(ASCII_TILESET.terrain as Record<string, { char: string[]; fg: string[]; bg: string[] }>).grass = { char: ['.'], fg: ['#5aa05a'], bg: ['#24402a'] }; (ASCII_TILESET.terrain as Record<string, unknown>)[hadGrass] = false }
})
afterAll(() => { delete EMOJI_TILESET[LABEL]; if ((ASCII_TILESET.terrain as Record<string, unknown>)[hadGrass] === false) { delete (ASCII_TILESET.terrain as Record<string, unknown>).grass; delete (ASCII_TILESET.terrain as Record<string, unknown>)[hadGrass] } })

// ── data-level guard: the counts + desync the real render depends on (from the real fixture) ──
describe('the backend serves TWO water variants — exactly 3 desynced animated columns each', () => {
  test('well (small): 3 water cells, ALL 3 animated, with 3 distinct durations + 3 distinct delays', () => {
    const { water, animated } = fixtureWater('well')
    expect(water).toBe(3)
    expect(animated).toHaveLength(3)
    expect(new Set(animated.map(a => a.durationMs)).size).toBe(3)
    expect(new Set(animated.map(a => a.startDelayMs)).size).toBe(3)
  })
  test('fountain (large): 9 water cells, EXACTLY 3 animated on ONE centre row, desynced', () => {
    const { water, animated } = fixtureWater('fountain')
    expect(water).toBe(9)
    expect(animated).toHaveLength(3)
    expect(new Set(animated.map(a => a.dy)).size).toBe(1) // the animated 3 share a row (the centre line)
    expect(new Set(animated.map(a => a.durationMs)).size).toBe(3)
    expect(new Set(animated.map(a => a.startDelayMs)).size).toBe(3)
  })
})

// ── REAL RENDER desync: at a shared clock the 3 columns draw 3 DIFFERENT heights ──
describe('DESYNC — at a SHARED clock the 3 animated columns render DIFFERENT heights (real render, both styles)', () => {
  const T = 1200 // a shared clock where the 3 desynced timings sit at three clearly different points of their arcs
  for (const [styleName, style] of [['EMOJI', EMOJI_STYLE], ['ASCII', ASCII_STYLE]] as const) {
    for (const compName of ['well', 'fountain'] as const) {
      test(`${styleName} / ${compName}: 3 distinct heights at t=${T}ms (a synced baseline would render EQUAL)`, () => {
        const { animated } = fixtureWater(compName)
        expect(animated).toHaveLength(3)
        const real = animated.map(a => extentAt(a.durationMs, a.startDelayMs, T, style))
        // COUNTERFACTUAL: give all three the FIRST column's timing → a SYNCED baseline that renders EQUAL.
        const synced = animated.map(() => extentAt(animated[0].durationMs, animated[0].startDelayMs, T, style))
        // eslint-disable-next-line no-console
        console.log(`${styleName}/${compName} @${T}ms  desynced extents=${JSON.stringify(real)}  synced-baseline=${JSON.stringify(synced)}`)
        expect(new Set(synced).size).toBe(1) // identical timing ⇒ identical height (the thing this is NOT)
        expect(new Set(real).size).toBe(3) // desynced ⇒ three different heights
        expect(Math.max(...real) - Math.min(...real)).toBeGreaterThan(20) // meaningfully spread, not a rounding wobble
      })
    }
  }
})

// ── REAL RENDER per-column: each timing still oscillates 1→~4→1 over its OWN period, base planted ──
describe('each desynced column still GROWS its height 1→~4→1 over its own period (real render, both styles, ISO)', () => {
  const { animated } = fixtureWater('well') // the same 3 timings both variants use
  for (const [styleName, style] of [['EMOJI', EMOJI_STYLE], ['ASCII', ASCII_STYLE]] as const) {
    for (const a of animated) {
      test(`${styleName}: column dur=${a.durationMs} delay=${a.startDelayMs} peaks then returns to base, planted`, () => {
        const { durationMs: d, startDelayMs: dl } = a
        const base = metricsAt(d, dl, dl, style)                       // elapsed 0 → base (scaleY≈1)
        const mid = metricsAt(d, dl, dl + Math.round(d / 2), style)    // growing up
        const peak = metricsAt(d, dl, dl + d, style)                   // scaleY≈4
        const back = metricsAt(d, dl, dl + 2 * d, style)               // end of down leg → back at base
        // ALWAYS VISIBLE — no opacity fade (every phase renders a solid magenta column).
        for (const m of [base, mid, peak, back]) expect(m.mass).toBeGreaterThan(0)
        // GROWS: much taller at the peak than the base, monotone up on the grow leg.
        expect(peak.extent).toBeGreaterThan(base.extent * 1.7)
        expect(peak.extent).toBeGreaterThan(base.extent + 40)
        expect(mid.extent).toBeGreaterThan(base.extent)
        expect(peak.extent).toBeGreaterThan(mid.extent)
        // RETURNS to base at the end of the down leg (its own period), so it loops.
        expect(Math.abs(back.extent - base.extent)).toBeLessThan(peak.extent * 0.3)
        // GROWS UP FROM THE BASE — not levitating: the bottom row barely moves while the height quadruples,
        // and the TOP rises well above the base's top at the peak.
        expect(Math.abs(peak.bottom - base.bottom)).toBeLessThan(12)
        expect(peak.top).toBeLessThan(base.top - 40)
      })
    }
  }
})

// ── 2D coverage: the height grow drives scaleY in 2D too (one representative timing) ──
describe('the grow drives scaleY in 2D too — taller at the peak, base planted', () => {
  const a = fixtureWater('well').animated[0]
  for (const [styleName, style] of [['EMOJI', EMOJI_STYLE], ['ASCII', ASCII_STYLE]] as const) {
    test(`${styleName}: 2D column dur=${a.durationMs} taller at the peak than at the base`, () => {
      const { durationMs: d, startDelayMs: dl } = a
      const m2d = (t: number) => magentaMetrics(twoDCanvas(makeGrid(d, dl), t, style))
      const base = m2d(dl), peak = m2d(dl + d), back = m2d(dl + 2 * d)
      for (const m of [base, peak, back]) expect(m.mass).toBeGreaterThan(0) // always visible (no fade)
      expect(peak.extent).toBeGreaterThan(base.extent * 1.5)               // clearly taller at the peak
      expect(back.extent).toBeLessThan(peak.extent)                        // shrinks back
      expect(Math.abs(peak.bottom - base.bottom)).toBeLessThan(12)         // base planted (grows up, not levitating)
    })
  }
})
