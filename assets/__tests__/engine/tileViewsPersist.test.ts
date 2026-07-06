import { EMOJI_TILESET, setEmojiTileset, setTilePose } from '@/engine/tileset/emojiTileset'

// Guard: the tileset save (saveTilesetToBackend) PUTs the live EMOJI_TILESET blob verbatim, and the
// editor's live write is setTilePose (which only touches .pose). Prove a per-view `views` map survives
// both — so persisting per-view settings needs no serializer change, only the tile TYPE.
test('a tile views map survives setTilePose + the JSON blob the save PUTs', () => {
  setEmojiTileset({ tree: { char: '🌲', color: '#2f8f4e', views: { iso: { size: 2.6 } } } } as never)
  setTilePose('tree', { rot: 0.3 }) // the editor's live pose write
  const sent = JSON.parse(JSON.stringify(EMOJI_TILESET)) // == the body saveTilesetToBackend serialises
  expect(sent.tree.views).toEqual({ iso: { size: 2.6 } })
  expect(sent.tree.pose).toEqual({ rot: 0.3 })
})
