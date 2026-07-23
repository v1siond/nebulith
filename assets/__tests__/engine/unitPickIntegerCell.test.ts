/**
 * A UNIT IS A TILE — but a unit's POSITION is CONTINUOUS while a tile's col/row is a GRID INDEX.
 *
 * The iso pick registry records every drawn unit so a click on the figure selects the unit (units-as-tiles).
 * The player object is built as `col: player.x / cellSize` (iso.ts) — a FRACTION the moment the hero steps off
 * a whole cell — and a walking NPC uses the interpolated `entityRenderCell`. If that fraction is recorded as
 * the hit's col/row it flows into the selection KEY ("15.849862000000009,8.34,-1"); every LATER frame
 * re-parses that key and calls `grid.getHeight(col, row)`, which indexes `height[row][col]` — `height[8.34]`
 * is `undefined`, so the renderer throws:
 *
 *   Cannot read properties of undefined (reading '15.849862000000009')
 *
 * Reported by the user: "happen when selecting a user then moving".
 *
 * The boundary rule: a continuous position becomes a CELL INDEX at the moment it is recorded as a tile hit.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { render, renderedTilesInRect } from '@/engine/render/iso'
import { IsometricGrid } from '@/engine/IsometricGrid'
import { ASCII_STYLE } from '@/game/artStyle'
import type { PlayerState } from '@/game/runtime/player'
import type { Entity } from '@/game/types'

const CELL = 100, W = 800, H = 600, ISO = 1
// The hero mid-stride: the exact fractional column from the user's crash report.
const FRAC_COL = 15.849862000000009, FRAC_ROW = 8.34

const heroEntity = (): Entity => ({ id: 'hero', kind: 'player' } as unknown as Entity)
// `facing`/`frame` are required by getPlayerArt — without them the hero never draws, so the hit is never recorded.
const movingPlayer = (): PlayerState =>
  ({ x: FRAC_COL * CELL, z: FRAC_ROW * CELL, moving: true, facing: 'down', frame: 0 } as PlayerState)

/** A no-op recording ctx — the tile GEOMETRY the pick reads is independent of the pixels drawn. */
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

const newGrid = (): IsometricGrid => new IsometricGrid({ cols: 30, rows: 30, cellSize: CELL, isoScale: ISO })

/** Render iso once (deterministic clamp-free camera) so the hit registry is populated. */
const renderIso = (grid: IsometricGrid, selectedCells?: ReadonlySet<string>): void => {
  render({
    ctx: mockCtx(), w: W, h: H, grid, player: movingPlayer(), time: 0, camOffset: { x: 0, y: 0 },
    entities: [heroEntity()], enemyCombat: new Map(), hitMarkers: [], now: 0, zoom: 1, attackAnims: [],
    connectors: [], quests: [], projectiles: [], dayNight: 'day', attackReach: 1, style: ASCII_STYLE,
    clampCamera: false, selectedCells,
  })
}

/** The unit's entry in the frame's pick registry. */
const unitHit = () => renderedTilesInRect(0, 0, W, H).find(t => t.source === 'entity')

describe('a moving unit records a CELL, not its continuous position', () => {
  it('records integer col/row for the hero mid-stride', () => {
    const grid = newGrid()
    renderIso(grid)

    const hit = unitHit()
    expect(hit).toBeDefined()
    expect(Number.isInteger(hit!.col)).toBe(true)
    expect(Number.isInteger(hit!.row)).toBe(true)
    expect(hit!.col).toBe(Math.floor(FRAC_COL))
    expect(hit!.row).toBe(Math.floor(FRAC_ROW))
  })

  it('re-renders without throwing when that moving unit is SELECTED (the reported crash)', () => {
    const grid = newGrid()
    renderIso(grid)

    const hit = unitHit()!
    // The selection key the editor stores for a picked tile: "col,row,stackIndex".
    const key = `${hit.col},${hit.row},${hit.stackIndex}`

    expect(() => renderIso(grid, new Set([key]))).not.toThrow()
  })

  it('re-renders without throwing when that moving unit is HOVERED', () => {
    const grid = newGrid()
    renderIso(grid)
    const hit = unitHit()!

    expect(() => render({
      ctx: mockCtx(), w: W, h: H, grid, player: movingPlayer(), time: 0, camOffset: { x: 0, y: 0 },
      entities: [heroEntity()], enemyCombat: new Map(), hitMarkers: [], now: 0, zoom: 1, attackAnims: [],
      connectors: [], quests: [], projectiles: [], dayNight: 'day', attackReach: 1, style: ASCII_STYLE,
      clampCamera: false, hoveredCell: { col: hit.col, row: hit.row, stackIndex: hit.stackIndex },
    })).not.toThrow()
  })
})

describe('getHeight is total over its declared bounds', () => {
  it('returns a number instead of throwing for a fractional coordinate', () => {
    const grid = newGrid()
    expect(() => grid.getHeight(FRAC_COL, FRAC_ROW)).not.toThrow()
    expect(typeof grid.getHeight(FRAC_COL, FRAC_ROW)).toBe('number')
  })

  it('reads the cell a fractional coordinate falls inside', () => {
    const grid = newGrid()
    grid.setHeight(Math.floor(FRAC_COL), Math.floor(FRAC_ROW), 3)
    expect(grid.getHeight(FRAC_COL, FRAC_ROW)).toBe(3)
  })

  // setHeight sits behind the SAME range-only guard and writes height[row][col] — the identical landmine.
  it('setHeight writes the cell a fractional coordinate falls inside instead of throwing', () => {
    const grid = newGrid()
    expect(() => grid.setHeight(FRAC_COL, FRAC_ROW, 2)).not.toThrow()
    expect(grid.getHeight(Math.floor(FRAC_COL), Math.floor(FRAC_ROW))).toBe(2)
  })
})
