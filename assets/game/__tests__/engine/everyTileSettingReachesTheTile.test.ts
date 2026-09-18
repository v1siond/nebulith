/**
 * EVERY TILE SETTING REACHES EVERY TILE, THROUGH THE SAME PATH.
 *
 * His rule, stated twice and broken twice: *"this should be backend data, we receive the existing objects from
 * backend and are correctly processed by the frontend methods … again, is against our principles, we should
 * also look for other examples of violations like the last prompt where colors weren't settings"*.
 *
 * MEASURED 2026-09-14. The backend serves `transparent: true` on 12 tiles: every flower, and every piece the
 * four entrances are built from (dead-tree, oak-tree, boulder, pillar, torii-gate, lamp, cliff_face, mushroom,
 * red-mushroom). `transparent` drops the cube SHELL so only the tile's own picture shows, which is the whole
 * fix for *"what the hell is that ugly tetris piece?????"*.
 *
 * It reached the renderer on exactly ONE path: `GENERATED_PROP_RENDER`, a hardcoded table in the generator
 * keyed by prop TYPE, holding two entries. `tileRenderBehavior` is the function that copies a tile's settings
 * onto a placed asset, and it copied `display` and not `transparent`, so every composition cell, every
 * hand-painted tile and every generated prop outside those two types drew its cube shell anyway. The seeded
 * entrance fix was inert.
 *
 * So this asserts the PATH, not one tile: a setting the backend states arrives on the asset the renderer reads.
 */
import { makeStyleTile, setStyleTile, styleCatalog } from '@/engine/tileset/styleTiles'
import { tileRenderBehavior, type Composition } from '@/engine/tileset/tileset'
import { stampComposition } from '@/game/runtime/composition'
import { IsometricGrid } from '@/engine/IsometricGrid'

describe('a tile setting the backend states reaches the asset', () => {
  it('carries `transparent`, which is what drops the cube shell', () => {
    expect(tileRenderBehavior({ transparent: true })).toMatchObject({ transparent: true })
  })

  it('carries it alongside `display: single`, which is how a prop is authored', () => {
    // Exactly what `/api/tilesets` serves for `mushroom`, `oak-tree`, `pillar`, `torii-gate` and the rest.
    expect(tileRenderBehavior({ display: 'single', transparent: true })).toMatchObject({
      display: 'single',
      transparent: true,
    })
  })

  it('still carries every setting it already did, so nothing rode out on this change', () => {
    expect(tileRenderBehavior({ fadeNear: true, cutawayRoof: true, minAlpha: 0.4, display: 'single' })).toMatchObject({
      fadeNear: true,
      cutawayRoof: true,
      minAlpha: 0.4,
      display: 'single',
    })
  })

  it('says nothing for a tile that opts into nothing, so a default tile is untouched', () => {
    expect(tileRenderBehavior({ color: '#ff0000', height: 1 })).toBeUndefined()
    expect(tileRenderBehavior(undefined)).toBeUndefined()
  })

  it('does not invent it: a tile that says nothing about transparency carries nothing', () => {
    expect(tileRenderBehavior({ display: 'single' })?.transparent).toBeUndefined()
    expect(tileRenderBehavior({ transparent: false })?.transparent).toBeUndefined()
  })
})

describe('the settings the four entrances are authored with', () => {
  // Curled off `/api/tilesets` on 2026-09-14. These are the pieces the entrances are built from, and this is
  // the pair each one is authored with: centre the picture, drop the box. Worth stating that the TILE rows
  // carry none of this: `boulder` and `oak-tree` declare only `collision`, `color`, `colors` and `fadeNear`.
  // The pair lives on the composition CELL, which is what the block below covers.
  const SERVED: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ['dead-tree', { display: 'single', transparent: true }],
    ['oak-tree', { display: 'single', transparent: true }],
    ['boulder', { display: 'single', transparent: true }],
    ['pillar', { display: 'single', transparent: true }],
    ['torii-gate', { display: 'single', transparent: true }],
    ['lamp', { display: 'single', transparent: true }],
    ['cliff_face', { display: 'single', transparent: true }],
    ['mushroom', { display: 'single', transparent: true }],
    ['red-mushroom', { display: 'single', transparent: true }],
    ['bouquet', { display: 'single', transparent: true }],
    ['flower', { display: 'single', transparent: true }],
  ]

  it.each(SERVED)('%s arrives with its shell dropped', (_label, settings) => {
    expect(tileRenderBehavior(settings)).toMatchObject({ display: 'single', transparent: true })
  })
})

/**
 * THE PATH THAT WAS ACTUALLY BROKEN: the composition CELL.
 *
 * Measured on the live backend 2026-09-14, and it is not what it looked like: the TILE rows for `boulder`,
 * `oak-tree`, `dead-tree` and the rest carry only `collision`, `color`, `colors` and `fadeNear`. Not one of
 * them declares `transparent`. The entrances declare it on their composition CELLS, which is where a
 * per-instance authored setting belongs.
 *
 * And the cell path forwarded exactly one key. `cellSettings` read `cell.settings?.display` and nothing else,
 * so `transparent` was dropped off the same object it had just copied `display` from. A stamped
 * `forest_entrance` came back carrying `display: 'single'` and no `transparent`, which is why every piece kept
 * its coloured box and the tetris piece was seeded-but-never-rendered.
 */
describe('a composition cell keeps every render setting it was authored with', () => {
  const SHELLED = '__tr_shelled__'
  const BARE = '__tr_bare__'
  const KIND = '__tr_gateway__'

  beforeAll(() => {
    // Two tiles identical in every way. What differs is what the CELL says about each, which is the point.
    for (const label of [SHELLED, BARE]) {
      setStyleTile('ascii', label, makeStyleTile(label, { char: 'T', walkable: false, colorRole: 'nature' }))
    }
    ;(styleCatalog('ascii').compositions as Record<string, Composition>)[KIND] = {
      footprint: { w: 2, h: 1 },
      cells: [
        // Exactly how an entrance upright is seeded: the piece itself, no box around it.
        { dx: 0, dy: 0, level: 0, label: BARE, settings: { display: 'single', transparent: true } },
        // The control: same tile, same cell shape, opting into nothing.
        { dx: 1, dy: 0, level: 0, label: SHELLED },
      ],
    }
  })

  afterAll(() => {
    delete (styleCatalog('ascii').compositions as Record<string, Composition>)[KIND]
  })

  it('carries an authored `transparent` onto the placed asset, which is what the renderer reads', () => {
    const grid = new IsometricGrid({ cols: 8, rows: 8, cellSize: 32, isoScale: 1.4 })
    expect(stampComposition(grid, KIND, 2, 2, 'spring')).toBe(2)
    expect(grid.assets.find(a => a.label === BARE)?.settings).toMatchObject({ display: 'single', transparent: true })
  })

  it('leaves a cell that opted into nothing exactly as it was, so no object changed by accident', () => {
    const grid = new IsometricGrid({ cols: 8, rows: 8, cellSize: 32, isoScale: 1.4 })
    stampComposition(grid, KIND, 2, 2, 'spring')
    expect(grid.assets.find(a => a.label === SHELLED)?.settings?.transparent).toBeUndefined()
  })
})
