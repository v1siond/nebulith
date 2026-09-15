/**
 * THE RANGE HIDES THE MAP, NOT JUST THE THINGS ON IT.
 *
 * *"range still not working as expected, plus it looks like it's fake, like it only hides stuff that it's
 * there, instead of actually conditionally rendering when inside range"* (2026-09-15, Image #81).
 *
 * He was right and it was one omission. `drawGridSkirt` draws the map's BODY, the earth slab under the ground
 * and the walls at its edges, and it took the camera window and never asked about the range. So with the range
 * on, the trees and blooms outside it disappeared and the entire map body stayed, which reads exactly like a
 * mask laid over a finished picture rather than a map that stops.
 *
 * Measured live before the fix: 251 assets on screen, 52 drawn, so the ASSET cull was working. The body was
 * the part escaping.
 */
import { drawGridSkirt } from '@/engine/render/iso'
import { IsometricGrid } from '@/engine/IsometricGrid'

/** A context that records how many quads were filled, which is how much map body got drawn. */
function countingCtx(): { ctx: CanvasRenderingContext2D; fills: () => number } {
  let fills = 0
  const ctx = {
    fillStyle: '#000', strokeStyle: '#000', globalAlpha: 1, lineWidth: 1,
    save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    fill() { fills++ }, stroke() {}, fillRect() { fills++ }, translate() {}, scale() {}, rotate() {},
    drawImage() {}, createLinearGradient() { return { addColorStop() {} } },
    measureText() { return { width: 8 } as TextMetrics }, fillText() {},
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills: () => fills }
}

const grid = (): IsometricGrid => new IsometricGrid({ cols: 40, rows: 40, cellSize: 32, isoScale: 1.4 })

const project = (col: number, row: number) => ({ x: (col - row) * 16, y: (col + row) * 8 })

function skirtFills(range?: { col: number; row: number; cells: number }): number {
  const { ctx, fills } = countingCtx()
  drawGridSkirt(ctx, grid(), project, 16, 8, 20, 20, 44, 12, 0, range)
  return fills()
}

describe('the map body obeys the player range', () => {
  it('draws the whole window when no range is set', () => {
    expect(skirtFills()).toBeGreaterThan(0)
  })

  it('draws FAR less of the body inside a small range than with none', () => {
    expect(skirtFills({ col: 20, row: 20, cells: 5 })).toBeLessThan(skirtFills())
  })

  it('draws more body as the range grows, which is what "conditionally rendering" means', () => {
    // MEASURED on a solid 40x40 from its centre: 0 fills at ranges 4, 8 and 12, then 26 at range 20 and 80
    // unrestricted. A flat slab's interior walls are each hidden by the cell in front, so the only body it
    // HAS is the outer rim, 20 cells out. A range that does not reach the rim correctly draws none of it,
    // which is the feature rather than a gap.
    expect(skirtFills({ col: 20, row: 20, cells: 12 })).toBe(0)
    expect(skirtFills({ col: 20, row: 20, cells: 20 })).toBeGreaterThan(0)
    expect(skirtFills({ col: 20, row: 20, cells: 60 })).toBe(skirtFills())
  })

  it('draws nothing at all when the range excludes every cell', () => {
    // A range centred far off the map: no cell is within it, so no body is drawn. Before the fix the body
    // was drawn for the whole camera window regardless.
    expect(skirtFills({ col: 500, row: 500, cells: 3 })).toBe(0)
  })
})
