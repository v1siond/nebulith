/**
 * The nebulith backend now serves `/api/tilesets` in the NEW shape — per tile: image_url/blocking/
 * height/category/title/glyph/emoji/color_role/settings (not the old bundled Tileset/EmojiTile blob).
 * This proves loadTilesetsFromBackend() INSTALLS that shape correctly: every tile carries its backend
 * `image` (absolutized against the API origin), walkability/colour/glyph map across, and compositions
 * come through — so the renderer (unchanged this task) keeps working off styleCatalog('ascii')/styleTiles('emoji').
 */
import { styleCatalog, styleTiles } from '@/engine/tileset/styleTiles'
import { loadTilesetsFromBackend } from '@/engine/tileset/tilesetLoader'
import { resolveComposition } from '@/engine/tileset/tileset'

// The loader now DECODES every baked image before it resolves (the render gate waits on decoded images —
// tilesetLoader → preloadTileImages). jsdom never loads/decodes a real Image, so stand in a synchronously
// "decoded" one (complete + naturalWidth) — preloadTileImages then skips the wait and the load resolves,
// exactly as it does in the browser once the PNGs are ready.
const RealImage = (global as { Image: unknown }).Image
class DecodedImage { complete = true; naturalWidth = 64; naturalHeight = 64; src = ''; decode() { return Promise.resolve() } }
beforeAll(() => { (global as { Image: unknown }).Image = DecodedImage })
afterAll(() => { (global as { Image: unknown }).Image = RealImage })

const ASCII_STUB = {
  id: 1,
  key: 'ascii',
  name: 'ASCII',
  data: {
    palettes: { spring: { trunk: '#5a3a22', canopy: ['#3f8f3f'], building: { roof: '#c8443c', wall: '#b0603a', door: '#5a3a22', window: '#7fb4d8' }, feature: { mountain: '#8d8d97', peak: '#e6ebf3', spill: '#5bbcff' } } },
    terrain: { grass: { char: ['.', ','], fg: ['#5faf4a', '#4a9f3a'], bg: ['#1c2e1c'] } },
  },
  tiles: {
    bush: { glyph: '*', image_url: '/tiles/ascii/bush.png', blocking: false, height: 1, category: 'nature', title: 'Bush', color_role: null, settings: { colors: {}, position: 'single' } },
  },
  compositions: {
    tree_small: { footprint: { w: 1, h: 2 }, cells: [{ dx: 0, dy: 0, level: 0, label: 'tree_stem', walkable: false }, { dx: 0, dy: 1, level: 1, label: 'tree_leaf', walkable: false }] },
  },
}

const EMOJI_STUB = {
  id: 2,
  key: 'emoji',
  name: 'Emoji',
  data: {},
  tiles: {
    bear: { emoji: '🐻', image_url: '/tiles/emoji/catalog/bear.png', blocking: false, height: 0, category: 'units', title: 'Bear', color_role: null, settings: { color: '#8a5f3a' } },
  },
  compositions: {},
}

describe('loadTilesetsFromBackend — installs the new /api/tilesets shape', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [ASCII_STUB, EMOJI_STUB] }),
    }) as unknown as typeof fetch
  })

  test('ascii bush tile gets an absolute image src derived from its image_url', async () => {
    await loadTilesetsFromBackend()
    const bush = styleTiles('ascii').bush
    // `image` is the baked PNG's URL — a STRING, not an element with a `.src`. (The emoji case below already
    // reads it that way; this one still went through the old loaded-Image shape.)
    expect(bush.image?.startsWith('http')).toBe(true)
    expect(bush.image?.endsWith('/tiles/ascii/bush.png')).toBe(true)
  })

  test('ascii bush tile is walkable (blocking: false); there is no palette blob at all', async () => {
    await loadTilesetsFromBackend()
    expect(styleTiles('ascii').bush.walkable).toBe(true)
    // The blob was REMOVED, not emptied — a catalog is {id, name, tiles, compositions, terrain} and a tile's
    // colour lives in its own settings.colors. Asserting `{}` quietly accepted a blob that came back empty.
    expect(styleCatalog('ascii')).not.toHaveProperty('palettes')
  })

  test('emoji bear tile gets its absolute image + color installed', async () => {
    await loadTilesetsFromBackend()
    expect(styleTiles('emoji').bear.image?.endsWith('/tiles/emoji/catalog/bear.png')).toBe(true)
    expect(styleTiles('emoji').bear.color).toBe('#8a5f3a')
  })

  test('the tree_small composition installs and resolves', async () => {
    await loadTilesetsFromBackend()
    expect(resolveComposition(styleCatalog('ascii'), 'tree_small')).not.toBeNull()
  })
})
