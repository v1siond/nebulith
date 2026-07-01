/**
 * #91 Stage 3 — male/female entity variants. `genderize(char, variant)` maps a PERSON glyph to its
 * gendered figure (data-only); a monster / terrain / variant-less glyph passes through unchanged.
 */
import { genderize } from '@/game/artStyle'

describe('genderize', () => {
  test('no variant → the glyph unchanged', () => {
    expect(genderize('🧍')).toBe('🧍')
    expect(genderize('🚶', undefined)).toBe('🚶')
  })
  test('person glyphs swap to the gendered figure', () => {
    expect(genderize('🧍', 'male')).toBe('🧍‍♂️')
    expect(genderize('🧍', 'female')).toBe('🧍‍♀️')
    expect(genderize('🚶', 'male')).toBe('🚶‍♂️')
    expect(genderize('🏃', 'female')).toBe('🏃‍♀️')
    expect(genderize('🧑', 'male')).toBe('👨')
    expect(genderize('🧑', 'female')).toBe('👩')
  })
  test('monsters / squares / variant-less glyphs pass through unchanged', () => {
    expect(genderize('👾', 'male')).toBe('👾')
    expect(genderize('🟩', 'female')).toBe('🟩')
    expect(genderize('🐉', 'male')).toBe('🐉')
  })
})
