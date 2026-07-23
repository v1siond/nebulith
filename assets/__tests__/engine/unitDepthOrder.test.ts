/**
 * A UNIT OBEYS PERSPECTIVE — it is a tile, so depth decides what covers what.
 *
 * The user (Image #9, hero painted over the store roof): "units z-index is wrong, is not considering the
 * front view from the cammera perspective, which mean we can see units through elements when we should't,
 * for example when they should be hidden by a building … I should be behind the building, unless my unit
 * z-index is > the building, which in this case it isn't, they're both 0, so perspective wins."
 *
 * Root cause: iso.ts drew units in a SECOND pass after every map tile, with the comment "A unit is the
 * interactive focus, so it is never hidden behind a tile (the z-index bug)" — the correct behaviour was
 * labelled a bug and coded around. `allObjects` is already depth-sorted AND already contains the units; the
 * split simply threw that ordering away for them.
 *
 * Draw order IS the assertion: the frame's hit registry is filled in draw order, so a tile nearer the camera
 * must be recorded AFTER a unit standing behind it.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { render, renderedTilesInRect } from '@/engine/render/iso'
import { IsometricGrid, type GridAsset } from '@/engine/IsometricGrid'
import { ASCII_STYLE } from '@/game/artStyle'
import type { PlayerState } from '@/game/runtime/player'
import type { Entity } from '@/game/types'

const CELL = 100, W = 900, H = 700, ISO = 1
// The hero stands BEHIND (smaller col+row = farther from the iso camera); the wall is IN FRONT of it.
const HERO_COL = 10, HERO_ROW = 10
const WALL_COL = 11, WALL_ROW = 11

const heroEntity = (): Entity => ({ id: 'hero', kind: 'player' } as unknown as Entity)
const heroPlayer = (): PlayerState =>
  ({ x: HERO_COL * CELL, z: HERO_ROW * CELL, moving: false, facing: 'down', frame: 0 } as PlayerState)

/** A tall wall tile. `art` is required — the ascii drawer reads `asset.art[0]`. */
const wallAt = (col: number, row: number): GridAsset =>
  ({ col, row, type: 'wall', tileKey: 'emoji:wall', art: ['#'], heightLevel: 0, height: 4 } as unknown as GridAsset)

/** A tall wall one cell nearer the camera than the hero — it must occlude the figure. */
const tallWall = (): GridAsset => wallAt(WALL_COL, WALL_ROW)

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

const scene = (): IsometricGrid => {
  const grid = new IsometricGrid({ cols: 30, rows: 30, cellSize: CELL, isoScale: ISO })
  grid.setAssets([tallWall()])
  return grid
}

const renderIso = (grid: IsometricGrid): void => {
  render({
    ctx: mockCtx(), w: W, h: H, grid, player: heroPlayer(), time: 0, camOffset: { x: 0, y: 0 },
    entities: [heroEntity()], enemyCombat: new Map(), hitMarkers: [], now: 0, zoom: 1, attackAnims: [],
    connectors: [], quests: [], projectiles: [], dayNight: 'day', attackReach: 1, style: ASCII_STYLE,
    clampCamera: false,
  })
}

/** `renderedTilesInRect` returns the frame's hits TOPMOST-FIRST (it walks the draw registry backwards so the
 *  frontmost tile wins a pick). So a SMALLER index means "drawn later / on top of". */
const topmostIndexOf = (hits: ReturnType<typeof renderedTilesInRect>, pred: (h: (typeof hits)[number]) => boolean): number =>
  hits.findIndex(pred)

describe('units are depth-sorted WITH the map, not painted over it', () => {
  it('draws a unit BEFORE a tile that stands in front of it (so the tile covers the figure)', () => {
    const grid = scene()
    renderIso(grid)
    const hits = renderedTilesInRect(0, 0, W, H)

    const unitAt = topmostIndexOf(hits, h => h.source === 'entity')
    const wallAt = topmostIndexOf(hits, h => h.source !== 'entity' && h.col === WALL_COL && h.row === WALL_ROW)

    expect(unitAt).toBeGreaterThanOrEqual(0)
    expect(wallAt).toBeGreaterThanOrEqual(0)
    // The wall is NEARER the camera, so it must end up ON TOP of the hero → smaller topmost-first index.
    expect(wallAt).toBeLessThan(unitAt)
  })

  it('still draws a unit AFTER the tiles behind it (it is not shoved to the back either)', () => {
    const grid = new IsometricGrid({ cols: 30, rows: 30, cellSize: CELL, isoScale: ISO })
    // A wall BEHIND the hero (smaller col+row) must be covered BY the hero.
    grid.setAssets([wallAt(HERO_COL - 1, HERO_ROW - 1)])
    renderIso(grid)
    const hits = renderedTilesInRect(0, 0, W, H)

    const unitAt = topmostIndexOf(hits, h => h.source === 'entity')
    const behindAt = topmostIndexOf(hits, h => h.source !== 'entity' && h.col === HERO_COL - 1 && h.row === HERO_ROW - 1)

    expect(behindAt).toBeGreaterThanOrEqual(0)
    // The wall is FARTHER from the camera, so the hero covers it → hero has the smaller index.
    expect(unitAt).toBeLessThan(behindAt)
  })
})
