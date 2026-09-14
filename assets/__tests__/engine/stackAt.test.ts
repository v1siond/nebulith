/**
 * WHERE IN A CELL THE NEXT THING STANDS.
 *
 * The shape of the answer, which was right:
 *
 * A cell stacks by each tile's own HEIGHT. A GENERATED bloom carries a per-instance height of 1 on purpose,
 * from `GENERATED_PROP_RENDER` (), so it draws as a
 * standing billboard rather than a coloured cube. That same block was then counted as a SURFACE, so a tree
 * stamped onto a flowered cell started one level up. How tall a thing DRAWS and whether you can stand on it
 * were one number, and `stackAt` splits them: 1 is the top face (the default, unchanged), 0 is the bottom.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { cellStackTop, unitStandLevel } from '@/engine/cellStack'
import { IsometricGrid } from '@/engine/IsometricGrid'
import { GENERATED_PROP_RENDER, generatedPropRender } from '@/engine/stageGenerator'
import { styleTile } from '@/engine/tileset/styleTiles'

/** Place one tile in a fresh cell, exactly the way `applyStageToGrid` places a generated prop. */
const cellWith = (label: string, extra?: Record<string, unknown>) => {
  const grid = new IsometricGrid(4, 4, 32)
  const tile = styleTile('ascii', label) ?? styleTile('emoji', label)
  grid.placeAsset([tile?.char ?? '?'], 1, 1, { type: label, label, heightLevel: 0, ...extra })
  return grid
}

describe('stackAt, the y stack position', () => {
  it('a GENERATED bloom stands a block tall and still holds nothing up', () => {
    // This is the exact shape applyStageToGrid builds: the label's row plus the per-instance render override.
    expect(GENERATED_PROP_RENDER.flower.height).toBe(1)
    const grid = cellWith('flower', generatedPropRender('flower'))
    expect(cellStackTop(grid, 1, 1)).toBe(0)
  })

  it('the same billboard WOULD have lifted a tree before, which is the bug he photographed', () => {
    // Same one-block billboard, with the setting off. Without this contrast the test above proves nothing:
    // a fixture whose flower row is flat would pass it either way.
    const lifted = cellWith('flower', { ...generatedPropRender('flower'), settings: { stackAt: 1 } })
    expect(cellStackTop(lifted, 1, 1)).toBe(1)
  })

  it('a tile that says nothing still lifts what lands on it, exactly as before', () => {
    expect(cellStackTop(cellWith('thicket'), 1, 1)).toBe(1)
    expect(cellStackTop(cellWith('tree'), 1, 1)).toBe(1)
  })

  it('a flat tile is still flat, and an empty cell is still zero', () => {
    expect(cellStackTop(cellWith('tall_grass'), 1, 1)).toBe(0)
    expect(cellStackTop(new IsometricGrid(4, 4, 32), 1, 1)).toBe(0)
  })

  it('a tree dropped on a flowered cell lands at the flower FEET, not on its head', () => {
    const grid = cellWith('flower', generatedPropRender('flower'))
    const treeLevel = cellStackTop(grid, 1, 1)
    expect(treeLevel).toBe(0)
    grid.placeAsset(['T'], 1, 1, { type: 'tree', label: 'tree', heightLevel: treeLevel })
    // …and the tree itself, which says nothing, still lifts the NEXT thing.
    expect(cellStackTop(grid, 1, 1)).toBe(1)
  })

  it('a per-instance value beats the tile row, both ways', () => {
    expect(cellStackTop(cellWith('thicket', { settings: { stackAt: 0 } }), 1, 1)).toBe(0)
    expect(cellStackTop(cellWith('flower', { height: 1, settings: { stackAt: 1 } }), 1, 1)).toBe(1)
  })

  it('a nonsense value falls back to the top face rather than sinking the stack', () => {
    for (const bad of [-1, 2, Number.NaN, 'yes']) {
      expect({ bad, top: cellStackTop(cellWith('thicket', { settings: { stackAt: bad } }), 1, 1) })
        .toEqual({ bad, top: 1 })
    }
  })

  it('the ground plants carry the setting in the served catalog, not just in code', () => {
    // If the backend stops serving it, the mechanism is inert and nothing else here would notice.
    for (const label of ['flower', 'clover', 'wheat', 'bush']) {
      const tile = styleTile('ascii', label)
      expect({ label, stackAt: (tile?.settings as { stackAt?: number } | undefined)?.stackAt }).toEqual({ label, stackAt: 0 })
    }
  })

  it('a unit is unaffected, because it stands on the GROUND and never on a plant', () => {
    expect(unitStandLevel(cellWith('flower', generatedPropRender('flower')), 1, 1)).toBe(0)
    expect(unitStandLevel(cellWith('thicket'), 1, 1)).toBe(0)
  })
})
