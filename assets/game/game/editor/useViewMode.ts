/**
 * THE VIEW MODE, OWNED IN ONE PLACE.
 *
 * The editor page held this as FOUR values that had to be written in step by hand: `viewType`,
 * `showTopView` and `showFlowView` in React state, plus `topViewMode` and `flowViewMode` as module-level
 * mutable globals the game loop read directly. `CODING-STANDARDS.md` §2 names that anti-pattern by file and
 * by variable, and §2 also says what to keep instead: one source of truth in React state, plus **a ref for
 * the imperative layer**, never both describing the same fact.
 *
 * So there is one `ViewMode`, and one ref carrying the same value for the render loop to read without
 * re-subscribing. The ref is not a second source of truth: it is written from the state in the same commit
 * and never written anywhere else, which is the difference between a mirror and a cache.
 *
 * The decisions live in `viewMode.ts` as pure functions (§3, pure logic out of components). This hook is the
 * React shell around them: the state, the ref, the stored preference, and the actions the toolbar calls.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  playViewFrom,
  storedValueFor,
  storedViewMode,
  toggleFlow,
  VIEW_STORAGE_KEY,
  type PlayableView,
  type ViewMode,
} from '@/game/editor/viewMode'
import { readStored, writeStored } from '@/lib/storage'

export interface ViewModeApi {
  /** The active view. The ONE value that says which view the editor is in. */
  mode: ViewMode
  /** The same value, for the once-mounted render loop and the imperative pickers to read. */
  modeRef: React.MutableRefObject<ViewMode>
  /** Show the isometric map. */
  selectIso: () => void
  /** Show the 2D elevation. */
  select2D: () => void
  /** Show the top-down authoring view. */
  selectTop: () => void
  /** Enter the flow view, or leave it back onto the last playable view. */
  toggleFlowView: () => void
  /** Land on a view you can play in, keeping the iso/2D choice when there is one. */
  enterPlayView: () => void
  /** Leave the flow view without choosing where to go, for callers that only need it closed. */
  closeFlowView: () => void
}

/**
 * `onLeaveAuthoring` fires whenever the view moves to one you can PLAY in. The page uses it to drop connector
 * authoring, which must never bleed into play: an armed connector silently freezes triggers and combat, which
 * is the dead walk-in bug. It is a callback rather than something this hook does itself, because connector
 * authoring is not view state and this hook has no business knowing about it.
 */
export function useViewMode(onLeaveAuthoring?: () => void): ViewModeApi {
  // THE STORED VIEW IS THE FIRST VALUE, not something an effect corrects afterwards. Read in a lazy
  // initialiser, which runs once before the first render, so the state and the ref agree from the very first
  // frame. Reading it in an effect instead left one render, and one turn of the loop, on the wrong view.
  const [mode, setMode] = useState<ViewMode>(() => storedViewMode(readStored(VIEW_STORAGE_KEY)))
  const modeRef = useRef<ViewMode>(mode)
  // Where leaving the flow view returns to. Not derived from `mode`, because by the time flow is active the
  // view it replaced is gone; it is remembered on the way in.
  const lastPlayable = useRef<PlayableView>('iso')

  // THE REF FOLLOWS THE STATE, never the other way round. One assignment, one place.
  useEffect(() => {
    modeRef.current = mode
    if (mode === 'iso' || mode === '2d') lastPlayable.current = mode
  }, [mode])

  useEffect(() => {
    writeStored(VIEW_STORAGE_KEY, storedValueFor(mode))
  }, [mode])

  const toPlayable = useCallback(
    (next: PlayableView) => {
      setMode(next)
      onLeaveAuthoring?.()
    },
    [onLeaveAuthoring],
  )

  const selectIso = useCallback(() => toPlayable('iso'), [toPlayable])
  const select2D = useCallback(() => toPlayable('2d'), [toPlayable])
  const selectTop = useCallback(() => setMode('top'), [])
  const closeFlowView = useCallback(() => setMode(current => (current === 'flow' ? lastPlayable.current : current)), [])
  const toggleFlowView = useCallback(() => setMode(current => toggleFlow(current, lastPlayable.current)), [])
  const enterPlayView = useCallback(() => toPlayable(playViewFrom(modeRef.current)), [toPlayable])

  return { mode, modeRef, selectIso, select2D, selectTop, toggleFlowView, enterPlayView, closeFlowView }
}
