// Test helper: install the DB-EQUIVALENT tileset (base + catalog + entities) the runtime loads from the
// :4000 backend (tilesetLoader), so a test exercising the sidebar / reskin / per-element-override path sees
// the SAME complete tileset production does — not the sparse bundled pre-load default. The fixture is a
// captured `/api/tilesets` response (ascii + emoji entries), installed via the SAME per-entry mapping the
// runtime loader uses, so this stays byte-for-byte what production would load.
//   • `installSeedTileset()` — install globally (a whole-file need; see ./installTilesetSeed which calls it).
//   • `useSeedTileset()`     — install for ONE describe + restore the bundled default after, so sibling
//                              describes (mechanism tests that assert the bundled glyphs) keep the default.
import fixture from '@/__tests__/fixtures/tilesets.json'
import entitiesFixture from '@/__tests__/fixtures/entities.json'
import { setEmojiTileset, EMOJI_TILESET } from '@/engine/tileset/emojiTileset'
import { setAsciiTileset, ASCII_TILESET } from '@/engine/tileset/asciiTileset'
import { rebuildEmojiStyle } from '@/game/artStyle'
import { installTilesetPayload } from '@/engine/tileset/tilesetLoader'
import { installEntityPayload } from '@/engine/entity/entityLoader'
import { clearEntityResolution } from '@/engine/entity/entityResolution'

export function installSeedTileset(): void {
  installTilesetPayload(fixture.data)
  installEntityPayload(entitiesFixture.data) // the entity resolution is part of "what production loads"
}

export function useSeedTileset(): void {
  const bundledEmoji = EMOJI_TILESET
  const bundledAscii = ASCII_TILESET
  beforeAll(() => installSeedTileset())
  afterAll(() => { setEmojiTileset(bundledEmoji); setAsciiTileset(bundledAscii); rebuildEmojiStyle(); clearEntityResolution() })
}
