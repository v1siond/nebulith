/**
 * Regression: emoji leaked into the ASCII style. Auto-generated ground_decor litter is force-given a
 * STYLE-SPECIFIC emoji tileOverride (e.g. 🌼 'emoji:blossom') at generation; resolveVisual lets an
 * override beat the active style — even ASCII — so the decor drew 🌼 in ASCII too. assetOverride() gates
 * the AUTO decor override at render time: dropped under ASCII (decor shows its dingbat), kept under Emoji.
 * Manual pins on other assets are untouched (they intentionally win over the active style).
 */
import { assetOverride } from '@/engine/render/shared'
import { ASCII_STYLE, EMOJI_STYLE } from '@/game/artStyle'
import type { GridAsset } from '@/engine/IsometricGrid'

const asset = (over: Partial<GridAsset>): GridAsset =>
  ({ type: 'ground_decor', col: 0, row: 0, char: ['✿'], ...over } as unknown as GridAsset)

describe('assetOverride — a ground_decor auto emoji-override must not leak into ASCII', () => {
  test('ground_decor emoji override is DROPPED under ASCII (decor shows its dingbat)', () => {
    const decor = asset({ type: 'ground_decor', tileOverride: 'emoji:blossom' })
    expect(assetOverride(decor, ASCII_STYLE)).toBeUndefined()
  })

  test('ground_decor emoji override is KEPT under Emoji (decor shows 🌼)', () => {
    const decor = asset({ type: 'ground_decor', tileOverride: 'emoji:blossom' })
    expect(assetOverride(decor, EMOJI_STYLE)).toBe('emoji:blossom')
  })

  test('a manual pin on a NON-decor asset is untouched, even under ASCII', () => {
    const tree = asset({ type: 'tree', tileOverride: 'emoji:water' })
    expect(assetOverride(tree, ASCII_STYLE)).toBe('emoji:water')
  })
})
