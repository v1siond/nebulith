/**
 * End-to-end: render2D draws a stamped BUILDING as a FRONT ELEVATION (MAP-MODEL §2-3, REQUIREMENTS §C).
 *
 * The bug: render2D drew every stacked cell at its OWN (col,row) raised by heightLevel, so a building's
 * DEPTH rows piled upward and a 4-deep × 5-tall house read ~8-9 cells tall. The fix collapses depth: for
 * each (col, level) only the FRONT-most cell draws, anchored at the structure's front row.
 *
 * We drive the REAL render2D with a stamped house_4 through a recording ctx. Each facade cell (walls/
 * windows/door/roof) is drawn by draw2DLabeledCell, which stamps a unique translucent-black overlay rect
 * ('rgba(0, 0, 0, 0.45)') — a clean, ground-free marker for the drawn facade cells. Its WIDTH is one TILE;
 * its HEIGHT is `scaleY` TILEs (a collapsed vertical run of span N draws ONE rect N cells tall — 2D now
 * honours scaleY exactly like iso, per the composition.ts collapse contract). We assert their GEOMETRY
 * (not pixels): the facade's vertical extent equals the building's LEVEL height, NOT level + depth (~9);
 * and the number of drawn facade cells equals the depth-collapsed projection.
 */
import '@/__tests__/helpers/installTilesetSeed' // house_4 composition + tiles come from the loaded backend tileset fixture
import { render2D } from '@/engine/render/topdown'
import { frontElevation } from '@/engine/render/frontElevation'
import { IsometricGrid } from '@/engine/IsometricGrid'
import { stampBuildingComposition } from '@/game/runtime/composition'
import type { PlayerState } from '@/game/runtime/player'

interface Rect { x: number; y: number; w: number; h: number; style: string }

function recordingCtx() {
  const rects: Rect[] = []
  const ctx = {
    fillStyle: '#000', strokeStyle: '#000', font: '', textAlign: '' as CanvasTextAlign,
    textBaseline: '' as CanvasTextBaseline, lineWidth: 1, lineCap: '' as CanvasLineCap, globalAlpha: 1,
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, setLineDash() {},
    beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, bezierCurveTo() {}, arc() {},
    ellipse() {}, closePath() {}, fill() {}, stroke() {}, clip() {}, rect() {}, drawImage() {},
    createLinearGradient() { return { addColorStop() {} } }, createRadialGradient() { return { addColorStop() {} } },
    fillRect(x: number, y: number, w: number, h: number) { rects.push({ x, y, w, h, style: String(this.fillStyle) }) },
    strokeRect() {}, fillText() {}, strokeText() {}, measureText() { return { width: 10 } as TextMetrics },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, rects }
}

const CELL = 16
const W = 640, H = 640, TILE = 24
const PCOL = 20, PROW = 20
const player = (): PlayerState => ({ x: PCOL * CELL, z: PROW * CELL, moving: false } as PlayerState)
const grid40 = (): IsometricGrid => new IsometricGrid({ cols: 40, rows: 40, cellSize: CELL, isoScale: 1 })

// draw2DLabeledCell stamps this exact translucent-black overlay on EVERY facade cell it draws (ascii) —
// the ground/props never use it, so it isolates the building's drawn cells.
const FACADE_OVERLAY = 'rgba(0, 0, 0, 0.45)'

describe('render2D — a stamped building renders as a front elevation (depth collapsed)', () => {
  test("the house's 2D vertical extent equals its LEVEL height, not level + depth", () => {
    const grid = grid40()
    // house_4: 4 wide × 4 deep — living floors (levels 0-3) + a gable roof whose eave starts at level 4.
    // Front door faces south → front row = anchor + 3.
    const ANCHOR = PROW - 1 // near centre so the camera never clamps and the whole house is on-screen
    stampBuildingComposition(grid, 'house', 4, ANCHOR, ANCHOR, 'spring', 'south')

    // The building's TRUE rendered height in blocks — `level + own height × scaleY`, the same accumulation
    // the stacking rule uses. The gable's ridge is a level-4 bar carrying its step height as scaleY 2, so the
    // house tops out at 6 blocks even though its highest LEVEL is 4.
    const topBlocks = Math.max(...grid.assets.map(a => (a.heightLevel ?? 0) + (a.height ?? 1) * (a.scaleY ?? 1)))
    expect(topBlocks).toBe(6) // sanity: the stamped house really is 6 blocks tall (ridge = level 4 + a 2-block bar)

    const { ctx, rects } = recordingCtx()
    render2D({ ctx, w: W, h: H, grid, player: player(), time: 0 })

    const facade = rects.filter(r => r.style === FACADE_OVERLAY && r.w === TILE && r.h % TILE === 0)
    expect(facade.length).toBeGreaterThan(0)

    // GEOMETRY: the facade's total vertical span == the building's true height in cells.
    const top = Math.min(...facade.map(r => r.y))
    const bottom = Math.max(...facade.map(r => r.y + r.h))
    const extentCells = (bottom - top) / TILE
    expect(extentCells).toBeCloseTo(topBlocks, 5)  // 6 cells tall — NOT depth(4) + height(6) ≈ 10
    expect(extentCells).toBeLessThan(topBlocks + 1) // hard upper bound: depth is truly collapsed

    // The number of drawn facade cells equals the depth-collapsed projection (front-most per col/level).
    const projected = frontElevation(grid.assets).draw.size
    expect(facade.length).toBe(projected)
    // And that projection is far fewer than the raw stamped cell count (depth rows were dropped).
    expect(projected).toBeLessThan(grid.assets.length)
  })

  test('the facade never renders outside the grid horizontally (C2): all cells sit within the footprint columns', () => {
    const grid = grid40()
    const ANCHOR = PROW - 1
    stampBuildingComposition(grid, 'house', 4, ANCHOR, ANCHOR, 'spring', 'south')

    const { ctx, rects } = recordingCtx()
    render2D({ ctx, w: W, h: H, grid, player: player(), time: 0 })
    const facade = rects.filter(r => r.style === FACADE_OVERLAY && r.w === TILE && r.h % TILE === 0)

    // Building spans columns [ANCHOR, ANCHOR+3]. Every facade cell's centre-x must fall inside that band.
    const minCol = ANCHOR, maxCol = ANCHOR + 3
    const xForCol = (col: number) => W / 2 + (col + 0.5 - PCOL) * TILE
    const leftBound = xForCol(minCol) - TILE / 2 - 0.5
    const rightBound = xForCol(maxCol) + TILE / 2 + 0.5
    for (const r of facade) {
      const cx = r.x + r.w / 2
      expect(cx).toBeGreaterThanOrEqual(leftBound)
      expect(cx).toBeLessThanOrEqual(rightBound)
    }
  })
})
