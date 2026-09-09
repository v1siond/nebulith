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
import { rebuildEmojiStyle, setStyleList } from '@/game/artStyle'
import { loadedStyleIds, setStyleCatalog, styleTiles, type StyleTile } from './styleTiles'
import type { Composition, TilePosition, ZonePalette, GroundTile } from './tileset'
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
  /** The style picker's affordance + order — a tileset row IS an art style (§3.14a `BUILT_IN_STYLES`). */
  icon?: string | null
  position?: number | null
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

/**
 * The tile's `settings` with any `frames` array absolutised against the backend origin.
 *
 * Returns the SAME object when there is nothing to rewrite, so the common case allocates nothing and a
 * tile's settings stay referentially stable across loads.
 */
function absoluteFrames(settings: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const frames = settings?.frames
  if (!Array.isArray(frames)) return settings
  const resolved = frames.map(frame => (typeof frame === 'string' ? abs(frame) : frame)).filter(Boolean)
  return { ...settings, frames: resolved }
}


/**
 * Map one backend row → the ONE tile shape, for ANY style.
 *
 * The whole "one engine, N art styles" rule in a function: every style's rows go through it, and the only
 * field that differs between `grass` in ascii and `grass` in emoji is `image`. It replaces the two
 * per-style mappers that produced two different shapes for the same concept.
 *
 * `char` takes the glyph OR the emoji, because they are the same thing: the mark the style's picture was
 * baked from.
 */
function toStyleTile(label: string, tile: ApiTile): StyleTile {
  return {
    label,
    title: tile.title ?? undefined,
    category: tile.category,
    height: tile.height,
    walkable: !tile.blocking,
    image: abs(tile.image_url),
    char: tile.glyph || tile.emoji || '',
    color: tile.settings?.color,
    colorRole: tile.color_role ?? '',
    position: tile.settings?.position ?? 'single',
    pose: tile.settings?.pose,
    views: tile.settings?.views,
    // `settings.frames` is the baked picture PER ANIMATION FRAME, and it arrives root-relative exactly
    // like `image_url` — so it gets absolutised through the same `abs`. It was passed through raw, which
    // made every animated tile's frames unusable as URLs (`/tiles/ascii/dragon.png` resolved against the
    // FRONTEND origin and 404'd). Nothing consumed them yet, so nothing had noticed.
    settings: absoluteFrames(tile.settings),
  }
}


// The ground FAMILY: a paved road (`roads`) or a constructed floor (`floors`) is still walkable ground,
// painted flat from its own char/fg/bg variants — the finer taxonomy split the sidebar bucket, not the
// render path. All three build the ground map so ground rendering stays byte-identical after recategorizing.
const GROUND_CATEGORIES = new Set(['terrain', 'roads', 'floors'])

/** Build the ground/terrain map from the GROUND TILE ROWS (category terrain/roads/floors, with char/fg/bg in
 *  settings.variants) — "terrain is just another tile", so ground colour comes from each tile's own
 *  settings, never a `data.terrain` blob. Tiles without variants are skipped (resolveGroundTile then
 *  falls back to grass). */
function buildTerrain(apiTiles: Record<string, ApiTile>): Record<string, GroundTile> {
  const terrain: Record<string, GroundTile> = {}
  for (const [label, tile] of Object.entries(apiTiles)) {
    const v = tile.settings?.variants
    if (tile.category && GROUND_CATEGORIES.has(tile.category) && v?.char?.length && v?.fg?.length && v?.bg?.length) terrain[label] = v
  }
  return terrain
}




/** Install a `/api/tilesets` payload's entries (one per style: ascii/emoji) into the live tileset
 *  singletons — the same per-entry mapping `loadTilesetsFromBackend` uses, factored out so tests can
 *  install a captured fixture without a network round-trip. Returns the style keys it installed. */
export function installTilesetPayload(list: ApiTileset[]): string[] {
  const loaded: string[] = []
  // EVERY served style installs through the ONE mapper into the ONE store. No per-style branch: a style is
  // a set of pictures for the same labels, so a third style needs no code here at all.
  for (const t of list) {
    const tiles = Object.fromEntries(
      Object.entries(t.tiles ?? {}).map(([label, tile]) => [label, toStyleTile(label, tile)]),
    )
    setStyleCatalog({
      id: t.key,
      name: t.name,
      tiles,
      compositions: t.compositions ?? {},
      // The ground index comes from the ground TILES' own `settings.variants` — "terrain is just another
      // tile", so ground colour is a per-tile setting, never a `data.terrain` blob.
      terrain: buildTerrain(t.tiles ?? {}),
    })
  }
  // The STYLE LIST is backend data: every served tileset is a style the picker offers, in the backend's
  // `position` order, with the backend's name and icon. Installed before the tiles so a style is never
  // offered without its catalog behind it.
  setStyleList(
    [...list]
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.key.localeCompare(b.key))
      .map(t => ({ id: t.key, name: t.name, icon: t.icon ?? '' })),
  )
  for (const t of list) {
    if (t.id != null) tilesetIdByKey.set(t.key, t.id) // remember the row id so a Save can PUT it back
    loaded.push(t.key)
  }  // The Style objects' per-kind `map` is a view over the store, so refresh it after an install.
  rebuildEmojiStyle()

  return loaded
}

/** Every baked-image src the installed catalogs reference — the exact `tileImage` cache keys the render
 *  will draw. It covers the whole render surface: plain tiles, composition part-labels, held weapons and
 *  PLACED ENTITIES all resolve their picture through a tile row's `image` (an entity is just a `units`
 *  tile), so decoding this set decodes everything a first frame can paint.
 *
 *  Style-agnostic: it walks whatever styles are installed, so a third one is preloaded automatically. */
function collectInstalledImageSrcs(): string[] {
  const srcs = new Set<string>()
  for (const id of loadedStyleIds()) {
    for (const tile of Object.values(styleTiles(id))) if (tile.image) srcs.add(tile.image)
  }
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
  // PUT the style's own tiles back. One store, so one read — no per-style branch.
  const data = styleTiles(key)
  const res = await fetch(`${NEBULITH_API}/tilesets/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ tileset: { data } }),
  })
  if (!res.ok) throw new Error(`save failed: HTTP ${res.status}`)
}
