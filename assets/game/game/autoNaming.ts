/**
 * Naming a new game or level.
 *
 * Alexander: "just assign a random name or put something generic like 'game X' and redirect user to
 * the editor right away." Creating either asks the user nothing — the name is generated and the
 * editor opens. A plain counter rather than a random word, so a gallery of untouched records sorts
 * and scans the way a person expects; renaming one is a normal edit afterwards (both surfaces
 * already have a rename field).
 *
 * Pure — no React, no API.
 */

/** The number in a name generated from `prefix`, or 0 for a name the user chose. Anchored, so
 *  "Level 9 Game" and "Game of 5" are not counted as generated names. */
function generatedNumber(prefix: string, name: string): number {
  const pattern = new RegExp(`^${prefix}\\s+(\\d+)$`, 'i')
  const match = pattern.exec(name.trim().replace(/\s+/g, ' '))
  return match ? Number(match[1]) : 0
}

/**
 * The next generated name under `prefix`: one past the highest number already in use.
 *
 * It counts UP rather than filling the lowest free gap, so deleting "Game 2" and creating another
 * doesn't hand the new record a name the user still associates with the old one.
 */
export function nextGeneratedName(prefix: string, existing: readonly { name: string }[]): string {
  const highest = existing.reduce((max, e) => Math.max(max, generatedNumber(prefix, e.name)), 0)
  return `${prefix} ${highest + 1}`
}

/** "Game 3" — the gallery's word for a game. */
export const nextGameName = (existing: readonly { name: string }[]): string => nextGeneratedName('Game', existing)

/** "Level 3" — the editor's word for a template (design §4.1.6: one vocabulary, Level not Template). */
export const nextLevelName = (existing: readonly { name: string }[]): string => nextGeneratedName('Level', existing)
