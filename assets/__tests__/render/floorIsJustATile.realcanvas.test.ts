/**
 * THE FLOOR IS JUST A TILE — the RENDER half. There is no "floor stack lift" term in the iso renderer.
 *
 * Alexander: "there shouldn't be anything as 'floorStackLift' whatsoever, FLOOR ARE FUCKING TILES, ALL TILES
 * STACK ON TOP OF ANOTHER LIKE LEGOS BY DEFAULT … IF INCREASE THE HEIGHT OF ANY FLOOR TILE, WHATEVER IS ON
 * TOP OF IT WILL GET LIFTED, BECAUSE THAT'S HOW ALL FUCKING TILES WORK AND THE FLOOR IS NO DIFFERENT FROM IT."
 *
 * The renderer lifts a tile by its stack level and NOTHING else (`isoStackLift`). Everything beneath it is
 * already accounted for, because `stackTop` (cellStack) hands the tile a level of `level + own height` over
 * the cell's tiles — the floor counted exactly like a wall. So:
 *   • the ground is ONE block ("all tiles/blocks are height 1, GLOBAL, no exceptions"), so a wall painted on
 *     grass rises by exactly that one block — no more, and never by a floor-shaped bonus term;
 *   • RAISING that floor tile lifts the wall by exactly the floor's own height, with no floor-specific code;
 *   • a bare cell and a floored cell differ by exactly the floor's height, and by nothing else.
 * The old floor-only lift got the middle case WRONG (it clamped through `partialBlockScale`, so a 2-block
 * floor lifted by only 1). Proved through the production `render()` path on a REAL @napi-rs/canvas in the
 * EMOJI style — the one Alexander QAs — placing tiles through the BRUSH path (pushTile), not hand-set levels.
 */
import { styleTiles } from '@/engine/tileset/styleTiles'
import { installRealCanvas, type RealCanvasHarness } from '@/__tests__/helpers/realCanvas'
import { installSeedTileset } from '@/__tests__/helpers/tilesetSeed'
import { render, isoRecordedTileGeom, ISO_BLOCK_H_FRAC } from '@/engine/render/iso'
import { IsometricGrid, type GridAsset } from '@/engine/IsometricGrid'
import { pushTile } from '@/engine/cellStack'
import { EMOJI_STYLE } from '@/game/artStyle'
import type { PlayerState } from '@/game/runtime/player'
import type { TileGeom } from '@/engine/render/tileHit'

installSeedTileset()

let H: RealCanvasHarness

// Deterministic clamp-free camera (like isoInvertedPick): cellSize 100, isoScale 1 → tileW 71.
const CELL = 100, W = 800, HGT = 600, ISO = 1
const TILE_W = CELL * ISO * 0.71
const UNIT = TILE_W * ISO_BLOCK_H_FRAC // one full block's on-screen height (px)
const PCOL = 10, PROW = 10, ACOL = 12, AROW = 10
const player = (): PlayerState => ({ x: PCOL * CELL, z: PROW * CELL, moving: false } as PlayerState)

/** Any emoji tile that carries a baked image — a concrete standing block to paint over a floor. */
function anImageTileKey(): string {
  const hit = Object.entries(styleTiles('emoji')).find(([, t]) => t.image && t.category !== 'units')
  if (!hit) throw new Error('fixture has no image-backed non-unit emoji tile')
  return hit[0]
}

const newGrid = (): IsometricGrid => new IsometricGrid({ cols: 30, rows: 30, cellSize: CELL, isoScale: ISO })

/** Paint a standing 1-block tile through the BRUSH path — its level comes from the stacking rule, not from us. */
const paintBlock = (grid: IsometricGrid): GridAsset => {
  const key = anImageTileKey()
  return pushTile(grid, ACOL, AROW, { source: 'asset', slug: key, type: key, tileId: `emoji:${key}`, art: [''], h: 1, color: '#c9c9c9' })
}

const renderIso = (grid: IsometricGrid): void => {
  const ctx = H.makeCanvas(W, HGT).getContext('2d') as unknown as CanvasRenderingContext2D
  render({ ctx, w: W, h: HGT, grid, player: player(), time: 0, camOffset: { x: 0, y: 0 }, entities: [], enemyCombat: new Map(), hitMarkers: [], now: 0, zoom: 1, attackAnims: [], connectors: [], quests: [], projectiles: [], dayNight: 'day', attackReach: 1, style: EMOJI_STYLE, clampCamera: false })
}

const cube = (g: TileGeom | null): Extract<TileGeom, { kind: 'cube' }> => {
  if (!g || g.kind !== 'cube') throw new Error('expected a recorded cube tile')
  return g
}
const avgY = (pts: { y: number }[]): number => pts.reduce((s, p) => s + p.y, 0) / pts.length
const baseY = (g: TileGeom | null): number => avgY(cube(g).base) // base-diamond centre y (bottom of the tile)

beforeAll(async () => {
  H = installRealCanvas().harness
  const srcs = new Set<string>()
  for (const t of Object.values(styleTiles('emoji'))) if (t.image) srcs.add(t.image)
  for (const s of srcs) H.registerSolid(s, '#00c800')
  await H.warm([...srcs])
})

describe('iso: a tile is lifted by its stack level ONLY — no floor-shaped extra term', () => {
  test('the ground lifts by its OWN one block — the painted tile sits on it, not inside it and not higher', () => {
    const grid = newGrid()
    paintBlock(grid)
    renderIso(grid)

    const floor = isoRecordedTileGeom(ACOL, AROW, 0)
    const wall = isoRecordedTileGeom(ACOL, AROW, 1)
    // Screen Y grows downward, so "one block up" is −1 UNIT. Exactly one: the ground contributes its own
    // height and nothing else. Zero would mean the wall was sunk into the ground; more than one would be the
    // floor-shaped bonus term this whole file exists to forbid.
    expect(baseY(floor) - baseY(wall)).toBeCloseTo(UNIT, 1)
  })

  test('RAISE the floor tile → the tile on top rises by EXACTLY the floor\'s own height (2 blocks, not 1)', () => {
    const grid = newGrid()
    grid.floorAt(ACOL, AROW)!.height = 2 // the user makes this floor tile 2 blocks tall
    paintBlock(grid)
    renderIso(grid)

    const floor = isoRecordedTileGeom(ACOL, AROW, 0)
    const wall = isoRecordedTileGeom(ACOL, AROW, 1)
    // Screen Y grows downward, so "2 blocks up" is −2 UNIT. The removed floor-only lift clamped a sub-block
    // slab through partialBlockScale and would have lifted by 1 block here — this pins the honest 2.
    expect(baseY(floor) - baseY(wall)).toBeCloseTo(2 * UNIT, 1)
  })

  test('a BARE cell and a FLOORED cell differ by EXACTLY the floor\'s one block — and by nothing else', () => {
    const floored = newGrid()
    paintBlock(floored)
    renderIso(floored)
    const withFloor = baseY(isoRecordedTileGeom(ACOL, AROW, 1))

    const bare = newGrid()
    bare.removeFloor(ACOL, AROW)
    paintBlock(bare)
    renderIso(bare)
    const withoutFloor = baseY(isoRecordedTileGeom(ACOL, AROW, 0)) // no floor → the tile is stack index 0

    // The ONLY difference between the two cells is one block of ground, so that is the only difference the
    // render may show. This is the test that catches a floor-shaped term: it would push the two further apart
    // than the floor's own height accounts for.
    expect(withoutFloor - withFloor).toBeCloseTo(UNIT, 1)
  })

  test('stacked tiles keep a ONE-BLOCK gap — the stack is not stretched or squashed by anything', () => {
    const grid = newGrid()
    paintBlock(grid) // lands at level 0 (on the flat floor)
    paintBlock(grid) // lands at level 1 (on the 1-block tile below)
    renderIso(grid)

    const lower = baseY(isoRecordedTileGeom(ACOL, AROW, 1))
    const upper = baseY(isoRecordedTileGeom(ACOL, AROW, 2))
    expect(lower - upper).toBeCloseTo(UNIT, 1)
  })
})
