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
import { cellStackTop, pushTile, setTileHeight } from '@/engine/cellStack'
import { depthCells } from '@/engine/render/isoBlock'

const mkGrid = () => new IsometricGrid({ cols: 12, rows: 12, cellSize: 16, isoScale: 1.4 })
const C = 4, R = 4

/** Paint a tile of `h` blocks onto the cell exactly as the editor brush does (stackAssetTile → pushTile). */
const paint = (grid: IsometricGrid, h: number, scaleY?: number) =>
  pushTile(grid, C, R, { source: 'asset', slug: 'stone', type: 'block', art: ['█'], h, scaleY })

describe('the floor is just a tile — one stacking rule, no floor special case', () => {
  test('the ground is ONE block like everything else — a tile painted on grass sits ON it, at level 1', () => {
    const grid = mkGrid()
    grid.setGround(C, R, 'grass')
    // FLAT TILES NO LONGER EXIST (Alexander, 2026-07-27: "all tiles/blocks are height 1, GLOBAL, no
    // exceptions"). The ground is a block like any other, so a wall painted on grass rests on TOP of it
    // rather than sinking into it — the same complaint that produced the rule ("houses stack on top of the
    // grass tiles instead of inside"). This is the assertion that catches a 0-height ground coming back.
    expect(cellStackTop(grid, C, R)).toBe(1)
    expect(paint(grid, 1).heightLevel).toBe(1)
  })

  test('RAISE the floor tile and what goes on top gets lifted — the floor lifts like ANY tile', () => {
    const grid = mkGrid()
    grid.setGround(C, R, 'grass')
    grid.floorAt(C, R)!.height = 2 // the user raises this floor tile to 2 blocks (a per-instance height)

    // "IF INCREASE THE HEIGHT OF ANY FLOOR TILE, WHATEVER IS ON TOP OF IT WILL GET LIFTED" — the next tile
    // rests on the floor's TOP (level 2), because the rule reads the floor's height like every other tile's.
    expect(paint(grid, 1).heightLevel).toBe(2)
  })

  test('heights ACCUMULATE like legos — painting on a 4-block wall lands at level 5, not level 1', () => {
    const grid = mkGrid()
    grid.setGround(C, R, 'grass')
    paint(grid, 4) // a 4-block wall pier, itself standing on the 1-block ground
    // The old rule was `topLevel + 1` — one level per TILE regardless of how tall it is, which buried the
    // next tile inside the wall. Legos stack by HEIGHT: 1 block of ground + 4 of wall = level 5.
    expect(paint(grid, 1).heightLevel).toBe(5)
  })

  test('a tall tile authored as scaleY (a composition wall pier) stacks by its RENDERED height', () => {
    const grid = mkGrid()
    grid.setGround(C, R, 'grass')
    paint(grid, 1, 3) // 1 block × Height multiplier 3 = a 3-block pier (the "minimal cells" authoring)
    expect(paint(grid, 1).heightLevel).toBe(4) // 1 ground + 3 pier — the multiplier counts, not the tile
  })

  test('the floor is NOT special — 3 blocks of FLOOR and 1 floor + 2 of WALL lift the next tile identically', () => {
    const onFloor = mkGrid()
    onFloor.setGround(C, R, 'grass')
    onFloor.floorAt(C, R)!.height = 3 // three blocks, all of them ground

    const onWall = mkGrid()
    onWall.setGround(C, R, 'grass')
    paint(onWall, 2) // three blocks too: the 1-block ground plus a 2-block wall standing on it

    // Same number of blocks beneath → same landing level, whatever KIND of tile those blocks are. If a
    // floor-shaped branch existed anywhere in the rule, these two would disagree.
    expect(paint(onFloor, 1).heightLevel).toBe(3)
    expect(paint(onWall, 1).heightLevel).toBe(3)
  })

  test('an EMPTY cell (floor cleared) starts at level 0 — nothing beneath, nothing to stack on', () => {
    const grid = mkGrid()
    grid.removeFloor(C, R)
    expect(paint(grid, 1).heightLevel).toBe(0)
  })
})

describe('RAISE a tile and what is on top of it goes up with it', () => {
  /** A stamped building cell as the generator leaves it: the 1-block ground, a 4-block wall pier standing ON
   *  it, and the gable roof bar on top of the wall — each an ALREADY-PLACED tile carrying its authored level.
   *
   *  The levels are taken from `cellStackTop`, NOT hand-written, because that is literally what the stamper
   *  does (`stampBuildingComposition` → `baseLevel = cellStackTop(...)`, composition.ts:142). Hand-writing
   *  `heightLevel: 0` here authored a wall INSIDE the ground — a placement production stopped producing when
   *  the ground became a block like everything else. */
  const stampedHouseCell = (grid: IsometricGrid): { wall: GridAsset; roof: GridAsset } => {
    const base = cellStackTop(grid, C, R) // 1 on grass — the composition lands on top of the ground
    const place = (level: number, blocks: number): GridAsset => {
      const a = grid.placeAsset([''], C, R, { type: 'house_4', heightLevel: base + level })
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

    // The ground went from ONE block to two — a CHANGE of one, not of two — so the leaves shift by one and
    // keep floating clear. What matters is that they moved by the delta and were not re-seated onto the floor.
    expect(leaf.heightLevel).toBe(4)
  })

  test('LOWERING brings them back down — the lift is reversible, never a one-way ratchet', () => {
    const grid = mkGrid()
    grid.setGround(C, R, 'grass')
    const { wall, roof } = stampedHouseCell(grid)

    setTileHeight(grid, C, R, 0, 5)
    setTileHeight(grid, C, R, 0, 0) // "back to nothing" is back to ONE block — the floor of every tile

    expect(wall.heightLevel).toBe(1)
    expect(roof.heightLevel).toBe(5)
  })

  test('ANY tile lifts what is above it — not just the floor (raise the wall, the roof rises)', () => {
    const grid = mkGrid()
    grid.setGround(C, R, 'grass')
    const { wall, roof } = stampedHouseCell(grid)

    setTileHeight(grid, C, R, 1, 6) // the WALL (slot 1) goes from 4 blocks to 6

    expect(wall.heightLevel).toBe(1)  // the wall itself doesn't move — it grows upward from where it stands
    expect(roof.heightLevel).toBe(7)  // the roof sits on its new top (1 ground + 6 wall)
  })

  test('raising the TOP tile moves nothing — there is nothing above it to lift', () => {
    const grid = mkGrid()
    grid.setGround(C, R, 'grass')
    const { wall, roof } = stampedHouseCell(grid)

    setTileHeight(grid, C, R, 2, 9)

    expect(wall.heightLevel).toBe(1)
    expect(roof.heightLevel).toBe(5)
    expect(roof.height).toBe(9)
  })

  test("a tile SHRUNK then raised again lifts only what's ON it — never the ground under it", () => {
    // Alexander's repro: "stack two blocks, then select the bottom block and make it 0, then increase the
    // height — the top block moves correctly but the tile stays flat on the first block."
    // Shrinking the bottom block brings the tile above DOWN toward the ground. Lifting by "level >= the old
    // top" then swept the FLOOR up too, so the ground flew upward and drew as a flat tile where the block
    // should be. At equal levels, stack ORDER decides what is on top of what — that is what keeps the ground
    // out of it, with no floor branch anywhere in the rule.
    const grid = mkGrid()
    grid.setGround(C, R, 'grass')
    const block = (level: number, blocks: number): GridAsset => {
      const a = grid.placeAsset([''], C, R, { type: 'house_4', heightLevel: level })
      a.label = 'wall_wood_c'
      a.height = blocks
      return a
    }
    const bottom = block(1, 3) // on the 1-block ground, three blocks tall
    const top = block(4, 1)    // resting on its top
    const floor = grid.floorAt(C, R)!

    setTileHeight(grid, C, R, 1, 1) // slot 1 = the bottom block (slot 0 is the floor): 3 blocks → 1
    expect(top.heightLevel).toBe(2)   // it settles down onto the shrunken block
    expect(floor.heightLevel).toBe(0) // the ground has not moved

    setTileHeight(grid, C, R, 1, 3) // drag the SAME slot back up

    expect(bottom.height).toBe(3)
    expect(top.heightLevel).toBe(4)   // the block above rides up
    expect(floor.heightLevel).toBe(0) // …and the ground STAYS on the grid
  })

  test('ONE block is the floor of the model — asking for 0 leaves the tile a block tall, and moves nothing', () => {
    // "all tiles/blocks are height 1, GLOBAL, no exceptions" (Alexander, 2026-07-27). A height of 0 is not a
    // flat tile any more, it is simply not representable: resolveTileHeight clamps it back to one block. So
    // the edit is a no-op rather than a collapse, and nothing above it moves.
    const grid = mkGrid()
    grid.setGround(C, R, 'grass')
    const roof = grid.placeAsset([''], C, R, { type: 'house_4', heightLevel: 1 })
    roof.height = 2

    setTileHeight(grid, C, R, 0, 0) // try to flatten the ground

    expect(cellStackTop(grid, C, R)).toBe(3) // still 1 block of ground carrying a 2-block roof
    expect(roof.heightLevel).toBe(1)
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
    const wall = grid.placeAsset([''], spanned.col, spanned.row, { type: 'house_4', heightLevel: 1 })
    wall.height = 4 // level 1: standing ON the road tile, the way the stamper would place it

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

    setTileHeight(grid, C, R, 0, 2) // the ground under it goes from one block to two — a delta of ONE

    expect(roof.heightLevel).toBe(5)
  })

  test('a tile NOT over the raised tile stays put — the lift follows occupancy, not the whole map', () => {
    const grid = mkGrid()
    grid.setGround(C, R, 'grass')
    const elsewhere = grid.placeAsset([''], C + 5, R + 5, { type: 'house_4', heightLevel: 0 })
    elsewhere.height = 1

    setTileHeight(grid, C, R, 0, 4)

    expect(elsewhere.heightLevel).toBe(0)
  })

  test('heights are CONTINUOUS — a tile keeps the EXACT height it was given, never rounded to a block', () => {
    // Blocks are a unit of MEASUREMENT ("we can increase from 0.001 block size … doesn't necessarilly mean
    // everything is handled by integer numbers"). The tile's own height stays exact at any scale.
    const grid = mkGrid()
    grid.setGround(C, R, 'grass')
    const floor = grid.floorAt(C, R)!

    setTileHeight(grid, C, R, 0, 0.001)
    expect(floor.height).toBeCloseTo(0.001, 6)
    setTileHeight(grid, C, R, 0, 2.5)
    expect(floor.height).toBeCloseTo(2.5, 6)
    setTileHeight(grid, C, R, 0, 7.25)
    expect(floor.height).toBeCloseTo(7.25, 6)
  })

  test('…but what STANDS on it moves in whole blocks, because act_as_tile counts a cell as occupied', () => {
    // Alexander, 2026-07-26: *"act_as_tile set to true in ALL cells/block by default … houses stack on top of
    // the grass tiles instead of inside."* That default is what puts content on the ground rather than in it,
    // and it means a cell occupies AT LEAST one block for stacking however thin its tile is. So growing a flat
    // floor to 0.001 does not lift the house by a thousandth — the cell was already counting as one block, and
    // still is. The two rules meet here on purpose; the tile's own height (above) stays exact regardless.
    const grid = mkGrid()
    grid.setGround(C, R, 'grass')
    const wall = grid.placeAsset([''], C, R, { type: 'house_4', heightLevel: 1 })
    wall.height = 1

    setTileHeight(grid, C, R, 0, 0.001)
    expect(wall.heightLevel).toBe(1) // still standing on the one block the cell occupies

    setTileHeight(grid, C, R, 0, 2.5) // now the floor genuinely outgrows that block
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
