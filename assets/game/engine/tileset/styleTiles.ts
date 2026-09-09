/**
 * THE TILE STORE — one shape, one store, every art style.
 *
 * Alexander, 2026-09-08:
 *
 *   > 1 game engine, multiple styles. That's it. We don't need an engine for ascii, another for emoji,
 *   > another for X art style. Changing a style just changes the database of tiles — it just changes the
 *   > png associated with the name. `grass -> ascii`, `grass -> emoji`: same name, same label, same
 *   > identifier, different png.
 *
 * and, on why the two per-style holder files existed at all:
 *
 *   > tiles come from the elixir backend, so why do we need those two files????
 *
 * They don't. `asciiTileset.ts` and `emojiTileset.ts` are deleted. This module is the whole store: the
 * backend serves one payload per style, the loader installs it here, and everything reads it from here.
 *
 * The ONLY field a style changes is `image`. Everything else — name, bucket, height, collision — is a fact
 * about the LABEL, and the backend enforces that (`normalize_label_facts/0`).
 *
 * `char` is the mark the picture was baked FROM (`;` for ascii grass, `🌿` for emoji grass). It is not a
 * second rendering path: every tile draws its `image`. It is the catalog preview and the last resort for a
 * label with no baked picture. One field, one meaning, both styles.
 */
import type { TilePose } from './pose'
import type { Composition, GroundTile, TilePosition } from './tileset'
import type { TileView, TileViewSettings } from './tileViewSettings'

/** One tile, in one style. What the backend serves for a (STYLE, LABEL) pair — no per-style shape. */
export interface StyleTile {
  /** The swap key. THE identifier: the same label names the same thing in every style. */
  label: string
  /** Human display name. A LABEL fact — identical across styles (backend-enforced). */
  title?: string
  /** Sidebar bucket (terrain / walls / nature / units / …). A LABEL fact. */
  category?: string
  /** Iso BLOCK height: 0 = a flat ground square, 1 = one cube, N = N tall. A LABEL fact. */
  height?: number
  /** Does it block movement? A LABEL fact. */
  walkable: boolean
  /**
   * THE PER-STYLE FIELD — the baked PNG this style draws for this label. This is the whole difference
   * between `grass` in ascii and `grass` in emoji.
   */
  image?: string
  /** The mark the picture was baked FROM (ascii `;`, emoji `🌿`). Catalog preview + last-resort. */
  char: string
  /** The tile's own colour, when it authors one. */
  color?: string
  /** Which palette entry supplies the colour ('canopy', 'trunk', 'building.roof'). */
  colorRole?: string
  /** Where in a 9-piece autotile mass this tile sits (or 'single'). */
  position?: TilePosition
  /** Positioning deviations (rotation/scale/flip/offset). Absent = identity. */
  pose?: TilePose
  /** Per-view size/pose deviations. Absent = the tile's shared value. */
  views?: Partial<Record<TileView, TileViewSettings>>
  /** The backend `settings` blob, passed through verbatim (colours, variants, render behaviour, …). */
  settings?: Record<string, unknown>
}

/** Every label of one style. */
export type StyleTileMap = Record<string, StyleTile>

/**
 * One art style, as the backend serves it: its tiles, the compositions built from them, and the ground
 * index derived from the ground tiles' own `settings.variants`.
 *
 * `compositions` and `terrain` sit here rather than in a separate store because they are per-style views of
 * the same payload — splitting them is how there came to be two of everything in the first place.
 */
export interface StyleCatalog {
  id: string
  name: string
  tiles: StyleTileMap
  compositions: Record<string, Composition>
  terrain: Record<string, GroundTile>
}

const EMPTY: StyleCatalog = { id: '', name: '', tiles: {}, compositions: {}, terrain: {} }

/**
 * style id → its catalog. EMPTY until the backend load fills it: there is deliberately no bundled default,
 * so the editor can never flash frontend-authored art before the real catalog installs.
 */
const CATALOGS: Record<string, StyleCatalog> = {}

/** Install one style's catalog (the loader calls this once per served tileset). */
export function setStyleCatalog(catalog: StyleCatalog): void {
  CATALOGS[catalog.id] = catalog
}

/** One style's catalog. An unknown/unloaded style is EMPTY, never a stand-in for another style. */
export function styleCatalog(styleId: string): StyleCatalog {
  return CATALOGS[styleId] ?? EMPTY
}

/** One style's tiles. */
export function styleTiles(styleId: string): StyleTileMap {
  return styleCatalog(styleId).tiles
}

/** One tile, or undefined when this style has no such label. */
export function styleTile(styleId: string, label: string): StyleTile | undefined {
  return CATALOGS[styleId]?.tiles[label]
}

/**
 * Write ONE tile into a style's catalog.
 *
 * The live editor uses it to retune a pose in place (the RAF loop redraws from the same data, so a slider
 * moves the tile in-scene immediately), and tests use it to install a small catalog. There is one store, so
 * there is one way in.
 */
export function setStyleTile(styleId: string, label: string, tile: StyleTile): void {
  const catalog = CATALOGS[styleId] ?? { ...EMPTY, id: styleId, tiles: {}, compositions: {}, terrain: {} }
  catalog.tiles = { ...catalog.tiles, [label]: tile }
  CATALOGS[styleId] = catalog
}

/**
 * Write ONE composition into a style's catalog.
 *
 * The seam that lets a building COMPOSED TO ORDER be stamped by the path a seeded one uses. The editor
 * asks `/api/buildings/:type?width=&depth=` for a footprint nobody authored, installs the answer here under
 * a synthetic kind, and arms it — from that point nothing downstream knows or cares that it was generated.
 *
 * Alexander, 2026-09-08: *"why having 3 size house when we can have 1 house button and allow user to make a
 * house as big or as small as he wants???"* One way in, mirroring `setStyleTile`, because there is one store.
 */
export function setStyleComposition(styleId: string, kind: string, comp: StyleCatalog['compositions'][string]): void {
  const catalog = CATALOGS[styleId] ?? { ...EMPTY, id: styleId, tiles: {}, compositions: {}, terrain: {} }
  catalog.compositions = { ...catalog.compositions, [kind]: comp }
  CATALOGS[styleId] = catalog
}

/**
 * A tile with the required fields filled in — for callers that only care about a couple of them.
 *
 * `walkable` defaults true and `char` to empty, so a caller states only what it is testing or authoring.
 */
export function makeStyleTile(label: string, over: Partial<StyleTile> = {}): StyleTile {
  return { label, char: '', walkable: true, ...over }
}

/** Install a whole style from sparse rows — the label is filled in from the key. */
export function installStyleTiles(styleId: string, rows: Record<string, Partial<StyleTile>>, name = styleId): void {
  setStyleCatalog({
    id: styleId,
    name,
    tiles: Object.fromEntries(Object.entries(rows).map(([label, over]) => [label, makeStyleTile(label, over)])),
    compositions: {},
    terrain: {},
  })
}

/** The style ids currently installed, in install order. */
export function loadedStyleIds(): string[] {
  return Object.keys(CATALOGS)
}

/** Forget everything (a test installing its own catalog per case). */
export function clearStyleCatalogs(): void {
  for (const key of Object.keys(CATALOGS)) delete CATALOGS[key]
}

/**
 * Set (or clear) a tile's POSE in place.
 *
 * An empty/undefined pose DROPS the deviation, so the tile renders byte-identically to an unposed one.
 */
export function setTilePose(styleId: string, label: string, pose: TilePose | undefined): void {
  const tile = styleTile(styleId, label)
  if (!tile) return
  const next = { ...tile }
  if (pose && Object.keys(pose).length > 0) next.pose = pose
  else delete next.pose
  setStyleTile(styleId, label, next)
}
