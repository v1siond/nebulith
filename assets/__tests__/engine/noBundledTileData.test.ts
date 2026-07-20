/**
 * GUARD — the frontend ships NO bundled tile DATA. Every runtime tile comes from the nebulith backend
 * (`/api/tilesets`); the in-memory holders start EMPTY and are filled only by the loader. This is the
 * core of the "no fallback / no wrong-style flash" fix: with nothing bundled, there is nothing for the
 * renderer to paint before the DB tileset installs.
 *
 * This file deliberately does NOT install the fixture — it asserts the pristine, freshly-imported state.
 */
import fs from 'fs'
import path from 'path'
import { EMOJI_TILESET } from '@/engine/tileset/emojiTileset'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'
import { EMOJI_STYLE } from '@/game/artStyle'

const TILESET_DIR = path.join(__dirname, '../../engine/tileset')
const DATA_DIR = path.join(__dirname, '../../game/data')

describe('no bundled frontend tile data — the holders start empty', () => {
  test('EMOJI_TILESET is empty until the backend load fills it', () => {
    expect(Object.keys(EMOJI_TILESET)).toHaveLength(0)
  })

  test('ASCII_TILESET carries no bundled tiles / palettes / terrain / compositions', () => {
    expect(Object.keys(ASCII_TILESET.tiles)).toHaveLength(0)
    expect(Object.keys(ASCII_TILESET.palettes)).toHaveLength(0)
    expect(Object.keys(ASCII_TILESET.terrain)).toHaveLength(0)
    expect(Object.keys(ASCII_TILESET.compositions ?? {})).toHaveLength(0)
  })

  test('EMOJI_STYLE.map is empty before any tileset loads (nothing maps → nothing to draw)', () => {
    expect(Object.keys(EMOJI_STYLE.map)).toHaveLength(0)
  })
})

describe('no bundled frontend tile data — the source proves it (grep-style guard)', () => {
  test('the holder modules initialise EMPTY (no re-introduced bundled rows)', () => {
    const emojiSrc = fs.readFileSync(path.join(TILESET_DIR, 'emojiTileset.ts'), 'utf8')
    const asciiSrc = fs.readFileSync(path.join(TILESET_DIR, 'asciiTileset.ts'), 'utf8')
    // The emoji holder must be initialised to `{}` — a regression that re-adds bundled tile rows
    // (e.g. `grass: { char: '🍀', ... }`) would break this.
    expect(emojiSrc).toMatch(/EMOJI_TILESET[^=]*=\s*\{\s*\}/)
    expect(emojiSrc).not.toMatch(/char:\s*'/) // no bundled glyph rows
    // The ascii holder initialises with empty tiles/palettes/terrain.
    expect(asciiSrc).toMatch(/tiles:\s*\{\s*\}/)
    expect(asciiSrc).toMatch(/palettes:\s*\{\s*\}/)
    expect(asciiSrc).toMatch(/terrain:\s*\{\s*\}/)
  })

  test('no bundled tileset JSON remains in game/data (only entity resolution stays)', () => {
    const files = fs.existsSync(DATA_DIR) ? fs.readdirSync(DATA_DIR) : []
    for (const banned of ['compositions.json', 'tileKinds.json', 'emojiCatalog.json', 'tilesetSeed.json']) {
      expect(files).not.toContain(banned)
    }
  })
})
