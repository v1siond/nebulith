import '@/__tests__/helpers/installTilesetSeed' // the generator reads decor/feature colours from the loaded backend tileset
import { generateStage } from '@/engine/stageGenerator'
import {
  TEMPLE_PALETTES,
  CAVE_PALETTES,
  PROP_ART,
  ROCK_SHADES,
  ZONE_FLOWERS,
  type ZoneId,
} from '@/engine/zones'

// Compliance item B: the scattered colour/prop tables the generator used to bake inline now live in
// zones.ts as the SINGLE source of truth. These tests pin the LINKAGE — every generated colour/glyph
// must trace back to that zone data, so the generator can never drift back to inline literals.

const colorsOf = (props: { type: string; color: string }[], type: string): Set<string> =>
  new Set(props.filter(p => p.color !== undefined && p.type === type).map(p => p.color))

const charsOf = (props: { type: string; char: string }[], type: string): Set<string> =>
  new Set(props.filter(p => p.type === type).map(p => p.char))

describe('generator resolves palette + prop colours from zone data (zones.ts single source)', () => {
  it('temple walls / pillars / torches / altar all read from TEMPLE_PALETTES[zone]', () => {
    const zone: ZoneId = 'summer'
    const pal = TEMPLE_PALETTES[zone]
    const stage = generateStage({ zone, variant: 'temple', cols: 44, rows: 34 })

    // Every seasonal wall tone is one of the zone's wall shades — nothing off-palette.
    const walls = colorsOf(stage.props, 'temple_wall')
    expect(walls.size).toBeGreaterThan(0)
    walls.forEach(c => expect(pal.wall).toContain(c))

    // Colonnade pillars wear the zone's pillar tint (NOT the season-neutral PROP_ART fallback).
    const pillars = colorsOf(stage.props, 'pillar')
    expect(pillars.size).toBeGreaterThan(0)
    pillars.forEach(c => expect(c).toBe(pal.pillar))
    expect(pal.pillar).not.toBe(PROP_ART.pillar.color) // proves the zone tint overrode the fallback

    // Wall torches + the boss altar glow read straight from the zone palette.
    colorsOf(stage.props, 'torch').forEach(c => expect(c).toBe(pal.torch))
    colorsOf(stage.props, 'altar').forEach(c => expect(c).toBe(pal.altar))

    // Structural glyphs come from PROP_ART (the shared prop-art table), not inline chars.
    charsOf(stage.props, 'pillar').forEach(ch => expect(ch).toBe(PROP_ART.pillar.char))
    charsOf(stage.props, 'altar').forEach(ch => expect(ch).toBe(PROP_ART.altar.char))
    charsOf(stage.props, 'torch').forEach(ch => expect(ch).toBe(PROP_ART.torch.char))
  })

  it('cave rock walls read from CAVE_PALETTES[zone].wall', () => {
    const zone: ZoneId = 'summer'
    const pal = CAVE_PALETTES[zone]
    const stage = generateStage({ zone, variant: 'cave', cols: 44, rows: 32 })
    const rocks = colorsOf(stage.props, 'rock')
    expect(rocks.size).toBeGreaterThan(0)
    rocks.forEach(c => expect(pal.wall).toContain(c))
  })

  it('the season-neutral arena reads prop colours from PROP_ART + ROCK_SHADES', () => {
    const stage = generateStage({ zone: 'summer', variant: 'boss-stage', cols: 40, rows: 40 })

    // No zone tint is passed in the arena, so pillars/braziers fall back to the PROP_ART palette.
    colorsOf(stage.props, 'pillar').forEach(c => expect(c).toBe(PROP_ART.pillar.color))
    colorsOf(stage.props, 'brazier').forEach(c => expect(c).toBe(PROP_ART.brazier.color))
    charsOf(stage.props, 'brazier').forEach(ch => expect(ch).toBe(PROP_ART.brazier.char))

    // Arena walls tint from the shared ROCK_SHADES table.
    const rocks = colorsOf(stage.props, 'rock')
    expect(rocks.size).toBeGreaterThan(0)
    rocks.forEach(c => expect(ROCK_SHADES).toContain(c))
  })

  it('forest flowers use the zone bloom glyphs from ZONE_FLOWERS[zone]', () => {
    const springGlyphs = new Set((ZONE_FLOWERS.spring ?? []).map(f => f.char))
    // A few runs so a random-scatter clearing is guaranteed at least one bloom.
    const flowerChars = [0, 1, 2, 3].flatMap(() =>
      generateStage({ zone: 'spring', variant: 'forest', cols: 40, rows: 40 }).props.filter(p => p.type === 'flower').map(p => p.char),
    )
    expect(flowerChars.length).toBeGreaterThan(0)
    flowerChars.forEach(ch => expect(springGlyphs.has(ch)).toBe(true))
  })
})
