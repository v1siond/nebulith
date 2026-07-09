/**
 * ISO BLOCK PICKING — the height-aware hit-test behind iso click-selection. A cell can hold a STACK of
 * brush-placed assets (heightLevel 0,1,2,…) and the iso render LIFTS each one up the screen by
 * isoStackLift. The old selection inverted only the FLAT diamond projection, so a click on a raised block
 * landed on the ground cell under that pixel — "it only selects the 1 bottom cell, never lets you select
 * the blocks". pickIsoBlock mirrors the render's projection + lift so a click resolves to the BLOCK the
 * pointer is on: {col,row,level}, nearest-camera-first, or null when no raised block is hit (the caller
 * then falls back to the unchanged flat pick).
 */
import { pickIsoBlock, isoStackLift, ISO_BLOCK_H_FRAC, type IsoPickCamera, type IsoPickBlock } from '@/engine/render/iso'

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

  test('a lone level-0 asset is NOT a raised block → null (normal, unstacked selection stays unchanged)', () => {
    const flatOnly = [block(5, 5, 0)]
    const at = centre(block(5, 5, 0))
    expect(pickIsoBlock(at.x, at.y, flatOnly, cam)).toBeNull()
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
})
