/**
 * ISO BLOCK PICKING — the height-aware hit-test behind iso click-selection. A cell can hold a STACK of
 * brush-placed assets (heightLevel 0,1,2,…) and the iso render LIFTS each one up the screen by
 * isoStackLift. The old selection inverted only the FLAT diamond projection, so a click on a raised block
 * landed on the ground cell under that pixel — "it only selects the 1 bottom cell, never lets you select
 * the blocks". pickIsoBlock mirrors the render's projection + lift so a click resolves to the BLOCK the
 * pointer is on: {col,row,level}, nearest-camera-first, or null when no raised block is hit (the caller
 * then falls back to the unchanged flat pick).
 */
import { pickIsoBlock, pickIsoBlocksAll, nextPickIndex, isoStackLift, ISO_BLOCK_H_FRAC, type IsoPickCamera, type IsoPickBlock } from '@/engine/render/iso'

// A round camera so the projected numbers are easy to reason about:
//   tileW = cellSize*isoScale*0.71 = 71   tileH = cellSize*isoScale*0.36 = 36   heightStep = 40
const cam: IsoPickCamera = { w: 800, h: 600, cellSize: 1, isoScale: 100, camX: 0, camZ: 0 }
const tileW = cam.cellSize * cam.isoScale * 0.71

const block = (col: number, row: number, heightLevel: number, terrainHeight = 0): IsoPickBlock => ({ col, row, heightLevel, terrainHeight })

// The on-screen centre the render draws a block at (base diamond centre, up by terrain, up by the stack lift).
const centre = (b: IsoPickBlock) => {
  const wx = b.col * cam.cellSize - cam.camX
  const wz = b.row * cam.cellSize - cam.camZ
  const px = cam.w / 2 + (wx - wz) * cam.isoScale * 0.71
  const py = cam.h / 2 + (wx + wz) * cam.isoScale * 0.36
  return { x: px, y: py - b.terrainHeight * (cam.cellSize * cam.isoScale * 0.4) - isoStackLift(tileW, b.heightLevel) }
}

describe('pickIsoBlock — a click on a raised block selects THAT block', () => {
  test('click on the TOP block of a stack → its {col,row,level}, not the bottom cell', () => {
    // A 3-tall stack on cell (3,3): levels 0 (flat), 1, 2. Click the top block (level 2) where it is DRAWN.
    const stack = [block(3, 3, 0), block(3, 3, 1), block(3, 3, 2)]
    const top = centre(block(3, 3, 2))
    expect(pickIsoBlock(top.x, top.y, stack, cam)).toEqual({ col: 3, row: 3, level: 2 })
  })

  test('click lower in the same stack → the lower block (each level is reachable at its drawn height)', () => {
    const stack = [block(3, 3, 0), block(3, 3, 1), block(3, 3, 2)]
    const mid = centre(block(3, 3, 1))
    expect(pickIsoBlock(mid.x, mid.y, stack, cam)).toEqual({ col: 3, row: 3, level: 1 })
  })

  test('click on bare ground (no raised block under the pointer) → null → caller falls back to the flat pick', () => {
    const stack = [block(3, 3, 1), block(3, 3, 2)]
    const ground = centre(block(3, 3, 0)) // the level-0 / flat position — no raised diamond covers it
    expect(pickIsoBlock(ground.x, ground.y, stack, cam)).toBeNull()
    // and a click nowhere near any block is null too
    expect(pickIsoBlock(10, 10, stack, cam)).toBeNull()
  })

  test('a level-0 BLOCK is hit-tested too — a ground-floor wall (0-based, seated on the floor) is a CUBE and must be selectable; the CALLER excludes the flat floor, not this pure test', () => {
    const at = centre(block(5, 5, 0))
    expect(pickIsoBlock(at.x, at.y, [block(5, 5, 0)], cam)).toEqual({ col: 5, row: 5, level: 0 })
    // no candidates at all → null
    expect(pickIsoBlock(at.x, at.y, [], cam)).toBeNull()
  })

  test('overlapping lifted footprints → the block NEAREST the camera (higher col+row) wins', () => {
    // near (3,3,3) and far (2,2,2) both project to x=400 and their diamonds both cover this point.
    const near = block(3, 3, 3) // col+row = 6 → drawn last / on top
    const far = block(2, 2, 2)  // col+row = 4 → behind
    const farC = centre(far)    // the far block's exact centre — inside both diamonds
    // sanity: the click is inside the near block's diamond too
    const nearC = centre(near)
    expect(Math.abs(farC.x - nearC.x) / tileW + Math.abs(farC.y - nearC.y) / (cam.cellSize * cam.isoScale * 0.36)).toBeLessThanOrEqual(1)
    // order of the candidate array must NOT matter — nearest still wins
    expect(pickIsoBlock(farC.x, farC.y, [far, near], cam)).toEqual({ col: 3, row: 3, level: 3 })
    expect(pickIsoBlock(farC.x, farC.y, [near, far], cam)).toEqual({ col: 3, row: 3, level: 3 })
  })

  test('terrain elevation lifts the hit region (the render lifts the block by terrainHeight too)', () => {
    const raised = block(3, 3, 1, 2) // same cell/level, but 2 elevation steps up
    const flatPos = centre(block(3, 3, 1, 0)) // where a level-1 block on FLAT ground would be
    // the block moved UP with the terrain, so the old (flat-terrain) position no longer hits it
    expect(pickIsoBlock(flatPos.x, flatPos.y, [raised], cam)).toBeNull()
    // …and it DOES hit at its actual, terrain-lifted position
    const raisedPos = centre(raised)
    expect(pickIsoBlock(raisedPos.x, raisedPos.y, [raised], cam)).toEqual({ col: 3, row: 3, level: 1 })
  })

  test('lift matches the render constant (a level-1 block sits one cube above the flat cell)', () => {
    const flat = centre(block(3, 3, 0))
    const lifted = centre(block(3, 3, 1))
    expect(flat.y - lifted.y).toBeCloseTo(tileW * ISO_BLOCK_H_FRAC)
  })

  // The picker takes ONE code path over a uniform block list — it never branches on what a block IS. A
  // building WALL block and a CHARACTER block are hit-tested exactly like a stacked prop, and their `source`
  // rides straight through to the result so the caller routes the selection without re-testing geometry.
  test('a building WALL block is hit like any stacked block and returns source "building"', () => {
    const wall = { ...block(4, 4, 2), source: 'building' as const }
    const at = centre(wall)
    expect(pickIsoBlock(at.x, at.y, [wall], cam)).toEqual({ col: 4, row: 4, level: 2, source: 'building' })
  })

  test('a CHARACTER block returns source "entity", and nearest-camera-first still holds across sources', () => {
    const character = { ...block(3, 3, 1), source: 'entity' as const }
    const wallBehind = { ...block(2, 2, 1), source: 'building' as const }
    const at = centre(character)
    expect(pickIsoBlock(at.x, at.y, [character], cam)).toEqual({ col: 3, row: 3, level: 1, source: 'entity' })
    // the nearer (higher col+row) block wins regardless of source or array order
    const overlap = centre(wallBehind)
    if (Math.abs(overlap.x - at.x) / tileW + Math.abs(overlap.y - at.y) / (cam.cellSize * cam.isoScale * 0.36) <= 1) {
      expect(pickIsoBlock(overlap.x, overlap.y, [character, wallBehind], cam)?.source).toBe('entity')
    }
  })

  test('click the SIDE of an upper block (not its cap) picks THAT block, not the one below it', () => {
    // A 3-tall wall column on (3,3). Click LOW on level 3's visible front face — the old top-face-only test
    // fell through to level 2 here ("selected the wall, but it's the window above"); now it must stay on 3.
    const stack = [block(3, 3, 1), block(3, 3, 2), block(3, 3, 3)]
    const base3 = centre(block(3, 3, 3)) // isoStackLift → the BASE of level 3's cube
    const sideY = base3.y - tileW * ISO_BLOCK_H_FRAC * 0.9 // up the visible front face, near the top cap
    expect(pickIsoBlock(base3.x, sideY, stack, cam)).toEqual({ col: 3, row: 3, level: 3 })
  })
})

// The selection "offset" in dense towns is genuine OCCLUSION: a front block is drawn OVER the block you
// aimed at, so the pick correctly returns the visible one. To reach the hidden block WITHOUT a math patch,
// pickIsoBlocksAll surfaces EVERY block under the pixel (front→back) and repeated clicks cycle through them.
const tileH = cam.cellSize * cam.isoScale * 0.36
describe('pickIsoBlocksAll — every block under the pixel, front→back (for click-to-cycle)', () => {
  test('an overlapping front + occluded block both come back, nearest-camera FIRST', () => {
    const near = block(3, 3, 3) // col+row=6 → drawn on top / nearest
    const far = block(2, 2, 2)  // col+row=4 → occluded behind
    const at = centre(far)      // the far block's centre — inside BOTH diamonds (the occlusion pixel)
    // sanity: the pixel really is inside the near block's footprint too
    const nearC = centre(near)
    expect(Math.abs(at.x - nearC.x) / tileW + Math.abs(at.y - nearC.y) / tileH).toBeLessThanOrEqual(1)
    const all = pickIsoBlocksAll(at.x, at.y, [far, near], cam).map(b => ({ col: b.col, row: b.row, level: b.level }))
    expect(all).toEqual([
      { col: 3, row: 3, level: 3 }, // front (nearest-camera) first
      { col: 2, row: 2, level: 2 }, // the occluded block behind it — now reachable
    ])
  })

  test('a lone block → one-element list; an empty pixel → []', () => {
    const at = centre(block(5, 5, 0))
    expect(pickIsoBlocksAll(at.x, at.y, [block(5, 5, 0)], cam)).toHaveLength(1)
    expect(pickIsoBlocksAll(10, 10, [block(5, 5, 0)], cam)).toEqual([])
  })

  test('pickIsoBlock (singular) stays the frontmost of pickIsoBlocksAll (backward compatible)', () => {
    const near = block(3, 3, 3)
    const far = block(2, 2, 2)
    const at = centre(far)
    expect(pickIsoBlock(at.x, at.y, [far, near], cam)).toEqual(pickIsoBlocksAll(at.x, at.y, [far, near], cam)[0])
  })
})

describe('nextPickIndex — repeated clicks on the SAME pixel walk front→back through the overlap', () => {
  test('same pixel (within tolerance) advances the index and wraps around', () => {
    expect(nextPickIndex(null, 100, 100, 3, 4)).toBe(0) // first click → frontmost
    expect(nextPickIndex({ x: 100, y: 100, index: 0 }, 101, 99, 3, 4)).toBe(1) // within tol → next (deeper)
    expect(nextPickIndex({ x: 100, y: 100, index: 1 }, 100, 100, 3, 4)).toBe(2)
    expect(nextPickIndex({ x: 100, y: 100, index: 2 }, 100, 100, 3, 4)).toBe(0) // wraps back to front
  })

  test('a click on a DIFFERENT pixel resets to the frontmost (index 0)', () => {
    expect(nextPickIndex({ x: 100, y: 100, index: 1 }, 300, 300, 3, 4)).toBe(0)
  })

  test('no candidates under the pixel → 0 (nothing to cycle)', () => {
    expect(nextPickIndex({ x: 100, y: 100, index: 0 }, 100, 100, 0, 4)).toBe(0)
  })
})
