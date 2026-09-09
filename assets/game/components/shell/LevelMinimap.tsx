/**
 * THE LEVEL MAP — the whole level at a glance, with where you are marked.
 *
 * Alexander, 2026-09-08: *"we also need a map functionality, IE: having a map of the level we're in"* and
 * *"You can start with the overlay, which is half built."*
 *
 * He is right that it is half built: `renderTopView` already draws an entire level from above, entities
 * included. It is used today as a full-screen VIEW MODE ("Top"). This draws the SAME function into a small
 * canvas at a zoom that fits the whole grid, and adds the one thing a minimap has that a view mode does not
 * — a rectangle showing which part you are looking at, and a click to go there.
 *
 * Reusing the renderer rather than writing a second one is the point: a minimap that draws the level its own
 * way is a second opinion about what the level looks like, and the two will disagree the first time a tile
 * setting changes.
 *
 * It repaints on a timer, not per frame. A map of a level that is not moving does not need 60fps, and the
 * editor's own loop is the thing that must stay smooth.
 */
import { useCallback, useEffect, useRef } from 'react'

import type { IsometricGrid } from '@/engine/IsometricGrid'
import { renderTopView } from '@/engine/render/birdseye'
import type { Style } from '@/game/artStyle'
import type { PlayerState } from '@/game/runtime/player'
import type { Entity } from '@/game/types'

/** The tile size `renderTopView` draws at `zoom = 1`. Its own constant; mirrored so the fit can be solved. */
const BASE_TILE = 16

/** How often the map repaints. Fast enough to follow a pan, far cheaper than the editor's own loop. */
const REPAINT_MS = 250

export interface LevelMinimapProps {
  grid: IsometricGrid | null
  player: PlayerState
  entities: readonly Entity[]
  style: Style
  /** The main view's camera pan, in the same units the editor keeps it. */
  camOffset: { x: number; y: number }
  /** The main view's zoom, as a percentage — 100 = one cell drawn at `grid.cellSize`. */
  zoomPct: number
  /** The main canvas, to know how many cells it is showing. */
  mainCanvas: HTMLCanvasElement | null
  /** Centre the main view on a cell. The editor already has this — `__centerOn` uses the same maths. */
  onJumpTo?: (col: number, row: number) => void
  /** Collapse it. Alexander: the HUD version will be hideable "like almost everything in HUD". */
  onHide?: () => void
  /**
   * Open the map BIG. Alexander, 2026-09-09: *"i want to be able to increase/maximize the map, right now
   * only the mini map is available."* Absent → no maximize control (the big one does not offer to open
   * itself again).
   */
  onMaximize?: () => void
  /** Drawn large, in a panel of its own. Only changes the chrome — the map is the same component. */
  big?: boolean
}

export function LevelMinimap({ grid, player, entities, style, camOffset, zoomPct, mainCanvas, onJumpTo, onHide, onMaximize, big = false }: LevelMinimapProps) {
  const canvas = useRef<HTMLCanvasElement>(null)

  // The map's aspect follows the LEVEL's, so a 40×40 map is square and a 60×20 one is wide — the shape of
  // the picture is itself information about the level.
  const cols = grid?.cols ?? 0
  const rows = grid?.rows ?? 0

  const paint = useCallback(() => {
    const node = canvas.current
    if (!node || !grid) return
    // MEASURE HERE, every paint. A mount-time measurement reads 0 (no layout yet) and a ResizeObserver on a
    // canvas whose backing store this function also writes is a fight over the same element — the first
    // version did both and never got past 0, leaving the default 300×150 store and an empty map. The paint
    // already runs on a timer, so it can just ask the element how big it is.
    const w = node.clientWidth
    const h = node.clientHeight
    if (w === 0 || h === 0) return
    if (node.width !== w || node.height !== h) {
      node.width = w
      node.height = h
    }
    const ctx = node.getContext('2d')
    if (!ctx) return
    // Fit the WHOLE grid: solve the zoom `renderTopView` needs so `cols * 16 * zoom` spans the canvas.
    const zoom = Math.min(w / Math.max(1, cols * BASE_TILE), h / Math.max(1, rows * BASE_TILE))
    renderTopView({
      ctx,
      w,
      h,
      grid,
      player,
      zoom,
      entities,
      style,
      chrome: false, // its heading and keyboard hint belong to the full-screen view, not to a 176px map
      // The map shows the level, not the editing state: no selection, no hover, no placement ghost. Those
      // belong to the thing you are working in, and repeating them here would just be noise at 4px a cell.
    })
    // WHERE THE MAIN VIEW IS LOOKING, derived here from the same camera the render reads — the exact
    // inverse `__centerOn` applies, so the rectangle cannot drift from what is on screen.
    if (!mainCanvas || !mainCanvas.width) return
    const cs = grid.cellSize
    const focusCol = (player.x - camOffset.x) / cs
    const focusRow = (player.z - camOffset.y) / cs
    const mainTile = Math.max(1, cs * (zoomPct / 100))
    const spanCols = Math.min(cols, mainCanvas.width / mainTile)
    const spanRows = Math.min(rows, mainCanvas.height / mainTile)
    const tile = BASE_TILE * zoom
    const originX = (w - cols * tile) / 2
    const originY = (h - rows * tile) / 2
    ctx.save()
    ctx.strokeStyle = 'rgba(90,169,255,0.95)'
    ctx.lineWidth = 1.5
    ctx.strokeRect(
      originX + Math.max(0, focusCol - spanCols / 2) * tile,
      originY + Math.max(0, focusRow - spanRows / 2) * tile,
      Math.max(3, spanCols * tile),
      Math.max(3, spanRows * tile),
    )
    ctx.restore()
  }, [grid, player, entities, style, camOffset, zoomPct, mainCanvas, cols, rows])

  useEffect(() => {
    paint()
    const timer = window.setInterval(paint, REPAINT_MS)
    return () => window.clearInterval(timer)
  }, [paint])

  /** A click goes to that cell. The map's whole value is being able to act on what it shows. */
  const jump = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onJumpTo || !grid) return
    const node = event.currentTarget
    const rect = node.getBoundingClientRect()
    const w = node.clientWidth
    const h = node.clientHeight
    if (w === 0 || h === 0) return
    const zoom = Math.min(w / Math.max(1, cols * BASE_TILE), h / Math.max(1, rows * BASE_TILE))
    const tile = BASE_TILE * zoom
    const originX = (w - cols * tile) / 2
    const originY = (h - rows * tile) / 2
    const col = Math.floor((event.clientX - rect.left - originX) / tile)
    const row = Math.floor((event.clientY - rect.top - originY) / tile)
    if (col < 0 || row < 0 || col >= cols || row >= rows) return
    onJumpTo(col, row)
  }

  if (!grid) return null

  return (
    <div className={big ? 'minimap big' : 'minimap'} aria-label="Map of this level">
      <div className="mmhead">
        <span className="mmt">This level</span>
        <span className="mmsize">{`${cols} × ${rows}`}</span>
        {onMaximize && (
          <button type="button" className="mmx" title="Open the map big" aria-label="Open the map big" onClick={onMaximize}>
            ⤢
          </button>
        )}
        {onHide && (
          <button type="button" className="mmx" title="Hide the map" aria-label="Hide the map" onClick={onHide}>
            ✕
          </button>
        )}
      </div>
      <canvas
        ref={canvas}
        className="mmcanvas"
        style={{ aspectRatio: `${Math.max(1, cols)} / ${Math.max(1, rows)}` }}
        onClick={jump}
        title={onJumpTo ? 'Click to go there' : undefined}
      />
    </div>
  )
}
