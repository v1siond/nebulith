/**
 * ONE ENTRY PER BUILDING TYPE — the collapse behind Alexander's *"why having 3 size house when we can have
 * 1 house button and allow user to make a house as big or as small as he wants???"*
 */
import { bakedWidthOfKind, collapseSizedBuildings, isSizable, labelForType, typeOfKind } from '@/engine/sizedBuildings'
import type { BuildingType } from '@/lib/buildingSizes'

const TYPES: BuildingType[] = [
  { key: 'house', default: { w: 4, h: 4 } },
  { key: 'big_house', default: { w: 6, h: 4 } },
  { key: 'store', default: { w: 5, h: 4 } },
]

const item = (kind: string, w = 5, h = 4) => ({ kind, label: kind, footprint: { w, h }, category: 'buildings' as const })
const section = (...kinds: string[]) => [{ category: 'buildings' as const, label: 'Buildings', items: kinds.map(k => item(k)) }]

describe('the size variants fold into one entry', () => {
  it('turns three houses into one House', () => {
    const [folded] = collapseSizedBuildings(section('house_3', 'house_4', 'house_5'), TYPES)
    expect(folded.items).toHaveLength(1)
    expect(folded.items[0].kind).toBe('house')
    expect(folded.items[0].label).toBe('House')
  })

  it('offers the type\'s own authored footprint as the default', () => {
    const [folded] = collapseSizedBuildings(section('house_3', 'house_4'), TYPES)
    const entry = folded.items[0]
    expect(isSizable(entry) && entry.defaultSize).toEqual({ w: 4, h: 4 })
  })

  it('remembers which widths were baked, for reference', () => {
    const [folded] = collapseSizedBuildings(section('house_5', 'house_3', 'house_4'), TYPES)
    const entry = folded.items[0]
    expect(isSizable(entry) && entry.bakedSizes).toEqual([3, 4, 5])
  })

  it('keeps each type separate — big_house is not a house', () => {
    const [folded] = collapseSizedBuildings(section('house_4', 'big_house_6'), TYPES)
    expect(folded.items.map(i => i.kind)).toEqual(['house', 'big_house'])
    expect(folded.items[1].label).toBe('Big house')
  })
})

describe('an object with no parametric recipe is left alone', () => {
  it('does not fold a composition the backend cannot compose', () => {
    const [folded] = collapseSizedBuildings(section('house_4', 'stone_building'), TYPES)
    expect(folded.items.map(i => i.kind)).toEqual(['house', 'stone_building'])
    // …and it carries no size control, because claiming one the backend cannot honour would be a lie.
    expect(isSizable(folded.items[1])).toBe(false)
  })

  it('changes nothing at all when the backend lists no types (it has not answered yet)', () => {
    const input = section('house_3', 'house_4')
    expect(collapseSizedBuildings(input, [])).toBe(input)
  })

  it('leaves the trees and props sections untouched', () => {
    const sections = [{ category: 'nature' as const, label: 'Nature', items: [item('tree_small', 1, 1)] }]
    const [out] = collapseSizedBuildings(sections, TYPES)
    expect(out.items.map(i => i.kind)).toEqual(['tree_small'])
  })
})

describe('reading a kind', () => {
  it.each([
    ['house_4', 'house', 4],
    ['big_house_6', 'big_house', 6],
    ['castle_12', 'castle', 12],
    ['stone_building', 'stone_building', undefined],
    ['fountain', 'fountain', undefined],
  ])('%s → type %s, baked width %s', (kind, type, width) => {
    expect(typeOfKind(kind)).toBe(type)
    expect(bakedWidthOfKind(kind)).toBe(width)
  })

  it('names a type for a person, not as a slug', () => {
    expect(labelForType('big_house')).toBe('Big house')
    expect(labelForType('cathedral')).toBe('Cathedral')
  })
})
