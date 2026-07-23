/**
 * REAL-CANVAS test for the roof-z-width TOP-view expansion (birdseye.ts, roof-z-width #32 part C).
 *
 * A depth-spanned roof column is stored as ONE asset at its BACK-row anchor carrying `depth`/`depthDir` — the
 * ISO long-box + the depth-sort read that span, but the overhead (TOP) view builds a per-(col,row) assetMap.
 * Without the expansion the roof would paint ONLY its anchor cell and the rest of the footprint would read as
 * bare grass (a gap). renderTopView now expands each depth-spanned asset across `depthCells`, so the roof tile
 * fills EVERY covered cell.
 *
 * WHAT THIS PROVES on real pixels: a single RED roof asset with depth D=5 along +row (`left-down`) paints RED
 * across ~D cells (a tall vertical band), while the SAME asset with NO depthDir paints RED in ~one cell. The
 * band's vertical spread and red-pixel count scale with D — the gap is gone.
 */
import { installRealCanvas, type RealCanvasHarness } from '@/__tests__/helpers/realCanvas'
import { renderTopView } from '@/engine/render/birdseye'
import { IsometricGrid, type GridAsset } from '@/engine/IsometricGrid'
import { EMOJI_STYLE, rebuildEmojiStyle } from '@/game/artStyle'
import { EMOJI_TILESET } from '@/engine/tileset/emojiTileset'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'
import type { PlayerState } from '@/game/runtime/player'
import type { Canvas } from '@napi-rs/canvas'

let H: RealCanvasHarness

const RED = '#ff2020'
const ROOF_SRC = '/tiles/emoji/__rz_roof.png'
const COLS = 24, ROWS = 24, CELL = 40
const C = 10, R = 8 // roof anchor (back row); the span runs +row from here
const D = 5 // depth cells the roof spans
const W = 480, HT = 480
const ZOOM = 2
const TILE = 16 * ZOOM // renderTopView tileSize at this zoom

const PLAYER: PlayerState = { x: C * CELL + CELL / 2, z: R * CELL + CELL / 2, facing: 'down', moving: false, frame: 0 } as PlayerState
const hadGrass = '__rz_had_grass__'

beforeAll(async () => {
  H = installRealCanvas().harness
  H.registerSolid(ROOF_SRC, RED)
  EMOJI_TILESET.roof = { char: '▲', color: RED, image: ROOF_SRC, height: 1 }
  EMOJI_TILESET.player = { char: '🧍', color: '#ffcf3a' }
  rebuildEmojiStyle()
  await H.warm([ROOF_SRC])
  if (!ASCII_TILESET.terrain.grass) {
    ;(ASCII_TILESET.terrain as Record<string, { char: string[]; fg: string[]; bg: string[] }>).grass = { char: ['.'], fg: ['#5aa05a'], bg: ['#1c3a22'] }
    ;(ASCII_TILESET.terrain as Record<string, unknown>)[hadGrass] = false
  }
})

afterAll(() => {
  delete EMOJI_TILESET.roof
  delete EMOJI_TILESET.player
  rebuildEmojiStyle()
  if ((ASCII_TILESET.terrain as Record<string, unknown>)[hadGrass] === false) {
    delete (ASCII_TILESET.terrain as Record<string, unknown>).grass
    delete (ASCII_TILESET.terrain as Record<string, unknown>)[hadGrass]
  }
})

/** A grid with ONE roof asset at the anchor. `spanned` → it carries depth/depthDir (roof-z-width); else it's a
 *  plain single-cell asset (the pre-expansion behaviour). */
function roofGrid(spanned: boolean): IsometricGrid {
  const grid = new IsometricGrid({ cols: COLS, rows: ROWS, cellSize: CELL })
  const roof = { art: ['▲'], col: C, row: R, type: 'house_5', label: 'roof', heightLevel: 4, height: 1, color: RED,
    ...(spanned ? { depth: D, depthDir: 'left-down' as const } : {}) } as GridAsset
  grid.assets.push(roof)
  return grid
}

function top(grid: IsometricGrid): Canvas {
  const cv = H.makeCanvas(W, HT)
  const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D
  renderTopView({ ctx, w: W, h: HT, grid, player: PLAYER, zoom: ZOOM, camOffset: { x: 0, y: 0 }, style: EMOJI_STYLE })
  return cv
}

/** Red-pixel stats: count + vertical spread. Roof RED is r ≫ g,b; grass (green) and the gold hero never match. */
function redStats(cv: Canvas): { count: number; spread: number } {
  const { data, width } = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height) as unknown as { data: Uint8ClampedArray; width: number }
  let count = 0, minRow = Infinity, maxRow = -Infinity
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    const r = data[i], g = data[i + 1], b = data[i + 2]
    if (!(r > g + 60 && r > b + 60)) continue
    const row = Math.floor(i / 4 / width)
    count++
    if (row < minRow) minRow = row
    if (row > maxRow) maxRow = row
  }
  return { count, spread: count ? maxRow - minRow : 0 }
}

describe('roof-z-width TOP view — a depth-spanned roof paints across its whole footprint (no bare-ground gap)', () => {
  test('a depth-5 +row roof fills ~5 cells (tall band); the same roof without depth fills ~1 cell', () => {
    const spanned = redStats(top(roofGrid(true)))
    const plain = redStats(top(roofGrid(false)))

    // The plain roof paints ~one cell of red; the depth-spanned roof paints many more (every covered cell).
    expect(plain.count).toBeGreaterThan(0)
    expect(spanned.count).toBeGreaterThan(plain.count * 3)

    // Its vertical spread grows to ~D cells (a tall band down the +row axis), not one cell.
    expect(plain.spread).toBeLessThan(TILE * 1.6)
    expect(spanned.spread).toBeGreaterThan(TILE * 3.5)
  })
})
