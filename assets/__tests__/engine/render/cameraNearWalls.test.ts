import { cameraNearWalls, type Pt } from '@/engine/render/iso'

// The invariant cameraNearWalls encodes: an iso box shows the camera exactly TWO of its four walls —
// the ones whose bottom-edge midpoint sits BELOW (larger screen-y) the footprint centre. WHICH two
// flips with the building's orientation. Windows must be drawn only on those, never the two hidden
// far walls (whose windows otherwise bleed through onto the roof when the building fades). Pure geometry.

const centreY = (fbl: Pt, fbr: Pt, bbl: Pt, bbr: Pt): number => (fbl.y + fbr.y + bbl.y + bbr.y) / 4
const midY = (base: Pt, axis: Pt): number => base.y + axis.y / 2

/** Ground corners of a footprint from a front-left origin at (0,0) + the two iso edge vectors. */
function box(colVec: Pt, depthVec: Pt, L: number, depth: number) {
  const fbl: Pt = { x: 0, y: 0 }
  const fbr: Pt = { x: colVec.x * L, y: colVec.y * L }
  const bbl: Pt = { x: depthVec.x * depth, y: depthVec.y * depth }
  const bbr: Pt = { x: fbr.x + depthVec.x * depth, y: fbr.y + depthVec.y * depth }
  return { fbl, fbr, bbl, bbr, L, depth }
}

// The four iso orientations = the four sign combinations of the base iso edge vectors.
const W = 16, H = 8
const ORIENTATIONS: { name: string; colVec: Pt; depthVec: Pt }[] = [
  { name: 'col-down-right, depth-down-left', colVec: { x: W, y: H }, depthVec: { x: -W, y: H } },
  { name: 'col-up-right, depth-down-right', colVec: { x: W, y: -H }, depthVec: { x: W, y: H } },
  { name: 'col-up-left, depth-up-right', colVec: { x: -W, y: -H }, depthVec: { x: W, y: -H } },
  { name: 'col-down-left, depth-up-left', colVec: { x: -W, y: H }, depthVec: { x: -W, y: -H } },
]

describe('cameraNearWalls', () => {
  for (const o of ORIENTATIONS) {
    const { fbl, fbr, bbl, bbr, L, depth } = box(o.colVec, o.depthVec, 3, 2)
    const cy = centreY(fbl, fbr, bbl, bbr)

    test(`${o.name}: selects exactly two walls`, () => {
      expect(cameraNearWalls(fbl, fbr, bbl, bbr, L, depth)).toHaveLength(2)
    })

    test(`${o.name}: every selected wall faces the camera (midpoint below footprint centre)`, () => {
      for (const w of cameraNearWalls(fbl, fbr, bbl, bbr, L, depth)) {
        expect(midY(w.base, w.axis)).toBeGreaterThan(cy)
      }
    })

    test(`${o.name}: exactly two of the four candidate walls are near (sanity)`, () => {
      const candidates = [
        { base: fbl, axis: { x: fbr.x - fbl.x, y: fbr.y - fbl.y } }, // front
        { base: bbl, axis: { x: bbr.x - bbl.x, y: bbr.y - bbl.y } }, // back
        { base: fbl, axis: { x: bbl.x - fbl.x, y: bbl.y - fbl.y } }, // left
        { base: fbr, axis: { x: bbr.x - fbr.x, y: bbr.y - fbr.y } }, // right
      ]
      expect(candidates.filter(w => midY(w.base, w.axis) > cy)).toHaveLength(2)
    })
  }

  test('window span comes through on each selected wall', () => {
    const { fbl, fbr, bbl, bbr, L, depth } = box({ x: W, y: H }, { x: -W, y: H }, 4, 3)
    const near = cameraNearWalls(fbl, fbr, bbl, bbr, L, depth)
    // spans are the footprint dimensions (4 length, 3 depth) — one of each on the two near walls.
    expect(near.map(w => w.span).sort()).toEqual([3, 4])
  })
})
