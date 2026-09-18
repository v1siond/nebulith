/**
 * THE LEVEL MAP, as one thing.
 *
 * Three pieces of the editor's canvas pane say the same word: the corner map, the same map opened big in a
 * floating panel, and the button that brings the corner one back. They share every input and they are only
 * ever in one of three states, so they are one component rather than three conditions in a seven thousand
 * line return.
 *
 * *"we should have multiple sub components, and the business logic should be outside of the component
 * itself"*, and `CODING-STANDARDS.md` §3: split large files, decompose by concern as you work in them.
 *
 * THE CAMERA ARRIVES AS A REF. The map repaints on its own timer and reads the camera when it paints, so
 * panning re-renders neither this nor the page. See `LevelMinimap`.
 */
import { FloatingPanel } from '@/components/modals'
import { LevelMinimap } from '@/components/shell/LevelMinimap'
import type { IsometricGrid } from '@/engine/IsometricGrid'
import type { Style } from '@/game/artStyle'
import type { PlayerState } from '@/game/runtime/player'
import type { Entity } from '@/game/types'

export interface LevelMapPaneProps {
  /** Closed entirely: the editor chrome is hidden, or the draggable HUD owns the screen. */
  hidden: boolean
  /** Is the corner map showing? False leaves only the button that opens it. */
  open: boolean
  /** Is the big panel showing? Independent of the corner one, the same map at panel size. */
  big: boolean
  grid: IsometricGrid | null
  player: PlayerState
  entities: readonly Entity[]
  style: Style
  camOffsetRef: React.RefObject<{ x: number; y: number }>
  zoomPct: number
  mainCanvas: HTMLCanvasElement | null
  onJumpTo: (col: number, row: number) => void
  onOpen: () => void
  onHide: () => void
  onOpenBig: () => void
  onCloseBig: () => void
  /** The editor's saved position and size for the big panel, spread onto `FloatingPanel`. */
  panelProps: Record<string, unknown>
}

export function LevelMapPane({
  hidden, open, big, grid, player, entities, style, camOffsetRef, zoomPct, mainCanvas,
  onJumpTo, onOpen, onHide, onOpenBig, onCloseBig, panelProps,
}: LevelMapPaneProps) {
  if (hidden) return null
  const map = { grid, player, entities, style, camOffsetRef, zoomPct, mainCanvas, onJumpTo }
  return (
    <>
      {open && <LevelMinimap {...map} onHide={onHide} onMaximize={onOpenBig} />}
      {/* The same component at panel size: one map, drawn by `renderTopView` either way, so the big one
          cannot disagree with the corner one. Movable and resizable like every other panel. */}
      {big && (
        <FloatingPanel title="This level" accent="cyan" onClose={onCloseBig} {...panelProps}>
          <LevelMinimap big {...map} />
        </FloatingPanel>
      )}
      {!open && (
        <button type="button" className="b sm mmshow" title="Show the map of this level" onClick={onOpen}>
          ▦ Map
        </button>
      )}
    </>
  )
}
