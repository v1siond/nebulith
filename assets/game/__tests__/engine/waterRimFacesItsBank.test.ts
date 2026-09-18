/**
 * A BORDER PIECE'S RIM POINTS AT THE BANK IT BORDERS, at every camera facing.
 *
 * His report: *"we also must ensure they stay consistent when rotating camera"*.
 *
 * This cannot be settled by looking. Each build is a different random map, the water is half hidden under
 * canopy, and a screenshot cannot say which of two shorelines a pale band belongs to. The geometry can: the
 * face a ground tile's picture lands on, and the shear that lands it there, are both pure.
 *
 * THE TWO FRAMES. `autotileLabel` names a piece by a WORLD side: `_t` is `!filled(col, row - 1)`, so its land
 * is at -row. The art paints that rim along ONE EDGE OF ITS OWN IMAGE (`_t` at y 0, `_b` at y 113, `_l` at
 * x 0, `_r` at x 113, measured out of the 128 viewBox in `priv/tilegen/tiles.json`). The face it is sheared
 * onto is built in the VIEW frame, from `orientCell`. So the question this file answers is whether the edge
 * the picture lands on is the edge the label names, and whether it stays there when the camera turns.
 */
import { isoBlockFaces, turnFaceTexture } from '@/engine/render/isoBlock'
import { orientCell, type Orientation } from '@/engine/render/isoOrientation'

const TILE_W = 32
const TILE_H = 16
const COLS = 41
const ROWS = 41

/** The fixed iso projection, the one thing the camera never changes: x from (col - row), y from (col + row). */
const project = (col: number, row: number): { x: number; y: number } =>
  ({ x: (col - row) * TILE_W, y: (col + row) * TILE_H })

/** Where the render draws a WORLD cell's diamond centre at `facing`, which is `orientCell` then the projection. */
function screenOf(col: number, row: number, facing: Orientation): { x: number; y: number } {
  const v = orientCell(col, row, COLS, ROWS, facing)
  return project(v.col, v.row)
}

/**
 * Where the CENTRE OF THE RIM BAND of a piece lands on screen, for a cell drawn at `facing`.
 *
 * The draw is `fillIsoFaceWithTile(ctx, top.a, top.b - top.a, top.d - top.a, …)` followed by
 * `ctx.transform(eA.x/S, eA.y/S, eB.x/S, eB.y/S, origin.x, origin.y)`, and a canvas transform maps
 * (u, v) to `origin + eA*u + eB*v`. So the image's x runs along eA and its y along eB, and a point of the
 * PICTURE is placed by exactly that sum. `turns` permutes the basis first, which is what this has to include.
 */
function rimOnScreen(col: number, row: number, facing: Orientation, u: number, v: number, turns: number): { x: number; y: number } {
  const centre = screenOf(col, row, facing)
  const top = isoBlockFaces(centre, TILE_W, TILE_H, TILE_H, 0).top
  const basis = turnFaceTexture(top.a, { x: top.b.x - top.a.x, y: top.b.y - top.a.y }, { x: top.d.x - top.a.x, y: top.d.y - top.a.y }, turns)
  return { x: basis.origin.x + basis.eA.x * u + basis.eB.x * v, y: basis.origin.y + basis.eA.y * u + basis.eB.y * v }
}

/** The four suffixes that name ONE side, with the world step toward the land that side faces. */
const SIDES = [
  { suffix: '_t', step: [0, -1], band: { u: 0.5, v: 0.06 } }, // rim along the image's TOP edge
  { suffix: '_b', step: [0, 1], band: { u: 0.5, v: 0.94 } },  // BOTTOM edge
  { suffix: '_l', step: [-1, 0], band: { u: 0.06, v: 0.5 } }, // LEFT edge
  { suffix: '_r', step: [1, 0], band: { u: 0.94, v: 0.5 } },  // RIGHT edge
] as const

/** Which of the four world neighbours the rim actually points at, read off the screen geometry. */
function rimPointsAt(col: number, row: number, facing: Orientation, band: { u: number; v: number }, turns: number): string {
  const centre = screenOf(col, row, facing)
  // MEASURE FROM THE FACE, not from the cell's base. The top face is drawn a block ABOVE the base diamond, so
  // taking the base centre as the origin adds a constant upward bias to every direction and quietly turns the
  // answer: it read `_b` as pointing north, which is not a thing any quarter-turn of this basis can produce.
  const top = isoBlockFaces(centre, TILE_W, TILE_H, TILE_H, 0).top
  const face = { x: (top.a.x + top.b.x + top.c.x + top.d.x) / 4, y: (top.a.y + top.b.y + top.c.y + top.d.y) / 4 }
  const rim = rimOnScreen(col, row, facing, band.u, band.v, turns)
  const toward = { x: rim.x - face.x, y: rim.y - face.y }
  const NEIGHBOURS = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] } as const
  let best = 'none'
  let bestDot = -Infinity
  for (const [name, [dc, dr]] of Object.entries(NEIGHBOURS)) {
    const nb = screenOf(col + dc, row + dr, facing)
    const dir = { x: nb.x - centre.x, y: nb.y - centre.y }
    const len = Math.hypot(dir.x, dir.y) || 1
    const dot = (toward.x * dir.x + toward.y * dir.y) / len
    if (dot > bestDot) { bestDot = dot; best = name }
  }
  return best
}

const LAND_OF: Readonly<Record<string, string>> = { _t: 'north', _b: 'south', _l: 'west', _r: 'east' }

/** The turn from a top-down picture's own frame to the grid's, which the render applies as `PICTURE_TO_GRID`.
 *  Restated here rather than imported so the test fails if the render quietly changes it. */
const PICTURE_TO_GRID = 1

describe('a water border rim faces the bank its label names', () => {
  it.each([0, 1, 2, 3] as const)('at facing %i, with the camera turn carried into the texture', facing => {
    const wrong: string[] = []
    for (const { suffix, band } of SIDES) {
      // The rule the render applies: a world-authored picture takes the camera's quarter-turns, the tile-art
      // half of what `orientCell` does for position.
      const at = rimPointsAt(20, 20, facing, band, PICTURE_TO_GRID + facing)
      if (at !== LAND_OF[suffix]) wrong.push(`${suffix} points ${at}, its land is ${LAND_OF[suffix]}`)
    }
    expect(wrong).toEqual([])
  })

  it('and without the camera turn it comes adrift the moment the camera moves', () => {
    // The defect, stated so it cannot come back: turns fixed at 0 is right at most at one facing.
    const adrift = ([0, 1, 2, 3] as const).filter(facing =>
      SIDES.some(({ suffix, band }) => rimPointsAt(20, 20, facing, band, 0) !== LAND_OF[suffix]))
    // Three of the four, and the one it happens to be right at is facing 3, not the resting facing 0. So the
    // art was never aligned at the view anybody actually builds in.
    expect(adrift).toEqual([0, 1, 2])

    // And the picture-frame turn ALONE is right at facing 0 and wrong at the other three, which is the pair of
    // defects this file separates: one that was there before the camera moved, one that only shows when it does.
    const stillOff = ([0, 1, 2, 3] as const).filter(facing =>
      SIDES.some(({ suffix, band }) => rimPointsAt(20, 20, facing, band, PICTURE_TO_GRID) !== LAND_OF[suffix]))
    expect(stillOff).toEqual([1, 2, 3])
  })
})
