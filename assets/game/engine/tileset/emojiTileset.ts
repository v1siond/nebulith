/**
 * The active EMOJI tileset holder — MINIMAL and EMPTY by design (the twin of `ASCII_TILESET`).
 *
 * The frontend holds NO tile art and NO tile data (per TILE-BACKEND-MIGRATION §7 and MAP-MODEL §8):
 * every emoji tile — its glyph, colour, image, height, category and pose — comes from the nebulith
 * backend. On mount, `loadTilesetsFromBackend` (tilesetLoader) fetches `/api/tilesets` and calls
 * `setEmojiTileset` to fill this holder with the DB-served tiles; the editor renders NOTHING until then
 * (a loader gates the canvas). There is deliberately NO bundled default: an empty holder can never flash
 * a different, frontend-authored style before the DB tileset installs.
 *
 * This file keeps only the `EmojiTile` shape + the setters — the DATA lives in the backend.
 */
import type { TilePose } from '@/engine/tileset/pose'
import type { TileView, TileViewSettings } from '@/engine/tileset/tileViewSettings'

export interface EmojiTile {
  /** The emoji glyph drawn for this kind. */
  char: string
  /** The fill/tint colour (harmonised with the ASCII palette so a reskin reads as the same world). */
  color: string
  /** OPTIONAL positioning data (rotation/scale/flip/offset/muzzle/colour) resolved through `applyPose`.
   *  Deviations-only: absent = identity, so an unposed tile renders byte-identically. Weapons carry the
   *  orientation/size that used to be the hardcoded WEAPON_ORIENT/emojiWeaponSize table. */
  pose?: TilePose
  /** OPTIONAL portable image asset (a baked PNG served by the backend). When set, the tile renders as an
   *  IMAGE via the wired drawImage path instead of the `char`. `char` stays as the label + first-paint
   *  fallback (before the PNG decodes) + the catalog preview. */
  image?: string
  /** OPTIONAL per-view settings (size/pose/…) — deviations-only; an absent view/field falls back to the
   *  tile's shared value then the renderer's hardcoded default, so an unset tile renders byte-identically.
   *  Round-trips through the DB blob (opaque jsonb). Powers the unified tile-settings model. */
  views?: Partial<Record<TileView, TileViewSettings>>
  /** OPTIONAL default iso BLOCK height (the 3D half of the 2D+3D model): 0/absent = a flat ground square,
   *  1 = one cube, N = N tall. In 2D/top a tile is ALWAYS a flat square; iso reads this (via resolveTileHeight,
   *  the editor's per-instance GridAsset.height overriding it) and extrudes the tile into a block through
   *  drawIsoTileBlock. Data-driven — served from the Ecto DB. */
  height?: number
  /** OPTIONAL sidebar metadata (served from the DB): `category` (terrain/buildings/units/nature) marks the
   *  tile BROWSEABLE in the Tile Library and groups it; `title` is its human display name. Absent = an
   *  internal/render-only kind that never appears in the sidebar. The Library reads THESE, so it needs
   *  nothing hardcoded on the frontend. */
  category?: string
  title?: string
  /** OPTIONAL backend `settings` blob — the GENERIC render-behavior keys (`fadeNear`/`cutawayRoof`), the
   *  SAME shape the ascii tile carries, so a reskin's tiles opt into proximity fade/cutaway too. */
  settings?: Record<string, unknown>
}

/** The active emoji tiles — EMPTY until the backend load fills it (setEmojiTileset). No bundled default. */
export let EMOJI_TILESET: Record<string, EmojiTile> = {}

/** Swap the active emoji tileset (the DB-loaded emoji tiles). Call artStyle.rebuildEmojiStyle() after,
 *  so the derived EMOJI_STYLE.map picks up the new data. */
export function setEmojiTileset(tiles: Record<string, EmojiTile>): void {
  EMOJI_TILESET = tiles
}

/** Set (or clear) a tile's POSE in the IN-MEMORY tileset — the live editor writes here and the RAF render
 *  loop redraws from the same data, so a slider retunes the element in-scene immediately. An empty/undefined
 *  pose DROPS the deviation (back to identity) so the tile renders byte-identically to an unposed one. */
export function setTilePose(kind: string, pose: TilePose | undefined): void {
  const tile = EMOJI_TILESET[kind]
  if (!tile) return
  if (pose && Object.keys(pose).length > 0) tile.pose = pose
  else delete tile.pose
}
