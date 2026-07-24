/**
 * PER-KEY SELECTION TARGETS — the fix for "edits hit the wrong tile in the stack" (the user: "a few of the
 * tiles I selected changed the tile located at the bottom instead of the one selected").
 *
 * Each selection key already encodes the tile's own stack slot: "col,row,stackIndex" is a specific TILE,
 * "col,row" is a bare cell. resolveSelectionTargets turns the selection into per-cell edit targets that use
 * EACH key's own slot — so a multi-select edits each cell's SELECTED tile, never one global level forced onto
 * every cell (which landed on the bottom/floor tile). A bare cell key falls back to the inspector's level.
 */
import { parseSelectionKey, resolveSelectionTargets } from '@/game/editor/selectionEdit'

describe('parseSelectionKey', () => {
  it('parses a TILE key (col,row,stackIndex) into a cell + slot', () => {
    expect(parseSelectionKey('6,6,2')).toEqual({ col: 6, row: 6, stackIndex: 2 })
  })
  it('parses a bare CELL key (col,row) with no slot', () => {
    expect(parseSelectionKey('7,3')).toEqual({ col: 7, row: 3 })
  })
  it('keeps slot 0 (a flat tile pick is a real slot, not a bare cell)', () => {
    expect(parseSelectionKey('4,5,0')).toEqual({ col: 4, row: 5, stackIndex: 0 })
  })
  it('returns null for a malformed key', () => {
    expect(parseSelectionKey('nope')).toBeNull()
    expect(parseSelectionKey('')).toBeNull()
  })
})

describe('resolveSelectionTargets — each edit targets the EXACT selected tile per key', () => {
  it('each TILE key resolves to its OWN slot — a multi-select edits each cell’s selected tile', () => {
    expect(resolveSelectionTargets(['6,6,2', '7,7,0'], 9)).toEqual([
      { col: 6, row: 6, index: 2 },
      { col: 7, row: 7, index: 0 },
    ])
  })

  it('a bare cell key falls back to the inspector level (selectedTileLevel)', () => {
    expect(resolveSelectionTargets(['8,8'], 3)).toEqual([{ col: 8, row: 8, index: 3 }])
  })

  it('mixes tile keys and bare cell keys, and skips malformed keys', () => {
    expect(resolveSelectionTargets(['6,6,2', 'bad', '8,8'], 1)).toEqual([
      { col: 6, row: 6, index: 2 },
      { col: 8, row: 8, index: 1 },
    ])
  })

  it('THE #2 BUG: two tiles at DIFFERENT slots each edit their OWN — not a single global level forced onto both', () => {
    // A top tile (slot 3) and a bottom tile (slot 1). The old code applied the global selectedTileLevel to
    // BOTH cells, so one of them changed the WRONG tile (often the bottom/floor). Per-key each lands correctly.
    const targets = resolveSelectionTargets(['5,5,3', '9,9,1'], 0)
    expect(targets).toEqual([
      { col: 5, row: 5, index: 3 },
      { col: 9, row: 9, index: 1 },
    ])
    // NOT [{ index: 0 }, { index: 0 }] — that global-level behavior hit the bottom tile.
  })
})
