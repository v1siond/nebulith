/**
 * SEARCHING A 305-TILE LIBRARY (§5.1 #9, §4.5; fixes §3.5 and §3.6).
 *
 * Measured in the inventory: 305 tiles in one continuous 4-wide scroll with no search, no filter, no
 * recents — terrain alone is 16 rows — and 79 creatures in a 256px popover ordered by nothing. §3.5 also
 * measured that **120 of the 305 labels are raw slugs** (`cliff_face`, `water_deep`, `birch_forest`) sitting
 * next to prettified ones (`Shallow Water`).
 *
 * That last fact decides the matching rule: a user types what they SEE, and half of them see a slug. So the
 * query has to match the pretty title and the slug alike, and `_` must not be a wall between them — typing
 * "deep water" has to find `water_deep`, and typing "water_deep" has to find "Deep Water".
 */
import { filterTiles, matchesTileQuery } from '@/game/editor/tileSearch'
import type { TileDef } from '@/game/artStyle'

const tile = (id: string, label = id, category = 'terrain'): TileDef =>
  ({ id, label, category, styleId: 'emoji', visual: { kind: 'glyph', char: '?' } }) as unknown as TileDef

const CATALOG = [
  tile('water_deep', 'water_deep'),
  tile('water_shallow', 'Shallow Water'),
  tile('grass', 'Grass'),
  tile('cliff_face', 'cliff_face'),
  tile('wall_brick', 'Brick Wall', 'walls'),
]

describe('matchesTileQuery', () => {
  it('matches nothing away — an empty query keeps every tile', () => {
    for (const t of CATALOG) expect(matchesTileQuery(t, '')).toBe(true)
    expect(matchesTileQuery(CATALOG[0], '   ')).toBe(true)
  })

  it('matches the pretty title', () => {
    expect(matchesTileQuery(tile('water_shallow', 'Shallow Water'), 'shallow')).toBe(true)
  })

  it('matches the raw SLUG — 120 of 305 labels are slugs', () => {
    expect(matchesTileQuery(tile('cliff_face', 'cliff_face'), 'cliff')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(matchesTileQuery(tile('grass', 'Grass'), 'GRASS')).toBe(true)
  })

  it('treats "_" and a space as the same separator, both ways', () => {
    expect(matchesTileQuery(tile('water_deep', 'water_deep'), 'water deep')).toBe(true)
    expect(matchesTileQuery(tile('water_shallow', 'Shallow Water'), 'shallow_water')).toBe(true)
  })

  it('finds a tile by its id even when the label was prettified away from it', () => {
    expect(matchesTileQuery(tile('wall_brick', 'Brick Wall', 'walls'), 'wall_brick')).toBe(true)
  })

  it('matches any word of the query, in any order — "water deep" finds "Deep Water"', () => {
    expect(matchesTileQuery(tile('water_deep', 'Deep Water'), 'deep water')).toBe(true)
    expect(matchesTileQuery(tile('water_deep', 'Deep Water'), 'water deep')).toBe(true)
  })

  it('does NOT match an unrelated tile', () => {
    expect(matchesTileQuery(tile('grass', 'Grass'), 'water')).toBe(false)
  })

  it('requires EVERY word to match — "brick wall" must not match a plain wall', () => {
    expect(matchesTileQuery(tile('wall_stone', 'Stone Wall', 'walls'), 'brick wall')).toBe(false)
  })
})

describe('filterTiles', () => {
  it('returns everything for an empty query', () => {
    expect(filterTiles(CATALOG, '')).toHaveLength(CATALOG.length)
  })

  it('narrows to the matches, keeping catalogue order', () => {
    expect(filterTiles(CATALOG, 'water').map(t => t.id)).toEqual(['water_deep', 'water_shallow'])
  })

  it('returns an empty list rather than everything when nothing matches', () => {
    expect(filterTiles(CATALOG, 'dragon')).toEqual([])
  })

  it('never mutates the catalogue it was given', () => {
    const input = [...CATALOG]
    filterTiles(input, 'water')
    expect(input).toEqual(CATALOG)
  })
})
