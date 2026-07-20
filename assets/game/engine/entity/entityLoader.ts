/**
 * Load the entity resolution from the nebulith Elixir backend and install it into the (EMPTY) holder.
 * `GET /api/entities` serves `{ dir, tiles, enemyTypeSlug, variantSlug }` — the mapping from an enemy's
 * `enemyType` / a person's `variant` to a baked tile slug. This is the SOLE runtime source of that
 * mapping: the frontend ships NO bundled entity data (per TILE-BACKEND-MIGRATION §9).
 *
 * There is NO fallback — mirroring the tileset loader. On any failure (backend down, CORS, bad JSON)
 * NOTHING is installed and the function returns false; the caller keeps the render gated (the loader/
 * error state stays up) and never resolves entities against a stale frontend map. Sets
 * `window.__nebulithEntities` so "entities came from the backend" is verifiable in devtools.
 */
import { NEBULITH_API } from '@/lib/nebulithApi'
import { setEntityResolution, type EntityResolution } from './entityResolution'

/** Install a `/api/entities` payload's resolution into the live holder. Factored out so tests can install
 *  a captured fixture without a network round-trip (the twin of `installTilesetPayload`). */
export function installEntityPayload(resolution: EntityResolution): void {
  setEntityResolution(resolution)
}

export async function loadEntitiesFromBackend(): Promise<boolean> {
  try {
    const res = await fetch(`${NEBULITH_API}/entities`, { headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = (await res.json()) as { data?: EntityResolution } | EntityResolution
    const resolution = (body as { data?: EntityResolution }).data ?? (body as EntityResolution)
    if (!resolution || typeof resolution !== 'object' || !resolution.tiles) throw new Error('malformed entity resolution')

    installEntityPayload(resolution)
    if (typeof window !== 'undefined') (window as unknown as { __nebulithEntities?: number }).__nebulithEntities = Object.keys(resolution.tiles).length
    console.info(`[nebulith] entity resolution loaded from the Elixir API (${NEBULITH_API}): ${Object.keys(resolution.tiles).length} slugs`)
    return true
  } catch (e) {
    console.warn(`[nebulith] entity resolution load from ${NEBULITH_API} failed — the editor stays gated (no bundled fallback). (${(e as Error).message})`)
    return false
  }
}
