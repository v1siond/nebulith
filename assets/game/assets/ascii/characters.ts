/**
 * ASCII ART CHARACTERS
 * Player, NPCs, enemies with animation frames
 */

// Player - directional sprites
export const player = {
  idle: [
    ' 0 ',
    '<#>',
    '/ \\',
  ],
  right1: [
    ' 0 ',
    '/#>',
    '- \\',
  ],
  right2: [
    ' 0 ',
    '<#\\',
    ' > ',
  ],
  left1: [
    ' 0 ',
    '<#\\',
    '/ -',
  ],
  left2: [
    ' 0 ',
    '/#>',
    ' < ',
  ],
  up1: [
    ' O ',
    "<#'",
    "' !",
  ],
  up2: [
    ' O ',
    "'#>",
    "! '",
  ],
  down1: [
    ' O ',
    "'#>",
    "! '",
  ],
  down2: [
    ' O ',
    "<#'",
    "' !",
  ],
  jump: [
    '\\0/',
    ' # ',
    '! !',
  ],
}

// NPC - skinny type
export const npcSkinny = {
  idle: [
    ' o ',
    '<|>',
    '/ \\',
  ],
  walk1: [
    ' o ',
    '/|>',
    '- \\',
  ],
  walk2: [
    ' o ',
    '<|\\',
    '/ -',
  ],
}

// NPC - normal type
export const npcNormal = {
  idle: [
    ' o ',
    '<O>',
    '/ \\',
  ],
  walk1: [
    ' o ',
    '/O>',
    '- \\',
  ],
  walk2: [
    ' o ',
    '<O\\',
    '/ -',
  ],
}

// NPC - heavy type
export const npcHeavy = {
  idle: [
    ' o ',
    '<@>',
    '/ \\',
  ],
  walk1: [
    ' o ',
    '/@>',
    '- \\',
  ],
  walk2: [
    ' o ',
    '<@\\',
    '/ -',
  ],
}

// NPC - kid type
export const npcKid = {
  idle: [
    'o',
    '#',
    'A',
  ],
  walk1: [
    'o',
    '#',
    '/',
  ],
  walk2: [
    'o',
    '#',
    '\\',
  ],
}

// Monster - slime
export const slime = [
  ' ^^^ ',
  '(o o)',
  '\\___/',
]

// Monster - ghost
export const ghost = [
  ' ___ ',
  '( o )',
  ' ~~~ ',
]

// Monster - skeleton
export const skeleton = [
  ' ___ ',
  '(x x)',
  ' ||| ',
  '/ | \\',
]
