/**
 * COMPOSITION MODEL, the tree is the user's reference: every rich ascii asset is a COLLECTION of ascii tiles
 * placed across CELLS + LEVELS, stamped from the BACKEND DB tileset (no hardcoded frontend tile art), and each
 * tile is an independently SELECTABLE block, the SAME lego model buildings use (see legoBlocks.test.ts).
 * These assert grid state directly after stampComposition: the stacked per-cell blocks, the selectable-block
 * shape (heightLevel + height>=1, the picker's gate), collision, and that glyph+colour come from the DB tile.
 */
import { assetIsSolid } from '@/engine/collisionBoxes'
import { styleCatalog } from '@/engine/tileset/styleTiles'
import { IsometricGrid } from '@/engine/IsometricGrid'
import { getStack } from '@/engine/cellStack'
import { stampComposition } from '@/game/runtime/composition'
import { resolveComposition, resolveTile } from '@/engine/tileset/tileset'
import { useSeedTileset } from '@/__tests__/helpers/tilesetSeed'

const mkGrid = () => new IsometricGrid({ cols: 14, rows: 14, cellSize: 16, isoScale: 1.4 })

describe('tree composition, every ascii asset is a collection of selectable DB tiles', () => {
  useSeedTileset() // the DB-equivalent tileset the runtime loads (carries the tree_small / tree_dead compositions)

  /**
   * `tree_small` is TWO cells, a trunk and a crown.
   *
   * It was 30 (a 5x3 canopy blob over a 3-cell trunk) and the backend cut it deliberately: and The fixture kept
    * serving the old 30-cell shape
   * long after the DB stopped, so these tests were pinned to a tree that no longer exists anywhere else.
   */
  const TREE_SMALL_CELLS = 2

  test('the DB tileset SERVES the tree composition (nothing hardcoded on the frontend)', () => {
    const comp = resolveComposition(styleCatalog('ascii'), 'tree_small')
    expect(comp).not.toBeNull()
    expect(comp!.footprint).toEqual({ w: 1, h: 1 }) // one cell wide: the canopy is one scaled crown, not a 5-wide blob
    expect(comp!.cells.length).toBe(TREE_SMALL_CELLS) // trunk_mid + leaf_center
  })

  test('stampComposition stacks tree_small as per-cell heightLevel blocks (trunk column + canopy blob)', () => {
    const grid = mkGrid()
    const placed = stampComposition(grid, 'tree_small', 7, 7, 'spring', 0)
    expect(placed).toBe(TREE_SMALL_CELLS)

    // Anchor column (7,7): a trunk, then its crown resting on it. TWO tiles, each scaled to its real
    // proportions (the trunk is scaleY 1.9 at half width, the crown scaleY 1.2 at 0.95), which is what
    // replaced the old 30-cell stack of whole blocks.
    //
    // The levels ARE the composition's own authored levels: the tree stands ON a FLAT ground tile and level 0
    // is that tile's surface. It used to be +1 across the board, back when every ground was a height-1 cube
    // ("all tiles/blocks are height 1, GLOBAL"). T-140 made the ground flat and the map's thickness the GRID's,
    // so there is no block to climb. A trunk lands on the ground, not one block above it (Image #30).
    const center = getStack(grid, 7, 7).filter(t => t.type !== 'floor')
    expect(center.map(t => t.heightLevel)).toEqual([0, 1])
    expect(center.map(t => t.label)).toEqual(['trunk_mid', 'leaf_center'])

    // AND NOTHING SPILLS. The canopy used to widen down the levels across five cells (dx -2..2), which is why
    // this test used to read four neighbours. A 1x1 tree gets its width from the crown's own scale instead, so
    // the cells either side must be EMPTY. That is the property worth pinning: a tree occupies its own cell.
    for (const col of [5, 6, 8, 9]) {
      expect({ col, stacked: getStack(grid, col, 7).filter(t => t.type !== 'floor').length }).toEqual({ col, stacked: 0 })
    }
  })

  test('EVERY composition tile is an independently selectable block (heightLevel set + height>=1, the picker gate)', () => {
    const grid = mkGrid()
    stampComposition(grid, 'tree_small', 7, 7, 'spring', 0)
    const tiles = grid.assets.filter(a => a.type === 'tree_small')
    expect(tiles.length).toBe(TREE_SMALL_CELLS)
    for (const a of tiles) {
      // The isoBlocksUnder picker admits a tile as a selectable BLOCK when heightLevel>=1 OR height>=1.
      expect(a.height ?? 0).toBeGreaterThanOrEqual(1)
      expect(a.heightLevel).toBeGreaterThanOrEqual(0)
      expect(a.label).toBeTruthy() // the generic per-cell drawer keys off label (not the sprite path)
    }
    // A canopy tile and a trunk tile at DISTINCT (cell, level) slots → each is its own selectable block.
    const slots = new Set(tiles.map(a => `${a.col},${a.row},${a.heightLevel}`))
    expect(slots.size).toBe(TREE_SMALL_CELLS)
  })

  test('glyph + colour come from the DB tile, not hardcoded frontend art', () => {
    const grid = mkGrid()
    stampComposition(grid, 'tree_small', 7, 7, 'spring', 0)
    const leaf = grid.assets.find(a => a.label === 'leaf_center')!
    const dbLeaf = resolveTile(styleCatalog('ascii'), 'spring', 'leaf_center', 0)
    expect(leaf.art[0]).toBe(dbLeaf.char)   // glyph from the DB tile
    expect(leaf.color).toBe(dbLeaf.color)   // canopy colour from the DB palette
  })

  test('only the TRUNK cell blocks, the canopy is walkable overhead (you walk under the tree)', () => {
    const grid = mkGrid()
    stampComposition(grid, 'tree_small', 7, 7, 'spring', 0)
    expect(grid.isBlocked(7, 7)).toBe(true)  // the trunk cell blocks (trunk_base walkable:false at L0)
    // the canopy leaves are walkable, so the ground under them stays open, even though the trunk cell ALSO
    // holds a walkable canopy tile above it, the trunk's collision is never cleared.
    expect(grid.isBlocked(6, 7)).toBe(false) // canopy-left cell, walkable
    expect(grid.isBlocked(8, 7)).toBe(false) // canopy-right cell, walkable
    expect(grid.isBlocked(7, 6)).toBe(false) // canopy-front cell, walkable
  })

  test('a per-tree variant picks a different canopy shade (keep-all-variants: seasonal forests)', () => {
    const g0 = mkGrid(); stampComposition(g0, 'tree_small', 7, 7, 'spring', 0)
    const g1 = mkGrid(); stampComposition(g1, 'tree_small', 7, 7, 'spring', 3)
    const c0 = g0.assets.find(a => a.label === 'leaf_center')!.color
    const c3 = g1.assets.find(a => a.label === 'leaf_center')!.color
    expect(c0).not.toBe(c3) // variant 0 vs 3 → distinct canopy tones from the DB palette
  })

  test('the grounded trunk base casts a shadow (level-0 tiles carry baseShadow, higher ones do not)', () => {
    const grid = mkGrid()
    stampComposition(grid, 'tree_small', 7, 7, 'spring', 0)
    // The grounded cell is `trunk_mid` now, not `trunk_base`: the two-tile tree has one trunk piece, stretched.
    const base = grid.assets.find(a => a.label === 'trunk_mid')!
    expect(base.baseShadow).toBe(true) // sits on the ground → casts a shadow, so the tree never looks floaty
    const canopy = grid.assets.find(a => a.label === 'leaf_center')!
    expect(canopy.baseShadow).toBeFalsy() // level 1 → a shadow here would float at canopy height
  })

  test('tree_dead stamps a 1-wide snag column (dead wood is the same selectable model)', () => {
    const grid = mkGrid()
    const placed = stampComposition(grid, 'tree_dead', 7, 7, 'winter', 0)
    expect(placed).toBe(3)
    const col = getStack(grid, 7, 7).filter(t => t.type !== 'floor')
    expect(col.map(t => t.label)).toEqual(['trunk_base', 'trunk', 'snag'])
  })

  // ── The optimized living `tree`, EXACTLY 2 tiles (thin tall trunk + bigger leaf cube on top) ──────────
  test('the tree stamps EXACTLY 2 cells, a thin tall trunk on the ground + a bigger leaf cube on its top', () => {
    const grid = mkGrid()
    const placed = stampComposition(grid, 'tree', 7, 7, 'spring', 0)
    expect(placed).toBe(2) // (down from 3)

    const col = getStack(grid, 7, 7).filter(t => t.type !== 'floor')
    expect(col.map(t => t.label)).toEqual(['trunk_mid', 'leaf_center'])
    expect(col.map(t => t.heightLevel)).toEqual([0, 2]) // trunk ON the flat ground; leaf lifted to the trunk top

    // The hand-tuned settings ride the cell, with the cell's Zoom FOLDED INTO the axes: a trunk at
    // Height 3.15 and Zoom 0.6 is Height 1.89 across a 0.6 footprint, which is the same thin tall post
    // drawn without a fourth multiplier. All DATA, nothing hardcoded.
    const trunk = grid.assets.find(a => a.label === 'trunk_mid')!
    const leaf = grid.assets.find(a => a.label === 'leaf_center')!
    expect(trunk.width).toBeCloseTo(0.6, 5)
    expect(trunk.depth).toBeCloseTo(0.6, 5)
    expect(trunk.height).toBeCloseTo(3.15 * 0.6, 5)
    expect(leaf.width).toBeCloseTo(1.35, 5)
    expect(leaf.depth).toBeCloseTo(1.35, 5)
    expect(leaf.height).toBeCloseTo(2 * 1.35, 5)
  })

  test('the tree: only the trunk cell blocks, the leaf cube is walkable overhead', () => {
    const grid = mkGrid()
    stampComposition(grid, 'tree', 7, 7, 'spring', 0)
    expect(grid.isBlocked(7, 7)).toBe(true) // the trunk column blocks its cell
    expect(assetIsSolid(grid.assets.find(a => a.label === 'leaf_center')!)).toBe(false) // canopy walkable overhead
  })

  test('a per-tree variant tints the leaf a different canopy SHADE (spring green → pink), colour is a SETTING', () => {
    const g0 = mkGrid(); stampComposition(g0, 'tree', 7, 7, 'spring', 0)
    const g3 = mkGrid(); stampComposition(g3, 'tree', 7, 7, 'spring', 3)
    const c0 = g0.assets.find(a => a.label === 'leaf_center')!.color
    const c3 = g3.assets.find(a => a.label === 'leaf_center')!.color
    expect(c0).toBe('#7cc46a') // spring canopy shade 0, the GREEN tree
    expect(c3).toBe('#e79ec8') // spring canopy shade 3, the PINK tree; same label, colour is the per-tree SETTING
  })

  // ── The variant SET, small / tall / round, and the trunkless bush ────────────────────────────────────
  const TREE_VARIANTS = ['tree', 'tree_tall', 'tree_stub', 'tree_round'] as const

  test('every tree variant is EXACTLY 2 tiles, a trunk + a leaf (optimization: fewest tiles possible)', () => {
    for (const kind of TREE_VARIANTS) {
      const grid = mkGrid()
      const placed = stampComposition(grid, kind, 7, 7, 'spring', 0)
      expect(placed).toBe(2)
      const labels = grid.assets.filter(a => a.type === kind).map(a => a.label).sort()
      expect(labels).toEqual(['leaf_center', 'trunk_mid'])
    }
  })

  test('a bush is the trunkless variant, a SINGLE leaf tile, no trunk cell', () => {
    for (const kind of ['bush', 'bush_round']) {
      const grid = mkGrid()
      const placed = stampComposition(grid, kind, 7, 7, 'spring', 0)
      expect(placed).toBe(1) // one tile, the leanest asset
      const cells = grid.assets.filter(a => a.type === kind)
      expect(cells.map(a => a.label)).toEqual(['leaf_center'])
      expect(cells.some(a => a.label!.startsWith('trunk'))).toBe(false) // NO trunk
    }
  })

  test('a round-crowned species renders a CIRCLE canopy, and a CONE keeps its box', () => {
    // a canopy that is a cube reads wrong, so every round-crowned species says circle
    // now, the plain `tree` included. The square case moved to `tree_conifer`, which is genuinely NOT round:
    // the renderer draws `square` and `circle` and nothing else, so a cone keeps the box until one exists.
    for (const kind of ['tree_round', 'tree'] as const) {
      const round = mkGrid(); stampComposition(round, kind, 7, 7, 'spring', 0)
      expect({ kind, shape: round.assets.find(a => a.label === 'leaf_center')!.shape }).toEqual({ kind, shape: 'circle' })
    }
    const cone = mkGrid(); stampComposition(cone, 'tree_conifer', 7, 7, 'spring', 0)
    expect(cone.assets.find(a => a.label === 'leaf_center')!.shape ?? 'square').toBe('square')
  })

  // ── DIMENSION-SANITY: the trunk is never bigger than the leaves ─────────────────────
  test('DIMENSION SANITY: for every tree variant the trunk is narrower and shallower than the leaves, and sits BELOW them', () => {
    for (const kind of TREE_VARIANTS) {
      const grid = mkGrid()
      stampComposition(grid, kind, 7, 7, 'spring', 0)
      const trunk = grid.assets.find(a => a.label === 'trunk_mid')!
      const leaf = grid.assets.find(a => a.label === 'leaf_center')!
      // The axes ARE the footprint now; there is no separate multiplier to fold in first.
      const trunkWidth = trunk.width ?? 1
      const leafWidth = leaf.width ?? 1
      expect(trunk.depth ?? 1).toBeLessThan(leaf.depth ?? 1) // never deeper than the canopy
      expect(trunkWidth).toBeLessThan(leafWidth) // never wider than the canopy
      expect(leaf.heightLevel).toBeGreaterThan(trunk.heightLevel!) // leaves sit ABOVE the trunk
    }
  })
})
