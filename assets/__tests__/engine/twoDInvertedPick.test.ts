/**
 * INVERTED 2D PICK (end-to-end) — the front-elevation selector picks the TILE the user SEES (a tall / lifted
 * tile grown by scaleY/heightLevel, a lamp's raised bulb) and cascades to its cell, NOT the flat ground cell.
 *
 * render2D records each drawn tile's screen rect (twoDTileHits); pickTwoDTileAt hit-tests THAT. Points are read
 * from the recorded geometry so the test never re-derives the 2D camera. The old flat-cell pick (screenToCell)
 * would resolve a click high on a tall tile to an empty cell ROWS above — which the recorded-rect pick fixes.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { render2D, pickTwoDTileAt, twoDRecordedGeom } from '@/engine/render/topdown'
import { IsometricGrid, type GridAsset } from '@/engine/IsometricGrid'
import { ASCII_STYLE } from '@/game/artStyle'
import type { PlayerState } from '@/game/runtime/player'
import type { TileGeom } from '@/engine/render/tileHit'

const CELL = 16, W = 800, H = 600
const PCOL = 20, PROW = 20, ACOL = 22, AROW = 20
const player = (): PlayerState => ({ x: PCOL * CELL, z: PROW * CELL, moving: false } as PlayerState)

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

const render2DGrid = (asset: GridAsset): void => {
  const grid = new IsometricGrid({ cols: 40, rows: 40, cellSize: CELL })
  grid.setAssets([asset])
  render2D(mockCtx(), W, H, grid, player(), 0, 1, { x: 0, y: 0 }, [], new Map(), [], [], 'day', [], [], [], 1, ASCII_STYLE)
}

// The recorded rect's bounds (min/max screen coords + centre) — the geometry the pick tests against.
const bounds = (g: TileGeom | null) => {
  if (!g || g.kind !== 'poly') throw new Error('expected a recorded 2D rect')
  const xs = g.pts.map(p => p.x), ys = g.pts.map(p => p.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  return { minX, maxX, minY, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, h: maxY - minY }
}

describe('a TALL (scaleY) 2D tile — picked at its lifted top, not the ground cell rows below', () => {
  const tall: GridAsset = { art: ['#'], col: ACOL, row: AROW, type: 'wall', label: 'wall', height: 1, scaleY: 5, color: '#8a8a8a' }

  test('the recorded rect grows UP ~scaleY cells; the pick at its top returns the tile, the ground below nothing', () => {
    render2DGrid(tall)
    const b = bounds(twoDRecordedGeom(ACOL, AROW, 0))
    expect(b.h).toBeGreaterThan(CELL * 3) // a scaleY-5 tile is far taller than a 1-cell flat square
    const top = pickTwoDTileAt(b.cx, b.minY + 8) // high on the tall tile
    expect(top && { col: top.col, row: top.row }).toEqual({ col: ACOL, row: AROW })
    expect(pickTwoDTileAt(b.cx, b.maxY + 80)).toBeNull() // the now-empty ground below the base
  })
})

describe('an ASCII lamp — picked at its raised bulb, not the post base', () => {
  const lamp: GridAsset = { art: ['|'], col: ACOL, row: AROW, type: 'lamp', color: '#ffcc33' }

  test('the pick near the bulb selects the lamp; the ground below returns nothing', () => {
    render2DGrid(lamp)
    const b = bounds(twoDRecordedGeom(ACOL, AROW, 0))
    expect(b.h).toBeGreaterThan(CELL * 2) // the lamp reaches ~2.7 cells up
    const bulb = pickTwoDTileAt(b.cx, b.minY + 6)
    expect(bulb && { col: bulb.col, row: bulb.row }).toEqual({ col: ACOL, row: AROW })
    expect(pickTwoDTileAt(b.cx, b.maxY + 60)).toBeNull()
  })
})

describe('a zOffset-slid 2D tile — picked where it slid to on the ground plane', () => {
  const slid: GridAsset = { art: ['#'], col: ACOL, row: AROW, type: 'crate', label: 'crate', height: 1, zOffset: 3, zDir: 'right-down', color: '#abcdef' }

  test('the pick at the slid rect returns the tile; a point opposite the slide returns nothing', () => {
    render2DGrid(slid)
    const b = bounds(twoDRecordedGeom(ACOL, AROW, 0))
    const hit = pickTwoDTileAt(b.cx, b.cy)
    expect(hit && { col: hit.col, row: hit.row }).toEqual({ col: ACOL, row: AROW })
    expect(pickTwoDTileAt(b.minX - 200, b.cy)).toBeNull() // far opposite the slide — nothing there
  })
})
