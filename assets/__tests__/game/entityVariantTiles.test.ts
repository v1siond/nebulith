import '@/__tests__/helpers/installTilesetSeed' // install the DB-equivalent tileset the runtime loads
/**
 * Entities as IMAGES: typed enemies (goblin/wolf/…) and person VARIANTS (male/female + age/exotic)
 * now resolve to baked Noto PNGs, not live glyphs — so they render identically on every OS (no Segoe
 * tofu). These assert the resolution returns an ImageVisual pointing at a bundled PNG that exists on
 * disk, that a variant/type with no baked tile falls back to the BASE figure (never a raw glyph), and
 * that the shared entityStyleOverride routes enemies by type and people by variant.
 */
import fs from 'fs'
import path from 'path'
import {
  EMOJI_STYLE,
  ASCII_STYLE,
  resolveVisual,
  enemyTileId,
  personVariantTileId,
  entityStyleOverride,
  bakedEntityImage,
  type ImageVisual,
} from '@/game/artStyle'
import type { EntityVariant } from '@/game/types'

const PUBLIC_DIR = path.join(__dirname, '../../../public')
const onDisk = (src: string): boolean => fs.existsSync(path.join(PUBLIC_DIR, src.replace(/^\//, '')))

describe('typed enemies resolve to baked images', () => {
  // enemyType → the glyph the baked tile shows (spot-check the roster + a few aliases).
  const cases: [string, string][] = [
    ['goblin', '👺'], ['wolf', '🐺'], ['bandit', '🥷'], ['skeleton', '💀'],
    ['bat', '🦇'], ['spider', '🕷️'], ['guardian', '🗿'], ['dragon', '🐉'], ['slime', '👾'],
  ]
  test.each(cases)('%s → an ImageVisual whose PNG exists', (type, char) => {
    const v = resolveVisual('enemy', EMOJI_STYLE, enemyTileId(type, EMOJI_STYLE))
    expect(v.kind).toBe('image')
    const img = v as ImageVisual
    expect(img.src).toMatch(/\/tiles\/emoji\/(baked|catalog)\/.*\.png$/) // a baked Noto PNG (entity or catalog dir — a slug can be both)
    expect(img.char).toBe(char) // source glyph kept as label + first-paint fallback
    expect(onDisk(img.src)).toBe(true)
  })

  it('an unmapped enemy type → no override → the base 👾 enemy tile (never a broken image)', () => {
    expect(enemyTileId('nonesuch', EMOJI_STYLE)).toBeUndefined()
    expect(resolveVisual('enemy', EMOJI_STYLE, undefined)).toMatchObject({ char: '👾' })
  })

  it('ASCII keeps its own enemy art (no override)', () => {
    expect(enemyTileId('goblin', ASCII_STYLE)).toBeUndefined()
  })
})

describe('person variants resolve to baked images', () => {
  const variants: EntityVariant[] = ['male', 'female', 'old', 'child', 'alien', 'robot']
  test.each(variants)('%s → an ImageVisual whose PNG exists', (variant) => {
    const id = personVariantTileId(variant, EMOJI_STYLE)
    expect(id).toBeTruthy()
    const v = resolveVisual('npc', EMOJI_STYLE, id!)
    expect(v.kind).toBe('image')
    expect(onDisk((v as ImageVisual).src)).toBe(true)
  })

  it('no variant / ASCII → no override → the base figure (fallback, never a raw glyph)', () => {
    expect(personVariantTileId(undefined, EMOJI_STYLE)).toBeUndefined()
    expect(personVariantTileId('male', ASCII_STYLE)).toBeUndefined()
  })
})

describe('entityStyleOverride routes enemies by type, people by variant', () => {
  it('an enemy → its per-type tile id', () => {
    expect(entityStyleOverride({ kind: 'enemy', enemyType: 'wolf' }, EMOJI_STYLE)).toBe(
      enemyTileId('wolf', EMOJI_STYLE),
    )
  })
  it('a person → its per-variant tile id', () => {
    expect(entityStyleOverride({ kind: 'npc', variant: 'female' }, EMOJI_STYLE)).toBe(
      personVariantTileId('female', EMOJI_STYLE),
    )
  })
  it('a plain (variant-less) person → undefined → the base figure', () => {
    expect(entityStyleOverride({ kind: 'player' }, EMOJI_STYLE)).toBeUndefined()
  })
})

describe('bakedEntityImage only points at PNGs that were actually baked', () => {
  it('a baked slug → an existing PNG; an unbaked slug → undefined', () => {
    const src = bakedEntityImage('goblin')
    expect(src).toBeTruthy()
    expect(onDisk(src!)).toBe(true)
    expect(bakedEntityImage('definitely-not-a-baked-slug')).toBeUndefined()
  })
})
