import { parseColor, darkenColor, lightenColor, withAlpha, varyIntensity } from '@/engine/colors'

describe('colors — parseColor', () => {
  it('parses 6-digit hex', () => {
    expect(parseColor('#2e8b2e')).toEqual({ r: 46, g: 139, b: 46 })
  })

  it('parses 3-digit shorthand hex', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255 })
  })

  it('parses rgb() and rgba()', () => {
    expect(parseColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30 })
    expect(parseColor('rgba(10, 20, 30, 0.5)')).toEqual({ r: 10, g: 20, b: 30 })
  })

  it('returns null for an unparseable color', () => {
    expect(parseColor('chartreuse')).toBeNull()
  })
})

describe('colors — darken / lighten / alpha', () => {
  it('darkens each channel by the factor', () => {
    expect(darkenColor('#646464', 0.5)).toBe('rgb(50, 50, 50)') // 100 * 0.5
  })

  it('passes an unparseable color through unchanged (fail-safe)', () => {
    expect(darkenColor('transparent', 0.5)).toBe('transparent')
    expect(lightenColor('transparent', 0.5)).toBe('transparent')
    expect(withAlpha('transparent', 0.5)).toBe('transparent')
  })

  it('lightens toward white; full amount yields white', () => {
    expect(lightenColor('#000000', 1)).toBe('rgb(255, 255, 255)')
  })

  it('leaves white unchanged when lightening', () => {
    expect(lightenColor('#ffffff', 0.5)).toBe('rgb(255, 255, 255)')
  })

  it('sets alpha while preserving the channels', () => {
    expect(withAlpha('#2e8b2e', 0.4)).toBe('rgba(46, 139, 46, 0.4)')
  })

  it('clamps darken/lighten to the 0–255 byte range', () => {
    expect(darkenColor('#ffffff', 0)).toBe('rgb(0, 0, 0)')
    expect(lightenColor('#808080', 2)).toBe('rgb(255, 255, 255)')
  })
})

describe('colors — varyIntensity (leaf/flower tone variety)', () => {
  const base = '#646464' // rgb(100, 100, 100)

  it('leaves the color unchanged at the midpoint t=0.5', () => {
    expect(varyIntensity(base, 0.5)).toBe(base)
  })

  it('darkens below 0.5 and lightens above 0.5', () => {
    expect(parseColor(varyIntensity(base, 0))!.r).toBeLessThan(100) // toward black
    expect(parseColor(varyIntensity(base, 1))!.r).toBeGreaterThan(100) // toward white
  })

  it('is deterministic (same color + t → same shade)', () => {
    expect(varyIntensity(base, 0.2)).toBe(varyIntensity(base, 0.2))
  })

  it('is fail-safe: an unparseable color comes back unchanged', () => {
    expect(varyIntensity('not-a-color', 0)).toBe('not-a-color')
  })
})
