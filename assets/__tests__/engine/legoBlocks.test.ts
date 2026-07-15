/**
 * LEGO MODEL — end-to-end against the GRID (the source of truth). The requirement, as tests:
 * "anything on the grid is just a BLOCK or a collection of BLOCKS", and you can EDIT any block's content.
 * These assert grid state directly — no rendering, no selection UI (selection's screen hit-test lives in
 * isoPick.test.ts). If a building is a collection of editable blocks HERE, then the only things left are
 * rendering from those blocks and wiring the click — not "convert a building".
 */
import { IsometricGrid } from '@/engine/IsometricGrid'
import { getStack, pushTile } from '@/engine/cellStack'
import { makeBuilding } from '@/engine/buildingEditor'
import { stampBuildingCells } from '@/game/runtime/buildings'

const mkGrid = () => new IsometricGrid({ cols: 12, rows: 12, cellSize: 16, isoScale: 1.4 })

describe('lego model — everything on the grid is an editable block', () => {
  test('STACK: floor + pushed blocks form a column in the grid', () => {
    const grid = mkGrid()
    grid.setGround(4, 4, 'grass')
    pushTile(grid, 4, 4, { source: 'asset', slug: 'stone', h: 1, art: ['█'], type: 'block' })
    pushTile(grid, 4, 4, { source: 'asset', slug: 'stone', h: 1, art: ['█'], type: 'block' })
    const stack = getStack(grid, 4, 4)
    expect(stack.map(t => t.source)).toEqual(['floor', 'asset', 'asset']) // floor + a 2-block column
    expect(stack[2].h).toBe(1)                                            // the top block carries its height
    // ROOT CAUSE of the "#42 picks the bottom cell" bug, surfaced objectively: pushTile numbers stacked
    // blocks from 0 (stack[1] = level 0, stack[2] = level 1), and pickIsoBlock only treats heightLevel >= 1
    // as a "raised" block. So a building's single tall block (level 0, height = floors) is NOT seen as raised
    // and the click falls through to the flat ground cell. That off-by-one is one of the two gaps to close.
    expect(stack[1].heightLevel).toBe(0)
    expect(stack[2].heightLevel).toBe(1)
  })

  test('EDIT any block content → the grid reflects it (color + reskin + size)', () => {
    const grid = mkGrid()
    grid.setGround(4, 4, 'grass')
    const wall = pushTile(grid, 4, 4, { source: 'asset', slug: 'stone', h: 1, art: ['█'], type: 'block' })
    wall.color = '#ff0000'
    wall.tileOverride = 'emoji:brick'
    wall.scaleX = 0.5
    const [, block] = getStack(grid, 4, 4)
    expect(block.color).toBe('#ff0000')
    expect(block.tileId).toBe('emoji:brick')
    expect(block.w).toBe(0.5)
  })

  test('a BUILDING on the grid is a collection of editable blocks — no special "building" needed', () => {
    const grid = mkGrid()
    const b = makeBuilding('house', 'south', 6, 6)
    stampBuildingCells(grid, b, 'spring')

    // A building is BLOCKS on the grid — plain `type:'structure'` tiles, no special "building" type.
    const buildingBlocks = grid.assets.filter(a => a.type === 'structure')
    expect(buildingBlocks.length).toBeGreaterThan(0)

    // Each block appears in its cell's UNIFORM stack (same shape as any other block).
    const a0 = buildingBlocks[0]
    const stack = getStack(grid, a0.col, a0.row)
    expect(stack.some(t => t.source === 'asset')).toBe(true)

    // It's EDITABLE like any block — recolor it, the grid reflects.
    a0.color = '#123456'
    const after = getStack(grid, a0.col, a0.row).find(t => t.source === 'asset')
    expect(after?.color).toBe('#123456')

    // And a wall block must EXTRUDE (height >= 1) so it renders as a real lego cube, not flat.
    const wallBlock = buildingBlocks.find(a => a.label === 'wall')
    expect(wallBlock).toBeDefined()
    expect((wallBlock!.height ?? 0)).toBeGreaterThanOrEqual(1)
  })
})
