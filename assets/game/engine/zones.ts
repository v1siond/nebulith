/**
 * Zone palettes for Nebulith stages (GENERATION-SPEC §3).
 *
 * A "zone" is the elemental theme that drives a stage's palette + props. MVP
 * ships two zones (lava, frozen); expand only after these make a playable game.
 */

export type ZoneId = 'lava' | 'frozen' | 'verdant'

export interface ZonePalette {
  id: ZoneId
  /** Ground tile types for this zone (index 0 is the default fill). */
  groundTypes: string[]
  /** The "water" equivalent hazard tile for this zone. */
  hazard: string
  wallColor: string
  accentColor: string
}

export const ZONE_PALETTES: Record<ZoneId, ZonePalette> = {
  lava: {
    id: 'lava',
    groundTypes: ['ash', 'rock', 'basalt'],
    hazard: 'lava',
    wallColor: '#5a2a20',
    accentColor: '#ff5520',
  },
  frozen: {
    id: 'frozen',
    groundTypes: ['snow', 'ice', 'frost'],
    hazard: 'ice_water',
    wallColor: '#3a5a7a',
    accentColor: '#a0e0ff',
  },
  verdant: {
    id: 'verdant',
    groundTypes: ['grass', 'grass_tall', 'grass'],
    hazard: 'water',
    wallColor: '#5a4a30',
    accentColor: '#88cc44',
  },
}
