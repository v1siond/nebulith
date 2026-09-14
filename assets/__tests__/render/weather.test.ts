/**
 * WEATHER ON THE MAP.
 *
 * It used to be a screen effect over the whole canvas. These pin the two halves of his note: nothing falls outside
 * the map's drawn floor, and a drop ends its fall ON that floor, leaving a ripple there.
 */
import { drawWeather, nextWeather, onSurface, surfaceArea, WEATHER, WEATHER_LABEL, WEATHER_ORDER, type MapSurface } from '@/engine/render/weather'

function recorder() {
  const calls: Array<[string, number[]]> = []
  const ctx = {
    save: jest.fn(), restore: jest.fn(), clip: jest.fn(), closePath: jest.fn(),
    beginPath: jest.fn(() => calls.push(['beginPath', []])),
    stroke: jest.fn(() => calls.push(['stroke', []])),
    fillRect: jest.fn((...a: number[]) => calls.push(['fillRect', a])),
    moveTo: jest.fn((...a: number[]) => calls.push(['moveTo', a])),
    lineTo: jest.fn((...a: number[]) => calls.push(['lineTo', a])),
    fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt',
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, raw: ctx }
}

/** The map filling the whole canvas, as the top view draws it. */
const rect = (w: number, h: number): MapSurface => ({ corners: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }] })
/** The map as ISO draws it: a diamond, with a lot of canvas outside it. */
const diamond = (w: number, h: number): MapSurface =>
  ({ corners: [{ x: w / 2, y: 0 }, { x: w, y: h / 2 }, { x: w / 2, y: h }, { x: 0, y: h / 2 }] })

/** The strokes of each path in order: [0] is the falling streaks, [1] the ripples on the floor. */
function paths(calls: Array<[string, number[]]>): number[][][] {
  const out: number[][][] = []
  let current: number[][] | null = null
  for (const [kind, args] of calls) {
    if (kind === 'beginPath') { current = []; continue }
    if (kind === 'stroke') { if (current) out.push(current); current = null; continue }
    if (current && (kind === 'moveTo' || kind === 'lineTo')) current.push(args)
  }
  return out
}
const heads = (calls: Array<[string, number[]]>) => paths(calls)[0] ?? []
const ripples = (calls: Array<[string, number[]]>) => paths(calls)[1] ?? []

describe('rain falls on the map, not on the screen', () => {
  it('clear draws nothing at all', () => {
    const { ctx, raw } = recorder()
    drawWeather(ctx, 800, 600, 'clear', 1234, rect(800, 600))
    expect(raw.save).not.toHaveBeenCalled()
    expect(raw.moveTo).not.toHaveBeenCalled()
  })

  it('everything is clipped to the map before a single drop is drawn', () => {
    const { ctx, raw, calls } = recorder()
    drawWeather(ctx, 800, 600, 'rain', 1000, rect(800, 600))
    expect(raw.clip).toHaveBeenCalledTimes(1)
    // the veil comes after the clip, so the grey around the map is left alone
    expect(calls.find(([k]) => k === 'fillRect')).toEqual(['fillRect', [0, 0, 800, 600]])
    expect(raw.clip.mock.invocationCallOrder[0]).toBeLessThan(raw.fillRect.mock.invocationCallOrder[0])
  })

  it('the amount of rain follows the MAP\'s drawn area, not the canvas', () => {
    const full = recorder()
    const half = recorder()
    drawWeather(full.ctx, 800, 600, 'rain', 1000, rect(800, 600))
    drawWeather(half.ctx, 800, 600, 'rain', 1000, rect(400, 300))
    const perArea = (area: number) => Math.round((area / 10000) * WEATHER.rain.density)
    // a falling drop is two points (its head and its tail), a ripple is three, and every particle is one or
    // the other: either it is still falling or it has landed.
    const particles = (calls: Array<[string, number[]]>) => heads(calls).length / 2 + ripples(calls).length / 3
    expect(particles(full.calls)).toBe(perArea(800 * 600))
    expect(particles(half.calls)).toBe(perArea(400 * 300))
  })

  it('an iso diamond lands its rain inside the diamond, never in the bare corners', () => {
    const w = 800
    const h = 600
    const inside = (x: number, y: number) => Math.abs((x - w / 2) / (w / 2)) + Math.abs((y - h / 2) / (h / 2))
    for (const t of [1000, 2500, 4200, 7700]) {
      const r = recorder()
      drawWeather(r.ctx, w, h, 'rain', t, diamond(w, h))
      const floor = ripples(r.calls)
      expect(floor.length).toBeGreaterThan(0)
      // a ripple is three points around the landing spot; the middle one is lifted, so test the outer two
      for (const [x, y] of floor) expect(inside(x, y)).toBeLessThanOrEqual(1.02)
    }
  })
})

describe('a drop lands on the floor', () => {
  it('leaves a ripple, and never draws through the floor it landed on', () => {
    const surface = rect(800, 600)
    let rippled = 0
    for (const t of [500, 1200, 3300, 5000, 9100]) {
      const r = recorder()
      drawWeather(r.ctx, 800, 600, 'rain', t, surface)
      rippled += ripples(r.calls).length
      // every streak runs downward and stops at or above its landing row
      const path = heads(r.calls)
      for (const [, y] of path) expect(y).toBeLessThanOrEqual(600)
    }
    expect(rippled).toBeGreaterThan(0)
  })

  it('the same moment draws the same rain, and a later one has moved it', () => {
    const s = rect(800, 600)
    const a = recorder(); const b = recorder(); const later = recorder()
    drawWeather(a.ctx, 800, 600, 'rain', 5000, s)
    drawWeather(b.ctx, 800, 600, 'rain', 5000, s)
    drawWeather(later.ctx, 800, 600, 'rain', 5050, s)
    expect(heads(a.calls)).toEqual(heads(b.calls))
    expect(heads(later.calls)).not.toEqual(heads(a.calls))
  })
})

describe('the ground plane maths', () => {
  it('a corner is a corner, and the middle is the middle', () => {
    const s = diamond(800, 600)
    expect(onSurface(s, 0, 0)).toEqual({ x: 400, y: 0 })
    expect(onSurface(s, 1, 1)).toEqual({ x: 400, y: 600 })
    expect(onSurface(s, 0.5, 0.5)).toEqual({ x: 400, y: 300 })
  })

  it('the area is the area, rectangle or diamond', () => {
    expect(surfaceArea(rect(800, 600))).toBe(800 * 600)
    expect(surfaceArea(diamond(800, 600))).toBe((800 * 600) / 2)
  })
})

describe('the weathers are a table, so snow and a sandstorm are rows', () => {
  it('every weather but clear has an effect, and every one has a label', () => {
    for (const id of WEATHER_ORDER) {
      expect(WEATHER_LABEL[id]).toBeTruthy()
      if (id !== 'clear') expect(WEATHER[id as keyof typeof WEATHER]).toBeDefined()
    }
  })

  it('every effect says how far it falls, so a particle has a floor to reach', () => {
    for (const id of WEATHER_ORDER) {
      if (id === 'clear') continue
      expect(WEATHER[id as keyof typeof WEATHER].fall).toBeGreaterThan(0)
    }
  })

  it('the view bar steps clear, rain, and back to clear', () => {
    expect(nextWeather('clear')).toBe('rain')
    expect(nextWeather('rain')).toBe('clear')
  })
})
