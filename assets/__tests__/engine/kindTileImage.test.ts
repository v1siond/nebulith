/**
 * ASCII FLOORS (grass / road / water / …) ARE BAKED-IMAGE TILES, NOT '?'. Alexander: "ascii is still screwed …
 * we don't have tiles for grass, road and a bunch more."
 *
 * ROOT CAUSE this pins: a FLOOR is a `type:'floor'` GridAsset carrying only a `tileKey` (its ground kind) —
 * NO label and empty `art: ['']`. ASCII resolves a KIND to nothing (`ASCII_STYLE.map` is empty by design →
 * passthrough), and the label→image path needs a label, so an ascii floor fell through to `drawIsoDefaultAscii`
 * → `'' || '?'` → the screen-filling `?` on grass/road. The baked ascii grass/road tiles DO exist in the DB
 * tileset (`ASCII_TILESET.tiles['grass'].image`) — the floor just never consulted them. Emoji floors work
 * because `emojiStyleMap()` resolves the kind. `kindTileImage` is the ascii counterpart: it resolves the baked
 * DB image for a KIND-identified tile (chiefly the floor), so the floor draws its picture like emoji does.
 */
import { kindTileImage } from '@/engine/render/shared'
import { assetKind, ASCII_STYLE, EMOJI_STYLE } from '@/game/artStyle'
import { FLOOR_TYPE } from '@/engine/IsometricGrid'
import { useSeedTileset } from '@/__tests__/helpers/tilesetSeed'
import type { GridAsset } from '@/engine/IsometricGrid'

/** A floor asset exactly as makeFloorAsset builds it: empty art, no label, identity in tileKey. */
const floorOf = (tileKey: string): GridAsset =>
  ({ art: [''], col: 0, row: 0, type: FLOOR_TYPE, tileKey, heightLevel: 0, blocking: false } as GridAsset)

describe('kindTileImage — the baked ASCII image for a KIND-identified (label-less) tile', () => {
  useSeedTileset()

  const GROUND = ['grass', 'road', 'water', 'sand', 'path', 'snow']

  it('resolves a baked image for every base ground kind under ASCII (no glyph fallback)', () => {
    for (const g of GROUND) {
      const img = kindTileImage(assetKind(floorOf(g)), ASCII_STYLE)
      expect(img?.kind).toBe('image')
      expect(img?.src).toBeTruthy()
    }
  })

  it('normalizes ground variants to their kind and still resolves (road_center → road)', () => {
    const img = kindTileImage(assetKind(floorOf('road_center')), ASCII_STYLE)
    expect(img?.kind).toBe('image')
  })

  it('returns undefined for EMOJI — emoji already resolves the kind via emojiStyleMap (adv.image)', () => {
    expect(kindTileImage(assetKind(floorOf('grass')), EMOJI_STYLE)).toBeUndefined()
  })

  it('returns undefined for a kind with no baked ascii tile (stays a glyph, never invents an image)', () => {
    expect(kindTileImage('not_a_real_kind' as never, ASCII_STYLE)).toBeUndefined()
  })
})
