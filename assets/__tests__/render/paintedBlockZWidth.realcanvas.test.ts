/**
 * REAL-CANVAS tests for the PAINTER fix: a placed (painted) tile is a first-class iso BLOCK — for ALL tiles.
 *
 * BUG (Image #56, then reopened for height-0 decor): a painted tile whose DB block height is 0 (the "Wall" 🧱
 * tile, and every flat NATURE/DECOR tile — flower/blossom/leaf/…) rendered through the FLAT billboard path on
 * the iso side, which silently DROPPED Z-Width (directional depth), Display and shape. THE FIX (MAP-MODEL §4,
 * EDITOR-INTERACTION §11): a height-0 tile now renders through the SAME block path as every tile — as a
 * MINIMAL-height THIN SLAB (the floor's FLOOR_SLAB_SCALE_Y model), never a billboard — so it looks flat while
 * Z-Width/display/shape/scale ALL apply. Only a UNIT is a billboard (a different render path).
 *
 * These render drawIsoAssetAscii to @napi-rs/canvas and read the PIXELS (extrusion coverage) AND assert the
 * returned TileGeom: a height-0 tile returns a CUBE geom (the thin slab / block path), never a billboard poly.
 */
import { installRealCanvas, type RealCanvasHarness } from '@/__tests__/helpers/realCanvas'
import { drawIsoAssetAscii } from '@/engine/render/iso'
import { EMOJI_STYLE } from '@/game/artStyle'
import { EMOJI_TILESET } from '@/engine/tileset/emojiTileset'
import type { GridAsset } from '@/engine/IsometricGrid'
import type { Canvas } from '@napi-rs/canvas'

let H: RealCanvasHarness

const GREEN = '#00c800'
const SRC = '/tiles/emoji/__probe_wall.png'
const OVERRIDE = 'emoji:__probe_wall__'
const TW = 30, TH = 15
const CX = 150, CY = 235 // base diamond centre — room UP-RIGHT (higher x, lower y) for a right-up depth box

// A PAINTED flat tile: no `label` (so it takes the non-label asset path), a pinned tileOverride (→ the baked
// image), and the real minimal FLAT height (0.1 — a flat tile's DB block-height, drawn as a thin slab).
// `blocking` mirrors the brush.
const paintedWall = (over: Partial<GridAsset>): GridAsset => ({
  art: ['🧱'], col: 4, row: 4, type: 'building', height: 0.1, blocking: true, tileOverride: OVERRIDE, ...over,
})

beforeAll(async () => {
  H = installRealCanvas().harness
  EMOJI_TILESET['__probe_wall__'] = { char: '🧱', color: '#b0603a', image: SRC }
  H.registerSolid(SRC, GREEN)
  await H.warm([SRC])
})
afterAll(() => { delete EMOJI_TILESET['__probe_wall__'] })

/** Count clearly-GREEN opaque pixels in a sub-rect (the baked tile's presence signal). */
function regionGreen(canvas: Canvas, x: number, y: number, w: number, h: number): number {
  const { data } = canvas.getContext('2d').getImageData(x, y, w, h)
  let green = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    if (data[i + 1] > data[i] + 40 && data[i + 1] > data[i + 2] + 40) green++
  }
  return green
}

/** Bounding box of GREEN pixels over the whole canvas: total count + vertical extent (maxY-minY). The
 *  vertical extent is the tile's SILHOUETTE HEIGHT — a real extruded block is measurably TALLER than a
 *  flat face. */
function greenBBox(canvas: Canvas): { count: number; vExtent: number } {
  const { width, height } = canvas
  const { data } = canvas.getContext('2d').getImageData(0, 0, width, height)
  let count = 0, minY = height, maxY = -1
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4
    if (data[i + 3] < 128) continue
    if (data[i + 1] > data[i] + 40 && data[i + 1] > data[i + 2] + 40) { count++; if (y < minY) minY = y; if (y > maxY) maxY = y }
  }
  return { count, vExtent: maxY < 0 ? 0 : maxY - minY }
}
const draw = (asset: GridAsset): Canvas => {
  const cv = H.makeCanvas(360, 320)
  drawIsoAssetAscii(cv.getContext('2d') as unknown as CanvasRenderingContext2D, CX, CY, asset, TW, TH, 0, false, 'day', EMOJI_STYLE)
  return cv
}
/** Same draw, but return the TileGeom drawIsoAssetAscii reports (the block path returns a CUBE geom; a billboard
 *  returns a poly). Lets us assert the RENDER PATH, not just pixels. */
const drawGeom = (asset: GridAsset) => {
  const cv = H.makeCanvas(360, 320)
  return drawIsoAssetAscii(cv.getContext('2d') as unknown as CanvasRenderingContext2D, CX, CY, asset, TW, TH, 0, false, 'day', EMOJI_STYLE)
}
/** The extruded on-screen height (px) of a CUBE geom: base-back.y − top-back.y. 0 for a non-cube (billboard). */
const cubeExtrudePx = (asset: GridAsset): number => {
  const g = drawGeom(asset)
  return g && g.kind === 'cube' ? g.base[1].y - g.top[1].y : 0
}

describe('a painted base-height-0 tile honours Z-Width by extruding into a real iso block', () => {
  test('Z-Width (depth) makes it a BLOCK that reaches up-right — the flat face does not', () => {
    const flat = draw(paintedWall({}))                                  // no Z-Width → flat billboard
    const extruded = draw(paintedWall({ depth: 5, depthDir: 'right-up' })) // Z-Width 5 → extruded depth-box

    // The UP-RIGHT region (well past the base cell toward the depth direction) is EMPTY for the flat face
    // but FILLED by the extruded box — the extrusion is the visible fix.
    const UP_RIGHT = { x: CX + TW + 20, y: CY - TH - 60, w: 60, h: 55 }
    const flatUR = regionGreen(flat, UP_RIGHT.x, UP_RIGHT.y, UP_RIGHT.w, UP_RIGHT.h)
    const extrudedUR = regionGreen(extruded, UP_RIGHT.x, UP_RIGHT.y, UP_RIGHT.w, UP_RIGHT.h)
    expect(flatUR).toBe(0)               // the flat 2D face never reaches up-right
    expect(extrudedUR).toBeGreaterThan(0) // the extruded block does

    // And overall the extruded block covers substantially MORE of the canvas than the flat face.
    const flatAll = regionGreen(flat, 0, 0, 360, 320)
    const extrudedAll = regionGreen(extruded, 0, 0, 360, 320)
    expect(extrudedAll).toBeGreaterThan(flatAll * 1.4)
  })

  test('larger Z-Width extrudes FURTHER (depth-6 covers more than depth-3)', () => {
    const d3 = regionGreen(draw(paintedWall({ depth: 3, depthDir: 'right-up' })), 0, 0, 360, 320)
    const d6 = regionGreen(draw(paintedWall({ depth: 6, depthDir: 'right-up' })), 0, 0, 360, 320)
    expect(d6).toBeGreaterThan(d3)
  })

  test('no Z-Width + base height 0 renders as a THIN SLAB through the block path (NOT a flat billboard)', () => {
    // THE FIX: a height-0 tile is no longer a flat 2D billboard — it goes through the SAME block path as every
    // tile and returns a CUBE geom (a billboard would be a poly). It is a MINIMAL-height slab: a real (thin)
    // block, far shorter than a full height-1 cube — so it looks FLAT, not a tall cube.
    const geom = drawGeom(paintedWall({}))
    expect(geom?.kind).toBe('cube') // the block/slab path, not billboardGeom (which is kind 'poly')

    const slabPx = cubeExtrudePx(paintedWall({}))       // the thin slab's extruded height
    const cubePx = cubeExtrudePx(paintedWall({ height: 1 })) // a full 1-block cube
    expect(slabPx).toBeGreaterThan(0)          // it HAS height — a real slab, not a zero-height overlay
    expect(slabPx).toBeLessThan(cubePx * 0.4)  // …but far thinner than a full cube (the floor-slab look)

    // A flat slab does not extrude a tall side-face column far below the base diamond (it stays flat).
    const flat = draw(paintedWall({}))
    const belowBase = regionGreen(flat, CX - TW, CY + TH + 10, 2 * TW, 40)
    expect(belowBase).toBe(0)
  })
})

// THE FIX for the painter bug: the whole-object building tiles (wall/house/castle) carry a DB block height >= 1
// again (the height had DRIFTED to 0). So a PAINTED wall is an all-faces 3D block the moment it lands — with
// NO Z-Width and NO manual height edit. These render a height-1 painted wall (depth unset) and prove it is a
// taller, higher-coverage BLOCK than the genuinely-flat height-0 face.
describe('a painted tile with DB block height >= 1 renders as an all-faces BLOCK without any Z-Width', () => {
  test('height 1 (no z-width) is a TALLER, higher-coverage cube than the flat height-0 thin slab', () => {
    const flat = greenBBox(draw(paintedWall({ height: 0 })))       // height-0 tile → a THIN slab (block path)
    const block = greenBBox(draw(paintedWall({ height: 1 })))      // DB block tile → a full extruded cube, NO depth

    expect(block.vExtent).toBeGreaterThan(flat.vExtent)            // the full cube silhouette is measurably taller
    expect(block.count).toBeGreaterThan(flat.count * 1.3)          // a full cube's faces cover far more than the thin slab
  })

  test('the full cube paints a taller side-face COLUMN than the thin slab (both are blocks, cube is deeper)', () => {
    // Directly under-left of the base diamond is the block's LEFT side face — a tall column for the full cube,
    // only a thin sliver for the height-0 slab (which is a flat, minimal-height block, not a billboard).
    const SIDE = { x: CX - TW, y: CY - TH, w: TW, h: TH + 24 }
    const slabSide = regionGreen(draw(paintedWall({ height: 0 })), SIDE.x, SIDE.y, SIDE.w, SIDE.h)
    const blockSide = regionGreen(draw(paintedWall({ height: 1 })), SIDE.x, SIDE.y, SIDE.w, SIDE.h)
    expect(blockSide).toBeGreaterThan(0)  // the full cube has a tall visible side face
    expect(blockSide).toBeGreaterThan(slabSide)
  })
})
