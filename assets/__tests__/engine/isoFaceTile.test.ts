/**
 * #84 — tiles are TRANSFORMED onto the iso geometry, not stamped upright.
 *
 * `fillIsoFaceWithTile` is the one primitive that turns a tile (emoji glyph now, image
 * sprite later) into an iso-angled texture: it pushes a CTM built from the face's two edge
 * vectors so a unit tile maps onto the parallelogram, then stamps na×nb tiles across it.
 *
 * These tests prove the SHEAR is correct — the transform maps the tile's unit box onto the
 * exact face corners (the ground DIAMOND corners; a wall FACE's corners) — and that a tile is
 * actually drawn (a glyph stamped, not skipped). If the CTM were wrong the emoji would sit
 * upright/off-diamond, which is the bug the user reported.
 */
import { fillIsoFaceWithTile } from '@/engine/render/iso'

const S = 64 // the primitive's internal work-box side (unit tile spans [0,S] in both axes)

type Mat = { a: number; b: number; c: number; d: number; e: number; f: number }

// A ctx mock that records the CTM set by transform() plus every stamped glyph position, so we can
// map the unit-box corners forward and see where each tile actually lands on screen.
function recordingCtx() {
  let mat: Mat | null = null
  const glyphs: { char: string; x: number; y: number }[] = []
  const ctx = {
    fillStyle: '#000',
    font: '',
    textAlign: '' as CanvasTextAlign,
    textBaseline: '' as CanvasTextBaseline,
    save() {},
    restore() {},
    beginPath() {},
    rect() {},
    clip() {},
    transform(a: number, b: number, c: number, d: number, e: number, f: number) {
      mat = { a, b, c, d, e, f } // no prior transform in the test → this IS the CTM
    },
    fillText(char: string, x: number, y: number) {
      glyphs.push({ char, x, y })
    },
    drawImage() {},
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, glyphs, getMat: () => mat }
}

// Map a work-box point (u, v) through the recorded CTM to its screen point.
const apply = (m: Mat, u: number, v: number) => ({ x: m.a * u + m.c * v + m.e, y: m.b * u + m.d * v + m.f })

const near = (p: { x: number; y: number }, x: number, y: number) => {
  expect(p.x).toBeCloseTo(x, 6)
  expect(p.y).toBeCloseTo(y, 6)
}

describe('fillIsoFaceWithTile — the tile is sheared onto the face (not upright)', () => {
  test('ground diamond: the unit tile maps exactly onto the four diamond corners', () => {
    // A ground cell centred at (px, drawY) with half-extents (tileW, tileH). drawIsoGroundContent
    // passes the diamond as: origin = LEFT corner, eA → TOP corner, eB → BOTTOM corner.
    const px = 300
    const drawY = 200
    const tileW = 33
    const tileH = 17
    const origin = { x: px - tileW, y: drawY }
    const eA = { x: tileW, y: -tileH }
    const eB = { x: tileW, y: tileH }

    const { ctx, glyphs, getMat } = recordingCtx()
    fillIsoFaceWithTile(ctx, origin, eA, eB, { char: '🟩', color: '#5faf4a' }, 1, 1)

    const m = getMat()!
    expect(m).not.toBeNull()
    // The tile's unit box corners land on the DIAMOND corners — i.e. the emoji lies flat on the
    // iso ground plane, filling the diamond at its angle, instead of a flat upright square.
    near(apply(m, 0, 0), px - tileW, drawY) // left
    near(apply(m, S, 0), px, drawY - tileH) // top
    near(apply(m, 0, S), px, drawY + tileH) // bottom
    near(apply(m, S, S), px + tileW, drawY) // right

    // …and a single tile is actually stamped, at the diamond centre.
    expect(glyphs).toHaveLength(1)
    expect(glyphs[0].char).toBe('🟩')
    near(apply(m, glyphs[0].x, glyphs[0].y), px, drawY) // centre of the diamond
  })

  test('wall face: a vertical face shears the tile up its iso angle with z', () => {
    // A wall face given as (bottom-left origin, bottom edge eA along the iso axis, up edge eB).
    const origin = { x: 100, y: 260 }
    const eA = { x: 80, y: 40 } // bottom edge runs down-right along the iso axis
    const eB = { x: 0, y: -120 } // straight up (the wall's height / z)

    const { ctx, getMat } = recordingCtx()
    fillIsoFaceWithTile(ctx, origin, eA, eB, { char: '🧱', color: '#b0603a' }, 1, 1)

    const m = getMat()!
    near(apply(m, 0, 0), 100, 260) // bottom-left (ground)
    near(apply(m, S, 0), 180, 300) // bottom-right (ground, sheared along the iso axis)
    near(apply(m, 0, S), 100, 140) // top-left (up the wall — has z)
    near(apply(m, S, S), 180, 180) // top-right
  })

  test('na×nb tiling: a bricked wall stamps a tile grid across the face', () => {
    const origin = { x: 0, y: 100 }
    const eA = { x: 90, y: 0 }
    const eB = { x: 0, y: -60 }

    const { ctx, glyphs } = recordingCtx()
    fillIsoFaceWithTile(ctx, origin, eA, eB, { char: '🧱', color: '#b0603a' }, 3, 2)

    // 3 across × 2 up = 6 bricks, all the same glyph.
    expect(glyphs).toHaveLength(6)
    expect(glyphs.every(g => g.char === '🧱')).toBe(true)
    // Positions are the cell centres in the 64-box: cols at S/6, S/2, 5S/6; rows at S/4, 3S/4.
    const xs = [...new Set(glyphs.map(g => Math.round(g.x)))].sort((a, b) => a - b)
    const ys = [...new Set(glyphs.map(g => Math.round(g.y)))].sort((a, b) => a - b)
    expect(xs).toEqual([Math.round(S / 6), Math.round(S / 2), Math.round((5 * S) / 6)])
    expect(ys).toEqual([Math.round(S / 4), Math.round((3 * S) / 4)])
  })
})
