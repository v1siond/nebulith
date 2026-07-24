/**
 * PLAYER-CAMERA RANGE — render only what's within a controllable radius of the player.
 *
 * User: "we should have somewhere in code base code to control the 'player' camera, which controls the
 * rendering of elements that are in a given range from the user, I want to be able to see that visually
 * around the user AND I want to control that setting, so increasing, reducing, etc."
 *
 * This is NOT new — `grid.getVisibleAssets(cam, viewCols, viewRows)` was a fixed 30×20 window around the
 * camera until commit b317962 made it zoom-derived. This restores it as a CONTROLLABLE range: an opt-in
 * `playerViewRange` (radius in cells) culls every element outside it — RADIALLY, so what's drawn matches the
 * ring drawn around the player. Off (undefined) = today's behaviour, so nothing changes until you turn it on.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { render, renderedTilesInRect, withinPlayerRange } from '@/engine/render/iso'
import { IsometricGrid, type GridAsset } from '@/engine/IsometricGrid'
import { ASCII_STYLE } from '@/game/artStyle'
import type { PlayerState } from '@/game/runtime/player'
import type { Entity } from '@/game/types'

const CELL = 100, W = 800, H = 600, ISO = 1
const PCOL = 10, PROW = 10 // the player stands here (clamp-free camera → camera sits on the player)

const heroEntity = (): Entity => ({ id: 'hero', kind: 'player' } as unknown as Entity)
const heroPlayer = (): PlayerState =>
  ({ x: PCOL * CELL, z: PROW * CELL, moving: false, facing: 'down', frame: 0 } as PlayerState)

const wallAt = (col: number, row: number): GridAsset =>
  ({ col, row, type: 'wall', tileKey: 'emoji:wall', art: ['#'], heightLevel: 0, height: 1 } as unknown as GridAsset)

function mockCtx(): CanvasRenderingContext2D {
  const ctx = {
    fillStyle: '#000', strokeStyle: '#000', font: '', textAlign: '' as CanvasTextAlign,
    textBaseline: '' as CanvasTextBaseline, lineWidth: 1, lineCap: '' as CanvasLineCap, globalAlpha: 1,
    save() {}, restore() {}, rotate() {}, translate() {}, scale() {}, setLineDash() {},
    transform() {}, setTransform() {}, resetTransform() {}, getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } },
    beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, bezierCurveTo() {}, arc() {},
    ellipse() {}, closePath() {}, fill() {}, stroke() {}, clip() {}, rect() {}, drawImage() {},
    createLinearGradient() { return { addColorStop() {} } }, createRadialGradient() { return { addColorStop() {} } },
    createPattern() { return null }, putImageData() {}, getImageData() { return { data: [] } },
    fillRect() {}, strokeRect() {}, fillText() {}, strokeText() {}, measureText() { return { width: 10 } as TextMetrics },
  }
  return ctx as unknown as CanvasRenderingContext2D
}

// Both cells sit on the down-centre diagonal so they stay ON the 800×600 screen rect (going far along +row
// alone walks off the left edge); the range test is about DISTANCE, so the far one must still be on-screen.
const NEAR = { col: PCOL + 1, row: PROW + 1 } // dist ~1.41
const FAR = { col: PCOL + 4, row: PROW + 4 }  // dist ~5.66 — on-screen, beyond a range of 4
const scene = (): IsometricGrid => {
  const grid = new IsometricGrid({ cols: 40, rows: 40, cellSize: CELL, isoScale: ISO })
  grid.setAssets([wallAt(NEAR.col, NEAR.row), wallAt(FAR.col, FAR.row)])
  return grid
}

const renderIso = (grid: IsometricGrid, playerViewRange?: number): void => {
  render({
    ctx: mockCtx(), w: W, h: H, grid, player: heroPlayer(), time: 0, camOffset: { x: 0, y: 0 },
    entities: [heroEntity()], enemyCombat: new Map(), hitMarkers: [], now: 0, zoom: 1, attackAnims: [],
    connectors: [], quests: [], projectiles: [], dayNight: 'day', attackReach: 1, style: ASCII_STYLE,
    clampCamera: false, playerViewRange,
  })
}

const drawnAt = (col: number, row: number): boolean =>
  renderedTilesInRect(0, 0, W, H).some(t => t.col === col && t.row === row && t.source !== 'entity')

describe('withinPlayerRange — a radial test, not a rectangle', () => {
  it('includes the player cell and anything inside the radius', () => {
    expect(withinPlayerRange(10, 10, 10, 10, 4)).toBe(true)
    expect(withinPlayerRange(12, 11, 10, 10, 4)).toBe(true) // dist ~2.24
  })

  it('excludes a cell beyond the radius', () => {
    expect(withinPlayerRange(20, 20, 10, 10, 4)).toBe(false) // dist ~14.1
  })

  it('is RADIAL: the corner (r, r) is outside a range of r (hypot > r), unlike a box', () => {
    expect(withinPlayerRange(14, 14, 10, 10, 4)).toBe(false) // dist ~5.66 > 4
    expect(withinPlayerRange(14, 10, 10, 10, 4)).toBe(true)  // dist 4, on the edge
  })
})

describe('playerViewRange culls the render to a radius around the player', () => {
  it('draws a near element and NOT a far one when the range is small', () => {
    const grid = scene()
    renderIso(grid, 4)

    expect(drawnAt(NEAR.col, NEAR.row)).toBe(true)  // ~1.4 cells → inside
    expect(drawnAt(FAR.col, FAR.row)).toBe(false)   // ~5.7 cells → culled
  })

  it('draws BOTH when the range is off (undefined) — today\'s behaviour, no regression', () => {
    const grid = scene()
    renderIso(grid, undefined)

    expect(drawnAt(NEAR.col, NEAR.row)).toBe(true)
    expect(drawnAt(FAR.col, FAR.row)).toBe(true) // the far one still draws
  })

  it('widening the range brings the far element back', () => {
    const grid = scene()
    renderIso(grid, 20) // now the ~5.7 far element is inside

    expect(drawnAt(FAR.col, FAR.row)).toBe(true)
  })
})
