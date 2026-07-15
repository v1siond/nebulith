import '@/__tests__/helpers/installTilesetSeed' // install the DB-equivalent tileset the runtime loads
/**
 * "EVERYTHING RESKINS" for PLACED tiles — a placed catalog tile's `tileOverride` embeds the STYLE it was
 * picked in (`emoji:pine-tree`), which used to FREEZE it: switching the art style (🎨) left the placed
 * tile stuck as emoji. The render sites now re-home the override onto the ACTIVE style via
 * activeStyleVisualForOverride / resolveAssetDraw, so a placed tile follows the world's style —
 * keeping its identity where the target style has per-slug art, and falling back to the coarse kind
 * (the ascii TREE, not the frozen emoji) where it does not. Nothing STORED on the asset changes.
 */
import { activeStyleVisualForOverride, resolveAssetDraw, resolveDraw } from '@/engine/render/shared'
import { ASCII_STYLE, EMOJI_STYLE, visualForTileId } from '@/game/artStyle'

describe('activeStyleVisualForOverride — re-home a placed tile onto the active style', () => {
  test('emoji:pine-tree keeps its IDENTITY under emoji (the pine-tree tile, reskinned to itself)', () => {
    const v = activeStyleVisualForOverride('emoji:pine-tree', EMOJI_STYLE)
    expect(v).not.toBeNull()
    expect(v).toEqual(visualForTileId('emoji:pine-tree')) // the catalog pine-tree, exactly
    expect(v!.kind).toBe('image') // pine-tree is a baked catalog PNG
    expect((v as { src: string }).src).toContain('pine-tree')
  })

  test('emoji:pine-tree has NO per-slug art under ASCII → null (signals the coarse-kind fallback)', () => {
    // ASCII's catalog is per-KIND (ascii:tree), not per-slug — there is no ascii:pine-tree.
    expect(visualForTileId('ascii:pine-tree')).toBeNull()
    expect(activeStyleVisualForOverride('emoji:pine-tree', ASCII_STYLE)).toBeNull()
  })

  test('round-trip emoji → ascii → emoji returns to the same pine-tree visual (nothing stored changed)', () => {
    const first = activeStyleVisualForOverride('emoji:pine-tree', EMOJI_STYLE)
    expect(activeStyleVisualForOverride('emoji:pine-tree', ASCII_STYLE)).toBeNull()
    const back = activeStyleVisualForOverride('emoji:pine-tree', EMOJI_STYLE)
    expect(back).toEqual(first)
  })

  test('a slug present in BOTH styles reskins to EACH (rock → the emoji rock, then the ascii glyph)', () => {
    const emojiRock = activeStyleVisualForOverride('emoji:rock', EMOJI_STYLE)
    const asciiRock = activeStyleVisualForOverride('emoji:rock', ASCII_STYLE)
    expect(emojiRock).not.toBeNull()
    expect(asciiRock).toEqual({ kind: 'glyph', char: '▓' }) // the ascii:rock catalog glyph
    expect(emojiRock).not.toEqual(asciiRock) // it genuinely changes with the style
    // and picking it under ascii round-trips back to the emoji rock under emoji
    expect(activeStyleVisualForOverride('ascii:rock', EMOJI_STYLE)).toEqual(emojiRock)
  })

  test('an unknown slug (no art in any style) → null', () => {
    expect(activeStyleVisualForOverride('emoji:definitely-not-a-real-slug', EMOJI_STYLE)).toBeNull()
  })
})

describe('resolveAssetDraw — the placed-asset draw funnel the 3 views use', () => {
  test('placed emoji pine-tree draws the emoji pine-tree IMAGE under emoji', () => {
    const adv = resolveAssetDraw('tree', EMOJI_STYLE, 'emoji:pine-tree', '', '#ffffff')
    expect(adv.image).toBeDefined()
    expect(adv.image!.src).toContain('pine-tree')
  })

  test('placed emoji pine-tree FALLS BACK to the ascii TREE (coarse kind) under ASCII', () => {
    // No ascii:pine-tree → resolveAssetDraw drops to resolveDraw('tree', ASCII, undefined): the ASCII
    // passthrough, i.e. the caller's own default (its dedicated per-type tree draw), NOT a frozen emoji.
    const adv = resolveAssetDraw('tree', ASCII_STYLE, 'emoji:pine-tree', 'DEF', '#abcabc')
    expect(adv.image).toBeUndefined()
    expect(adv.tint).toBeUndefined()
    expect(adv).toEqual(resolveDraw('tree', ASCII_STYLE, undefined, 'DEF', '#abcabc'))
    expect(adv.char).toBe('DEF') // the passthrough default the view uses for its own tree art
  })

  test('back under emoji the placed pine-tree is the emoji tile again (reskin follows the toggle)', () => {
    const underAscii = resolveAssetDraw('tree', ASCII_STYLE, 'emoji:pine-tree', '', '#ffffff')
    const backEmoji = resolveAssetDraw('tree', EMOJI_STYLE, 'emoji:pine-tree', '', '#ffffff')
    expect(underAscii.image).toBeUndefined()
    expect(backEmoji.image?.src).toContain('pine-tree')
  })

  test('no override → identical to a plain no-override resolveDraw (placement path is a pure superset)', () => {
    expect(resolveAssetDraw('rock', EMOJI_STYLE, undefined, 'X', '#111'))
      .toEqual(resolveDraw('rock', EMOJI_STYLE, undefined, 'X', '#111'))
    expect(resolveAssetDraw('rock', ASCII_STYLE, null, 'X', '#111'))
      .toEqual(resolveDraw('rock', ASCII_STYLE, undefined, 'X', '#111'))
  })

  test('TERRAIN is unaffected — a ground kind with no asset override resolves exactly as before', () => {
    for (const style of [ASCII_STYLE, EMOJI_STYLE]) {
      expect(resolveAssetDraw('grass', style, undefined, 'g', '#3a5'))
        .toEqual(resolveDraw('grass', style, undefined, 'g', '#3a5'))
      expect(resolveAssetDraw('water', style, undefined, 'w', '#28c'))
        .toEqual(resolveDraw('water', style, undefined, 'w', '#28c'))
    }
  })
})
