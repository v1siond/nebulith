/**
 * THE FLOOR IS JUST A TILE — there is no "floor stack lift", no floor branch, no special thing.
 *
 * Alexander, in his own words: "FLOOR ARE FUCKING TILES, ALL TILES STACK ON TOP OF ANOTHER LIKE LEGOS BY
 * DEFAULT … PUTTING A COMPOSITION ON TOP OF A SECTION THAT HAS A BUNCH OF FLOOR TILES, ALREADY STACKS THEM,
 * THERE'S NO NEED FOR ANY SPECIAL THING, FROM THAT POINT ONWARD, IF INCREASE THE HEIGHT OF ANY FLOOR TILE,
 * WHATEVER IS ON TOP OF IT WILL GET LIFTED, BECAUSE THAT'S HOW ALL FUCKING TILES WORK AND THE FLOOR IS NO
 * DIFFERENT FROM IT."
 *
 * So the stacking rule is ONE rule for every tile: a tile lands on TOP of what is already in the cell —
 * `level + its own block height`, summed over the cell's tiles, floor INCLUDED. No `type === 'floor'` test
 * anywhere in it, and no `+1` constant that pretends every tile is exactly one block tall.
 *
 * These assert the grid state directly (no rendering) — the render half (that nothing adds a floor-shaped
 * lift on top of this) lives in render/floorIsJustATile.realcanvas.test.ts.
 */
import { IsometricGrid } from '@/engine/IsometricGrid'
import { pushTile } from '@/engine/cellStack'

const mkGrid = () => new IsometricGrid({ cols: 12, rows: 12, cellSize: 16, isoScale: 1.4 })
const C = 4, R = 4

/** Paint a tile of `h` blocks onto the cell exactly as the editor brush does (stackAssetTile → pushTile). */
const paint = (grid: IsometricGrid, h: number, scaleY?: number) =>
  pushTile(grid, C, R, { source: 'asset', slug: 'stone', type: 'block', art: ['█'], h, scaleY })

describe('the floor is just a tile — one stacking rule, no floor special case', () => {
  test('a FLAT floor (0 blocks) adds no lift — a tile painted on grass sits at level 0, on the grid', () => {
    const grid = mkGrid()
    grid.setGround(C, R, 'grass')
    // A flat tile is 0 blocks tall (data migration 0005: "GET THE TILES OF 0.1 DOWN TO 0"), so it takes up
    // no vertical room and what lands on it starts on the grid plane.
    expect(grid.floorAt(C, R)?.height ?? 0).toBe(0)
    expect(paint(grid, 1).heightLevel).toBe(0)
  })

  test('RAISE the floor tile and what goes on top gets lifted — the floor lifts like ANY tile', () => {
    const grid = mkGrid()
    grid.setGround(C, R, 'grass')
    grid.floorAt(C, R)!.height = 2 // the user raises this floor tile to 2 blocks (a per-instance height)

    // "IF INCREASE THE HEIGHT OF ANY FLOOR TILE, WHATEVER IS ON TOP OF IT WILL GET LIFTED" — the next tile
    // rests on the floor's TOP (level 2), because the rule reads the floor's height like every other tile's.
    expect(paint(grid, 1).heightLevel).toBe(2)
  })

  test('heights ACCUMULATE like legos — painting on a 4-block wall lands at level 4, not level 1', () => {
    const grid = mkGrid()
    grid.setGround(C, R, 'grass')
    paint(grid, 4) // a 4-block wall pier at level 0
    // The old rule was `topLevel + 1` — one level per TILE regardless of how tall it is, which buried the
    // next tile inside the wall. Legos stack by HEIGHT: 4 blocks up.
    expect(paint(grid, 1).heightLevel).toBe(4)
  })

  test('a tall tile authored as scaleY (a composition wall pier) stacks by its RENDERED height', () => {
    const grid = mkGrid()
    grid.setGround(C, R, 'grass')
    paint(grid, 1, 3) // 1 block × Height multiplier 3 = a 3-block pier (the "minimal cells" authoring)
    expect(paint(grid, 1).heightLevel).toBe(3)
  })

  test('the floor is NOT special — a 2-block FLOOR and a 2-block WALL lift the next tile identically', () => {
    const onFloor = mkGrid()
    onFloor.setGround(C, R, 'grass')
    onFloor.floorAt(C, R)!.height = 2

    const onWall = mkGrid()
    onWall.setGround(C, R, 'grass')
    paint(onWall, 2)

    // Same height beneath → same landing level. If a floor-shaped branch existed anywhere in the rule,
    // these two would disagree.
    expect(paint(onFloor, 1).heightLevel).toBe(paint(onWall, 1).heightLevel)
  })

  test('an EMPTY cell (floor cleared) starts at level 0 — nothing beneath, nothing to stack on', () => {
    const grid = mkGrid()
    grid.removeFloor(C, R)
    expect(paint(grid, 1).heightLevel).toBe(0)
  })
})
