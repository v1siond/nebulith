/**
 * SEARCHING A TILE LIBRARY — the matcher the three pickers share (§4.5).
 *
 * 305 tiles and 79 creatures are browsed today by scrolling a 4-wide grid, which §3.5/§3.6 measured as the
 * top P1 friction. The interesting constraint is §3.5's other measurement: **120 of the 305 labels are raw
 * slugs** (`cliff_face`, `water_deep`) sitting beside prettified ones (`Shallow Water`). A user types what
 * they see, and half of them see a slug — so the query matches the label AND the id, with `_` and space
 * treated as the same separator, and every word required in any order ("water deep" finds "Deep Water").
 *
 * Pure: no React, no tileset lookups. The three pickers filter with it and render exactly as before.
 */
import type { TileDef } from '@/game/artStyle'

/** Lowercase, and `_`/`-` flattened to spaces, so a slug and a title compare on equal terms. */
const normalise = (text: string): string => text.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()

/** The words a query asks for. Empty query → no words → everything matches. */
const queryWords = (query: string): string[] => normalise(query).split(' ').filter(Boolean)

/**
 * Does this tile answer the query? EVERY word must appear somewhere in its label or id (order-free), so
 * "brick wall" narrows to the brick one instead of every wall.
 */
export function matchesTileQuery(tile: TileDef, query: string): boolean {
  const words = queryWords(query)
  if (words.length === 0) return true
  const haystack = `${normalise(tile.label ?? '')} ${normalise(tile.id ?? '')}`
  return words.every(word => haystack.includes(word))
}

/** The tiles answering the query, in catalogue order. Never mutates its input. */
export function filterTiles(tiles: readonly TileDef[], query: string): TileDef[] {
  const words = queryWords(query)
  if (words.length === 0) return [...tiles]
  return tiles.filter(tile => matchesTileQuery(tile, query))
}
