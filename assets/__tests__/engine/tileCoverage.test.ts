/**
 * TILE COVERAGE GUARDRAIL — every game-world identifier must resolve to a real IMAGE tile
 * under the EMOJI style (never the ASCII passthrough / a hardcoded glyph).
 *
 * The root bug this locks out: `assetKind`/`groundKind`/`entityKind` fall back to `'ground'`
 * for anything unmapped, and `'ground'` has no emoji tile → resolveVisual returns the ASCII
 * passthrough → the renderer stamps a raw glyph. So a boss (Ω), a lava-ember crust (▒), a
 * waterfall spill (‖), a projectile (➤), an ability animation, the connector marker (◊) — all
 * silently draw as ASCII soup under the emoji reskin.
 *
 * This test loads the SEED tileset (nebulith/priv/repo/tilesets/emoji.json — the exact data the
 * live game loads from the DB), builds the emoji Style from it, then asserts that EVERY identifier
 * the stage generator / catalog / combat can emit resolves to `kind: 'image'`. Each `it` collects
 * the gaps into a list and asserts it is empty, so a RED run prints the full authoritative gap set.
 *
 * Enumerations are pulled from the real sources (CELL_LABELS, ZONE_PALETTES, MULTI_CELL_ASSETS,
 * ABILITY_TINT, the backend entity resolution, enemyTileId) — not a guessed subset. The handful that
 * cannot be imported (inline `type:` string literals in stageGenerator, the projectile glyphs that
 * are private to combat.ts) are listed verbatim with a source citation.
 */
import fs from 'fs'
import path from 'path'

import {
  EMOJI_STYLE,
  resolveVisual,
  assetKind,
  groundKind,
  entityKind,
  enemyTileId,
  personVariantTileId,
  type ElementKind,
} from '@/game/artStyle'
import { EMOJI_TILESET, setEmojiTileset, type EmojiTile } from '@/engine/tileset/emojiTileset'
import { rebuildEmojiStyle } from '@/game/artStyle'
import { installEntityPayload } from '@/engine/entity/entityLoader'
import { getEntityResolution } from '@/engine/entity/entityResolution'
import { glyphImageVisual } from '@/engine/render/shared'

import { CELL_LABELS } from '@/engine/cellLabels'
import { ZONE_PALETTES } from '@/engine/zones'
import { MULTI_CELL_ASSETS } from '@/engine/multiCellAssets'
import { ABILITY_TINT } from '@/game/abilities'
// The entity resolution the runtime installs from `/api/entities` — a captured fixture of that endpoint's
// payload (the shape EntitySource serves), installed the SAME way the loader installs it.
import ENTITIES_FIXTURE from '@/__tests__/fixtures/entities.json'
import type { EntityVariant } from '@/game/types'

// ── load the SEED the running game loads from the DB (emoji row) ──────────────────────────────
const SEED_CANDIDATES = [
  path.resolve(process.cwd(), '../nebulith/priv/repo/tilesets/emoji.json'),
  '/home/visiond/projects/game-engine/nebulith/priv/repo/tilesets/emoji.json',
]
function loadSeed(): Record<string, EmojiTile> {
  for (const p of SEED_CANDIDATES) {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, EmojiTile>
  }
  throw new Error(`emoji.json seed not found in: ${SEED_CANDIDATES.join(', ')}`)
}

beforeAll(() => {
  setEmojiTileset(loadSeed())
  rebuildEmojiStyle()
  installEntityPayload(ENTITIES_FIXTURE.data) // install the backend-served entity resolution
})

// ── helpers ───────────────────────────────────────────────────────────────────────────────────
/** resolveVisual returns an IMAGE for `kind`? (the pass condition — never ascii/glyph). */
const resolvesToImage = (kind: ElementKind): boolean => resolveVisual(kind, EMOJI_STYLE).kind === 'image'
/** A raw glyph char resolves to a baked image through the char→image index (weapons/projectiles). */
const glyphResolvesToImage = (glyph: string): boolean => glyphImageVisual(glyph)?.kind === 'image'

// ── the enumerations (from the real sources) ────────────────────────────────────────────────────

// Every `type:` a StageProp can carry: grep-verified from src/engine/stageGenerator.ts, plus
// `building` (makeBuildingCell's type param), `structure` (multiCellAssets.stampAsset), `well`
// (the single-cell tile catalog + iso `asset.type === 'well'`), and the editor-placeable types
// that live only in artStyle's TYPE_KIND.
const ASSET_TYPES: string[] = [
  'altar', 'boss', 'brazier', 'cave_decor', 'crystal', 'door', 'ember', 'feature', 'flower',
  'fountain', 'ground_decor', 'hazard', 'key', 'lamp', 'mushroom', 'path_stone', 'pillar',
  'rock', 'shore', 'temple_wall', 'torch', 'tree',
  'building', 'structure', 'well',
  'decoration', 'crate', 'lantern', 'npc', 'water', 'bush',
]

// Every cell LABEL (CELL_LABELS covers tree_*, roof/wall/door/window, mountain/peak/spill), plus
// the multi-cell asset ids that stampAsset writes as a structure `label`.
const MULTICELL_LABELS: string[] = MULTI_CELL_ASSETS.map(a => a.id)

// Every ground TYPE string that lands in ground[][]: the zone palettes' groundTypes + hazards,
// plus the explicit floors the archetypes paint (grep-verified from stageGenerator.ts).
const GROUND_TYPES: string[] = Array.from(new Set([
  ...Object.values(ZONE_PALETTES).flatMap(p => [...p.groundTypes, p.hazard]),
  'path_stone', 'ancient_stone', 'rune_floor', 'plaza',
  'temple_floor', 'marble', 'gold_tile', 'sandstone', 'cave_moss', 'cave_floor',
  'lava',
]))

const ENEMY_TYPES: string[] = Object.keys(ENTITIES_FIXTURE.data.enemyTypeSlug)
const PERSON_VARIANTS: string[] = Object.keys(ENTITIES_FIXTURE.data.variantSlug)

// The weapon tiles the seed carries (drawn in-hand via drawPoseGlyph → glyphTileImage by CHAR).
const WEAPON_KINDS: string[] = ['sword', 'axe', 'bow', 'gun', 'staff', 'shield', 'fist']

// Projectile glyphs — src/game/runtime/combat.ts PROJECTILE_GLYPHS = { bow: '➤', gun: '•' }, default '→'.
const PROJECTILE_GLYPHS: string[] = ['➤', '•', '→']

// Ability animations — the keys of ABILITY_TINT ARE the full AbilityAnimation set.
const ABILITY_ANIMATIONS: string[] = Object.keys(ABILITY_TINT)

describe('tile coverage guardrail — every world identifier resolves to an IMAGE under the emoji style', () => {
  it('the seed loaded and built an emoji style with image tiles', () => {
    expect(Object.keys(EMOJI_TILESET).length).toBeGreaterThan(30)
    expect(resolveVisual('grass', EMOJI_STYLE).kind).toBe('image') // sanity: baked terrain is an image
  })

  it('every ASSET TYPE (assetKind) resolves to an image', () => {
    const gaps = ASSET_TYPES.filter(type => !resolvesToImage(assetKind({ type })))
      .map(type => `${type} → ${assetKind({ type })}`)
    expect(gaps).toEqual([])
  })

  it('every CELL LABEL resolves to an image', () => {
    const gaps = (CELL_LABELS as readonly string[])
      .filter(label => !resolvesToImage(assetKind({ type: 'feature', label })))
      .map(label => `${label} → ${assetKind({ type: 'feature', label })}`)
    expect(gaps).toEqual([])
  })

  it('every MULTI-CELL asset (structure label) resolves to an image', () => {
    const gaps = MULTICELL_LABELS
      .filter(label => !resolvesToImage(assetKind({ type: 'structure', label })))
      .map(label => `${label} → ${assetKind({ type: 'structure', label })}`)
    expect(gaps).toEqual([])
  })

  it('every GROUND TYPE (groundKind) resolves to an image', () => {
    const gaps = GROUND_TYPES.filter(g => !resolvesToImage(groundKind(g)))
      .map(g => `${g} → ${groundKind(g)}`)
    expect(gaps).toEqual([])
  })

  it('the base ENTITY kinds resolve to an image', () => {
    const gaps = ['player', 'npc', 'enemy'].filter(k => !resolvesToImage(entityKind(k)))
    expect(gaps).toEqual([])
  })

  it('every ENEMY TYPE resolves to an image tile (per-type override)', () => {
    const gaps = ENEMY_TYPES.filter(type => {
      const id = enemyTileId(type, EMOJI_STYLE)
      return !id || resolveVisual('enemy', EMOJI_STYLE, id).kind !== 'image'
    })
    expect(gaps).toEqual([])
    // and the installed resolution map itself is populated (came from the backend, not bundled)
    expect(Object.keys(getEntityResolution().enemyTypeSlug).length).toBeGreaterThan(0)
  })

  it('every PERSON VARIANT resolves to an image tile', () => {
    const gaps = PERSON_VARIANTS.filter(variant => {
      const id = personVariantTileId(variant as EntityVariant, EMOJI_STYLE)
      return !id || resolveVisual('npc', EMOJI_STYLE, id).kind !== 'image'
    })
    expect(gaps).toEqual([])
  })

  it('every WEAPON glyph resolves to a baked image (drawn in-hand by char)', () => {
    const gaps = WEAPON_KINDS.filter(kind => {
      const char = EMOJI_TILESET[kind]?.char
      return !char || !glyphResolvesToImage(char)
    })
    expect(gaps).toEqual([])
  })

  it('every PROJECTILE glyph resolves to a baked image', () => {
    const gaps = PROJECTILE_GLYPHS.filter(g => !glyphResolvesToImage(g))
    expect(gaps).toEqual([])
  })

  it('every ABILITY ANIMATION resolves to an image tile', () => {
    const gaps = ABILITY_ANIMATIONS.filter(anim => !resolvesToImage(anim as ElementKind))
    expect(gaps).toEqual([])
  })

  it('the CONNECTOR / portal marker resolves to an image tile', () => {
    expect(resolvesToImage('connector' as ElementKind)).toBe(true)
  })
})
