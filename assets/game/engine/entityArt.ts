import type { Entity, Quest } from '@/game/types'
import { EMOJI_TILESET } from '@/engine/tileset/emojiTileset'
import type { TilePose } from '@/engine/tileset/pose'

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
  guardian: [
    ' [=]',   // helmed stone warden
    '[|O|]',
    '/|#|\\',  // armoured torso
    ' |_|',
  ],
  wraith: [
    ' /^\\',
    '(x x)',  // hollow-eyed specter
    ' \\~/ ',
    '  ~  ',
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
  guardian: { fg: '#cdd2c0', bg: '#3a4436' }, // mossy-stone warden
  wraith: { fg: '#bfeaff', bg: '#243a4a' }, // spectral blue
}
export const ENEMY_PALETTE_FALLBACK: EntityPalette = { fg: '#ff8f6a', bg: '#56241a' }

/**
 * Character (player + npc) clothing/skin tones. A villager or hero draws ONE of these,
 * picked deterministically by its entity id, so the cast reads as distinct people the way
 * enemies vary by type — instead of every NPC being the same flat blue. Same recipe as the
 * enemy palette: a bright glyph `fg` on a solid dark block `bg`. Tasteful, not neon.
 * [0] gold = the classic hero tone, [1] sky-blue = the old plain-NPC tone (kept for continuity).
 */
export const CHARACTER_TONES: readonly EntityPalette[] = [
  { fg: '#ffe24a', bg: '#5a4412' }, // gold (hero)
  { fg: '#6fd6ff', bg: '#173a55' }, // sky blue
  { fg: '#8fe39a', bg: '#1d4a2a' }, // forest green
  { fg: '#ff9b8a', bg: '#5a221a' }, // terracotta
  { fg: '#c7a6ff', bg: '#322152' }, // violet robe
  { fg: '#ffc06a', bg: '#5a3a12' }, // amber
  { fg: '#ffa6d4', bg: '#4f1f3a' }, // rose
  { fg: '#9fe8e0', bg: '#114744' }, // teal
]

/** Stable 32-bit FNV-1a hash of a string → deterministic, well-spread per-entity variety. */
function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** The character tone a player/npc draws, chosen deterministically from CHARACTER_TONES by id. */
export function characterTone(id: string): EntityPalette {
  return CHARACTER_TONES[hashString(id) % CHARACTER_TONES.length]
}

/** The fg/bg block palette for an entity. Characters (player/npc) get a per-id tone so each
 *  reads as a distinct person; enemies keep their per-type hue. */
export function entityPalette(entity: Entity): EntityPalette {
  if (entity.kind === 'player' || entity.kind === 'npc') return characterTone(entity.id)
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
  guardian: [' [=]', '[|o|]', '\\|#|/', ' |_|'], // eye dims, arms shift
  wraith: [' /^\\', '(- -)', ' /~\\ ', '  ~  '], // blink + drift
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
/** The held sword: a long vertical blade with a crossguard. The render pivots it at the hand
 *  and swings it on attack, so a vertical-dominant glyph reads as a blade at rest AND sweeps
 *  cleanly through the arc (the old '†' read as a tiny '+' at hand size). */
export const SWORD_GLYPH = 'Ɨ'

/** Held glyphs for the ranged weapons: a drawn bow (the string), a stubby pistol. */
export const BOW_GLYPH = '}'
export const GUN_GLYPH = '¬'

/** Emoji held-weapon glyph for the reskin styles — a real ⚔️/🏹/🪄 in hand instead of the ASCII `Ɨ`/`}`.
 *  Bare hands draw nothing. Used when the active style isn't ASCII (see the player loadout sync). */
export function weaponEmoji(weapon?: { kind?: string; range?: string } | null): string {
  if (!weapon || weapon.kind === 'unarmed') return ''
  // Prefer the loaded tileset's glyph so the weapon char is data-driven (backend/DB); fall back to the
  // switch when the tileset hasn't loaded yet (SSR / backend down) so the hand is never empty.
  const fromTileset = weapon.kind ? EMOJI_TILESET[weapon.kind]?.char : undefined
  if (fromTileset) return fromTileset
  switch (weapon.kind) {
    case 'bow': return '🏹'
    case 'gun': return '🔫'
    case 'staff': return '🪄'
    case 'axe': return '🪓'
    case 'shield': return '🛡️'
    case 'sword': return '🗡️'
    default: return weapon.range === 'ranged' ? '🏹' : '🗡️'
  }
}

/** The equipped weapon's POSE (orientation/size/flip/offset/muzzle) from the loaded tileset — the
 *  data that used to be the hardcoded WEAPON_ORIENT/emojiWeaponSize. Emoji reads its tileset entry;
 *  ascii returns undefined for now (the ascii weapon path keeps its own drawing). Absent → the render
 *  falls back to identity (no rotation/scale), so keep the backend tileset seeded with the weapon poses. */
export function weaponPose(kind: string | undefined, style: 'emoji' | 'ascii'): TilePose | undefined {
  if (!kind || style !== 'emoji') return undefined
  return EMOJI_TILESET[kind]?.pose
}

export function weaponGlyph(weapon?: { kind?: string; range?: string } | null): string {
  if (!weapon) return ''
  if (weapon.kind === 'unarmed') return '' // bare hands — the fist swings, no blade is drawn
  // Ranged reads by silhouette: a gun is a pistol, everything else ranged is a drawn bow.
  if (weapon.range === 'ranged') return weapon.kind === 'gun' ? GUN_GLYPH : BOW_GLYPH
  switch (weapon.kind) {
    case 'staff':
      return 'i' // a focus rod
    case 'axe':
      return 'T' // broad head
    case 'shield':
      return 'O' // boss
    case 'sword':
      return SWORD_GLYPH
    default:
      return SWORD_GLYPH
  }
}
