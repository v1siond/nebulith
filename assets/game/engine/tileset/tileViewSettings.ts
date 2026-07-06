import type { TilePose } from './pose'

/** The three canvas views the renderers draw. Distinct from render/assetDimensions `DimView`
 *  ('billboard'|'overhead'), which is the projection axis the per-element instance dims use. */
export type TileView = 'iso' | '2d' | 'top'

/** Per-view tile settings — deviations only. An absent field falls back to the tile's shared value,
 *  then the renderer's hardcoded default, so a tile with no `views` renders byte-identically. */
export interface TileViewSettings {
  /** Base draw-size multiplier for this view (× the renderer's per-view unit). */
  size?: number
  /** Positioning applied through `applyPose` for this view. */
  pose?: TilePose
  /** Vertical anchor lift for this view (fraction of a tile unit). Phase 2. */
  anchor?: { lift?: number }
  /** Atlas sub-rect for a per-view sprite. Phase 2. */
  path?: { sx?: number; sy?: number; sw?: number; sh?: number }
}

/** Anything carrying a shared pose + optional per-view overrides (EmojiTile / TilesetTile). */
export interface HasTileViews {
  pose?: TilePose
  views?: Partial<Record<TileView, TileViewSettings>>
}

/** Per-view base-size multiplier, or undefined → the caller uses its hardcoded default. */
export function resolveTileSize(tile: HasTileViews | undefined, view: TileView): number | undefined {
  return tile?.views?.[view]?.size
}

/** Per-view pose, falling back to the tile's shared pose, then undefined (= identity). */
export function resolveTilePose(tile: HasTileViews | undefined, view: TileView): TilePose | undefined {
  return tile?.views?.[view]?.pose ?? tile?.pose
}
