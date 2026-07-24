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
import { IsometricGrid, type GridAsset } from '@/engine/IsometricGrid'
import { pushTile, setTileHeight } from '@/engine/cellStack'
import { depthCells } from '@/engine/render/isoBlock'

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

describe('RAISE a tile and what is on top of it goes up with it', () => {
  /** A stamped building cell as the generator leaves it: the flat floor, a 4-block wall pier at level 0, and
   *  the gable roof bar at level 4 — each an ALREADY-PLACED tile carrying its authored level. */
  const stampedHouseCell = (grid: IsometricGrid): { wall: GridAsset; roof: GridAsset } => {
    const place = (level: number, blocks: number): GridAsset => {
      const a = grid.placeAsset([''], C, R, { type: 'house_4', heightLevel: level })
      a.height = blocks
      return a
    }
    return { wall: place(0, 4), roof: place(4, 2) }
  }

  test("raising the FLOOR lifts the house standing on it — Alexander's report (Image #36)", () => {
    const grid = mkGrid()
    grid.setGround(C, R, 'grass')
    const { wall, roof } = stampedHouseCell(grid)

    setTileHeight(grid, C, R, 0, 5) // the floor tile (stack slot 0) is raised to 5 blocks

    expect(grid.floorAt(C, R)!.height).toBe(5)
    expect(wall.heightLevel).toBe(5) // the wall now rests on the raised floor, not buried in it
    expect(roof.heightLevel).toBe(9) // …and the roof rode up with it
  })

  test('the tiles above keep their RELATIVE spacing — an authored gap is preserved, not collapsed', () => {
    const grid = mkGrid()
    grid.setGround(C, R, 'grass')
    // A tree cell: leaves authored to FLOAT at level 3 with nothing beneath them (32 real composition cells
    // do this — collapsing them onto the tile below would wreck every tree, lamp and rooftop unit).
    const leaf = grid.placeAsset([''], C, R, { type: 'tree', heightLevel: 3 })
    leaf.height = 1

    setTileHeight(grid, C, R, 0, 2)

    expect(leaf.heightLevel).toBe(5) // shifted by the raise (3 + 2), NOT re-seated onto the floor
  })

  test('LOWERING brings them back down — the lift is reversible, never a one-way ratchet', () => {
    const grid = mkGrid()
    grid.setGround(C, R, 'grass')
    const { wall, roof } = stampedHouseCell(grid)

    setTileHeight(grid, C, R, 0, 5)
    setTileHeight(grid, C, R, 0, 0)

    expect(wall.heightLevel).toBe(0)
    expect(roof.heightLevel).toBe(4)
  })

  test('ANY tile lifts what is above it — not just the floor (raise the wall, the roof rises)', () => {
    const grid = mkGrid()
    grid.setGround(C, R, 'grass')
    const { wall, roof } = stampedHouseCell(grid)

    setTileHeight(grid, C, R, 1, 6) // the WALL (slot 1) goes from 4 blocks to 6

    expect(wall.heightLevel).toBe(0)  // the wall itself doesn't move — it grows upward from where it stands
    expect(roof.heightLevel).toBe(6)  // the roof sits on its new top (4 + 2)
  })

  test('raising the TOP tile moves nothing — there is nothing above it to lift', () => {
    const grid = mkGrid()
    grid.setGround(C, R, 'grass')
    const { wall, roof } = stampedHouseCell(grid)

    setTileHeight(grid, C, R, 2, 9)

    expect(wall.heightLevel).toBe(0)
    expect(roof.heightLevel).toBe(4)
    expect(roof.height).toBe(9)
  })

  test('a Z-WIDTH tile lifts what stands on EVERY block it occupies, not just its anchor', () => {
    const grid = mkGrid()
    // ONE road tile anchored at (C,R) but spanning 4 blocks via smart z-width — it OCCUPIES all four.
    grid.setGround(C, R, 'road')
    const road = grid.floorAt(C, R)!
    road.depth = 4
    road.depthDir = 'right-down'

    // A wall standing on the THIRD block of that span — its own cell, but the same tile underneath.
    const spanned = depthCells(C, R, 4, 'right-down')[2]
    const wall = grid.placeAsset([''], spanned.col, spanned.row, { type: 'house_4', heightLevel: 0 })
    wall.height = 4

    setTileHeight(grid, C, R, 0, 3) // raise the road tile to 3 blocks

    // "even if it's 1 tile positioned in 1 block with smart z-width, it's still occupying the other blocks"
    expect(wall.heightLevel).toBe(3)
  })

  test('a tile whose OWN z-width reaches over the raised tile is lifted too (anchored elsewhere)', () => {
    const grid = mkGrid()
    grid.setGround(C, R, 'grass')
    // A roof bar anchored two cells away, spanning back ACROSS (C,R) — it stands over the raised tile even
    // though its anchor cell is somewhere else.
    const roof = grid.placeAsset([''], C + 2, R, { type: 'house_4', heightLevel: 4 })
    roof.height = 1
    roof.depth = 3
    roof.depthDir = 'left-up' // steps -1 col per block: (C+2,R) → (C+1,R) → (C,R)
    expect(depthCells(C + 2, R, 3, 'left-up').some(c => c.col === C && c.row === R)).toBe(true)

    setTileHeight(grid, C, R, 0, 2)

    expect(roof.heightLevel).toBe(6)
  })

  test('a tile NOT over the raised tile stays put — the lift follows occupancy, not the whole map', () => {
    const grid = mkGrid()
    grid.setGround(C, R, 'grass')
    const elsewhere = grid.placeAsset([''], C + 5, R + 5, { type: 'house_4', heightLevel: 0 })
    elsewhere.height = 1

    setTileHeight(grid, C, R, 0, 4)

    expect(elsewhere.heightLevel).toBe(0)
  })

  test('heights are CONTINUOUS — a 0.001 change lifts by exactly 0.001, never rounded to a whole block', () => {
    const grid = mkGrid()
    grid.setGround(C, R, 'grass')
    const wall = grid.placeAsset([''], C, R, { type: 'house_4', heightLevel: 0 })
    wall.height = 1

    setTileHeight(grid, C, R, 0, 0.001)
    expect(wall.heightLevel).toBeCloseTo(0.001, 6)

    setTileHeight(grid, C, R, 0, 2.5)
    expect(wall.heightLevel).toBeCloseTo(2.5, 6)
  })

  test('a per-instance scaleY is folded into the tile\'s ONE height number when it is edited', () => {
    const grid = mkGrid()
    grid.setGround(C, R, 'grass')
    const wall = grid.placeAsset([''], C, R, { type: 'house_4', heightLevel: 0 })
    wall.height = 1
    wall.scaleY = 4 // a collapsed 4-block run, as compositions author it
    const roof = grid.placeAsset([''], C, R, { type: 'house_4', heightLevel: 4 })
    roof.height = 2

    setTileHeight(grid, C, R, 1, 5) // 4 blocks → 5 blocks

    expect(wall.height).toBe(5)
    expect(wall.scaleY).toBeUndefined() // one number, the data — no leftover multiplier
    expect(roof.heightLevel).toBe(5)    // lifted by the ONE block it actually grew
  })
})
