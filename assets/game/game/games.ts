/**
 * GAMES — the playable-flow model (see docs/games-flows.md).
 *
 * A Game is an EXPLICIT, author-built, ORDERED list of template ids: index 0 = level 1,
 * index 1 = level 2, … (distinct from the spatial connector graph). A game references
 * existing templates by id; the same template may appear in different games, or repeat
 * within one. "Go to level N" loads templateIds[N-1] in the play view.
 *
 * Pure module — no React, no rendering, no storage. Every op returns a NEW value; inputs
 * are never mutated (immutability by default). Persistence lives at the edge in
 * gamesStore.ts (localStorage v1; a Game DB table is the documented upgrade).
 */

export interface Game {
  id: string
  name: string
  /** ORDERED — index 0 = level 1, index 1 = level 2, … The same id may repeat. */
  templateIds: string[]
}

/** A small unique id — good enough for a localStorage list (no crypto dependency). */
function newId(): string {
  return `game_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

// ── single-game operations (immutable) ───────────────────────────────────────

/** Build a fresh game. Blank/whitespace names fall back to a placeholder. */
export function createGame(name: string, templateIds: readonly string[] = []): Game {
  return { id: newId(), name: name.trim() || 'Untitled game', templateIds: [...templateIds] }
}

export function renameGame(game: Game, name: string): Game {
  return { ...game, name }
}

/** Append a template as the next level (the highest level number). */
export function addTemplate(game: Game, templateId: string): Game {
  return { ...game, templateIds: [...game.templateIds, templateId] }
}

/** Move the level at index `from` to index `to`. Out-of-range / no-op → unchanged. */
export function reorderTemplate(game: Game, from: number, to: number): Game {
  const ids = game.templateIds
  if (from < 0 || from >= ids.length || to < 0 || to >= ids.length || from === to) return game
  const next = [...ids]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return { ...game, templateIds: next }
}

/** Remove the level at `index` (kept index-based to match reorder). Out-of-range → unchanged. */
export function removeTemplate(game: Game, index: number): Game {
  if (index < 0 || index >= game.templateIds.length) return game
  return { ...game, templateIds: game.templateIds.filter((_, i) => i !== index) }
}

/** The template id for level N (1-based). Out-of-range → undefined. */
export function levelTemplate(game: Game, n: number): string | undefined {
  if (n < 1 || n > game.templateIds.length) return undefined
  return game.templateIds[n - 1]
}

/** How many levels the game has. */
export function levelCount(game: Game): number {
  return game.templateIds.length
}

// ── collection operations (immutable) ────────────────────────────────────────

export function getGame(games: readonly Game[], id: string): Game | undefined {
  return games.find(g => g.id === id)
}

/** Insert a new game or replace the one with the same id, keeping list order. */
export function upsertGame(games: readonly Game[], game: Game): Game[] {
  if (!games.some(g => g.id === game.id)) return [...games, game]
  return games.map(g => (g.id === game.id ? game : g))
}

export function deleteGame(games: readonly Game[], id: string): Game[] {
  return games.filter(g => g.id !== id)
}
