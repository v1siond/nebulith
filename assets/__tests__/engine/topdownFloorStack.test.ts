/**
 * Step 4a parity — render2D's 2D FLOOR now reads tile index 0 of the cell's unified stack
 * (getStack) instead of grid.ground/groundColor/groundDims directly. This MUST be pixel-identical:
 * the floor TileEntry projects the same slug/colour/dims, so resolveGroundTile / cellFill / the dims
 * path all resolve to the same fills.
 *
 * We drive the REAL render2D through a recording ctx and assert the ground fills it stamps equal what
 * the LEGACY direct-read formula produces (recomputed here from the SAME public helpers the renderer
 * uses) — a genuine "same draw list" proof, not "it drew something":
 *   A. a bare GRASS cell → its per-cell grassShade fill, at the exact cell rect;
 *   B. a per-cell COLOUR override → that exact colour on its cell (neighbours unaffected);
 *   C. a NON-grass floor (water) → the raw catalog bg, NOT grass-shaded;
 *   D. per-cell DIMS are IGNORED under ASCII (byte-identical — no ground scale() leaks in);
 *   E. per-cell DIMS route into the reskin (emoji) ground draw — floor.w/floor.d → groundSizeFactors;
 *   F. a STACKED cell (asset at heightLevel 2) still lifts by heightLevel * tileH * 0.9 (props path).
 *
 * The screen positions are deterministic: a 40×40 grid with the player central means the camera never
 * clamps, so toScreen(col+0.5,row+0.5) is a closed form and each cell's ground rect lands at a known xy.
 */
import '@/__tests__/helpers/installTilesetSeed' // ground terrain comes from the loaded backend tileset now — install the captured fixture so resolveGroundTile isn't empty
import { render2D } from '@/engine/render/topdown'
import { IsometricGrid } from '@/engine/IsometricGrid'
import { ASCII_STYLE, EMOJI_STYLE, groundKind } from '@/game/artStyle'
import { resolveGroundTile } from '@/engine/tileset/tileset'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'
import { grassShade, cellFill } from '@/engine/render/shared'
import type { PlayerState } from '@/game/runtime/player'

interface Rect { x: number; y: number; w: number; h: number; style: string }
interface XY { x: number; y: number }

// A canvas mock that records every fillRect (with the live fillStyle) plus the transform ops the reskin
// ground path uses (save/scale), so we can read the exact fills + dims scaling back.
function recordingCtx() {
  const rects: Rect[] = []
  const scales: XY[] = []
  const ctx = {
    fillStyle: '#000', strokeStyle: '#000', font: '', textAlign: '' as CanvasTextAlign,
    textBaseline: '' as CanvasTextBaseline, lineWidth: 1, lineCap: '' as CanvasLineCap, globalAlpha: 1,
    save() {}, restore() {}, translate() {}, rotate() {}, setLineDash() {},
    scale(x: number, y: number) { scales.push({ x, y }) },
    beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, bezierCurveTo() {}, arc() {},
    ellipse() {}, closePath() {}, fill() {}, stroke() {}, clip() {}, rect() {}, drawImage() {},
    createLinearGradient() { return { addColorStop() {} } }, createRadialGradient() { return { addColorStop() {} } },
    fillRect(x: number, y: number, w: number, h: number) { rects.push({ x, y, w, h, style: String(this.fillStyle) }) },
    strokeRect() {}, fillText() {}, strokeText() {}, measureText() { return { width: 10 } as TextMetrics },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, rects, scales }
}

// Fixed, clamp-free geometry: 40×40 grid, player central, 480×480 canvas, zoom 1 → tileW=tileH=24.
const CELL = 16
const W = 480, H = 480, TILE = 24
const PCOL = 20, PROW = 20
const player = (): PlayerState => ({ x: PCOL * CELL, z: PROW * CELL, moving: false } as PlayerState)
const grid40 = (): IsometricGrid => new IsometricGrid({ cols: 40, rows: 40, cellSize: CELL, isoScale: 1 })

// render2D's own toScreen for a cell CENTRE (camCol=PCOL, camRow=PROW — no clamp on a 40-wide grid).
const cellCentre = (col: number, row: number): XY => ({
  x: W / 2 + (col + 0.5 - PCOL) * TILE,
  y: H / 2 + (row + 0.5 - PROW) * TILE,
})
// The full-cell GROUND fillRect the renderer stamps for a cell (top-left = centre − half a tile).
const groundRect = (col: number, row: number): XY => {
  const c = cellCentre(col, row)
  return { x: c.x - TILE / 2, y: c.y - TILE / 2 }
}
const at = (rects: Rect[], xy: XY): Rect | undefined =>
  rects.find(r => r.x === xy.x && r.y === xy.y && r.w === TILE && r.h === TILE)

// The LEGACY ground fill for a cell, recomputed from the direct grid reads the migration replaced.
const legacyFill = (grid: IsometricGrid, col: number, row: number): string => {
  const tileType = grid.ground[row]?.[col] || 'grass'
  const gt = resolveGroundTile(ASCII_TILESET, tileType, col, row)
  const bg = tileType.includes('grass') ? grassShade(gt.bg, col, row) : gt.bg
  const gk = groundKind(tileType)
  // ASCII → gdv.tint is undefined, so cellFill returns bg; a colour override wins first.
  return grid.groundColor?.[row]?.[col] ?? cellFill(undefined, bg, tileType.includes('grass') || gk === 'cavefloor', col, row)
}

describe('Step 4a — render2D floor reads the unified stack (index 0), pixel-identical to the direct read', () => {
  test('A — a bare GRASS cell paints its exact legacy grassShade fill at the cell rect', () => {
    const grid = grid40()
    const { ctx, rects } = recordingCtx()
    render2D(ctx, W, H, grid, player(), 0)

    const r = at(rects, groundRect(PCOL, PROW))
    expect(r).toBeDefined()
    expect(r!.style).toBe(legacyFill(grid, PCOL, PROW))
    // Sanity: the recomputed fill IS the grass shade (not a raw/flat bg), so this really exercises grass.
    expect(r!.style).toBe(grassShade(resolveGroundTile(ASCII_TILESET, 'grass', PCOL, PROW).bg, PCOL, PROW))
  })

  test('B — a per-cell COLOUR override rides the floor tile; neighbours keep their grass fill', () => {
    const grid = grid40()
    const OVERRIDE = '#abcdef'
    grid.setGroundColor(PCOL + 1, PROW, OVERRIDE) // one cell to the right of centre
    const { ctx, rects } = recordingCtx()
    render2D(ctx, W, H, grid, player(), 0)

    expect(at(rects, groundRect(PCOL + 1, PROW))!.style).toBe(OVERRIDE)
    expect(at(rects, groundRect(PCOL + 1, PROW))!.style).toBe(legacyFill(grid, PCOL + 1, PROW))
    // The centre (grass, no override) is NOT the override colour.
    expect(at(rects, groundRect(PCOL, PROW))!.style).not.toBe(OVERRIDE)
  })

  test('C — a NON-grass floor (water) paints the raw catalog bg, never grass-shaded', () => {
    const grid = grid40()
    grid.setGround(PCOL, PROW - 2, 'water')
    const { ctx, rects } = recordingCtx()
    render2D(ctx, W, H, grid, player(), 0)

    const r = at(rects, groundRect(PCOL, PROW - 2))
    const rawBg = resolveGroundTile(ASCII_TILESET, 'water', PCOL, PROW - 2).bg
    expect(r!.style).toBe(rawBg)
    expect(r!.style).toBe(legacyFill(grid, PCOL, PROW - 2))
    // Explicitly: no accidental grass shading applied to a non-grass tile.
    expect(r!.style).not.toBe(grassShade(rawBg, PCOL, PROW - 2))
  })

  test('D — per-cell DIMS are ignored under ASCII (no ground scale() leaks in — byte-identical)', () => {
    const grid = grid40()
    grid.setGroundDims(PCOL, PROW, { scaleX: 2 }) // a "dimmed" (scaled) floor
    const { ctx, rects, scales } = recordingCtx()
    render2D(ctx, W, H, grid, player(), 0)

    // ASCII draws the floor as a plain full-cell rect regardless of dims, and never scales the ground.
    expect(at(rects, groundRect(PCOL, PROW))).toBeDefined()
    expect(scales).toHaveLength(0)
  })

  test('E — per-cell DIMS route into the reskin (emoji) ground draw: floor.w/floor.d → scale(2,1)', () => {
    const grid = grid40()
    grid.setGroundDims(PCOL, PROW, { scaleX: 2 }) // Width×Zoom = 2 on x, Depth×Zoom = 1 on y
    const { ctx, scales } = recordingCtx()
    render2D(ctx, W, H, grid, player(), 0, 1, { x: 0, y: 0 }, [], new Map(), [], [], 'day', [], [], [], 1, EMOJI_STYLE)

    // Exactly the dims cell scales the ground; groundSizeFactors({scaleX:2}) = { fx: 2, fy: 1 }.
    expect(scales.some(s => s.x === 2 && s.y === 1)).toBe(true)
  })

  test('F — a STACKED cell (asset at heightLevel 2) lifts by heightLevel * tileH * 0.9 (props path intact)', () => {
    const grid = grid40()
    const BG = '#f0f0f0'
    // Two identical props on the SAME row (so p.y matches) at different stack levels — the y gap is purely the raise.
    grid.placeAsset(['#'], PCOL, PROW + 2, { type: 'crate', bgColor: BG, heightLevel: 0 })
    grid.placeAsset(['#'], PCOL + 1, PROW + 2, { type: 'crate', bgColor: BG, heightLevel: 2 })
    const { ctx, rects } = recordingCtx()
    render2D(ctx, W, H, grid, player(), 0)

    const props = rects.filter(r => r.style === BG && r.w === TILE && r.h === TILE)
    expect(props).toHaveLength(2)
    const flat = props.find(r => r.x === groundRect(PCOL, PROW + 2).x)! // heightLevel 0
    const raised = props.find(r => r.x === groundRect(PCOL + 1, PROW + 2).x)! // heightLevel 2
    expect(flat.y - raised.y).toBeCloseTo(2 * TILE * 0.9, 5) // 43.2px — two stack levels up
  })
})
