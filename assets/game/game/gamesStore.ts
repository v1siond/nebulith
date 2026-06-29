/**
 * GAMES persistence — v1 localStorage (see docs/games-flows.md).
 *
 * Games are tiny (name + ordered id list), so v1 round-trips the whole list under one
 * key with NO schema migration — a proper Game DB table is the documented upgrade.
 * The (de)serialize halves are pure + independently testable; load/save are the
 * SSR-safe edge (no-op when there's no `window`). Malformed/legacy data is dropped,
 * never thrown — a broken key must not take down the editor.
 */
import type { Game } from './games'

export const GAMES_STORAGE_KEY = 'nebulith:games'

function isGame(value: unknown): value is Game {
  if (typeof value !== 'object' || value === null) return false
  const g = value as Record<string, unknown>
  return (
    typeof g.id === 'string' &&
    typeof g.name === 'string' &&
    Array.isArray(g.templateIds) &&
    g.templateIds.every(id => typeof id === 'string')
  )
}

/** Parse a stored payload into clean Games, dropping anything malformed. Pure. */
export function parseGames(raw: string | null): Game[] {
  if (!raw) return []
  try {
    const data: unknown = JSON.parse(raw)
    if (!Array.isArray(data)) return []
    return data.filter(isGame).map(g => ({ id: g.id, name: g.name, templateIds: [...g.templateIds] }))
  } catch {
    return []
  }
}

/** Serialize a games list to the stored payload. Pure. */
export function serializeGames(games: readonly Game[]): string {
  return JSON.stringify(games)
}

export function loadGames(): Game[] {
  if (typeof window === 'undefined') return []
  return parseGames(window.localStorage.getItem(GAMES_STORAGE_KEY))
}

export function saveGames(games: readonly Game[]): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(GAMES_STORAGE_KEY, serializeGames(games))
}
