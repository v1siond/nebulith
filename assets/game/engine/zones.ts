/**
 * SEASON palettes for Nebulith stages.
 *
 * A "zone" is now a SEASON — spring (default), summer, autumn, winter — driving the
 * stage's ground + the seasonal tint of trees/nature (see cellTileset.ts). The type
 * is still named `ZoneId` (the generator/editor speak "zone"); the values are seasons.
 */

export type ZoneId = 'spring' | 'summer' | 'autumn' | 'winter'

export const DEFAULT_ZONE: ZoneId = 'spring'

export interface ZonePalette {
  id: ZoneId
  /** Ground tile types for this season (index 0 is the default fill, 1 the accent). */
  groundTypes: string[]
  /** The "water" equivalent hazard tile for this season (winter = walkable ice). */
  hazard: string
  wallColor: string
  accentColor: string
}

export const ZONE_PALETTES: Record<ZoneId, ZonePalette> = {
  spring: {
    id: 'spring',
    groundTypes: ['grass', 'grass_tall', 'grass'],
    hazard: 'water',
    wallColor: '#6a5a3a',
    accentColor: '#ff9ecf', // blossom pink
  },
  summer: {
    id: 'summer',
    groundTypes: ['grass', 'grass_tall', 'grass'],
    hazard: 'water',
    wallColor: '#5a4a30',
    accentColor: '#2e8b2e', // deep green
  },
  autumn: {
    id: 'autumn',
    groundTypes: ['autumn_ground', 'autumn_leaves', 'autumn_ground'],
    hazard: 'water',
    wallColor: '#6a4a28',
    accentColor: '#d2691e', // amber
  },
  winter: {
    id: 'winter',
    groundTypes: ['snow', 'ice', 'frost'],
    hazard: 'ice_water', // ice is walkable (skate/swim later)
    wallColor: '#3a5a7a',
    accentColor: '#a0e0ff', // frost blue
  },
}
