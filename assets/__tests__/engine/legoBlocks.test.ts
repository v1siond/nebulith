/**
 * LEGO MODEL — end-to-end against the GRID (the source of truth). The requirement, as tests:
 * "anything on the grid is just a BLOCK or a collection of BLOCKS", and you can EDIT any block's content.
 * These assert grid state directly — no rendering, no selection UI (selection's screen hit-test lives in
 * isoPick.test.ts). If a building is a collection of editable blocks HERE, then the only things left are
 * rendering from those blocks and wiring the click — not "convert a building".
 */
import '@/__tests__/helpers/installTilesetSeed' // the building composition (house_4) comes from the loaded backend tileset fixture
import { IsometricGrid } from '@/engine/IsometricGrid'
import { getStack, pushTile } from '@/engine/cellStack'
import { stampBuildingComposition } from '@/game/runtime/composition'

const mkGrid = () => new IsometricGrid({ cols: 12, rows: 12, cellSize: 16, isoScale: 1.4 })

describe('lego model — everything on the grid is an editable block', () => {
  test('STACK: the floor STAYS as the base — pushed blocks stack ON TOP of it (stacked like legos)', () => {
    const grid = mkGrid()
    grid.setGround(4, 4, 'grass')
    pushTile(grid, 4, 4, { source: 'asset', slug: 'stone', h: 1, art: ['█'], type: 'block' })
    pushTile(grid, 4, 4, { source: 'asset', slug: 'stone', h: 1, art: ['█'], type: 'block' })
    const stack = getStack(grid, 4, 4)
    // Placing a tile STACKS (never replaces): the grass floor slab stays as slot 0, the first block sits on it
    // at level 0, the second stacks one level up — grass + two blocks, all in the cell's stack.
    expect(stack.map(t => t.type)).toEqual(['floor', 'block', 'block'])
    expect(stack[0].type).toBe('floor')     // the grass floor is NOT hidden — it stays beneath as its own tile
    expect(stack[1].heightLevel).toBe(0)    // the first block sits at level 0 (on the floor slab), not replacing it
    expect(stack[2].heightLevel).toBe(1)    // the second block stacks one level up
    expect(stack[2].h).toBe(1)              // the top block carries its height
  })

  test('EDIT any block content → the grid reflects it (color + reskin + size)', () => {
    const grid = mkGrid()
    grid.setGround(4, 4, 'grass')
    const wall = pushTile(grid, 4, 4, { source: 'asset', slug: 'stone', h: 1, art: ['█'], type: 'block' })
    wall.color = '#ff0000'
    wall.tileOverride = 'emoji:brick'
    wall.scaleX = 0.5
    const block = getStack(grid, 4, 4).find(t => t.type === 'block')! // the pushed block (the floor stays at slot 0)
    expect(block.color).toBe('#ff0000')
    expect(block.tileId).toBe('emoji:brick')
    expect(block.w).toBe(0.5)
  })

  test('a BUILDING on the grid is a collection of editable blocks — no special "building" needed', () => {
    const grid = mkGrid()
    stampBuildingComposition(grid, 'house', 4, 4, 4, 'spring', 'south') // footprint top-left (4,4), 4×4

    // A building is BLOCKS on the grid — plain per-cell tiles typed by the composition KIND, no "building" type.
    const buildingBlocks = grid.assets.filter(a => a.type === 'house_4')
    expect(buildingBlocks.length).toBeGreaterThan(0)
    expect(grid.assets.some(a => a.type === 'building')).toBe(false)

    // Each block appears in its cell's UNIFORM stack (same shape as any other block).
    const a0 = buildingBlocks[0]
    const stack = getStack(grid, a0.col, a0.row)
    expect(stack.some(t => t.source === 'asset')).toBe(true)

    // It's EDITABLE like any block — recolor it, the grid reflects. A building cell can stack several
    // blocks (wall + window + roof), so read back the block at a0's OWN level, not just the first asset.
    a0.color = '#123456'
    // Match the BUILDING block (its composition-kind type), not the grass floor that now also shares heightLevel 0.
    const after = getStack(grid, a0.col, a0.row).find(t => t.type === a0.type && (t.heightLevel ?? 0) === (a0.heightLevel ?? 0))
    expect(after?.color).toBe('#123456')

    // And a wall block must EXTRUDE (height >= 1) so it renders as a real lego cube, not flat.
    // house_4's walls resolve to its wood MATERIAL pieces (wall_wood_*), so match the wall FAMILY.
    const wallBlock = buildingBlocks.find(a => (a.label ?? '').startsWith('wall'))
    expect(wallBlock).toBeDefined()
    expect((wallBlock!.height ?? 0)).toBeGreaterThanOrEqual(1)
  })
})
