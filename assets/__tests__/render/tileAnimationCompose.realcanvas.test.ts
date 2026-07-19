/**
 * REAL-CANVAS evidence for BUG #1 (Image #40) — an animated setting must COMPOSE with the tile's BASE
 * setting, not OVERRIDE it. Drives the ACTUAL iso render (@napi-rs/canvas, the project standard) with a
 * controlled clock and measures the drawn magenta water column's rendered HEIGHT (vertical extent) + BASE row.
 *
 * The model (ANIMATION-SYSTEM.md §3.5): height is ADDITIVE, so rendered scaleY = base + (value − from). A tile
 * with BASE height 3 carrying a `height 1→4` grow (delta 0→3) must render 3→6 over the loop — NOT 0→3 (the old
 * override bug, which masked the base slider). Editing the base height shifts the whole range (base 2 → 2→5),
 * and zoom (a MULTIPLICATIVE base setting) still applies alongside the active height animation.
 *
 * Why real-canvas + a controlled clock: live Playwright MOTION capture is frozen in this WSL2 box, so we render
 * the SAME production draw code onto a real rasteriser at chosen clock times — baked tiles are OS-independent,
 * so the measured pixels are authoritative for the visible behaviour.
 */
import { installRealCanvas, type RealCanvasHarness } from '@/__tests__/helpers/realCanvas'
import { render as renderIso } from '@/engine/render/iso'
import { IsometricGrid, type GridAsset } from '@/engine/IsometricGrid'
import { EMOJI_STYLE, ASCII_STYLE, type Style } from '@/game/artStyle'
import { EMOJI_TILESET } from '@/engine/tileset/emojiTileset'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'
import type { PlayerState } from '@/game/runtime/player'
import type { Animation } from '@/engine/animation/tileAnimation'
import type { Canvas } from '@napi-rs/canvas'

let H: RealCanvasHarness
const MAGENTA = '#ff00ff'
const LABEL = '__compose_probe_tile__'
const SRC = '/tiles/emoji/__compose_probe.png'
const PLAYER: PlayerState = { x: 8, z: 8, facing: 'down', moving: false, frame: 0 } as PlayerState
const DUR = 1000
const GAP = 400
const T0 = 0 // placedAt anchor (clock origin) → elapsed 0 = the yoyo base, elapsed DUR = the peak

/** ONE yoyo sine height-grow, `from`→`to` (the fountain envelope). Its DELTA is what rides the base height. */
function growAnim(from: number, to: number): Animation {
  return {
    id: 'grow', name: 'grow', kind: 'settings', durationMs: DUR, startDelayMs: 0, loopDelayMs: GAP,
    loop: true, yoyo: true, ease: 'sine', priority: 1, trigger: { on: 'load' },
    tracks: [{ setting: 'height', from, to }],
  }
}

/** A 6×6 grid with ONE magenta water tile: base height `baseScaleY`, base zoom `scale`, + optional animation. */
function makeGrid(opts: { baseScaleY?: number; scale?: number; anim?: Animation }): IsometricGrid {
  const grid = new IsometricGrid({ cols: 6, rows: 6, cellSize: 40 })
  const asset = {
    art: ['?'], col: 3, row: 3, type: 'water_c', label: LABEL, color: MAGENTA, height: 1,
    scale: opts.scale ?? 1, scaleY: opts.baseScaleY, placedAt: T0,
    ...(opts.anim ? { animations: [opts.anim] } : {}),
  } as GridAsset
  grid.assets.push(asset)
  return grid
}

const W = 640, HH = 1100
function isoCanvas(grid: IsometricGrid, clock: number, s: Style): Canvas {
  const cv = H.makeCanvas(W, HH)
  const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D
  renderIso({ ctx, w: W, h: HH, grid, player: PLAYER, time: clock, camOffset: { x: 0, y: 0 }, entities: [], enemyCombat: new Map(), hitMarkers: [], now: clock, zoom: 1, attackAnims: [], connectors: [], quests: [], projectiles: [], dayNight: 'day', attackReach: 1, style: s })
  return cv
}

const magentaWeight = (r: number, g: number, b: number): number => Math.max(0, Math.min(r - g, b - g))
/** Vertical extent (block HEIGHT proxy) + bottom row (BASE) + mass of the drawn magenta water column. */
function metrics(cv: Canvas): { extent: number; bottom: number; top: number; mass: number } {
  const { data, width } = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height)
  let minRow = Infinity, maxRow = -Infinity, mass = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    const w = magentaWeight(data[i], data[i + 1], data[i + 2])
    if (w < 40) continue
    mass += w
    const row = Math.floor(i / 4 / width)
    if (row < minRow) minRow = row
    if (row > maxRow) maxRow = row
  }
  if (maxRow < 0) return { extent: 0, bottom: -1, top: -1, mass: 0 }
  return { extent: maxRow - minRow, bottom: maxRow, top: minRow, mass: Math.round(mass) }
}

/** Static reference: a tile with base height `scaleY` and NO animation → its drawn extent. */
const staticExtent = (scaleY: number, s: Style) => metrics(isoCanvas(makeGrid({ baseScaleY: scaleY }), T0, s)).extent
/** Animated: base height `base` + a `from→to` grow, sampled at clock `t`. */
const animMetrics = (base: number, from: number, to: number, t: number, s: Style, scale = 1) =>
  metrics(isoCanvas(makeGrid({ baseScaleY: base, scale, anim: growAnim(from, to) }), t, s))

const hadGrass = '__had_grass_compose__'
beforeAll(async () => {
  H = installRealCanvas().harness
  EMOJI_TILESET[LABEL] = { char: '?', color: '#ffffff', image: SRC, height: 1 }
  H.registerSolid(SRC, '#ffffff')
  await H.warm([SRC])
  if (!ASCII_TILESET.terrain.grass) {
    ;(ASCII_TILESET.terrain as Record<string, { char: string[]; fg: string[]; bg: string[] }>).grass =
      { char: ['.'], fg: ['#5aa05a'], bg: ['#24402a'] }
    ;(ASCII_TILESET.terrain as Record<string, unknown>)[hadGrass] = false
  }
})
afterAll(() => {
  delete EMOJI_TILESET[LABEL]
  if ((ASCII_TILESET.terrain as Record<string, unknown>)[hadGrass] === false) {
    delete (ASCII_TILESET.terrain as Record<string, unknown>).grass
    delete (ASCII_TILESET.terrain as Record<string, unknown>)[hadGrass]
  }
})

describe('BUG #1: a height animation COMPOSES with the base height — base 3 + grow(+3) renders 3→6 (not 0→3)', () => {
  for (const [styleName, style] of [['EMOJI', EMOJI_STYLE], ['ASCII', ASCII_STYLE]] as const) {
    test(`${styleName}: base height 3 with a 1→4 grow renders 3 at the base and ~6 at the peak`, () => {
      const ref1 = staticExtent(1, style)
      const ref3 = staticExtent(3, style)
      const ref6 = staticExtent(6, style)
      // The static references are ordered (scaleY drives the block's drawn height — a fixed cap + per-block rise).
      expect(ref3).toBeGreaterThan(ref1 * 1.7)         // scaleY 3 is clearly taller than scaleY 1
      expect(ref6).toBeGreaterThan(ref3 * 1.6)         // scaleY 6 clearly taller than scaleY 3

      const base = animMetrics(3, 1, 4, T0, style)             // yoyo base → value 1 → composed scaleY 3
      const peak = animMetrics(3, 1, 4, T0 + DUR, style)       // yoyo peak → value 4 → composed scaleY 6
      // eslint-disable-next-line no-console
      console.log(`${styleName} compose  ref1=${ref1} ref3=${ref3} ref6=${ref6}  animBase=${base.extent} animPeak=${peak.extent}`)

      // BASE is HONORED: at the yoyo base the tile renders its BASE height 3 (≈ the static scaleY-3 tile),
      // decisively NOT the old override bug which would have masked it to the track's from=1 (≈ ref1).
      expect(Math.abs(base.extent - ref3)).toBeLessThan(ref3 * 0.15)
      expect(base.extent).toBeGreaterThan((ref1 + ref3) / 2) // sits on the ref3 side, NOT collapsed to `from` (the 0→3 bug)
      expect(Math.abs(base.extent - ref3)).toBeLessThan(Math.abs(base.extent - ref1)) // far closer to base-3 than to from=1

      // PEAK is base+delta = 3 + (4−1) = 6 (≈ the static scaleY-6 tile).
      expect(Math.abs(peak.extent - ref6)).toBeLessThan(ref6 * 0.15)

      // The rendered RANGE is 3→6 (a 2× growth), NOT 0→3 / 1→4.
      expect(peak.extent / base.extent).toBeGreaterThan(1.7)
      expect(peak.extent / base.extent).toBeLessThan(2.3)

      // Grows UP FROM THE BASE — the bottom row barely moves while the column doubles (planted, not levitating).
      expect(Math.abs(peak.bottom - base.bottom)).toBeLessThan(14)
      expect(peak.top).toBeLessThan(base.top - 40)
      for (const m of [base, peak]) expect(m.mass).toBeGreaterThan(0) // always visible (no opacity track)
    })
  }
})

describe('BUG #1: editing the BASE height shifts the whole animated range (base 2 → 2→5)', () => {
  for (const [styleName, style] of [['EMOJI', EMOJI_STYLE], ['ASCII', ASCII_STYLE]] as const) {
    test(`${styleName}: base 2 renders 2→5, strictly shorter than base 3's 3→6 at both ends`, () => {
      const ref2 = staticExtent(2, style)
      const ref5 = staticExtent(5, style)

      const b2Base = animMetrics(2, 1, 4, T0, style).extent          // composed scaleY 2
      const b2Peak = animMetrics(2, 1, 4, T0 + DUR, style).extent    // composed scaleY 5
      const b3Base = animMetrics(3, 1, 4, T0, style).extent          // composed scaleY 3
      const b3Peak = animMetrics(3, 1, 4, T0 + DUR, style).extent    // composed scaleY 6
      // eslint-disable-next-line no-console
      console.log(`${styleName} baseEdit  ref2=${ref2} ref5=${ref5}  b2=[${b2Base},${b2Peak}] b3=[${b3Base},${b3Peak}]`)

      // base 2 lands on 2→5 (≈ the static references).
      expect(Math.abs(b2Base - ref2)).toBeLessThan(ref2 * 0.2)
      expect(Math.abs(b2Peak - ref5)).toBeLessThan(ref5 * 0.15)

      // Editing the base DOWN (3→2) shortens BOTH ends of the rendered range — the base slider is live.
      expect(b2Base).toBeLessThan(b3Base)   // 2 < 3
      expect(b2Peak).toBeLessThan(b3Peak)   // 5 < 6
    })
  }
})

describe('BUG #1: base ZOOM still applies alongside an active height animation (the "only zoom applied" report)', () => {
  for (const [styleName, style] of [['EMOJI', EMOJI_STYLE], ['ASCII', ASCII_STYLE]] as const) {
    test(`${styleName}: reducing base zoom shrinks the drawn column while the height animation still grows it`, () => {
      // Same base-3 height animation, sampled at the peak, at two base zoom levels.
      const full = animMetrics(3, 1, 4, T0 + DUR, style, 1.0)   // zoom 1.0
      const small = animMetrics(3, 1, 4, T0 + DUR, style, 0.6)  // zoom reduced
      // eslint-disable-next-line no-console
      console.log(`${styleName} zoomCo  full=${full.extent} small=${small.extent}`)

      expect(full.mass).toBeGreaterThan(0)
      expect(small.mass).toBeGreaterThan(0)
      // Zoom (MULTIPLICATIVE base) shrinks the column even though the height animation is active → BOTH apply
      // (the bug was: height was masked so only zoom moved; now height composes AND zoom scales it).
      expect(small.extent).toBeLessThan(full.extent * 0.8)
      // And the height animation is STILL growing it: at 0.6 zoom the peak is still taller than the un-animated
      // base-3 tile at the same reduced zoom (proof height didn't get frozen out by zoom).
      const smallStaticBase = metrics(isoCanvas(makeGrid({ baseScaleY: 3, scale: 0.6 }), T0, style)).extent
      expect(small.extent).toBeGreaterThan(smallStaticBase * 1.5)
    })
  }
})
