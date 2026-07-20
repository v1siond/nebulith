/**
 * useEditorHistory — the React wiring for the editor's undo/redo (Alexander: "ctrl + y and ctrl + z … replace a
 * building for another, then ctrl+z to go back … 4-5 steps forward and backwards"). It owns a bounded snapshot
 * ring (see editorHistory.ts + mapSnapshot.ts) and binds Ctrl+Z (undo) / Ctrl+Y or Ctrl+Shift+Z (redo).
 *
 * Contract: call the returned `checkpoint()` at the START of every map-mutating edit — BEFORE it mutates — so a
 * later undo restores the exact pre-edit map. The keybinds are ignored while typing in a text field, so undo in
 * an input still edits text, not the map.
 */
import { useCallback, useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import type { IsometricGrid } from '@/engine/IsometricGrid'
import type { Entity } from '@/game/types'
import { captureMapSnapshot, restoreMapSnapshot, type MapSnapshot } from './mapSnapshot'
import { HISTORY_LIMIT, createHistory, checkpoint as pushCheckpoint, redo as redoHistory, undo as undoHistory } from './editorHistory'

type Step = typeof undoHistory // undo/redo share one signature — one applier drives both

interface UseEditorHistoryArgs {
  gridRef: MutableRefObject<IsometricGrid | null>
  /** live entities (React state mirrored to a ref) — snapshotted alongside the grid. */
  entitiesRef: MutableRefObject<Entity[]>
  /** push restored entities back into React state. */
  setEntities: (entities: Entity[]) => void
  /** nudge a re-render after the grid mutates in place (the editor's bumpBuildingVersion). */
  onRestore: () => void
}

export function useEditorHistory({ gridRef, entitiesRef, setEntities, onRestore }: UseEditorHistoryArgs) {
  const historyRef = useRef(createHistory<MapSnapshot>())

  const snapshot = useCallback((): MapSnapshot | null => {
    const grid = gridRef.current
    return grid ? captureMapSnapshot(grid, entitiesRef.current) : null
  }, [gridRef, entitiesRef])

  /** Record the current map as an undo checkpoint — call at the top of a mutating edit, before it mutates. */
  const checkpoint = useCallback(() => {
    const snap = snapshot()
    if (!snap) return
    historyRef.current = pushCheckpoint(historyRef.current, snap, HISTORY_LIMIT)
  }, [snapshot])

  const applyStep = useCallback(
    (step: Step) => {
      const grid = gridRef.current
      const present = snapshot()
      if (!grid || !present) return
      const { history, restored } = step(historyRef.current, present, HISTORY_LIMIT)
      if (!restored) return
      const entities = restoreMapSnapshot(grid, restored)
      if (entities === null) return // size mismatch → leave the map untouched, keep history intact
      historyRef.current = history
      setEntities(entities)
      onRestore()
    },
    [gridRef, snapshot, setEntities, onRestore],
  )

  const undo = useCallback(() => applyStep(undoHistory), [applyStep])
  const redo = useCallback(() => applyStep(redoHistory), [applyStep])

  /** Drop all history — call when the whole map is REPLACED (template load / stage generate) so an undo can't
   *  drag back the previous map's content. */
  const reset = useCallback(() => {
    historyRef.current = createHistory<MapSnapshot>()
  }, [])

  useEffect(() => {
    const isTextTarget = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null
      const tag = el?.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || !!el?.isContentEditable
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const key = e.key.toLowerCase()
      const isUndo = key === 'z' && !e.shiftKey
      const isRedo = key === 'y' || (key === 'z' && e.shiftKey)
      if (!isUndo && !isRedo) return
      if (isTextTarget(e.target)) return // typing in a field → let it handle its own undo
      e.preventDefault()
      if (isUndo) undo()
      else redo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, redo])

  return { checkpoint, undo, redo, reset }
}
