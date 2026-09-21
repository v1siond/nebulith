/**
 * WHAT A TILE SETTING IS WHEN NOBODY SAID, served by the backend.
 *
 * Measured on the live catalogue: `display` is stated on 26 of 636 tiles and `shape` on 0, against 116
 * places in this engine where a renderer read a served value through `?? <some literal>`. So the
 * renderers held 116 opinions about what a tile looks like when nobody said, and the database held
 * none. A default that lives in a renderer is a default that differs between renderers, and it changes
 * with whichever one happens to draw.
 *
 * > The default shouldn't happen at the engine level, it should happen at the setting level.
 *
 * `cell_tiles` has a column per setting and every column has a DEFAULT. `/api/maps/schema` serves
 * those defaults, and this module is the one place that holds them, so a tile arrives at a renderer
 * already complete and nothing downstream has anything left to invent.
 *
 * See docs/SPEC.md §8 phase 3.
 */

/** Every settable column, its default, and the values each enum admits. */
export interface TileSchema {
  fields: string[]
  defaults: Record<string, unknown>
  vocabularies: Record<string, string[]>
  views: string[]
  cell_surfaces: string[]
}

let served: TileSchema | null = null

/**
 * Loads the schema once, at boot, beside the tilesets.
 *
 * Deliberately NOT lazy: a renderer that has to await something mid-frame is a renderer that draws a
 * frame without it, which is the hole this closes.
 */
export async function loadTileSchema(): Promise<TileSchema> {
  const res = await fetch('/api/maps/schema')
  if (!res.ok) throw new Error(`tile schema: /api/maps/schema answered ${res.status}`)

  const body = (await res.json()) as { data: TileSchema }
  served = body.data
  if (typeof window !== 'undefined') {
    ;(window as unknown as { __nebulithTileSchema?: TileSchema }).__nebulithTileSchema = served
  }
  return served
}

/** For tests and for the seam a probe reads. */
export function installTileSchema(schema: TileSchema): void {
  served = schema
}

/** Forget it, so a test starts from nothing rather than from the last test's load. */
export function clearTileSchema(): void {
  served = null
}

/** The schema as served, or null when it has not loaded. Callers decide what a missing one means. */
export function tileSchema(): TileSchema | null {
  return served
}

/**
 * The default for ONE setting, as the column states it.
 *
 * Throws when the schema has not loaded. That is on purpose: the alternative is a literal, and a
 * literal here is the exact defect this module exists to remove. A caller that can legitimately run
 * before the load asks `tileSchema()` and handles null itself.
 */
export function defaultOf(field: string): unknown {
  if (!served) throw new Error(`tile defaults: asked for "${field}" before /api/maps/schema loaded`)
  return served.defaults[field]
}

/**
 * A placed tile with every setting the backend states, and the caller's own values on top.
 *
 * This is where a default stops being a renderer's opinion. Anything the caller actually said wins,
 * including a deliberate zero or an empty string; only `undefined` means "nobody said".
 */
export function withServedDefaults<T extends object>(tile: T): T {
  if (!served) return tile

  const out = { ...served.defaults } as Record<string, unknown>
  for (const [key, value] of Object.entries(tile)) {
    if (value !== undefined) out[key] = value
  }
  return out as unknown as T
}


/**
 * A NUMERIC default, as the column states it.
 *
 * The one reader for "what is this setting when nobody said". Before the schema has loaded it answers
 * the caller's own last resort, which is the only moment in the app's life where that can happen: the
 * boot gate waits on `loadTileSchema` before anything renders.
 */
export function numericDefault(field: string, beforeLoad: number): number {
  const stated = served?.defaults?.[field]
  const n = typeof stated === 'string' ? Number(stated) : stated

  return typeof n === 'number' && Number.isFinite(n) ? n : beforeLoad
}
