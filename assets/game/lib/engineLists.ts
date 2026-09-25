/**
 * EVERY LIST A PICKER OFFERS, served by the backend.
 *
 * `docs/SPEC.md` law 11: *"A list a person could extend without new code is data. A list the engine
 * switches on is code, and is served (D17). Never a second copy either way."* Phase 0's REWIRE is the
 * consequence: *"The engine's own enum lists are served so a picker cannot be missing a value the engine
 * accepts."*
 *
 * The four lists this replaces were `const` arrays sitting beside the `<select>` that rendered them:
 * `EASES`, `TRIGGER_EVENTS` and `TILE_VIEWS` in `engine/animation/tileAnimation.ts`, and
 * `ANIM_DIRECTIONS` in `components/editorAnimation.tsx`. A list typed out beside its picker cannot learn
 * the engine's fifth ease, and nothing anywhere says so: the value is accepted by every switch and
 * offered by no menu.
 *
 * The TYPES stay in TypeScript, because an exhaustive switch needs one at compile time. That is the half
 * law 11 calls code. The VALUES come from here. `Nebulith.APickerCannotMissAValueTest` reads the unions
 * back out of the engine's own source and fails if the two ever disagree.
 *
 * Loaded once at boot, beside the tile schema, and for the same reason: a picker that has to await
 * something while it opens is a picker that opens empty.
 */

export type EngineLists = Record<string, readonly string[]>

let served: EngineLists | null = null

/** Loads every list once, at boot. */
export async function loadEngineLists(): Promise<EngineLists> {
  const res = await fetch('/api/enums')
  if (!res.ok) throw new Error(`engine lists: /api/enums answered ${res.status}`)

  const body = (await res.json()) as { data: EngineLists }
  served = body.data

  if (typeof window !== 'undefined') {
    ;(window as unknown as { __nebulithEnums?: EngineLists }).__nebulithEnums = served
  }

  return served
}

/**
 * One list, by the name the backend serves it under.
 *
 * An unserved name answers EMPTY rather than a stand-in, so a picker with nothing behind it reads as
 * empty instead of quietly offering a list this file invented. That is the same rule the tile defaults
 * follow, and it is why this module holds no arrays of its own.
 */
export function engineList(name: string): readonly string[] {
  return served?.[name] ?? []
}

/** For tests and for the editor's own gates: the whole served map, or null before boot. */
export function engineLists(): EngineLists | null {
  return served
}

/** Installs lists directly. Tests use it; nothing in the app does. */
export function setEngineLists(lists: EngineLists): void {
  served = lists
}
