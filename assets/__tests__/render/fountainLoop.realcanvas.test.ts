/**
 * REAL-CANVAS fountain-loop evidence (Phase 5 E2E) — drives the ACTUAL view render functions with the EXACT
 * fountain animation chain served by the backend (`/api/tilesets`, fountain water cells), over a FULL 1800 ms
 * loop, in EMOJI and ASCII, and measures the drawn tile's opacity (magenta mass) + vertical position (centroid
 * row) at each phase. Baked tiles are OS-independent, so this real render IS authoritative for the visible
 * behaviour (the live browser runs this same render code every frame; only the WSL2 headless *surface capture*
 * is frozen, which this bypasses by rendering to a controlled canvas at a controlled clock).
 *
 * The chain (verbatim from tile_source.ex / the live API):
 *   A "rise": opacity 0→1 + y 0→3, dur 1200, delay 0, loopGap 600, ease sine, priority 1, loop
 *   B "fade": opacity 1→0,        dur 600,  delay 1200, loopGap 1200, ease sine, priority 0, loop
 * Period both = 1800 ms. Winner-takes-all resolver → A (priority 1) owns opacity whenever active.
 */
import { installRealCanvas, type RealCanvasHarness } from '@/__tests__/helpers/realCanvas'
import { render as renderIso } from '@/engine/render/iso'
import { render2D } from '@/engine/render/topdown'
import { renderTopView } from '@/engine/render/birdseye'
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
const PLACED_AT = 100_000

// EXACT backend fountain chain (from GET /api/tilesets fountain water cells).
const FOUNTAIN_ANIMS: Animation[] = [
  { id: 'fountain_water_rise', name: 'rise', kind: 'settings', durationMs: 1200, startDelayMs: 0, loopDelayMs: 600, loop: true, ease: 'sine', priority: 1, trigger: { on: 'load' }, tracks: [{ setting: 'opacity', from: 0, to: 1 }, { setting: 'y', from: 0, to: 3 }] },
  { id: 'fountain_water_fade', name: 'fade', kind: 'settings', durationMs: 600, startDelayMs: 1200, loopDelayMs: 1200, loop: true, ease: 'sine', priority: 0, trigger: { on: 'load' }, tracks: [{ setting: 'opacity', from: 1, to: 0 }] },
]

function makeGrid(): IsometricGrid {
  const grid = new IsometricGrid({ cols: 6, rows: 6, cellSize: 40 })
  grid.assets.push({ art: ['?'], col: 3, row: 3, type: 'water_c', label: LABEL, color: MAGENTA, height: 1, scale: 3, placedAt: PLACED_AT, animations: FOUNTAIN_ANIMS } as GridAsset)
  return grid
}

const W = 480, HH = 480
const isoCanvas = (g: IsometricGrid, clock: number, s: Style): Canvas => { const cv = H.makeCanvas(W, HH); const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D; renderIso(ctx, W, HH, g, PLAYER, clock, { x: 0, y: 0 }, [], new Map(), [], clock, 1, [], [], [], [], 'day', 1, s); return cv }
const twoDCanvas = (g: IsometricGrid, clock: number, s: Style): Canvas => { const cv = H.makeCanvas(W, HH); const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D; render2D(ctx, W, HH, g, PLAYER, clock, 2, { x: 0, y: 0 }, [], new Map(), [], [], 'day', [], [], [], 1, s); return cv }
const topCanvas = (g: IsometricGrid, clock: number, s: Style): Canvas => { const cv = H.makeCanvas(W, HH); const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D; renderTopView(ctx, W, HH, g, PLAYER, 4, new Set(), [], false, { x: 0, y: 0 }, [], new Map(), [], clock, [], 'day', s); return cv }

const magentaWeight = (r: number, g: number, b: number): number => Math.max(0, Math.min(r - g, b - g))
function magentaMass(cv: Canvas): number { const { data } = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height); let m = 0; for (let i = 0; i < data.length; i += 4) { if (data[i + 3] < 128) continue; m += magentaWeight(data[i], data[i + 1], data[i + 2]) } return m }
function magentaCentroidRow(cv: Canvas): number { const { data, width } = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height); let s = 0, wr = 0; for (let i = 0; i < data.length; i += 4) { if (data[i + 3] < 128) continue; const w = magentaWeight(data[i], data[i + 1], data[i + 2]); if (!w) continue; s += w; wr += w * Math.floor(i / 4 / width) } return s === 0 ? -1 : wr / s }

// Expected composited value from the pure engine model (A wins opacity; only A writes y).
const easeSine = (t: number): number => (1 - Math.cos(Math.PI * t)) / 2
function expected(phase: number): { opacity: number; y: number } { const p = ((phase % 1800) + 1800) % 1800; const raw = p >= 1200 ? 1 : p / 1200; const e = easeSine(raw); return { opacity: +e.toFixed(3), y: +(3 * e).toFixed(3) } }

const PHASES = [0, 150, 300, 450, 600, 750, 900, 1050, 1200, 1350, 1500, 1650, 1800, 1950]

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
  return PHASES.map(p => { const cv = make(makeGrid(), PLACED_AT + p, style); return { phase: p, mass: Math.round(magentaMass(cv)), row: +magentaCentroidRow(cv).toFixed(1), exp: expected(p) } })
}

describe('fountain water rises + fades-in + holds + loops — REAL render, both styles, ISO', () => {
  for (const [name, style] of [['EMOJI', EMOJI_STYLE], ['ASCII', ASCII_STYLE]] as const) {
    test(`${name}: opacity mass swings low→high→low and the tile rises over one loop`, () => {
      const rows = sampleLoop(isoCanvas, style)
      // eslint-disable-next-line no-console
      console.log(`\n=== ISO / ${name} fountain loop (mass=opacity·area, row=screen-Y; smaller row = higher) ===\n` +
        rows.map(r => `phase ${String(r.phase).padStart(4)}ms  mass ${String(r.mass).padStart(6)}  row ${String(r.row).padStart(6)}  | expOpacity ${r.exp.opacity.toFixed(3)} expY ${r.exp.y.toFixed(2)}`).join('\n'))
      const at = (p: number) => rows.find(r => r.phase === p)!
      const masses = rows.map(r => r.mass)
      const maxMass = Math.max(...masses)
      // fade-IN: near-invisible at phase 0, climbing by mid-rise, plateau (full) by 1200
      expect(at(0).mass).toBeLessThan(maxMass * 0.15)              // starts ~invisible (opacity 0)
      expect(at(600).mass).toBeGreaterThan(at(0).mass + 200)      // climbing
      expect(at(1200).mass).toBeGreaterThan(maxMass * 0.9)         // full by end of rise
      // HOLD at top through the 600ms loop-gap tail (A rests at opacity 1)
      expect(at(1500).mass).toBeGreaterThan(maxMass * 0.9)
      expect(at(1650).mass).toBeGreaterThan(maxMass * 0.9)
      // LOOP: the next cycle's phase-0 sample (1800) is back to ~invisible → it snaps and repeats
      expect(at(1800).mass).toBeLessThan(maxMass * 0.15)
      // RISE: the tile is clearly HIGHER on screen at the top of the arc than at the base of the arc.
      // Reference the base at phase 600 (opacity ~0.5, a solid magenta mass — NOT phase 150/300 whose
      // near-zero opacity leaves only edge-noise pixels, giving an unreliable centroid).
      const baseRow = at(600).row, topRow = at(1200).row
      expect(baseRow).toBeGreaterThan(0)
      expect(topRow).toBeGreaterThan(0)
      expect(topRow).toBeLessThan(baseRow - 15)                    // risen up the screen (screen-Y decreased)
      // MASKED-FADE finding: during B's window [1200,1800] opacity does NOT gradually fall (A wins, rests at 1)
      expect(at(1650).mass).toBeGreaterThan(at(1200).mass * 0.9)   // still full at 1650 (no gradual fade-out)
    })
  }
})

// Evidence emitter (env-gated) — writes the REAL rendered frames to PNG at each loop phase, so there are
// actual screenshots-over-time of the water arc (the live browser runs this same render code; only the WSL2
// headless surface CAPTURE is frozen, which rendering to our own canvas bypasses). Off unless EVIDENCE_DIR set.
;(process.env.EVIDENCE_DIR ? describe : describe.skip)('EVIDENCE: write per-phase frames', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs') as typeof import('fs')
  const dir = process.env.EVIDENCE_DIR as string
  for (const [name, style] of [['emoji', EMOJI_STYLE], ['ascii', ASCII_STYLE]] as const) {
    test(`${name} iso frames`, () => {
      fs.mkdirSync(`${dir}/${name}`, { recursive: true })
      for (const p of PHASES) {
        const cv = isoCanvas(makeGrid(), PLACED_AT + p, style)
        fs.writeFileSync(`${dir}/${name}/iso_phase_${String(p).padStart(4, '0')}.png`, (cv as unknown as { toBuffer(m: string): Buffer }).toBuffer('image/png'))
      }
      expect(fs.readdirSync(`${dir}/${name}`).length).toBe(PHASES.length)
    })
  }
})

describe('the same chain animates in 2D and TOP too (all three projections)', () => {
  for (const [name, make] of [['2D', twoDCanvas], ['TOP', topCanvas]] as const) {
    test(`${name} EMOJI: mass swings and the tile rises`, () => {
      const rows = sampleLoop(make, EMOJI_STYLE)
      const maxMass = Math.max(...rows.map(r => r.mass))
      const at = (p: number) => rows.find(r => r.phase === p)!
      expect(maxMass).toBeGreaterThan(300)
      expect(at(0).mass).toBeLessThan(maxMass * 0.25)
      expect(at(1200).mass).toBeGreaterThan(maxMass * 0.7)
      expect(at(1200).row).toBeLessThan(at(300).row - 8)          // risen
    })
  }
})
