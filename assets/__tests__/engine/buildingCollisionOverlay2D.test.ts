/**
 * De-segmented buildings: the 2D collision overlay is now GENERIC. A building's blocked cells tint on their
 * OWN grounded squares exactly like any collision cell (a rock/tree) — there is no raised-facade overlay and
 * render2D never reads a grouped-building array. A stamped building composition blocks only the WALL cells (a
 * hollow shell), so the tint reads as the building's shell with the walkable door + interior left clear.
 *
 * Proven here:
 *   A. every blocked footprint cell paints exactly ONE grounded red square (no facade raising, no doubling);
 *   B. a NON-building collision cell adds exactly one more red — buildings are not a special case.
 */
import '@/__tests__/helpers/installTilesetSeed' // render2D paints ground + building compositions from the loaded backend tileset fixture
import { render2D } from '@/engine/render/topdown'
import { IsometricGrid } from '@/engine/IsometricGrid'
import { stampBuildingComposition } from '@/game/runtime/composition'
import { setShowCollisions, setDebugMode } from '@/engine/render/shared'
import type { PlayerState } from '@/game/runtime/player'

const RED = 'rgba(255, 50, 50, 0.4)'

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

// Count the blocked cells the overlay iterates — the ground truth the red squares mirror.
function blockedCount(grid: IsometricGrid): number {
  let n = 0
  for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) if (grid.collision[r]?.[c]) n++
  return n
}

describe('2D collision overlay — a building tints like any grounded cell (no facade special case)', () => {
  afterEach(() => {
    setShowCollisions(false)
    setDebugMode(false)
  })

  // A real stamped house near the centre so its whole footprint is inside the (large) viewport.
  function scene(): { grid: IsometricGrid; player: PlayerState } {
    const grid = new IsometricGrid({ cols: 40, rows: 40, cellSize: 16, isoScale: 1 })
    stampBuildingComposition(grid, 'house', 4, 16, 16, 'spring', 'south') // footprint top-left (16,16), 4×4
    const player = { x: 19 * 16, z: 24 * 16, moving: false } as PlayerState
    return { grid, player }
  }

  test('#A — every blocked footprint cell paints exactly ONE grounded red square', () => {
    setShowCollisions(true)
    const { grid, player } = scene()
    const blocked = blockedCount(grid)
    expect(blocked).toBeGreaterThan(0) // the stamped hollow shell blocks its wall cells

    const { ctx, rects } = recordingCtx()
    render2D({ ctx, w: 800, h: 800, grid, player, time: 0 })

    const red = rects.filter(r => r.style === RED)
    // One grounded red per blocked cell — NOT raised H rows onto a facade, NOT doubled. Buildings are just tiles.
    expect(red).toHaveLength(blocked)
  })

  test('#B — a NON-building collision cell adds exactly one more red', () => {
    setShowCollisions(true)
    const { grid, player } = scene()

    const before = recordingCtx()
    render2D({ ctx: before.ctx, w: 800, h: 800, grid, player, time: 0 })
    const redBefore = before.rects.filter(r => r.style === RED).length

    grid.setCollision(19, 12, true) // a lone rock, NOT part of the building's footprint
    const after = recordingCtx()
    render2D({ ctx: after.ctx, w: 800, h: 800, grid, player, time: 0 })
    const redAfter = after.rects.filter(r => r.style === RED).length

    // The rock tints its own flat cell exactly like a wall cell does → +1, no building-only carve-out.
    expect(redAfter).toBe(redBefore + 1)
  })
})
