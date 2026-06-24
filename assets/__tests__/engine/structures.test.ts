import { STRUCTURES, structureById, structureGroundRow } from '@/engine/structures'

describe('structures — single-anchor layered house sprites', () => {
  it('exposes the expected set of structures', () => {
    expect(STRUCTURES.map(s => s.id)).toEqual(['cabin', 'house', 'tower'])
  })

  it('structureById finds a structure or returns undefined', () => {
    expect(structureById('house')?.name).toBe('House')
    expect(structureById('castle')).toBeUndefined()
  })

  it('every structure is well-formed (rows, name, color, sane height)', () => {
    for (const s of STRUCTURES) {
      expect(s.name.length).toBeGreaterThan(0)
      expect(s.color).toMatch(/^#[0-9a-f]{6}$/i)
      expect(s.rows.length).toBeGreaterThanOrEqual(2) // multi-row = layered, not flat
      expect(s.rows.every(r => r.length > 0)).toBe(true)
      // height should at least cover the rows so the sprite isn't clipped into the ground
      expect(s.heightTiles).toBeGreaterThanOrEqual(s.rows.length - 1)
    }
  })

  it('structureGroundRow returns the bottom row (door/base)', () => {
    expect(structureGroundRow(structureById('cabin')!)).toBe('|___|')
    expect(structureGroundRow(structureById('tower')!)).toBe('|+|')
  })
})
