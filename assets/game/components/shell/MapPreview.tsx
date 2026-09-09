/**
 * THE PREVIEW — the thing, drawn by the map's own renderer, in the view you are looking at.
 *
 * Alexander, 2026-09-09: *"the previews of the objects don't match the selected view at all… fountain, lamp
 * post and well are the worst offenders"* and *"also, the preview should be how it looks in the map."*
 *
 * Both sentences have the same answer, and it is the answer the level minimap already uses: do not draw a
 * second picture. `buildPreviewScene` puts the subject into a real grid through the brush and the stamp, and
 * `drawPreviewScene` calls whichever of the three renderers the view bar has selected. So:
 *
 *  · it matches the map, because it IS the map's code;
 *  · it follows the view, because the view chooses the function;
 *  · and a fountain animates, a lamp post glows and a well is 5×3, because none of that is re-implemented.
 *
 * This draws LIVE, on a timer, because an animated tile is part of how it looks. The list swatches use the
 * same draw path through `previewThumbnail`, which renders once and keeps the result — a list of 23 full
 * isometric renders per frame would cost more than the map.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'

import { drawPreviewScene, type PreviewView } from '@/engine/preview/drawPreview'
import { buildPreviewScene, type PreviewSubject } from '@/engine/preview/previewScene'
import type { ZoneId } from '@/engine/zones'
import type { Style } from '@/game/artStyle'

import { TilePicture } from './Previews'

export type { PreviewView }

/** Repaint cadence. A preview holds still unless it animates, and 20fps is plenty for water and glow. */
const FRAME_MS = 50

export interface MapPreviewProps {
  subject: PreviewSubject | null
  /** The view bar's current projection, so the preview shows what placing it will look like from here. */
  view: PreviewView
  /** The zone whose ground the subject stands on — the same ground the map would give it. */
  zone: ZoneId
  style: Style
  styleId: string
  /** The box to draw into, in CSS pixels. */
  height?: number
}

export function MapPreview({ subject, view, zone, style, styleId, height = 190 }: MapPreviewProps) {
  const canvas = useRef<HTMLCanvasElement>(null)

  // The scene is rebuilt only when the SUBJECT changes, not per frame: stamping a composition walks its
  // cells and pushes tiles, which is far too much work to redo 20 times a second.
  const scene = useMemo(
    () => (subject ? buildPreviewScene(subject, zone, styleId) : null),
    [subject, zone, styleId],
  )

  const paint = useCallback(() => {
    const node = canvas.current
    if (!node || !scene || scene.entity) return
    // Measure the element every paint — the same reason the level minimap does: a mount-time read is 0
    // because layout has not happened, and a ResizeObserver fights the backing-store writes below.
    const w = node.clientWidth
    const h = node.clientHeight
    if (w === 0 || h === 0) return
    if (node.width !== w || node.height !== h) {
      node.width = w
      node.height = h
    }
    const ctx = node.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, w, h)
    drawPreviewScene(ctx, w, h, scene, view, style, [], performance.now() / 1000)
  }, [scene, view, style])

  useEffect(() => {
    paint()
    const timer = window.setInterval(paint, FRAME_MS)
    return () => window.clearInterval(timer)
  }, [paint])

  if (!subject) return <div className="hint">Point at something in the library to see it here.</div>
  if (!scene) {
    // No stand-in. A subject the loaded catalog cannot describe is reported, not approximated.
    return <div className="hint">The loaded catalog does not describe this yet, so there is nothing to draw.</div>
  }

  // A CHARACTER is a BILLBOARD, not a grid tile. Every view draws it as its own upright picture, so its
  // baked image already IS how it looks on the map — putting it in a scene would only add ground around it.
  // This is the one subject where the honest preview is not a rendered grid.
  if (scene.entity && subject.kind === 'tile') {
    return (
      <div className="mpbill" style={{ height }}>
        <TilePicture styleId={styleId} label={subject.tile.id.split(':').pop() ?? subject.tile.id} size={Math.min(height - 24, 150)} animate />
      </div>
    )
  }

  return <canvas ref={canvas} className="mpcanvas" style={{ height }} aria-label="Preview — how it looks on the map" />
}
