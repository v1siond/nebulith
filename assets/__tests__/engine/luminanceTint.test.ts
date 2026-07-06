import { luminanceTint } from '@/engine/colors'

describe('luminanceTint — recolour keeping the sprite shading, works on white', () => {
  const red = { r: 255, g: 0, b: 0 }

  test('a WHITE sprite pixel → the full tint colour (the old color-blend left it white)', () => {
    expect(luminanceTint(255, 255, 255, red)).toEqual({ r: 255, g: 0, b: 0 })
  })

  test('a BLACK sprite pixel → black (shading preserved at the dark end)', () => {
    expect(luminanceTint(0, 0, 0, red)).toEqual({ r: 0, g: 0, b: 0 })
  })

  test('a MID-grey pixel → a mid tint (darker than full, brighter than black)', () => {
    const o = luminanceTint(128, 128, 128, red)
    expect(o.g).toBe(0)
    expect(o.b).toBe(0)
    expect(o.r).toBeGreaterThan(120)
    expect(o.r).toBeLessThan(210)
  })

  test('the source HUE is discarded — a bright-green pixel also becomes the tint hue', () => {
    const o = luminanceTint(0, 255, 0, red)
    expect(o.g).toBe(0)
    expect(o.b).toBe(0)
    expect(o.r).toBeGreaterThan(150)
  })
})
