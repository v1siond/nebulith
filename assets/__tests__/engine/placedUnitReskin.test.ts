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
// A slug that exists in NEITHER style — the only way left to exercise the coarse-kind fallback now that the
// vocabulary is fully 1:1 (every emoji label has an ascii tile, so no real label can be missing from a style).
const NO_SUCH_SLUG = 'definitely-not-a-real-slug'

describe('catalog preconditions', () => {
  test('BOTH styles have a per-slug goblin tile — the vocabulary is 1:1', () => {
    // The parity pass gave every emoji label its own ascii art, so a placed goblin re-homes onto a REAL ascii
    // goblin instead of degrading to the generic enemy figure. Only the art differs between the two.
    expect(visualForTileId('emoji:goblin')).not.toBeNull()
    expect(visualForTileId('ascii:goblin')).not.toBeNull()
    expect(visualForTileId('ascii:goblin')).not.toEqual(visualForTileId('emoji:goblin'))
  })

  test('a slug in NEITHER style resolves to nothing (the fallback precondition)', () => {
    expect(visualForTileId(`ascii:${NO_SUCH_SLUG}`)).toBeNull()
    expect(visualForTileId(`emoji:${NO_SUCH_SLUG}`)).toBeNull()
  })
})

describe('resolveEntityDraw — a placed unit re-homes its pin onto the active style', () => {
  const enemyKind = entityKind('enemy') // 'enemy'

  test('a unit pinned emoji:goblin keeps its IDENTITY under EMOJI (the goblin tile, reskinned to itself)', () => {
    const edv = resolveEntityDraw(enemyKind, EMOJI_STYLE, 'emoji:goblin', 'emoji:goblin', '', '#fff')
    expect(edv).toEqual(drawFromVisual(visualForTileId('emoji:goblin')!, '', '#fff'))
    expect(edv.image).toBeDefined() // goblin is a baked entity PNG
  })

  test('under ASCII the pin RE-HOMES onto the ascii goblin — not frozen emoji, not a generic enemy', () => {
    // ascii:goblin now exists, so re-homing keeps the unit's IDENTITY across the style toggle: it draws the
    // ascii goblin's own art rather than the view's generic enemy figure ('X').
    const styleOverride = entityStyleOverride({ kind: 'enemy', enemyType: 'goblin' }, ASCII_STYLE)
    const edv = resolveEntityDraw(enemyKind, ASCII_STYLE, 'emoji:goblin', styleOverride, 'X', '#abc')
    expect(edv.image).toBeUndefined() // ascii art is a glyph here, not the frozen emoji PNG
    expect(edv).toEqual(drawFromVisual(visualForTileId('ascii:goblin')!, 'X', '#abc'))
    expect(edv.char).not.toBe('X')    // it is the goblin's OWN ascii art, not the passthrough default
  })

  test('a pin whose slug exists in NEITHER style falls back to the coarse kind (no invented art)', () => {
    const styleOverride = entityStyleOverride({ kind: 'enemy', enemyType: 'goblin' }, ASCII_STYLE)
    const edv = resolveEntityDraw(enemyKind, ASCII_STYLE, `emoji:${NO_SUCH_SLUG}`, styleOverride, 'X', '#abc')
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
