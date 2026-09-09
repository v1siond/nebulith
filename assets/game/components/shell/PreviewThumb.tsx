/**
 * A LIST SWATCH — the same picture the big preview shows, rendered once and kept.
 *
 * Alexander, 2026-09-09: *"the example ofn the element in the list itself doesn't match their actual look /
 * fountain, lamp post and well are the worst offenders."* All three are compositions, and all three were
 * drawn by a hand-rolled "front elevation" that knew nothing about footprints, height runs or animation. So
 * a swatch now goes through `previewThumbnail`, which is the big preview's own draw path.
 *
 * RENDERED LAZILY, and that is not an optimisation detail — it is what makes this possible at all. The tile
 * library mounts all 238 swatches at once with no windowing, and each thumbnail is a full isometric render
 * of its own grid. Doing them eagerly would block the main thread for a third of a second every time the
 * library opened. One shared IntersectionObserver means only the ~40 swatches actually on screen render on
 * open, and the rest as they scroll past — each one exactly once, because the result is cached.
 *
 * Before a swatch has rendered it reserves its box and draws nothing. It does NOT fall back to the flat
 * baked image: that image is precisely the wrong picture this component exists to replace, and showing it
 * for a moment would put the old mismatch back on screen as a flash.
 */
import { useEffect, useRef, useState } from 'react'

import { previewThumbnail, type PreviewView } from '@/engine/preview/drawPreview'
import type { PreviewSubject } from '@/engine/preview/previewScene'
import type { ZoneId } from '@/engine/zones'
import type { Style } from '@/game/artStyle'

/** Everything a swatch needs to draw itself the way the map would. Passed as one prop, not four. */
export interface PreviewContext {
  view: PreviewView
  zone: ZoneId
  style: Style
  styleId: string
}

/** The aspect `previewThumbnail` renders at — an iso silhouette spreads sideways. */
const ASPECT = 0.72

/**
 * One observer for every swatch on the page.
 *
 * Per-instance observers would mean 238 of them on the tile library. The callback map is keyed by element,
 * which is why entries are deleted on unobserve — a stale key would hold a detached node alive.
 */
let observer: IntersectionObserver | null = null
const seen = new Map<Element, () => void>()

function watch(node: Element, onVisible: () => void): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    // jsdom and SSR have no observer. Render immediately rather than never — a test asserting a swatch
    // drew must not depend on a browser API being polyfilled.
    onVisible()
    return () => {}
  }
  if (!observer) {
    observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          seen.get(entry.target)?.()
        }
      },
      // A margin so a swatch renders just before it scrolls in, rather than popping in once visible.
      { rootMargin: '160px' },
    )
  }
  seen.set(node, onVisible)
  observer.observe(node)
  return () => {
    observer?.unobserve(node)
    seen.delete(node)
  }
}

export interface PreviewThumbProps {
  subject: PreviewSubject | null
  context: PreviewContext
  /** Width in CSS pixels; the height follows the render aspect. */
  px: number
}

export function PreviewThumb({ subject, context, px }: PreviewThumbProps) {
  const host = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(false)
  const height = Math.round(px * ASPECT)

  useEffect(() => {
    const node = host.current
    if (!node || visible) return
    return watch(node, () => setVisible(true))
  }, [visible])

  const url =
    visible && subject
      ? previewThumbnail(subject, context.view, context.zone, context.styleId, context.style, px)
      : null

  return (
    <span ref={host} className="thumb" style={{ width: px, height }}>
      {url && (
        <img
          src={url}
          width={px}
          height={height}
          alt=""
          style={{ imageRendering: 'pixelated' }}
          draggable={false}
        />
      )}
    </span>
  )
}
