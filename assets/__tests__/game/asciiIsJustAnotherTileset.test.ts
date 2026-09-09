/**
 * THE INVARIANT: an art style is a SET OF BAKED IMAGES and nothing else.
 *
 * Alexander: *"all arts have the exact same behavior and engine and the only thing that changes is the
 * tiles … changing from emoji to ascii shouldn't make a difference whatsoever, because we're just saying
 * 'use this set of images instead of this other one'."*
 *
 * So `visualForTileId` / `tilesForStyle` MUST build the SAME `Visual` shape for both styles from the tile's
 * own baked `image` — the only difference being the URL. ASCII used to DISCARD the baked image and return a
 * raw `{kind:'glyph'}`, which (a) made every hand-painted / stage-prop tile image-less under ASCII, (b)
 * therefore missed the cube-sprite cache (gated on `dv.image`), and (c) dropped it into the per-face
 * clip+fillText path — the 2.46× slower ASCII render.
 *
 * These assert BEHAVIOUR against the captured `/api/tilesets` fixture (the real backend rows), positive and
 * negative: a tile WITH a baked image resolves an image Visual in EITHER style; a tile WITHOUT one still
 * resolves its glyph (the documented last-resort fallback); an unknown id resolves nothing.
 */
import { makeStyleTile, setStyleCatalog, styleCatalog, styleTile, styleTiles } from '@/engine/tileset/styleTiles'
import '@/__tests__/helpers/installTilesetSeed'
import { tilesForStyle, visualForTileId, TILE_CATEGORIES, type Visual } from '@/game/artStyle'

/** A label the fixture carries a baked ASCII image for (asserted, so the test can't silently no-op). */
const BAKED = 'tree'

describe('visualForTileId — both styles build the SAME Visual from the tile’s baked image', () => {
  it('an ASCII tile with a baked image resolves an IMAGE visual pointing at its own PNG', () => {
    const src = styleTile('ascii', BAKED)?.image // ONE field, a plain URL — the same in every style
    expect(src).toBeTruthy() // guard: the fixture really does bake this tile

    const v = visualForTileId(`ascii:${BAKED}`)
    expect(v).toEqual(expect.objectContaining({ kind: 'image', src }))
  })

  it('the emoji twin resolves the SAME visual SHAPE — only the src differs', () => {
    const a = visualForTileId(`ascii:${BAKED}`)!
    const e = visualForTileId(`emoji:${BAKED}`)!
    expect(a.kind).toBe('image')
    expect(e.kind).toBe('image')
    expect((a as { src: string }).src).not.toBe((e as { src: string }).src) // different art…
    expect(Object.keys(a).sort()).toEqual(Object.keys(e).sort())            // …identical shape
  })

  it('EVERY label present in both tilesets resolves the SAME Visual kind in both styles', () => {
    const shared = Object.keys(styleTiles('ascii')).filter(k => k in styleTiles('emoji'))
    expect(shared.length).toBeGreaterThan(100) // guard: the fixture really is the full catalog

    const mismatched = shared.filter(k => visualForTileId(`ascii:${k}`)?.kind !== visualForTileId(`emoji:${k}`)?.kind)
    expect(mismatched).toEqual([])
  })

  // ── negative paths ────────────────────────────────────────────────────────────
  it('a tile with NO baked image falls back to its glyph — the documented last resort', () => {
    const saved = styleCatalog('ascii')
    setStyleCatalog({ ...saved, tiles: { ...saved.tiles, orphan: makeStyleTile('orphan', { char: '¤', position: 'single', walkable: true, colorRole: '' }) } })
    try {
      expect(visualForTileId('ascii:orphan')).toEqual({ kind: 'glyph', char: '¤', color: undefined })
    } finally {
      setStyleCatalog(saved)
    }
  })

  it('an unknown tile id / a malformed id resolves nothing (the caller falls back to the kind)', () => {
    expect(visualForTileId('ascii:definitely-not-a-tile')).toBeNull()
    expect(visualForTileId('no-separator')).toBeNull()
  })
})

describe('tilesForStyle — the Tile Library describes an ASCII tile as fully as an emoji one', () => {
  const flat = (styleId: string): { id: string; visual: Visual; height?: number }[] =>
    TILE_CATEGORIES.flatMap(c => tilesForStyle(styleId)[c])

  it('browseable ASCII tiles carry their baked IMAGE visual, not a bare glyph', () => {
    const withGlyphOnly = flat('ascii').filter(t => t.visual.kind === 'glyph')
    expect(withGlyphOnly).toEqual([])
  })

  it('an ASCII palette tile carries the DB block HEIGHT (so a painted tile matches a generated one)', () => {
    // The brush seeds a painted asset's height from the palette tile. ASCII used to push NO height at all
    // (only emoji did), so an ASCII-painted block came out flat where the emoji-painted twin came out a
    // cube — a per-style behaviour difference in the DATA the palette reports.
    const wrong = flat('ascii')
      .map(t => ({ slug: t.id.slice(t.id.indexOf(':') + 1), got: t.height }))
      .filter(({ slug, got }) => got !== styleTile('ascii', slug)?.height)
    expect(wrong).toEqual([])
    expect(flat('ascii').some(t => (t.height ?? 0) > 0)).toBe(true) // guard: heights really are populated
  })
})
