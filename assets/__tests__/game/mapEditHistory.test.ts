/**
 * UNDO/REDO IS GLOBAL FOR STRUCTURAL MAP EDITS.
 *
 * The user: "I removed a tile, then hit ctlr + z and the tile didn't return, we must ensure all edits support
 * ctlr + z and ctrl + y" … "it should be a global thing that works for anything on the map and tile related,
 * is ok to not have settings yet, but I do want to have anything related to adding, removing, replacing
 * tiles, anything that is related to building the map".
 *
 * Root cause of the report: undo was OPT-IN PER HANDLER — `clearTilesOnSelection` and `paintTileOnSelection`
 * each called `checkpointHistory()`, `removeSelectedTile` did not. Every new edit handler was a fresh chance
 * to forget. `editMap` makes the snapshot part of the EDIT BOUNDARY instead: a structural edit cannot run
 * without checkpointing first, so "did the author remember?" stops being a question.
 *
 * Settings tweaks (colour/size/shape/…) deliberately do NOT route through here — "is ok to not have settings
 * yet".
 */
import { editMap } from '@/game/editor/mapEdit'
import { removeSelectedBlock } from '@/game/editor/selectionEdit'
import { IsometricGrid, type GridAsset } from '@/engine/IsometricGrid'
import { captureMapSnapshot, restoreMapSnapshot, type MapSnapshot } from '@/game/editor/mapSnapshot'
import { createHistory, checkpoint as pushCheckpoint, undo as undoStep, HISTORY_LIMIT, type History } from '@/game/editor/editorHistory'

const CELL = 100, COL = 5, ROW = 5

const wallAsset = (): GridAsset =>
  ({ col: COL, row: ROW, type: 'wall', tileKey: 'emoji:wall', heightLevel: 0, height: 1 } as unknown as GridAsset)

const gridWithWall = (): IsometricGrid => {
  const grid = new IsometricGrid({ cols: 20, rows: 20, cellSize: CELL, isoScale: 1 })
  grid.setAssets([wallAsset()])
  return grid
}

/** A live history + the checkpoint closure the editor hands to `editMap` (mirrors useEditorHistory). */
function historyHarness(grid: IsometricGrid) {
  let history: History<MapSnapshot> = createHistory<MapSnapshot>()
  return {
    checkpoint: () => { history = pushCheckpoint(history, captureMapSnapshot(grid, []), HISTORY_LIMIT) },
    undo: (): boolean => {
      const step = undoStep(history, captureMapSnapshot(grid, []), HISTORY_LIMIT)
      history = step.history
      if (!step.restored) return false
      restoreMapSnapshot(grid, step.restored)
      return true
    },
  }
}

const assetCount = (grid: IsometricGrid): number => grid.getAssetsAtCell(COL, ROW).length

describe('editMap — a structural edit always snapshots first', () => {
  it('restores a REMOVED tile on undo (the reported bug)', () => {
    const grid = gridWithWall()
    const hist = historyHarness(grid)
    expect(assetCount(grid)).toBe(1)

    editMap(hist.checkpoint, () => { removeSelectedBlock(grid, new Set([`${COL},${ROW},0`])) })
    expect(assetCount(grid)).toBe(0) // the tile is gone

    expect(hist.undo()).toBe(true)
    expect(assetCount(grid)).toBe(1) // ctrl+z brings it back
  })

  it('snapshots BEFORE mutating, never after', () => {
    const grid = gridWithWall()
    const order: string[] = []

    editMap(() => order.push('checkpoint'), () => { order.push('mutate') })

    expect(order).toEqual(['checkpoint', 'mutate'])
  })

  it('runs the changed-callback after the mutation so the render refreshes', () => {
    const order: string[] = []

    editMap(() => order.push('checkpoint'), () => order.push('mutate'), () => order.push('changed'))

    expect(order).toEqual(['checkpoint', 'mutate', 'changed'])
  })

  it('still snapshots when the edit changes nothing (undo stays consistent)', () => {
    const grid = gridWithWall()
    const hist = historyHarness(grid)

    // Removing a slot that holds no tile: a no-op mutation, but the history must not desync.
    editMap(hist.checkpoint, () => { removeSelectedBlock(grid, new Set([`${COL + 3},${ROW + 3},0`])) })

    expect(assetCount(grid)).toBe(1)
    expect(hist.undo()).toBe(true)
    expect(assetCount(grid)).toBe(1)
  })
})
