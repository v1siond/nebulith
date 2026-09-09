/**
 * `styleTileImage` — the ONE tile-image resolver, identical in every art style.
 *
 * Alexander: "ascii is still screwed … we don't have tiles for grass, road and a bunch more", and later:
 * "all arts have the exact same behavior and engine and the only thing that changes is the tiles".
 *
 * ROOT CAUSE this pins: a tile identified by KIND rather than by LABEL — chiefly a FLOOR, a `type:'floor'`
 * GridAsset carrying only a `tileKey` (its ground kind), NO label and empty `art: ['']` — had no way to reach
 * its baked picture under ASCII. The old pair of helpers gated one to `style.id === 'emoji'`/ascii and the
 * caller gated the other to `FLOOR_TYPE`, so a label-less ASCII prop fell through to the legacy glyph drawers
 * (`'' || '?'` → the screen-filling `?` on grass/road, and the per-frame `measureText` that tanked ASCII FPS).
 *
 * There is now ONE resolver: the KEY picks the tile, the STYLE picks only which tileset to read. These assert
 * that, positively (every base ground kind and every prop kind resolves a baked image in BOTH styles) and
 * negatively (an unknown key resolves nothing rather than inventing an image).
 */
import { styleTileImage } from '@/engine/render/shared'
import { assetKind, ASCII_STYLE, EMOJI_STYLE, type Style } from '@/game/artStyle'
import { FLOOR_TYPE } from '@/engine/IsometricGrid'
import { useSeedTileset } from '@/__tests__/helpers/tilesetSeed'
import type { GridAsset } from '@/engine/IsometricGrid'

/** A floor asset exactly as makeFloorAsset builds it: empty art, no label, identity in tileKey. */
const floorOf = (tileKey: string): GridAsset =>
  ({ art: [''], col: 0, row: 0, type: FLOOR_TYPE, tileKey, heightLevel: 0, blocking: false } as GridAsset)

const STYLES: Style[] = [ASCII_STYLE, EMOJI_STYLE]

describe('styleTileImage — one resolver, same answer shape in every style', () => {
  useSeedTileset()

  const GROUND = ['grass', 'road', 'water', 'sand', 'path', 'snow']
  // The types that used to have bespoke frontend glyph art under ASCII (ISO_ASCII_DRAWERS / TOP_ASCII_DRAWERS).
  const PROP_KINDS = ['tree', 'lamp', 'bush', 'npc', 'flower', 'rock', 'crate', 'mushroom', 'crystal']

  for (const style of STYLES) {
    it(`resolves a baked image for every base ground kind under ${style.id} (no glyph fallback)`, () => {
      for (const g of GROUND) {
        const img = styleTileImage(assetKind(floorOf(g)), style)
        expect(img?.kind).toBe('image')
        expect(img?.src).toBeTruthy()
      }
    })

    it(`resolves a baked image for every legacy per-type prop kind under ${style.id}`, () => {
      const missing = PROP_KINDS.filter(k => !styleTileImage(k, style))
      expect(missing).toEqual([])
    })
  }

  it('normalizes ground variants to their kind and still resolves (road_center → road)', () => {
    for (const style of STYLES) expect(styleTileImage(assetKind(floorOf('road_center')), style)?.kind).toBe('image')
  })

  it('the two styles answer with the SAME shape and DIFFERENT art', () => {
    const a = styleTileImage('tree', ASCII_STYLE)!
    const e = styleTileImage('tree', EMOJI_STYLE)!
    expect(Object.keys(a).sort()).toEqual(Object.keys(e).sort())
    expect(a.src).not.toBe(e.src)
  })

  // ── negative paths ────────────────────────────────────────────────────────────
  it('a key with no tile resolves nothing in either style (stays a glyph, never invents an image)', () => {
    for (const style of STYLES) expect(styleTileImage('not_a_real_kind', style)).toBeUndefined()
  })

  it('an unknown STYLE id resolves nothing rather than guessing a tileset', () => {
    expect(styleTileImage('grass', { id: 'pixelpack', name: 'x', icon: '', map: {} })).toBeUndefined()
  })
})
