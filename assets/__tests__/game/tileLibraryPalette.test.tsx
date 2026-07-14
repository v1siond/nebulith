/**
 * The Tile Library SIDEBAR must read its tiles ONLY from the backend-loaded tilesets (EMOJI_TILESET /
 * ASCII_TILESET — swapped in by tilesetLoader from the :4000 DB), the SAME source the MAP renders from,
 * with NOTHING art-related hardcoded on the frontend (user directive; MAP-MODEL §4 "art comes from the DB
 * tileset, the front end hardcodes nothing"; TILE-VOCABULARY-CONTRACT "one source generates the rest").
 *
 * Guards:
 *   G3 (Image #15) — emoji image tiles render their baked art (an <img>), never a 🖼 placeholder box.
 *   G4 (Image #16) — the list is DERIVED from the loaded tileset, so it always matches the map (no stale
 *                    hardcoded copy like the old ASCII_TILE_GLYPHS / emojiCatalog.json).
 */
import { render, screen } from '@testing-library/react'
import { TilePalette } from '@/components/game/editorChrome'
import { tilesForStyle, visualForTileId, rebuildEmojiStyle } from '@/game/artStyle'
import { EMOJI_TILESET, setEmojiTileset } from '@/engine/tileset/emojiTileset'
import { ASCII_TILESET, setAsciiTileset } from '@/engine/tileset/asciiTileset'

const origEmoji = EMOJI_TILESET
const origAscii = ASCII_TILESET
afterEach(() => { setEmojiTileset(origEmoji); rebuildEmojiStyle(); setAsciiTileset(origAscii) })

describe('Tile Library sidebar reads ONLY the backend-loaded tileset (G3/G4)', () => {
  it('emoji sidebar derives from the loaded tileset — image art, DB labels, no hardcoded-catalog leak', () => {
    setEmojiTileset({
      grass: { char: '🍀', color: '#5faf4a', image: '/tiles/emoji/baked/grass.png', category: 'terrain', title: 'Grass' },
      db_only: { char: '🆕', color: '#123456', image: '/tiles/emoji/catalog/db_only.png', category: 'nature', title: 'DB Only' },
      internal_no_cat: { char: '?', color: '#000000' }, // no category → NOT browseable
    })
    rebuildEmojiStyle()

    const all = Object.values(tilesForStyle('emoji')).flat()
    // a tile present ONLY in the loaded tileset shows up (proves the sidebar reads the backend), with its DB title/category
    const dbOnly = all.find(t => t.id === 'emoji:db_only')
    expect(dbOnly).toBeDefined()
    expect(dbOnly!.label).toBe('DB Only')
    expect(dbOnly!.category).toBe('nature')
    // a non-categorised internal entry is not browseable
    expect(all.find(t => t.id === 'emoji:internal_no_cat')).toBeUndefined()
    // a formerly-hardcoded catalog tile that is NOT in the loaded tileset must not leak in
    expect(all.find(t => t.id === 'emoji:alien')).toBeUndefined()
    // visualForTileId resolves from the loaded tileset too (image tile → ImageVisual)
    expect(visualForTileId('emoji:db_only')).toEqual({ kind: 'image', src: '/tiles/emoji/catalog/db_only.png', color: '#123456', char: '🆕' })

    // G3 render: image tiles draw their baked art (<img>), never the 🖼 placeholder
    render(<TilePalette styleId="emoji" styleName="Emoji" armedId={null} onArm={() => {}} />)
    expect(screen.queryAllByText('🖼')).toHaveLength(0)
    const btn = screen.getByTitle('Grass (emoji:grass)')
    expect(btn.querySelector('img')?.getAttribute('src')).toBe('/tiles/emoji/baked/grass.png')
  })

  it('ascii sidebar derives from the loaded ascii tileset (glyph + title from the DB, not a hardcoded map)', () => {
    setAsciiTileset({
      id: 'ascii', name: 'ASCII',
      tiles: {
        grass: { label: 'grass', glyph: '"', position: 'single', walkable: true, colorRole: 'x', category: 'terrain', title: 'Grass' },
        tree_top: { label: 'tree_top', glyph: '♣', position: 'single', walkable: true, colorRole: 'canopy' }, // no category → internal, excluded
      },
      palettes: {}, terrain: {},
    })
    const all = Object.values(tilesForStyle('ascii')).flat()
    const grass = all.find(t => t.id === 'ascii:grass')
    expect(grass).toBeDefined()
    expect(grass!.label).toBe('Grass')
    expect(grass!.visual).toEqual({ kind: 'glyph', char: '"' })
    // internal cell-labels (no category) are excluded from the sidebar
    expect(all.find(t => t.id === 'ascii:tree_top')).toBeUndefined()
  })
})
