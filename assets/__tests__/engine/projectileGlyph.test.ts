import { drawProjectileGlyph } from '@/engine/render/shared'

// A minimal recording context: drawProjectileGlyph only needs save/restore/translate/rotate/fillText.
// We assert the ROTATION angle it applies matches the screen-space travel vector (from → to), which is
// exactly what makes an arrow follow the shot instead of always pointing right (the "arrows backwards" bug).
function recordingCtx() {
  const calls = { rotate: [] as number[], text: [] as Array<[string, number, number]>, translate: [] as Array<[number, number]> }
  const ctx = {
    save() {},
    restore() {},
    translate(x: number, y: number) { calls.translate.push([x, y]) },
    rotate(a: number) { calls.rotate.push(a) },
    fillText(t: string, x: number, y: number) { calls.text.push([t, x, y]) },
  } as unknown as CanvasRenderingContext2D
  return { ctx, calls }
}

describe('drawProjectileGlyph — the arrow rotates to follow its travel vector', () => {
  test('rightward shot → angle 0 (native aim, unchanged)', () => {
    const { ctx, calls } = recordingCtx()
    drawProjectileGlyph(ctx, '➤', 50, 50, /*from*/ 0, 0, /*to*/ 10, 0)
    expect(calls.rotate[0]).toBeCloseTo(0)
  })

  test('leftward shot → angle π, so it no longer points right/backwards', () => {
    const { ctx, calls } = recordingCtx()
    drawProjectileGlyph(ctx, '➤', 50, 50, 10, 0, 0, 0)
    expect(Math.abs(calls.rotate[0])).toBeCloseTo(Math.PI)
  })

  test('downward shot → angle +π/2', () => {
    const { ctx, calls } = recordingCtx()
    drawProjectileGlyph(ctx, '➤', 50, 50, 0, 0, 0, 10)
    expect(calls.rotate[0]).toBeCloseTo(Math.PI / 2)
  })

  test('diagonal down-right → angle +π/4, drawn once at the rotated origin', () => {
    const { ctx, calls } = recordingCtx()
    drawProjectileGlyph(ctx, '➤', 120, 80, 0, 0, 10, 10)
    expect(calls.rotate[0]).toBeCloseTo(Math.PI / 4)
    expect(calls.translate[0]).toEqual([120, 80]) // translate to the draw point first
    expect(calls.text).toEqual([['➤', 0, 0]]) // then draw ONCE at the rotated origin
  })
})
