/**
 * ACT AS TILE — "does the cell behave as if a tile were already inside it", so the next tile stacks ON TOP.
 *
 * THIS SUITE ASSERTED A MODEL THAT HAS BEEN REPLACED TWICE, which is why every test in it failed. Both
 * changes are Alexander's, both are cited in the code that implements them, and together they leave this
 * setting with nothing left to do:
 *
 *  1. **The default flipped.** It was *"Default is FALSE; we set it in compositions when it makes sense —
 *     roads, whatever we walk over"*. On 2026-07-26: *"act_as_tile set to true in ALL cells/block by
 *     default … houses stack on top of the grass tiles instead of inside"*. `assetActsAsTile` follows that.
 *  2. **Flat tiles stopped existing.** On 2026-07-27: *"tiles only have data when they're assigned to a
 *     cell"* and *"all tiles/blocks are height 1, GLOBAL, no exceptions"*. `resolveTileHeight` reads the
 *     PLACED block's height, defaults it to 1, and clamps anything non-positive to 1.
 *
 * The second one is what empties the setting out. `stackContribution` is
 * `actsAsTile ? max(1, blocks) : blocks` — and `blocks` can no longer be less than 1, so both branches are
 * the same number. **`act_as_tile` cannot currently change any stacking outcome.** That is not a bug and it
 * is not asserted as desirable; it is the honest state, and it is recorded here because the alternative is a
 * suite that pretends to cover a live switch.
 *
 * What IS live, and what these tests now pin, is the lego rule the two decisions produced: every tile
 * occupies at least one block, a fresh cell already holds a floor, and heights accumulate.
 */
import { makeStyleTile, setStyleTile, styleTile } from '@/engine/tileset/styleTiles'
import { cellStackTop, pushTile } from '@/engine/cellStack'
import { IsometricGrid } from '@/engine/IsometricGrid'

const PLAIN = '__plain__'
const OPTED_OUT = '__opted_out__' // settings.actAsTile:false — kept to prove the switch is inert
const TOP = '__topper__'

beforeAll(() => {
  const tile = (label: string, settings?: Record<string, unknown>) =>
    makeStyleTile(label, { char: '.', position: 'single', walkable: true, colorRole: 'ground', ...(settings ? { settings } : {}) })
  setStyleTile('ascii', PLAIN, tile(PLAIN))
  setStyleTile('ascii', OPTED_OUT, tile(OPTED_OUT, { actAsTile: false }))
  setStyleTile('ascii', TOP, tile(TOP))
})
afterAll(() => {
  for (const label of [PLAIN, OPTED_OUT, TOP]) delete styleTile('ascii', label)
})

const grid = () => new IsometricGrid({ cols: 6, rows: 6, cellSize: 32, isoScale: 1.4 })
const push = (g: IsometricGrid, type: string, h?: number, settings?: Record<string, unknown>) =>
  pushTile(g, 2, 2, { source: 'asset', type, art: ['.'], ...(h === undefined ? {} : { h }), collision: false, ...(settings ? { settings } : {}) })

describe('every placed block occupies at least one block — "no exceptions"', () => {
  it('gives a tile pushed with height 0 a full block anyway', () => {
    // Alexander, 2026-07-27: *"all tiles/blocks are height 1, GLOBAL, no exceptions"*. A caller asking for
    // 0 is asking for something the model no longer has, and it is clamped rather than honoured.
    const g = grid()
    push(g, PLAIN, 0)
    expect(push(g, TOP).heightLevel).toBe(2)
  })

  it('gives a tile pushed with NO height a full block — the default is 1, not 0', () => {
    const g = grid()
    push(g, PLAIN)
    expect(push(g, TOP).heightLevel).toBe(2)
  })
})

describe('a fresh cell already holds a floor, and the floor is just a tile', () => {
  it('stacks the FIRST pushed tile on top of the floor rather than inside it', () => {
    // Alexander, 2026-07-26: *"houses stack on top of the grass tiles instead of inside"* — measured.
    expect(push(grid(), PLAIN).heightLevel).toBe(1)
  })

  it('reports the cell top as the floor alone when nothing has been pushed', () => {
    expect(cellStackTop(grid(), 2, 2)).toBe(1)
  })
})

describe('heights ACCUMULATE — the rule that makes it a lego model', () => {
  it('lands each tile on top of everything below it', () => {
    const g = grid()
    expect([push(g, PLAIN), push(g, PLAIN), push(g, TOP)].map(a => a.heightLevel)).toEqual([1, 2, 3])
  })

  it('multiplies a tile\'s own height by its scaleY when it spans several blocks', () => {
    const g = grid()
    pushTile(g, 2, 2, { source: 'asset', type: PLAIN, art: ['.'], h: 1, collision: false, scaleY: 4 })
    expect(push(g, TOP).heightLevel).toBe(5) // floor 1 + a 4-block column
  })
})

describe('the act_as_tile switch is currently INERT — recorded, not endorsed', () => {
  it('stacks identically whether a tile opts out or not', () => {
    const optedOut = grid()
    const plain = grid()
    push(optedOut, OPTED_OUT)
    push(plain, PLAIN)
    // `stackContribution` is `actsAsTile ? max(1, blocks) : blocks`, and blocks is always >= 1 since
    // 2026-07-27 — so the two branches cannot differ. If this test ever FAILS, the height model has gained
    // sub-block tiles again and the switch has become observable, which is worth knowing either way.
    expect(cellStackTop(optedOut, 2, 2)).toBe(cellStackTop(plain, 2, 2))
  })

  it('stacks identically with a per-INSTANCE override too', () => {
    const g = grid()
    push(g, PLAIN, undefined, { actAsTile: false })
    expect(push(g, TOP).heightLevel).toBe(2)
  })
})
