import { styleTile, styleTiles } from '@/engine/tileset/styleTiles'
import type { Entity, Quest } from '@/game/types'
import type { TilePose } from '@/engine/tileset/pose'

/**
 * ENTITY ART, a READER over the backend unit tiles. It declares no figures of its own.
 *
 * This file used to BE the art: 11 multi-row enemy figures, their 11 animation frames, the villager, the
 * fallbacks, ~90 lines of hand-drawn sprites in the frontend.
 *
 *   > human like units should look like the user player, animals, and other units are also composition of
 *   > ascii characters grouped to create a given element … a dog is not a single character, is a set of
 *   > characters combined to form a dog, that was then converted to png to be a tile … we lost the unit
 *   > ascii art and we must recover it a correctly convert it to tile images and save them in thew elixir
 *   > backend … i don't want ANY data layer on frontend, just actual game engine.
 *
 * Those figures now live in nebulith (`priv/repo/tilesets/ascii_unit_art.json` → `TileSource.apply_unit_art`)
 * and arrive on each unit tile as `settings.artFrames`, the character ROWS of every frame, alongside
 * `settings.frames`, the baked picture per frame, and `settings.frameMs`, the loop length. The 11 enemy
 * figures were recovered from this file verbatim, so nothing was redrawn in the move.
 *
 * What stays here is the NAMED ACCESS the render already used, `entityArt(entity)`, `entityArtFrame(e, n)`,
 * `entityFootprint(e)`, so every call site keeps its shape while the rows come from the catalog.
 *
 * An unserved label resolves to NO rows rather than a stand-in figure: a unit the backend has no art for
 * must read as missing, not as a goblin. The footprint still floors at 1×2 cells, because collision needs a
 * box for a unit that exists whether or not its picture has loaded.
 */

/** The unit TILE LABEL an entity draws. An enemy is its type (`goblin`); everything else is its kind
 *  (`player` / `npc`), the same label→tile resolution the renderer uses for the baked image, so the rows
 *  and the picture can never disagree about which unit this is. */
function unitLabel(entity: Entity): string {
  if (entity.kind === 'enemy') return entity.enemyType?.trim().toLowerCase() ?? 'enemy'
  return entity.kind
}

/** The served frames of character rows for a unit, or `[]` when the backend has no art for it.
 *  ASCII is asked because it is the style whose tiles are composed FROM characters, the emoji rows carry
 *  no `artFrames`, and a pictograph has no character grid to read. */
function servedFrames(entity: Entity): readonly string[][] {
  const settings = styleTile('ascii', unitLabel(entity))?.settings as { artFrames?: string[][] } | undefined
  const frames = settings?.artFrames
  return Array.isArray(frames) ? frames : []
}

/**
 * A high-contrast color pair per entity, a bright glyph `fg` on a solid dark `bg` block, * so creatures render as ROBUST sprites in the trees' block language, not thin transparent
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
 * enemies vary by type, instead of every NPC being the same flat blue. Same recipe as the
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
  const base =
    entity.kind === 'player' || entity.kind === 'npc'
      ? characterTone(entity.id)
      : ENEMY_PALETTE[entity.enemyType?.trim().toLowerCase() ?? ''] ?? ENEMY_PALETTE_FALLBACK
  // An editor colour override recolours the glyph; the bg stays the role's, for contrast.
  return entity.color ? { ...base, fg: entity.color } : base
}

/** Top-view role colors for the `>` glyph: yellow player, red enemy, and NPCs by quest, *  blue (plain character), green (has an available quest to give), purple (quest in progress). */
export const TOP_ROLE_COLOR = {
  player: '#ffdd00', // yellow
  enemy: '#ff4d4d', // red
  npc: '#38bdf8', // blue, plain character
  questAvailable: '#4ade80', // green
  questActive: '#c084fc', // purple
} as const

/** Resolve an entity's top-view role color (NPCs vary by the state of the quest they give). Pure. */
export function topRoleColor(entity: Entity, quests: readonly Quest[]): string {
  if (entity.color) return entity.color // an explicit editor colour wins over the role/quest default
  if (entity.kind === 'player') return TOP_ROLE_COLOR.player
  if (entity.kind === 'enemy') return TOP_ROLE_COLOR.enemy
  const q = quests.find(qu => qu.giverId === entity.id)
  if (q?.state === 'available') return TOP_ROLE_COLOR.questAvailable
  if (q?.state === 'active') return TOP_ROLE_COLOR.questActive
  return TOP_ROLE_COLOR.npc
}

/**
 * The character ROWS a unit draws, frame 0, its figure at rest.
 *
 * Empty when the backend serves no art for this unit. Nothing here substitutes another unit's figure: an
 * unserved label has to read as missing, which is a seeding gap to fix in nebulith, not something the
 * renderer should paper over with a goblin.
 */
export function entityArt(entity: Entity): readonly string[] {
  return servedFrames(entity)[0] ?? []
}

/**
 * The rows for one animation FRAME, wrapping at the end of the cycle.
 *
 * Every frame is authored at the same row count and width as frame 0, so cycling never jitters the
 * footprint, the rule the old hardcoded `ENEMY_ART_ALT` followed and the seeder now asserts.
 */
export function entityArtFrame(entity: Entity, frame: number): readonly string[] {
  const frames = servedFrames(entity)
  if (frames.length === 0) return []
  return frames[((frame % frames.length) + frames.length) % frames.length]
}

/** The grid footprint (in CELLS) an entity occupies, derived from its art so the
 *  renderer + collision agree. Every entity is at least 2 cells tall (like the player
 * , a 3-row figure ≈ 2 cells), 1 wide; wider art (e.g. a spider) spans 2-3 cells.
 *  ~3 art chars ≈ one cell wide; ~1.5 art rows ≈ one cell tall. */
export function entityFootprint(entity: Entity): { w: number; h: number } {
  const art = entityArt(entity)
  const rows = art.length
  const cols = art.reduce((m, r) => Math.max(m, r.length), 0)
  return { w: Math.max(1, Math.round(cols / 3)), h: Math.max(2, Math.ceil(rows / 1.5)) }
}

/** Every unit label the loaded ascii tileset serves a composed FIGURE for (tests / tooling).
 *  A FUNCTION, not a const: the catalog arrives over the network, so a module-level array would capture
 *  the empty catalog at import time and stay empty forever. */
export function unitArtLabels(): string[] {
  return Object.entries(styleTiles('ascii'))
    .filter(([, tile]) => Array.isArray((tile.settings as { artFrames?: unknown })?.artFrames))
    .map(([label]) => label)
    .sort()
}

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

/**
 * THE WEAPON IN HAND, in whatever style is on.
 *
 * `docs/SPEC.md` law 4: a tileset is a set of pictures for the same labels, so the weapon a hero holds is
 * the tile for its kind, looked up in the ACTIVE style. There is no branch on which style that is.
 *
 * There were three of them, and they all read `activeStyleId !== 'ascii'`, which is the two-style world
 * written into the engine: every style that was not ascii got emoji's art, so a third style would have
 * silently drawn emoji weapons while claiming to be itself.
 *
 * The per-style CHARACTER fallbacks below are the last resort and nothing else. A weapon is a tile and a
 * tile is an image; the catalog serves no character for one today, so without these the hand would be
 * empty. Serving the weapon's picture is phase 10, where units get their tables, and these go then.
 */
export function weaponArt(
  weapon: { kind?: string; range?: string } | null | undefined,
  styleId: string,
): string {
  if (!weapon || weapon.kind === 'unarmed') return ''

  const served = weapon.kind ? styleTile(styleId, weapon.kind)?.char : undefined
  if (served) return served

  return lastResortChar(weapon, styleId)
}

/** The one held-weapon orientation, used by any style whose tile states no pose of its own: rotate half a
 *  turn so a vertical blade points out of the fist, mirror on the facing so it points outward both ways,
 *  and grow it to hand size. Every style shared this before it was data, and it stays as the floor. */
export const HELD_WEAPON_POSE: TilePose = { rot: Math.PI, flip: true, scale: 1.7, dy: 0.765 }

/** The equipped weapon's POSE, from the tile for its kind in the style being drawn. */
export function weaponPose(kind: string | undefined, styleId: string): TilePose | undefined {
  if (!kind) return undefined

  // A style whose tile states no pose falls to the one shared orientation rather than to identity: a
  // weapon drawn flat reads as a dropped item rather than a held one.
  return styleTile(styleId, kind)?.pose ?? HELD_WEAPON_POSE
}

/** The bare-handed PUNCH, the same lookup under the label every style uses for a fist. */
export function punchTile(styleId: string): { glyph: string; pose?: TilePose } {
  const t = styleTile(styleId, 'fist')
  return { glyph: t?.char ?? '', pose: t?.pose }
}

/**
 * THE LAST RESORT, per style, and the only art this file still holds.
 *
 * It is a table rather than a branch: a style is a key, and a style that is not in it gets nothing, which
 * is the honest answer for a style nobody has drawn weapons for. Nothing here decides anything when the
 * catalog serves a character, which is what it should be doing.
 */
const LAST_RESORT: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  ascii: { staff: 'i', axe: 'T', shield: 'O', sword: SWORD_GLYPH, bow: BOW_GLYPH, gun: GUN_GLYPH },
  emoji: { bow: '🏹', gun: '🔫', staff: '🪄', axe: '🪓', shield: '🛡️', sword: '🗡️' },
}

function lastResortChar(weapon: { kind?: string; range?: string }, styleId: string): string {
  const table = LAST_RESORT[styleId]
  if (!table) return ''

  const ranged = weapon.range === 'ranged'
  const key = ranged && weapon.kind !== 'gun' ? 'bow' : weapon.kind
  return table[key ?? ''] ?? table[ranged ? 'bow' : 'sword'] ?? ''
}
