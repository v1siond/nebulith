/**
 * The Tile Library SIDEBAR must read its tiles ONLY from the backend-loaded tilesets (styleTiles('emoji') /
 * styleCatalog('ascii') — swapped in by tilesetLoader from the :4000 DB), the SAME source the MAP renders from,
 * with NOTHING art-related hardcoded on the frontend (user directive; MAP-MODEL §4 "art comes from the DB
 * tileset, the front end hardcodes nothing"; TILE-VOCABULARY-CONTRACT "one source generates the rest").
 *
 * Guards:
 *   G3 (Image #15) — emoji image tiles render their baked art (an <img>), never a 🖼 placeholder box.
 *   G4 (Image #16) — the list is DERIVED from the loaded tileset, so it always matches the map (no stale
 *                    hardcoded copy like the old ASCII_TILE_GLYPHS / emojiCatalog.json).
 */
import { clearStyleCatalogs, installStyleTiles } from '@/engine/tileset/styleTiles'
import { render, screen } from '@testing-library/react'
import { TilePalette, TileLibraryBody } from '@/components/game/editorChrome'
import { tilesForStyle, visualForTileId, rebuildEmojiStyle } from '@/game/artStyle'

// Every case installs its rows through `installStyleTiles` — the ONE store's own door, the same one the
// loader uses. Nothing here hand-builds a catalog shape, so a change to `StyleTile` breaks these tests
// instead of being quietly translated away by a test-local shim.
afterEach(clearStyleCatalogs)

describe('Tile Library sidebar reads ONLY the backend-loaded tileset (G3/G4)', () => {
  it('emoji sidebar derives from the loaded tileset — image art, DB labels, no hardcoded-catalog leak', () => {
    installStyleTiles('emoji', {
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
    const btn = screen.getByTitle('Grass')
    expect(btn.querySelector('img')?.getAttribute('src')).toBe('/tiles/emoji/baked/grass.png')
  })

  // User: "we have 'enemy' tiles, outside of the 'units' option from the top nav … the paint should work for
  // regular tiles." The PAINT palette must list REGULAR tiles ONLY (every browseable bucket EXCEPT units —
  // terrain / roads / floors / walls / … / nature / props) — units (player / enemies / NPCs) are placed via
  // the top-nav ◈ Unit flow, never armed as a paint brush.
  it('the Paint palette lists REGULAR tiles only — no unit/enemy tiles (units come from the top-nav)', () => {
    installStyleTiles('emoji', {
      grass: { char: '🍀', color: '#5faf4a', image: '/tiles/emoji/baked/grass.png', category: 'terrain', title: 'Grass' },
      pine_tree: { char: '🌲', color: '#2f7d3a', category: 'nature', title: 'Pine Tree', height: 1 },
      // A units-category tile is only a CHARACTER when its backend row says so (`settings.unitRole`). The
      // split is by ROLE, not by category, because the twelve fx labels (arrow, nova, fire-slash…) live in
      // `units` too and ARE paintable. A fixture without the role reads as fx and is kept — which is right.
      goblin: { char: '👺', color: '#c0392b', category: 'units', title: 'Goblin', settings: { unitRole: 'enemy' } },
      npc: { char: '🧍', color: '#4aa3df', category: 'units', title: 'NPC', settings: { unitRole: 'person' } },
    })
    rebuildEmojiStyle()

    render(<TilePalette styleId="emoji" styleName="Emoji" armedId={null} onArm={() => {}} />)
    // regular tiles ARE offered
    expect(screen.getByTitle('Grass')).toBeInTheDocument()
    expect(screen.getByTitle('Pine Tree')).toBeInTheDocument()
    // unit/enemy tiles are NOT — and the "units" category header never renders in the paint palette
    expect(screen.queryByTitle('Goblin')).toBeNull()
    expect(screen.queryByTitle('NPC')).toBeNull()
    expect(screen.queryByText('Units')).toBeNull()
  })

  // The Tile LIBRARY (pin a tile as an element override) is a DIFFERENT surface — it still browses every
  // category, units included; only the Paint palette drops units. Proves the filter is scoped to paint.
  it('the Tile Library still lists units (only the Paint palette drops them)', () => {
    installStyleTiles('emoji', {
      grass: { char: '🍀', color: '#5faf4a', category: 'terrain', title: 'Grass' },
      goblin: { char: '👺', color: '#c0392b', category: 'units', title: 'Goblin', settings: { unitRole: 'enemy' } },
    })
    rebuildEmojiStyle()
    render(<TileLibraryBody styleId="emoji" styleName="Emoji" override={null} onPick={() => {}} />)
    expect(screen.getByTitle('Goblin')).toBeInTheDocument() // the character IS browsable here
    // NOTE the heading: the library calls the `units` bucket "Effects", because in the PAINT palette that
    // group holds only the fx labels (arrow, nova, fire-slash…) once characters are filtered out. The library
    // does not filter, so a character lands under a heading that does not describe it. Asserted as-is rather
    // than quietly renamed — it is a labelling wart worth Alexander's eye, not a test to bend.
    expect(screen.getByText('Effects')).toBeInTheDocument()
  })

  it('ascii sidebar derives from the loaded ascii tileset (glyph + title from the DB, not a hardcoded map)', () => {
    installStyleTiles('ascii', {
      grass: { char: '"', position: 'single', walkable: true, colorRole: 'x', category: 'terrain', title: 'Grass' },
      tree_top: { char: '♣', position: 'single', walkable: true, colorRole: 'canopy' }, // no category → internal, excluded
    })
    const all = Object.values(tilesForStyle('ascii')).flat()
    const grass = all.find(t => t.id === 'ascii:grass')
    expect(grass).toBeDefined()
    expect(grass!.label).toBe('Grass')
    expect(grass!.visual).toEqual({ kind: 'glyph', char: '"' })
    // internal cell-labels (no category) are excluded from the sidebar
    expect(all.find(t => t.id === 'ascii:tree_top')).toBeUndefined()
  })

  // The palette tile must FULLY describe the DB tile — its BLOCK height and render settings ride along, not
  // just the art — so the brush can seed a painted asset that matches the generator (#52 single source of truth).
  it('the palette tile carries the DB block height + settings (so a painted tile === a generated one)', () => {
    installStyleTiles('emoji', {
      boulder: { char: '🪨', color: '#8a8a8a', image: '/tiles/emoji/catalog/boulder.png', category: 'nature', title: 'Boulder', height: 1, settings: { color: '#8a8a8a' } },
      stone_wall: { char: '🧱', color: '#8f8b82', image: '/tiles/emoji/catalog/stone_wall.png', category: 'walls', title: 'Stone Wall', height: 1, settings: { color: '#8f8b82', fadeNear: true } },
      grass: { char: '🍀', color: '#5faf4a', category: 'terrain', title: 'Grass' }, // flat, no settings
    })
    rebuildEmojiStyle()
    const all = Object.values(tilesForStyle('emoji')).flat()
    const boulder = all.find(t => t.id === 'emoji:boulder')
    expect(boulder!.height).toBe(1)
    const wall = all.find(t => t.id === 'emoji:stone_wall')
    expect(wall!.height).toBe(1)
    expect(wall!.settings?.fadeNear).toBe(true)
    // a flat terrain tile has no forced block height
    expect(all.find(t => t.id === 'emoji:grass')!.height ?? 0).toBe(0)
  })
})
