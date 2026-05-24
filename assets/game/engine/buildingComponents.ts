/**
 * SUPER MARIO STYLE COMPONENTS
 * Based on Super Mario Bros 1-1
 */

import { AsciiComponent, COMPONENTS } from './asciiComponents'

// ═══════════════════════════════════════════════════════════════════════════
// GROUND BLOCK - Brown brick (character: #)
// ═══════════════════════════════════════════════════════════════════════════
export const GROUND_BLOCK: AsciiComponent = {
  name: 'ground_block',
  category: 'structure',
  width: 1,
  height: 1,
  sprite: ['#'],
  blocking: [[true]],
  anchor: { x: 0, y: 0 }
}

// ═══════════════════════════════════════════════════════════════════════════
// BRICK BLOCK - Breakable brick (character: B)
// ═══════════════════════════════════════════════════════════════════════════
export const BRICK_BLOCK: AsciiComponent = {
  name: 'brick_block',
  category: 'structure',
  width: 1,
  height: 1,
  sprite: ['B'],
  blocking: [[true]],
  anchor: { x: 0, y: 0 }
}

// ═══════════════════════════════════════════════════════════════════════════
// QUESTION BLOCK - Yellow ? block (character: ?)
// ═══════════════════════════════════════════════════════════════════════════
export const QUESTION_BLOCK: AsciiComponent = {
  name: 'question_block',
  category: 'structure',
  width: 1,
  height: 1,
  sprite: ['?'],
  blocking: [[true]],
  anchor: { x: 0, y: 0 }
}

// ═══════════════════════════════════════════════════════════════════════════
// PIPE - Green pipe (various heights)
// ═══════════════════════════════════════════════════════════════════════════
export const PIPE_SMALL: AsciiComponent = {
  name: 'pipe_small',
  category: 'structure',
  width: 4,
  height: 3,
  sprite: [
    '####',
    '|##|',
    '|##|',
  ],
  blocking: [
    [true, true, true, true],
    [true, true, true, true],
    [true, true, true, true],
  ],
  anchor: { x: 2, y: 2 }
}

export const PIPE_MEDIUM: AsciiComponent = {
  name: 'pipe_medium',
  category: 'structure',
  width: 4,
  height: 5,
  sprite: [
    '####',
    '|##|',
    '|##|',
    '|##|',
    '|##|',
  ],
  blocking: Array(5).fill([true, true, true, true]),
  anchor: { x: 2, y: 4 }
}

export const PIPE_TALL: AsciiComponent = {
  name: 'pipe_tall',
  category: 'structure',
  width: 4,
  height: 7,
  sprite: [
    '####',
    '|##|',
    '|##|',
    '|##|',
    '|##|',
    '|##|',
    '|##|',
  ],
  blocking: Array(7).fill([true, true, true, true]),
  anchor: { x: 2, y: 6 }
}

// ═══════════════════════════════════════════════════════════════════════════
// CLOUD - White fluffy cloud (NO BLOCKING - background)
// ═══════════════════════════════════════════════════════════════════════════
export const CLOUD_SMALL: AsciiComponent = {
  name: 'cloud_small',
  category: 'decoration',
  width: 6,
  height: 2,
  sprite: [
    ' (@@) ',
    '(@@@@@)',
  ],
  blocking: Array(2).fill(Array(6).fill(false)),
  anchor: { x: 3, y: 1 }
}

export const CLOUD_LARGE: AsciiComponent = {
  name: 'cloud_large',
  category: 'decoration',
  width: 10,
  height: 3,
  sprite: [
    '  (@@)    ',
    ' (@@@@@)  ',
    '(@@@@@@@@@)',
  ],
  blocking: Array(3).fill(Array(10).fill(false)),
  anchor: { x: 5, y: 2 }
}

// ═══════════════════════════════════════════════════════════════════════════
// BUSH - Green bush (NO BLOCKING - background decoration)
// ═══════════════════════════════════════════════════════════════════════════
export const BUSH_SMALL: AsciiComponent = {
  name: 'bush_small',
  category: 'vegetation',
  width: 5,
  height: 2,
  sprite: [
    ' %%% ',
    '%%%%%',
  ],
  blocking: Array(2).fill(Array(5).fill(false)),
  anchor: { x: 2, y: 1 }
}

export const BUSH_LARGE: AsciiComponent = {
  name: 'bush_large',
  category: 'vegetation',
  width: 9,
  height: 3,
  sprite: [
    '   %%%   ',
    ' %%%%%%% ',
    '%%%%%%%%%',
  ],
  blocking: Array(3).fill(Array(9).fill(false)),
  anchor: { x: 4, y: 2 }
}

// ═══════════════════════════════════════════════════════════════════════════
// HILL - Green background hill (NO BLOCKING)
// ═══════════════════════════════════════════════════════════════════════════
export const HILL_SMALL: AsciiComponent = {
  name: 'hill_small',
  category: 'terrain',
  width: 9,
  height: 4,
  sprite: [
    '    ^    ',
    '   ^^^   ',
    '  ^^^^^  ',
    ' ^^^^^^^ ',
  ],
  blocking: Array(4).fill(Array(9).fill(false)),
  anchor: { x: 4, y: 3 }
}

export const HILL_LARGE: AsciiComponent = {
  name: 'hill_large',
  category: 'terrain',
  width: 15,
  height: 6,
  sprite: [
    '       ^       ',
    '      ^^^      ',
    '     ^^^^^     ',
    '    ^^^^^^^    ',
    '   ^^^^^^^^^   ',
    '  ^^^^^^^^^^^  ',
  ],
  blocking: Array(6).fill(Array(15).fill(false)),
  anchor: { x: 7, y: 5 }
}

// ═══════════════════════════════════════════════════════════════════════════
// CASTLE - End of level castle
// ═══════════════════════════════════════════════════════════════════════════
export const CASTLE: AsciiComponent = {
  name: 'castle',
  category: 'structure',
  width: 15,
  height: 10,
  sprite: [
    '  M   M   M  ',
    '  #   #   #  ',
    '  #########  ',
    '  #   #   #  ',
    '  #   #   #  ',
    '  #########  ',
    '  #  ___  #  ',
    '  # |   | #  ',
    '  # |   | #  ',
    '  ###___###  ',
  ],
  blocking: Array(10).fill(null).map((_, row) => {
    if (row >= 2) {
      return Array(15).fill(false).map((_, col) => {
        if (col >= 5 && col <= 9) return false // door
        if (col >= 2 && col <= 12) return true
        return false
      })
    }
    return Array(15).fill(false)
  }),
  anchor: { x: 7, y: 9 }
}

// ═══════════════════════════════════════════════════════════════════════════
// FLAGPOLE
// ═══════════════════════════════════════════════════════════════════════════
export const FLAGPOLE: AsciiComponent = {
  name: 'flagpole',
  category: 'structure',
  width: 5,
  height: 12,
  sprite: [
    '  O  ',
    ' FFF ',
    '  |  ',
    '  |  ',
    '  |  ',
    '  |  ',
    '  |  ',
    '  |  ',
    '  |  ',
    '  |  ',
    '  |  ',
    ' [#] ',
  ],
  blocking: Array(12).fill(Array(5).fill(false)),
  anchor: { x: 2, y: 11 }
}

// ═══════════════════════════════════════════════════════════════════════════
// COIN - Collectible
// ═══════════════════════════════════════════════════════════════════════════
export const COIN: AsciiComponent = {
  name: 'coin',
  category: 'decoration',
  width: 1,
  height: 1,
  sprite: ['o'],
  blocking: [[false]],
  anchor: { x: 0, y: 0 }
}

// ═══════════════════════════════════════════════════════════════════════════
// DOOR TRIGGER SYSTEM
// ═══════════════════════════════════════════════════════════════════════════
export interface DoorTrigger {
  name: string
  x: number
  y: number
  width: number
  height: number
  targetScene?: string
}

export function createDoorTriggers(buildings: Array<{ type: string, x: number, y: number }>, tileSize: number): DoorTrigger[] {
  const triggers: DoorTrigger[] = []
  for (const building of buildings) {
    const comp = COMPONENTS[building.type]
    if (!comp) continue
    triggers.push({
      name: building.type,
      x: building.x * tileSize,
      y: building.y * tileSize,
      width: tileSize * 4,
      height: tileSize * 4,
      targetScene: `interior_${building.type}`
    })
  }
  return triggers
}

// ═══════════════════════════════════════════════════════════════════════════
// REGISTER ALL COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════
COMPONENTS['ground_block'] = GROUND_BLOCK
COMPONENTS['brick_block'] = BRICK_BLOCK
COMPONENTS['question_block'] = QUESTION_BLOCK
COMPONENTS['pipe_small'] = PIPE_SMALL
COMPONENTS['pipe_medium'] = PIPE_MEDIUM
COMPONENTS['pipe_tall'] = PIPE_TALL
COMPONENTS['cloud_small'] = CLOUD_SMALL
COMPONENTS['cloud_large'] = CLOUD_LARGE
COMPONENTS['bush_small'] = BUSH_SMALL
COMPONENTS['bush_large'] = BUSH_LARGE
COMPONENTS['hill_small'] = HILL_SMALL
COMPONENTS['hill_large'] = HILL_LARGE
COMPONENTS['castle'] = CASTLE
COMPONENTS['flagpole'] = FLAGPOLE
COMPONENTS['coin'] = COIN
