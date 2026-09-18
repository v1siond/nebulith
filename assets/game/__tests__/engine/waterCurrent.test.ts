/**
 * ONE PICTURE, TURNED PER CELL.
 *
 * This file used to assert the opposite, and it was green the whole time, which is the lesson worth keeping.
 * It checked that FOUR frame sets existed and that a cell picked one by id. Four sets is a real answer to
 * "the current should follow the river", it is just an expensive one: the direction was baked into eight
 * PNGs. A floor face is painted by mapping the unit texture square onto it with two basis vectors
 * (`ctx.transform(eA, eB)`), so a quarter turn of the picture is a PERMUTATION of those two vectors and costs
 * nothing. The catalog is back to one loop and the eight transposed rows are deleted.
 *
 * So the tests here are now about the TURN, and they are exact rather than eyeballed: a turn must cover the
 * same face, four turns must be the identity, and the heading→turn mapping has to agree with the projection
 * the renderer actually uses.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { isoBlockFaces, turnFaceTexture, textureTurnForHeading, unitGroundQuad, type Pt } from '@/engine/render/isoBlock'
import { styleTile } from '@/engine/tileset/styleTiles'

const near = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9
/** The four corners a (origin, eA, eB) triple paints, as a set that ignores which corner is which. */
const corners = (t: { origin: Pt; eA: Pt; eB: Pt }): Pt[] => [
  t.origin,
  { x: t.origin.x + t.eA.x, y: t.origin.y + t.eA.y },
  { x: t.origin.x + t.eB.x, y: t.origin.y + t.eB.y },
  { x: t.origin.x + t.eA.x + t.eB.x, y: t.origin.y + t.eA.y + t.eB.y },
]
const sameQuad = (a: Pt[], b: Pt[]) => a.every(p => b.some(q => near(p, q))) && a.length === b.length

const ORIGIN: Pt = { x: 100, y: 50 }
const EA: Pt = { x: 32, y: -16 }
const EB: Pt = { x: 32, y: 16 }

describe('turning a tile turns the PICTURE, never the face', () => {
  it.each([0, 1, 2, 3])('turn %i paints exactly the same four corners', k => {
    const turned = turnFaceTexture(ORIGIN, EA, EB, k)
    expect(sameQuad(corners(turned), corners({ origin: ORIGIN, eA: EA, eB: EB }))).toBe(true)
  })

  it('four turns is the identity, so a heading can never drift', () => {
    let t = { origin: ORIGIN, eA: EA, eB: EB }
    for (let i = 0; i < 4; i++) t = turnFaceTexture(t.origin, t.eA, t.eB, 1)
    expect(near(t.origin, ORIGIN) && near(t.eA, EA) && near(t.eB, EB)).toBe(true)
  })

  it('turning twice by one equals turning once by two (it composes)', () => {
    const once = turnFaceTexture(ORIGIN, EA, EB, 1)
    const twice = turnFaceTexture(once.origin, once.eA, once.eB, 1)
    const direct = turnFaceTexture(ORIGIN, EA, EB, 2)
    expect(near(twice.origin, direct.origin) && near(twice.eA, direct.eA) && near(twice.eB, direct.eB)).toBe(true)
  })

  it('each turn actually CHANGES the picture, so a heading is never a no-op', () => {
    const seen = [0, 1, 2, 3].map(k => JSON.stringify(turnFaceTexture(ORIGIN, EA, EB, k)))
    expect(new Set(seen).size).toBe(4)
  })

  it('a negative or oversized turn wraps instead of breaking', () => {
    expect(turnFaceTexture(ORIGIN, EA, EB, -1)).toEqual(turnFaceTexture(ORIGIN, EA, EB, 3))
    expect(turnFaceTexture(ORIGIN, EA, EB, 5)).toEqual(turnFaceTexture(ORIGIN, EA, EB, 1))
  })
})

/**
 * THE MAPPING IS DERIVED, NOT CHOSEN. The renderer builds a top face as `origin = left corner, eA -> top,
 * eB -> bottom`, so with the unit diamond `eA` is the -row step and `eB` is the +col step. Water art runs its
 * waves along texture-x, so untouched water flows along `eA`, heading 3. Everything else follows.
 *
 * This test reads those vectors out of `isoBlockFaces` rather than restating them, so if the projection ever
 * changes the mapping fails here instead of quietly pointing every river the wrong way.
 */
describe('a heading turns the texture toward the grid direction it names', () => {
  const tileW = 32
  const tileH = 16
  const top = isoBlockFaces({ x: 0, y: 0 }, tileW, tileH, 24, 0, unitGroundQuad(tileW, tileH)).top
  const eA = { x: top.b.x - top.a.x, y: top.b.y - top.a.y }
  const eB = { x: top.d.x - top.a.x, y: top.d.y - top.a.y }
  /** Screen step of one cell in each heading: 0=+col, 1=+row, 2=-col, 3=-row. */
  const HEADING_STEP: Pt[] = [{ x: tileW, y: tileH }, { x: -tileW, y: tileH }, { x: -tileW, y: -tileH }, { x: tileW, y: -tileH }]

  it.each([0, 1, 2, 3])('heading %i sends the along-x waves that way on screen', heading => {
    // After the turn, the picture's own +x axis IS the face's first basis vector, and one basis vector spans
    // exactly one cell step (left corner to top corner is the -row step). So this compares like with like.
    const turned = turnFaceTexture(top.a, eA, eB, textureTurnForHeading(heading))
    expect(near(turned.eA, HEADING_STEP[heading])).toBe(true)
  })

  it('untouched art already runs along eA, which is why the mapping is heading + 1', () => {
    expect(textureTurnForHeading(3)).toBe(0) // heading 3 needs no turn at all
    expect(near(eA, HEADING_STEP[3])).toBe(true) // eA is the -row step: up and to the right on screen
    expect(near(eB, HEADING_STEP[0])).toBe(true) // eB is the +col step: down and to the right
  })
})

describe('the catalog carries ONE water loop, and no transposed art', () => {
  it('serves a single current, not one per heading', () => {
    for (const style of ['ascii', 'emoji'] as const) {
      const anims = (styleTile(style, 'water')?.settings as { animations?: Array<{ id: string }> } | undefined)?.animations ?? []
      const currents = anims.map(a => a.id).filter(id => id.startsWith('water_flow'))
      expect({ style, currents }).toEqual({ style, currents: ['water_flow'] })
    }
  })

  it('the eight transposed rows are GONE from the vocabulary', () => {
    for (const style of ['ascii', 'emoji'] as const) {
      for (const label of ['water_y', 'water_y_f1', 'water_y_f2', 'water_y_f3']) {
        expect({ style, label, served: styleTile(style, label) !== undefined }).toEqual({ style, label, served: false })
      }
    }
  })

  it('the one loop still has all four frames, so the water still moves', () => {
    const anims = (styleTile('emoji', 'water')?.settings as { animations?: Array<{ id: string; frames?: unknown[] }> } | undefined)?.animations ?? []
    const flow = anims.find(a => a.id === 'water_flow')
    expect(flow?.frames?.length).toBe(4)
  })
})

/**
 * HEADING 0 IS A HEADING.
 *
 * Because the renderer read the heading as `if (asset.flow)`. Heading 0 is +col, a perfectly good direction,
 * and it is also falsy, so every +col cell skipped the turn entirely and drew a quarter turn off while the
 * cells beside it were right. That is exactly the "some zones wrong, some right" it circled, and no amount
 * of work on the flow FIELD could ever have fixed it: the data was correct the whole time.
 *
 * Found by instrumenting the real page through Playwright and counting the turns actually drawn: on a ring
 * river with 10 cells at flow 0, the frame contained not a single `turns=1` draw. That is the check below,
 * as a unit: the mapping must produce a REAL turn for heading 0, and a caller must not treat it as absent.
 */
describe('heading 0 is a heading, not a missing value', () => {
  it('maps to a turn like any other heading', () => {
    expect(textureTurnForHeading(0)).toBe(1)
    expect([0, 1, 2, 3].map(textureTurnForHeading).sort()).toEqual([0, 1, 2, 3]) // a bijection, none lost
  })

  it('and that turn is NOT the identity, so skipping it is visible', () => {
    // The bug was invisible in code review precisely because turn 0 looks like "no turn". Heading 0's turn
    // must actually move the picture, or falling through to unturned would be harmless and nobody would look.
    const o = { x: 0, y: 0 }, eA = { x: 32, y: -16 }, eB = { x: 32, y: 16 }
    const turned = turnFaceTexture(o, eA, eB, textureTurnForHeading(0))
    expect(turned.eA).not.toEqual(eA)
  })

  it('the two headings along one axis give the SAME line, opposite scroll', () => {
    // +col and -col are one channel seen two pathways: the waves lie the same, only the drift reverses. This is
    // why the render A/B showed K=1 and K=3 identical, and it is the invariant that makes the mapping safe.
    const o = { x: 0, y: 0 }, eA = { x: 32, y: -16 }, eB = { x: 32, y: 16 }
    // The angle MOD 180, because a line has no arrow. Taking |x|,|y| instead collapses the two diagonals
    // onto each other (|32,-16| and |32,16| are the same pair) and the test passes for the wrong reason.
    const along = (h: number) => {
      const t = turnFaceTexture(o, eA, eB, textureTurnForHeading(h))
      return Math.round(((Math.atan2(t.eA.y, t.eA.x) * 180) / Math.PI + 180) % 180)
    }
    expect(along(0)).toBe(along(2))
    expect(along(1)).toBe(along(3))
    expect(along(0)).not.toBe(along(1))
  })
})
