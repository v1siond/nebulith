/**
 * ASSET ANIMATION — the render-side bridge between the pure animation ENGINE (`tileAnimation`) and the
 * three view renderers (iso / 2D / top). ONE place resolves a placed asset's live per-frame overrides,
 * gated by each animation's `scope{styles,views}`, so every view applies the SAME values consistently.
 *
 * Clock-derived + stateless (exactly like `cellAnimation`): the renderer reads the RAF clock each frame and
 * calls `resolveAssetAnimation`; nothing is stored between frames. Returns `null` — the cheap, allocation-free
 * path — when the asset has NO animations, none match the active (style, view) scope, or they contribute no
 * settings (e.g. only `sprite` animations, whose playback is stubbed in Phase 1). That null case is what keeps
 * an un-animated tile's render BYTE-IDENTICAL to before this system existed.
 *
 * Split of concerns: `opacity` (a multiplier onto the tile's base alpha) and the screen POSITION shift
 * (`x`/`y`, in tile fractions — `y` positive = a RISE / lift UP) are applied by the caller at the canvas
 * level (globalAlpha + translate), because they must work uniformly in every view's own coordinate space.
 * The remaining live settings that map 1:1 onto plain `GridAsset` fields (colour, zoom, width, height) are
 * overlaid onto a shallow-cloned `asset` (`fx.asset`), so the existing draw code reads them with no changes.
 */
import type { GridAsset } from '@/engine/IsometricGrid'
import {
  animationMatchesScope,
  resolveAnimatedSettings,
  type AnimatedValues,
  type TileStyle,
  type TileView,
} from '@/engine/animation/tileAnimation'
import type { Style } from '@/game/artStyle'

/** The live animation effect applied to ONE placed asset for ONE frame in ONE view. */
export interface AssetAnimationFx {
  /** Opacity MULTIPLIER (1 = unchanged) — composited onto the asset's base opacity by the caller. */
  opacity: number
  /** Horizontal screen shift in TILE fractions (+ = right). Caller multiplies by the view's horizontal unit. */
  x: number
  /** Vertical screen LIFT in TILE fractions (+ = UP / rise). Caller multiplies by the view's vertical unit and
   *  SUBTRACTS it from the draw origin (screen-space up is negative Y). */
  y: number
  /** The asset with animated FIELD settings (colour / zoom / width / height) overlaid — the SAME reference
   *  when the animation writes none of them, so no needless clone. */
  asset: GridAsset
}

/** Map a render `Style` to the pure engine's scope token — only ascii/emoji exist as tile styles. */
function styleToken(style: Style): TileStyle {
  return style.id === 'emoji' ? 'emoji' : 'ascii'
}

/** A number override, or the fallback when the setting isn't a live number this frame. */
function numeric(value: number | string | undefined, fallback: number): number {
  return typeof value === 'number' ? value : fallback
}

/**
 * Overlay the animated live values that map 1:1 onto plain `GridAsset` fields (the draw code already reads
 * these): colour → `color`, zoom → `scale`, width → `scaleX`, height → `scaleY`. Returns the SAME asset when
 * none of those are animated this frame (no clone), else a shallow copy with only the written fields replaced.
 */
function withAnimatedFields(asset: GridAsset, values: AnimatedValues): GridAsset {
  const hasColor = typeof values.color === 'string'
  const hasZoom = typeof values.zoom === 'number'
  const hasWidth = typeof values.width === 'number'
  const hasHeight = typeof values.height === 'number'
  if (!hasColor && !hasZoom && !hasWidth && !hasHeight) return asset
  const out: GridAsset = { ...asset }
  if (hasColor) out.color = values.color as string
  if (hasZoom) out.scale = values.zoom as number
  if (hasWidth) out.scaleX = values.width as number
  if (hasHeight) out.scaleY = values.height as number
  return out
}

/**
 * Resolve the live animation effect for `asset` at clock time `nowMs`, rendered under `style` in `view`.
 * Filters the asset's animations to those whose scope matches (style, view), composes their live settings
 * (higher priority / later-in-list wins per setting), and returns the caller-ready effect — or `null` when
 * nothing applies (no animations / none in scope / no settings produced), so the caller keeps the fast path.
 */
export function resolveAssetAnimation(
  asset: GridAsset,
  nowMs: number,
  style: Style,
  view: TileView,
): AssetAnimationFx | null {
  const animations = asset.animations
  if (!animations || animations.length === 0) return null
  const token = styleToken(style)
  const active = animations.filter(anim => animationMatchesScope(anim, token, view))
  if (active.length === 0) return null
  const values = resolveAnimatedSettings(active, nowMs, asset.placedAt ?? 0)
  // Only `sprite` animations in scope → no settings written → treat as no-op (playback stubbed in Phase 1).
  if (Object.keys(values).length === 0) return null
  return {
    opacity: numeric(values.opacity, 1),
    x: numeric(values.x, 0),
    y: numeric(values.y, 0),
    asset: withAnimatedFields(asset, values),
  }
}
