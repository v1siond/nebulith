/**
 * Ground-colour PICKING — a leaf module (no render/grid imports) so the grid itself can colour a floor at
 * placement without a cycle. Alexander: "the generator should put the color on the tile … once saved they
 * load." The colour a floor carries is DATA it is BORN with (setGround/makeFloorAsset), picked from the
 * ground tile's OWN DB colour; every view then READS `floor.color` instead of deriving it per-frame.
 */
import { varyIntensity } from '@/engine/colors'
import { resolveGroundTile } from '@/engine/tileset/tileset'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'

/** Deterministic per-cell grass tint: a stable position hash nudges the base grass bg lighter or darker so the
 *  lawn reads as natural patches, not one flat sheet. Computed from (col,row) only — stable per cell. */
export function grassShade(baseBg: string, col: number, row: number): string {
  const n = Math.sin(col * 127.1 + row * 311.7) * 43758.5453
  return varyIntensity(baseBg, n - Math.floor(n), 0.22)
}

/** The ground colour a floor tile is BORN with as STATE — the ground tile's OWN DB colour (terrain `bg` from the
 *  loaded tileset). Picked ONCE at placement and stored on `floor.color`, so every view READS it (no render-time
 *  colour derivation, no hardcoded fallback). Style-independent — one colour filters the tile in every style.
 *
 *  UNIFORM per ground kind — deliberately NOT shaded per cell. A z-width run IS ONE TILE, so it carries ONE
 *  colour; giving neighbours their own shade makes `compressGround` (which merges only floors of the SAME tile
 *  AND colour) unable to merge anything, so a road/grass field explodes from one run into hundreds of separate
 *  floor assets and the frame rate collapses. One tile → one colour keeps the runs, and the map fast.
 *  No terrain loaded → resolveGroundTile returns an empty colour, so nothing is invented. */
export function groundTileColor(tileType: string, col: number, row: number): string {
  return resolveGroundTile(ASCII_TILESET, tileType, col, row).bg
}
