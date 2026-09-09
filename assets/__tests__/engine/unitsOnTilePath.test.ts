/**
 * UNITS RESOLVE THEIR BACKEND TILE, IN EVERY STYLE (T-125's last sub-item).
 *
 * Alexander, on the remaining ASCII-specific path: *"it just means we don't load anything until backend data
 * comes in, the fallback is still ascii, but the backend image tile, as it should."*
 *
 * So the glyph art in `engine/entityArt.ts` is a PRE-LOAD state, not the destination. A unit is a tile like
 * everything else: `npc` / `enemy` / `player` are real backend rows, and once the tileset is loaded the
 * entity draws that baked image in ascii exactly as it does in emoji. Only while nothing is loaded does the
 * glyph show.
 *
 * That is what these tests pin: with a tileset loaded, the entity resolves an IMAGE in BOTH styles; with
 * nothing loaded, it resolves neither image nor char, so the caller's pre-load figure still renders.
 */
import { clearStyleCatalogs, installStyleTiles } from '@/engine/tileset/styleTiles'
import { resolveEntityDraw } from '@/engine/render/shared'
import { styleById } from '@/game/artStyle'

const ascii = styleById('ascii')
const emoji = styleById('emoji')

const UNIT_KINDS = ['npc', 'enemy', 'player'] as const

/** The three unit rows for one style. IDENTICAL in shape for every style — only the URL differs, which is
 *  the whole definition of a style. This helper used to be two: an ascii one nesting `{glyph, image:{src}}`
 *  under a `tiles` map, and an emoji one with a flat `{char, image}` row. There was never a reason for two. */
const unitsFor = (style: string): Record<string, { char: string; category: string; image: string }> =>
  Object.fromEntries(UNIT_KINDS.map(label => [
    label,
    { char: '@', category: 'units', image: `/tiles/${style}/${label}.png` },
  ]))

const loadUnits = (): void => { installStyleTiles('ascii', unitsFor('ascii')); installStyleTiles('emoji', unitsFor('emoji')) }

const draw = (kind: string, style: typeof ascii) =>
  resolveEntityDraw(kind as never, style, null, null, '', '#ffffff')

afterEach(clearStyleCatalogs)

describe('a loaded unit tile is drawn as an IMAGE, in both styles', () => {
  beforeEach(loadUnits)

  it.each(['npc', 'enemy', 'player'])('ascii resolves the backend image for %s', kind => {
    expect(draw(kind, ascii).image?.src).toBe(`/tiles/ascii/${kind}.png`)
  })

  it.each(['npc', 'enemy', 'player'])('emoji resolves the backend image for %s', kind => {
    expect(draw(kind, emoji).image?.src).toBe(`/tiles/emoji/${kind}.png`)
  })

  it('differs between the styles ONLY by the URL — that is what a style is', () => {
    const a = draw('enemy', ascii)
    const e = draw('enemy', emoji)
    expect(a.image?.src).not.toBe(e.image?.src)
    expect(Boolean(a.image)).toBe(Boolean(e.image))
  })
})

describe('before the backend answers, nothing is invented', () => {
  it('resolves no image and no char, so the caller draws its pre-load figure', () => {
    const d = draw('enemy', ascii) // nothing installed — the pre-load state
    expect(d.image).toBeUndefined()
    expect(d.char).toBe('')
  })

  it('a kind the backend serves no tile for stays unresolved rather than borrowing another tile', () => {
    loadUnits()
    expect(draw('dragonrider', ascii).image).toBeUndefined()
  })
})
