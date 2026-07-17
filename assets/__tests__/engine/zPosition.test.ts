/**
 * Z-POSITION — the "z" inspector axis SLIDES a tile along an ISO DIAGONAL, it is NOT a vertical lift.
 *
 * This is the fix for the user's Image #32: setting z moved the tile straight up/down (it behaved like Y).
 * z is "the ISO metric angle move" — the tile must travel along one of the four iso diagonals: +z toward
 * zDir (default 'right-up' = up-right toward the back), −z toward its opposite.
 *
 * Coverage (real geometry + real canvas, per the user's standard):
 *   A. isoZOffset — the per-cell step math, i.e. the ACTUAL screen delta per direction (+N, −N opposite, 0).
 *   B. the ISO render() applies that slide to a placed asset's DRAWN ORIGIN (real recording ctx).
 *   C. render2D projects the slide to the ground plane and carries NO vertical lift (real recording ctx).
 *   D. zOffset + zDir round-trip through serializeGrid/deserializeToGrid (like zOffset/depthDir already do).
 */
import '@/__tests__/helpers/installTilesetSeed' // ground reads the loaded backend tileset — install the fixture
import { isoZOffset, DEPTH_STEP, type DepthDir } from '@/engine/render/isoBlock'
import { render } from '@/engine/render/iso'
import { render2D } from '@/engine/render/topdown'
import { IsometricGrid, type GridAsset } from '@/engine/IsometricGrid'
import { deserializeToGrid, serializeGrid, type TemplateData } from '@/lib/api'
import { ASCII_STYLE } from '@/game/artStyle'
import { makeCellAnimation, restFrame } from '@/engine/cellAnimation'
import type { PlayerState } from '@/game/runtime/player'

const DIRS: DepthDir[] = ['right-up', 'left-up', 'left-down', 'right-down']

// ── A. isoZOffset — the per-cell step math ──────────────────────────────────────────────────────
describe('A. isoZOffset — z slides a tile along the iso diagonal (the per-cell screen step)', () => {
  const tileW = 40, tileH = 20

  test.each(DIRS)('%s: +N moves N·step; −N is the exact OPPOSITE; 0 is no move', dir => {
    const s = DEPTH_STEP[dir]
    expect(isoZOffset(3, dir, tileW, tileH)).toEqual({ dx: 3 * s.sx * tileW, dy: 3 * s.sy * tileH })
    const pos = isoZOffset(3, dir, tileW, tileH)
    const neg = isoZOffset(-3, dir, tileW, tileH)
    expect(neg).toEqual({ dx: -pos.dx, dy: -pos.dy }) // −N is the opposite diagonal
    const zero = isoZOffset(0, dir, tileW, tileH) // no move (± signed zero is still zero)
    expect(Math.abs(zero.dx)).toBe(0)
    expect(Math.abs(zero.dy)).toBe(0)
  })

  test('the USER contract (Image #32): +z is up-right for right-up, down-right for right-down', () => {
    // right = up-right vs down-right; the two dirs on the RIGHT of the diamond the user names.
    expect(isoZOffset(1, 'right-up', tileW, tileH)).toEqual({ dx: +tileW, dy: -tileH }) // diagonal right up
    expect(isoZOffset(1, 'right-down', tileW, tileH)).toEqual({ dx: +tileW, dy: +tileH }) // diagonal bottom right
    expect(isoZOffset(1, 'left-up', tileW, tileH)).toEqual({ dx: -tileW, dy: -tileH })
    expect(isoZOffset(1, 'left-down', tileW, tileH)).toEqual({ dx: -tileW, dy: +tileH })
  })

  test('magnitude scales linearly', () => {
    expect(isoZOffset(2, 'right-up', tileW, tileH)).toEqual({ dx: 2 * tileW, dy: -2 * tileH })
    expect(isoZOffset(0.5, 'right-down', tileW, tileH)).toEqual({ dx: 0.5 * tileW, dy: 0.5 * tileH })
  })
})

// A canvas mock that records the transform ORIGIN (translate) + fill rects/text, so we can read back the
// exact screen point the renderer drew a placed asset at.
interface XY { x: number; y: number }
interface Rect { x: number; y: number; w: number; h: number; style: string }
function recordingCtx() {
  const translates: XY[] = []
  const rects: Rect[] = []
  const ctx = {
    fillStyle: '#000', strokeStyle: '#000', font: '', textAlign: '' as CanvasTextAlign,
    textBaseline: '' as CanvasTextBaseline, lineWidth: 1, lineCap: '' as CanvasLineCap, globalAlpha: 1,
    save() {}, restore() {}, rotate() {}, setLineDash() {},
    translate(x: number, y: number) { translates.push({ x, y }) },
    scale() {},
    beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, bezierCurveTo() {}, arc() {},
    ellipse() {}, closePath() {}, fill() {}, stroke() {}, clip() {}, rect() {}, drawImage() {},
    createLinearGradient() { return { addColorStop() {} } }, createRadialGradient() { return { addColorStop() {} } },
    fillRect(x: number, y: number, w: number, h: number) { rects.push({ x, y, w, h, style: String(this.fillStyle) }) },
    strokeRect() {}, fillText() {}, strokeText() {}, measureText() { return { width: 10 } as TextMetrics },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, translates, rects }
}

// ── B. the ISO render() applies the diagonal slide to a placed asset's drawn origin ──────────────
describe('B. ISO render — the asset SLIDES along the diagonal (drawn origin moves by isoZOffset)', () => {
  // Clamp-free geometry: cellSize 100, isoScale 1, zoom 1 → tileW=71, tileH=36, camX=player.x, camZ=player.z.
  const CELL = 100, W = 800, H = 600
  const ISO = 1, TILE_W = CELL * ISO * 0.71, TILE_H = CELL * ISO * 0.36
  const PCOL = 10, PROW = 10, ACOL = 12, AROW = 10
  const player = (): PlayerState => ({ x: PCOL * CELL, z: PROW * CELL, moving: false } as PlayerState)

  // The render's own iso projection for a cell centre (camX=player.x, camZ=player.z — no clamp).
  const cellOrigin = (col: number, row: number): XY => {
    const wx = col * CELL - PCOL * CELL
    const wz = row * CELL - PROW * CELL
    return { x: W / 2 + (wx - wz) * ISO * 0.71, y: H / 2 + (wx + wz) * ISO * 0.36 }
  }

  // A flat, un-elevated asset carrying a REST cell-animation, so the render calls applyCellTransform(ax,ay)
  // → ctx.translate(ax, ay): the exact screen origin it drew the asset at (including the z slide).
  const assetGrid = (zOffset: number, zDir?: DepthDir): IsometricGrid => {
    const grid = new IsometricGrid({ cols: 30, rows: 30, cellSize: CELL, isoScale: ISO })
    const asset: GridAsset = {
      art: ['#'], col: ACOL, row: AROW, type: 'crate', color: '#abcdef',
      cellAnim: makeCellAnimation([{ col: ACOL, row: AROW }], [restFrame(), restFrame()], { trigger: 'always', loop: true }),
      ...(zOffset ? { zOffset } : {}),
      ...(zDir ? { zDir } : {}),
    }
    grid.setAssets([asset])
    return grid
  }

  const renderIso = (grid: IsometricGrid) => {
    const { ctx, translates } = recordingCtx()
    // …, dayNight 'day', attackReach 1, ASCII_STYLE, clampCamera FALSE (camX=player.x, deterministic origin).
    render(ctx, W, H, grid, player(), 0, { x: 0, y: 0 }, [], new Map(), [], 0, 1, [], [], [], [], 'day', 1, ASCII_STYLE, false)
    return translates
  }
  const near = (pts: XY[], x: number, y: number): boolean =>
    pts.some(p => Math.abs(p.x - x) < 0.01 && Math.abs(p.y - y) < 0.01)

  test('z=0 → drawn at the plain cell origin (no slide)', () => {
    const o = cellOrigin(ACOL, AROW)
    expect(near(renderIso(assetGrid(0)), o.x, o.y)).toBe(true)
  })

  test.each(DIRS)('z=+2 %s → origin shifts by 2·step (up-right for right-up, etc.); −2 is the opposite', dir => {
    const o = cellOrigin(ACOL, AROW)
    const step = isoZOffset(2, dir, TILE_W, TILE_H)
    expect(near(renderIso(assetGrid(2, dir)), o.x + step.dx, o.y + step.dy)).toBe(true)
    const neg = isoZOffset(-2, dir, TILE_W, TILE_H)
    expect(near(renderIso(assetGrid(-2, dir)), o.x + neg.dx, o.y + neg.dy)).toBe(true)
  })

  test('right-up (+2) moves the tile UP-RIGHT: +x (right) AND −y (up), NOT straight up', () => {
    const o = cellOrigin(ACOL, AROW)
    const moved = renderIso(assetGrid(2, 'right-up'))
    expect(near(moved, o.x + 2 * TILE_W, o.y - 2 * TILE_H)).toBe(true) // right AND up (the diagonal)
    expect(near(moved, o.x, o.y - 2 * TILE_H)).toBe(false) // NOT a pure vertical move (x also changed)
  })
})

// ── C. render2D — the slide projects to the ground plane, with NO vertical lift ──────────────────
describe('C. render2D — z projects to the ground-plane delta, never a vertical lift', () => {
  const CELL = 16, W = 480, H = 480, TILE = 24, PCOL = 20, PROW = 20, ACOL = 22, AROW = 20
  const UNIQUE = '#0a0b0c' // asset bg colour → find its exact fillRect among the ground rects
  const player = (): PlayerState => ({ x: PCOL * CELL, z: PROW * CELL, moving: false } as PlayerState)

  const assetGrid = (zOffset: number, zDir?: DepthDir): IsometricGrid => {
    const grid = new IsometricGrid({ cols: 40, rows: 40, cellSize: CELL, isoScale: 1 })
    grid.setAssets([{
      art: ['#'], col: ACOL, row: AROW, type: 'crate', color: '#ffffff', bgColor: UNIQUE,
      ...(zOffset ? { zOffset } : {}), ...(zDir ? { zDir } : {}),
    } as GridAsset])
    return grid
  }
  const assetRect = (zOffset: number, zDir?: DepthDir): Rect => {
    const { ctx, rects } = recordingCtx()
    render2D(ctx, W, H, assetGrid(zOffset, zDir), player(), 0)
    const r = rects.find(r => r.style === UNIQUE && r.w === TILE && r.h === TILE)
    if (!r) throw new Error('asset rect not drawn')
    return r
  }

  test('z=0 baseline', () => {
    const r = assetRect(0)
    // cell centre x = W/2 + (col+0.5-PCOL)*TILE; the default-asset rect starts half a tile left of centre.
    expect(r.x).toBeCloseTo(W / 2 + (ACOL + 0.5 - PCOL) * TILE - TILE / 2, 6)
  })

  test('right-down (+3): the tile slides +3 cells RIGHT on the ground plane; y is UNCHANGED (no vertical lift)', () => {
    const base = assetRect(0)
    const moved = assetRect(3, 'right-down') // dc=+1, dr=0 → pure +col
    expect(moved.x - base.x).toBeCloseTo(3 * TILE, 6) // slid right by 3 cells
    expect(moved.y).toBeCloseTo(base.y, 6) // NO vertical lift — the old zOffset*tileH*0.9 lift is gone
  })

  test('right-up (+3): pure depth (−row) → x UNCHANGED, projects to screen-up (still a ground move, not a lift)', () => {
    const base = assetRect(0)
    const moved = assetRect(3, 'right-up') // dc=0, dr=-1 → pure −row
    expect(moved.x).toBeCloseTo(base.x, 6)
    expect(moved.y - base.y).toBeCloseTo(-3 * TILE, 6) // the row delta projects to screen-up in the 2D view
  })
})

// ── D. round-trip zOffset + zDir through serialize/deserialize ───────────────────────────────────
describe('D. serialize/deserialize preserves zOffset + zDir (like zOffset/depthDir already do)', () => {
  const tmpl = (assetsData: unknown[]): TemplateData => ({
    id: 't', name: 'n', description: '', category: '', cols: 4, rows: 4, cellSize: 32, isoScale: 1.4,
    spawnCol: 0, spawnRow: 0,
    groundData: Array.from({ length: 4 }, () => Array(4).fill('grass')),
    heightData: Array.from({ length: 4 }, () => Array(4).fill(0)),
    assetsData, connectors: [], entities: [], quests: [],
    thumbnail: null, isPublic: false, tags: [], createdAt: '', updatedAt: '',
  } as unknown as TemplateData)

  test('serializeGrid → deserializeToGrid keeps the z slide (magnitude + direction) end to end', () => {
    const g = new IsometricGrid({ cols: 4, rows: 4, cellSize: 32, isoScale: 1.4 })
    g.setAssets([{ art: ['#'], col: 1, row: 1, type: 'crate', zOffset: 2.5, zDir: 'left-down' } as GridAsset])
    const ser = serializeGrid(g)
    const grid2 = deserializeToGrid(tmpl(ser.assetsData as unknown[]))
    const a = grid2.assets.find(a => a.type === 'crate')
    expect(a?.zOffset).toBe(2.5)
    expect(a?.zDir).toBe('left-down')
  })

  test('an asset with no z fields round-trips unchanged (undefined, not defaulted on load)', () => {
    const grid = deserializeToGrid(tmpl([{ art: ['#'], col: 0, row: 0, type: 'crate' }]))
    const a = grid.assets.find(a => a.type === 'crate')
    expect(a?.zOffset).toBeUndefined()
    expect(a?.zDir).toBeUndefined()
  })
})
