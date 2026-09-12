/**
 * A STEP IN THE GROUND SHOWS A CLIFF FACE.
 *
 * Alexander, 2026-09-12: *"we need to have support for different levels of terrain, relieve in spanish"*, and on
 * the mountain forest: *"it doesn't have cliff, nor anything, it's basically just a meadow"*.
 *
 * The grid has carried a per-cell height from the beginning, and iso drew the ground lifted by it while drawing
 * NOTHING down the side of the step, so a raised region looked like a floating slab. `drawGridSkirt` already
 * knew how to draw a vertical face (that is what the map's outer body is), it just only ever did it at the edge
 * of the map.
 *
 * THE TRAP THIS FILE PINS DOWN, because I nearly shipped it. There are two vertical scales in iso:
 *
 *   · `heightStep = cellSize * isoScale * 0.4`, how far ONE elevation level lifts a tile
 *   · `blockH     = tileW * ISO_BLOCK_H_FRAC`, the height of one BLOCK, and ~1.6x larger
 *
 * The slab is drawn at the block scale and stays that way. A cliff drawn at that scale would not reach the
 * ground tile it holds up, and every step would show a seam. So the faces below assert the exact drop, not
 * merely that something was drawn.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { drawGridSkirt } from '@/engine/render/iso'
import { IsometricGrid } from '@/engine/IsometricGrid'

const TILE_W = 40
const TILE_H = 20
/** Deliberately NOT tileW * 0.9 (= 36, the block scale), so a regression to the wrong scale cannot pass. */
const HEIGHT_STEP = 17
const BLOCK_H = TILE_W * 0.9

type Quad = { color: string; pts: Array<{ x: number; y: number }> }

/** A canvas that REMEMBERS. The no-op stub the other iso tests use would record nothing to assert on. */
function recordingCtx(out: Quad[]): CanvasRenderingContext2D {
  let pts: Array<{ x: number; y: number }> = []
  let color = ''
  const ctx = {
    strokeStyle: '#000', font: '', lineWidth: 1, globalAlpha: 1,
    get fillStyle() { return color },
    set fillStyle(v: string) { color = v },
    save() {}, restore() {}, rotate() {}, translate() {}, scale() {}, setLineDash() {},
    transform() {}, setTransform() {}, resetTransform() {},
    getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } },
    beginPath() { pts = [] },
    moveTo(x: number, y: number) { pts.push({ x, y }) },
    lineTo(x: number, y: number) { pts.push({ x, y }) },
    quadraticCurveTo() {}, bezierCurveTo() {}, arc() {}, ellipse() {}, closePath() {},
    fill() { out.push({ color, pts: [...pts] }) },
    stroke() {}, clip() {}, rect() {}, drawImage() {},
    createLinearGradient() { return { addColorStop() {} } },
    createRadialGradient() { return { addColorStop() {} } },
    createPattern() { return null }, putImageData() {}, getImageData() { return { data: [] } },
    fillRect() {}, strokeRect() {}, fillText() {}, strokeText() {},
    measureText() { return { width: 10 } as TextMetrics },
  }
  return ctx as unknown as CanvasRenderingContext2D
}

const toScreen = (col: number, row: number) => ({ x: 500 + (col - row) * TILE_W, y: 200 + (col + row) * TILE_H })

/**
 * A floored map. `slabBlocks: 0` is what isolates a cliff: with no body, every face at the EDGE of the map
 * drops zero and is skipped, so whatever is left on the canvas is a step in the ground and nothing else.
 */
function floored(slabBlocks: number): IsometricGrid {
  const grid = new IsometricGrid({ cols: 20, rows: 20, cellSize: 100, isoScale: 1, slabBlocks })
  for (let row = 0; row < 20; row++) {
    for (let col = 0; col < 20; col++) grid.setGround(col, row, 'grass')
  }
  return grid
}

/** Only the vertical faces: four points, with the two side edges truly vertical. */
function faces(out: Quad[]): Array<Quad & { drop: number }> {
  return out
    .filter(q => q.pts.length === 4 && q.pts[0].x === q.pts[3].x && q.pts[1].x === q.pts[2].x)
    .map(q => ({ ...q, drop: q.pts[3].y - q.pts[0].y }))
    .filter(q => q.drop > 0)
}

function skirt(grid: IsometricGrid): Array<Quad & { drop: number }> {
  const out: Quad[] = []
  drawGridSkirt(recordingCtx(out), grid, toScreen, TILE_W, TILE_H, 10, 10, 15, HEIGHT_STEP)
  return faces(out)
}

/** A 3x3 plateau, so its +col and +row rims each face open ground. */
function plateau(grid: IsometricGrid, level: number): void {
  for (let row = 5; row <= 7; row++) {
    for (let col = 5; col <= 7; col++) grid.setHeight(col, row, level)
  }
}

describe('a step in the ground draws a cliff face', () => {
  it('draws NOTHING on flat ground with no body, no phantom faces anywhere', () => {
    expect(skirt(floored(0))).toEqual([])
  })

  it('walls the rim of a plateau and leaves its INSIDE alone', () => {
    const grid = floored(0)
    plateau(grid, 2)
    // Three cells along the +col rim, three along the +row rim. The middle of the plateau has neighbours at its
    // own level, so it draws nothing: a cliff is a DIFFERENCE, not a property of being high up.
    expect(skirt(grid)).toHaveLength(6)
  })

  it('drops each face exactly ONE LEVEL PER STEP, at the tile scale and not the block scale', () => {
    const grid = floored(0)
    plateau(grid, 1)
    const drops = new Set(skirt(grid).map(f => f.drop))
    expect([...drops]).toEqual([HEIGHT_STEP])
    expect(drops.has(BLOCK_H)).toBe(false) // the seam bug: a cliff at the block scale is ~1.6x too tall
  })

  it('doubles the face when the step is two levels, so relief reads as its real depth', () => {
    const one = floored(0); plateau(one, 1)
    const two = floored(0); plateau(two, 2)
    expect(new Set(skirt(two).map(f => f.drop))).toEqual(new Set([2 * HEIGHT_STEP]))
    expect(skirt(two)).toHaveLength(skirt(one).length) // the same rim, drawn deeper
  })

  it('hangs the face from the TOP of the raised cell, so it meets the ground it holds up', () => {
    const grid = floored(0)
    plateau(grid, 2)
    // The +col rim cell (7, 6): its right face runs from the diamond's bottom corner to its right corner,
    // both lifted by the cell's own elevation. A face hung from y=0 instead would float.
    const p = toScreen(7, 6)
    const top = { x: p.x, y: p.y - 2 * HEIGHT_STEP }
    const hit = skirt(grid).find(f => f.pts[0].x === top.x && f.pts[0].y === top.y + TILE_H)
    expect(hit).toBeDefined()
    expect(hit!.pts[1]).toEqual({ x: top.x + TILE_W, y: top.y })
    expect(hit!.drop).toBe(2 * HEIGHT_STEP)
  })

  it('leaves a hole in the ground showing a face too, since a pit is a step the other way', () => {
    const grid = floored(0)
    grid.setHeight(9, 9, -2) // dug out, the river bed case
    // Its +col and +row NEIGHBOURS now stand two levels above it, so they are the ones that show a wall.
    const drops = skirt(grid).map(f => f.drop)
    expect(drops).toEqual([2 * HEIGHT_STEP, 2 * HEIGHT_STEP])
  })
})

describe('the map BODY is unchanged by any of this', () => {
  it('still draws the outer edge at the BLOCK scale, which is a different ruler on purpose', () => {
    const drops = new Set(skirt(floored(1)).map(f => f.drop))
    expect([...drops]).toEqual([BLOCK_H])
  })

  it('draws the body AND the cliffs together, each at its own scale', () => {
    const grid = floored(1)
    plateau(grid, 2)
    const drops = new Set(skirt(grid).map(f => f.drop))
    expect(drops.has(BLOCK_H)).toBe(true)
    expect(drops.has(2 * HEIGHT_STEP)).toBe(true)
  })
})
