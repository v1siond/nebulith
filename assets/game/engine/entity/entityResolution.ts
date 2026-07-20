/**
 * The active ENTITY RESOLUTION holder — MINIMAL and EMPTY by design (the twin of the tileset holders).
 *
 * The frontend holds NO entity data: how an enemy `enemyType` or a person `variant` resolves to a baked
 * tile slug comes from the nebulith backend. On mount, `loadEntitiesFromBackend` (entityLoader) fetches
 * `GET /api/entities` and calls `setEntityResolution` to fill this holder; the editor renders NOTHING
 * until then (the render gate waits on it alongside the tilesets). There is deliberately NO bundled
 * default — an empty holder can never resolve entities to a stale, frontend-authored mapping before the
 * backend one installs (per TILE-BACKEND-MIGRATION §9 / NEBULITH-SOURCE-OF-TRUTH).
 *
 * This file keeps only the shape + the setter/getter — the DATA lives in the backend (`EntitySource`).
 */

/** The entity → baked-tile resolution served by `/api/entities`. */
export interface EntityResolution {
  /** Public URL prefix the baked entity PNGs live under (a slug HAS a baked tile ⇒ a truthy path). */
  dir: string
  /** slug → its source emoji. The KEYS are the baked entity slug set (the membership guard). */
  tiles: Record<string, string>
  /** enemy `enemyType` tag → the baked slug it draws (bandit → ninja, orc/ogre → ogre…). */
  enemyTypeSlug: Record<string, string>
  /** person `variant` → the figure slug it renders (male → man, old → elder…). */
  variantSlug: Record<string, string>
}

// Starts EMPTY (no bundled data): pre-load, `bakedEntityImage`/`enemyTileId`/`personVariantTileId` find
// nothing and return undefined — the entity falls back to its base figure. The render is gated on the
// install, so this empty state never paints (no flash of a mis-resolved entity).
const EMPTY: EntityResolution = { dir: '', tiles: {}, enemyTypeSlug: {}, variantSlug: {} }

let ENTITY_RESOLUTION: EntityResolution = EMPTY

/** The live entity resolution (read at call time by the resolvers in artStyle). */
export function getEntityResolution(): EntityResolution {
  return ENTITY_RESOLUTION
}

/** Install the backend-served resolution (entityLoader after a successful `/api/entities` fetch). */
export function setEntityResolution(resolution: EntityResolution): void {
  ENTITY_RESOLUTION = resolution
}

/** Reset the holder to EMPTY — the tests' teardown twin of `setEmojiTileset({})`. */
export function clearEntityResolution(): void {
  ENTITY_RESOLUTION = EMPTY
}
