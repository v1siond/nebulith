/**
 * REAL-CANVAS regression test for the "tree on tree" 2D doubling bug (@napi-rs/canvas).
 *
 * THE BUG: a tree (and every pre-built composition) is stamped as several per-cell assets — a TRUNK cell at
 * heightLevel 0 and a CANOPY cell at heightLevel 1, each carrying its OWN part LABEL (`tree_trunk` /
 * `tree_canopy`) but the SAME composition `type` ('tree'). The ISO view draws each cell by its LABEL (its own
 * trunk/leaf tile), so the two cells compose into ONE coherent tree. The 2D view (render2D) resolved the tile
 * by the composition's KIND instead — `assetKind` collapses every `tree_*` label to the 'tree' kind, whose
 * emoji is the whole 🌲 — so BOTH stacked cells painted a full tree, one over the other: "tree on tree".
 *
 * THE FIX mirrors iso's label-FIRST seam: a cell with a `label` and `height >= 1` (a composition cell) draws
 * its OWN per-label tile in 2D too, BEFORE the kind-based emoji is ever consulted. Keyed on the cell's DATA
 * (label + height), NOT on the tile type — so ANY composition (tree/building/fountain/lamp) translates.
 *
 * WHAT THIS PROVES, on real pixels: with the two part cells tinted to distinct, ground-free colours
 * (canopy = MAGENTA, trunk = BLUE), rendering the 2-level composition in the 2D view yields
 *   • BOTH part tiles painted (each cell drew its own tile);
 *   • them STACKED — the canopy sits ABOVE the trunk (matching iso's per-level stacking);
 *   • the canopy CONFINED to ~one cell — it does NOT balloon into a second full-tree billboard over the
 *     trunk. Pre-fix the canopy painted the whole-tree KIND emoji (~1.5 cells tall, lifted), so its vertical
 *     extent was far larger and it overlapped the trunk — the doubling this test locks out.
 */
import { installRealCanvas, type RealCanvasHarness } from '@/__tests__/helpers/realCanvas'
import { render2D } from '@/engine/render/topdown'
import { render as renderIso } from '@/engine/render/iso'
import { IsometricGrid, type GridAsset } from '@/engine/IsometricGrid'
import { EMOJI_STYLE, rebuildEmojiStyle } from '@/game/artStyle'
import { EMOJI_TILESET } from '@/engine/tileset/emojiTileset'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'
import type { PlayerState } from '@/game/runtime/player'
import type { Canvas } from '@napi-rs/canvas'

let H: RealCanvasHarness

// Distinct, ground-free tints so the canopy (magenta) and trunk (blue) are unambiguous against the grass.
const MAGENTA = '#ff00ff'
const BLUE = '#1030ff'

// The generic whole-tree KIND emoji (the doubling culprit) + the two per-part composition tiles.
const KIND_SRC = '/tiles/emoji/__cs_tree_kind.png'
const TRUNK_SRC = '/tiles/emoji/__cs_trunk.png'
const CANOPY_SRC = '/tiles/emoji/__cs_canopy.png'

// A 20×20 grid so the camera clamp never shifts a centred composition off screen.
const COLS = 20, ROWS = 20, CELL = 40
const C = 10, R = 10 // the composition's anchor cell
const W = 480, H2 = 480
const ZOOM = 2
const TILE = 24 * ZOOM // render2D's tileH at this zoom (baseTileSize 24 × zoom) — the "one cell" ruler

// Player parked ON the composition cell so toScreen(C+0.5,R+0.5) lands at the canvas centre; the gold hero
// figure reads neither magenta nor blue, so it can't skew the scan.
const PLAYER: PlayerState = { x: C * CELL + CELL / 2, z: R * CELL + CELL / 2, facing: 'down', moving: false, frame: 0 } as PlayerState

const hadGrass = '__cs_had_grass__'

beforeAll(async () => {
  H = installRealCanvas().harness
  // WHITE baked tiles so each cell's colour SETTING fully tints them (colour is a per-tile filter).
  H.registerSolid(KIND_SRC, '#ffffff')
  H.registerSolid(TRUNK_SRC, '#ffffff')
  H.registerSolid(CANOPY_SRC, '#ffffff')
  // The generic 'tree' KIND resolves the whole-tree emoji (pre-fix, both cells painted THIS). The two part
  // labels resolve their own trunk/leaf tile (post-fix, what each cell paints).
  EMOJI_TILESET.tree = { char: '🌲', color: '#3aaa3a', image: KIND_SRC }
  EMOJI_TILESET.tree_trunk = { char: '▮', color: '#8a5a2a', image: TRUNK_SRC, height: 1 }
  EMOJI_TILESET.tree_canopy = { char: '●', color: '#2fbf2f', image: CANOPY_SRC, height: 1 }
  // The parked hero must render as a SHORT emoji billboard (gold 🧍), not a tall ASCII figure — a tall
  // figure would occlude the top of the magenta canopy and skew the centroid scan. The frontend ships no
  // bundled default now, so seed the person tile here alongside the tree tiles.
  EMOJI_TILESET.player = { char: '🧍', color: '#ffcf3a' }
  rebuildEmojiStyle() // install the KIND tile into EMOJI_STYLE.map so resolveAssetDraw('tree') sees its image
  await H.warm([KIND_SRC, TRUNK_SRC, CANOPY_SRC])
  // render2D/iso paint ground from the loaded tileset terrain (DB-seeded, `{}` in tests) — seed grass so the
  // ground draws without a lookup crash; its dark bg reads neither magenta nor blue.
  if (!ASCII_TILESET.terrain.grass) {
    ;(ASCII_TILESET.terrain as Record<string, { char: string[]; fg: string[]; bg: string[] }>).grass =
      { char: ['.'], fg: ['#5aa05a'], bg: ['#24402a'] }
    ;(ASCII_TILESET.terrain as Record<string, unknown>)[hadGrass] = false
  }
})

afterAll(() => {
  delete EMOJI_TILESET.tree
  delete EMOJI_TILESET.tree_trunk
  delete EMOJI_TILESET.tree_canopy
  delete EMOJI_TILESET.player
  rebuildEmojiStyle()
  if ((ASCII_TILESET.terrain as Record<string, unknown>)[hadGrass] === false) {
    delete (ASCII_TILESET.terrain as Record<string, unknown>).grass
    delete (ASCII_TILESET.terrain as Record<string, unknown>)[hadGrass]
  }
})

/** A grid holding ONE 2-level tree composition at (C,R): a trunk cell (level 0) + a canopy cell (level 1),
 *  each with its own part label — exactly what stampComposition places for a tree. */
function compositionGrid(): IsometricGrid {
  const grid = new IsometricGrid({ cols: COLS, rows: ROWS, cellSize: CELL })
  const trunk: GridAsset = { art: ['▮'], col: C, row: R, type: 'tree', label: 'tree_trunk', heightLevel: 0, height: 1, color: BLUE } as GridAsset
  const canopy: GridAsset = { art: ['●'], col: C, row: R, type: 'tree', label: 'tree_canopy', heightLevel: 1, height: 1, color: MAGENTA } as GridAsset
  grid.assets.push(trunk, canopy)
  return grid
}

function twoD(grid: IsometricGrid): Canvas {
  const cv = H.makeCanvas(W, H2)
  const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D
  render2D({ ctx, w: W, h: H2, grid, player: PLAYER, time: 0, zoom: ZOOM, camOffset: { x: 0, y: 0 }, entities: [], enemyCombat: new Map(), connectors: [], quests: [], dayNight: 'day', attackAnims: [], hitMarkers: [], projectiles: [], attackReach: 1, style: EMOJI_STYLE })
  return cv
}

function iso(grid: IsometricGrid): Canvas {
  const cv = H.makeCanvas(W, H2)
  const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D
  renderIso({ ctx, w: W, h: H2, grid, player: PLAYER, time: 0, camOffset: { x: 0, y: 0 }, entities: [], enemyCombat: new Map(), hitMarkers: [], now: 0, zoom: ZOOM, attackAnims: [], connectors: [], quests: [], projectiles: [], dayNight: 'day', attackReach: 1, style: EMOJI_STYLE })
  return cv
}

interface ColorStats { count: number; minRow: number; maxRow: number; centroidRow: number }

/** Per-colour pixel stats: how many pixels read clearly as this colour, and their vertical spread. `wantMag`
 *  selects magenta (R,B ≫ G); otherwise blue (B ≫ R,G). Grass/gold never satisfy either, so the scan sees
 *  only the tinted composition tiles. */
function colorStats(cv: Canvas, wantMag: boolean): ColorStats {
  const { data, width } = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height) as unknown as { data: Uint8ClampedArray; width: number }
  let count = 0, minRow = Infinity, maxRow = -Infinity, sumRow = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const isMag = r > g + 40 && b > g + 40
    const isBlue = b > r + 40 && b > g + 40
    if (wantMag ? !isMag : !isBlue) continue
    // magenta and blue overlap on "b > g+40"; disambiguate by the red channel.
    if (wantMag && r <= g + 40) continue
    if (!wantMag && r > g + 40) continue
    const row = Math.floor(i / 4 / width)
    count++
    if (row < minRow) minRow = row
    if (row > maxRow) maxRow = row
    sumRow += row
  }
  return { count, minRow: count ? minRow : -1, maxRow: count ? maxRow : -1, centroidRow: count ? sumRow / count : -1 }
}

describe('2D renders a 2-level tree composition WITHOUT doubling (trunk + canopy = one coherent tree)', () => {
  test('both part tiles are painted — each cell drew its OWN label tile, not one shared whole-tree image', () => {
    const cv = twoD(compositionGrid())
    const canopy = colorStats(cv, true)
    const trunk = colorStats(cv, false)
    expect(canopy.count).toBeGreaterThan(200) // the magenta canopy leaf tile reached the canvas
    expect(trunk.count).toBeGreaterThan(200)  // the blue trunk tile reached the canvas
  })

  test('the canopy sits ABOVE the trunk — the two levels stack like iso, not on the same spot', () => {
    const cv = twoD(compositionGrid())
    const canopy = colorStats(cv, true)
    const trunk = colorStats(cv, false)
    expect(canopy.centroidRow).toBeGreaterThan(0)
    expect(trunk.centroidRow).toBeGreaterThan(0)
    // smaller row = higher on screen; the level-1 canopy must be clearly above the level-0 trunk.
    expect(canopy.centroidRow).toBeLessThan(trunk.centroidRow - TILE * 0.4)
  })

  test('the canopy is CONFINED to ~one cell — it does NOT balloon into a second full tree over the trunk', () => {
    const cv = twoD(compositionGrid())
    const canopy = colorStats(cv, true)
    const extent = canopy.maxRow - canopy.minRow
    // A single labeled cell spans ~one TILE tall. The pre-fix whole-tree KIND billboard spanned ~1.5 TILE
    // (lifted), overlapping the trunk. Anything under ~1.3 TILE proves the canopy stayed one cell — no double.
    expect(extent).toBeLessThan(TILE * 1.3)
    expect(extent).toBeGreaterThan(TILE * 0.4) // sanity: it really did draw a cell-sized tile
  })

  test('2D now matches iso: iso draws the SAME stacked composition (canopy above trunk), both present', () => {
    const cv = iso(compositionGrid())
    const canopy = colorStats(cv, true)
    const trunk = colorStats(cv, false)
    expect(canopy.count).toBeGreaterThan(100)
    expect(trunk.count).toBeGreaterThan(100)
    expect(canopy.centroidRow).toBeLessThan(trunk.centroidRow) // iso stacks the canopy above the trunk too
  })
})
