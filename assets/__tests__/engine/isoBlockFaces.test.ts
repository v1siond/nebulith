/**
 * isoBlockFaces — the 3D half of a tile: extrude a cell's flat diamond into an iso CUBE and hand back
 * the top + the two CAMERA-VISIBLE side faces as corner quads, ready for fillIsoFaceWithTile.
 *
 * The conventions MIRROR the ground cube (drawIsoGroundLayer) and drawIsoBuilding: a cell centred at
 * (px, py) is a diamond with half-extents (tileW, tileH); the two visible front faces are the
 * LEFT (L→B edge) and RIGHT (B→R edge) walls; the top face is the diamond lifted by one block. Each
 * face is a quad [a, b, c, d] where a = the fillIsoFaceWithTile ORIGIN (bottom-left), eA = b−a (the
 * bottom edge) and eB = d−a (the up/side edge) — so the tile shears onto the face exactly like a wall.
 */
import { isoBlockFaces } from '@/engine/render/isoBlock'

const center = { x: 300, y: 200 }
const tileW = 40
const tileH = 20
const blockH = 36

const near = (p: { x: number; y: number }, x: number, y: number) => {
  expect(p.x).toBeCloseTo(x, 6)
  expect(p.y).toBeCloseTo(y, 6)
}
const sub = (p: { x: number; y: number }, q: { x: number; y: number }) => ({ x: p.x - q.x, y: p.y - q.y })

describe('isoBlockFaces — extrude a cell diamond into an iso cube (top + 2 visible side faces)', () => {
  test('level 0 top face = the diamond lifted one block, as a fillIsoFaceWithTile diamond', () => {
    const { top } = isoBlockFaces(center, tileW, tileH, blockH, 0)
    // top diamond centre y = py - 1*blockH = 164; corners L, T, R, B
    near(top.a, 260, 164) // left
    near(top.b, 300, 144) // top
    near(top.c, 340, 164) // right
    near(top.d, 300, 184) // bottom
    // fillIsoFaceWithTile diamond convention: eA → top corner, eB → bottom corner
    near(sub(top.b, top.a), tileW, -tileH)
    near(sub(top.d, top.a), tileW, tileH)
  })

  test('level 0 left face = the L→B wall rising from ground to the block top', () => {
    const { left } = isoBlockFaces(center, tileW, tileH, blockH, 0)
    near(left.a, 260, 200) // bottom-left  = L at ground (py=200)
    near(left.b, 300, 220) // bottom-right = B at ground
    near(left.c, 300, 184) // top-right    = B at block top
    near(left.d, 260, 164) // top-left     = L at block top
    near(sub(left.b, left.a), tileW, tileH) // bottom edge runs along the iso angle
    near(sub(left.d, left.a), 0, -blockH)   // side edge rises straight up by one block
  })

  test('level 0 right face = the B→R wall rising from ground to the block top', () => {
    const { right } = isoBlockFaces(center, tileW, tileH, blockH, 0)
    near(right.a, 300, 220) // bottom-left  = B at ground
    near(right.b, 340, 200) // bottom-right = R at ground
    near(right.c, 340, 164) // top-right    = R at block top
    near(right.d, 300, 184) // top-left     = B at block top
    near(sub(right.b, right.a), tileW, -tileH)
    near(sub(right.d, right.a), 0, -blockH)
  })

  test('stacking: level 1 sits exactly one block above level 0 (shift up by blockH)', () => {
    const l0 = isoBlockFaces(center, tileW, tileH, blockH, 0)
    const l1 = isoBlockFaces(center, tileW, tileH, blockH, 1)
    // every corner of level 1 is level 0 shifted up (screen y − blockH)
    for (const face of ['top', 'left', 'right'] as const) {
      for (const corner of ['a', 'b', 'c', 'd'] as const) {
        near(l1[face][corner], l0[face][corner].x, l0[face][corner].y - blockH)
      }
    }
  })

  test('level defaults to 0', () => {
    const withDefault = isoBlockFaces(center, tileW, tileH, blockH)
    const explicit = isoBlockFaces(center, tileW, tileH, blockH, 0)
    expect(withDefault).toEqual(explicit)
  })
})
