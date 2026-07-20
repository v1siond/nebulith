/**
 * GATE + NO-FALLBACK contract — the runtime loads tiles ONLY from `/api/tilesets`, and until that load
 * succeeds the tile holders stay EMPTY. The editor gates its canvas on exactly this: no installed tileset
 * → the loader stays up (there is nothing to paint); a FAILED load installs NOTHING → the error/retry
 * state shows and we NEVER fall back to frontend tiles. These tests pin that data contract (the full UI
 * gate is validated on the running page).
 *
 * This file does NOT install the fixture — it drives `loadTilesetsFromBackend` against a mocked fetch.
 */
import { loadTilesetsFromBackend } from '@/engine/tileset/tilesetLoader'
import { EMOJI_TILESET, setEmojiTileset } from '@/engine/tileset/emojiTileset'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'

const realFetch = global.fetch

// Restore fetch AND reset the emoji holder to empty after each case — the success case installs a tileset,
// so we return the module to its pristine (empty) resting state so nothing leaks to a sibling test.
afterEach(() => {
  ;(global as { fetch: typeof fetch }).fetch = realFetch
  setEmojiTileset({})
})

describe('the tileset gate — empty until the backend load succeeds', () => {
  test('before any load, the holders are empty (the loader stays up — nothing to draw)', () => {
    expect(Object.keys(EMOJI_TILESET)).toHaveLength(0)
    expect(Object.keys(ASCII_TILESET.tiles)).toHaveLength(0)
  })

  test('a FAILED load installs nothing — no fallback to frontend tiles (error/retry state)', async () => {
    ;(global as { fetch: typeof fetch }).fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch
    const loaded = await loadTilesetsFromBackend()
    expect(loaded).toEqual([]) // nothing installed → the caller shows the error state
    expect(Object.keys(EMOJI_TILESET)).toHaveLength(0) // holders untouched — NO bundled fallback
    expect(Object.keys(ASCII_TILESET.tiles)).toHaveLength(0)
  })

  test('a non-OK response installs nothing either (still no fallback)', async () => {
    ;(global as { fetch: typeof fetch }).fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 }) as unknown as typeof fetch
    const loaded = await loadTilesetsFromBackend()
    expect(loaded).toEqual([])
    expect(Object.keys(EMOJI_TILESET)).toHaveLength(0)
  })
})

describe('the tileset gate — a successful load opens it', () => {
  test('a successful load installs the backend tiles (the gate opens)', async () => {
    const payload = {
      data: [
        {
          key: 'emoji',
          name: 'Emoji',
          id: 1,
          data: {},
          tiles: {
            grass: { emoji: '🍀', image_url: '/tiles/emoji/grass.png', height: 0, category: 'terrain', title: 'Grass', settings: { color: '#5faf4a' } },
          },
          compositions: {},
        },
      ],
    }
    ;(global as { fetch: typeof fetch }).fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => payload }) as unknown as typeof fetch
    const loaded = await loadTilesetsFromBackend()
    expect(loaded).toContain('emoji')
    expect(EMOJI_TILESET.grass).toBeDefined()
    expect(EMOJI_TILESET.grass.char).toBe('🍀') // the backend tile is what installs — nothing frontend-authored
  })
})
