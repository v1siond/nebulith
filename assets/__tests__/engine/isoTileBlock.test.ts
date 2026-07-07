/**
 * drawIsoTileBlock — the impure canvas glue that renders a height≥1 tile/asset as an iso CUBE:
 * for each stacked block it fills the two visible side faces (shaded via the global LIGHT) plus one
 * top face, and shears the tile onto each via fillIsoFaceWithTile. Verified through a recording ctx
 * (the same technique as isoFaceTile.test.ts): count the solid face fills + the tile overlays and
 * check the per-face shading, so the geometry can't silently regress into a flat billboard.
 */
import { drawIsoTileBlock, faceLight } from '@/engine/render/iso'
import { darkenColor } from '@/engine/colors'

// Records fillStyle at each solid fill() and counts tile overlays (fillIsoFaceWithTile → ctx.transform).
function recordingCtx() {
  const fills: string[] = []
  let overlays = 0
  const ctx = {
    fillStyle: '#000',
    font: '',
    textAlign: '' as CanvasTextAlign,
    textBaseline: '' as CanvasTextBaseline,
    globalAlpha: 1,
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    rect() {},
    clip() {},
    transform() { overlays++ }, // fillIsoFaceWithTile pushes a CTM per face
    fill() { fills.push(String((ctx as { fillStyle: string }).fillStyle)) },
    fillText() {},
    drawImage() {},
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills, getOverlays: () => overlays }
}

const center = { x: 300, y: 200 }
const tileW = 40
const tileH = 20
const blockH = 36
const imgTile = { char: '🧱', color: '#b0603a', image: { kind: 'image' as const, src: '/x.png' } }

describe('drawIsoTileBlock — a height≥1 tile renders as a shaded, stacked iso cube', () => {
  test('height 1 → 3 faces (2 sides + 1 top), each with a tile overlay', () => {
    const { ctx, fills, getOverlays } = recordingCtx()
    drawIsoTileBlock(ctx, center, tileW, tileH, blockH, 1, imgTile)
    expect(fills).toHaveLength(3) // left + right + top
    expect(getOverlays()).toBe(3) // tile sheared onto every face
  })

  test('height N stacks: 2·N side faces + 1 top face', () => {
    const { fills } = (() => { const r = recordingCtx(); drawIsoTileBlock(r.ctx, center, tileW, tileH, blockH, 3, imgTile); return r })()
    expect(fills).toHaveLength(2 * 3 + 1)
  })

  test('top face is full-bright; the two sides are LIGHT-shaded (darker) via darkenColor', () => {
    const { ctx, fills } = recordingCtx()
    drawIsoTileBlock(ctx, center, tileW, tileH, blockH, 1, imgTile)
    const base = imgTile.color
    const leftC = darkenColor(base, faceLight(-tileH, tileW))
    const rightC = darkenColor(base, faceLight(tileH, tileW))
    // top is drawn LAST (so it occludes the stack) at the full base colour
    expect(fills[fills.length - 1]).toBe(base)
    expect(fills).toContain(leftC)
    expect(fills).toContain(rightC)
    expect(leftC).not.toBe(base) // sides really are darkened
    expect(rightC).not.toBe(base)
  })

  test('per-instance colour override tints the whole cube', () => {
    const { ctx, fills } = recordingCtx()
    drawIsoTileBlock(ctx, center, tileW, tileH, blockH, 1, imgTile, '#22cc88')
    expect(fills[fills.length - 1]).toBe('#22cc88') // top uses the override, not the tile colour
  })

  test('height clamps to at least 1 block', () => {
    const { ctx, fills } = recordingCtx()
    drawIsoTileBlock(ctx, center, tileW, tileH, blockH, 0.4, imgTile)
    expect(fills).toHaveLength(3) // still one cube
  })
})
