/**
 * THE INSPECTOR'S SECTIONS (§4.7) — the model behind the accordions.
 *
 * §3.10 measured the old inspector as "one flat wall of controls": twenty-odd rows with no grouping, so
 * finding the collision toggle meant reading every slider on the way down. §4.7 answered that with six
 * sections whose titles were QUESTIONS a person asks — *what is it*, *how does it look*, *how does it
 * behave*.
 *
 * THE TITLES ARE NO LONGER QUESTIONS. Alexander, 2026-09-09: *"labels aren't clearly descriptive, they're
 * either too descriptive to the point where they dn't make sense like having stuff like 'how it's placed',
 * like what does that even mean?? / we need clear concise labeling that clearly points at the
 * action/feature."*
 *
 * The question form was the mistake, and it got worse the harder it was pushed — "How it will be placed"
 * became "What it does when you drop it", which is longer and no clearer. A label is scanned, not read: it
 * has to name the thing in one or two words so the eye can skip the five it does not want. So the titles
 * name the FEATURE — Tile, Appearance, Behaviour — and the explaining moves to the ⓘ and the guides, which
 * are read deliberately.
 *
 * This table is the single source of that: the order, the titles, which three open by default, and the
 * settings key each one persists under. The component renders the table; adding a section is a row here,
 * never a new branch. §4.7: "Sections open by default: WHAT IS IT, HOW IT LOOKS, HOW IT BEHAVES.
 * Collapsed: SIZE & POSITION, ANIMATION, RULES."
 */

export type InspectorSectionId =
  | 'identity'
  | 'looks'
  | 'size'
  | 'behaviour'
  | 'animation'
  | 'rules'

export interface InspectorSectionDef {
  id: InspectorSectionId
  /** The question this section answers, in the user's words. Shown as the accordion header. */
  title: string
  /** Whether it starts open for someone who has never touched it (§4.7). */
  defaultOpen: boolean
}

/**
 * In render order. A UNIT relabels two of these — §4.7 draws "WHO IS IT" where a cell says "WHAT IS IT" —
 * so the title is resolved through `sectionTitle`, not baked in here.
 *
 * NOTHING STARTS OPEN any more. §4.7 had three of these expanded by default, which was right while a
 * section was an accordion in the sidebar. Alexander, 2026-09-09: *"the right sidebar is still too full of
 * stuff, we should have movable modals for each section/group of actions"* — and a section is now a movable
 * panel, so "open by default" would mean three panels appearing over the map every time you clicked a cell.
 * Each row carries a summary badge, so a closed section still answers its own question.
 */
export const INSPECTOR_SECTIONS: readonly InspectorSectionDef[] = [
  { id: 'identity', title: 'Tile', defaultOpen: false },
  { id: 'looks', title: 'Appearance', defaultOpen: false },
  { id: 'size', title: 'Size & position', defaultOpen: false },
  { id: 'behaviour', title: 'Behaviour', defaultOpen: false },
  { id: 'animation', title: 'Animation', defaultOpen: false },
  { id: 'rules', title: 'Rules', defaultOpen: false },
]

/** A unit is a character, not a tile. Only this one word differs — same sections. */
const UNIT_TITLES: Partial<Record<InspectorSectionId, string>> = {
  identity: 'Character',
}

export function sectionTitle(id: InspectorSectionId, isUnit: boolean): string {
  const def = INSPECTOR_SECTIONS.find(s => s.id === id)
  if (!def) return id
  if (!isUnit) return def.title
  return UNIT_TITLES[id] ?? def.title
}

/**
 * The `/api/editor_settings` key one section persists under.
 *
 * Namespaced so it can never collide with a floating panel's geometry key — the store is one flat
 * key→value map shared by both, and a section id like "settings" would otherwise overwrite the settings
 * modal's saved rectangle.
 */
export function sectionSettingKey(id: InspectorSectionId): string {
  // `inspector.section.*` was the ACCORDION's key. A section is a movable panel now, so the same value
  // would mean something different: a row the user once expanded would become a panel opening over the map
  // the instant they select a cell. New meaning, new namespace — everyone starts with all of them closed.
  return `inspector.panelOpen.${id}`
}

/**
 * Is this section open? `saved` is what the store holds (`undefined` = never touched).
 *
 * The distinction matters: a section the user has never opened follows §4.7's design, while one they
 * explicitly collapsed stays collapsed. Treating "unset" as `false` would quietly close the three
 * sections the design wants open.
 */
export function sectionIsOpen(id: InspectorSectionId, saved: boolean | undefined): boolean {
  if (saved !== undefined) return saved
  return INSPECTOR_SECTIONS.find(s => s.id === id)?.defaultOpen ?? false
}
