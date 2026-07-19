/**
 * The Tile-composition PALETTE catalog — turns the backend-served compositions (the SAME set the world
 * randomizer stamps: buildings, trees/bushes, fountains, wells, lamp posts…) into a grouped, labelled list
 * the editor's left panel renders. Data-driven: it reads whatever `compositions` the DB tileset carries, so
 * the palette lists EVERY composition, not a hardcoded building-only subset. No React here — pure derivation,
 * so it unit-tests directly and the JSX stays a flat map.
 */
import type { Composition, Tileset } from './tileset/tileset'
import { compositionFacesRoad } from './buildingCatalog'

/** The three sensible buckets a composition falls into, in display order. A building (has a door) leads;
 *  then the natural cover (trees/bushes); then the standalone street props (fountain/well/lamp post). */
export type CompositionGroup = 'Buildings' | 'Nature' | 'Props'
export const COMPOSITION_GROUP_ORDER: readonly CompositionGroup[] = ['Buildings', 'Nature', 'Props']

/** One placeable composition in the palette: the backend KIND to stamp, a human LABEL, its footprint size
 *  (so the button can show "how many blocks" before you even hover), and the group it sorts under. */
export interface CompositionPaletteItem {
  kind: string
  label: string
  footprint: { w: number; h: number }
  group: CompositionGroup
}

/** A palette section — a group header plus its items. */
export interface CompositionPaletteGroup {
  group: CompositionGroup
  items: CompositionPaletteItem[]
}

/** Which bucket a composition belongs to. Buildings are the door-bearing ones (compositionFacesRoad); the
 *  rest split by NAME into natural cover (tree/bush kinds) vs. standalone props (everything else — fountain,
 *  well, lamp post…). Pure, so the grouping is testable without a tileset load. */
export function compositionGroup(kind: string, comp: Composition): CompositionGroup {
  if (compositionFacesRoad(comp)) return 'Buildings'
  if (/^(tree|bush)/.test(kind)) return 'Nature'
  return 'Props'
}

/** A readable label for a composition: its authored `title` when present (a store's "Store"), else the kind
 *  humanised — underscores → spaces, first letter capitalised ("lamp_post" → "Lamp post", "house_4" →
 *  "House 4"). Keeps the size suffix so the three house variants stay distinguishable. Pure. */
export function compositionLabel(kind: string, comp: Composition): string {
  if (comp.title) return comp.title
  const spaced = kind.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** Build the grouped palette from a loaded tileset's compositions — EVERY composition the backend serves,
 *  bucketed and sorted by label within each group, groups in display order. Empty groups are dropped so the
 *  panel shows only sections that have items. Returns [] before the tileset (and its compositions) load. */
export function buildCompositionPalette(tileset: Tileset): CompositionPaletteGroup[] {
  const comps = tileset.compositions ?? {}
  const items: CompositionPaletteItem[] = Object.entries(comps).map(([kind, comp]) => ({
    kind,
    label: compositionLabel(kind, comp),
    footprint: comp.footprint,
    group: compositionGroup(kind, comp),
  }))
  return COMPOSITION_GROUP_ORDER
    .map(group => ({
      group,
      items: items.filter(it => it.group === group).sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)),
    }))
    .filter(section => section.items.length > 0)
}
