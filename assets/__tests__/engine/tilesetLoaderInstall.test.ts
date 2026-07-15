/**
 * The nebulith backend now serves `/api/tilesets` in the NEW shape — per tile: image_url/blocking/
 * height/category/title/glyph/emoji/color_role/settings (not the old bundled Tileset/EmojiTile blob).
 * This proves loadTilesetsFromBackend() INSTALLS that shape correctly: every tile carries its backend
 * `image` (absolutized against the API origin), walkability/colour/glyph map across, and compositions
 * come through — so the renderer (unchanged this task) keeps working off ASCII_TILESET/EMOJI_TILESET.
 */
import { loadTilesetsFromBackend } from '@/engine/tileset/tilesetLoader'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'
import { EMOJI_TILESET } from '@/engine/tileset/emojiTileset'
import { resolveComposition } from '@/engine/tileset/tileset'

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
    const bush = ASCII_TILESET.tiles.bush
    expect(bush.image?.src.startsWith('http')).toBe(true)
    expect(bush.image?.src.endsWith('/tiles/ascii/bush.png')).toBe(true)
  })

  test('ascii bush tile is walkable (blocking: false); palettes are empty (colour is a per-tile setting, not a blob)', async () => {
    await loadTilesetsFromBackend()
    expect(ASCII_TILESET.tiles.bush.walkable).toBe(true)
    expect(ASCII_TILESET.palettes).toEqual({}) // no palette blob — a tile's colour lives in its own settings.colors
  })

  test('emoji bear tile gets its absolute image + color installed', async () => {
    await loadTilesetsFromBackend()
    expect(EMOJI_TILESET.bear.image?.endsWith('/tiles/emoji/catalog/bear.png')).toBe(true)
    expect(EMOJI_TILESET.bear.color).toBe('#8a5f3a')
  })

  test('the tree_small composition installs and resolves', async () => {
    await loadTilesetsFromBackend()
    expect(resolveComposition(ASCII_TILESET, 'tree_small')).not.toBeNull()
  })
})
