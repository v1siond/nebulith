/**
 * The Tile-composition PALETTE catalog — turns the backend-served compositions (the SAME set the world
 * randomizer stamps: buildings, trees/bushes, fountains, wells, lamp posts…) into a grouped, labelled list
 * the editor's left panel renders.
 *
 * GROUPED BY THE COMPOSITION'S BACKEND `category`, exactly the way the tile palette groups tiles by their DB
 * `category` (artStyle `tilesForStyle` :348). There is NO frontend heuristic: the backend OWNS the bucket
 * (MAP-MODEL §8, EDITOR-INTERACTION-SPEC §11/§12), the frontend only reads + orders it — replacing the old
 * `compositionGroup()` that DERIVED the group from door-detection + a `/^(tree|bush)/` name regex (the banned
 * "frontend invents data / branch by name" pattern). No React here — pure derivation, so it unit-tests
 * directly and the JSX stays a flat map.
 */
import type { Composition, Tileset } from './tileset/tileset'

/** A composition's sidebar BUCKET — the subset of the tile `TileCategory` vocabulary (artStyle) that a whole
 *  composition falls into. Served on each composition by `/api/tilesets` as `category`; the palette READS it. */
export type CompositionCategory = 'terrain' | 'buildings' | 'nature' | 'props'

/** The canonical group order — a subset of the tile category order (artStyle `TILE_CATEGORIES`), so a
 *  composition sorts under the SAME heading order tiles do, and the single source for iterating every group.
 *  Empty groups are dropped, so with no `terrain` compositions the visible order is Buildings → Nature → Props. */
export const COMPOSITION_CATEGORIES: readonly CompositionCategory[] = ['terrain', 'buildings', 'nature', 'props']

/** A composition is BROWSEABLE (listed in the palette) when its served `category` is one of these — mirrors
 *  artStyle `BROWSEABLE_CATEGORIES`: a category marks a thing browseable. A composition with no/unknown
 *  category renders on the map but never surfaces in the palette (exactly like an uncategorized tile). */
const BROWSEABLE: ReadonlySet<string> = new Set<CompositionCategory>(COMPOSITION_CATEGORIES)

/** The prettier section HEADER per bucket — mirrors editorChrome's tile `CATEGORY_LABELS`. */
export const COMPOSITION_CATEGORY_LABELS: Record<CompositionCategory, string> = {
  terrain: 'Terrain',
  buildings: 'Buildings',
  nature: 'Nature',
  props: 'Props',
}

/** A scannable glyph per bucket for the palette section header — frontend PRESENTATION only (like the label);
 *  the bucket itself is the backend's `category`. Lets the eye jump to "the trees" or "the props" at a glance. */
export const COMPOSITION_CATEGORY_GLYPH: Record<CompositionCategory, string> = {
  terrain: '▦',
  buildings: '⌂',
  nature: '❀',
  props: '✦',
}

/** One placeable composition in the palette: the backend KIND to stamp, a human LABEL, its footprint size
 *  (so the button can show "how many blocks" before you even hover), and the backend CATEGORY it sorts under. */
export interface CompositionPaletteItem {
  kind: string
  label: string
  footprint: { w: number; h: number }
  category: CompositionCategory
}

/** A palette section — a group (its backend bucket + display header) plus its items. */
export interface CompositionPaletteGroup {
  category: CompositionCategory
  /** the prettier heading shown above the section (`COMPOSITION_CATEGORY_LABELS[category]`). */
  label: string
  items: CompositionPaletteItem[]
}

/** A readable label for a composition: its authored `title` when present (a store's "Store"), else the kind
 *  humanised — underscores → spaces, first letter capitalised ("lamp_post" → "Lamp post", "house_4" →
 *  "House 4"). Keeps the size suffix so the three house variants stay distinguishable. Pure. */
export function compositionLabel(kind: string, comp: Composition): string {
  if (comp.title) return comp.title
  const spaced = kind.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** Build the grouped palette from a loaded tileset's compositions, GROUPED BY THE BACKEND `category` (never a
 *  name/door heuristic). A composition is listed only when its served category is a browseable bucket — the
 *  SAME gate `tilesForStyle` applies to tiles. Groups are emitted in the canonical order, sorted by label
 *  within each, and empty groups are dropped so the panel shows only sections that have items. Returns []
 *  before the tileset (and its compositions) load. */
export function buildCompositionPalette(tileset: Tileset): CompositionPaletteGroup[] {
  const comps = tileset.compositions ?? {}
  const byCategory = Object.fromEntries(
    COMPOSITION_CATEGORIES.map(c => [c, [] as CompositionPaletteItem[]]),
  ) as Record<CompositionCategory, CompositionPaletteItem[]>

  for (const [kind, comp] of Object.entries(comps)) {
    const category = comp.category
    if (!category || !BROWSEABLE.has(category)) continue // no browseable category → never surfaces in the palette
    byCategory[category as CompositionCategory].push({
      kind,
      label: compositionLabel(kind, comp),
      footprint: comp.footprint,
      category: category as CompositionCategory,
    })
  }

  return COMPOSITION_CATEGORIES
    .map(category => ({
      category,
      label: COMPOSITION_CATEGORY_LABELS[category],
      items: byCategory[category].sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)),
    }))
    .filter(section => section.items.length > 0)
}
