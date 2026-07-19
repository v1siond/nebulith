/**
 * INVERTED ISO PICK (end-to-end) — the selector picks the TILE the user SEES and cascades to its cell.
 *
 * render() records every drawn tile's transform-aware silhouette (isoTileHits); pickIsoTileAt hit-tests THAT,
 * so a click on a TALL / slid / lifted / extruded tile selects the tile at its ON-SCREEN position, and a click
 * on the now-visually-empty ground BELOW it does NOT. These render with the deterministic clamp-free camera
 * (cellSize 100, isoScale 1 → tileW 71, tileH 36, camX=player.x) so every expected pixel is exact.
 *
 * The old CELL-FIRST picker (pickIsoBlocksAll) inverts only the flat diamond and uses a FIXED block height, so
 * it MISSES a tile grown by scaleY — asserted here (red for the old path, green for the new one).
 */
import '@/__tests__/helpers/installTilesetSeed'
import {
  render, pickIsoTileAt, pickIsoTilesAt, isoRecordedGeom, pickIsoBlocksAll,
  ISO_BLOCK_H_FRAC, type IsoPickCamera, type IsoPickBlock,
} from '@/engine/render/iso'
import { IsometricGrid, type GridAsset } from '@/engine/IsometricGrid'
import { ASCII_STYLE } from '@/game/artStyle'
import type { PlayerState } from '@/game/runtime/player'
import type { DepthDir } from '@/engine/render/isoBlock'

const CELL = 100, W = 800, H = 600, ISO = 1
const TILE_W = CELL * ISO * 0.71, TILE_H = CELL * ISO * 0.36
const PCOL = 10, PROW = 10, ACOL = 12, AROW = 10
const player = (): PlayerState => ({ x: PCOL * CELL, z: PROW * CELL, moving: false } as PlayerState)

// The render's own iso projection of a cell centre (clampCamera false → camX=player.x, no clamp).
const cellOrigin = (col: number, row: number): { x: number; y: number } => {
  const wx = col * CELL - PCOL * CELL
  const wz = row * CELL - PROW * CELL
  return { x: W / 2 + (wx - wz) * ISO * 0.71, y: H / 2 + (wx + wz) * ISO * 0.36 }
}

// A no-op recording ctx (the tile GEOMETRY the pick reads is independent of the pixels drawn).
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

const gridWith = (asset: GridAsset): IsometricGrid => {
  const grid = new IsometricGrid({ cols: 30, rows: 30, cellSize: CELL, isoScale: ISO })
  grid.setAssets([asset])
  return grid
}

// Render iso once so isoTileHits is populated for the pick to read (clampCamera FALSE → deterministic camera).
const renderIso = (grid: IsometricGrid): void => {
  render({ ctx: mockCtx(), w: W, h: H, grid, player: player(), time: 0, camOffset: { x: 0, y: 0 }, entities: [], enemyCombat: new Map(), hitMarkers: [], now: 0, zoom: 1, attackAnims: [], connectors: [], quests: [], projectiles: [], dayNight: 'day', attackReach: 1, style: ASCII_STYLE, clampCamera: false })
}

describe('a TALL (scaleY) block — picked at its lifted top, not the ground below', () => {
  const SCALE_Y = 5
  const labeledTallBlock: GridAsset = { art: ['#'], col: ACOL, row: AROW, type: 'wall', label: 'wall', height: 1, scaleY: SCALE_Y, color: '#8a8a8a' }

  test('the pick at the tile\'s lifted top returns THAT tile + its cell', () => {
    renderIso(gridWith(labeledTallBlock))
    const o = cellOrigin(ACOL, AROW)
    const bh = TILE_W * ISO_BLOCK_H_FRAC * SCALE_Y // the block extrudes 5× up
    const highOnTile = { x: o.x, y: o.y - bh * 0.75 } // well up the tall tile — only reachable BECAUSE it's tall
    const hit = pickIsoTileAt(highOnTile.x, highOnTile.y)
    expect(hit).not.toBeNull()
    expect({ col: hit!.col, row: hit!.row, level: hit!.level }).toEqual({ col: ACOL, row: AROW, level: 0 })
  })

  test('the pick on the now-empty ground BELOW the tile returns nothing', () => {
    renderIso(gridWith(labeledTallBlock))
    const o = cellOrigin(ACOL, AROW)
    expect(pickIsoTileAt(o.x, o.y + TILE_H + 120)).toBeNull() // well below the base diamond
  })

  test('the recorded silhouette is a cube extruded ~scaleY·blockH — a cell-first fixed cube never is', () => {
    renderIso(gridWith(labeledTallBlock))
    const g = isoRecordedGeom(ACOL, AROW, 0)
    expect(g?.kind).toBe('cube')
    if (g?.kind !== 'cube') throw new Error('expected cube')
    const o = cellOrigin(ACOL, AROW)
    const topY = Math.min(...g.top.map(p => p.y))
    // top sits ~scaleY·blockH above the base — a fixed-height (scaleY-ignoring) cube would be ~1·blockH.
    expect(o.y - topY).toBeGreaterThan(TILE_W * ISO_BLOCK_H_FRAC * (SCALE_Y - 1))
  })

  test('RED for the old cell-first picker: it MISSES the pixel the inverted picker HITS', () => {
    renderIso(gridWith(labeledTallBlock))
    const o = cellOrigin(ACOL, AROW)
    const bh = TILE_W * ISO_BLOCK_H_FRAC * SCALE_Y
    const highOnTile = { x: o.x, y: o.y - bh * 0.75 }
    // The old picker: a fixed-height cube for this cell (scaleY ignored) — reproduces the pre-inversion path.
    const cam: IsoPickCamera = { w: W, h: H, cellSize: CELL, isoScale: ISO, camX: PCOL * CELL, camZ: PROW * CELL }
    const oldBlock: IsoPickBlock = { col: ACOL, row: AROW, heightLevel: 0, terrainHeight: 0 }
    expect(pickIsoBlocksAll(highOnTile.x, highOnTile.y, [oldBlock], cam)).toHaveLength(0) // OLD: miss
    expect(pickIsoTileAt(highOnTile.x, highOnTile.y)).not.toBeNull()                       // NEW: hit
  })
})

describe('a zOffset-slid block — picked where it slid to, not at its cell origin', () => {
  const dir: DepthDir = 'right-down'
  const slid: GridAsset = { art: ['#'], col: ACOL, row: AROW, type: 'crate', label: 'crate', height: 1, scaleY: 2, zOffset: 3, zDir: dir, color: '#abcdef' }

  test('the pick follows the diagonal slide; the un-slid cell origin returns nothing', () => {
    renderIso(gridWith(slid))
    const o = cellOrigin(ACOL, AROW)
    const bh = TILE_W * ISO_BLOCK_H_FRAC * 2
    // right-down = +col = (+tileW,+tileH) per cell → slid 3 cells down-right; sample mid-height on the slid tile.
    const slidPoint = { x: o.x + 3 * TILE_W, y: o.y + 3 * TILE_H - bh / 2 }
    const hit = pickIsoTileAt(slidPoint.x, slidPoint.y)
    expect(hit && { col: hit.col, row: hit.row }).toEqual({ col: ACOL, row: AROW })
    expect(pickIsoTileAt(o.x, o.y)).toBeNull() // the tile slid AWAY from its cell origin
  })
})

describe('a directional-depth box — picked along its extruded length', () => {
  const box: GridAsset = { art: ['#'], col: ACOL, row: AROW, type: 'wall', label: 'wall', height: 1, depth: 4, depthDir: 'right-down', color: '#8a8a8a' }

  test('hit along the length; miss in the opposite direction; geom is the box hull (poly)', () => {
    renderIso(gridWith(box))
    const o = cellOrigin(ACOL, AROW)
    const along = pickIsoTileAt(o.x + 2 * TILE_W, o.y + 2 * TILE_H) // 2 cells down the right-down length
    expect(along && { col: along.col, row: along.row }).toEqual({ col: ACOL, row: AROW })
    expect(pickIsoTileAt(o.x - 3 * TILE_W, o.y)).toBeNull()          // opposite direction — nothing there
    expect(isoRecordedGeom(ACOL, AROW, 0)?.kind).toBe('poly')
  })
})

describe('an ASCII per-type sprite (a lamp) — picked at its lifted bulb, not the post base', () => {
  const lamp: GridAsset = { art: ['|'], col: ACOL, row: AROW, type: 'lamp', color: '#ffcc33' }

  test('the pick at the lifted bulb selects the lamp; the ground below returns nothing', () => {
    renderIso(gridWith(lamp))
    const o = cellOrigin(ACOL, AROW)
    const lineHeight = TILE_H * 1.3
    const bulb = { x: o.x, y: o.y - lineHeight * 2 } // up among the 3 stacked lamp layers (the bulb region)
    const hit = pickIsoTileAt(bulb.x, bulb.y)
    expect(hit && { col: hit.col, row: hit.row }).toEqual({ col: ACOL, row: AROW })
    expect(pickIsoTileAt(o.x, o.y + TILE_H + 100)).toBeNull()
  })
})

describe('overlap resolution — the topmost (last-drawn) tile wins', () => {
  test('two stacked blocks: the pick returns the higher level under the pixel', () => {
    const grid = new IsometricGrid({ cols: 30, rows: 30, cellSize: CELL, isoScale: ISO })
    grid.setAssets([
      { art: ['#'], col: ACOL, row: AROW, type: 'wall', label: 'wall', height: 1, color: '#777', heightLevel: 0 },
      { art: ['#'], col: ACOL, row: AROW, type: 'wall', label: 'wall', height: 1, color: '#999', heightLevel: 1 },
    ])
    renderIso(grid)
    const all = pickIsoTilesAt(cellOrigin(ACOL, AROW).x, cellOrigin(ACOL, AROW).y - TILE_W * ISO_BLOCK_H_FRAC * 0.5)
    expect(all.length).toBeGreaterThanOrEqual(1)
    expect(all[0].level).toBe(1) // the upper block is drawn last / on top → frontmost pick
  })
})
