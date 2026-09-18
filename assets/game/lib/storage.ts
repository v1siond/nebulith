/**
 * Browser storage that is allowed to not exist.
 *
 * The engine is embedded in the CV site through an iframe, and a cross-origin frame gets PARTITIONED
 * storage in Chrome and NO storage at all in Safari's default third-party configuration, where every
 * accessor throws a SecurityError on the property itself. So this is a normal condition here, not an
 * edge case: an unguarded read during mount takes the whole editor down before it draws a pixel.
 *
 * See docs/DEPLOYMENT-AND-BOUNDARIES.md §6. Only a remembered toggle belongs here. Anything a person
 * would be upset to lose goes to the backend through the API.
 */

let announced = false

/** Say once, not per call, that this browser is not giving us storage. Ten silent catches hide a cause. */
function noteUnavailable(reason: unknown): void {
  if (announced) return
  announced = true
  console.info(
    `[nebulith] browser storage is unavailable here, view preferences will not persist (${(reason as Error)?.message ?? reason}). ` +
      'Expected inside a third-party iframe; games and templates are unaffected, they live in the backend.',
  )
}

export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch (e) {
    noteUnavailable(e)
    return null
  }
}

export function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch (e) {
    noteUnavailable(e)
  }
}

export function clearStored(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch (e) {
    noteUnavailable(e)
  }
}
