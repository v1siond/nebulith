/**
 * LEVEL ORDER — arranging the template ids that make up a game's levels.
 *
 * A game is an ORDERED list of templates presented as levels: index 0 = level 1, index 1 = level 2…
 * (distinct from the spatial connector graph). The same template may appear twice, or in two games.
 *
 * The GAME itself is a backend record (`/api/games` owns its id, name and membership — see
 * §3.14b #18: the frontend used to keep a second, localStorage-backed Game model with its own id
 * scheme, and the two disagreed). What legitimately stays here is the pure REORDERING the user
 * performs before the list is PUT back, so these functions take a plain `string[]` and never mint an
 * id or construct a game.
 *
 * Pure + immutable — every op returns a new array, inputs untouched.
 */

/** Move the level at `from` to `to`. Any out-of-range index, or a move to itself, changes nothing. */
export function moveLevel(templateIds: readonly string[], from: number, to: number): string[] {
  const inRange = (i: number) => i >= 0 && i < templateIds.length
  if (!inRange(from) || !inRange(to) || from === to) return [...templateIds]
  const next = [...templateIds]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/** Drop the level at `index`. By INDEX, not by id — a template used at two levels loses only one. */
export function removeLevel(templateIds: readonly string[], index: number): string[] {
  if (index < 0 || index >= templateIds.length) return [...templateIds]
  return templateIds.filter((_, i) => i !== index)
}

/** The template id at level `n` (1-based, the way the UI numbers them). Out of range → undefined. */
export function levelTemplateId(templateIds: readonly string[], n: number): string | undefined {
  if (n < 1 || n > templateIds.length) return undefined
  return templateIds[n - 1]
}
