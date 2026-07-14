import '@/__tests__/helpers/installTilesetSeed' // install the DB-equivalent tileset the runtime loads
/**
 * "EVERYTHING RESKINS" for placed UNITS (Task B). A brush-placed unit carries a FROZEN `tileOverride`
 * (e.g. `emoji:goblin`) on a DIFFERENT path from placed assets: the 3 views used
 * `entity.tileOverride ?? entityStyleOverride(entity, style)` straight into resolveDraw, so the pin won
 * over the active style even under ASCII — the unit stayed frozen to the style it was placed in.
 *
 * resolveEntityDraw now re-homes the pin's SLUG onto the ACTIVE style (the same activeStyleVisualForOverride
 * as placed assets): a style with per-slug art keeps the identity (reskinned), a style without it falls back
 * to the KIND in the active style. A unit with NO pin resolves byte-identically to the old
 * resolveDraw(kind, style, entityStyleOverride). Nothing STORED on the entity changes.
 */
import { resolveEntityDraw, resolveAssetDraw, resolveDraw, drawFromVisual } from '@/engine/render/shared'
import { ASCII_STYLE, EMOJI_STYLE, entityKind, entityStyleOverride, visualForTileId } from '@/game/artStyle'

// Precondition the catalog id format this suite relies on — if it ever drifts the tests fail loudly
// instead of silently passing on a null lookup.
describe('catalog preconditions', () => {
  test('emoji has a per-slug goblin tile; ASCII does NOT (kind-only catalog)', () => {
    expect(visualForTileId('emoji:goblin')).not.toBeNull()
    expect(visualForTileId('ascii:goblin')).toBeNull()
  })
})

describe('resolveEntityDraw — a placed unit re-homes its pin onto the active style', () => {
  const enemyKind = entityKind('enemy') // 'enemy'

  test('a unit pinned emoji:goblin keeps its IDENTITY under EMOJI (the goblin tile, reskinned to itself)', () => {
    const edv = resolveEntityDraw(enemyKind, EMOJI_STYLE, 'emoji:goblin', 'emoji:goblin', '', '#fff')
    expect(edv).toEqual(drawFromVisual(visualForTileId('emoji:goblin')!, '', '#fff'))
    expect(edv.image).toBeDefined() // goblin is a baked entity PNG
  })

  test('under ASCII the pin FALLS BACK to the coarse kind (the ascii enemy), NOT the frozen emoji goblin', () => {
    // No ascii:goblin → re-home returns null → resolveDraw(kind, ASCII, styleOverride). Under ASCII the
    // enemy styleOverride is undefined, so this is the ASCII passthrough (the view's own default glyph).
    const styleOverride = entityStyleOverride({ kind: 'enemy', enemyType: 'goblin' }, ASCII_STYLE) // undefined under ascii
    const edv = resolveEntityDraw(enemyKind, ASCII_STYLE, 'emoji:goblin', styleOverride, 'X', '#abc')
    expect(edv.image).toBeUndefined()
    expect(edv).toEqual(resolveDraw(enemyKind, ASCII_STYLE, undefined, 'X', '#abc'))
    expect(edv.char).toBe('X') // the passthrough default the view draws for its own ASCII figure
  })

  test('reskin follows the toggle: emoji → ascii → emoji returns to the goblin tile', () => {
    const underEmoji = resolveEntityDraw(enemyKind, EMOJI_STYLE, 'emoji:goblin', 'emoji:goblin', '', '#fff')
    const underAscii = resolveEntityDraw(enemyKind, ASCII_STYLE, 'emoji:goblin', undefined, '', '#fff')
    const backEmoji = resolveEntityDraw(enemyKind, EMOJI_STYLE, 'emoji:goblin', 'emoji:goblin', '', '#fff')
    expect(underAscii.image).toBeUndefined()
    expect(backEmoji).toEqual(underEmoji)
    expect(backEmoji.image).toBeDefined()
  })

  test('when a pin IS present, a unit resolves like a placed ASSET (same slug-rehoming funnel)', () => {
    // resolveEntityDraw and resolveAssetDraw share activeStyleVisualForOverride, so a pinned unit and a
    // pinned asset with the SAME override resolve to the same visual under the same style. (styleOverride is
    // the REAL per-style default — undefined under ASCII — so the ASCII kind-fallback matches the asset's.)
    for (const style of [ASCII_STYLE, EMOJI_STYLE]) {
      const styleOverride = entityStyleOverride({ kind: 'enemy', enemyType: 'goblin' }, style)
      expect(resolveEntityDraw(enemyKind, style, 'emoji:goblin', styleOverride, '', '#fff'))
        .toEqual(resolveAssetDraw(enemyKind, style, 'emoji:goblin', '', '#fff'))
    }
  })
})

describe('resolveEntityDraw — NO pin is byte-identical to the old style-derived default', () => {
  test('no tileOverride → exactly resolveDraw(kind, style, entityStyleOverride) in both styles', () => {
    for (const style of [ASCII_STYLE, EMOJI_STYLE]) {
      const styleOverride = entityStyleOverride({ kind: 'enemy', enemyType: 'goblin' }, style)
      expect(resolveEntityDraw(entityKind('enemy'), style, undefined, styleOverride, '>', '#e33'))
        .toEqual(resolveDraw(entityKind('enemy'), style, styleOverride, '>', '#e33'))
      // a person (npc) too — the variant-derived override is preserved
      const personOverride = entityStyleOverride({ kind: 'npc', variant: 'old' }, style)
      expect(resolveEntityDraw(entityKind('npc'), style, null, personOverride, '>', '#8cf'))
        .toEqual(resolveDraw(entityKind('npc'), style, personOverride, '>', '#8cf'))
    }
  })
})
