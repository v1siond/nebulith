import type { Entity, Quest } from '@/game/types'

/**
 * Multi-row ASCII figures for entities. Authored LEFT-ALIGNED (leading spaces carry
 * the shape) — the renderer draws the rows left-aligned on a shared origin (monospace),
 * NOT centered per-row, so the figure holds together. Recognizable creature forms,
 * compact enough to read as a sprite (no artist signatures — these are game sprites).
 */
export const ENEMY_ART: Readonly<Record<string, readonly string[]>> = {
  goblin: [
    ' ,-.',
    '(>o<)',
    '/|Y|\\',
    ' d b',
  ],
  skeleton: [
    ' ___',
    '(o.o)', // skull with eye sockets
    ' )|(',  // jaw / neck + collarbone
    '/|=|\\', // ribcage (= ribs, | spine)
    ' d b',  // leg bones
  ],
  ghost: [
    ' .-.',
    '(o o)',
    '| O \\',
    ' \\   \\',
    " `~~~'",
  ],
  spider: [
    '  / _ \\',
    '\\_\\(_)/_/',
    ' _//o\\\\_',
    '  /   \\',
  ],
  wolf: [
    '/\\_/\\',
    '( o.o )',
    ' > ^ <',
  ],
  orc: [
    ' ,vv,',
    '(O~~O)',
    '/|##|\\',
    ' J  L',
  ],
  slime: [
    ' .--.',
    '(o..o)',
    "'+--+'",
  ],
  bat: [
    '/\\ ^ /\\',
    '(o   o)',
    ' \\vvv/',
  ],
  bandit: [
    ' ___',
    '[-_-]',
    '/|"|\\',
    ' | |',
  ],
}

/**
 * A high-contrast color pair per entity — a bright glyph `fg` on a solid dark `bg` block —
 * so creatures render as ROBUST sprites in the trees' block language, not thin transparent
 * line-art. Each enemy type gets its own hue so the cast reads as colorful + distinct.
 */
export interface EntityPalette { fg: string; bg: string }

export const ENEMY_PALETTE: Readonly<Record<string, EntityPalette>> = {
  goblin: { fg: '#a6e24a', bg: '#33510f' },
  skeleton: { fg: '#ece8d2', bg: '#4c4a3e' }, // bone-white on dark stone
  ghost: { fg: '#cdeeff', bg: '#27384f' },
  spider: { fg: '#c6a6ff', bg: '#352458' },
  wolf: { fg: '#cfd2da', bg: '#36363f' },
  orc: { fg: '#7fd24a', bg: '#274510' },
  slime: { fg: '#6fe6c2', bg: '#13463b' },
  bat: { fg: '#bb96e0', bg: '#281a3a' },
  bandit: { fg: '#e6b66a', bg: '#4a3318' },
}
export const ENEMY_PALETTE_FALLBACK: EntityPalette = { fg: '#ff8f6a', bg: '#56241a' }
export const PLAYER_PALETTE: EntityPalette = { fg: '#ffe24a', bg: '#5a4412' } // gold, kin to the tree trunk
export const NPC_PALETTE: EntityPalette = { fg: '#6fd6ff', bg: '#173a55' }

/** The fg/bg block palette for an entity (player / npc / enemy-by-type). */
export function entityPalette(entity: Entity): EntityPalette {
  if (entity.kind === 'player') return PLAYER_PALETTE
  if (entity.kind === 'npc') return NPC_PALETTE
  const key = entity.enemyType?.trim().toLowerCase() ?? ''
  return ENEMY_PALETTE[key] ?? ENEMY_PALETTE_FALLBACK
}

/** Top-view role colors for the `>` glyph: yellow player, red enemy, and NPCs by quest —
 *  blue (plain character), green (has an available quest to give), purple (quest in progress). */
export const TOP_ROLE_COLOR = {
  player: '#ffdd00', // yellow
  enemy: '#ff4d4d', // red
  npc: '#38bdf8', // blue — plain character
  questAvailable: '#4ade80', // green
  questActive: '#c084fc', // purple
} as const

/** Resolve an entity's top-view role color (NPCs vary by the state of the quest they give). Pure. */
export function topRoleColor(entity: Entity, quests: readonly Quest[]): string {
  if (entity.kind === 'player') return TOP_ROLE_COLOR.player
  if (entity.kind === 'enemy') return TOP_ROLE_COLOR.enemy
  const q = quests.find(qu => qu.giverId === entity.id)
  if (q?.state === 'available') return TOP_ROLE_COLOR.questAvailable
  if (q?.state === 'active') return TOP_ROLE_COLOR.questActive
  return TOP_ROLE_COLOR.npc
}

/** Drawn for an enemy whose type has no bespoke art. */
export const ENEMY_FALLBACK: readonly string[] = [
  ' ___',
  '(@_@)',
  '/| |\\',
  ' " "',
]

/** A humanoid figure for NPCs (a villager — same silhouette family as the player). */
export const NPC_ART: readonly string[] = [
  '  O',
  ' /|\\',
  ' / \\',
]

/** The multi-row ASCII art an entity renders as. */
export function entityArt(entity: Entity): readonly string[] {
  if (entity.kind === 'enemy') {
    const key = entity.enemyType?.trim().toLowerCase() ?? ''
    return ENEMY_ART[key] ?? ENEMY_FALLBACK
  }
  return NPC_ART // npc + player
}

/** Frame 1 of each idle animation — a SMALL change (blink / arms / wings), authored
 *  at the SAME dimensions as frame 0 so the footprint never jitters. */
export const ENEMY_ART_ALT: Readonly<Record<string, readonly string[]>> = {
  goblin: [' ,-.', '(>o<)', '\\|Y|/', ' d b'], // arms up
  skeleton: [' ___', '(-.-)', ' )|(', '\\|=|/', ' d b'], // blink + arms raise
  ghost: [' .-.', '(o o)', '| O /', ' /   /', " `~~~'"], // tail sways
  spider: ['  \\ _ /', '\\_\\(_)/_/', ' _//o\\\\_', '  \\   /'], // legs flex
  wolf: ['/\\_/\\', '( -.- )', ' > ^ <'], // blink
  orc: [' ,vv,', '(o~~o)', '/|##|\\', ' J  L'], // eyes
  slime: [' .--.', '(o..o)', "'+~~+'"], // wobble
  bat: ['_\\ ^ /_', '(o   o)', ' \\vvv/'], // wings flap
  bandit: [' ___', '[-_-]', '\\|"|/', ' | |'], // arms
}

const ENEMY_FALLBACK_ALT: readonly string[] = [' ___', '(@_@)', '\\| |/', ' " "']
const NPC_ART_ALT: readonly string[] = ['  O', ' \\|/', ' / \\'] // arms shift

/** The art for a given idle FRAME (0 or 1). Frame 0 is the base figure; frame 1 is
 *  the alt pose. The draw loop picks the frame from the clock for a slow idle. */
export function entityArtFrame(entity: Entity, frame: number): readonly string[] {
  if (frame % 2 === 0) return entityArt(entity)
  if (entity.kind === 'enemy') {
    const key = entity.enemyType?.trim().toLowerCase() ?? ''
    return ENEMY_ART_ALT[key] ?? ENEMY_FALLBACK_ALT
  }
  return NPC_ART_ALT // npc + player
}

/** The grid footprint (in CELLS) an entity occupies, derived from its art so the
 *  renderer + collision agree. Every entity is at least 2 cells tall (like the player
 *  — a 3-row figure ≈ 2 cells), 1 wide; wider art (e.g. a spider) spans 2–3 cells.
 *  ~3 art chars ≈ one cell wide; ~1.5 art rows ≈ one cell tall. */
export function entityFootprint(entity: Entity): { w: number; h: number } {
  const art = entityArt(entity)
  const rows = art.length
  const cols = art.reduce((m, r) => Math.max(m, r.length), 0)
  return { w: Math.max(1, Math.round(cols / 3)), h: Math.max(2, Math.ceil(rows / 1.5)) }
}

/** All enemy-type keys that have bespoke art (for tests / tooling). */
export const ENEMY_ART_TYPES = Object.keys(ENEMY_ART)

/** The held-weapon glyph drawn beside the player so equipped gear is visible at a
 *  glance. A ranged weapon (e.g. a bow) reads by `range`; melee weapons by `kind`.
 *  Returns '' when nothing is equipped (draw nothing). */
export function weaponGlyph(weapon?: { kind?: string; range?: string } | null): string {
  if (!weapon) return ''
  if (weapon.range === 'ranged') return '}' // bow / drawn string
  switch (weapon.kind) {
    case 'staff':
      return 'i' // a focus rod
    case 'axe':
      return 'T' // broad head
    case 'shield':
      return 'O' // boss
    case 'sword':
      return '†' // upright blade + crossguard, reads as a sword (not a plain slash)
    default:
      return '†'
  }
}
