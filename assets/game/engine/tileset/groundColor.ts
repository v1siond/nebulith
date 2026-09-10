/**
 * Ground-colour PICKING — a leaf module (no render/grid imports) so the grid itself can colour a floor at
 * placement without a cycle. Alexander: "the generator should put the color on the tile … once saved they
 * load." The colour a floor carries is DATA it is BORN with (setGround/makeFloorAsset), picked from the
 * ground tile's OWN DB colour; every view then READS `floor.color` instead of deriving it per-frame.
 */
import { styleCatalog } from './styleTiles'
import { varyIntensity } from '@/engine/colors'
import { resolveGroundTile } from '@/engine/tileset/tileset'
import { darkenColor } from '@/engine/colors'

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
  return resolveGroundTile(styleCatalog('ascii'), tileType, col, row).bg
}

/** The colour of the map BODY beneath a ground tile — the earth under grass, the bed under a river.
 *
 *  Written as STATE at placement, exactly like `groundTileColor` above, and READ by the render. That split is
 *  the rule: the generator PICKS colours, the render only reads them; deriving a shade at draw time is
 *  forbidden (it also recomputes per frame for every visible cell). Nothing is invented from thin air — the
 *  body takes the ground's OWN colour, darkened, so it always belongs to the surface above it.
 *
 *  Empty ground colour (no terrain loaded) → empty here too, and the skirt draws nothing rather than guessing. */
export function groundSideColor(tileType: string, col: number, row: number): string {
  const base = groundTileColor(tileType, col, row)
  return base ? darkenColor(base, GROUND_BODY_DARKEN) : ''
}

/** How much darker the map's body is than the surface it carries. A LOOK constant, in the one module that owns
 *  ground colour — not a value the backend serves per tile, because it describes the lighting of the whole map
 *  rather than any one terrain. */
const GROUND_BODY_DARKEN = 0.5
