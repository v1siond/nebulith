/**
 * ASCII COMPONENTS - Small reusable building blocks
 *
 * Each component is a small ASCII sprite that can be placed on a map.
 * Components are composed together to build complete scenes.
 */

export interface AsciiComponent {
  name: string
  category: 'vegetation' | 'structure' | 'decoration' | 'terrain' | 'character'
  width: number
  height: number
  sprite: string[]      // The ASCII art lines
  blocking: boolean[][]  // Which cells block (same dimensions as sprite)
  anchor: { x: number, y: number }  // Where to place (usually bottom-center)
}

// ═══════════════════════════════════════════════════════════════════════════
// VEGETATION
// ═══════════════════════════════════════════════════════════════════════════

export const TREE_SMALL: AsciiComponent = {
  name: 'tree_small',
  category: 'vegetation',
  width: 5,
  height: 8,
  sprite: [
    ' (&) ',
    '(@&@)',
    '(@&@)',
    ' 0W0 ',
    ' 0W0 ',
    ' 0W0 ',
    ' 0W0 ',
    ' 0W0 ',
  ],
  // Trees are background - no blocking
  blocking: Array(8).fill(Array(5).fill(false)),
  anchor: { x: 2, y: 7 }
}

export const TREE_MEDIUM: AsciiComponent = {
  name: 'tree_medium',
  category: 'vegetation',
  width: 7,
  height: 12,
  sprite: [
    '  (&)  ',
    ' (@&@) ',
    '(@&@&@)',
    '(@&@&@)',
    '(&@&@&)',
    '  0W0  ',
    '  0W0  ',
    '  0W0  ',
    '  0W0  ',
    '  0W0  ',
    '  0W0  ',
    '  0W0  ',
  ],
  // Trees are background - no blocking
  blocking: Array(12).fill(Array(7).fill(false)),
  anchor: { x: 3, y: 11 }
}

export const TREE_LARGE: AsciiComponent = {
  name: 'tree_large',
  category: 'vegetation',
  width: 11,
  height: 16,
  sprite: [
    '    (&)    ',
    '   (@&@)   ',
    '  (@&@&@)  ',
    ' (@&@&@&@) ',
    '(&@&@&@&@&)',
    '(@@&@&@@@&)',
    '    W0W    ',
    '    0W0    ',
    '    W0W    ',
    '    0W0    ',
    '    W0W    ',
    '    0W0    ',
    '    W0W    ',
    '    0W0    ',
    '    W0W    ',
    '    0W0    ',
  ],
  // Trees are background - no blocking
  blocking: Array(16).fill(Array(11).fill(false)),
  anchor: { x: 5, y: 15 }
}

export const BUSH_SMALL: AsciiComponent = {
  name: 'bush_small',
  category: 'vegetation',
  width: 5,
  height: 3,
  sprite: [
    ' (@) ',
    '(&&&)',
    '(@@&)',
  ],
  // Bushes are background decoration - no blocking
  blocking: Array(3).fill(Array(5).fill(false)),
  anchor: { x: 2, y: 2 }
}

export const BUSH_LARGE: AsciiComponent = {
  name: 'bush_large',
  category: 'vegetation',
  width: 5,
  height: 4,
  sprite: [
    ' @@ ',
    '(&&)',
    '(@@)',
    '(@@)',
  ],
  // Bushes are background decoration - no blocking
  blocking: Array(4).fill(Array(5).fill(false)),
  anchor: { x: 2, y: 3 }
}

export const GRASS_PATCH: AsciiComponent = {
  name: 'grass_patch',
  category: 'vegetation',
  width: 11,
  height: 3,
  sprite: [
    ' ,,,,,,,, ',
    ',,,,,,,,,,,',
    ' ,,,,,,,, ',
  ],
  blocking: [
    [false, false, false, false, false, false, false, false, false, false, false],
    [false, false, false, false, false, false, false, false, false, false, false],
    [false, false, false, false, false, false, false, false, false, false, false],
  ],
  anchor: { x: 5, y: 2 }
}

export const FLOWERS: AsciiComponent = {
  name: 'flowers',
  category: 'vegetation',
  width: 13,
  height: 1,
  sprite: [
    '..g..g..g..g.',
  ],
  blocking: [[false, false, false, false, false, false, false, false, false, false, false, false, false]],
  anchor: { x: 6, y: 0 }
}

// ═══════════════════════════════════════════════════════════════════════════
// TERRAIN
// ═══════════════════════════════════════════════════════════════════════════

export const MOUNTAIN_SMALL: AsciiComponent = {
  name: 'mountain_small',
  category: 'terrain',
  width: 8,
  height: 4,
  sprite: [
    '   /\\   ',
    '  /  \\  ',
    ' /    \\ ',
    '/      \\',
  ],
  blocking: [
    [false, false, false, false, false, false, false, false],
    [false, false, false, false, false, false, false, false],
    [false, false, false, false, false, false, false, false],
    [false, false, false, false, false, false, false, false],
  ],
  anchor: { x: 4, y: 3 }
}

export const MOUNTAIN_LARGE: AsciiComponent = {
  name: 'mountain_large',
  category: 'terrain',
  width: 20,
  height: 10,
  sprite: [
    '         /\\         ',
    '        /  \\        ',
    '       /    \\       ',
    '      /      \\      ',
    '     /     *  \\     ',
    '    /          \\    ',
    '   /            \\   ',
    '  /   *          \\  ',
    ' /                \\ ',
    '/                  \\',
  ],
  blocking: Array(10).fill(Array(20).fill(false)),
  anchor: { x: 10, y: 9 }
}

export const CLOUD: AsciiComponent = {
  name: 'cloud',
  category: 'terrain',
  width: 6,
  height: 3,
  sprite: [
    ' 8888 ',
    '888888',
    ' 8888 ',
  ],
  blocking: [
    [false, false, false, false, false, false],
    [false, false, false, false, false, false],
    [false, false, false, false, false, false],
  ],
  anchor: { x: 3, y: 1 }
}

// ═══════════════════════════════════════════════════════════════════════════
// STRUCTURE
// ═══════════════════════════════════════════════════════════════════════════

export const WALL_VERTICAL: AsciiComponent = {
  name: 'wall_vertical',
  category: 'structure',
  width: 1,
  height: 5,
  sprite: ['|', '|', '|', '|', '|'],
  blocking: [[true], [true], [true], [true], [true]],
  anchor: { x: 0, y: 4 }
}

export const WALL_HORIZONTAL: AsciiComponent = {
  name: 'wall_horizontal',
  category: 'structure',
  width: 10,
  height: 1,
  sprite: ['||||||||||'],
  blocking: [[true, true, true, true, true, true, true, true, true, true]],
  anchor: { x: 5, y: 0 }
}

export const PILLAR: AsciiComponent = {
  name: 'pillar',
  category: 'structure',
  width: 2,
  height: 6,
  sprite: [
    '||',
    '||',
    '||',
    '||',
    '||',
    '||',
  ],
  blocking: [
    [true, true],
    [true, true],
    [true, true],
    [true, true],
    [true, true],
    [true, true],
  ],
  anchor: { x: 1, y: 5 }
}

export const LANTERN_POST: AsciiComponent = {
  name: 'lantern_post',
  category: 'structure',
  width: 3,
  height: 4,
  sprite: [
    'W0W',
    '0W0',
    'W0W',
    '0W0',
  ],
  blocking: [
    [true, true, true],
    [true, true, true],
    [true, true, true],
    [true, true, true],
  ],
  anchor: { x: 1, y: 3 }
}

export const LANTERN_HANGING: AsciiComponent = {
  name: 'lantern_hanging',
  category: 'structure',
  width: 1,
  height: 1,
  sprite: ['o'],
  blocking: [[false]],
  anchor: { x: 0, y: 0 }
}

export const STAIRS: AsciiComponent = {
  name: 'stairs',
  category: 'structure',
  width: 10,
  height: 2,
  sprite: [
    '   ____   ',
    '__________',
  ],
  blocking: [
    [false, false, false, false, false, false, false, false, false, false],
    [false, false, false, false, false, false, false, false, false, false],
  ],
  anchor: { x: 5, y: 1 }
}

export const PLATFORM_JUMPABLE: AsciiComponent = {
  name: 'platform_jumpable',
  category: 'structure',
  width: 4,
  height: 1,
  sprite: ['===='],
  blocking: [[false, false, false, false]],  // Can jump over
  anchor: { x: 2, y: 0 }
}

export const ROOF_SECTION: AsciiComponent = {
  name: 'roof_section',
  category: 'structure',
  width: 7,
  height: 4,
  sprite: [
    '  /|\\  ',
    ' //|\\\\ ',
    '///|\\\\\\',
    '|||||||',
  ],
  blocking: [
    [false, false, false, false, false, false, false],
    [false, false, false, false, false, false, false],
    [false, false, false, false, false, false, false],
    [true,  true,  true,  true,  true,  true,  true],
  ],
  anchor: { x: 3, y: 3 }
}

export const DOOR: AsciiComponent = {
  name: 'door',
  category: 'structure',
  width: 3,
  height: 3,
  sprite: [
    '| |',
    '|n|',
    '| |',
  ],
  blocking: [
    [true, false, true],
    [true, false, true],
    [true, false, true],
  ],
  anchor: { x: 1, y: 2 }
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT LIBRARY
// ═══════════════════════════════════════════════════════════════════════════

export const COMPONENTS: Record<string, AsciiComponent> = {
  // Vegetation
  tree_small: TREE_SMALL,
  tree_medium: TREE_MEDIUM,
  tree_large: TREE_LARGE,
  bush_small: BUSH_SMALL,
  bush_large: BUSH_LARGE,
  grass_patch: GRASS_PATCH,
  flowers: FLOWERS,

  // Terrain
  mountain_small: MOUNTAIN_SMALL,
  mountain_large: MOUNTAIN_LARGE,
  cloud: CLOUD,

  // Structure
  wall_vertical: WALL_VERTICAL,
  wall_horizontal: WALL_HORIZONTAL,
  pillar: PILLAR,
  lantern_post: LANTERN_POST,
  lantern_hanging: LANTERN_HANGING,
  stairs: STAIRS,
  platform_jumpable: PLATFORM_JUMPABLE,
  roof_section: ROOF_SECTION,
  door: DOOR,
}

// Get component by name
export function getComponent(name: string): AsciiComponent | undefined {
  return COMPONENTS[name]
}

// List all component names
export function listComponents(): string[] {
  return Object.keys(COMPONENTS)
}

// Get components by category
export function getComponentsByCategory(category: AsciiComponent['category']): AsciiComponent[] {
  return Object.values(COMPONENTS).filter(c => c.category === category)
}

// ═══════════════════════════════════════════════════════════════════════════
// CASTLE/TEMPLE SPECIFIC COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

export const CASTLE_ROOF_LARGE: AsciiComponent = {
  name: 'castle_roof_large',
  category: 'structure',
  width: 21,
  height: 5,
  sprite: [
    '         /|\\         ',
    '        //|\\\\        ',
    '       ///|\\\\\\       ',
    '      ////|\\\\\\\\      ',
    '|||||||||||||||||||||',
  ],
  blocking: [
    Array(21).fill(false),
    Array(21).fill(false),
    Array(21).fill(false),
    Array(21).fill(false),
    Array(21).fill(true),
  ],
  anchor: { x: 10, y: 4 }
}

export const CASTLE_WALL_SECTION: AsciiComponent = {
  name: 'castle_wall_section',
  category: 'structure',
  width: 20,
  height: 4,
  sprite: [
    '||||||||||||||||||||',
    '||||||||||||||||||||',
    '||||||||||||||||||||',
    '||||||||||||||||||||',
  ],
  blocking: Array(4).fill(Array(20).fill(true)),
  anchor: { x: 10, y: 3 }
}

export const CASTLE_ENTRANCE: AsciiComponent = {
  name: 'castle_entrance',
  category: 'structure',
  width: 15,
  height: 4,
  sprite: [
    '|||||||   |||||||',
    '|||||||   |||||||',
    '|||||||   |||||||',
    '|||||||   |||||||',
  ],
  blocking: [
    [true,true,true,true,true,true,true,false,false,false,true,true,true,true,true,true,true],
    [true,true,true,true,true,true,true,false,false,false,true,true,true,true,true,true,true],
    [true,true,true,true,true,true,true,false,false,false,true,true,true,true,true,true,true],
    [true,true,true,true,true,true,true,false,false,false,true,true,true,true,true,true,true],
  ],
  anchor: { x: 8, y: 3 }
}

export const INTERIOR_PILLAR_WITH_LANTERN: AsciiComponent = {
  name: 'interior_pillar_lantern',
  category: 'structure',
  width: 5,
  height: 8,
  sprite: [
    '  o  ',
    ' /|\\ ',
    '  |  ',
    '  |  ',
    '  |  ',
    '  |  ',
    '  |  ',
    '  |  ',
  ],
  blocking: [
    [false, false, false, false, false],
    [false, false, false, false, false],
    [false, false, true, false, false],
    [false, false, true, false, false],
    [false, false, true, false, false],
    [false, false, true, false, false],
    [false, false, true, false, false],
    [false, false, true, false, false],
  ],
  anchor: { x: 2, y: 7 }
}

export const FLOOR_PATTERN: AsciiComponent = {
  name: 'floor_pattern',
  category: 'structure',
  width: 10,
  height: 2,
  sprite: [
    ' ======== ',
    '==========',
  ],
  blocking: Array(2).fill(Array(10).fill(false)),
  anchor: { x: 5, y: 1 }
}

export const STREET_LAMPS: AsciiComponent = {
  name: 'street_lamps',
  category: 'structure',
  width: 20,
  height: 1,
  sprite: [
    '  -     -     -     ',
  ],
  blocking: [Array(20).fill(false)],
  anchor: { x: 10, y: 0 }
}

// Add new components to library
COMPONENTS['castle_roof_large'] = CASTLE_ROOF_LARGE
COMPONENTS['castle_wall_section'] = CASTLE_WALL_SECTION
COMPONENTS['castle_entrance'] = CASTLE_ENTRANCE
COMPONENTS['interior_pillar_lantern'] = INTERIOR_PILLAR_WITH_LANTERN
COMPONENTS['floor_pattern'] = FLOOR_PATTERN
COMPONENTS['street_lamps'] = STREET_LAMPS
