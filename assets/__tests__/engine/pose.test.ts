import { resolvePose, applyPose, type TilePose } from '@/engine/tileset/pose'
import { drawPoseGlyph } from '@/engine/render/shared'

describe('resolvePose — deviations-only', () => {
  test('absent pose → identity', () => {
    expect(resolvePose(null)).toEqual({ dx: 0, dy: 0, rot: 0, flip: false, scale: 1 })
  })
  test('fills only the missing fields', () => {
    expect(resolvePose({ rot: 1.5 })).toEqual({ dx: 0, dy: 0, rot: 1.5, flip: false, scale: 1 })
  })
})

// A recording context: applyPose only touches scale/rotate/translate. Order + values are the contract.
function recCtx() {
  const calls: string[] = []
  const ctx = {
    scale: (x: number, y: number) => calls.push(`scale(${x},${y})`),
    rotate: (a: number) => calls.push(`rotate(${a})`),
    translate: (x: number, y: number) => calls.push(`translate(${x},${y})`),
  } as unknown as CanvasRenderingContext2D
  return { ctx, calls }
}

describe('applyPose — mirror → rotate → offset → scale, no-op when identity', () => {
  test('identity pose emits nothing (unposed tile renders unchanged)', () => {
    const { ctx, calls } = recCtx()
    applyPose(ctx, null, 1, 24)
    expect(calls).toEqual([])
  })
  test('left-facing mirrors', () => {
    const { ctx, calls } = recCtx()
    applyPose(ctx, {}, -1, 24)
    expect(calls).toEqual(['scale(-1,1)'])
  })
  test('flip and left-facing cancel (no mirror)', () => {
    const { ctx, calls } = recCtx()
    applyPose(ctx, { flip: true } as TilePose, -1, 24)
    expect(calls).toEqual([])
  })
  test('flip alone (right-facing) mirrors', () => {
    const { ctx, calls } = recCtx()
    applyPose(ctx, { flip: true } as TilePose, 1, 24)
    expect(calls).toEqual(['scale(-1,1)'])
  })
  test('full pose: mirror, then rot, then offset×unit, then scale — in order', () => {
    const { ctx, calls } = recCtx()
    applyPose(ctx, { flip: true, rot: 3.14, dx: 0.5, dy: -0.25, scale: 1.1 }, 1, 24)
    expect(calls).toEqual(['scale(-1,1)', 'rotate(3.14)', 'translate(12,-6)', 'scale(1.1,1.1)'])
  })
})

// A recording ctx that also stubs the text setters + fillText so drawPoseGlyph's draw op is observable.
function drawCtx() {
  const calls: string[] = []
  const ctx = {
    save() {}, restore() {},
    scale: (x: number, y: number) => calls.push(`scale(${x},${y})`),
    rotate: (a: number) => calls.push(`rotate(${a})`),
    translate: (x: number, y: number) => calls.push(`translate(${x},${y})`),
    fillText: (t: string) => calls.push(`text(${t})`),
    set font(_v: string) {}, set textAlign(_v: string) {}, set textBaseline(_v: string) {},
  } as unknown as CanvasRenderingContext2D
  return { ctx, calls }
}

describe('drawPoseGlyph — applies the pose then draws the glyph once at the origin', () => {
  test('rot-only pose: rotate then a single fillText (no stray transforms)', () => {
    const { ctx, calls } = drawCtx()
    drawPoseGlyph(ctx, '🗡️', { rot: 3.14 }, 1, 24)
    expect(calls).toEqual(['rotate(3.14)', 'text(🗡️)'])
  })
  test('identity pose: just the fillText (unposed weapon renders unchanged)', () => {
    const { ctx, calls } = drawCtx()
    drawPoseGlyph(ctx, '🛡️', undefined, 1, 24)
    expect(calls).toEqual(['text(🛡️)'])
  })
})
