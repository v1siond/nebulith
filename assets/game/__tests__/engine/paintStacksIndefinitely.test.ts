/**
 * PAINTING A TILE ONTO A CELL STACKS IT, EVERY TIME, FOR EVER.
 *
 * His report: *"I clicked to add a tile, then clicked again toa dd another tile on top of the 1 one a nothing
 * happened... they should stack indifinately"*.
 *
 * Measured on the running editor: painting `bush` three times produced three assets all at `heightLevel` 0,
 * drawn inside one another, so the map looked unchanged. `bush`, `flower` and `blossom` serve
 * `settings.stackAt: 0`, and `cellStackTop` multiplies a tile's block height by `stackAt`, so each one
 * contributed `1 x 0 = 0` and the next paint landed back at the bottom.
 *
 * `stackAt` is NOT wrong, and this does not remove it. It answers "where in this tile does the next thing
 * STAND", which is why a generated tree stamped onto a flowered cell correctly lands at the flower's feet
 * (`stackAt.test.ts`). The defect is that one number was answering a second, different question: "where does
 * a tile the USER just clicked to place go". A person clicking a cell that already holds something has said
 * exactly where they want it, which is on top, and MAP-MODEL §4's lego law is the same answer.
 *
 * So placement reads the tile's own OCCUPIED HEIGHT and the generator keeps reading `stackAt`.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { cellStackTop, getStack } from '@/engine/cellStack'
import { IsometricGrid } from '@/engine/IsometricGrid'
import { stackAssetTile } from '@/game/editor/tileBrush'
import { styleTile } from '@/engine/tileset/styleTiles'
import type { TileDef } from '@/game/artStyle'

/** A catalog tile as the Library hands it to the brush, read from the seeded tileset, never hand-built. */
const paletteTile = (label: string): TileDef => {
  const t = styleTile('ascii', label) ?? styleTile('emoji', label)
  if (!t) throw new Error(`no seeded tile ${label}`)
  return {
    id: `ascii:${label}`,
    label,
    category: 'nature',
    height: t.height,
    settings: t.settings,
    visual: { kind: 'ascii', char: t.char },
  } as unknown as TileDef
}

const levels = (grid: IsometricGrid, col: number, row: number): number[] =>
  getStack(grid, col, row).map(t => t.heightLevel ?? 0)

describe('painting stacks indefinitely', () => {
  /**
   * `bush` is the reproduction: a block-tall tile serving `stackAt: 0`.
   *
   * The live catalog has `flower`, `blossom`, `rose` and `fallen-leaf` in exactly the same shape (height 1,
   * `stackAt` 0, since the `a_bloom_is_not_ground_cover` migration made a bloom a standing billboard rather
   * than ground cover), so they hit this too. They are NOT driven here: `src/__tests__/fixtures/tilesets.json`
   * still carries the pre-migration height 0 for them, and topping that up cascades into
   * `game/tileBrush.test.ts`, whose `(DB height 0) inserts FLAT` cases are stale against the same migration.
   * That drift is worth fixing on its own; riding on it to prove THIS fix would just hide it.
   */
  it('bush paints on top of itself, not inside itself', () => {
    const tile = paletteTile('bush')
    expect(tile.height).toBe(1)
    expect((tile.settings as { stackAt?: number } | undefined)?.stackAt).toBe(0)
    const grid = new IsometricGrid(8, 8, 32)

    stackAssetTile(grid, 2, 2, tile)
    stackAssetTile(grid, 2, 2, tile)
    stackAssetTile(grid, 2, 2, tile)

    // Three DISTINCT levels. Before the fix this was [0, 0, 0] and the map looked untouched.
    expect(levels(grid, 2, 2)).toEqual([0, 1, 2])
  })

  it('stacks any block-tall tile that holds nothing up, whatever its label', () => {
    // The RULE, stated without depending on which labels the catalog currently ships as blooms.
    const grid = new IsometricGrid(8, 8, 32)
    const billboard = { ...paletteTile('bush'), id: 'ascii:billboard', height: 1, settings: { stackAt: 0 } } as TileDef
    stackAssetTile(grid, 6, 6, billboard)
    stackAssetTile(grid, 6, 6, billboard)
    expect(levels(grid, 6, 6)).toEqual([0, 1])
  })

  it('keeps stacking well past any cap, because "indefinitely" is the requirement', () => {
    const tile = paletteTile('bush')
    const grid = new IsometricGrid(8, 8, 32)
    for (let i = 0; i < 40; i++) stackAssetTile(grid, 3, 3, tile)
    expect(levels(grid, 3, 3)).toEqual(Array.from({ length: 40 }, (_, i) => i))
  })

  it('a taller tile lifts the next paint by its OWN height, not by one', () => {
    const grid = new IsometricGrid(8, 8, 32)
    const wall = { ...paletteTile('bush'), id: 'ascii:tall', height: 3 } as TileDef
    stackAssetTile(grid, 4, 4, wall)
    stackAssetTile(grid, 4, 4, wall)
    expect(levels(grid, 4, 4)).toEqual([0, 3])
  })

  it('leaves the GENERATOR rule alone: a stamp still lands at a flower\'s feet', () => {
    // The behaviour stackAt exists for, and the reason this fix is scoped to the paint path.
    const grid = new IsometricGrid(8, 8, 32)
    stackAssetTile(grid, 5, 5, paletteTile('flower'))
    expect(cellStackTop(grid, 5, 5)).toBe(0)
  })
})
