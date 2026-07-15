/**
 * The active ASCII tileset holder — MINIMAL and EMPTY by design.
 *
 * The frontend holds NO tile art and NO tile colour data (per TILE-BACKEND-MIGRATION §7 and
 * MAP-MODEL §8): every tile, its glyph, its per-zone colour, terrain, and compositions come from
 * the nebulith backend. On mount, `loadTilesetsFromBackend` (tilesetLoader) fetches `/api/tilesets`
 * and calls `setAsciiTileset` to fill this holder with the DB-served tileset. Until then it is empty —
 * the app is intentionally backend-required (there is no bundled offline colour fallback).
 */
import type { Tileset } from './tileset'

export let ASCII_TILESET: Tileset = {
  id: 'ascii',
  name: 'ASCII',
  tiles: {},
  palettes: {},
  terrain: {},
  compositions: {},
}

/** Swap the active ASCII tileset — used to install the one loaded from the nebulith API. */
export function setAsciiTileset(tileset: Tileset): void {
  ASCII_TILESET = tileset
}
