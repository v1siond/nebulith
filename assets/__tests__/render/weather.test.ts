/**
 * WEATHER over the finished frame. Alexander, 2026-09-11: *"please add a rain status, which would similar to the
 * night mode, in the sense that we activate it and rain shows up, we'll also implement other clima effects, like
 * snowing, sand storm, etc. but rains it's the basic foundation for all"*.
 */
import { drawWeather, nextWeather, WEATHER, WEATHER_LABEL, WEATHER_ORDER } from '@/engine/render/weather'

function recorder() {
  const calls: Array<[string, number[]]> = []
  const ctx = {
    save: jest.fn(), restore: jest.fn(), beginPath: jest.fn(), stroke: jest.fn(),
    fillRect: jest.fn((...a: number[]) => calls.push(['fillRect', a])),
    moveTo: jest.fn((...a: number[]) => calls.push(['moveTo', a])),
    lineTo: jest.fn((...a: number[]) => calls.push(['lineTo', a])),
    fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt',
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, raw: ctx }
}
const drops = (calls: Array<[string, number[]]>) => calls.filter(([k]) => k === 'moveTo').map(([, a]) => a)

describe('drawWeather', () => {
  it('clear draws nothing at all', () => {
    const { ctx, raw } = recorder()
    drawWeather(ctx, 800, 600, 'clear', 1234)
    expect(raw.save).not.toHaveBeenCalled()
    expect(raw.moveTo).not.toHaveBeenCalled()
  })

  it('rain dims the frame and lays drops in proportion to the screen', () => {
    const small = recorder()
    const big = recorder()
    drawWeather(small.ctx, 400, 300, 'rain', 1000)
    drawWeather(big.ctx, 1600, 900, 'rain', 1000)
    expect(small.calls[0]).toEqual(['fillRect', [0, 0, 400, 300]]) // the veil first, under the drops
    expect(drops(small.calls)).toHaveLength(Math.round((400 * 300 / 10000) * WEATHER.rain.density))
    expect(drops(big.calls)).toHaveLength(Math.round((1600 * 900 / 10000) * WEATHER.rain.density))
    expect(small.raw.stroke).toHaveBeenCalledTimes(1) // one path for every drop, not one stroke each
  })

  it('the same moment draws the same rain, and a later one has moved it', () => {
    const a = recorder(); const b = recorder(); const later = recorder()
    drawWeather(a.ctx, 800, 600, 'rain', 5000)
    drawWeather(b.ctx, 800, 600, 'rain', 5000)
    drawWeather(later.ctx, 800, 600, 'rain', 5050)
    expect(drops(a.calls)).toEqual(drops(b.calls))
    expect(drops(later.calls)).not.toEqual(drops(a.calls))
  })

  it('every drop starts on or near the screen, never somewhere it could not be seen', () => {
    const r = recorder()
    drawWeather(r.ctx, 800, 600, 'rain', 987654)
    const fx = WEATHER.rain
    for (const [x, y] of drops(r.calls)) {
      expect(y).toBeGreaterThanOrEqual(-fx.length)
      expect(y).toBeLessThanOrEqual(600)
      expect(x).toBeGreaterThanOrEqual(-(600 * fx.slant + fx.length))
      expect(x).toBeLessThanOrEqual(800)
    }
  })
})

describe('the weathers are a table, so snow and a sandstorm are rows', () => {
  it('every weather but clear has an effect, and every one has a label', () => {
    for (const id of WEATHER_ORDER) {
      expect(WEATHER_LABEL[id]).toBeTruthy()
      if (id !== 'clear') expect(WEATHER[id as keyof typeof WEATHER]).toBeDefined()
    }
  })

  it('the view bar steps clear, rain, and back to clear', () => {
    expect(nextWeather('clear')).toBe('rain')
    expect(nextWeather('rain')).toBe('clear')
  })
})
