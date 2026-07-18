/**
 * TILE HIT GEOMETRY — the transform-aware screen shape a placed tile occupies, used by the INVERTED picker
 * (cursor → the rendered TILE → its cell) and the highlight that hugs it. These pin the pure math:
 *  • a cube column's silhouette matches isoBlockFaces EXACTLY (same primitive the renderer draws with),
 *  • pose (offset/rotate/scale/flip) moves the silhouette the SAME way applyPose moves the draw,
 *  • a tall/lifted tile is hit at its ON-SCREEN pixel and MISSED at the flat ground below it.
 */
import {
  poseMapper, cubeGeom, billboardGeom, diamondGeom, depthBoxGeom,
  pointInTileGeom, tileGeomPolygon, pointInPolygon, convexHull,
} from '@/engine/render/tileHit'
import { isoBlockFaces } from '@/engine/render/isoBlock'
import type { TilePose } from '@/engine/tileset/pose'

const TW = 40, TH = 20, BH = 44

describe('poseMapper — mirrors applyPose', () => {
  test('no pose → pure translation by the anchor', () => {
    const xf = poseMapper({ x: 100, y: 200 }, null, TH)
    expect(xf({ x: 5, y: -7 })).toEqual({ x: 105, y: 193 })
  })
  test('pose offset dx/dy slides by (dx,dy)·unit; scale multiplies the local point', () => {
    const pose: TilePose = { dx: 1, dy: -2, scale: 2 }
    const xf = poseMapper({ x: 0, y: 0 }, pose, TH)
    // scale·L + d = (2·10 + 1·20, 2·0 + (-2)·20) = (40, -40)
    expect(xf({ x: 10, y: 0 })).toEqual({ x: 40, y: -40 })
  })
  test('flip mirrors x (after rotate), matching applyPose flip XOR facing=1', () => {
    const xf = poseMapper({ x: 0, y: 0 }, { flip: true }, TH)
    expect(xf({ x: 7, y: 3 })).toEqual({ x: -7, y: 3 })
  })
  test('90° rotation maps (1,0)→(0,1) around the anchor', () => {
    const xf = poseMapper({ x: 0, y: 0 }, { rot: Math.PI / 2 }, TH)
    const p = xf({ x: 10, y: 0 })
    expect(p.x).toBeCloseTo(0)
    expect(p.y).toBeCloseTo(10)
  })
})

describe('cubeGeom — silhouette matches isoBlockFaces (the primitive the renderer draws with)', () => {
  test('a 1-block cube: base + top diamonds equal isoBlockFaces base/top at the same anchor', () => {
    const anchor = { x: 300, y: 250 }
    const xf = poseMapper(anchor, null, TH)
    const g = cubeGeom(TW, TH, BH, 1, xf)
    const faces = isoBlockFaces(anchor, TW, TH, BH, 0)
    // base diamond: left/back/right/front — isoBlockFaces left.a = L@base, its top face = the cap diamond
    expect(g.base[0]).toEqual({ x: anchor.x - TW, y: anchor.y })          // left @ base
    expect(g.base[3]).toEqual({ x: anchor.x, y: anchor.y + TH })          // front @ base
    // top cap diamond centre is one blockH up (isoBlockFaces top at level 0 → ty = by - blockH)
    expect(g.top[0]).toEqual(faces.top.a)                                  // left @ top == cap left
    expect(g.top[1]).toEqual(faces.top.b)                                  // back @ top == cap back
    expect(g.top[2]).toEqual(faces.top.c)                                  // right @ top == cap right
    expect(g.top[3]).toEqual(faces.top.d)                                  // front @ top == cap front
  })

  test('a 3-tall column extrudes exactly 3·blockH up from the base', () => {
    const anchor = { x: 300, y: 250 }
    const g = cubeGeom(TW, TH, BH, 3, poseMapper(anchor, null, TH))
    expect(g.top[0].y).toBeCloseTo(anchor.y - 3 * BH)   // left corner lifted 3 blocks
    expect(g.base[0].y).toBeCloseTo(anchor.y)           // base stays on the anchor
  })
})

describe('hit-test — the pick lands on the TILE, not the ground cell under it', () => {
  test('a TALL (scaleY) block is hit at its lifted top and MISSED at the flat ground below', () => {
    const anchor = { x: 300, y: 300 }
    // scaleY 4 → a 4·blockH tall column
    const g = cubeGeom(TW, TH, BH * 4, 1, poseMapper(anchor, null, TH))
    const topPixel = { x: anchor.x, y: anchor.y - BH * 4 + 4 } // near the top cap
    expect(pointInTileGeom(topPixel.x, topPixel.y, g)).toBe(true)
    // The flat ground cell BELOW the tile (well under the base diamond) is NOT the tile.
    expect(pointInTileGeom(anchor.x, anchor.y + TH + 60, g)).toBe(false)
  })

  test('a pose-lifted billboard (a bulb slid up) is hit where it is DRAWN, not at its cell', () => {
    const anchor = { x: 200, y: 400 }
    // pose dy:-3 lifts the sprite 3 tile-units up
    const xf = poseMapper(anchor, { dy: -3 }, TH)
    const g = billboardGeom(30, 30, xf)
    expect(pointInTileGeom(anchor.x, anchor.y - 3 * TH, g)).toBe(true) // at the lifted bulb
    expect(pointInTileGeom(anchor.x, anchor.y, g)).toBe(false)         // the bare cell below is empty
  })

  test('a directional-depth box is hit along its extruded length', () => {
    const anchor = { x: 300, y: 300 }
    const xf = poseMapper(anchor, null, TH)
    const g = depthBoxGeom(TW, TH, BH, 1, 4, 'right-down', xf)
    // right-down extrudes +col = (+TW,+TH) per cell → the far end sits down-right of the anchor
    const far = { x: anchor.x + 3 * TW, y: anchor.y + 3 * TH }
    expect(pointInTileGeom(far.x, far.y, g)).toBe(true)
    expect(pointInTileGeom(anchor.x - 5 * TW, anchor.y, g)).toBe(false)
  })
})

describe('convexHull / pointInPolygon primitives', () => {
  test('hull of a square is the square; interior point is inside, exterior out', () => {
    const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 5, y: 5 }]
    expect(convexHull(sq)).toHaveLength(4)
    expect(pointInPolygon(5, 5, convexHull(sq))).toBe(true)
    expect(pointInPolygon(20, 20, convexHull(sq))).toBe(false)
  })
  test('a ground diamond contains its centre, excludes a far corner', () => {
    const g = diamondGeom(TW, TH, poseMapper({ x: 100, y: 100 }, null, TH))
    expect(pointInTileGeom(100, 100, g)).toBe(true)
    expect(pointInTileGeom(100 + TW, 100 + TH, g)).toBe(false)
    expect(tileGeomPolygon(g)).toHaveLength(4)
  })
})
