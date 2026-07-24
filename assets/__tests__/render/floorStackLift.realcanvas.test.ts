/**
 * FLOOR STACK LIFT (#16) — a stacked tile RESTS ON its cell's FLOOR slab, not co-planar with it.
 *
 * WHY (Alexander, Image #16): "buildings on top of 0.1 grass tiles that look like they were put directly on
 * the grid and not on top of the grass … roads … look like they're at the same 'level' as the rest of
 * compositions … they should be 'below'". Since the floor-as-tile refactor the floor is a level-0 GridAsset
 * carrying its ground tile's OWN DB height (grass ≈ 0.1). A wall/building cell SHARES level 0 with that floor
 * (stampRun: "a LEVEL-0 wall/trunk/rim tile coexists with the floor at level 0"), so their bases were
 * CO-PLANAR — the building sat on the grid, its bottom buried in the 0.1 slab. MAP-MODEL §4 ("stacked like
 * legos/minecraft — height accumulates"): a tile on a floor lifts by the floor beneath it.
 *
 * Proved through the production iso render() path on a REAL @napi-rs/canvas in the EMOJI style (the one
 * Alexander QAs — where the floor draws its 0.1 slab as a visible cube): the wall's recorded base sits at the
 * floor SLAB's TOP, lifted by exactly the floor's OWN rendered slab height; a bare (no-floor) cell lifts
 * nothing; the lift is a UNIFORM shift of the whole stack (inter-tile gaps unchanged), so a composition doesn't
 * distort — it just climbs onto the grass. The expected lift is READ from the floor's own DB slab, never a
 * hardcoded 0.1. The 2D FRONT elevation (where the floor is the flat ground BASELINE, not a raised slab —
 * topdown.ts) is intentionally unaffected: the wall keeps sitting on the ground line, asserted here as a guard.
 */
import { installRealCanvas, type RealCanvasHarness } from '@/__tests__/helpers/realCanvas'
import { installSeedTileset } from '@/__tests__/helpers/tilesetSeed'
import { render, isoRecordedTileGeom, floorSlabHeight, ISO_BLOCK_H_FRAC } from '@/engine/render/iso'
import { render2D, twoDRecordedGeom } from '@/engine/render/topdown'
import { IsometricGrid, type GridAsset } from '@/engine/IsometricGrid'
import { EMOJI_STYLE } from '@/game/artStyle'
import { EMOJI_TILESET } from '@/engine/tileset/emojiTileset'
import type { PlayerState } from '@/game/runtime/player'
import type { TileGeom } from '@/engine/render/tileHit'

installSeedTileset()

let H: RealCanvasHarness

// Deterministic clamp-free camera (like isoInvertedPick): cellSize 100, isoScale 1 → tileW 71, tileH 36.
const CELL = 100, W = 800, HGT = 600, ISO = 1
const TILE_W = CELL * ISO * 0.71
const UNIT = TILE_W * ISO_BLOCK_H_FRAC // one full block's on-screen height (px)
const PCOL = 10, PROW = 10, ACOL = 12, AROW = 10
const player = (): PlayerState => ({ x: PCOL * CELL, z: PROW * CELL, moving: false } as PlayerState)

/** Any emoji tile that carries a baked image — a concrete standing block to place over a floor. */
function anImageTileKey(): string {
  const hit = Object.entries(EMOJI_TILESET).find(([, t]) => t.image && t.category !== 'units')
  if (!hit) throw new Error('fixture has no image-backed non-unit emoji tile')
  return hit[0]
}

const newGrid = (): IsometricGrid => new IsometricGrid({ cols: 30, rows: 30, cellSize: CELL, isoScale: ISO })

/** Place a standing (height-1) image block at (col,row,level), KEEPING the cell's default grass floor (uses
 *  placeAsset, NOT setAssets — setAssets would wipe the floors we are testing against). */
const addBlock = (grid: IsometricGrid, col: number, row: number, level: number): GridAsset => {
  const key = anImageTileKey()
  const a = grid.placeAsset([''], col, row, { type: key, tileOverride: `emoji:${key}`, color: '#c9c9c9', heightLevel: level })
  a.height = 1
  return a
}

/** Render iso once (real canvas, clamp-free camera) so isoTileHits is populated for the geometry reads. */
const renderIso = (grid: IsometricGrid): void => {
  const ctx = H.makeCanvas(W, HGT).getContext('2d') as unknown as CanvasRenderingContext2D
  render({ ctx, w: W, h: HGT, grid, player: player(), time: 0, camOffset: { x: 0, y: 0 }, entities: [], enemyCombat: new Map(), hitMarkers: [], now: 0, zoom: 1, attackAnims: [], connectors: [], quests: [], projectiles: [], dayNight: 'day', attackReach: 1, style: EMOJI_STYLE, clampCamera: false })
}

const cube = (g: TileGeom | null): Extract<TileGeom, { kind: 'cube' }> => {
  if (!g || g.kind !== 'cube') throw new Error('expected a recorded cube tile')
  return g
}
const avgY = (pts: { y: number }[]): number => pts.reduce((s, p) => s + p.y, 0) / pts.length
const baseY = (g: TileGeom | null): number => avgY(cube(g).base) // base-diamond centre y (bottom of the block)
const topY = (g: TileGeom | null): number => avgY(cube(g).top)   // top-diamond centre y (top of the block)

/** The floor's DB slab lift in px — data-driven expected shift (never a hardcoded 0.1). */
const slabLiftPx = (grid: IsometricGrid): number => floorSlabHeight(grid.floorAt(ACOL, AROW), EMOJI_STYLE) * UNIT

beforeAll(async () => {
  H = installRealCanvas().harness
  const srcs = new Set<string>()
  for (const t of Object.values(EMOJI_TILESET)) if (t.image) srcs.add(t.image)
  for (const s of srcs) H.registerSolid(s, '#00c800')
  await H.warm([...srcs])
})

describe('floorSlabHeight — the floor tile\'s OWN DB slab height (read, not invented)', () => {
  const grassFloor = (): GridAsset => ({ art: [''], col: ACOL, row: AROW, type: 'floor', tileKey: 'grass', heightLevel: 0, blocking: false } as unknown as GridAsset)

  test('a grass floor resolves its DB height as a thin sub-block slab (0 < h < 1)', () => {
    const h = floorSlabHeight(grassFloor(), EMOJI_STYLE)
    expect(h).toBeGreaterThan(0)
    expect(h).toBeLessThan(1) // a flat floor is a partial slab, not a full block
    expect(h).toBeCloseTo(0.1, 5) // the fixture grass DB height — read straight through, never floored/invented
  })

  test('a bare cell (no floor asset) lifts nothing', () => {
    expect(floorSlabHeight(undefined, EMOJI_STYLE)).toBe(0)
  })

  test('only a FLOOR asset counts — a wall/prop is not a floor to rest on', () => {
    const wall = { art: ['#'], col: ACOL, row: AROW, type: 'wall', label: 'wall', height: 1 } as unknown as GridAsset
    expect(floorSlabHeight(wall, EMOJI_STYLE)).toBe(0)
  })
})

describe('iso: a wall cell rests ON its grass floor slab, not co-planar on the grid', () => {
  test('the wall base sits at the floor SLAB TOP — lifted by exactly the floor\'s own slab height', () => {
    const grid = newGrid()
    addBlock(grid, ACOL, AROW, 0) // grass floor (stack index 0) + wall (stack index 1), both level 0
    renderIso(grid)

    const floor = isoRecordedTileGeom(ACOL, AROW, 0)
    const wall = isoRecordedTileGeom(ACOL, AROW, 1)
    const slab = baseY(floor) - topY(floor) // the floor's rendered slab thickness (its 0.1 DB height in px)
    expect(slab).toBeGreaterThan(0)

    // THE FIX: the wall's base coincides with the floor's TOP (it stands ON the grass), NOT the floor's base
    // (the grid plane). Before the fix the wall base == the floor base (co-planar) → this fails by `slab`.
    expect(baseY(wall)).toBeCloseTo(topY(floor), 1)
    expect(baseY(floor) - baseY(wall)).toBeCloseTo(slab, 1) // lifted up by precisely the floor slab
    expect(slab).toBeCloseTo(slabLiftPx(grid), 1)           // …which is the floor's OWN DB slab height (read, not invented)
  })

  test('a BARE cell (floor cleared) lifts nothing — removing the floor drops the wall by the slab', () => {
    const floored = newGrid()
    addBlock(floored, ACOL, AROW, 0)
    renderIso(floored)
    const wallFloored = baseY(isoRecordedTileGeom(ACOL, AROW, 1))
    const lift = slabLiftPx(floored)

    const bare = newGrid()
    bare.removeFloor(ACOL, AROW) // no floor beneath
    addBlock(bare, ACOL, AROW, 0)
    renderIso(bare)
    const wallBare = baseY(isoRecordedTileGeom(ACOL, AROW, 0)) // no floor → the wall is now stack index 0

    expect(wallBare - wallFloored).toBeCloseTo(lift, 1) // the floor lifts the wall by exactly the slab, no more
    expect(lift).toBeGreaterThan(0)
  })

  test('the floor lift is a UNIFORM shift — a stacked composition keeps its inter-tile gap (no distortion)', () => {
    const floored = newGrid()
    addBlock(floored, ACOL, AROW, 0) // lower block
    addBlock(floored, ACOL, AROW, 1) // upper block (roof-like), one level above
    renderIso(floored)
    // floor=0, lower=1, upper=2 in the stack
    const lowerF = baseY(isoRecordedTileGeom(ACOL, AROW, 1))
    const upperF = baseY(isoRecordedTileGeom(ACOL, AROW, 2))
    const gapFloored = lowerF - upperF // the upper sits one block above the lower

    const bare = newGrid()
    bare.removeFloor(ACOL, AROW)
    addBlock(bare, ACOL, AROW, 0)
    addBlock(bare, ACOL, AROW, 1)
    renderIso(bare)
    const gapBare = baseY(isoRecordedTileGeom(ACOL, AROW, 0)) - baseY(isoRecordedTileGeom(ACOL, AROW, 1))

    expect(gapFloored).toBeCloseTo(UNIT, 1)      // one full block between stacked tiles
    expect(gapFloored).toBeCloseTo(gapBare, 1)   // the floor lift did NOT stretch/squash the internal stack
  })
})

describe('2D front elevation is unaffected — the floor is the flat baseline there (guard, not a regression)', () => {
  const render2DGrid = (grid: IsometricGrid): void => {
    render2D({ ctx: H.makeCanvas(W, HGT).getContext('2d') as unknown as CanvasRenderingContext2D, w: W, h: HGT, grid, player: player(), time: 0, zoom: 1, camOffset: { x: 0, y: 0 }, entities: [], enemyCombat: new Map(), connectors: [], quests: [], dayNight: 'day', attackAnims: [], hitMarkers: [], projectiles: [], attackReach: 1, style: EMOJI_STYLE })
  }
  const bottomY = (g: TileGeom | null): number => {
    if (!g || g.kind !== 'poly') throw new Error('expected a recorded 2D rect')
    return Math.max(...g.pts.map(p => p.y))
  }

  test('the wall sits on the 2D ground line whether or not a floor asset is under it (no float)', () => {
    const floored = newGrid()
    addBlock(floored, ACOL, AROW, 0)
    render2DGrid(floored)
    const flooredBottom = bottomY(twoDRecordedGeom(ACOL, AROW, 0))

    const bare = newGrid()
    bare.removeFloor(ACOL, AROW)
    addBlock(bare, ACOL, AROW, 0)
    render2DGrid(bare)
    const bareBottom = bottomY(twoDRecordedGeom(ACOL, AROW, 0))

    expect(flooredBottom).toBeCloseTo(bareBottom, 1) // 2D floor = ground baseline → the wall base never floats
  })
})
