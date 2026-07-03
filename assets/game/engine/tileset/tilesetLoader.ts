/**
 * Load the tilesets from the nebulith Elixir backend and install them, replacing the bundled defaults.
 * The DB rows were seeded FROM these same tilesets, so the shape is identical and the app looks the
 * same — the point is the data now comes over the wire from Phoenix/Ecto, not compiled into the JS.
 *
 * Safe: on any failure (backend down, CORS, bad JSON) the bundled tilesets stay in place and the app
 * keeps working. Sets `window.__nebulithTilesets` and logs, so "the app is using the backend" is
 * verifiable (devtools console + a GET to :4001/api/tilesets in the network tab).
 */
import { setAsciiTileset } from './asciiTileset'
import { setEmojiTileset, type EmojiTile } from './emojiTileset'
import { rebuildEmojiStyle } from '@/game/artStyle'
import type { Tileset } from './tileset'

// The nebulith Elixir API (dev). Later this becomes configurable / same-origin behind a proxy.
const NEBULITH_API = 'http://localhost:4001/api'

interface ApiTileset { key: string; name: string; data: unknown }

export async function loadTilesetsFromBackend(): Promise<string[]> {
  try {
    const res = await fetch(`${NEBULITH_API}/tilesets`, { headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = (await res.json()) as { data?: ApiTileset[] } | ApiTileset[]
    const list = Array.isArray(body) ? body : (body.data ?? [])

    const loaded: string[] = []
    for (const t of list) {
      if (t.key === 'ascii') { setAsciiTileset(t.data as Tileset); loaded.push('ascii') }
      if (t.key === 'emoji') { setEmojiTileset(t.data as Record<string, EmojiTile>); rebuildEmojiStyle(); loaded.push('emoji') } // tileset (incl. image refs) comes straight from the backend DB
    }

    if (typeof window !== 'undefined') (window as unknown as { __nebulithTilesets?: string[] }).__nebulithTilesets = loaded
    console.info(`[nebulith] tilesets loaded from the Elixir API (${NEBULITH_API}): ${loaded.join(', ') || 'none'}`)
    return loaded
  } catch (e) {
    console.warn(`[nebulith] tileset load from ${NEBULITH_API} failed — using bundled tilesets. (${(e as Error).message})`)
    return []
  }
}
