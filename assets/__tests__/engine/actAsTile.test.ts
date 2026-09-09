/**
 * ACT AS TILE — the "cell behaves as if a tile is already inside it" setting (Alexander, verbatim):
 *   "a cell/block is EMPTY until we put a tile inside; after that any other tile put in the same block STACKS
 *    ON TOP. act_as_tile means the cell works by default AS IF a tile was inside it already, so the next tile
 *    stacks on top. Default is FALSE; we set it in compositions when it makes sense — roads, whatever we walk over."
 *
 * The lego model is UNCHANGED: a tile occupies `its level + its own height`, and content stacks on the tallest.
 * `act_as_tile` only makes a tile count as an occupant of AT LEAST ONE block, so content stacks ON TOP of it
 * EVEN WHEN THE TILE IS FLAT (height 0) — a flat road you walk over lifts the walker to level 1 without being
 * raised. Height-≥1 tiles are already ≥1, so they are byte-identical (the legos stay legos). Decoupled from height.
 */
import { makeStyleTile, setStyleTile, styleTile } from '@/engine/tileset/styleTiles'
import { pushTile } from '@/engine/cellStack'
import { IsometricGrid } from '@/engine/IsometricGrid'

const FLAT_PLAIN = '__flat_plain__' // a flat tile (height 0) — content overlaps it at level 0 (default)
const FLAT_ACT = '__flat_act__'     // a flat tile marked act_as_tile — content stacks ON TOP at level 1
const TALL_PLAIN = '__tall_plain__' // a height-1 plain block — content stacks on top (legos, unchanged)
const TOP = '__topper__'

beforeAll(() => {
  setStyleTile('ascii', FLAT_PLAIN, makeStyleTile(FLAT_PLAIN, { char: '.', position: 'single', walkable: true, colorRole: 'ground', height: 0 }))
  setStyleTile('ascii', FLAT_ACT, makeStyleTile(FLAT_ACT, { char: '.', position: 'single', walkable: true, colorRole: 'ground', height: 0, settings: { actAsTile: true } }))
  setStyleTile('ascii', TALL_PLAIN, makeStyleTile(TALL_PLAIN, { char: '#', position: 'single', walkable: true, colorRole: 'ground', height: 1 }))
  setStyleTile('ascii', TOP, makeStyleTile(TOP, { char: '@', position: 'single', walkable: true, colorRole: 'ground', height: 1 }))
})
afterAll(() => {
  delete styleTile('ascii', FLAT_PLAIN)
  delete styleTile('ascii', FLAT_ACT)
  delete styleTile('ascii', TALL_PLAIN)
  delete styleTile('ascii', TOP)
})

const grid = () => new IsometricGrid({ cols: 6, rows: 6, cellSize: 32, isoScale: 1.4 })
const push = (g: IsometricGrid, type: string, art: string, h: number) =>
  pushTile(g, 2, 2, { source: 'asset', type, art: [art], h, collision: false })

describe('act_as_tile — a FLAT tile lifts content ON TOP; without it content overlaps at its level', () => {
  test('flat tile, act_as_tile OFF (default) → the next tile lands INSIDE at level 0 (overlaps)', () => {
    const g = grid()
    push(g, FLAT_PLAIN, '.', 0)
    expect(push(g, TOP, '@', 1).heightLevel).toBe(0)
  })

  test('flat tile, act_as_tile ON → the next tile stacks ON TOP at level 1 (walk-over surface), NOT raising the tile', () => {
    const g = grid()
    push(g, FLAT_ACT, '.', 0)
    expect(push(g, TOP, '@', 1).heightLevel).toBe(1)
  })

  test('the lego model is untouched: a height-1 PLAIN block still stacks content on top (level 1)', () => {
    const g = grid()
    push(g, TALL_PLAIN, '#', 1)
    expect(push(g, TOP, '@', 1).heightLevel).toBe(1)
  })
})
