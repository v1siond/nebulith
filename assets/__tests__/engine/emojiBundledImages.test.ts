/**
 * Regression: emoji image tiles tofu'd again on a NEWLY generated town. The app loads the emoji tileset
 * from the nebulith backend on startup (loadTilesetsFromBackend), which REPLACES the bundled tileset —
 * and the backend emoji data has no `image` fields yet, so the bundled Noto images were stripped and
 * windows/rocks reverted to [?]. withBundledImages() re-injects the bundled images so they survive the
 * backend load (a backend tile's own image still wins).
 */
import { withBundledImages, BUNDLED_EMOJI_IMAGES } from '@/engine/tileset/emojiTileset'

describe('withBundledImages — bundled Noto images survive a backend load that lacks them', () => {
  test('a backend tile with no image inherits the bundled image (window → Noto png)', () => {
    const backend = { window: { char: '🪟', color: '#7fb4d8' }, grass: { char: '🍀', color: '#5faf4a' } }
    const merged = withBundledImages(backend)
    expect(merged.window.image).toMatch(/emoji_u1fa9f\.png$/) // restored from the bundle
    expect(merged.grass.image).toBeUndefined() // grass had no bundled image → stays undefined
  })

  test('a backend tile that supplies its OWN image keeps it', () => {
    const backend = { window: { char: '🪟', color: '#7fb4d8', image: '/custom/window.png' } }
    expect(withBundledImages(backend).window.image).toBe('/custom/window.png')
  })

  test('the bundled snapshot carries the tofu-tile images (cavefloor, window, rock)', () => {
    expect(BUNDLED_EMOJI_IMAGES.window).toMatch(/emoji_u1fa9f\.png$/)
    expect(BUNDLED_EMOJI_IMAGES.cavefloor).toMatch(/emoji_u1faa8\.png$/)
    expect(BUNDLED_EMOJI_IMAGES.rock).toMatch(/emoji_u1faa8\.png$/)
  })
})
