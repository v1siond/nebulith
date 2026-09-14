/**
 * WHAT EACH THICKNESS DIRECTION ACTUALLY DRAWS, in pixels.
 *
 * Three reported bugs, all about the same control:
 *   1. thickness does nothing once z-width is > 1
 *   2. the arrow in the UI does not match the side that moves
 *   3. all four at 1 draws wrong, and any one below 1 fixes it
 *
 * Reasoning about the quad was not settling it, so this measures the drawn silhouette. `right-down` is +col
 * (down-right on screen) and `left-down` is +row (down-left), so thinning one of those must narrow the block
 * on that side and leave the other alone.
 */
import { installRealCanvas, type RealCanvasHarness } from '@/__tests__/helpers/realCanvas'
import { drawIsoTileBlock, drawIsoTileForShape } from '@/engine/render/iso'
import { rotateDepthDir, rotateThicknessReach, type DepthDir, type ThicknessReach } from '@/engine/render/isoBlock'
import type { GridAsset } from '@/engine/IsometricGrid'
import type { Canvas } from '@napi-rs/canvas'

let H: RealCanvasHarness
const TW = 40, TH = 20, BH = 44, CX = 200, CY = 220
const SOLID = { color: '#c86432' }
const W = 560, HT = 420

beforeAll(() => { H = installRealCanvas().harness })

/** The drawn shape's bounding box, from any pixel that is not the cleared background. */
function silhouette(canvas: Canvas): { x0: number; x1: number; y0: number; y1: number; area: number } {
  const ctx = canvas.getContext('2d')
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  let x0 = width, x1 = -1, y0 = height, y1 = -1, area = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] === 0) continue
      area++
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return { x0, x1, y0, y1, area }
}

const draw = (thickness?: ThicknessReach, depth = 1, depthDir?: DepthDir) => {
  const canvas = H.makeCanvas(W, HT)
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D
  drawIsoTileBlock(ctx, { x: CX, y: CY }, TW, TH, BH, 1, SOLID, undefined, undefined, depth, depthDir, thickness)
  return silhouette(canvas)
}

const ALL_ONE: ThicknessReach = { 'right-down': 1, 'left-down': 1, 'right-up': 1, 'left-up': 1 }

describe('a thickness map of all 1s is the same drawing as none', () => {
  it('draws the identical silhouette', () => {
    expect(draw(ALL_ONE)).toEqual(draw(undefined))
  })
})

describe('each direction thins the side it names', () => {
  it('right-down (+col, down-right) pulls the DOWN-RIGHT side in', () => {
    const full = draw(undefined)
    const thin = draw({ 'right-down': 0.3 })
    expect(thin.area).toBeLessThan(full.area)
    // +col is down-right, so the right edge comes in and the left edge stays put.
    expect(thin.x1).toBeLessThan(full.x1)
    expect(thin.x0).toBe(full.x0)
  })

  it('left-up (-col, up-left) pulls the UP-LEFT side in', () => {
    const full = draw(undefined)
    const thin = draw({ 'left-up': 0.3 })
    expect(thin.area).toBeLessThan(full.area)
    expect(thin.x0).toBeGreaterThan(full.x0)
    expect(thin.x1).toBe(full.x1)
  })

  it('left-down (+row, down-left) and right-up (-row) work the same way on the other axis', () => {
    const full = draw(undefined)
    const down = draw({ 'left-down': 0.3 })
    const up = draw({ 'right-up': 0.3 })
    expect(down.area).toBeLessThan(full.area)
    expect(up.area).toBeLessThan(full.area)
    expect(down.x0).toBeGreaterThan(full.x0) // +row is down-LEFT, so its far side is the left one
    expect(up.x1).toBeLessThan(full.x1)
  })
})

describe('thickness applies WITH z-width, not instead of it', () => {
  it('a spanning block still thins', () => {
    const full = draw(undefined, 6, 'left-down')
    const thin = draw({ 'right-down': 0.3 }, 6, 'left-down')
    expect(thin.area).toBeLessThan(full.area)
  })

  it('and still spans: thinning across the run does not shorten it', () => {
    const one = draw(undefined, 1, 'left-down')
    const six = draw({ 'right-down': 0.3 }, 6, 'left-down')
    expect(six.y1 - six.y0).toBeGreaterThan(one.y1 - one.y0)
  })
})

describe('the UI arrow and the map agree at EVERY rotation', () => {
  // The four sliders are SCREEN arrows: ↘ is down-right on screen whatever the map is turned to. The editor
  // converts the arrow to a world axis with `rotateDepthDir(dir, -facing)` and the renderer converts it back
  // with `rotateDepthDir(dir, +facing)`. If those two ever stop being inverses, the slider you drag stops
  // matching the side that moves, which is the whole complaint.
  const SCREEN: DepthDir[] = ['right-down', 'left-down', 'left-up', 'right-up']

  it.each([0, 1, 2, 3])('facing %i: the arrow you drag is the world axis that comes back', facing => {
    for (const arrow of SCREEN) {
      const stored = rotateDepthDir(arrow, -facing) // what the editor writes for this arrow
      const shown = rotateDepthDir(stored, facing)  // what orientAssetForView hands the draw
      expect({ facing, arrow, shown }).toEqual({ facing, arrow, shown: arrow })
    }
  })

  it.each([0, 1, 2, 3])('facing %i: a whole reach map survives the round trip', facing => {
    const stored = rotateThicknessReach({ 'right-down': 0.3 }, -facing)
    expect(rotateThicknessReach(stored, facing)).toEqual({ 'right-down': 0.3 })
  })

  it.each([0, 1, 2, 3])('facing %i: dragging the down-right arrow thins the DOWN-RIGHT side on screen', facing => {
    const stored = rotateThicknessReach({ 'right-down': 0.3 }, -facing)
    const onScreen = rotateThicknessReach(stored, facing)
    const full = draw(undefined)
    const thin = draw(onScreen)
    expect({ facing, narrower: thin.x1 < full.x1, leftHeld: thin.x0 === full.x0 })
      .toEqual({ facing, narrower: true, leftHeld: true })
  })
})

describe('a Z-WIDTH tile takes its thickness too (the rect branch)', () => {
  // A spanning tile is drawn by `drawIsoRectBlock`, a different function from the one above, and it was never
  // handed the thickness at all: a tile asking for both got the span and drew full width.
  const rect = (thickness?: ThicknessReach) => {
    const canvas = H.makeCanvas(W, HT)
    const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D
    const asset = { depthDir: 'left-down' as DepthDir, depth: 6, thickness, shape: 'square' } as unknown as GridAsset
    drawIsoTileForShape(ctx, { x: CX, y: CY }, TW, TH, BH, 1, SOLID, undefined, asset)
    return silhouette(canvas)
  }

  it('thins when asked, while still spanning its cells', () => {
    const full = rect()
    const thin = rect({ 'right-down': 0.3 })
    expect(thin.area).toBeLessThan(full.area)
    expect(thin.y1 - thin.y0).toBeGreaterThan(TH * 4) // still a long run, not collapsed to one cell
  })

  it('all four at 1 draws exactly what no thickness draws', () => {
    expect(rect(ALL_ONE)).toEqual(rect(undefined))
  })
})
