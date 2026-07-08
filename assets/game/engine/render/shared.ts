import { player as playerSprite } from '@/assets/ascii'
import { GridAsset, IsometricGrid } from '@/engine/IsometricGrid'
import { type AnimTransform } from '@/engine/cellAnimation'
import { darkenColor, lightenColor, luminanceTint, parseColor, varyIntensity, withAlpha } from '@/engine/colors'
import { entityAnimState, entityFrameIndex } from '@/engine/entityAnim'
import { entityArtFrame, entityFootprint } from '@/engine/entityArt'
import { type QuestMarker } from '@/engine/entityQuestMarker'
import { motionPos } from '@/engine/movement'
import { applyPose, type TilePose } from '@/engine/tileset/pose'
import { EMOJI_TILESET } from '@/engine/tileset/emojiTileset'
import { edgeToSide, footprintRing, footprintSide, labelForCell, treeSubpart } from '@/engine/stageGenerator'
import { terrainCaptions } from '@/engine/terrainLabels'
import { isDead } from '@/game/combat'
import { HIT_MARKER_MS, type HitMarker } from '@/game/runtime/combat'
import { type PlayerState } from '@/game/runtime/player'
import { type CombatState, type Entity } from '@/game/types'
import { type ResolvedFrame } from '@/game/runtime/entityAnimation'

// Monospace stack for all canvas ASCII glyphs (moved here from the page; render-only).
export const ASCII_FONT = '"JetBrains Mono", "Fira Code", "Consolas", monospace'

// ── ART-STYLE resolution at the draw site ────────────────────────────────────
// Every glyph draw funnels its element KIND + the active Style + this element's
// optional override through resolveVisual, then draws the result. The load-bearing
// property: on the ASCII style with NO override, resolveVisual returns the passthrough
// sentinel, so `resolveDraw` returns the caller's OWN default char+color unchanged —
// the fillText that follows is byte-identical to the pre-style code.
import { resolveVisual, type ElementKind, type ImageVisual, type Style } from '@/game/artStyle'

export interface DrawVisual {
  /** the char to fillText (the caller's default when passing through / drawing an image). */
  char: string
  /** the fill color (the caller's default when passing through). */
  color: string
  /** The geometry FILL/TINT — present ONLY when a non-ASCII style (or override) is active and
   *  carries a colour. Its presence is the load-bearing signal to the geometry-preserving draw
   *  sites: a styled unit fills its own iso DIAMOND / cube FACE with `tint` (keeping the angle +
   *  z) and draws `char` as a small hint, instead of stamping a flat upright emoji square. When
   *  it is undefined the caller draws EXACTLY as before (ASCII passthrough → byte-identical). */
  tint?: string
  /** present only when the active tile is an IMAGE — draw it instead of the glyph. */
  image?: ImageVisual
}

/** Resolve what to actually draw for one element. `defChar`/`defColor` are the caller's
 *  existing ASCII values; they are returned unchanged for the passthrough (ASCII) case.
 *  A styled glyph/image also reports its `tint` so the geometry-preserving sites can fill
 *  the diamond/cube with the tile's colour rather than draw a flat square. */
export function resolveDraw(
  kind: ElementKind,
  style: Style,
  override: string | null | undefined,
  defChar: string,
  defColor: string,
): DrawVisual {
  const v = resolveVisual(kind, style, override)
  if (v.kind === 'glyph') return { char: v.char, color: v.color ?? defColor, tint: v.color }
  // An image tile keeps its source glyph as the char (label + first-paint fallback before the PNG decodes).
  if (v.kind === 'image') return { char: v.char ?? defChar, color: v.color ?? defColor, image: v, tint: v.color }
  return { char: defChar, color: defColor } // ascii passthrough — identical to the old path
}

/** The effective per-cell tile override for an asset under a style. Auto-generated ground_decor litter
 *  gets a STYLE-SPECIFIC emoji override baked at generation (e.g. 🌼 blossom); that must NOT leak into
 *  ASCII, so under ASCII we drop it and the decor draws its own dingbat (✿). Manual pins on OTHER assets
 *  are untouched (they intentionally win over the active style, even ASCII). Resolved at RENDER time so a
 *  Style toggle updates the decor without regenerating the stage. */
export function assetOverride(asset: GridAsset, style: Style): string | null | undefined {
  if (asset.type === 'ground_decor' && style.id === 'ascii') return undefined // drop the auto emoji litter under ASCII
  return asset.tileOverride
}

// Image/atlas cache so a tile src is decoded once, not per frame. v1 ships no image
// pack, so this stays empty in practice, but the pixel-pack / Pixellab / upload path is wired.
const _imgCache = new Map<string, HTMLImageElement>()
export function tileImage(src: string): HTMLImageElement | null {
  if (typeof Image === 'undefined') return null
  let img = _imgCache.get(src)
  if (!img) { img = new Image(); img.src = src; _imgCache.set(src, img) }
  return img.complete && img.naturalWidth > 0 ? img : null
}

/** Index a tileset by emoji CHAR → baked image src. A weapon/shield/fist is drawn through drawPoseGlyph,
 *  which only receives the glyph char (not the tile key), so it can't take the resolveDraw image path —
 *  this lets it find the SAME pre-rendered PNG by char. Char is unique per weapon, so a duplicate-char
 *  collision (npc/player both 🧍) is irrelevant to the weapon lookup. Pure — tested directly. */
export function buildGlyphImageIndex(tiles: Record<string, { char?: string; image?: string }>): Map<string, string> {
  const map = new Map<string, string>()
  for (const key of Object.keys(tiles)) {
    const tile = tiles[key]
    if (tile?.image && tile?.char) map.set(tile.char, tile.image)
  }
  return map
}

// Rebuilt only when EMOJI_TILESET is SWAPPED (a DB tileset load reassigns the live binding), never per
// frame — the index is keyed by the tileset object reference.
let _glyphIndex: { src: unknown; map: Map<string, string> } | null = null
function glyphImageIndex(): Map<string, string> {
  if (_glyphIndex?.src !== EMOJI_TILESET) _glyphIndex = { src: EMOJI_TILESET, map: buildGlyphImageIndex(EMOJI_TILESET) }
  return _glyphIndex.map
}

/** The baked tile IMAGE for a glyph drawn by char (a held weapon / shield / fist), or null when the
 *  active tileset has no image for it — then the caller draws the glyph, byte-identically to before. */
export function glyphTileImage(glyph: string): HTMLImageElement | null {
  const src = glyphImageIndex().get(glyph)
  return src ? tileImage(src) : null
}

/** The baked IMAGE VISUAL for a glyph char, or undefined when the active tileset has no image for it —
 *  the ImageVisual twin of glyphTileImage (so an animation frame's char resolves to a drawable tile). */
export function glyphImageVisual(glyph: string): ImageVisual | undefined {
  const src = glyphImageIndex().get(glyph)
  return src ? { kind: 'image', src } : undefined
}

/** Resolve the CURRENT animation FRAME to the baked IMAGE to draw, or undefined when the frame is a glyph
 *  the caller should draw itself (so an authored walk/idle actually PLAYS on a baked-image figure, instead
 *  of the render freezing on the static base tile). Precedence: an explicit frame image → a frame whose
 *  char IS the base tile's own char draws the base image (variant-exact) → any other char resolves to ITS
 *  baked image (none → undefined, the caller draws the glyph) → an empty frame → the base image. */
export function frameImage(frame: ResolvedFrame, baseChar: string, baseImage: ImageVisual | undefined): ImageVisual | undefined {
  if (frame.image) return frame.image
  if (frame.char) return frame.char === baseChar ? baseImage : glyphImageVisual(frame.char)
  return baseImage
}

/** Draw a glyph centered at (x, y), optionally MIRRORED horizontally about x. The mirror is a DATA
 *  property of the animation frame (e.g. a right-facing walk reuses the left-facing emoji flipped) —
 *  the renderer only honors the flag, it never decides to flip. Uses the current font / fillStyle. */
export function drawFacingGlyph(ctx: CanvasRenderingContext2D, char: string, x: number, y: number, flipX: boolean): void {
  if (!flipX) { ctx.fillText(char, x, y); return }
  ctx.save()
  ctx.translate(x, 0)
  ctx.scale(-1, 1)
  ctx.fillText(char, 0, y)
  ctx.restore()
}

// A baked emoji tile ships with its own colours, so an editor colour override can't just change a fill —
// it has to RECOLOUR the sprite. We do it once per (src, colour) into an offscreen canvas and cache it:
// draw the sprite, blend the colour with `'color'` (keeps the sprite's shading/luminance, takes the
// override's hue+saturation), then `'destination-in'` re-masks to the sprite's alpha so transparent
// pixels stay transparent. Keyed by src+colour at natural resolution, so it's size-independent.
const _tintCache = new Map<string, HTMLCanvasElement>()
export function tintedImage(img: HTMLImageElement, src: string, tint: string): CanvasImageSource {
  if (typeof document === 'undefined') return img // SSR / tests: no canvas → draw untinted
  const key = `${src}|${tint}`
  const cached = _tintCache.get(key)
  if (cached) return cached
  const w = img.naturalWidth || 64, h = img.naturalHeight || 64
  const off = document.createElement('canvas')
  off.width = w
  off.height = h
  const octx = off.getContext('2d')
  if (!octx) return img
  octx.drawImage(img, 0, 0, w, h)
  // Luminance-mapped colorize (see colors.luminanceTint): recolour each pixel to `tint` scaled by its
  // own luminance, so WHITE→the full colour, darks→dark, and shading is kept. The old 'color' composite
  // blend PRESERVED luminance, so white sprites (a daisy) stayed white and couldn't be recoloured. Alpha
  // is untouched (silhouette preserved). Cached per src+colour → this per-pixel pass runs once. Guarded:
  // a tainted (cross-origin) canvas can't be read back, so we leave the sprite untinted instead of throwing.
  const rgb = parseColor(tint)
  if (rgb) {
    try {
      const id = octx.getImageData(0, 0, w, h)
      const px = id.data
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] === 0) continue // transparent → skip (keep the silhouette)
        const o = luminanceTint(px[i], px[i + 1], px[i + 2], rgb)
        px[i] = o.r; px[i + 1] = o.g; px[i + 2] = o.b
      }
      octx.putImageData(id, 0, 0)
    } catch { /* tainted canvas — leave the sprite untinted */ }
  }
  _tintCache.set(key, off)
  return off
}

/** Draw an image tile centered at (cx, cy) filling a `size`×`size` box (optional atlas sub-rect).
 *  `flipX` mirrors it horizontally about cx — a DATA property of an animation frame (a right-facing
 *  walk reuses the left-facing tile flipped), so the baked-image figure animates like the glyph one.
 *  `tint` (an editor colour override) recolours the sprite to that hue while keeping its shading. */
export function drawStyledImage(ctx: CanvasRenderingContext2D, v: ImageVisual, cx: number, cy: number, size: number, flipX = false, tint?: string, sizeH?: number): void {
  const img = tileImage(v.src)
  if (!img) return
  const drawSrc = tint ? tintedImage(img, v.src, tint) : img
  const sx = v.sx ?? 0, sy = v.sy ?? 0
  const sw = v.sw ?? img.naturalWidth, sh = v.sh ?? img.naturalHeight
  // `size` is the draw WIDTH; `sizeH` the draw HEIGHT (defaults to a square). Non-uniform sizes come
  // from per-element dimensions (#77/#78) — the caller lifts cy so Height grows up from the base.
  const w = size, h = sizeH ?? size
  if (!flipX) { ctx.drawImage(drawSrc, sx, sy, sw, sh, cx - w / 2, cy - h / 2, w, h); return }
  ctx.save()
  ctx.translate(cx, 0)
  ctx.scale(-1, 1)
  ctx.drawImage(drawSrc, sx, sy, sw, sh, -w / 2, cy - h / 2, w, h)
  ctx.restore()
}

// Enemies advance one patrol cell roughly every ENEMY_MOVE_MS (throttled, so
// patrols read as steps, not a blur). Shared by the AI loop (page) and the
// render-side motion interpolation (entityRenderCell).
export const ENEMY_MOVE_MS = 360 // one patrol cell per this interval — slower, deliberate monster pace

// Debug overlay flag. The page toggles it; the renderers read it. Kept as module
// state with accessors so the renderers and the page share one source of truth.
let _debugMode = false
export const isDebugMode = (): boolean => _debugMode
export const setDebugMode = (v: boolean): void => { _debugMode = v }

// Collision overlay flag — a lighter sibling of the debug overlay: it tints only the BLOCKED cells
// (no coords, no tileset labels), so the raw collision layer is visible over the live game in any
// view. Its own toggle so you can watch collisions without the busy debug labels.
let _showCollisions = false
export const isShowCollisions = (): boolean => _showCollisions
export const setShowCollisions = (v: boolean): void => { _showCollisions = v }

// Render function - ASCII art on isometric diamond tiles
// Eased per-entity render position (fractional cell) so run-patrol steps GLIDE in the
// iso view instead of teleporting. Ephemeral render cache keyed by entity id.
// Per-entity render motion: from→to over one patrol tick, stamped when the logical cell
// changes (see the patrol tick). The renderers read entityRenderCell(...) every frame, so
// movement is the SAME deterministic, unit-tested function (motionPos) in every game view.
export const entityMotion = new Map<string, { from: { col: number; row: number }; to: { col: number; row: number }; startMs: number }>()


/** The entity's interpolated render cell at `now` (its logical cell if it never moved). */
export function entityRenderCell(entity: Entity, now: number): { col: number; row: number } {
  const m = entityMotion.get(entity.id)
  if (!m) return { col: entity.col, row: entity.row }
  return motionPos(m.from, m.to, m.startMs, now, ENEMY_MOVE_MS)
}


// ── LIGHTING MODEL ───────────────────────────────────────────────────────────
// ONE global light source so per-face shading + drop-shadows reference the same sun instead of
// scattering magic angles. `dir` is the normalized screen-space direction pointing FROM a surface
// TOWARD the sun (upper-left). Day = bright, sun-driven shading + lamps off; night = a dark navy
// veil pierced by steady warm lamp pools (drawNightLighting).
export type DayNight = 'day' | 'night'

export const LIGHT = {
  dir: { x: -0.6, y: -0.8 }, // sun from the upper-left
  night: { overlay: 'rgba(10, 14, 38, 0.5)' }, // deep-navy veil laid over the whole scene
}

export const LAMP_GLOW = { rgb: '255, 217, 138', radiusTiles: 3.2 } // warm night light pool


/** Night pass: darken the whole canvas with a navy veil, then punch warm radial light pools through
 *  it at each lamp (additive 'lighter' blend). Steady — never a flicker. `lamps` are screen-space
 *  centres + pixel radii. */
export function drawNightLighting(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  lamps: readonly { x: number; y: number; r: number }[],
): void {
  ctx.save()
  ctx.fillStyle = LIGHT.night.overlay
  ctx.fillRect(0, 0, w, h)
  ctx.globalCompositeOperation = 'lighter'
  for (const l of lamps) {
    const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r)
    g.addColorStop(0, `rgba(${LAMP_GLOW.rgb}, 0.55)`)
    g.addColorStop(0.45, `rgba(${LAMP_GLOW.rgb}, 0.2)`)
    g.addColorStop(1, `rgba(${LAMP_GLOW.rgb}, 0)`)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(l.x, l.y, l.r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}


/** Screen-space centres + radii of every lamp/lantern on the grid that lands on-screen — the
 *  anchors for the night light pools. `cellCenter` maps a cell to its screen centre (each view
 *  projects differently); `lift` raises the pool to the lamp head. Shared by all views. */
export function collectLampGlows(
  grid: IsometricGrid,
  cellCenter: (col: number, row: number) => { x: number; y: number },
  radiusPx: number,
  lift: number,
  w: number,
  h: number,
): { x: number; y: number; r: number }[] {
  const out: { x: number; y: number; r: number }[] = []
  for (const a of grid.assets) {
    if (a.type !== 'lamp' && a.type !== 'lantern') continue
    const p = cellCenter(a.col, a.row)
    const y = p.y - lift
    if (p.x < -radiusPx || p.x > w + radiusPx || y < -radiusPx || y > h + radiusPx) continue
    out.push({ x: p.x, y, r: radiusPx })
  }
  return out
}


/** Deterministic per-cell grass tint: a stable position hash nudges the base grass bg lighter
 *  or darker so the lawn reads as natural patches instead of one flat sheet. Computed from
 *  (col,row) only — stable per cell, never shifts frame-to-frame. Paths/roads never call this. */
export function grassShade(baseBg: string, col: number, row: number): string {
  const n = Math.sin(col * 127.1 + row * 311.7) * 43758.5453
  return varyIntensity(baseBg, n - Math.floor(n), 0.22)
}

/** Fill colour for a ground cell. A reskin (`tint` set) normally fills with the tile's flat catalog
 *  hue — but for GRASS that made a whole field ONE flat green ("grass is just color"), because the
 *  flat tint overrode the per-cell shade. So grassy cells keep the same deterministic grassShade
 *  variation the ASCII grass has, applied to the emoji hue. No tint (ASCII) → the precomputed bg. */
export function cellFill(tint: string | undefined, bg: string, grassy: boolean, col: number, row: number): string {
  if (!tint) return bg
  return grassy ? grassShade(tint, col, row) : tint
}

/** Draw an emoji glyph RECOLOURED toward `tint`, keeping its shape + internal shading — so one 🌲 reads
 *  spring-green, autumn-amber, or winter-frost by the zone's canopy colour (emoji CAN be recoloured: we
 *  overlay the tint with `source-atop`, which only paints the glyph's own opaque pixels, never the ground
 *  behind it). `glyphPx` is the drawn font size (sizes the overlay); `strength` 0–1 is how hard to push
 *  the hue (0 = the emoji's native colours). Caller sets font + textAlign:'center' before calling. */
// A reusable OFFSCREEN canvas for per-glyph recolouring. The tint MUST be applied on a layer that holds
// ONLY the glyph — `source-atop` over the MAIN canvas tints every opaque pixel under the rect (the ground
// behind the tree → a coloured BOX, the bug). On its own offscreen it clips to the glyph alone.
let _tintCanvas: HTMLCanvasElement | null = null
function tintScratch(size: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  if (!_tintCanvas) _tintCanvas = document.createElement('canvas')
  if (_tintCanvas.width < size) _tintCanvas.width = size
  if (_tintCanvas.height < size) _tintCanvas.height = size
  return _tintCanvas
}

export function fillTintedGlyph(ctx: CanvasRenderingContext2D, char: string, x: number, y: number, glyphPx: number, tint?: string, strength = 0.5): void {
  if (!tint || strength <= 0) { ctx.fillText(char, x, y); return }
  const size = Math.ceil(glyphPx * 2)
  const off = tintScratch(size)
  const octx = off?.getContext('2d')
  if (!off || !octx) { ctx.fillText(char, x, y); return } // no offscreen (SSR) → draw untinted, never a box
  octx.clearRect(0, 0, off.width, off.height)
  octx.font = ctx.font
  octx.textAlign = 'center'
  octx.textBaseline = 'middle'
  octx.fillStyle = '#ffffff'
  octx.fillText(char, size / 2, size / 2) // the emoji renders in its own colours (fillStyle ignored)
  // Recolour ONLY the emoji's pixels — the offscreen holds nothing else, so no background box.
  octx.globalCompositeOperation = 'source-atop'
  octx.globalAlpha = Math.min(1, Math.max(0, strength))
  octx.fillStyle = tint
  octx.fillRect(0, 0, size, size)
  octx.globalCompositeOperation = 'source-over'
  octx.globalAlpha = 1
  // Blit centred at (x,y) — the tree callers draw center/middle, so this lands exactly where fillText would.
  ctx.drawImage(off, 0, 0, size, size, x - size / 2, y - size / 2, size, size)
}


// A cached offscreen canvas per (glyph, size, tint, strength). The recolour pass (source-atop fill) runs
// once per key, not per frame — buildings are sparse, so a handful of roof sprites cover a whole scene.
const _tintGlyphCache = new Map<string, HTMLCanvasElement | null>()

/** A standalone RECOLOURED-glyph sprite: `char` drawn to its own `px` canvas, then repainted to `tint`
 *  (source-atop, keeping the emoji silhouette + shading) — the reusable twin of fillTintedGlyph's inline
 *  recolour. Returned as a canvas so a caller under an iso SHEAR CTM (fillIsoFaceWithTile / a clipped roof
 *  face) can drawImage it onto the angled face — you can't shear a colour-emoji with fillText+fillStyle
 *  (the glyph ignores fillStyle), so this is how the roof 🟥 becomes the building's own roof colour on the
 *  iso roof. Null in SSR / headless (no 2D offscreen) → callers fall back to an untinted glyph stamp. */
export function tintedGlyphSprite(char: string, px: number, tint: string, strength = 1): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  const size = Math.max(2, Math.ceil(px))
  const key = `${char}|${size}|${tint}|${strength}`
  const hit = _tintGlyphCache.get(key)
  if (hit !== undefined) return hit
  const off = document.createElement('canvas')
  off.width = size
  off.height = size
  const octx = off.getContext('2d')
  if (!octx) { _tintGlyphCache.set(key, null); return null }
  octx.textAlign = 'center'
  octx.textBaseline = 'middle'
  octx.font = `${size * 1.16}px ${ASCII_FONT}` // slight overfill so the glyph covers the box (matches fillIsoFaceWithTile)
  octx.fillText(char, size / 2, size / 2) // the emoji renders in its own colours (fillStyle ignored)
  octx.globalCompositeOperation = 'source-atop' // recolour ONLY the emoji's pixels — no background box
  octx.globalAlpha = Math.min(1, Math.max(0, strength))
  octx.fillStyle = tint
  octx.fillRect(0, 0, size, size)
  _tintGlyphCache.set(key, off)
  return off
}


/** Clamp a camera focus coord (in cells) so a viewport spanning `halfSpan` cells
 *  each side stays inside [0, total]; if the grid is smaller than the viewport,
 *  centre it. Used by the orthographic 2D + top views. */
export function clampCameraAxis(focus: number, halfSpan: number, total: number): number {
  if (total <= halfSpan * 2) return total / 2
  return Math.min(Math.max(focus, halfSpan), total - halfSpan)
}


/** Clamp a focus coord into [lo, hi] keeping `pad` units of viewport each side; if that span
 *  is narrower than the viewport, centre it. The general form of clampCameraAxis (which is just
 *  this with lo = 0, hi = total). */
export function clampCameraSpan(focus: number, pad: number, lo: number, hi: number): number {
  // Map SMALLER than the viewport (span ≤ 2·pad) → re-centre it. Otherwise clamp the focus to the
  // MAP EXTENT [lo, hi] so ANY cell (incl. the corners) can be dragged to centre — free pan. The old
  // `[lo+pad, hi-pad]` kept the whole viewport inside the map, which for a viewport ~as big as the map
  // pinned the camera so dragging did nothing (you may now see a little void past an edge — expected).
  if (hi - lo <= pad * 2) return (lo + hi) / 2
  return Math.min(Math.max(focus, lo), hi)
}


/** Clamp an ISOMETRIC camera focus (col `fc`, row `fr`) so the viewport can pan all the way to
 *  the map's top/bottom and left/right corners. Iso screen axes are the diagonals
 *  p = col - row (horizontal) and q = col + row (vertical); the viewport spans ±`pPad` in p and
 *  ±`qPad` in q.
 *
 *  We clamp in (p, q) space: q to the diamond's full vertical extent [0, cols + rows] so the
 *  camera reaches the top/bottom corners — the old combined col/row clamp stopped it `pPad`
 *  short of them (#38) — then p to the diamond's WIDTH AT THAT HEIGHT so the sides stay inside
 *  the diamond. Returns the clamped {fc, fr}. */
export function isoCameraFocus(
  fc: number,
  fr: number,
  pPad: number,
  qPad: number,
  cols: number,
  rows: number,
): { fc: number; fr: number } {
  // q = col + row (vertical screen axis): the diamond spans q ∈ [0, cols + rows].
  const fq = clampCameraSpan(fc + fr, qPad, 0, cols + rows)
  // p = col - row (horizontal). At height q the diamond's four edges bound p to:
  //   col ≥ 0 → p ≥ -q ;  col ≤ cols → p ≤ 2·cols - q ;  row ≥ 0 → p ≤ q ;  row ≤ rows → p ≥ q - 2·rows
  const pLo = Math.max(-fq, fq - 2 * rows)
  const pHi = Math.min(fq, 2 * cols - fq)
  const fp = clampCameraSpan(fc - fr, pPad, pLo, pHi)
  return { fc: (fp + fq) / 2, fr: (fq - fp) / 2 }
}


// Draw player as ASCII art in isometric view (matching 2D style)
/** A flat ground shadow centered at (cx, footY), sized a bit WIDER than the figure's
 *  half-width so it always reads beneath the figure instead of hiding behind it.
 *  Figure-relative = deterministic, no per-figure pixel guessing. */
export function drawGroundShadow(ctx: CanvasRenderingContext2D, cx: number, footY: number, halfWidth: number): void {
  ctx.save()
  ctx.fillStyle = 'rgba(0, 0, 0, 0.32)'
  ctx.beginPath()
  ctx.ellipse(cx, footY, halfWidth * 1.15, Math.max(2, halfWidth * 0.34), 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}


export interface PlayerArmParams {
  /** true → an attack is mid-flight; the arm bracket swings and carries the weapon */
  swinging: boolean
  /** 0..1 swing progress (0 = windup/up, 1 = strike/forward); ignored when not swinging */
  swingP: number
  /** +1 facing right, -1 facing left */
  facingDir: number
  /** true → an emoji/reskin style is active: draw NO ASCII art (the `>`/`<` swing-arm bracket is skipped;
   *  the emoji figure has its own arms and the weapon/fist swings on its own). ASCII keeps the bracket. */
  isEmoji?: boolean
  /** drives the arm font + the derived charW/armR/weaponSize (identical ratios in both views) */
  fontSize: number
  /** arm-bracket fill colour (the figure's body colour) */
  bodyColor: string
  weaponGlyph?: string
  /** the equipped weapon's POSE (orientation/size/flip) from the tileset — drives the emoji weapon draw. */
  weaponPose?: TilePose
  /** bare-handed PUNCH glyph + pose (emoji 👊) — swung at the hand when UNARMED (no weaponGlyph) AND
   *  swinging, via the SAME pose path as a weapon. Absent/'' → an unarmed swing draws no glyph (ASCII). */
  punchGlyph?: string
  punchPose?: TilePose
  /** default weapon top-fill colour (iso #e6e6e6 / 2D #e0e0e0) */
  weaponTint: string
  /** attack-driven tint that overrides weaponTint on the swing (ability recolour) */
  swingTint?: string
  /** swing pivot (the shoulder) */
  shoulderX: number
  shoulderY: number
  /** weapon hand when NOT swinging (the rest pose) */
  restHandX: number
  restHandY: number
  shieldGlyph?: string
  /** the equipped shield's POSE from the tileset — drives the emoji shield draw (absent = today's look). */
  shieldPose?: TilePose
  shieldX: number
  shieldY: number
  shieldR: number
}


/**
 * The player's held weapon (swung in-hand mid-attack, rested otherwise) + the off-hand shield disc.
 * Shared by the iso (drawIsoPlayer) and 2D player renderers — they differ ONLY in the coordinate
 * source (and the per-view weapon-tint + shield-radius), all passed in. charW/armR/weaponSize derive
 * from fontSize with the same ratios both views already used, so the output is pixel-identical.
 */
/** An emoji weapon renders in its OWN colour, so it must NOT be drawn twice (a black-shadow pass doubles
 *  it) like a monochrome ASCII glyph — this check routes an emoji glyph to the single-draw pose path. */
const isWeaponEmoji = (g: string): boolean => /\p{Extended_Pictographic}/u.test(g)

/** Draw a glyph at the current origin (the hand / cell centre — the caller has already translated + saved),
 *  applying a tile POSE: mirror (flip XOR left-facing) → rotate → offset → scale, then ONE fillText. `unit`
 *  is the base draw size in px; the pose's `scale` multiplies it. This replaces the hardcoded WEAPON_ORIENT
 *  + emojiWeaponSize table: a seeded weapon pose reproduces the old look exactly (uniform scale commutes
 *  with rotation, so font=unit + applyPose(scale) renders the same as the old font=scale×unit). */
export function drawPoseGlyph(ctx: CanvasRenderingContext2D, glyph: string, pose: TilePose | null | undefined, facingDir: number, unit: number): void {
  ctx.font = `bold ${unit}px ${ASCII_FONT}` // bold so a monochrome (ascii) weapon glyph reads as heavy as the old hardcoded branch; emoji ignore weight
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  applyPose(ctx, pose, facingDir, unit)
  // Prefer the baked PNG (identical on every OS) — the pose transform already applied above carries the
  // image (rotate/flip/scale) exactly as it did the glyph. No image (ascii / backend down) → fillText.
  const img = glyphTileImage(glyph)
  if (img) { ctx.drawImage(img, -unit / 2, -unit / 2, unit, unit); return }
  // A colour EMOJI glyph carries its own shading → draw once. A MONOCHROME (ascii) glyph gets a black
  // under-draw for crisp depth — the double-draw the ascii weapon used to do in its own branch, now a
  // property of drawing ANY glyph here (one path). The caller's fillStyle is the top (tint) colour.
  if (isWeaponEmoji(glyph)) { ctx.fillText(glyph, 0, 0); return }
  const top = ctx.fillStyle
  ctx.fillStyle = '#000000'
  ctx.fillText(glyph, 0, 1)
  ctx.fillStyle = top
  ctx.fillText(glyph, 0, 0)
}

export function drawPlayerArm(ctx: CanvasRenderingContext2D, params: PlayerArmParams): void {
  const { swinging, swingP, facingDir, fontSize, bodyColor, weaponGlyph, weaponTint, swingTint } = params
  const charW = fontSize * 0.6
  const armR = charW * 1.15 // SHORT — about one char (≈ the walk arm / legs), not the full reach
  ctx.textAlign = 'center'
  if (swinging) {
    // The swing arm IS the figure’s facing bracket, pivoting at the SHOULDER and rotating from
    // raised-UP (swingP 0) down to forward/MIDDLE (swingP 1). The held weapon rides at its hand.
    const armChar = facingDir > 0 ? '>' : '<'
    const rot = -facingDir * 1.3 * (1 - swingP)
    ctx.save()
    ctx.translate(params.shoulderX, params.shoulderY)
    ctx.rotate(rot)
    ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = bodyColor
    // Under emoji/reskin the figure is a single glyph with its own arms — an ASCII `>`/`<` bracket next to
    // it is exactly the "ascii art on the emoji tileset" the player never wants. Only ASCII draws it.
    if (!params.isEmoji) ctx.fillText(armChar, facingDir * armR, 0)
    // The swing carries the held weapon, or — bare-handed under a reskin — the 👊 fist. BOTH take the ONE
    // pose path: the weapon's tileset POSE drives orientation/size (emoji from emoji.json, ASCII from the
    // ascii tileset / ASCII_WEAPON_POSE), and drawPoseGlyph draws the baked image or, for a glyph weapon,
    // the glyph with its depth shadow — so there's no separate ASCII rotate/shadow branch here anymore.
    const swingGlyph = weaponGlyph || params.punchGlyph
    const swingPose = weaponGlyph ? params.weaponPose : params.punchPose
    if (swingGlyph) {
      ctx.translate(facingDir * (armR + charW), 0) // the hand, just past the bracket
      ctx.fillStyle = swingTint ?? weaponTint // the top colour for a monochrome (ascii) glyph; an emoji ignores it
      drawPoseGlyph(ctx, swingGlyph, swingPose, facingDir, fontSize)
    }
    ctx.restore()
    ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
  } else if (weaponGlyph) {
    // Holding (not swinging): the weapon rests in the figure’s natural hand — the SAME one pose path.
    ctx.save()
    ctx.translate(params.restHandX, params.restHandY)
    ctx.fillStyle = weaponTint
    drawPoseGlyph(ctx, weaponGlyph, params.weaponPose, facingDir, fontSize)
    ctx.restore()
    ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
  }
  // Shield on the OFF-hand.
  if (params.shieldGlyph) {
    const { shieldX: shX, shieldY: shY, shieldR: shR } = params
    if (isWeaponEmoji(params.shieldGlyph)) {
      // Emoji shield (🛡️) is already a shield image — draw it ONCE at the shield size through the pose path
      // (no steel disc, no black-shadow double). facingDir=1: the shield never mirrors with the facing, so
      // an absent pose reproduces today's plain fillText(shX,shY) exactly.
      ctx.save()
      ctx.translate(shX, shY)
      drawPoseGlyph(ctx, params.shieldGlyph, params.shieldPose, 1, shR * 2)
      ctx.restore()
    } else {
      // ASCII shield glyph: a FILLED disc behind the glyph so it reads as a solid shield.
      ctx.beginPath()
      ctx.arc(shX, shY, shR, 0, Math.PI * 2)
      ctx.fillStyle = '#3f5f8f' // steel-blue shield body
      ctx.fill()
      ctx.beginPath()
      ctx.arc(shX, shY, shR * 0.34, 0, Math.PI * 2)
      ctx.fillStyle = '#cfe6ff' // centre boss highlight
      ctx.fill()
      ctx.fillStyle = '#000000'
      ctx.fillText(params.shieldGlyph, shX + 1, shY + 1)
      ctx.fillStyle = '#9fd3ff' // bright rim (the glyph) over the filled body
      ctx.fillText(params.shieldGlyph, shX, shY)
    }
  }
}

/**
 * Draw a travelling projectile rotated to point along its SCREEN-SPACE travel vector. The arrow glyphs
 * (➤ →) natively aim RIGHT (angle 0), so we rotate by the vector's angle to make them follow the shot in
 * ANY direction (fixed "arrows always point right / backwards"); a symmetric bullet (•) is unaffected.
 * The caller projects from/to into ITS view's screen space (iso vs 2D) and sets font/fill before calling.
 */
export function drawProjectileGlyph(
  ctx: CanvasRenderingContext2D,
  glyph: string,
  drawX: number,
  drawY: number,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): void {
  const angle = Math.atan2(toY - fromY, toX - fromX)
  ctx.save()
  ctx.translate(drawX, drawY)
  ctx.rotate(angle)
  ctx.fillText(glyph, 0, 0)
  ctx.restore()
}


// Draw asset as ASCII art in isometric view (matching 2D style)
/** Draw a generated, labeled cell as a single glyph (its label char + zone color)
 *  on a subtle backing — one cell = one tile, matching the keystone model. */
// Apex signage per building TYPE — makes a store / hospital read at a glance.
export const BUILDING_BADGES: Record<string, { text: string; color: string }> = {
  store: { text: 'STORE', color: '#ffe24a' }, // gold marquee on the blue store
  hospital: { text: 'HOSPITAL', color: '#ffffff' }, // white word on the green hospital (green+white identity)
}


/** An enemy that's been killed and is waiting to respawn (no live combat state). */
export function isDeadEnemy(entity: Entity, combat: CombatState | undefined): boolean {
  if (entity.kind !== 'enemy') return false
  return !!combat && isDead(combat.hp)
}



/** Color the HP bar fill green→amber→red as the enemy is whittled down. */
export function hpBarColor(fraction: number): string {
  if (fraction > 0.5) return '#4ade80'
  if (fraction > 0.25) return '#facc15'
  return '#f87171'
}


/** Draw a small HP bar centred at (x,y) — shared by iso + top enemy rendering. */
export function drawHpBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  fraction: number,
): void {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.75)'
  ctx.fillRect(x - width / 2 - 1, y - 1, width + 2, height + 2)
  ctx.fillStyle = '#3a1414'
  ctx.fillRect(x - width / 2, y, width, height)
  ctx.fillStyle = hpBarColor(fraction)
  ctx.fillRect(x - width / 2, y, width * fraction, height)
}


/** Draw a fading "+N" damage number that drifts upward over its lifetime. */
export function drawHitMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  marker: HitMarker,
  now: number,
): void {
  const age = (now - marker.bornAt) / HIT_MARKER_MS
  if (age >= 1) return
  const rise = age * 24
  ctx.globalAlpha = 1 - age
  ctx.font = `bold 16px ${ASCII_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#000000'
  ctx.fillText(`-${marker.amount}`, x + 1, y - 18 - rise + 1)
  ctx.fillStyle = marker.target === 'enemy' ? '#ffd166' : '#ff6b6b'
  ctx.fillText(`-${marker.amount}`, x, y - 18 - rise)
  ctx.globalAlpha = 1
}


// Quest indicators floating above entities: a gold "!" over a giver, an amber "◆"
// over a quest-linked enemy. Colors echo the quest UI's orange accent.
export const QUEST_GIVER_COLOR = '#ffe14d'

export const QUEST_TARGET_COLOR = '#ff9f1c'


/** Draw centred text with a 1px black drop-shadow then a bright fill — legible over any map tile. */
export function drawShadowText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  font: string,
): void {
  ctx.font = font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#000000'
  ctx.fillText(text, x + 1, y + 1)
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
}


/** Draw the above-entity quest marker (shared by iso / 2D / top views). */
export function drawQuestMarker(
  ctx: CanvasRenderingContext2D,
  marker: QuestMarker,
  x: number,
  y: number,
  size: number,
): void {
  if (!marker) return
  if (marker === 'giver') {
    drawShadowText(ctx, '!', x, y, QUEST_GIVER_COLOR, `bold ${size}px ${ASCII_FONT}`)
    return
  }
  drawShadowText(ctx, '◆', x, y, QUEST_TARGET_COLOR, `bold ${size * 0.8}px ${ASCII_FONT}`)
}


/** Warm parchment tone for the name floating over a figure (enemy type or player name). */
export const VITALS_NAME_COLOR = '#ffe8c2'


/** HP bar + name label floating above a figure — shared by enemies AND the player so the two
 *  read identically. `x` is the figure centre, `figureTop` the y of the figure's top edge.
 *  Returns the anchor just above the name (where an above-figure quest marker sits). */
export function drawFigureVitals(
  ctx: CanvasRenderingContext2D,
  x: number,
  figureTop: number,
  barWidth: number,
  barHeight: number,
  nameSize: number,
  fraction: number,
  label: string,
): { x: number; y: number } {
  drawHpBar(ctx, x, figureTop, barWidth, barHeight, fraction)
  const nameY = figureTop - nameSize * 0.85
  drawShadowText(ctx, label, x, nameY, VITALS_NAME_COLOR, `bold ${nameSize}px ${ASCII_FONT}`)
  return { x, y: nameY - nameSize * 0.9 }
}

export const idleNow = (): number => (typeof performance !== 'undefined' ? performance.now() : 0)


// An enemy within this many cells of the player reads as "in combat".
export const COMBAT_RANGE = 1.6


/** Is the enemy within the player's weapon REACH right now — i.e. some cell of its footprint is
 *  ≤ reach cells (chebyshev) from the player's cell? Footprint-aware so it matches the targeting:
 *  when this is true, a strike will land. Drives the on-monster range indicator (#35). */
export function enemyInAttackReach(entity: Entity, pCol: number, pRow: number, reach: number): boolean {
  if (entity.kind !== 'enemy' || entity.hittable === false) return false
  const { w, h } = entityFootprint(entity)
  const left = entity.col - Math.floor((w - 1) / 2)
  const right = entity.col + Math.ceil((w - 1) / 2)
  const top = entity.row - (h - 1)
  const dx = Math.max(left - pCol, 0, pCol - right)
  const dy = Math.max(top - pRow, 0, pRow - entity.row)
  return Math.max(dx, dy) <= reach
}


/** A subtle pulsing ring at an enemy's feet, shown only while it's in strike range — quiet, but
 *  unmistakable: warm red-orange = "an attack will hit this one". */
export function drawRangeRing(ctx: CanvasRenderingContext2D, cx: number, footY: number, radiusX: number, now: number): void {
  const pulse = 0.5 + 0.5 * Math.sin(now * 0.006)
  ctx.save()
  ctx.lineWidth = 2
  ctx.strokeStyle = `rgba(255, 96, 56, ${0.4 + 0.4 * pulse})`
  ctx.beginPath()
  ctx.ellipse(cx, footY, radiusX, Math.max(2, radiusX * 0.42), 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

/** WoW-style TARGET reticle: a bright RED ring at the current target's feet — the "this unit is selected"
 *  indicator (distinct from the pulsing strike-range ring above). Solid so it reads at a glance. */
export function drawSelectionRing(ctx: CanvasRenderingContext2D, cx: number, footY: number, radiusX: number): void {
  ctx.save()
  ctx.lineWidth = 2.5
  ctx.strokeStyle = 'rgba(255, 40, 40, 0.95)'
  ctx.beginPath()
  ctx.ellipse(cx, footY, radiusX, Math.max(2, radiusX * 0.42), 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

/** HOVER reticle: a dim WHITE ring at the unit under the cursor — the "you'd target this" hint. Distinct
 *  from the solid red selection ring (dimmer + thinner) so hover ≠ selected. Skipped for the already-
 *  selected unit (the red ring wins), so a hovered target doesn't get two overlapping rings. */
export function drawHoverRing(ctx: CanvasRenderingContext2D, cx: number, footY: number, radiusX: number): void {
  ctx.save()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)'
  ctx.beginPath()
  ctx.ellipse(cx, footY, radiusX, Math.max(2, radiusX * 0.42), 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

/** The entity's animation frame, gated on movement: idle HOLDS a static pose (no leg/arm
 *  swap over time), walk swaps the base/alt art (frame 0/1) only while the entity is moving,
 *  and combat swaps when an enemy is in range. Pure selection lives in engine/entityAnim. */
export const ENTITY_FRAME_COUNT = 2 // entity art has a base pose (0) and an alt pose (1)

export function entityAnimFrame(entity: Entity, now: number, moving: boolean, inRange: boolean): readonly string[] {
  const state = entityAnimState({ moving, inRange, kind: entity.kind })
  return entityArtFrame(entity, entityFrameIndex(state, now, ENTITY_FRAME_COUNT))
}


/** The 3 canopy layer styles (fg + bg) derived from ONE base tree color, so a
 *  legacy (hand-placed, label-less) tree's canopy tints to the asset's
 *  zone/theme color instead of a hardcoded spring green. The trunk stays bark —
 *  only the canopy (the "always green" part) follows the color. Shared by the iso
 *  and 2D legacy tree paths. */
export function treeCanopyLayers(base: string, flicker: number): { fg: string; bg: string }[] {
  return [
    { fg: withAlpha(base, 0.7 + 0.3 * flicker), bg: darkenColor(base, 0.4) },
    { fg: withAlpha(lightenColor(base, 0.12), 0.8 + 0.2 * flicker), bg: darkenColor(base, 0.5) },
    { fg: withAlpha(base, 0.85 + 0.15 * flicker), bg: darkenColor(base, 0.45) },
  ]
}


/**
 * Push a cell-animation transform onto the canvas around pivot (x, y): translate by the frame's
 * dx/dy (fractions of a tile), then rotate + scale about the pivot. Calls ctx.save(); the caller
 * MUST ctx.restore() once the asset is drawn. unitX/unitY = the tile size the offsets scale against.
 */
export function applyCellTransform(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  t: AnimTransform,
  unitX: number,
  unitY: number,
): void {
  ctx.save()
  ctx.translate(x + t.dx * unitX, y + t.dy * unitY)
  if (t.rot) ctx.rotate(t.rot)
  if (t.scale !== 1) ctx.scale(t.scale, t.scale)
  ctx.translate(-x, -y)
}


// Get player sprite based on state
export function getPlayerArt(player: PlayerState): string[] {
  if (!player.moving) return playerSprite.idle

  const f = player.frame
  switch (player.facing) {
    case 'right': return f === 0 ? playerSprite.right1 : playerSprite.right2
    case 'left': return f === 0 ? playerSprite.left1 : playerSprite.left2
    case 'up': return f === 0 ? playerSprite.up1 : playerSprite.up2
    case 'down': return f === 0 ? playerSprite.down1 : playerSprite.down2
  }
}


/** The POSITION token for a SINGLE placed asset cell: footprint side for a building cell
 *  (asset.edge), trunk/canopy for a tree (asset.label), '' for any single-cell element. The
 *  fountain's multi-cell basin is expanded separately in debugCellCaptions. */
export function assetCaptionPos(asset: GridAsset): string {
  if (asset.type === 'tree') return treeSubpart(asset.cellPart)
  if (asset.edge) return edgeToSide(asset.edge)
  return ''
}


/** One debug caption PER CELL, flattened so the top / 2D / iso overlays draw IDENTICAL strings —
 *  the core of the consistent labeling standard. Buildings & trees caption per stamped cell; the
 *  town fountain (one prop carrying its basin `footprint`) expands over the whole basin: rim sides
 *  (mirroring a building footprint), an inner WATER ring, and the CENTER cell. Every other asset
 *  gets a bare type. Pure — the string always comes from the shared labelForCell helper. */
export function debugCellCaptions(assets: readonly GridAsset[]): { col: number; row: number; type: string; text: string }[] {
  const out: { col: number; row: number; type: string; text: string }[] = []
  for (const asset of assets) {
    const span = asset.type === 'fountain' ? asset.footprint ?? 1 : 1
    if (span > 1) {
      const half = Math.floor(span / 2) // odd basin centred on the prop cell
      const rect = { col: asset.col - half, row: asset.row - half, w: span, h: span }
      const maxRing = Math.floor((span - 1) / 2)
      for (let row = rect.row; row < rect.row + rect.h; row++) {
        for (let col = rect.col; col < rect.col + rect.w; col++) {
          const side = footprintSide(col, row, rect)
          const pos = side !== 'INTERIOR' ? side : footprintRing(col, row, rect) >= maxRing ? 'CENTER' : 'WATER'
          out.push({ col, row, type: asset.type, text: labelForCell(asset.type, pos) })
        }
      }
      continue
    }
    out.push({ col: asset.col, row: asset.row, type: asset.type, text: labelForCell(asset.type, assetCaptionPos(asset)) })
  }
  return out
}


/** The debug label for EVERY cell, keyed "col,row": the TERRAIN autotile label (GRASS TOP-LEFT …)
 *  for the ground, OVERRIDDEN by the asset caption (BUILDING TOP-LEFT, TREE CANOPY …) where a cell
 *  carries a placed element. So no cell is ever unlabeled and every label follows one <TYPE>
 *  <POSITION> vocabulary — the tileset-replacement key the whole grid is built around. */
export function cellCaptionMap(
  ground: readonly (readonly string[])[],
  assets: readonly GridAsset[],
): Map<string, { col: number; row: number; type: string; text: string }> {
  const m = new Map<string, { col: number; row: number; type: string; text: string }>()
  for (const t of terrainCaptions(ground)) m.set(`${t.col},${t.row}`, { col: t.col, row: t.row, type: 'terrain', text: t.label })
  for (const a of debugCellCaptions(assets)) m.set(`${a.col},${a.row}`, { col: a.col, row: a.row, type: a.type, text: a.text })
  return m
}

/** Just the ASSET captions keyed "col,row" (cheap — the placed assets only). The debug overlay pairs
 *  this with per-visible-cell `terrainLabelAt`, so it NEVER iterates the whole grid per frame (the
 *  old cellCaptionMap did, which was the debug-mode perf sink). */
export function assetCaptionByCell(assets: readonly GridAsset[]): Map<string, { type: string; text: string }> {
  const m = new Map<string, { type: string; text: string }>()
  for (const a of debugCellCaptions(assets)) m.set(`${a.col},${a.row}`, { type: a.type, text: a.text })
  return m
}

export { terrainLabelAt } from '@/engine/terrainLabels'

/** Draw a debug cell label CENTERED in its cell, shrinking the font until it fits `maxW` — so a
 *  label always sits on its own cell (aligned to the position it names) and can NEVER overflow into
 *  the neighbour (the old floating pills overlapped into "BUILDING WING INTERIOR" soup). */
export function drawCellLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  maxW: number,
  fg: string,
  bg: string,
): void {
  // Width is ESTIMATED from the char count (≈0.62em on this mono-ish font) — never measureText, which
  // per visible cell per frame was the debug-overlay perf sink. Font is shrunk to fit maxW.
  const CH = 0.62
  let px = Math.min(11, maxW * 0.24)
  const wAt = (p: number): number => text.length * p * CH
  if (wAt(px) > maxW - 2) px = (maxW - 2) / (text.length * CH)
  const w = wAt(px)
  ctx.font = `bold ${px}px ${ASCII_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = bg
  ctx.fillRect(cx - w / 2 - 1, cy - px * 0.7, w + 2, px * 1.4)
  ctx.fillStyle = fg
  ctx.fillText(text, cx, cy)
}

/** Caption fg/bg for an asset's debug label, keyed by type — shared by the iso + 2D overlays
 *  so both views colour BUILDING/TREE/WATER/… identically. */
export function debugLabelColors(type: string): { fg: string; bg: string } {
  switch (type) {
    case 'building': return { fg: '#ffaa00', bg: 'rgba(100, 60, 0, 0.8)' }
    case 'tree': return { fg: '#44ff44', bg: 'rgba(0, 60, 0, 0.8)' }
    case 'water':
    case 'well':
    case 'fountain': return { fg: '#44aaff', bg: 'rgba(0, 40, 80, 0.8)' }
    case 'decoration':
    case 'crate':
    case 'lamp': return { fg: '#ffff44', bg: 'rgba(60, 60, 0, 0.8)' }
    case 'flower': return { fg: '#ff88ff', bg: 'rgba(60, 0, 60, 0.8)' }
    case 'terrain': return { fg: '#d8e0c0', bg: 'rgba(20, 30, 15, 0.72)' } // ground autotile labels
    default: return { fg: '#ffffff', bg: 'rgba(0, 0, 0, 0.7)' }
  }
}
