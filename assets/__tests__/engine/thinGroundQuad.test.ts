/**
 * THICKNESS ALONG A WORLD AXIS — the geometry behind a door that is thin the way the HOUSE faces.
 *
 * Alexander: "we need tickness to work similar to z-width where we can decide the direction in which the
 * element will shrink … I want to ensure the doors are less tick while facing the direction of their
 * logical front … but here it's only applied viewing to MY front, not the front of the house."
 *
 * The old `scaleZ` scaled `bd` — the diamond's SCREEN-VERTICAL half-extent. A cell's two ground axes are
 * the diamond's DIAGONALS (`isoBlock.ts`: the top face runs `T → T+u → T+u+v → T+v` with
 * `u = (+tileW,+tileH)` = +col and `v = (−tileW,+tileH)` = +row), so squashing the screen axis thins the
 * block along no world direction at all — it just looks right when the camera happens to agree.
 *
 * `thinGroundQuad` shrinks the footprint along ONE world axis and keeps the block HUGGING the face that
 * direction points at, so a door stays flush with its wall instead of floating in the middle of the cell.
 */
import { thinGroundQuad, unitGroundQuad, type DepthDir } from '@/engine/render/isoBlock'

const TW = 32, TH = 16
const unit = unitGroundQuad(TW, TH)

/** The four corner names, so a failure says WHICH corner moved. */
const corners = ['l', 't', 'r', 'b'] as const
const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 6)
const sameQuad = (got: ReturnType<typeof unitGroundQuad>, want: ReturnType<typeof unitGroundQuad>) => {
  for (const k of corners) {
    near(got[k].x, want[k].x)
    near(got[k].y, want[k].y)
  }
}

describe('a full-thickness block is the untouched unit diamond', () => {
  it.each<DepthDir>(['right-down', 'left-up', 'left-down', 'right-up'])('t = 1 changes nothing (%s)', dir => {
    sameQuad(thinGroundQuad(TW, TH, dir, 1), unit)
  })

  it('the unit quad IS the diamond the renderer already draws', () => {
    expect(unit).toEqual({
      l: { x: -TW, y: 0 },
      t: { x: 0, y: -TH },
      r: { x: TW, y: 0 },
      b: { x: 0, y: TH },
    })
  })
})

describe('thinning keeps the block flush with the face its direction points at', () => {
  // +col ('right-down'): the +col edge is {r, b} — those two corners must NOT move.
  it('+col hugs the +col edge', () => {
    const q = thinGroundQuad(TW, TH, 'right-down', 0.25)
    sameQuad({ ...q, l: unit.l, t: unit.t }, { ...q, l: unit.l, t: unit.t }) // shape check below
    near(q.r.x, unit.r.x); near(q.r.y, unit.r.y)
    near(q.b.x, unit.b.x); near(q.b.y, unit.b.y)
  })

  // −col ('left-up'): the −col edge is {t, l}.
  it('−col hugs the −col edge', () => {
    const q = thinGroundQuad(TW, TH, 'left-up', 0.25)
    near(q.t.x, unit.t.x); near(q.t.y, unit.t.y)
    near(q.l.x, unit.l.x); near(q.l.y, unit.l.y)
  })

  // +row ('left-down'): the +row edge is {l, b}.
  it('+row hugs the +row edge', () => {
    const q = thinGroundQuad(TW, TH, 'left-down', 0.25)
    near(q.l.x, unit.l.x); near(q.l.y, unit.l.y)
    near(q.b.x, unit.b.x); near(q.b.y, unit.b.y)
  })

  // −row ('right-up'): the −row edge is {t, r}.
  it('−row hugs the −row edge', () => {
    const q = thinGroundQuad(TW, TH, 'right-up', 0.25)
    near(q.t.x, unit.t.x); near(q.t.y, unit.t.y)
    near(q.r.x, unit.r.x); near(q.r.y, unit.r.y)
  })
})

describe('the perpendicular axis keeps its full length — a thin door is still a full-width door', () => {
  const len = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(b.x - a.x, b.y - a.y)
  const fullEdge = Math.hypot(TW, TH)

  it.each<[DepthDir, 'col' | 'row']>([
    ['right-down', 'col'],
    ['left-up', 'col'],
    ['left-down', 'row'],
    ['right-up', 'row'],
  ])('%s shrinks only its own axis', (dir, axis) => {
    const q = thinGroundQuad(TW, TH, dir, 0.25)
    // the col axis runs t→r (and l→b); the row axis runs t→l (and r→b)
    const colEdge = len(q.t, q.r)
    const rowEdge = len(q.t, q.l)
    if (axis === 'col') {
      near(colEdge, fullEdge * 0.25)
      near(rowEdge, fullEdge)
    } else {
      near(rowEdge, fullEdge * 0.25)
      near(colEdge, fullEdge)
    }
  })

  it('stays a parallelogram — opposite edges remain equal', () => {
    const q = thinGroundQuad(TW, TH, 'right-down', 0.3)
    near(len(q.t, q.r), len(q.l, q.b))
    near(len(q.t, q.l), len(q.r, q.b))
  })
})

describe('opposite directions thin to opposite sides of the same cell', () => {
  it('+col and −col produce mirror-image quads about the cell centre', () => {
    const plus = thinGroundQuad(TW, TH, 'right-down', 0.25)
    const minus = thinGroundQuad(TW, TH, 'left-up', 0.25)
    // mirroring a quad through the centre maps t↔b and l↔r
    near(plus.t.x, -minus.b.x); near(plus.t.y, -minus.b.y)
    near(plus.r.x, -minus.l.x); near(plus.r.y, -minus.l.y)
  })
})

describe('a malformed thickness never collapses or inverts the block', () => {
  it.each([0, -1, Number.NaN])('t = %p falls back to the full quad', t => {
    sameQuad(thinGroundQuad(TW, TH, 'right-down', t as number), unit)
  })

  it('a thickness above 1 is clamped — a block cannot spill outside its own cell', () => {
    sameQuad(thinGroundQuad(TW, TH, 'right-down', 4), unit)
  })
})
