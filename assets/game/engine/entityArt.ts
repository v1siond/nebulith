/**
 * Multi-row ASCII art for placed entities — enemies render as little monsters, NPCs
 * as a humanoid figure (like the player), instead of a single letter. Used by the
 * iso / top / 2D entity renderers. Pure data + a lookup.
 */
import type { Entity } from '@/game/types'

/** A few-row ASCII creature per enemy type (lowercased enemyType is the key). */
export const ENEMY_ART: Readonly<Record<string, readonly string[]>> = {
  goblin: [' ,,', '(>o<)', '/]_[\\'],
  wolf: ['/\\_/\\', '(o.o)', ' >^< '],
  skeleton: [' [x]', ' )|(', '/| |\\'],
  bandit: [' ___', '[-_-]', '/|`|\\'],
  orc: [' ▟▙', '(O O)', '/[_]\\'],
  slime: ['     ', '(~~~)', '\\___/'],
}

/** Fallback monster for an unknown enemy type. */
export const ENEMY_FALLBACK: readonly string[] = [' >~<', '(@_@)', '/| |\\']

/** A humanoid figure for NPCs (and a sensible stand-in for the player). */
export const NPC_ART: readonly string[] = ['  O', ' /|\\', ' / \\']

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
 *  — a 3-row figure ≈ 2 cells), 1 wide; wider art (e.g. a wolf) spans 2 cells across.
 *  ~3 art chars ≈ one cell wide; ~1.5 art rows ≈ one cell tall. */
export function entityFootprint(entity: Entity): { w: number; h: number } {
  const art = entityArt(entity)
  const rows = art.length
  const cols = art.reduce((m, r) => Math.max(m, r.length), 0)
  return { w: Math.max(1, Math.round(cols / 3)), h: Math.max(2, Math.ceil(rows / 1.5)) }
}

/** All enemy-type keys that have bespoke art (for tests / tooling). */
export const ENEMY_ART_TYPES = Object.keys(ENEMY_ART)
