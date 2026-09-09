/**
 * ONE-SHOT IMPORT of the retired localStorage games into the backend.
 *
 * Games used to live under `nebulith:games` in the browser, with their own id scheme and their own
 * `Game` type, while `/api/games` held a completely separate set — §3.1's P0: "the user is *inside*
 * a game and the app tells them they have none." The localStorage half is gone; this carries
 * whatever a browser still holds across to the backend before it does.
 *
 * §5.3 rated that deletion HIGH risk purely because of this data. Running the import retires the
 * risk instead of accepting it.
 *
 * Dependency-injected (read / createGame / clear) so the logic is testable without a browser or a
 * server, and so the "when is it safe to clear?" decision is visible rather than buried in a fetch.
 */

/** The key the retired store wrote. Kept here because this module is now its only reader. */
export const GAMES_STORAGE_KEY = 'nebulith:games'

/** The shape the old store persisted. Anything else in the key is not a game. */
interface StoredGame {
  name: string
  templateIds: string[]
}

export interface ImportDeps {
  /** Read the raw stored payload (null when the key is absent). */
  read: () => string | null
  /** Create one backend game. Rejecting aborts the import with the key intact. */
  createGame: (input: { name: string; templateIds: string[] }) => Promise<{ id: string }>
  /** Drop the stored payload. Called only once every game is safely in the backend. */
  clear: () => void
}

export interface ImportResult {
  imported: number
  /** Entries in the key that were not games — counted, not thrown over. */
  skipped: number
}

/** A stored entry is importable only if it has the name + ordered ids a game is made of. */
function isStoredGame(value: unknown): value is StoredGame {
  if (typeof value !== 'object' || value === null) return false
  const g = value as Record<string, unknown>
  return (
    typeof g.id === 'string' &&
    typeof g.name === 'string' &&
    Array.isArray(g.templateIds) &&
    g.templateIds.every(id => typeof id === 'string')
  )
}

/** The importable games in the payload, plus how many entries were not games. */
function parseStored(raw: string | null): { games: StoredGame[]; skipped: number } | null {
  if (!raw) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null // unreadable: leave the key alone rather than destroy something we cannot read
  }
  if (!Array.isArray(data)) return null
  const games = data.filter(isStoredGame)
  return { games, skipped: data.length - games.length }
}

/**
 * Import every stored game, then clear the key.
 *
 * The key is cleared ONLY after all creates resolve — a half-finished import that cleared would
 * destroy the data it exists to save. A create that rejects propagates, key intact, so the next
 * load simply tries again.
 */
export async function importLocalGames(deps: ImportDeps): Promise<ImportResult> {
  const parsed = parseStored(deps.read())
  if (!parsed) return { imported: 0, skipped: 0 }

  for (const game of parsed.games) {
    await deps.createGame({ name: game.name.trim() || 'Imported game', templateIds: [...game.templateIds] })
  }

  deps.clear()
  return { imported: parsed.games.length, skipped: parsed.skipped }
}

/** The browser-backed deps. Split out so `importLocalGames` stays testable without a DOM. */
export function browserImportDeps(
  createGame: ImportDeps['createGame'],
): ImportDeps | null {
  if (typeof window === 'undefined') return null
  return {
    read: () => window.localStorage.getItem(GAMES_STORAGE_KEY),
    createGame,
    clear: () => window.localStorage.removeItem(GAMES_STORAGE_KEY),
  }
}
