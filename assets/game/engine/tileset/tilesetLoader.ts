/**
 * Load the tilesets from the nebulith Elixir backend and install them into the (EMPTY) holders.
 * `/api/tilesets` serves the per-tile shape (tiles: label => {image_url, blocking, height, category,
 * title, glyph, emoji, color_role, settings}, compositions: name => {footprint, cells}) — this loader
 * maps that shape onto the Tileset / EmojiTile types the renderer reads, so every tile carries its
 * backend `image`. This is the SOLE runtime source of tiles: the frontend ships NO bundled tile data.
 *
 * There is NO fallback. On any failure (backend down, CORS, bad JSON) NOTHING is installed and the
 * function returns an empty list — the caller shows a loader/error state and never paints frontend
 * tiles (a wrong-style flash). Sets `window.__nebulithTilesets` and logs, so "the app is using the
 * backend" is verifiable (devtools console + a GET to `${NEBULITH_API}/tilesets` in the network tab).
 */
import { ASCII_TILESET, setAsciiTileset } from './asciiTileset'
import { EMOJI_TILESET, setEmojiTileset, type EmojiTile } from './emojiTileset'
import { rebuildEmojiStyle } from '@/game/artStyle'
import type { Tileset, TilesetTile, TilePosition, ZonePalette, GroundTile, Composition } from './tileset'
import type { TilePose } from './pose'
import type { TileView, TileViewSettings } from './tileViewSettings'
import { NEBULITH_API } from '@/lib/nebulithApi'
import { preloadTileImages } from '@/engine/render/shared'

// One backend tile row — the new per-tile shape served by /api/tilesets (ascii uses glyph, emoji uses
// emoji; settings holds style-specific extras: ascii's position/colors, emoji's color/pose/views).
interface ApiTile {
  image_url?: string | null
  blocking?: boolean
  height?: number
  category?: string
  title?: string
  glyph?: string
  emoji?: string
  color_role?: string | null
  settings?: {
    position?: TilePosition
    colors?: Record<string, unknown>
    /** Terrain tiles carry their char/fg/bg variants here (the data form of the old GROUND_COLORS row) —
     *  read into the tileset's `terrain` map so ground colour comes from the tile, not a `data.terrain` blob. */
    variants?: GroundTile
    color?: string
    pose?: TilePose
    views?: Partial<Record<TileView, TileViewSettings>>
    // GENERIC per-tile render behavior served by the API — copied straight through onto the installed
    // tile so a stamp can read it (walls/roof fade/cutaway near the hero); any tile may carry these.
    fadeNear?: boolean
    cutawayRoof?: boolean
  }
}

interface ApiTileset {
  id?: number | string
  key: string
  name: string
  /** The OLD blob — still holds `palettes` + `terrain` for ascii (out of scope to migrate this task). */
  data: { palettes?: Record<string, ZonePalette>; terrain?: Record<string, GroundTile> }
  tiles?: Record<string, ApiTile>
  compositions?: Record<string, Composition>
}

// The backend record id for each style key, cached from the load so a Save can PUT the right row without
// re-fetching. Populated by loadTilesetsFromBackend; empty until the first successful load.
const tilesetIdByKey = new Map<string, number | string>()

// The backend's origin (no /api suffix) — every tile's image_url is a root-relative path the API
// returns, so it needs absolutizing against the SAME host the tileset itself was fetched from.
const ORIGIN = NEBULITH_API.replace(/\/api\/?$/, '')
const abs = (u: string | null | undefined): string | undefined => (u ? (u.startsWith('http') ? u : ORIGIN + u) : undefined)

/** Map one backend ascii tile row → a TilesetTile (the shape the renderer/resolver read). */
function toAsciiTilesetTile(label: string, tile: ApiTile): TilesetTile {
  const imageUrl = abs(tile.image_url)
  return {
    label,
    glyph: tile.glyph ?? '',
    position: tile.settings?.position ?? 'single',
    walkable: !tile.blocking,
    colorRole: tile.color_role ?? '',
    category: tile.category,
    title: tile.title,
    image: imageUrl ? { kind: 'image', src: imageUrl, char: tile.glyph } : undefined,
    settings: tile.settings, // pass the backend blob through so the stamp reads fadeNear/cutawayRoof
  }
}

/** Build the ground/terrain map from the TERRAIN TILE ROWS (category 'terrain', with char/fg/bg in
 *  settings.variants) — "terrain is just another tile", so ground colour comes from each tile's own
 *  settings, never a `data.terrain` blob. Tiles without variants are skipped (resolveGroundTile then
 *  falls back to grass). */
function buildAsciiTerrain(apiTiles: Record<string, ApiTile>): Record<string, GroundTile> {
  const terrain: Record<string, GroundTile> = {}
  for (const [label, tile] of Object.entries(apiTiles)) {
    const v = tile.settings?.variants
    if (tile.category === 'terrain' && v?.char?.length && v?.fg?.length && v?.bg?.length) terrain[label] = v
  }
  return terrain
}

/** Build the full ASCII Tileset from a backend row — tiles mapped per-label + terrain from the terrain
 *  tile rows' settings.variants + compositions. NO `palettes`/`terrain` blob: every colour lives on its
 *  own tile (a tile's colour comes from its settings, not a shared palette or a residual data blob). */
function buildAsciiTileset(t: ApiTileset): Tileset {
  const apiTiles = t.tiles ?? {}
  const tiles: Record<string, TilesetTile> = {}
  for (const [label, tile] of Object.entries(apiTiles)) tiles[label] = toAsciiTilesetTile(label, tile)
  return {
    id: t.key,
    name: t.name,
    tiles,
    palettes: {},
    terrain: buildAsciiTerrain(apiTiles),
    compositions: t.compositions ?? {},
  }
}

/** Map one backend emoji tile row → an EmojiTile (the shape EMOJI_TILESET/artStyle read). */
function toEmojiTile(tile: ApiTile): EmojiTile {
  return {
    char: tile.emoji ?? '',
    color: tile.settings?.color ?? '',
    image: abs(tile.image_url),
    height: tile.height,
    category: tile.category,
    title: tile.title,
    pose: tile.settings?.pose,
    views: tile.settings?.views,
    settings: tile.settings, // pass the backend blob through (same generic fadeNear/cutawayRoof keys)
  }
}

/** Build the full emoji tile map from a backend row. */
function buildEmojiTileset(t: ApiTileset): Record<string, EmojiTile> {
  const tiles: Record<string, EmojiTile> = {}
  for (const [label, tile] of Object.entries(t.tiles ?? {})) tiles[label] = toEmojiTile(tile)
  return tiles
}

/** Install a `/api/tilesets` payload's entries (one per style: ascii/emoji) into the live tileset
 *  singletons — the same per-entry mapping `loadTilesetsFromBackend` uses, factored out so tests can
 *  install a captured fixture without a network round-trip. Returns the style keys it installed. */
export function installTilesetPayload(list: ApiTileset[]): string[] {
  const loaded: string[] = []
  for (const t of list) {
    if (t.id != null) tilesetIdByKey.set(t.key, t.id) // remember the row id so a Save can PUT it back
    if (t.key === 'ascii') { setAsciiTileset(buildAsciiTileset(t)); loaded.push('ascii') }
    if (t.key === 'emoji') { setEmojiTileset(buildEmojiTileset(t)); rebuildEmojiStyle(); loaded.push('emoji') } // tileset (incl. image refs) comes straight from the backend DB
  }
  return loaded
}

/** Every baked-image src the CURRENTLY installed tilesets reference — the exact `tileImage` cache keys the
 *  render will draw. It covers the whole render surface: plain tiles, composition part-labels, held weapons
 *  and PLACED ENTITIES all resolve their picture through an EMOJI_TILESET / ASCII_TILESET row's `image`
 *  (an entity is just a `units` tile), so decoding this set decodes everything a first frame can paint. */
function collectInstalledImageSrcs(): string[] {
  const srcs = new Set<string>()
  for (const t of Object.values(EMOJI_TILESET)) if (t.image) srcs.add(t.image)
  for (const t of Object.values(ASCII_TILESET.tiles)) if (t.image?.src) srcs.add(t.image.src)
  return [...srcs]
}

export async function loadTilesetsFromBackend(): Promise<string[]> {
  try {
    const res = await fetch(`${NEBULITH_API}/tilesets`, { headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = (await res.json()) as { data?: ApiTileset[] } | ApiTileset[]
    const list = Array.isArray(body) ? body : (body.data ?? [])

    const loaded = installTilesetPayload(list)

    // Hold the load "done" (and therefore the render gate) until the baked PNGs are DECODED, not just until
    // the JSON installed. Otherwise the gate opens on JSON alone, the first frame finds every tileImage()
    // still undecoded, and the render flashes the glyph fallback (brick faces / crate-hero) for ~1s until
    // the rasters arrive. Preloading here makes "tileset loaded" mean "tiles AND their images are ready".
    await preloadTileImages(collectInstalledImageSrcs())

    if (typeof window !== 'undefined') (window as unknown as { __nebulithTilesets?: string[] }).__nebulithTilesets = loaded
    console.info(`[nebulith] tilesets loaded from the Elixir API (${NEBULITH_API}): ${loaded.join(', ') || 'none'}`)
    return loaded
  } catch (e) {
    console.warn(`[nebulith] tileset load from ${NEBULITH_API} failed — the editor stays on the loader/error state (no bundled fallback). (${(e as Error).message})`)
    return []
  }
}

/** Persist the CURRENT in-memory tileset for `key` back to the backend (the pose editor's Save). PUTs the
 *  whole in-memory blob (with any live pose edits) to its row via the id cached at load. Throws on a missing
 *  id (never loaded) or a non-OK response so the caller can surface a failure toast. */
export async function saveTilesetToBackend(key: 'emoji' | 'ascii'): Promise<void> {
  const id = tilesetIdByKey.get(key)
  if (id == null) throw new Error(`no backend id for the ${key} tileset — load it first`)
  const data = key === 'emoji' ? EMOJI_TILESET : ASCII_TILESET
  const res = await fetch(`${NEBULITH_API}/tilesets/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ tileset: { data } }),
  })
  if (!res.ok) throw new Error(`save failed: HTTP ${res.status}`)
}
