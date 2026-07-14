// Test helper: install the DB-EQUIVALENT tileset (base + catalog + entities) the runtime loads from the
// :4000 backend (tilesetLoader), so a test exercising the sidebar / reskin / per-element-override path sees
// the SAME complete tileset production does — not the sparse bundled pre-load default.
//   • `installSeedTileset()` — install globally (a whole-file need; see ./installTilesetSeed which calls it).
//   • `useSeedTileset()`     — install for ONE describe + restore the bundled default after, so sibling
//                              describes (mechanism tests that assert the bundled glyphs) keep the default.
import tilesetSeed from '@/game/data/tilesetSeed.json'
import { setEmojiTileset, EMOJI_TILESET, type EmojiTile } from '@/engine/tileset/emojiTileset'
import { setAsciiTileset, ASCII_TILESET } from '@/engine/tileset/asciiTileset'
import { rebuildEmojiStyle } from '@/game/artStyle'
import type { Tileset } from '@/engine/tileset/tileset'

export function installSeedTileset(): void {
  setEmojiTileset(tilesetSeed.emoji as unknown as Record<string, EmojiTile>)
  setAsciiTileset(tilesetSeed.ascii as unknown as Tileset)
  rebuildEmojiStyle()
}

export function useSeedTileset(): void {
  const bundledEmoji = EMOJI_TILESET
  const bundledAscii = ASCII_TILESET
  beforeAll(() => installSeedTileset())
  afterAll(() => { setEmojiTileset(bundledEmoji); setAsciiTileset(bundledAscii); rebuildEmojiStyle() })
}
