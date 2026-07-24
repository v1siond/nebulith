import type { Orientation } from '@/engine/render/isoOrientation'

/** The world (dCol, dRow) an ISO arrow key means at camera facing 0 — the projection sends each to its
 *  screen direction (up = toward screen-top, etc.). `2d` view is axis-aligned, no diagonal. */
export type MoveDir = 'up' | 'down' | 'left' | 'right'

const ISO0: Record<MoveDir, readonly [number, number]> = {
  up: [-1, -1],
  down: [1, 1],
  left: [-1, 1],
  right: [1, -1],
}
const FLAT0: Record<MoveDir, readonly [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
}

/** One CCW quarter-turn of a grid delta — the INVERSE of the camera's CW orient (`(dc,dr) → (dr,-dc)`),
 *  applied `n` times. Rotating the input by the inverse of the camera keeps a key pinned to its SCREEN
 *  direction: "up" moves toward the top of the screen at every facing (the map turns, the controls don't). */
function rotateDeltaCCW([dc, dr]: readonly [number, number], n: Orientation): [number, number] {
  let c = dc, r = dr
  for (let i = 0; i < n; i++) { const nc = r, nr = -c; c = nc; r = nr }
  return [c, r]
}

/** The world (dCol, dRow) unit-direction a key should move the player, given the ISO camera `facing`.
 *  `iso` picks the diagonal base (screen-relative); the flat 2D/top views ignore facing (no rotation there). */
export function moveWorldDelta(dir: MoveDir, facing: Orientation, iso: boolean): [number, number] {
  if (!iso) return [...FLAT0[dir]]
  return rotateDeltaCCW(ISO0[dir], facing)
}
