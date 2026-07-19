/**
 * REAL-CANVAS tests for the PAINTER fix: a placed (painted) tile is a first-class iso BLOCK.
 *
 * BUG (Image #56): a painted tile whose DB block height is 0 (e.g. the "Wall" 🧱 tile) rendered through the
 * FLAT billboard path on the iso side, which silently DROPPED Z-Width (directional depth) and Display — so
 * setting Z-Width = 3 still drew a flat 2D face ("2d logic on the isometric side"). Z-Width is a 3D BLOCK
 * operation: once set, the iso render MUST extrude the tile into a real depth-box, regardless of base height.
 *
 * These render drawIsoAssetAscii to @napi-rs/canvas and read the PIXELS:
 *   • base height 0, no Z-Width → the flat billboard (baseline), and
 *   • base height 0 + Z-Width (depth>1, dir right-up) → an EXTRUDED iso box that reaches UP-RIGHT along the
 *     diagonal and covers far more of the canvas than the flat face (the extrusion the user wants).
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

// A PAINTED wall: no `label` (so it takes the non-label asset path), a pinned tileOverride (→ the baked
// image), and an EXPLICIT base height 0 (the "Wall" DB tile). `blocking` mirrors the brush.
const paintedWall = (over: Partial<GridAsset>): GridAsset => ({
  art: ['🧱'], col: 4, row: 4, type: 'building', height: 0, blocking: true, tileOverride: OVERRIDE, ...over,
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

  test('no Z-Width + base height 0 stays a FLAT billboard (no regression to genuinely-flat tiles)', () => {
    // The flat face is a compact upright sprite around the base cell; it must NOT paint a side-face column
    // below the base diamond (that would mean it wrongly extruded).
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
  test('height 1 (no z-width) is a TALLER, higher-coverage cube than the flat height-0 face', () => {
    const flat = greenBBox(draw(paintedWall({ height: 0 })))       // genuinely-flat tile → billboard
    const block = greenBBox(draw(paintedWall({ height: 1 })))      // DB block tile → extruded cube, NO depth

    expect(block.vExtent).toBeGreaterThan(flat.vExtent)            // the cube silhouette is measurably taller
    expect(block.count).toBeGreaterThan(flat.count * 1.3)          // top + two side faces cover far more than one flat face
  })

  test('the block paints a side-face COLUMN the flat billboard never does (all-faces, not a single face)', () => {
    // Directly under-left of the base diamond is the cube's LEFT side face — filled by the extruded block,
    // empty for the flat billboard (which is a single upright sprite with no side faces).
    const SIDE = { x: CX - TW, y: CY - TH, w: TW, h: TH + 24 }
    const flatSide = regionGreen(draw(paintedWall({ height: 0 })), SIDE.x, SIDE.y, SIDE.w, SIDE.h)
    const blockSide = regionGreen(draw(paintedWall({ height: 1 })), SIDE.x, SIDE.y, SIDE.w, SIDE.h)
    expect(blockSide).toBeGreaterThan(0)  // the cube has a visible side face
    expect(blockSide).toBeGreaterThan(flatSide)
  })
})
