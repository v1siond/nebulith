/**
 * AMBIENT asset animations — per-asset-type tile-variation frames that play continuously
 * (a flower swaying, a torch flickering, a bush rustling). Built on the general
 * animationCycles engine: each entry is an Animation, and the resolver returns the current
 * frame via `frameAt`. Pure data + a lookup, so it's deterministic + unit-testable; the
 * renderer just draws whatever art comes back.
 *
 * Frame glyphs are intentionally subtle + tunable — the goal is a gentle "alive" shimmer,
 * not a jarring swap. An asset with no entry here renders its static art unchanged.
 */
import { type Animation, frameAt } from './animationCycles'

/** Ambient idle animation keyed by asset `type` (matches GridAsset.type). */
export const ASSET_ANIMATIONS: Readonly<Record<string, Animation>> = {
  flower: { id: 'flower-sway', frames: [['*'], ['o'], ['*'], ['+']], durationMs: 1600, loop: true },
  lamp: { id: 'lamp-flicker', frames: [['!'], ['i'], ['!'], ['|']], durationMs: 650, loop: true },
  bush: { id: 'bush-rustle', frames: [['&'], ['%'], ['&'], ['#']], durationMs: 2000, loop: true },
}

/** Does this asset type carry an ambient animation? */
export const isAnimatedAssetType = (type: string): boolean => type in ASSET_ANIMATIONS

/** Every animation the engine knows, keyed by Animation.id — the library the author panel
 *  offers and the renderer resolves a cycle's animation-ids against. */
export const ANIMATION_LIBRARY: Readonly<Record<string, Animation>> = Object.fromEntries(
  Object.values(ASSET_ANIMATIONS).map(a => [a.id, a]),
)

/** Author-panel options: the pickable animations (id + display name). Pure. */
export const animationOptions = (): { id: string; name: string }[] =>
  Object.values(ANIMATION_LIBRARY).map(a => ({ id: a.id, name: a.id }))

/**
 * The asset's animated art at `now`, or null when this type has no ambient animation
 * (the caller then keeps the asset's static art). Pure: same (type, now) → same frame.
 */
export function assetAnimFrame(type: string, now: number): readonly string[] | null {
  const anim = ASSET_ANIMATIONS[type]
  return anim ? frameAt(anim, now) : null
}
