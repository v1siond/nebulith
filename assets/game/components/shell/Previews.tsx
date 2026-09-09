/**
 * THE PREVIEWS — every picture the library shows.
 *
 * Alexander, 2026-09-08: *"there's no preview in objects, in general we need preview for everything."*
 *
 * Thin renderers over `@/engine/tilePreview`, which holds all the geometry and is unit-tested. The DOM and
 * class names are carried over from the approved design at :8899 unchanged, so the CSS in
 * `styles/themes/nebulith-editor.css` applies without a single new rule.
 *
 * Two rules these components exist to keep:
 *
 *  · **A missing picture shows as missing.** No glyph stand-in, no emoji picked from the name, no borrowing
 *    another style's art. The old inventory panel chose an icon by regexing the item's name, which made 15
 *    pictureless items look finished.
 *  · **Frames play only where you're looking.** 358 simultaneously animating tiles is a scroll-killer, so a
 *    swatch is a still with a small badge and the big preview is what animates.
 */
import { useEffect, useState } from 'react'

import { compositionPreview, tileFacts, tileFrames } from '@/engine/tilePreview'

/** Baked tiles are 128px art of blocky characters; smoothing them to 46px turns a figure into grey mush. */
const PIXELATED = { imageRendering: 'pixelated' as const }

export interface TilePictureProps {
  styleId: string
  label: string
  size: number
  /** Play the tile's frames instead of showing a still. */
  animate?: boolean
  className?: string
}

/**
 * One tile's baked picture, in the given art style.
 *
 * Renders the "no picture" marker when this style has no such label — that hole is information, and the
 * only honest thing to draw.
 */
export function TilePicture({ styleId, label, size, animate = false, className }: TilePictureProps) {
  const frames = tileFrames(styleId, label)
  const facts = tileFacts(styleId, label)
  const [frame, setFrame] = useState(0)
  const frameMs = facts?.frameMs ?? 900
  const playing = animate && frames.length > 1

  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => setFrame((n) => (n + 1) % frames.length), frameMs)
    return () => window.clearInterval(timer)
  }, [playing, frames.length, frameMs])

  if (frames.length === 0) {
    return (
      <span
        className={`ti miss ${className ?? ''}`.trim()}
        style={{ width: size, height: size }}
        role="img"
        aria-label={`${facts?.name ?? label} — no picture`}
        title={`${facts?.name ?? label} — no picture on the backend yet`}
      />
    )
  }
  return (
    <img
      className={`ti ${className ?? ''}`.trim()}
      src={frames[playing ? frame % frames.length : 0]}
      width={size}
      height={size}
      style={PIXELATED}
      alt={facts?.name ?? label}
      draggable={false}
    />
  )
}

/**
 * `CompositionFront`, `CompositionPlan` and `PreviewStrip` were deleted here.
 *
 * All three DREW THEIR OWN PICTURE of a thing — a front elevation composed from a composition's parts, and
 * a flat plan grid. Alexander, 2026-09-09: *"the previews of the objects don't match the selected view at
 * all… fountain, lamp post and well are the worst offenders"* and *"the preview should be how it looks in
 * the map."* A hand-assembled elevation cannot answer that, because it re-implements a renderer and knows
 * nothing about footprints, collapsed height runs, per-cell settings or animation.
 *
 * Their replacement is `@/engine/preview` — a real grid, stamped through the brush and the generator's own
 * stamp, drawn by whichever of the three map renderers the view bar has selected. Deleted rather than left
 * unused: two ways to picture a tile is exactly how these drifted from the map in the first place.
 *
 * `TilePicture` stays. A tile's baked PNG is the right picture in the two places that still want one: a
 * CHARACTER (a billboard, drawn upright by every view, so its image already is its map appearance) and the
 * small swap-panel grid.
 */
