/**
 * REAL-CANVAS fountain-loop evidence (Phase 5 E2E) — drives the ACTUAL view render functions with the EXACT
 * fountain animation served by the backend (`/api/tilesets`, fountain water cells), over a FULL loop, in
 * EMOJI and ASCII, and measures the drawn water tile's rendered HEIGHT (vertical magenta extent) + its BASE
 * (bottom row) at each phase. Baked tiles are OS-independent, so this real render IS authoritative for the
 * visible behaviour (the live browser runs this same render code every frame; only the WSL2 headless *surface
 * capture* is frozen, which this bypasses by rendering to a controlled canvas at a controlled clock).
 *
 * The new water animation (verbatim from tile_source.ex / the live API):
 *   "grow": height (scaleY) 1→4, dur 1400, loopGap 400, ease sine, YOYO, priority 1, loop
 * Yoyo period = 2·1400 + 400 = 3200 ms. ONE animation writes ONE setting (height) → no winner-takes-all.
 *
 * What we assert (the evidence the user asked for): the water COLUMN grows its height 1→~4→1 and loops, its
 * BASE stays planted (grows UP, does NOT levitate), and it NEVER fades to invisible (no opacity animation).
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

let H: RealCanvasHarness
const MAGENTA = '#ff00ff'
const LABEL = '__fountain_probe_tile__'
const SRC = '/tiles/emoji/__fountain_probe.png'
const PLAYER: PlayerState = { x: 40, z: 40, facing: 'down', moving: false, frame: 0 } as PlayerState

// EXACT backend fountain animation (from GET /api/tilesets fountain water_c cells): a single yoyo HEIGHT grow.
const GROW = 1400, GAP = 400, PERIOD = 2 * GROW + GAP // 3200 ms
const FOUNTAIN_ANIMS: Animation[] = [
  { id: 'fountain_water_grow', name: 'grow', kind: 'settings', durationMs: GROW, startDelayMs: 0, loopDelayMs: GAP, loop: true, yoyo: true, ease: 'sine', priority: 1, trigger: { on: 'load' }, tracks: [{ setting: 'height', from: 1, to: 4 }] },
]

function makeGrid(): IsometricGrid {
  const grid = new IsometricGrid({ cols: 6, rows: 6, cellSize: 40 })
  // scale 1.15 = the backend's "a bit bigger" base zoom; height:1 marks it a block; placedAt 0 = clock origin.
  grid.assets.push({ art: ['?'], col: 3, row: 3, type: 'water_c', label: LABEL, color: MAGENTA, height: 1, scale: 1.15, placedAt: 0, animations: FOUNTAIN_ANIMS } as GridAsset)
  return grid
}

const W = 520, HH = 720
const isoCanvas = (g: IsometricGrid, clock: number, s: Style): Canvas => { const cv = H.makeCanvas(W, HH); const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D; renderIso(ctx, W, HH, g, PLAYER, clock, { x: 0, y: 0 }, [], new Map(), [], clock, 1, [], [], [], [], 'day', 1, s); return cv }
const twoDCanvas = (g: IsometricGrid, clock: number, s: Style): Canvas => { const cv = H.makeCanvas(W, HH); const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D; render2D(ctx, W, HH, g, PLAYER, clock, 2, { x: 0, y: 0 }, [], new Map(), [], [], 'day', [], [], [], 1, s); return cv }

const magentaWeight = (r: number, g: number, b: number): number => Math.max(0, Math.min(r - g, b - g))
/** Vertical extent (block HEIGHT proxy), bottom row (BASE), and total mass of the drawn magenta water. */
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

// Expected scaleY (block-height multiplier) from the pure yoyo + sine model — the curve the render must show.
const easeSine = (t: number): number => (1 - Math.cos(Math.PI * t)) / 2
function expectedHeight(phase: number): number {
  const cyc = ((phase % PERIOD) + PERIOD) % PERIOD
  const raw = cyc >= 2 * GROW ? 0 : cyc <= GROW ? cyc / GROW : 1 - (cyc - GROW) / GROW
  return +(1 + 3 * easeSine(raw)).toFixed(2) // lerp(1,4,eased)
}

// phases across ONE full yoyo period: base → grow → PEAK(1400) → shrink → base(2800) → rest → loop(3200)
const PHASES = [0, 350, 700, 1050, 1400, 1750, 2100, 2450, 2800, 3000, 3200]
const PEAK = 1400, BACK = 2800

const hadGrass = '__had_grass_fl__'
beforeAll(async () => {
  H = installRealCanvas().harness
  EMOJI_TILESET[LABEL] = { char: '?', color: '#ffffff', image: SRC, height: 1 }
  H.registerSolid(SRC, '#ffffff')
  await H.warm([SRC])
  if (!ASCII_TILESET.terrain.grass) { ;(ASCII_TILESET.terrain as Record<string, { char: string[]; fg: string[]; bg: string[] }>).grass = { char: ['.'], fg: ['#5aa05a'], bg: ['#24402a'] }; (ASCII_TILESET.terrain as Record<string, unknown>)[hadGrass] = false }
})
afterAll(() => { delete EMOJI_TILESET[LABEL]; if ((ASCII_TILESET.terrain as Record<string, unknown>)[hadGrass] === false) { delete (ASCII_TILESET.terrain as Record<string, unknown>).grass; delete (ASCII_TILESET.terrain as Record<string, unknown>)[hadGrass] } })

function sampleLoop(make: (g: IsometricGrid, t: number, s: Style) => Canvas, style: Style) {
  return PHASES.map(p => ({ phase: p, ...magentaMetrics(make(makeGrid(), p, style)), exp: expectedHeight(p) }))
}

function assertGrowLoop(rows: ReturnType<typeof sampleLoop>, label: string) {
  // eslint-disable-next-line no-console
  console.log(`\n=== ${label} water HEIGHT loop (extent=vertical magenta px, bottom=base row; base fixed = grows UP) ===\n` +
    rows.map(r => `phase ${String(r.phase).padStart(4)}ms  extent ${String(r.extent).padStart(4)}px  bottom ${String(r.bottom).padStart(4)}  mass ${String(r.mass).padStart(7)}  | expScaleY ${r.exp.toFixed(2)}`).join('\n'))
  const at = (p: number) => rows.find(r => r.phase === p)!
  const base = at(0), peak = at(PEAK), back = at(BACK)

  // ALWAYS VISIBLE — no opacity fade: every phase renders a solid magenta column (the old fade went invisible).
  for (const r of rows) expect(r.mass).toBeGreaterThan(0)
  expect(base.mass).toBeGreaterThan(0)

  // GROWS: the column is much TALLER at the peak (scaleY 4) than at the base (scaleY 1).
  expect(peak.extent).toBeGreaterThan(base.extent * 1.7)
  expect(peak.extent).toBeGreaterThan(base.extent + 40)
  // monotone up on the grow leg, monotone down on the shrink leg (a clean 1→4→1 arc).
  expect(at(700).extent).toBeGreaterThan(base.extent)
  expect(peak.extent).toBeGreaterThan(at(700).extent)
  expect(at(2100).extent).toBeLessThan(peak.extent)
  expect(back.extent).toBeLessThan(at(2100).extent)

  // LOOPS + RETURNS to base: end-of-shrink (2800) is back near the base height, and the next period (3200) too.
  expect(Math.abs(back.extent - base.extent)).toBeLessThan(peak.extent * 0.3)
  expect(Math.abs(at(3200).extent - base.extent)).toBeLessThan(peak.extent * 0.3)

  // GROWS UP FROM THE BASE — NOT levitating: the BOTTOM (base) row barely moves while the height quadruples.
  // (A levitating tile would lift its base; here the base is planted and only the top rises.)
  expect(peak.bottom).toBeGreaterThan(0)
  expect(Math.abs(peak.bottom - base.bottom)).toBeLessThan(12)
  expect(Math.abs(back.bottom - base.bottom)).toBeLessThan(12)
  // the growth is upward: the TOP rises well above the base's top at the peak.
  expect(peak.top).toBeLessThan(base.top - 40)
}

describe('fountain water GROWS its height 1→~4→1 and loops — REAL render, both styles, ISO', () => {
  for (const [name, style] of [['EMOJI', EMOJI_STYLE], ['ASCII', ASCII_STYLE]] as const) {
    test(`${name}: the water column height oscillates up then back, base planted`, () => {
      assertGrowLoop(sampleLoop(isoCanvas, style), `ISO / ${name}`)
    })
  }
})

describe('the same grow animates in 2D too (height drives scaleY, grows up from the base)', () => {
  for (const [name, style] of [['EMOJI', EMOJI_STYLE], ['ASCII', ASCII_STYLE]] as const) {
    test(`${name}: 2D water column grows taller at the peak than at the base`, () => {
      const rows = sampleLoop(twoDCanvas, style)
      // eslint-disable-next-line no-console
      console.log(`\n=== 2D / ${name} water HEIGHT loop ===\n` +
        rows.map(r => `phase ${String(r.phase).padStart(4)}ms  extent ${String(r.extent).padStart(4)}px  bottom ${String(r.bottom).padStart(4)}  | expScaleY ${r.exp.toFixed(2)}`).join('\n'))
      const at = (p: number) => rows.find(r => r.phase === p)!
      const base = at(0), peak = at(PEAK), back = at(BACK)
      for (const r of rows) expect(r.mass).toBeGreaterThan(0)      // always visible (no fade)
      expect(peak.extent).toBeGreaterThan(base.extent * 1.5)       // clearly taller at the peak
      expect(back.extent).toBeLessThan(peak.extent)                // shrinks back
      expect(Math.abs(back.extent - base.extent)).toBeLessThan(peak.extent * 0.35)
      expect(Math.abs(peak.bottom - base.bottom)).toBeLessThan(12) // base planted (grows up, not levitating)
    })
  }
})

// Evidence emitter (env-gated) — writes the REAL rendered frames to PNG at each loop phase, so there are
// actual screenshots-over-time of the water column growing. Off unless EVIDENCE_DIR set.
;(process.env.EVIDENCE_DIR ? describe : describe.skip)('EVIDENCE: write per-phase frames', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs') as typeof import('fs')
  const dir = process.env.EVIDENCE_DIR as string
  for (const [name, style] of [['emoji', EMOJI_STYLE], ['ascii', ASCII_STYLE]] as const) {
    test(`${name} iso frames`, () => {
      fs.mkdirSync(`${dir}/${name}`, { recursive: true })
      for (const p of PHASES) {
        const cv = isoCanvas(makeGrid(), p, style)
        fs.writeFileSync(`${dir}/${name}/iso_phase_${String(p).padStart(4, '0')}.png`, (cv as unknown as { toBuffer(m: string): Buffer }).toBuffer('image/png'))
      }
      expect(fs.readdirSync(`${dir}/${name}`).length).toBe(PHASES.length)
    })
  }
})
