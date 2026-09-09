/**
 * GUARD — the frontend ships NO bundled tile DATA. Every runtime tile comes from the nebulith backend
 * (`/api/tilesets`); the in-memory holders start EMPTY and are filled only by the loader. This is the
 * core of the "no fallback / no wrong-style flash" fix: with nothing bundled, there is nothing for the
 * renderer to paint before the DB tileset installs.
 *
 * This file deliberately does NOT install the fixture — it asserts the pristine, freshly-imported state.
 */
import { loadedStyleIds, styleCatalog, styleTiles } from '@/engine/tileset/styleTiles'
import fs from 'fs'
import path from 'path'
import { EMOJI_STYLE } from '@/game/artStyle'
import { getEntityResolution } from '@/engine/entity/entityResolution'

const TILESET_DIR = path.join(__dirname, '../../engine/tileset')
const SRC_DIR = path.join(__dirname, '../..')
const DATA_DIR = path.join(__dirname, '../../game/data')

describe('no bundled frontend tile data — the ONE store starts empty', () => {
  test('nothing is installed at all until the loader runs', () => {
    expect(loadedStyleIds()).toEqual([])
  })

  test('every style reads back empty — an unloaded style is empty, never a stand-in for another', () => {
    for (const style of ['emoji', 'ascii']) {
      expect(Object.keys(styleTiles(style))).toHaveLength(0)
      expect(Object.keys(styleCatalog(style).terrain)).toHaveLength(0)
      expect(Object.keys(styleCatalog(style).compositions)).toHaveLength(0)
    }
  })

  test('EMOJI_STYLE.map is empty before any tileset loads (nothing maps → nothing to draw)', () => {
    expect(Object.keys(EMOJI_STYLE.map)).toHaveLength(0)
  })

  test('the entity resolution holder is empty until the backend load fills it (no bundled entity DATA)', () => {
    const r = getEntityResolution()
    expect(Object.keys(r.tiles)).toHaveLength(0)
    expect(Object.keys(r.enemyTypeSlug)).toHaveLength(0)
    expect(Object.keys(r.variantSlug)).toHaveLength(0)
    expect(r.dir).toBe('')
  })
})

describe('no bundled frontend tile data — the source proves it (grep-style guard)', () => {
  // Alexander, 2026-09-08, on the two per-style holder files: *"why do we have this? tiles come from the
  // elixir backend, so why do we need those two files????"*. They are deleted, and this keeps them deleted —
  // a per-style module is exactly where bundled rows creep back in, one style at a time.
  test('there is no per-style tileset module — one store, every style', () => {
    expect(fs.existsSync(path.join(TILESET_DIR, 'emojiTileset.ts'))).toBe(false)
    expect(fs.existsSync(path.join(TILESET_DIR, 'asciiTileset.ts'))).toBe(false)
  })

  test('the ONE store declares no tile rows of its own', () => {
    const src = fs.readFileSync(path.join(TILESET_DIR, 'styleTiles.ts'), 'utf8')
    // The store is an empty map that only the loader fills; a regression re-adding bundled rows
    // (e.g. `grass: { char: '🍀', … }`) would break both of these.
    expect(src).toMatch(/const CATALOGS: Record<string, StyleCatalog> = \{\}/)
    expect(src).not.toMatch(/^\s*[a-z_]+: \{ char: /m)
  })

  test('no bundled tile/entity JSON remains in game/data (tiles + entity resolution are backend-served)', () => {
    const files = fs.existsSync(DATA_DIR) ? fs.readdirSync(DATA_DIR) : []
    // entityTiles.json was the LAST frontend data file — it now lives in the backend (EntitySource,
    // served by GET /api/entities). No JSON DATA blob may return to game/data.
    for (const banned of ['entityTiles.json', 'compositions.json', 'tileKinds.json', 'emojiCatalog.json', 'tilesetSeed.json']) {
      expect(files).not.toContain(banned)
    }
  })

  test('no runtime frontend module imports the deleted entityTiles.json (grep-proof)', () => {
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, name.name)
        if (name.isDirectory()) {
          if (name.name === '__tests__' || name.name === 'node_modules') continue // tests may reference the name in prose
          walk(full)
          continue
        }
        if (!/\.tsx?$/.test(name.name)) continue
        if (/entityTiles/.test(fs.readFileSync(full, 'utf8'))) offenders.push(path.relative(SRC_DIR, full))
      }
    }
    walk(SRC_DIR)
    expect(offenders).toEqual([])
  })
})
