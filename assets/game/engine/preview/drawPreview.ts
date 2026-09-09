/**
 * ONE DRAW PATH for every preview, and a cache for the small ones.
 *
 * Alexander, 2026-09-09: *"the previews of the objects don't match the selected view at all, ig infact, the
 * example ofn the element in the list itself doesn't match their actual look / fountain, lamp post and well
 * are the worst offenders"* — so the LIST swatches have to be the same picture as the big preview, which
 * means they have to come from the same code. Two draw paths is how they drifted apart in the first place.
 *
 * The big preview draws live (it animates). A list of 23 object swatches cannot: each one is a full
 * isometric render of its own grid, and doing that per swatch per frame would cost more than the map. So the
 * swatches render ONCE into an offscreen canvas and keep the result as an image.
 *
 * Caching a render is only safe because the tileset loader gates on decode: `loadTilesetsFromBackend` awaits
 * `preloadTileImages` before it resolves, so by the time any library can be rendered every baked PNG is
 * already decoded and `tileImage` returns it. Without that gate the first render would draw nothing and the
 * cache would keep that nothing forever.
 */
import { buildPreviewScene, fitZoom, type PreviewScene, type PreviewSubject } from './previewScene'
import { renderTopView } from '@/engine/render/birdseye'
import { render as renderIso, withoutIsoRecording } from '@/engine/render/iso'
import { render2D, without2DRecording } from '@/engine/render/topdown'
import type { ZoneId } from '@/engine/zones'
import type { Style } from '@/game/artStyle'
import type { Entity } from '@/game/types'

/** Which projection to draw — the same three the view bar offers. */
export type PreviewView = 'iso' | '2d' | 'top'

/**
 * Draw a scene into a context with the renderer the view selects.
 *
 * `chrome: false` on every path. Each renderer draws its own on-screen text — iso and 2D print a `Pos:` /
 * `Grid:` readout, top-down prints a "TOP VIEW" heading — and a preview is a picture OF the world, not the
 * world, so that text belongs to the editor's canvas alone. Without it every thumbnail came out with
 * "Pos: 84, 84" burned across the object.
 *
 * The `without…Recording` wrappers are not optional. `renderIso` and `render2D` keep a module-level record
 * of every tile they drew, and the map's picker reads that record to turn a click into a tile — so drawing a
 * DIFFERENT grid through them leaves the picker pointing at a grid the user cannot see, and the next click
 * on the map resolves against it.
 */
export function drawPreviewScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  scene: PreviewScene,
  view: PreviewView,
  style: Style,
  entities: readonly Entity[] = [],
  timeSec = 0,
): void {
  const { grid, span, anchor } = scene
  const cs = grid.cellSize
  // Every renderer frames the "player", so the player IS the centre of the subject's footprint and no camera
  // offset is applied — the subject lands in the middle of the box.
  const player = {
    x: (anchor.col + span.cols / 2) * cs,
    z: (anchor.row + span.rows / 2) * cs,
    y: 0,
    facing: 'south',
  } as never
  const zoom = fitZoom(view, { w, h }, scene)

  if (view === 'top') {
    renderTopView({ ctx, w, h, grid, player, entities, style, chrome: false, zoom })
    return
  }
  if (view === '2d') {
    without2DRecording(() => render2D({ ctx, w, h, grid, player, time: timeSec, entities, style, zoom, chrome: false }))
    return
  }
  // `clampCamera: false` so the camera sits exactly on the subject. The clamp exists to stop a game camera
  // showing off-grid void; here the off-grid margin IS the framing.
  withoutIsoRecording(() => renderIso({ ctx, w, h, grid, player, time: timeSec, entities, style, zoom, clampCamera: false, chrome: false }))
}

/**
 * The cache. Keyed by everything that changes the picture, so a key collision cannot show the wrong tile.
 *
 * Capped and evicted oldest-first. A data URL for a 76px tile is a few KB, and the realistic working set is
 * one library's worth in one view — but a user who switches art style, zone and view repeatedly should not
 * accumulate every combination for the life of the page.
 */
const cache = new Map<string, string>()
const CACHE_MAX = 400

function keyOf(subject: PreviewSubject): string {
  if (subject.kind === 'composition') return `c:${subject.comp}`
  // A stage's picture is decided by every one of these, so all of them are in the key — two presets of the
  // same variant differ only by `layout`, and the whole point of the card is to show that difference.
  if (subject.kind === 'stage') {
    return `s:${subject.variant}:${subject.layout ?? '-'}:${subject.zone}:${subject.seed}:${subject.cols}x${subject.rows}:${subject.nature?.canopy ?? '-'}`
  }
  return `t:${subject.tile.id}`
}

/**
 * A subject drawn once and kept as a data URL, or null when it cannot be drawn.
 *
 * Null is the honest answer and the caller must render nothing rather than a stand-in: either the loaded
 * catalog does not describe the subject, or the canvas could not be read back. The second case is worth
 * naming — `toDataURL` throws on a canvas that has had a cross-origin image drawn into it, which is exactly
 * what the baked tile PNGs are. It works because the backend serves CORS headers on `/tiles/*` AND
 * `newTileImage` sets `crossOrigin` before `src`; if either half regresses, every thumbnail goes blank at
 * once rather than quietly drawing something wrong.
 */
export function previewThumbnail(
  subject: PreviewSubject,
  view: PreviewView,
  zone: ZoneId,
  styleId: string,
  style: Style,
  px: number,
): string | null {
  if (typeof document === 'undefined') return null // SSR / jsdom: no canvas, and no thumbnail to show
  const key = `${keyOf(subject)}|${view}|${zone}|${styleId}|${px}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit

  const scene = buildPreviewScene(subject, zone, styleId)
  if (!scene) return null
  const canvas = document.createElement('canvas')
  // Swatches are wider than tall: an iso silhouette spreads sideways, and a square box wastes half of it.
  canvas.width = px
  canvas.height = Math.round(px * 0.72)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  drawPreviewScene(ctx, canvas.width, canvas.height, scene, view, style)

  let url: string
  try {
    url = canvas.toDataURL()
  } catch {
    // A tainted canvas. Report nothing rather than a broken picture — and do not cache the failure, so it
    // recovers on its own once the CORS headers are back.
    console.warn('[preview] the canvas could not be read back — thumbnails need CORS headers on /tiles/*')
    return null
  }
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, url)
  return url
}
