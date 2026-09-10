/**
 * ACT AS TILE — "does the cell behave as if a tile were already inside it", so the next tile stacks ON TOP.
 *
 * The switch is OPT-IN, and it is observable again. Both facts come out of Alexander's own decisions:
 *
 *  1. He originally described it as opt-in: *"Default is FALSE; we set it in compositions when it makes
 *     sense, roads, whatever we walk over"*. On 2026-07-26 he asked for the opposite: *"act_as_tile set to
 *     true in ALL cells/block by default … houses stack on top of the grass tiles instead of inside"*.
 *  2. At that time every ground was a height-1 cube, so default-TRUE was a NO-OP: `stackContribution` is
 *     `actsAsTile ? max(1, blocks) : blocks`, and both branches agree when blocks is already 1.
 *
 * T-140 then made the ground FLAT (*"floor are regular fucking tiles, nothing more nothing less"*) and moved
 * the map's thickness onto the GRID. That turned the dormant default into a live defect: a flat floor claimed
 * a block of vertical space that nothing draws, so every building was stamped one block clear of its own
 * floor. Alexander, Image #30: *"drawing issue base doesn't match buildings … the 'floor' of the building is
 * not aligned with the building itself"*.
 *
 * So the default went back to opt-in, which serves his 2026-07-26 GOAL unchanged. On a flat ground tile,
 * level 0 IS on top of it, there is no interior to sink into. That leaves the switch doing the job he first
 * described: a walk-over surface that is flat but still counts as an occupant.
 *
 * These tests pin both halves: the lego rule (a tile is as tall as its height says, heights accumulate, a
 * fresh cell already holds a floor) and the switch itself, on a FLAT tile, which is the only place it shows.
 */
import { makeStyleTile, setStyleTile, styleTile } from '@/engine/tileset/styleTiles'
import { cellStackTop, pushTile, setCellActAsTile } from '@/engine/cellStack'
import { IsometricGrid, type GridAsset } from '@/engine/IsometricGrid'

const PLAIN = '__plain__'
const OPTED_OUT = '__opted_out__' // settings.actAsTile:false, the explicit opt-out
const OPTED_IN = '__opted_in__'   // settings.actAsTile:true, a walk-over surface ("roads, whatever we walk over")
const TOP = '__topper__'

beforeAll(() => {
  const tile = (label: string, settings?: Record<string, unknown>) =>
    makeStyleTile(label, { char: '.', position: 'single', walkable: true, colorRole: 'ground', ...(settings ? { settings } : {}) })
  setStyleTile('ascii', PLAIN, tile(PLAIN))
  setStyleTile('ascii', OPTED_OUT, tile(OPTED_OUT, { actAsTile: false }))
  setStyleTile('ascii', OPTED_IN, tile(OPTED_IN, { actAsTile: true }))
  setStyleTile('ascii', TOP, tile(TOP))
})
afterAll(() => {
  for (const label of [PLAIN, OPTED_OUT, OPTED_IN, TOP]) delete styleTile('ascii', label)
})

const grid = () => new IsometricGrid({ cols: 6, rows: 6, cellSize: 32, isoScale: 1.4 })
/** The stack slot a placed asset sits in, what `setCellActAsTile`/`setTileHeight` address. */
const orderedIndexOf = (g: IsometricGrid, a: GridAsset): number =>
  [...g.getAssetsAtCell(2, 2)].sort((x, y) => (x.heightLevel ?? 0) - (y.heightLevel ?? 0)).indexOf(a)
const push = (g: IsometricGrid, type: string, h?: number) =>
  pushTile(g, 2, 2, { source: 'asset', type, art: ['.'], ...(h === undefined ? {} : { h }), collision: false })

describe('a tile is as tall as its height says, 0 means FLAT', () => {
  it('lets a tile pushed with height 0 stay flat, so the next tile lands at the same level', () => {
    // T-140 gave 0 back to the model, at Alexander's word: *"floors should be generated with height 0, which
    // mean, the height setting from the floor tile is 0 … floor are regular fucking tiles, nothing more
    // nothing less."* A flat tile occupies no vertical space, so the tile after it does NOT climb.
    const g = grid()
    const flat = push(g, PLAIN, 0)
    expect(push(g, TOP).heightLevel).toBe(flat.heightLevel)
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

describe('the act_as_tile switch is LIVE again, it is what a FLAT tile uses to still be stood on', () => {
  // The old version of this suite predicted its own end: *"if this test ever FAILS, the height model has
  // gained sub-block tiles again and the switch has become observable"*. T-140 did exactly that. On a tile
  // that is already a block tall the switch cannot change anything (max(1, 1) === 1), so both cases below use
  // a FLAT tile, the only place it is observable, and the case Alexander described it for: *"roads, whatever
  // we walk over"*.

  it('does NOT lift what stands on a flat tile by default, opt-in not opt-out', () => {
    // This is the defect from Image #30 stated as a test. Default-TRUE fabricated a block of vertical space
    // that nothing draws, so a building stood one block clear of its own floor.
    const g = grid()
    const flat = push(g, PLAIN, 0)
    expect(push(g, TOP).heightLevel).toBe(flat.heightLevel)
  })

  it('DOES lift what stands on a flat tile whose DB tile opts in', () => {
    const g = grid()
    const flat = push(g, OPTED_IN, 0)
    expect(push(g, TOP).heightLevel).toBe(flat.heightLevel + 1)
  })

  it('lifts what already stands on a flat tile the moment it is switched on', () => {
    // The per-INSTANCE path, through the real API. `setCellActAsTile` mirrors setTileHeight's lift, so
    // flipping the switch on a flat tile raises what sits on it by the one block it now occupies.
    const g = grid()
    const flat = push(g, PLAIN, 0)
    const top = push(g, TOP)
    const before = top.heightLevel ?? 0
    setCellActAsTile(g, 2, 2, orderedIndexOf(g, flat), true)
    expect(top.heightLevel).toBe(before + 1)
  })

  it('a height-1 tile is unaffected by the switch, it already occupies its block', () => {
    const g = grid()
    const block = push(g, PLAIN, 1)
    const top = push(g, TOP)
    const before = top.heightLevel ?? 0
    setCellActAsTile(g, 2, 2, orderedIndexOf(g, block), true)
    expect(top.heightLevel).toBe(before)
  })
})
