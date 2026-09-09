import { styleTile, styleTiles } from '@/engine/tileset/styleTiles'
import type { Entity, Quest } from '@/game/types'
import type { TilePose } from '@/engine/tileset/pose'

/**
 * ENTITY ART — a READER over the backend unit tiles. It declares no figures of its own.
 *
 * This file used to BE the art: 11 multi-row enemy figures, their 11 animation frames, the villager, the
 * fallbacks — ~90 lines of hand-drawn sprites in the frontend. Alexander, 2026-09-08:
 *
 *   > human like units should look like the user player, animals, and other units are also composition of
 *   > ascii characters grouped to create a given element … a dog is not a single character, is a set of
 *   > characters combined to form a dog, that was then converted to png to be a tile … we lost the unit
 *   > ascii art and we must recover it a correctly convert it to tile images and save them in thew elixir
 *   > backend … i don't want ANY data layer on frontend, just actual game engine.
 *
 * Those figures now live in nebulith (`priv/repo/tilesets/ascii_unit_art.json` → `TileSource.apply_unit_art`)
 * and arrive on each unit tile as `settings.artFrames` — the character ROWS of every frame — alongside
 * `settings.frames`, the baked picture per frame, and `settings.frameMs`, the loop length. The 11 enemy
 * figures were recovered from this file verbatim, so nothing was redrawn in the move.
 *
 * What stays here is the NAMED ACCESS the render already used — `entityArt(entity)`, `entityArtFrame(e, n)`,
 * `entityFootprint(e)` — so every call site keeps its shape while the rows come from the catalog.
 *
 * An unserved label resolves to NO rows rather than a stand-in figure: a unit the backend has no art for
 * must read as missing, not as a goblin. The footprint still floors at 1×2 cells, because collision needs a
 * box for a unit that exists whether or not its picture has loaded.
 */

/** The unit TILE LABEL an entity draws. An enemy is its type (`goblin`); everything else is its kind
 *  (`player` / `npc`) — the same label→tile resolution the renderer uses for the baked image, so the rows
 *  and the picture can never disagree about which unit this is. */
function unitLabel(entity: Entity): string {
  if (entity.kind === 'enemy') return entity.enemyType?.trim().toLowerCase() ?? 'enemy'
  return entity.kind
}

/** The served frames of character rows for a unit, or `[]` when the backend has no art for it.
 *  ASCII is asked because it is the style whose tiles are composed FROM characters — the emoji rows carry
 *  no `artFrames`, and a pictograph has no character grid to read. */
function servedFrames(entity: Entity): readonly string[][] {
  const settings = styleTile('ascii', unitLabel(entity))?.settings as { artFrames?: string[][] } | undefined
  const frames = settings?.artFrames
  return Array.isArray(frames) ? frames : []
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
  const base =
    entity.kind === 'player' || entity.kind === 'npc'
      ? characterTone(entity.id)
      : ENEMY_PALETTE[entity.enemyType?.trim().toLowerCase() ?? ''] ?? ENEMY_PALETTE_FALLBACK
  // An editor colour override recolours the glyph; the bg stays the role's, for contrast.
  return entity.color ? { ...base, fg: entity.color } : base
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
  if (entity.color) return entity.color // an explicit editor colour wins over the role/quest default
  if (entity.kind === 'player') return TOP_ROLE_COLOR.player
  if (entity.kind === 'enemy') return TOP_ROLE_COLOR.enemy
  const q = quests.find(qu => qu.giverId === entity.id)
  if (q?.state === 'available') return TOP_ROLE_COLOR.questAvailable
  if (q?.state === 'active') return TOP_ROLE_COLOR.questActive
  return TOP_ROLE_COLOR.npc
}

/**
 * The character ROWS a unit draws, frame 0 — its figure at rest.
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
 * footprint — the rule the old hardcoded `ENEMY_ART_ALT` followed and the seeder now asserts.
 */
export function entityArtFrame(entity: Entity, frame: number): readonly string[] {
  const frames = servedFrames(entity)
  if (frames.length === 0) return []
  return frames[((frame % frames.length) + frames.length) % frames.length]
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

/** Emoji held-weapon glyph for the reskin styles — a real ⚔️/🏹/🪄 in hand instead of the ASCII `Ɨ`/`}`.
 *  Bare hands draw nothing. Used when the active style isn't ASCII (see the player loadout sync). */
export function weaponEmoji(weapon?: { kind?: string; range?: string } | null): string {
  if (!weapon || weapon.kind === 'unarmed') return ''
  // Prefer the loaded tileset's glyph so the weapon char is data-driven (backend/DB); fall back to the
  // switch when the tileset hasn't loaded yet (SSR / backend down) so the hand is never empty.
  const fromTileset = weapon.kind ? styleTile('emoji', weapon.kind)?.char : undefined
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
/** The uniform ASCII held-weapon pose — the orientation the ascii weapon branch used to HARDCODE: rotate
 *  π (a vertical blade points down out of the fist and reads as a blade both ways), MIRROR on the facing
 *  (`flip` XOR left-facing → the glyph points OUTWARD in both facings, #54), and grow to the old weaponSize
 *  (fontSize×1.7) offset half a weapon-length down the hand (dy = 1.7×0.45). Every ascii weapon shared this
 *  one look. Used as the fallback when the loaded ascii tileset carries no per-weapon pose (bundled default
 *  / backend down), mirroring how `weaponEmoji` falls back to a switch — so the ascii look never regresses. */
export const ASCII_WEAPON_POSE: TilePose = { rot: Math.PI, flip: true, scale: 1.7, dy: 0.765 }

export function weaponPose(kind: string | undefined, style: 'emoji' | 'ascii'): TilePose | undefined {
  if (!kind) return undefined
  // ASCII is just another tileset: read the weapon's pose from the loaded ascii tiles, falling back to the
  // shared ASCII_WEAPON_POSE when the tileset hasn't loaded a per-weapon pose (so the look never regresses).
  if (style === 'ascii') return styleTile('ascii', kind)?.pose ?? ASCII_WEAPON_POSE
  return styleTile('emoji', kind)?.pose
}

/** The bare-handed PUNCH tile (glyph + pose) for the reskin styles — a real 👊 swung at the hand when the
 *  hero fights unarmed, instead of the ASCII swing. Data-driven: reads the loaded tileset's `fist` entry
 *  like the weapons read theirs. ASCII bare hands stay as they were (no glyph → the fist is emoji art). */
export function punchTile(style: 'emoji' | 'ascii'): { glyph: string; pose?: TilePose } {
  if (style !== 'emoji') return { glyph: '' }
  const t = styleTile('emoji', 'fist')
  return { glyph: t?.char ?? '', pose: t?.pose }
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
