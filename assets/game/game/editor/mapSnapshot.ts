/**
 * MAP SNAPSHOT — the deep copy an undo checkpoint stores and a redo/undo restores. Everything a map EDIT can
 * change lives here: the grid's per-cell layers (ground / height / collision / floor colour / floor dims), its
 * placed assets, and the entities. UI-only state (selection, panels, camera) is deliberately NOT captured —
 * undo restores the MAP, not the workspace (Alexander: "don't capture non-map UI state"). Snapshots are the
 * currency of editorHistory.ts; this module owns the grid⇄snapshot deep-clone so neither side aliases the other.
 */
import type { GridAsset, IsometricGrid } from '@/engine/IsometricGrid'
import type { GroundCellDims } from '@/engine/groundDims'
import type { Entity } from '@/game/types'

export interface MapSnapshot {
  /** the grid size the snapshot was taken at — a restore refuses a snapshot from a differently-sized map
   *  (template load / resize) so a stale snapshot can never corrupt the live grid. */
  cols: number
  rows: number
  ground: string[][]
  height: number[][]
  collision: number[][]
  groundColor: (string | null)[][]
  groundDims: (GroundCellDims | undefined)[][]
  assets: GridAsset[]
  entities: Entity[]
}

const clone = <T>(value: T): T => structuredClone(value)

/** Snapshot the LIVE map, DEEP-cloned so a later edit can't mutate the stored copy (the grid mutates its arrays
 *  in place — placeAsset pushes, setGround writes a cell). Entities are passed in because they live in React
 *  state, not on the grid. */
export function captureMapSnapshot(grid: IsometricGrid, entities: readonly Entity[]): MapSnapshot {
  return {
    cols: grid.cols,
    rows: grid.rows,
    ground: clone(grid.ground),
    height: clone(grid.height),
    collision: clone(grid.collision),
    groundColor: clone(grid.groundColor),
    groundDims: clone(grid.groundDims),
    assets: clone(grid.assets),
    entities: clone(entities) as Entity[],
  }
}

/** Restore a snapshot onto the grid, writing DEEP CLONES so the stored snapshot stays pristine for a later
 *  undo/redo (an undo/redo cycle restores the SAME snapshot more than once). Bumps groundVersion so the cached
 *  2D/iso ground layers rebuild from the restored terrain. Returns the cloned entities for the caller to push
 *  into React state — or null (a no-op) when the snapshot's size doesn't match the live grid, so a snapshot
 *  from another map never corrupts this one. */
export function restoreMapSnapshot(grid: IsometricGrid, snap: MapSnapshot): Entity[] | null {
  if (snap.cols !== grid.cols || snap.rows !== grid.rows) return null
  grid.ground = clone(snap.ground)
  grid.height = clone(snap.height)
  grid.collision = clone(snap.collision)
  grid.groundColor = clone(snap.groundColor)
  grid.groundDims = clone(snap.groundDims)
  grid.setAssets(clone(snap.assets)) // new array identity → the render's asset caches rebuild
  grid.groundVersion++
  return clone(snap.entities) as Entity[]
}
