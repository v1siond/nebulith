/**
 * ASSET ANIMATION, the render-side bridge between the pure animation ENGINE (`tileAnimation`) and the
 * three view renderers (iso / 2D / top). ONE place resolves a placed asset's live per-frame overrides,
 * gated by each animation's `scope{styles,views}`, so every view applies the SAME values consistently.
 *
 * Clock-derived + stateless (exactly like `cellAnimation`): the renderer reads the RAF clock each frame and
 * calls `resolveAssetAnimation`; nothing is stored between frames. Returns `null`, the cheap, allocation-free
 * path, when the asset has NO animations, none match the active (style, view) scope, or they contribute no
 * settings (e.g. only `sprite` animations, whose playback is stubbed in Phase 1). That null case is what keeps
 * an un-animated tile's render BYTE-IDENTICAL to before this system existed.
 *
 * Split of concerns: `opacity` (a multiplier onto the tile's base alpha) and the screen POSITION shift
 * (`x`/`y`, in tile fractions, `y` positive = a RISE / lift UP) are applied by the caller at the canvas
 * level (globalAlpha + translate), because they must work uniformly in every view's own coordinate space.
 * The remaining live settings that map 1:1 onto plain `GridAsset` fields (colour, zoom, width, height) are
 * COMPOSED onto the tile's BASE value on a shallow-cloned `asset` (`fx.asset`), an animation LAYERS on top of
 * the base slider, it does not mask it (Image #40): height ADDS its delta-from-start onto `scaleY`, zoom/width
 * MULTIPLY the base by their ratio-from-start, colour is last-wins. So the base height/zoom sliders stay live
 * and editable while an animation plays, and the existing draw code reads the composed fields with no changes.
 */
import type { GridAsset } from '@/engine/IsometricGrid'
import {
  animationMatchesScope,
  composeAnimatedSetting,
  resolveAnimatedSettingsDetailed,
  spriteFrameIndex,
  type AnimatedSetting,
  type AnimatedSettingsDetailed,
  type Animation,
  type SettingKey,
  type SpriteAnimation,
  type TileStyle,
  type TileView,
} from '@/engine/animation/tileAnimation'
import { resolveFrame, type ResolvedFrame } from '@/game/runtime/entityAnimation'
import { assetKind, type Style } from '@/game/artStyle'
import { styleTile } from '@/engine/tileset/styleTiles'
import type { DayNight } from './shared'

/** The live animation effect applied to ONE placed asset for ONE frame in ONE view. */
export interface AssetAnimationFx {
  /** Opacity MULTIPLIER (1 = unchanged), composited onto the asset's base opacity by the caller. */
  opacity: number
  /** Horizontal screen shift in TILE fractions (+ = right). Caller multiplies by the view's horizontal unit. */
  x: number
  /** Vertical screen LIFT in TILE fractions (+ = UP / rise). Caller multiplies by the view's vertical unit and
   *  SUBTRACTS it from the draw origin (screen-space up is negative Y). */
  y: number
  /** The asset with animated FIELD settings (colour / zoom / width / height) overlaid, the SAME reference
   *  when the animation writes none of them, so no needless clone. */
  asset: GridAsset
}

/**
 * THE LIVE SPRITE FRAME for a placed asset: the playback that was stubbed.
 *
 * `resolveAssetAnimation` above resolves the SETTINGS kind and returns null for a sprite, with its own comment
 * saying so: So a tile carrying a frame-swap animation animated nothing, in any view. `spriteFrameIndex` was
 * already real, clock-derived and tested; nothing consumed it.
 *
 * Water is a FLOOR, and
 * a floor is an ordinary level-0 asset drawn through the same per-asset path as everything else, so giving that
 * path a live frame is what makes a ground tile able to move at all.
 *
 * Why a separate helper rather than a field on `AssetAnimationFx`: the picture is chosen inside the draw
 * (`drawIsoAssetAscii`), which never receives that fx, and all four existing callers read only `.asset` and
 * `.opacity`. One exported function keeps this additive, so an un-animated tile takes the same path it always did.
 *
 * The frame is returned RESOLVED but not turned into a picture: `frameImage` lives in `./shared`, and `shared`
 * already imports this module, so resolving it here would close a circular import. The caller owns that step,
 * which is also where the tile's own resting image is known.
 *
 * Returns null when the asset carries no sprite animation in scope, so an un-animated tile allocates nothing.
 */
export function spriteFrame(
  asset: GridAsset,
  nowMs: number,
  style: Style,
  view: TileView,
  dayNight: DayNight,
): ResolvedFrame | null {
  const token = styleToken(style)
  const animations = asset.animations ?? tileAnimations(asset, token)
  if (!animations || animations.length === 0) return null
  // The SAME gate the settings path uses, so a sprite obeys scope and the night trigger identically.
  const sprites = animations.filter(
    anim => anim.kind === 'sprite' && animationMatchesScope(anim, token, view) && animationPlaysAtDayNight(anim, dayNight),
  )
  if (sprites.length === 0) return null
  // Highest `priority` wins and, at equal priority, the LAST in the list, the same precedence the settings
  // resolver documents, so two animations on one tile resolve the same way whichever kind they are.
  const chosen = sprites.reduce((best, anim) => ((anim.priority ?? 0) >= (best.priority ?? 0) ? anim : best), sprites[0])
  const frames = 'frames' in chosen ? chosen.frames : []
  if (frames.length === 0) return null
  const index = spriteFrameIndex(chosen as SpriteAnimation, nowMs, asset.placedAt ?? 0)
  const frame = frames[index]
  if (!frame) return null
  return resolveFrame(frame, { char: asset.art?.[0] })
}

/** Map a render `Style` to the pure engine's scope token, only ascii/emoji exist as tile styles. */
function styleToken(style: Style): TileStyle {
  return style.id === 'emoji' ? 'emoji' : 'ascii'
}

/**
 * THE ANIMATIONS THAT APPLY TO AN ASSET: its own, else the ones its TILE ROW carries.
 *
 * `asset.animations` is written in exactly three places: the editor's inspector, the composition stamp
 * (`composition.ts`, copying a CELL's authored animations) and copy/paste. A GENERATED floor is none of those,
 * so a water tile seeded with an animation animated NOTHING: the envelope never reached the asset. Measured by
 * grepping every writer, after seeding an animation onto the water row and finding no reader for it at all.
 *
 * Height went the same way and was fixed the same way. `makeFloorAsset` states the principle in its own
 * comment: a floor pins no height because "its height is the TILE's own setting, served by the backend …
 * Pinning it here made the floor special again and, worse, put the value somewhere that never persists." An
 * animation is a fact about the tile for exactly the same reason, so it is READ here rather than stamped onto
 * every one of a lake's floor assets (which would also duplicate the envelope thousands of times per map).
 *
 * The lookup key MIRRORS how the draw picks the picture: a labeled cell by its label, everything else by its
 * kind (`assetKind`, which for a floor is `groundKind(tileKey)`, so all three water bands resolve the one
 * `water` row, the same row they already take their image from). A tile therefore animates through the same
 * identity it is drawn through. `settings` arrives verbatim from the backend (`tilesetLoader` ends its per-tile
 * map with `settings: absoluteFrames(tile.settings)`), so this reads served data and invents nothing.
 */
function tileAnimations(asset: GridAsset, token: TileStyle): readonly Animation[] | undefined {
  const settings = (t: string | undefined) =>
    (t === undefined ? undefined : styleTile(token, t)?.settings) as { animations?: readonly Animation[] } | undefined

  // A TILE MAY DECLARE THAT IT HAS NONE, and that is different from saying nothing.
  //
  // The
  // collapse below is right for the PICTURE (every water band shares one image) and it handed the puddle the
  // river's four frames along with it. `water_still` is authored with an EMPTY `animations` list to say so, so
  // an own row that carries the key wins outright and never falls through. A band that carries no key at all
  // still inherits, which is what keeps a river flowing.
  const own = settings(asset.tileKey)
  const list = own && 'animations' in own ? own.animations : settings(asset.label ?? assetKind(asset))?.animations
  return Array.isArray(list) && list.length > 0 ? list : undefined
}

// A CELL'S HEADING IS NOT AN ANIMATION. There used to be a `pickHeading` here, choosing one of four frame
// sets by the cell's `flow`, because the drift was baked into four sets of pictures. It is a TEXTURE TURN
// now (`turnFaceTexture`), applied where the face is painted, so one loop serves every heading and this
// bridge has nothing directional left in it.

/** A `night`-triggered animation is a CONDITION, not a one-shot: it plays ONLY while the scene is in night
 * mode. Every OTHER trigger plays regardless of day/night. Gated HERE in the
 *  render bridge (the pure engine ignores triggers), so a filtered-out night animation neither advances nor
 *  renders while it's day. */
function animationPlaysAtDayNight(anim: { trigger?: { on: string } }, dayNight: DayNight): boolean {
  if (anim.trigger?.on === 'night') return dayNight === 'night'
  return true
}

/** A resolved setting's numeric VALUE (opacity multiplier / colour handled elsewhere), or the fallback. */
function numericValue(claim: AnimatedSetting | undefined, fallback: number): number {
  return claim && typeof claim.value === 'number' ? claim.value : fallback
}

/** A screen-shift override (`x`/`y`) composed onto a base of 0 → the additive DELTA (value − from). 0 when
 *  absent, so a track authored `2→5` slides 0→3 (not a jump to the absolute value). */
function shift(setting: SettingKey, claim: AnimatedSetting | undefined): number {
  if (!claim || typeof claim.value !== 'number' || typeof claim.from !== 'number') return 0
  return composeAnimatedSetting(setting, 0, claim.value, claim.from)
}

/**
 * Overlay the animated live values that map 1:1 onto plain `GridAsset` fields (the draw code already reads
 * these). Colour is last-wins (`color`). Zoom/width/height COMPOSE onto the tile's BASE slider so the base
 * stays editable under an animation (Image #40): height ADDS its delta onto `scaleY` (base 3 + a 1→4 grow ⇒
 * 3→6), zoom/width MULTIPLY the base by their ratio (`scale`/`scaleX`). Returns the SAME asset when none of
 * those are animated this frame (no clone), else a shallow copy with only the composed fields replaced.
 */
function withAnimatedFields(asset: GridAsset, values: AnimatedSettingsDetailed): GridAsset {
  const color = values.color
  const zoom = values.zoom
  const width = values.width
  const height = values.height
  const hasColor = !!color && typeof color.value === 'string'
  const hasWidth = !!width && typeof width.value === 'number'
  const hasHeight = !!height && typeof height.value === 'number'
  if (!hasColor && !hasWidth && !hasHeight) return asset
  const out: GridAsset = { ...asset }
  if (hasColor) out.color = color!.value as string
  if (hasWidth) out.scaleX = composeAnimatedSetting('width', asset.scaleX ?? 1, width!.value as number, Number(width!.from))
  if (hasHeight) out.scaleY = composeAnimatedSetting('height', asset.scaleY ?? 1, height!.value as number, Number(height!.from))
  return out
}

/**
 * Resolve the live animation effect for `asset` at clock time `nowMs`, rendered under `style` in `view` with
 * the scene in `dayNight`. Filters the asset's animations to those whose scope matches (style, view) AND whose
 * day/night gate passes (a `night`-triggered animation only when `dayNight === 'night'`), composes their live
 * settings (higher priority / later-in-list wins per setting), and returns the caller-ready effect, or `null`
 * when nothing applies (no animations / none in scope / gated out / no settings produced), keeping the fast path.
 */
export function resolveAssetAnimation(
  asset: GridAsset,
  nowMs: number,
  style: Style,
  view: TileView,
  dayNight: DayNight = 'day',
): AssetAnimationFx | null {
  const token = styleToken(style)
  // A tile's OWN animations when the asset carries none (see tileAnimations): this is what lets a served
  // `opacity` track reach a generated floor, which is how water becomes semi-transparent without a second
  // alpha mechanism. `opacity` is already applied unconditionally by every caller (`op *= anim.opacity`).
  const animations = asset.animations ?? tileAnimations(asset, token)
  if (!animations || animations.length === 0) return null
  const active = animations.filter(anim => animationMatchesScope(anim, token, view) && animationPlaysAtDayNight(anim, dayNight))
  if (active.length === 0) return null
  const values = resolveAnimatedSettingsDetailed(active, nowMs, asset.placedAt ?? 0)
  // Only `sprite` animations in scope → no settings written → treat as no-op (playback stubbed in Phase 1).
  if (Object.keys(values).length === 0) return null
  return {
    opacity: numericValue(values.opacity, 1), // opacity is a base-alpha MULTIPLIER (not delta-composed)
    x: shift('x', values.x),
    y: shift('y', values.y),
    asset: withAnimatedFields(asset, values),
  }
}
