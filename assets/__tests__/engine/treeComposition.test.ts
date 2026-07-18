/**
 * COMPOSITION MODEL — the tree is the user's reference: every rich ascii asset is a COLLECTION of ascii tiles
 * placed across CELLS + LEVELS, stamped from the BACKEND DB tileset (no hardcoded frontend tile art), and each
 * tile is an independently SELECTABLE block — the SAME lego model buildings use (see legoBlocks.test.ts).
 * These assert grid state directly after stampComposition: the stacked per-cell blocks, the selectable-block
 * shape (heightLevel + height>=1 — the picker's gate), collision, and that glyph+colour come from the DB tile.
 */
import { IsometricGrid } from '@/engine/IsometricGrid'
import { getStack } from '@/engine/cellStack'
import { stampComposition } from '@/game/runtime/composition'
import { resolveComposition, resolveTile } from '@/engine/tileset/tileset'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'
import { useSeedTileset } from '@/__tests__/helpers/tilesetSeed'

const mkGrid = () => new IsometricGrid({ cols: 14, rows: 14, cellSize: 16, isoScale: 1.4 })

describe('tree composition — every ascii asset is a collection of selectable DB tiles', () => {
  useSeedTileset() // the DB-equivalent tileset the runtime loads (carries the tree_small / tree_dead compositions)

  test('the DB tileset SERVES the tree composition (nothing hardcoded on the frontend)', () => {
    const comp = resolveComposition(ASCII_TILESET, 'tree_small')
    expect(comp).not.toBeNull()
    expect(comp!.footprint).toEqual({ w: 5, h: 3 }) // the diagram: 5-wide canopy base, 3 DEEP (leaf sections repeated at dy -1/0/+1)
    expect(comp!.cells.length).toBe(30) // 3 trunk + a 3-deep canopy (L3 5-wide + L4 3-wide + L5 crown) repeated across dy -1/0/+1
  })

  test('stampComposition stacks tree_small as per-cell heightLevel blocks (trunk column + canopy blob)', () => {
    const grid = mkGrid()
    const placed = stampComposition(grid, 'tree_small', 7, 7, 'spring', 0)
    expect(placed).toBe(30)

    // Anchor column (7,7): a 3-cell TRUNK (L0-1-2) then the canopy centre up the widths — leaf L3, leaf L4, crown L5.
    const center = getStack(grid, 7, 7).filter(t => t.source === 'asset')
    expect(center.map(t => t.heightLevel)).toEqual([0, 1, 2, 3, 4, 5])
    expect(center.map(t => t.label)).toEqual(['trunk_base', 'trunk', 'trunk', 'leaf_center', 'leaf_center', 'leaf_top'])

    // The canopy widens DOWN the levels (the diagram): level 3 spans 5 cells (dx -2..2), level 4 spans 3 (dx -1..1).
    // Outermost base cells (dx ±2) carry ONE leaf at L3; the inner cells (dx ±1) carry a leaf at L3 AND L4.
    expect(getStack(grid, 5, 7).filter(t => t.source === 'asset').map(t => t.heightLevel)).toEqual([3]) // dx -2, base only
    expect(getStack(grid, 9, 7).filter(t => t.source === 'asset').map(t => t.heightLevel)).toEqual([3]) // dx +2, base only
    expect(getStack(grid, 6, 7).filter(t => t.source === 'asset').map(t => t.heightLevel)).toEqual([3, 4]) // dx -1, base + mid
    expect(getStack(grid, 8, 7).filter(t => t.source === 'asset').map(t => t.heightLevel)).toEqual([3, 4]) // dx +1, base + mid
  })

  test('EVERY composition tile is an independently selectable block (heightLevel set + height>=1 — the picker gate)', () => {
    const grid = mkGrid()
    stampComposition(grid, 'tree_small', 7, 7, 'spring', 0)
    const tiles = grid.assets.filter(a => a.type === 'tree_small')
    expect(tiles.length).toBe(30)
    for (const a of tiles) {
      // The isoBlocksUnder picker admits a tile as a selectable BLOCK when heightLevel>=1 OR height>=1.
      expect(a.height ?? 0).toBeGreaterThanOrEqual(1)
      expect(a.heightLevel).toBeGreaterThanOrEqual(0)
      expect(a.label).toBeTruthy() // the generic per-cell drawer keys off label (not the sprite path)
    }
    // A canopy tile and a trunk tile at DISTINCT (cell, level) slots → each is its own selectable block.
    const slots = new Set(tiles.map(a => `${a.col},${a.row},${a.heightLevel}`))
    expect(slots.size).toBe(30)
  })

  test('glyph + colour come from the DB tile, not hardcoded frontend art', () => {
    const grid = mkGrid()
    stampComposition(grid, 'tree_small', 7, 7, 'spring', 0)
    const leaf = grid.assets.find(a => a.label === 'leaf_center')!
    const dbLeaf = resolveTile(ASCII_TILESET, 'spring', 'leaf_center', 0)
    expect(leaf.art[0]).toBe(dbLeaf.char)   // glyph from the DB tile
    expect(leaf.color).toBe(dbLeaf.color)   // canopy colour from the DB palette
  })

  test('only the TRUNK cell blocks — the canopy is walkable overhead (you walk under the tree)', () => {
    const grid = mkGrid()
    stampComposition(grid, 'tree_small', 7, 7, 'spring', 0)
    expect(grid.isBlocked(7, 7)).toBe(true)  // the trunk cell blocks (trunk_base walkable:false at L0)
    // the canopy leaves are walkable, so the ground under them stays open — even though the trunk cell ALSO
    // holds a walkable canopy tile above it, the trunk's collision is never cleared.
    expect(grid.isBlocked(6, 7)).toBe(false) // canopy-left cell — walkable
    expect(grid.isBlocked(8, 7)).toBe(false) // canopy-right cell — walkable
    expect(grid.isBlocked(7, 6)).toBe(false) // canopy-front cell — walkable
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
    const base = grid.assets.find(a => a.label === 'trunk_base')!
    expect(base.baseShadow).toBe(true) // sits on the ground → casts a shadow, so the tree never looks floaty
    const canopy = grid.assets.find(a => a.label === 'leaf_center')!
    expect(canopy.baseShadow).toBeFalsy() // level 2 → a shadow here would float at canopy height
  })

  test('tree_dead stamps a 1-wide snag column (dead wood is the same selectable model)', () => {
    const grid = mkGrid()
    const placed = stampComposition(grid, 'tree_dead', 7, 7, 'winter', 0)
    expect(placed).toBe(3)
    const col = getStack(grid, 7, 7).filter(t => t.source === 'asset')
    expect(col.map(t => t.label)).toEqual(['trunk_base', 'trunk', 'snag'])
  })

  // ── The optimized living `tree` — EXACTLY 2 tiles (thin tall trunk + bigger leaf cube on top) ──────────
  test('the tree stamps EXACTLY 2 cells — a thin tall trunk (L0) + a bigger leaf cube lifted onto its top', () => {
    const grid = mkGrid()
    const placed = stampComposition(grid, 'tree', 7, 7, 'spring', 0)
    expect(placed).toBe(2) // Alexander's optimized reference: "just two tiles, one trunk, one leafs" (down from 3)

    const col = getStack(grid, 7, 7).filter(t => t.source === 'asset')
    expect(col.map(t => t.label)).toEqual(['trunk_mid', 'leaf_center'])
    expect(col.map(t => t.heightLevel)).toEqual([0, 2]) // trunk on the ground; leaf lifted to the trunk top

    // The user's hand-tuned settings ride the cell: trunk = Height(scaleY) 3.15 at Zoom(scale) 0.6 (thin tall
    // post); leaf = Height(scaleY) 2 at Zoom(scale) 1.35 (a bigger cube). All DATA — nothing hardcoded.
    const trunk = grid.assets.find(a => a.label === 'trunk_mid')!
    const leaf = grid.assets.find(a => a.label === 'leaf_center')!
    expect(trunk.scale).toBe(0.6)
    expect(trunk.scaleY).toBe(3.15)
    expect(leaf.scale).toBe(1.35)
    expect(leaf.scaleY).toBe(2)
  })

  test('the tree: only the trunk cell blocks — the leaf cube is walkable overhead', () => {
    const grid = mkGrid()
    stampComposition(grid, 'tree', 7, 7, 'spring', 0)
    expect(grid.isBlocked(7, 7)).toBe(true) // the trunk column blocks its cell
    expect(grid.assets.find(a => a.label === 'leaf_center')!.blocking).toBeFalsy() // canopy walkable overhead
  })

  test('a per-tree variant tints the leaf a different canopy SHADE (spring green → pink) — colour is a SETTING', () => {
    const g0 = mkGrid(); stampComposition(g0, 'tree', 7, 7, 'spring', 0)
    const g3 = mkGrid(); stampComposition(g3, 'tree', 7, 7, 'spring', 3)
    const c0 = g0.assets.find(a => a.label === 'leaf_center')!.color
    const c3 = g3.assets.find(a => a.label === 'leaf_center')!.color
    expect(c0).toBe('#7cc46a') // spring canopy shade 0 — the GREEN tree
    expect(c3).toBe('#e79ec8') // spring canopy shade 3 — the PINK tree; same label, colour is the per-tree SETTING
  })

  // ── The variant SET — small / tall / round, and the trunkless bush ────────────────────────────────────
  const TREE_VARIANTS = ['tree', 'tree_tall', 'tree_stub', 'tree_round'] as const

  test('every tree variant is EXACTLY 2 tiles — a trunk + a leaf (optimization: fewest tiles possible)', () => {
    for (const kind of TREE_VARIANTS) {
      const grid = mkGrid()
      const placed = stampComposition(grid, kind, 7, 7, 'spring', 0)
      expect(placed).toBe(2)
      const labels = grid.assets.filter(a => a.type === kind).map(a => a.label).sort()
      expect(labels).toEqual(['leaf_center', 'trunk_mid'])
    }
  })

  test('a bush is the trunkless variant — a SINGLE leaf tile, no trunk cell', () => {
    for (const kind of ['bush', 'bush_round']) {
      const grid = mkGrid()
      const placed = stampComposition(grid, kind, 7, 7, 'spring', 0)
      expect(placed).toBe(1) // one tile — the leanest asset
      const cells = grid.assets.filter(a => a.type === kind)
      expect(cells.map(a => a.label)).toEqual(['leaf_center'])
      expect(cells.some(a => a.label!.startsWith('trunk'))).toBe(false) // NO trunk
    }
  })

  test('the round variants render a CIRCLE canopy — shape ships on the leaf cell (square by default)', () => {
    const round = mkGrid(); stampComposition(round, 'tree_round', 7, 7, 'spring', 0)
    expect(round.assets.find(a => a.label === 'leaf_center')!.shape).toBe('circle')
    const square = mkGrid(); stampComposition(square, 'tree', 7, 7, 'spring', 0)
    expect(square.assets.find(a => a.label === 'leaf_center')!.shape ?? 'square').toBe('square')
  })

  // ── DIMENSION-SANITY: the trunk is never bigger than the leaves (Alexander's rule) ─────────────────────
  test('DIMENSION SANITY: for every tree variant the trunk is thinner + less zoomed than the leaves, and sits BELOW them', () => {
    for (const kind of TREE_VARIANTS) {
      const grid = mkGrid()
      stampComposition(grid, kind, 7, 7, 'spring', 0)
      const trunk = grid.assets.find(a => a.label === 'trunk_mid')!
      const leaf = grid.assets.find(a => a.label === 'leaf_center')!
      const trunkZoom = trunk.scale ?? 1
      const leafZoom = leaf.scale ?? 1
      const trunkWidth = (trunk.scaleX ?? 1) * trunkZoom // effective footprint width
      const leafWidth = (leaf.scaleX ?? 1) * leafZoom
      expect(trunkZoom).toBeLessThan(leafZoom) // never zoomed larger than the canopy
      expect(trunkWidth).toBeLessThan(leafWidth) // never wider than the canopy
      expect(leaf.heightLevel).toBeGreaterThan(trunk.heightLevel!) // leaves sit ABOVE the trunk
    }
  })
})
