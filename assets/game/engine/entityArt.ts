import type { Entity } from '@/game/types'

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
    ' .-.',
    '(o.o)',
    ' |=|',
    '/|#|\\',
    ' " "',
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
      return '/' // a blade
    default:
      return '/'
  }
}
