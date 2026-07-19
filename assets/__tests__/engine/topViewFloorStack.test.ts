/**
 * Step 4c parity — renderTopView's TOP (birdseye) FLOOR now reads tile index 0 of the cell's unified
 * stack (getStack) instead of grid.ground/groundColor directly. This MUST be pixel-identical: the floor
 * TileEntry projects the SAME slug/colour, so the blueprint cell fill (ASCII_TILESET.terrain lookup +
 * cellFill, with a per-cell colour override winning first) resolves to the same fillRect. Mirrors
 * src/__tests__/engine/topdownFloorStack.test.ts (4a) and isoFloorStack.test.ts (4b), on the top view.
 *
 * NOTE the top view does NOT use groundDims (its dims path is asset-only, via `asset ?? {}`), so unlike
 * 2D/iso only slug + the colour override migrate — there is no dims reconstruction to prove here.
 *
 * We drive the REAL renderTopView through a recording ctx and assert the ground fillRect it stamps for a
 * bare cell equals the LEGACY direct-read formula (recomputed here from the SAME public helpers the
 * renderer uses) — a genuine "same draw list" proof, not "it drew something":
 *   A. a bare GRASS cell → its per-cell grassShade fill, at the exact cell rect;
 *   B. a per-cell COLOUR override → that exact colour on its cell (neighbours unaffected);
 *   C. a NON-grass floor (water) → the raw catalog bg, NOT grass-shaded;
 *   D. source parity — getStack[0].slug || 'grass' === grid.ground read; getStack[0].color ?? null
 *      === grid.groundColor read (the two substitutions the diff made).
 *
 * Geometry is deterministic: a 40×40 grid with the player central (col=row=20) means clampCameraAxis
 * never clamps, so the ground rect for a cell lands at (offsetX+col·tileSize, offsetY+row·tileSize) with
 * side tileSize-1 — a closed form. Target cells avoid the player cell (drawn twice) and stay in range.
 */
import '@/__tests__/helpers/installTilesetSeed' // ground terrain comes from the loaded backend tileset now — install the captured fixture so the terrain lookup isn't empty
import { renderTopView } from '@/engine/render/birdseye'
import { IsometricGrid } from '@/engine/IsometricGrid'
import { getStack } from '@/engine/cellStack'
import { ASCII_STYLE, groundKind } from '@/game/artStyle'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'
import { grassShade, cellFill, resolveAssetDraw, clampCameraAxis } from '@/engine/render/shared'
import type { PlayerState } from '@/game/runtime/player'

interface Rect { x: number; y: number; w: number; h: number; style: string }

// A canvas mock recording every fillRect with the live fillStyle. Every other ctx op is a no-op (the
// birdseye ground cell's ONLY fillRect is its full-cell backing; glyphs go through fillText).
function recordingCtx() {
  const rects: Rect[] = []
  const ctx = {
    fillStyle: '#000', strokeStyle: '#000', font: '', textAlign: '' as CanvasTextAlign,
    textBaseline: '' as CanvasTextBaseline, lineWidth: 1, lineCap: '' as CanvasLineCap, globalAlpha: 1,
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, transform() {}, setLineDash() {},
    beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, bezierCurveTo() {}, arc() {},
    ellipse() {}, closePath() {}, fill() {}, stroke() {}, clip() {}, rect() {}, drawImage() {},
    createLinearGradient() { return { addColorStop() {} } }, createRadialGradient() { return { addColorStop() {} } },
    fillRect(x: number, y: number, w: number, h: number) { rects.push({ x, y, w, h, style: String(this.fillStyle) }) },
    strokeRect() {}, fillText() {}, strokeText() {}, measureText() { return { width: 10 } as TextMetrics },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, rects }
}

// Fixed, clamp-free geometry: 40×40 grid, player central, 480×480 canvas, zoom 1 → tileSize=16.
const CELL = 16
const W = 480, H = 480, ZOOM = 1
const TILE = 16 * ZOOM
const PCOL = 20, PROW = 20
const player = (): PlayerState => ({ x: PCOL * CELL, z: PROW * CELL, moving: false } as PlayerState)
const grid40 = (): IsometricGrid => new IsometricGrid({ cols: 40, rows: 40, cellSize: CELL, isoScale: 1 })

// renderTopView's own camera maths (no clamp on a 40-wide grid with the player central).
const offsetX = W / 2 - clampCameraAxis(PCOL, W / TILE / 2, 40) * TILE
const offsetY = H / 2 - clampCameraAxis(PROW, H / TILE / 2, 40) * TILE
// The full-cell GROUND fillRect the renderer stamps for a bare cell: (offsetX+col·TILE, offsetY+row·TILE, TILE-1).
const groundFill = (rects: Rect[], col: number, row: number): Rect | undefined =>
  rects.find(r => r.x === offsetX + col * TILE && r.y === offsetY + row * TILE && r.w === TILE - 1 && r.h === TILE - 1)

// The LEGACY birdseye ground fill for a bare cell, recomputed from the direct grid reads the migration
// replaced (ASCII → resolveAssetDraw tint is undefined, so cellFill returns bg; an override wins first).
const legacyFill = (grid: IsometricGrid, col: number, row: number): string => {
  const tileType = grid.ground[row]?.[col] || 'grass'
  const colors = ASCII_TILESET.terrain[tileType] ?? ASCII_TILESET.terrain.grass
  const kind = groundKind(tileType)
  const grassy = tileType.includes('grass') || kind === 'cavefloor'
  const bg = grassy ? grassShade(colors.bg[0], col, row) : colors.bg[0]
  const dv = resolveAssetDraw(kind, ASCII_STYLE, undefined, colors.char[0], colors.fg[0])
  return grid.groundColor?.[row]?.[col] ?? cellFill(dv.tint, bg, grassy, col, row)
}

const render = (grid: IsometricGrid, ctx: CanvasRenderingContext2D) =>
  renderTopView({ ctx, w: W, h: H, grid, player: player(), zoom: ZOOM })

describe('Step 4c — renderTopView floor reads the unified stack (index 0), pixel-identical to the direct read', () => {
  test('A — a bare GRASS cell paints its exact legacy grassShade fill at the cell rect', () => {
    const grid = grid40()
    const { ctx, rects } = recordingCtx()
    render(grid, ctx)

    const r = groundFill(rects, PCOL - 2, PROW - 2) // (18,18) — bare grass, not the player cell
    expect(r).toBeDefined()
    expect(r!.style).toBe(legacyFill(grid, PCOL - 2, PROW - 2))
    // Sanity: the recomputed fill IS the grass shade (not a raw/flat bg), so this really exercises grass.
    expect(r!.style).toBe(grassShade(ASCII_TILESET.terrain.grass.bg[0], PCOL - 2, PROW - 2))
  })

  test('B — a per-cell COLOUR override rides the floor tile; neighbours keep their grass fill', () => {
    const grid = grid40()
    const OVERRIDE = '#abcdef'
    grid.setGroundColor(PCOL + 2, PROW, OVERRIDE) // (22,20) — two cells right of the player
    const { ctx, rects } = recordingCtx()
    render(grid, ctx)

    expect(groundFill(rects, PCOL + 2, PROW)!.style).toBe(OVERRIDE)
    expect(groundFill(rects, PCOL + 2, PROW)!.style).toBe(legacyFill(grid, PCOL + 2, PROW))
    // A neighbour with no override still paints grass (the override didn't leak).
    expect(groundFill(rects, PCOL + 3, PROW)!.style).not.toBe(OVERRIDE)
    expect(groundFill(rects, PCOL + 3, PROW)!.style).toBe(legacyFill(grid, PCOL + 3, PROW))
  })

  test('C — a NON-grass floor (water) paints the raw catalog bg, never grass-shaded', () => {
    const grid = grid40()
    grid.setGround(PCOL - 2, PROW + 2, 'water') // (18,22)
    const { ctx, rects } = recordingCtx()
    render(grid, ctx)

    const r = groundFill(rects, PCOL - 2, PROW + 2)
    const rawBg = ASCII_TILESET.terrain.water.bg[0]
    expect(r!.style).toBe(legacyFill(grid, PCOL - 2, PROW + 2))
    expect(r!.style).toBe(rawBg) // water is neither grass nor cavefloor → the raw catalog bg
    expect(r!.style).not.toBe(grassShade(rawBg, PCOL - 2, PROW + 2))
  })

  test('D — source parity: getStack[0].slug/color reproduce the exact grid.ground/groundColor reads', () => {
    const grid = grid40()
    grid.setGround(2, 2, 'water')
    grid.setGroundColor(3, 3, '#123456')
    for (const [col, row] of [[2, 2], [3, 3], [7, 7]] as const) {
      const floor = getStack(grid, col, row)[0]
      expect(floor.slug || 'grass').toBe(grid.ground[row]?.[col] || 'grass')
      expect(floor.color ?? null).toBe(grid.groundColor?.[row]?.[col] ?? null)
    }
  })
})
