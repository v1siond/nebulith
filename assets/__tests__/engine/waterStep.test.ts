/**
 * WHAT WATER DOES WHEN YOU STAND IN IT.
 *
 * Alexander, 2026-09-13, describing what a puddle should be: *"we should see character steps do an effect in
 * the water, we should also see how the character shadow distorts with the water, regular water physics"*.
 *
 * The catalog has carried `decor_ripple` frames for a while with ZERO draw sites, which is the shape of gap
 * this project keeps finding: data nobody reads. This draws it instead, from the two things a figure in
 * water actually does to the surface, and the tests assert the DRAWING, through a recording context, rather
 * than trusting that a function was called.
 */
import { drawGroundShadow, drawWaterStep } from '@/engine/render/shared'

/** A canvas stand-in that records the calls the two draws make. */
function recorder() {
  const calls: string[] = []
  const fills: string[] = []
  const strokes: string[] = []
  let points = 0
  const ctx = {
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    beginPath: () => calls.push('beginPath'),
    closePath: () => calls.push('closePath'),
    moveTo: () => { points++ },
    lineTo: () => { points++ },
    ellipse: () => calls.push('ellipse'),
    fill: () => fills.push(String((ctx as unknown as { fillStyle: string }).fillStyle)),
    stroke: () => strokes.push(String((ctx as unknown as { strokeStyle: string }).strokeStyle)),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, fills, strokes, pts: () => points }
}

describe('a shadow on water is not a clean ellipse', () => {
  it('on land it is one ellipse, exactly as before', () => {
    const r = recorder()
    drawGroundShadow(r.ctx, 100, 50, 12)
    expect(r.calls.filter(c => c === 'ellipse')).toHaveLength(1)
    expect(r.pts()).toBe(0) // no wobbled path
  })

  it('in water it is a wavering outline instead, not an ellipse at all', () => {
    const r = recorder()
    drawGroundShadow(r.ctx, 100, 50, 12, 1000)
    expect(r.calls.filter(c => c === 'ellipse')).toHaveLength(0)
    expect(r.pts()).toBeGreaterThan(10) // a real path, many segments
    expect(r.fills).toHaveLength(1)
  })

  it('and it MOVES: the same shadow at two instants is a different outline', () => {
    // A distortion that did not change with time would just be a lumpy ellipse painted on the water.
    const shape = (t: number) => {
      const pts: Array<[number, number]> = []
      const ctx = {
        save() {}, restore() {}, beginPath() {}, closePath() {}, fill() {},
        moveTo: (x: number, y: number) => pts.push([x, y]),
        lineTo: (x: number, y: number) => pts.push([x, y]),
        ellipse() {}, fillStyle: '',
      } as unknown as CanvasRenderingContext2D
      drawGroundShadow(ctx, 100, 50, 12, t)
      return JSON.stringify(pts)
    }
    expect(shape(0)).not.toBe(shape(500))
  })
})

describe('a step in water spreads rings', () => {
  it('draws rings, and they are strokes rather than a filled blob', () => {
    const r = recorder()
    drawWaterStep(r.ctx, 100, 50, 12, 0)
    expect(r.strokes.length).toBeGreaterThan(0)
    expect(r.fills).toHaveLength(0)
  })

  it('the rings GROW and FADE, so the surface keeps settling', () => {
    // The FIRST ring drawn, followed across its own cycle: wider later, and dimmer as it widens. A ripple
    // that did not do both would be a static halo at the feet.
    const firstRing = (t: number) => {
      let radius = 0
      let alpha = 0
      let seen = false
      const ctx = {
        save() {}, restore() {}, beginPath() {}, stroke() {}, lineWidth: 0,
        ellipse: (_x: number, _y: number, rx: number) => { if (!seen) { radius = rx; seen = true } },
        set strokeStyle(v: string) { if (!seen) alpha = Number(/rgba\([^)]*,\s*([\d.]+)\)/.exec(v)?.[1] ?? 0) },
        get strokeStyle() { return '' },
      } as unknown as CanvasRenderingContext2D
      drawWaterStep(ctx, 100, 50, 12, t)
      return { radius, alpha }
    }
    const early = firstRing(0)
    const late = firstRing(550)
    expect(late.radius).toBeGreaterThan(early.radius) // it spreads
    expect(late.alpha).toBeLessThan(early.alpha)      // and thins as it goes
  })

  it('two rings out of phase, so a standing figure never stops disturbing the water', () => {
    const r = recorder()
    drawWaterStep(r.ctx, 100, 50, 12, 100)
    expect(r.strokes.length).toBe(2)
  })
})
