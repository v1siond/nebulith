/**
 * WHAT KIND OF THING A TILE IS, ASKED OF THE BACKEND.
 *
 * *"ALL VARIATIONS ALL REGIONS ALL TYPES, EVERYTHING COMNES FROM BACKEND, SO WHY ARE WE DOING HARDCODED WITH
 * WHAT SHOULD BE DATA???"* (2026-09-15).
 *
 * Every tile row carries a `category` (`nature`, `roads`, `floors`, `terrain`, …) and this repo kept answering
 * the same questions from hand-written name lists instead. Measured against the live catalogue on the day this
 * was written:
 *
 *   · `ROAD_GROUNDS` named 9 road tiles. The backend serves **12**.
 *   · `BUILT_FLOOR` named 6 floor tiles. The backend serves **21**.
 *   · `GROWS` named 3 growing things. The backend serves dozens under `nature`.
 *
 * So the lists were not merely impure, they were WRONG, and a tile added by a migration was invisible to all
 * three. Adding a road is a row in the database; it must not also be an edit in here.
 *
 * READ WITH A FUNCTION, NEVER AT MODULE SCOPE. A `const` built at import time freezes the EMPTY catalogue and
 * every caller then sees "no category" for the life of the tab.
 */
import { styleCatalog } from './styleTiles'

/** The categories the backend uses, as constants so a caller never spells one wrong. */
export const TILE_CATEGORY = {
  nature: 'nature',
  roads: 'roads',
  floors: 'floors',
  terrain: 'terrain',
} as const

export type TileCategory = (typeof TILE_CATEGORY)[keyof typeof TILE_CATEGORY]

/** The category the backend gives this label, or undefined when it serves none (or is not loaded yet). */
export function tileCategory(label: string | undefined, styleId = 'ascii'): string | undefined {
  if (!label) return undefined
  return styleCatalog(styleId).tiles[label]?.category
}

/** Is this label one the backend files under `category`? Absent data answers false: a tile the catalogue has
 *  not classified is not silently promoted into a group it was never put in. */
export function isTileCategory(label: string | undefined, category: TileCategory, styleId = 'ascii'): boolean {
  return tileCategory(label, styleId) === category
}

/** Every label the backend files under `category`, in catalogue order. The one way to enumerate a group. */
export function tilesInCategory(category: TileCategory, styleId = 'ascii'): string[] {
  const tiles = styleCatalog(styleId).tiles
  return Object.keys(tiles).filter(label => tiles[label]?.category === category)
}
