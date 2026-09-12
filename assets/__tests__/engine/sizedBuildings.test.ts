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
    expect(folded.items[0].kind).toBe('house')
    expect(folded.items[0].label).toBe('House')
    expect(folded.items.filter(i => i.kind === 'house')).toHaveLength(1)
  })

  it('folds a size the backend composed ON DEMAND into the same entry', () => {
    // Arming a building composes `house@6x4`. Left unfolded it turned up as its own row in the palette.
    const [folded] = collapseSizedBuildings(section('house_4', 'house@6x4'), TYPES)
    expect(folded.items.filter(i => i.kind === 'house')).toHaveLength(1)
    expect(folded.items.map(i => i.kind)).not.toContain('house@6x4')
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

  it("keeps each type separate, big_house is not a house", () => {
    const [folded] = collapseSizedBuildings(section('house_4', 'big_house_6'), TYPES)
    expect(folded.items.slice(0, 2).map(i => i.kind)).toEqual(['house', 'big_house'])
    expect(folded.items[1].label).toBe('Big house')
  })
})

/**
 * EVERY TYPE THE BACKEND CAN BUILD gets a row, seeded or not. Alexander, 2026-09-11: *"YOU ADDED SKYCRAPPERS TO
 * THE GENERATOR AND DIDN'T ADDED TO THE EGULAR OBJECTS"*, and on the fix I tried first, seeding a size for each:
 * *"THIS IS DEPRECATED, houses size is built on demand"*.
 *
 * This used to fold only what the seeded compositions contained, so a type nobody had seeded was invisible.
 */
describe('a type with no seeded size still gets a row', () => {
  const withTower: BuildingType[] = [...TYPES, { key: 'tower', default: { w: 4, h: 4 } }]

  it('offers the tower even though nothing seeded one', () => {
    const [folded] = collapseSizedBuildings(section('house_4'), withTower)
    const kinds = folded.items.map(i => i.kind)
    expect(kinds).toContain('tower')
    expect(kinds).toContain('store') // and every other type the backend lists
  })

  it('gives it the type\'s own default footprint and a size control', () => {
    const [folded] = collapseSizedBuildings(section('house_4'), withTower)
    const tower = folded.items.find(i => i.kind === 'tower')!
    expect(tower.footprint).toEqual({ w: 4, h: 4 })
    expect(isSizable(tower)).toBe(true)
    expect(isSizable(tower) && tower.bakedSizes).toEqual([]) // nothing was ever baked for it
  })

  it('draws from the COMPOSED default, which is what the page installs', () => {
    const [folded] = collapseSizedBuildings(section('house_4'), withTower)
    const tower = folded.items.find(i => i.kind === 'tower')!
    expect(isSizable(tower) && tower.previewKind).toBe('tower@4x4')
  })

  it('adds a buildings section when the catalog has none at all', () => {
    const nature = [{ category: 'nature' as const, label: 'Nature', items: [item('tree_small', 1, 1)] }]
    const out = collapseSizedBuildings(nature, withTower)
    expect(out.map(s => s.category)).toEqual(['buildings', 'nature'])
    expect(out[0].items.map(i => i.kind)).toEqual(['house', 'big_house', 'store', 'tower'])
  })
})

describe('an object with no parametric recipe is left alone', () => {
  it('does not fold a composition the backend cannot compose', () => {
    const [folded] = collapseSizedBuildings(section('house_4', 'stone_building'), TYPES)
    expect(folded.items.slice(0, 2).map(i => i.kind)).toEqual(['house', 'stone_building'])
    // …and it carries no size control, because claiming one the backend cannot honour would be a lie.
    expect(isSizable(folded.items[1])).toBe(false)
  })

  it('changes nothing at all when the backend lists no types (it has not answered yet)', () => {
    const input = section('house_3', 'house_4')
    expect(collapseSizedBuildings(input, [])).toBe(input)
  })

  it('leaves the trees and props sections untouched', () => {
    const sections = [{ category: 'nature' as const, label: 'Nature', items: [item('tree_small', 1, 1)] }]
    const out = collapseSizedBuildings(sections, TYPES)
    const nature = out.find(s => s.category === 'nature')!
    expect(nature.items.map(i => i.kind)).toEqual(['tree_small'])
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
