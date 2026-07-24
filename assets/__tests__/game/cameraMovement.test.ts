/**
 * ROTATING THE CAMERA MUST NOT ROTATE THE CONTROLS. User: "up is always up, left is always left … the
 * camera rotates the map itself. now if i rotate all player and units movements automatically breaks."
 *
 * The render orients a world delta by `facing` CW quarter-turns ((dc,dr) → (-dr,dc), isoBlock.ts) before
 * projecting. So to keep a key pinned to its SCREEN direction, the input's facing-0 world delta is rotated
 * the OPPOSITE way (CCW) by `facing` — the two cancel, so the delta always lands on screen where it does at
 * facing 0. This test proves the cancellation: orient(moveWorldDelta(dir,facing)) === the facing-0 delta.
 */
import { moveWorldDelta, type MoveDir } from '@/game/runtime/cameraMovement'
import type { Orientation } from '@/engine/render/isoOrientation'

// The render's CW quarter-turn on a grid delta, applied `n` times (the projection's orientation).
const orientCW = ([dc, dr]: [number, number], n: Orientation): [number, number] => {
  let c = dc, r = dr
  for (let i = 0; i < n; i++) { const nc = -r, nr = c; c = nc; r = nr }
  return [c, r]
}

// facing-0 ISO deltas: each projects to its screen direction (up = toward screen-top …).
const ISO0: Record<MoveDir, [number, number]> = { up: [-1, -1], down: [1, 1], left: [-1, 1], right: [1, -1] }
const DIRS: MoveDir[] = ['up', 'down', 'left', 'right']
const FACINGS: Orientation[] = [0, 1, 2, 3]

describe('camera rotation leaves the controls pinned to the screen', () => {
  it('after the camera orients it, every key delta lands where it does at facing 0 (up=screen-up, always)', () => {
    for (const facing of FACINGS) {
      for (const dir of DIRS) {
        const world = moveWorldDelta(dir, facing, true)
        expect(orientCW(world, facing)).toEqual(ISO0[dir]) // the CCW input cancels the CW camera → same screen dir
      }
    }
  })

  it('is a no-op at facing 0 (byte-identical to the current behaviour)', () => {
    for (const dir of DIRS) expect(moveWorldDelta(dir, 0, true)).toEqual(ISO0[dir])
  })

  it('actually rotates the world delta at a rotated facing (not ignored)', () => {
    expect(moveWorldDelta('up', 1, true)).not.toEqual(ISO0.up)
    expect(moveWorldDelta('up', 2, true)).toEqual([1, 1])  // half-turn: up-key drives the opposite world diagonal
  })

  it('the flat 2D/top view ignores facing (no camera rotation there)', () => {
    for (const facing of FACINGS) {
      expect(moveWorldDelta('up', facing, false)).toEqual([0, -1])
      expect(moveWorldDelta('right', facing, false)).toEqual([1, 0])
    }
  })
})
