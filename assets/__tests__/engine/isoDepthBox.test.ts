/**
 * isoDepthBox — DIRECTIONAL DEPTH: a block with depth D + a direction extrudes into ONE long iso box
 * spanning D cells along one of the four iso diagonals, anchored at its base cell (NOT D cubes, NOT a
 * symmetric widening). The unit-cube geometry (isoBlockFaces) is asserted separately and UNCHANGED in
 * isoBlockFaces.test.ts; here we assert the extruded hull per direction, D=1 == the unit cube, and the
 * covered-cell / depth-sort helpers.
 */
import { isoBlockFaces } from '@/engine/render/isoBlock'
import { isoDepthBox, depthCells, depthFrontExtent, type DepthDir } from '@/engine/render/isoBlock'
import type { Pt, BlockFace } from '@/engine/render/isoBlock'

const center = { x: 300, y: 200 }
const tileW = 40
const tileH = 20
const blockH = 36 // same fixtures as isoBlockFaces.test.ts, so cross-checks line up

// Unit-cube TOP diamond corners at level 0 (ty = center.y - blockH = 164).
const U = { L: { x: 260, y: 164 }, T: { x: 300, y: 144 }, R: { x: 340, y: 164 }, B: { x: 300, y: 184 } }

// Per-direction spec: the (D−1)*step offset at D=4, which unit corners STAY (near) and which are PUSHED (far).
const SPEC: Record<DepthDir, { off: Pt; near: (keyof typeof U)[]; far: (keyof typeof U)[] }> = {
  'right-up': { off: { x: 120, y: -60 }, near: ['L', 'B'], far: ['T', 'R'] },
  'left-up': { off: { x: -120, y: -60 }, near: ['R', 'B'], far: ['L', 'T'] },
  'left-down': { off: { x: -120, y: 60 }, near: ['T', 'R'], far: ['L', 'B'] },
  'right-down': { off: { x: 120, y: 60 }, near: ['L', 'T'], far: ['R', 'B'] },
}
const DIRS = Object.keys(SPEC) as DepthDir[]
const D = 4

const key = (p: Pt) => `${Math.round(p.x)},${Math.round(p.y)}`
const cornerSet = (f: BlockFace) => new Set([f.a, f.b, f.c, f.d].map(key))
const add = (p: Pt, o: Pt): Pt => ({ x: p.x + o.x, y: p.y + o.y })
const sub = (p: Pt, q: Pt): Pt => ({ x: p.x - q.x, y: p.y - q.y })
const len = (p: Pt) => Math.hypot(p.x, p.y)
const setEq = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every(x => b.has(x))

describe('isoDepthBox — extrude a unit block into a long directional iso box', () => {
  test.each(DIRS)('%s: TOP-face FAR corners are offset by (D−1)*step; NEAR corners stay put', dir => {
    const { off, near, far } = SPEC[dir]
    const expected = new Set<string>([
      ...near.map(k => key(U[k])), // trailing corners unchanged
      ...far.map(k => key(add(U[k], off))), // leading corners pushed by (D−1)*step
    ])
    const { top } = isoDepthBox(center, tileW, tileH, blockH, D, dir, 0)
    expect(setEq(cornerSet(top), expected)).toBe(true)
  })

  test.each(DIRS)('%s: the LONG wall spans D cells while the CAP spans exactly one; both rise one block', dir => {
    const box = isoDepthBox(center, tileW, tileH, blockH, D, dir, 0)
    // eA = b − a is each face's BOTTOM edge; the long wall's is D× the cap's (it runs the full length).
    const longEdge = len(sub(box.long.b, box.long.a))
    const capEdge = len(sub(box.cap.b, box.cap.a))
    expect(longEdge).toBeCloseTo(D * capEdge, 6)
    // eB = d − a rises straight up by exactly one block on BOTH walls (height composes normally).
    expect(sub(box.long.d, box.long.a)).toEqual({ x: 0, y: -blockH })
    expect(sub(box.cap.d, box.cap.a)).toEqual({ x: 0, y: -blockH })
  })

  test.each(DIRS)('%s: the long wall + cap wear the two front-wall shades (one left, one right)', dir => {
    const box = isoDepthBox(center, tileW, tileH, blockH, D, dir, 0)
    expect(new Set([box.longShade, box.capShade])).toEqual(new Set(['left', 'right']))
  })

  test.each(DIRS)('%s: D=1 == the unit cube (top diamond + the two front walls, unchanged)', dir => {
    const box = isoDepthBox(center, tileW, tileH, blockH, 1, dir, 0)
    const unit = isoBlockFaces(center, tileW, tileH, blockH, 0)
    // Top is the SAME diamond.
    expect(setEq(cornerSet(box.top), cornerSet(unit.top))).toBe(true)
    // The long wall + cap together are exactly the unit cube's LEFT + RIGHT front walls.
    const boxWalls = new Set<string>([...cornerSet(box.long), ...cornerSet(box.cap)])
    const unitWalls = new Set<string>([...cornerSet(unit.left), ...cornerSet(unit.right)])
    expect(setEq(boxWalls, unitWalls)).toBe(true)
  })

  test('stacking: level 1 is level 0 shifted up by exactly one blockH (height composes normally)', () => {
    const l0 = isoDepthBox(center, tileW, tileH, blockH, D, 'right-up', 0)
    const l1 = isoDepthBox(center, tileW, tileH, blockH, D, 'right-up', 1)
    for (const face of ['top', 'long', 'cap'] as const) {
      for (const c of ['a', 'b', 'c', 'd'] as const) {
        expect(l1[face][c]).toEqual({ x: l0[face][c].x, y: l0[face][c].y - blockH })
      }
    }
  })
})

describe('depthCells — the D grid cells a directional box covers (collision + depth sort)', () => {
  test.each([
    ['right-up', [{ col: 5, row: 5 }, { col: 5, row: 4 }, { col: 5, row: 3 }, { col: 5, row: 2 }]],
    ['left-up', [{ col: 5, row: 5 }, { col: 4, row: 5 }, { col: 3, row: 5 }, { col: 2, row: 5 }]],
    ['left-down', [{ col: 5, row: 5 }, { col: 5, row: 6 }, { col: 5, row: 7 }, { col: 5, row: 8 }]],
    ['right-down', [{ col: 5, row: 5 }, { col: 6, row: 5 }, { col: 7, row: 5 }, { col: 8, row: 5 }]],
  ] as [DepthDir, { col: number; row: number }[]][])('%s covers the anchor then D−1 steps along its axis', (dir, cells) => {
    expect(depthCells(5, 5, 4, dir)).toEqual(cells)
  })

  test('anchor stays the base cell; depth≤1 covers only the anchor', () => {
    expect(depthCells(3, 7, 1, 'right-down')).toEqual([{ col: 3, row: 7 }])
    expect(depthCells(3, 7, 0, 'left-up')).toEqual([{ col: 3, row: 7 }])
  })
})

describe('depthFrontExtent — how far a box reaches toward the camera past its anchor (depth-sort key)', () => {
  test('approaching dirs (+col/+row) reach D−1 closer; receding dirs (−col/−row) reach 0', () => {
    expect(depthFrontExtent(4, 'right-down')).toBe(3) // +col
    expect(depthFrontExtent(4, 'left-down')).toBe(3) // +row
    expect(depthFrontExtent(4, 'right-up')).toBe(0) // −row (recedes)
    expect(depthFrontExtent(4, 'left-up')).toBe(0) // −col (recedes)
    expect(depthFrontExtent(1, 'right-down')).toBe(0) // depth 1 never reaches
  })
})
