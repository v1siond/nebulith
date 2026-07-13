/**
 * #29 — the 2D collision OVERLAY must sit ON the building's raised walls, not on the flat footprint
 * H rows below.
 *
 * draw2DBuilding draws the facade RAISED (cellTop = baseY - (H - r) * tileH); the old overlay tinted the
 * GROUNDED footprint cell (no raise), so the red block floated H rows below the walls — a gap that grew
 * with the building's height and read as "random". The fix routes BOTH the tile draw and the red overlay
 * through the ONE shared iterator forEach2DFacadeCell, so overlay-row == draw-row BY CONSTRUCTION.
 *
 * Proven here:
 *   A. the shared geometry helper yields each facade cell's RAISED cellTop + its blocking flag;
 *   B. draw2DBuildingCollision paints red on EXACTLY the tiles draw2DBuilding draws (same x + cellTop),
 *      the topmost red at the roof apex (baseY - H*tileH), none at the flat footprint row (baseY - tileH),
 *      and the walkable door column clear;
 *   C. render2D wires it in: a building's blocked footprint cells are NOT grounded-tinted (they move up
 *      onto the facade), while a non-building collision cell still tints its own flat cell.
 */
import { draw2DBuildingCollision, forEach2DFacadeCell, building2DDescriptor, render2D } from '@/engine/render/topdown'
import { IsometricGrid, type GridBuilding } from '@/engine/IsometricGrid'
import { ASCII_STYLE } from '@/game/artStyle'
import { setShowCollisions, setDebugMode } from '@/engine/render/shared'
import type { PlayerState } from '@/game/runtime/player'

const RED = 'rgba(255, 50, 50, 0.4)'

// A synthetic 4-row (multi-floor) south-facing house whose DOOR sits in its own column with EMPTY cells
// above it — so the walkable door column carries no blocking cell — and whose GROUND row is door + empty
// only, so the raised facade never grounds a wall on the footprint row. This isolates every assertion:
// roof/wall/window are the only blocking cells, stacked in columns 0 and 2.
//   r0: roof   .      roof
//   r1: wall   .      wall
//   r2: window .      window
//   r3: .      door   .            (. = empty)
function facadeHouse(): GridBuilding {
  return {
    col: 10,
    row: 10, // ground (front) row
    length: 3, // footprint col-span == facade width N
    height: 1, // footprint depth rows (the elevation is 4 rows tall via cells)
    depth: 1,
    type: 'house',
    cells: [
      ['roof', 'empty', 'roof'],
      ['wall', 'empty', 'wall'],
      ['window', 'empty', 'window'],
      ['empty', 'door', 'empty'],
    ],
    facing: 0, // south (facadeOnBack:false) → identity facade↔footprint, front shown
    facadeOnBack: false,
  }
}

// A canvas ctx mock that records every fillRect with the fillStyle live at draw time.
function recordingCtx() {
  const rects: { x: number; y: number; w: number; h: number; style: string }[] = []
  const ctx = {
    fillStyle: '#000', strokeStyle: '#000', font: '', textAlign: '' as CanvasTextAlign,
    textBaseline: '' as CanvasTextBaseline, lineWidth: 1, lineCap: '' as CanvasLineCap, globalAlpha: 1,
    save() {}, restore() {}, translate() {}, scale() {}, rotate() {}, setLineDash() {},
    beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, bezierCurveTo() {}, arc() {},
    ellipse() {}, closePath() {}, fill() {}, stroke() {}, clip() {}, rect() {}, drawImage() {},
    createLinearGradient() { return { addColorStop() {} } }, createRadialGradient() { return { addColorStop() {} } },
    fillRect(x: number, y: number, w: number, h: number) { rects.push({ x, y, w, h, style: String(this.fillStyle) }) },
    strokeRect() {}, fillText() {}, strokeText() {},
    measureText() { return { width: 10 } as TextMetrics },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, rects }
}

const key = (r: { x: number; y: number }) => `${r.x},${r.y}`

describe('#A — forEach2DFacadeCell yields each facade cell RAISED + its blocking flag', () => {
  test('cellTop = baseY - (H - r)*tileH per row; door is the only non-blocking cell; empty skipped', () => {
    const b = facadeHouse()
    const d = building2DDescriptor(b, ASCII_STYLE)
    const H = b.cells.length // 4
    const centerX = 100, baseY = 100, tileW = 10, tileH = 10

    const visits: { x: number; cellTop: number; kind: string; blocking: boolean }[] = []
    forEach2DFacadeCell(b, d, centerX, baseY, tileW, tileH, (x, cellTop, kind, blocking) =>
      visits.push({ x, cellTop, kind, blocking }),
    )

    // 4 empty cells skipped → exactly the 7 drawn surfaces, in draw order (row-major, r outer).
    expect(visits).toEqual([
      { x: 90, cellTop: baseY - (H - 0) * tileH, kind: 'roof', blocking: true }, // r0 c0
      { x: 110, cellTop: baseY - (H - 0) * tileH, kind: 'roof', blocking: true }, // r0 c2
      { x: 90, cellTop: baseY - (H - 1) * tileH, kind: 'wall', blocking: true }, // r1 c0
      { x: 110, cellTop: baseY - (H - 1) * tileH, kind: 'wall', blocking: true }, // r1 c2
      { x: 90, cellTop: baseY - (H - 2) * tileH, kind: 'window', blocking: true }, // r2 c0
      { x: 110, cellTop: baseY - (H - 2) * tileH, kind: 'window', blocking: true }, // r2 c2
      { x: 100, cellTop: baseY - (H - 3) * tileH, kind: 'door', blocking: false }, // r3 c1 (ground)
    ])
    // The door is the sole walkable surface.
    expect(visits.filter(v => !v.blocking).map(v => v.kind)).toEqual(['door'])
  })
})

describe('#C — render2D moves the footprint red up onto the facade + keeps non-building red flat', () => {
  afterEach(() => {
    setShowCollisions(false)
    setDebugMode(false)
  })

  function scene(): { grid: IsometricGrid; player: PlayerState } {
    const grid = new IsometricGrid({ cols: 40, rows: 40, cellSize: 16, isoScale: 1 })
    const b = facadeHouse()
    grid.buildings = [b]
    // The stamped collision: the two front wall cells block, the door cell stays walkable.
    grid.setCollision(10, 10, true)
    grid.setCollision(12, 10, true)
    // Player standing on the door cell so the building is centred and visible.
    const player = { x: 11 * 16, z: 10 * 16, moving: false } as PlayerState
    return { grid, player }
  }

  test('a blocked footprint cell is NOT grounded-tinted; the raised facade paints exactly 6 red', () => {
    setShowCollisions(true)
    const { grid, player } = scene()
    const { ctx, rects } = recordingCtx()

    render2D(ctx, 400, 400, grid, player, 0)

    const red = rects.filter(r => r.style === RED)
    // Exactly the 6 blocking facade cells (roof/wall/window) — the 2 blocked footprint cells were SKIPPED
    // in the flat loop (else we'd see 6 + 2 = 8) and the overlay is present (else we'd see only the 2).
    expect(red).toHaveLength(6)
    // …and they span the RAISED facade: 3 distinct y-levels (roof/wall/window), not one flat footprint row.
    expect(new Set(red.map(r => r.y)).size).toBe(3)
  })

  test('a NON-building collision cell still tints its own flat cell', () => {
    setShowCollisions(true)
    const { grid, player } = scene()
    grid.setCollision(11, 6, true) // a lone rock/tree, NOT part of the footprint
    const { ctx, rects } = recordingCtx()

    render2D(ctx, 400, 400, grid, player, 0)

    const red = rects.filter(r => r.style === RED)
    // 6 raised facade + 1 grounded non-building cell = 7 (the footprint skip is SELECTIVE, not blanket).
    expect(red).toHaveLength(7)
  })
})
