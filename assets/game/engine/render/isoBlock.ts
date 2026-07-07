/**
 * The 3D half of the 2D+3D tileset model: extrude a cell's flat diamond into an iso CUBE.
 *
 * A tile is a flat square in 2D/top; in iso a tile (or placed asset) with height ≥ 1 rises into
 * `height` stacked blocks. `isoBlockFaces` returns the geometry of ONE block at a given stacking
 * `level`: its TOP face plus the two CAMERA-VISIBLE side faces (the front-left L→B wall and the
 * front-right B→R wall — the same two edges the ground cube exposes). The two far walls and the
 * bottom are never seen, so they're never emitted.
 *
 * Conventions MIRROR the ground cube (drawIsoGroundLayer) and drawIsoBuilding: a cell centred at
 * (px, py) is a diamond with half-extents (tileW, tileH); one block is `blockH` px tall. Each face
 * is a quad [a, b, c, d] where `a` is the fillIsoFaceWithTile ORIGIN (bottom-left corner),
 * eA = b − a is the bottom edge and eB = d − a is the up/side edge — so a tile shears onto the face
 * at the iso angle exactly like a wall, and the top face reads as a flat diamond.
 *
 * Pure geometry, unit-tested. drawIsoTileBlock (impure canvas glue in iso.ts) stacks these and fills
 * each face via fillIsoFaceWithTile.
 */

export type Pt = { x: number; y: number }

/** A face as four corners in fillIsoFaceWithTile order: a = origin, b = a + bottom-edge, d = a + up-edge. */
export interface BlockFace {
  a: Pt
  b: Pt
  c: Pt
  d: Pt
}

export interface BlockFaces {
  top: BlockFace
  left: BlockFace
  right: BlockFace
}

/** The three visible faces of the block at stacking `level` (0 = the block sitting on the ground; 1 =
 *  the block stacked on top of it; …). `center` is the cell diamond centre at ground level (screen space,
 *  height-offset already applied). */
export function isoBlockFaces(center: Pt, tileW: number, tileH: number, blockH: number, level = 0): BlockFaces {
  const px = center.x
  const by = center.y - level * blockH // this block's BASE diamond centre-y (lower on screen)
  const ty = by - blockH // this block's TOP diamond centre-y (one block higher)

  return {
    // TOP: the diamond at `ty`, as a flat fillIsoFaceWithTile diamond (origin = left corner, eA → top, eB → bottom).
    top: {
      a: { x: px - tileW, y: ty }, // left
      b: { x: px, y: ty - tileH }, // top
      c: { x: px + tileW, y: ty }, // right
      d: { x: px, y: ty + tileH }, // bottom
    },
    // LEFT: the front-left L→B wall, rising from the base diamond (by) to the top diamond (ty).
    left: {
      a: { x: px - tileW, y: by }, // bottom-left  = L at base
      b: { x: px, y: by + tileH }, // bottom-right = B at base
      c: { x: px, y: ty + tileH }, // top-right    = B at top
      d: { x: px - tileW, y: ty }, // top-left     = L at top
    },
    // RIGHT: the front-right B→R wall.
    right: {
      a: { x: px, y: by + tileH }, // bottom-left  = B at base
      b: { x: px + tileW, y: by }, // bottom-right = R at base
      c: { x: px + tileW, y: ty }, // top-right    = R at top
      d: { x: px, y: ty + tileH }, // top-left     = B at top
    },
  }
}
