/**
 * A TILE CAN CARRY ITS OWN THICKNESS.
 *
 * Alexander (2026-09-06, Image #10): *"look at the dors, they don't look like doors because we're keeping the
 * full z-width even when it says '0' it has a z-width of 1"*.
 *
 * Two different properties get confused here:
 *  - `depth` (the editor's "z-width") = how many CELLS the block spans. It is clamped to ≥1 because a tile
 *    always occupies its own cell — so 0 and 1 are the same thing by definition. That is not the door knob.
 *  - `scaleZ` = the block's THICKNESS along the into-screen axis. A door is a thin panel in a wall; drawn at
 *    the default thickness of 1 it is a full cube, which is why it does not read as a door.
 *
 * Thickness must be TILE data (backend), not a per-composition-cell accident: a door is thin wherever it is
 * placed — stamped by the generator, or painted by hand in the editor. A composition cell may still override.
 */
import { compositionCellRender } from '@/game/runtime/composition'
import type { Composition, CompositionCell, ResolvedTile } from '@/engine/tileset/tileset'

const comp = { footprint: { w: 3, h: 3 }, cells: [] } as unknown as Composition
const cell = (settings?: Record<string, unknown>): CompositionCell =>
  ({ dx: 0, dy: 0, level: 0, label: 'door', walkable: true, settings }) as unknown as CompositionCell
const tile = (settings?: Record<string, unknown>): ResolvedTile =>
  ({ char: 'D', color: '#5a3a22', settings }) as unknown as ResolvedTile

describe('a tile carries its own thickness, and a composition cell may override it', () => {
  test("the TILE's scaleZ reaches the placed block — a thin door stays thin wherever it is stamped", () => {
    const render = compositionCellRender(comp, cell(), tile({ scaleZ: 0.25 }), 1, 0)
    expect(render.scaleZ).toBe(0.25)
  })

  test('an explicit composition-cell scaleZ WINS over the tile default', () => {
    const render = compositionCellRender(comp, cell({ scaleZ: 0.8 }), tile({ scaleZ: 0.25 }), 1, 0)
    expect(render.scaleZ).toBe(0.8)
  })

  test('a tile with no thickness of its own is left alone (full block, unchanged)', () => {
    const render = compositionCellRender(comp, cell(), tile(), 1, 0)
    expect(render.scaleZ).toBeUndefined()
  })

  test('a non-numeric thickness in the data is ignored rather than trusted', () => {
    const render = compositionCellRender(comp, cell(), tile({ scaleZ: 'thin' }), 1, 0)
    expect(render.scaleZ).toBeUndefined()
  })
})
