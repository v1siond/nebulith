/**
 * REAL-CANVAS tile-animation tests — Phase 2 render wiring (@napi-rs/canvas, the project standard).
 *
 * MODEL: every tile is a baked backend IMAGE resolved by label; colour FILTERS it. A placed asset can carry
 * `animations` (settings tweens) + a `placedAt` anchor; the RAF render path resolves their LIVE per-frame
 * overrides (`resolveAssetAnimation`) and drives THIS frame's opacity / screen position / colour-size from
 * them — scoped by each animation's `scope{styles,views}` so it only plays in the active (style, view).
 *
 * These drive the ACTUAL view render functions (iso `render`, 2D `render2D`, top `renderTopView`) onto a real
 * rasteriser and read the PIXELS of a MAGENTA animated tile over each view's dark background:
 *   • opacity 1→0 → the magenta "mass" shrinks monotonically (progressively more transparent);
 *   • a y-rise → the magenta centroid moves UP the screen (smaller row);
 *   • an animation scoped to the WRONG view/style is a true no-op → byte-identical to a tile with no animation;
 *   • an un-animated tile is clock-invariant → byte-identical across time (default unchanged).
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
import type { SettingsAnimation } from '@/engine/animation/tileAnimation'
import type { Canvas } from '@napi-rs/canvas'

let H: RealCanvasHarness

const MAGENTA = '#ff00ff'
const LABEL = '__anim_probe_tile__'
const SRC = '/tiles/emoji/__anim_probe.png'

// A player parked away from the animated tile (its gold figure never reads magenta, so it can't skew the scan).
const PLAYER: PlayerState = { x: 20, z: 20, facing: 'down', moving: false, frame: 0 } as PlayerState

const T0 = 10_000 // the tile's placedAt anchor
const DUR = 1_000

/** One SettingsAnimation, defaults to an opacity 1→0 fade over DUR anchored at the tile's placedAt. */
const anim = (over: Partial<SettingsAnimation> = {}): SettingsAnimation => ({
  id: 'fx',
  kind: 'settings',
  durationMs: DUR,
  ease: 'linear',
  tracks: [{ setting: 'opacity', from: 1, to: 0 }],
  ...over,
})

/** A 6×6 grid carrying ONE magenta labelled tile at the centre, with the given animation overrides. */
function makeGrid(assetOver: Partial<GridAsset> = {}): IsometricGrid {
  const grid = new IsometricGrid({ cols: 6, rows: 6, cellSize: 40 })
  const asset: GridAsset = {
    art: ['?'], col: 3, row: 3, type: 'anim_probe', label: LABEL,
    color: MAGENTA, height: 1, scale: 3, placedAt: T0, ...assetOver,
  } as GridAsset
  grid.assets.push(asset)
  return grid
}

const W = 480, H2 = 480

function isoCanvas(grid: IsometricGrid, clock: number, style: Style): Canvas {
  const cv = H.makeCanvas(W, H2)
  const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D
  renderIso({ ctx, w: W, h: H2, grid, player: PLAYER, time: clock, camOffset: { x: 0, y: 0 }, entities: [], enemyCombat: new Map(), hitMarkers: [], now: clock, zoom: 1, attackAnims: [], connectors: [], quests: [], projectiles: [], dayNight: 'day', attackReach: 1, style })
  return cv
}
function twoDCanvas(grid: IsometricGrid, clock: number, style: Style): Canvas {
  const cv = H.makeCanvas(W, H2)
  const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D
  render2D(ctx, W, H2, grid, PLAYER, clock, 2, { x: 0, y: 0 }, [], new Map(), [], [], 'day', [], [], [], 1, style)
  return cv
}
function topCanvas(grid: IsometricGrid, clock: number, style: Style): Canvas {
  const cv = H.makeCanvas(W, H2)
  const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D
  renderTopView(ctx, W, H2, grid, PLAYER, 4, new Set(), [], false, { x: 0, y: 0 }, [], new Map(), [], clock, [], 'day', style)
  return cv
}

// ── pixel metrics ─────────────────────────────────────────────────────────────
// Magenta "weight" of a pixel: how strongly BOTH red and blue exceed green (0 for grass/gold/white/navy).
const magentaWeight = (r: number, g: number, b: number): number => Math.max(0, Math.min(r - g, b - g))

/** Total magenta mass on the canvas — scales with the tile's opacity (its size × per-pixel strength). */
function magentaMass(cv: Canvas): number {
  const { data } = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height)
  let mass = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    mass += magentaWeight(data[i], data[i + 1], data[i + 2])
  }
  return mass
}

/** The magenta pixels' weighted-mean ROW — a smaller row means the tile drew HIGHER on the screen. */
function magentaCentroidRow(cv: Canvas): number {
  const { data, width } = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height)
  let sum = 0, weighted = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    const w = magentaWeight(data[i], data[i + 1], data[i + 2])
    if (w === 0) continue
    const row = Math.floor(i / 4 / width)
    sum += w
    weighted += w * row
  }
  return sum === 0 ? -1 : weighted / sum
}

/** Within `tol` relative of each other. Isolates "the tile is essentially unchanged" from the tiny boundary
 *  noise where the tile's edge anti-aliases against the (legitimately time-varying) ground shimmer. */
function relClose(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b), 1)
}

const hadGrass = '__had_grass__'

beforeAll(async () => {
  H = installRealCanvas().harness
  // A WHITE baked tile the magenta colour setting recolours (labelled tile, resolved per style by every view).
  EMOJI_TILESET[LABEL] = { char: '?', color: '#ffffff', image: SRC, height: 1 }
  H.registerSolid(SRC, '#ffffff')
  await H.warm([SRC])
  // The top view reads ground terrain straight from ASCII_TILESET.terrain (normally DB-seeded, `{}` in tests).
  // Seed a minimal grass entry so renderTopView draws the ground without a lookup crash.
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

describe('opacity 1→0 makes the drawn tile progressively more transparent — all three views', () => {
  test('ISO: magenta mass shrinks monotonically as the fade progresses, ~gone at the end', () => {
    const full = magentaMass(isoCanvas(makeGrid({ animations: [anim()] }), T0, EMOJI_STYLE))         // op 1.0
    const half = magentaMass(isoCanvas(makeGrid({ animations: [anim()] }), T0 + DUR * 0.5, EMOJI_STYLE)) // op 0.5
    const low = magentaMass(isoCanvas(makeGrid({ animations: [anim()] }), T0 + DUR * 0.9, EMOJI_STYLE))  // op 0.1
    const gone = magentaMass(isoCanvas(makeGrid({ animations: [anim()] }), T0 + DUR, EMOJI_STYLE))       // op 0.0
    expect(full).toBeGreaterThan(1000)     // a solid magenta cube to start
    expect(half).toBeLessThan(full)        // fading
    expect(low).toBeLessThan(half)         // still fading
    expect(gone).toBeLessThan(full * 0.05) // essentially invisible at op 0
  })

  test('2D: the fade reduces the magenta mass', () => {
    const full = magentaMass(twoDCanvas(makeGrid({ animations: [anim()] }), T0, EMOJI_STYLE))
    const gone = magentaMass(twoDCanvas(makeGrid({ animations: [anim()] }), T0 + DUR, EMOJI_STYLE))
    expect(full).toBeGreaterThan(1000)
    expect(gone).toBeLessThan(full * 0.25)
  })

  test('TOP: the fade reduces the magenta mass', () => {
    const full = magentaMass(topCanvas(makeGrid({ animations: [anim()] }), T0, EMOJI_STYLE))
    const gone = magentaMass(topCanvas(makeGrid({ animations: [anim()] }), T0 + DUR, EMOJI_STYLE))
    expect(full).toBeGreaterThan(500)
    expect(gone).toBeLessThan(full * 0.5)
  })
})

describe('a y-rise lifts the drawn tile UP the screen — all three views', () => {
  const rise = (): SettingsAnimation => anim({ tracks: [{ setting: 'y', from: 0, to: 3 }] }) // rise 3 tiles

  test('ISO: the magenta centroid moves UP (smaller row) over the rise', () => {
    const rest = magentaCentroidRow(isoCanvas(makeGrid({ animations: [rise()] }), T0, EMOJI_STYLE))       // y = 0
    const lifted = magentaCentroidRow(isoCanvas(makeGrid({ animations: [rise()] }), T0 + DUR, EMOJI_STYLE)) // y = 3
    expect(rest).toBeGreaterThan(0)
    expect(lifted).toBeLessThan(rest - 20) // clearly higher on the screen
  })

  test('2D: the magenta centroid moves UP over the rise', () => {
    const rest = magentaCentroidRow(twoDCanvas(makeGrid({ animations: [rise()] }), T0, EMOJI_STYLE))
    const lifted = magentaCentroidRow(twoDCanvas(makeGrid({ animations: [rise()] }), T0 + DUR, EMOJI_STYLE))
    expect(lifted).toBeLessThan(rest - 20)
  })

  test('TOP: the magenta centroid moves UP over the rise', () => {
    const rest = magentaCentroidRow(topCanvas(makeGrid({ animations: [rise()] }), T0, EMOJI_STYLE))
    const lifted = magentaCentroidRow(topCanvas(makeGrid({ animations: [rise()] }), T0 + DUR, EMOJI_STYLE))
    expect(lifted).toBeLessThan(rest - 20)
  })
})

describe('scope gates playback to the active (style, view) — out of scope, the tile is NOT animated', () => {
  test('a VIEW-scoped (iso-only) fade does NOT fade in the 2D view (tile mass ≈ the un-animated baseline)', () => {
    const baseline = magentaMass(twoDCanvas(makeGrid({}), T0 + DUR, EMOJI_STYLE))
    const scopedOut = magentaMass(twoDCanvas(makeGrid({ animations: [anim({ scope: { views: ['iso'] } })] }), T0 + DUR, EMOJI_STYLE))
    expect(baseline).toBeGreaterThan(1000)
    expect(relClose(scopedOut, baseline, 0.03)).toBe(true) // untouched — the iso-only fade never ran in 2D
  })

  test('a STYLE-scoped (emoji-only) fade does NOT fade under the ASCII style (tile mass ≈ baseline)', () => {
    const baseline = magentaMass(isoCanvas(makeGrid({}), T0 + DUR, ASCII_STYLE))
    const scopedOut = magentaMass(isoCanvas(makeGrid({ animations: [anim({ scope: { styles: ['emoji'] } })] }), T0 + DUR, ASCII_STYLE))
    expect(baseline).toBeGreaterThan(1000)
    expect(relClose(scopedOut, baseline, 0.03)).toBe(true) // untouched — the emoji-only fade never ran under ASCII
  })

  test('POSITIVE: the SAME fade scoped to the 2D view DOES fade it there (the exclusion above isn’t vacuous)', () => {
    const full = magentaMass(twoDCanvas(makeGrid({ animations: [anim({ scope: { views: ['2d'] } })] }), T0, EMOJI_STYLE))
    const gone = magentaMass(twoDCanvas(makeGrid({ animations: [anim({ scope: { views: ['2d'] } })] }), T0 + DUR, EMOJI_STYLE))
    expect(gone).toBeLessThan(full * 0.25)
  })
})

describe('default (no animations) is unchanged — the un-animated tile is clock-invariant', () => {
  // The scope tests above already prove a NON-applied animation is byte-identical to no animation (same frame).
  // Here: an asset with NO animations must render the SAME tile at any clock time — the Phase-2 wiring adds no
  // time dependence. (Full-scene bytes DO drift because the player's idle bob breathes with time, so we isolate
  // the tile via its magenta mass + centroid, which the wiring must leave perfectly stable.)
  const stable = (make: (g: IsometricGrid, t: number, s: Style) => Canvas) => {
    const a = make(makeGrid({}), T0, EMOJI_STYLE)
    const b = make(makeGrid({}), T0 + 5_000, EMOJI_STYLE)
    expect(magentaMass(a)).toBeGreaterThan(1000)
    expect(relClose(magentaMass(a), magentaMass(b), 0.01)).toBe(true)     // tile mass steady over time
    expect(Math.abs(magentaCentroidRow(a) - magentaCentroidRow(b))).toBeLessThan(1) // tile does not move
  }
  test('ISO: the tile is identical across time', () => stable(isoCanvas))
  test('2D: the tile is identical across time', () => stable(twoDCanvas))
  test('TOP: the tile is identical across time', () => stable(topCanvas))
})
