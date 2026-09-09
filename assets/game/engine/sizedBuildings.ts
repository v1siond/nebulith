/**
 * ONE ENTRY PER BUILDING TYPE, not one per baked size.
 *
 * Alexander, 2026-09-08: *"there's redundancy with some elements, for example, we have 4 houses each with
 * their own size … why having 3 size house when we can have 1 house button and allow user to make a house
 * as big or as small as he wants???"*
 *
 * The size used to live in the composition NAME — `house_3`, `house_4`, `house_5` — so the palette showed
 * three houses. The backend can now compose any footprint, so the palette shows ONE House with a size
 * control, and the sizes those three names encoded become defaults rather than separate objects.
 *
 * This is the collapse, kept pure so it can be tested without a catalog or a canvas: given the palette the
 * loaded tileset produced and the types the backend says it can compose, fold every `<type>_<n>` item into
 * one entry for `<type>`.
 *
 * A composition the backend does NOT list as a type is left exactly as it is. That is not a fallback, it is
 * the correct answer: `stone_building`, `fountain`, `lamp_post` and the trees are authored objects with no
 * parametric recipe, and folding them would claim a size control the backend cannot honour.
 */
import type { CompositionPaletteGroup, CompositionPaletteItem } from './compositionCatalog'
import type { BuildingType, Footprint } from '@/lib/buildingSizes'

/** A palette entry that carries a size control, because the backend can compose its type at any size. */
export interface SizedBuildingItem extends CompositionPaletteItem {
  /** The backend type this entry composes — present ONLY on a sizable entry. */
  buildingType: string
  /** The size it composes at unless the user changes it. */
  defaultSize: Footprint
  /** The footprints that were authored as separate compositions, for reference in the UI. */
  bakedSizes: readonly number[]
  /**
   * A REAL composition kind to draw the entry's picture from — the seeded one nearest its default size.
   *
   * The folded entry's own `kind` is the bare type (`house`), which is not a composition: nothing is
   * installed under it until the user picks a size and the backend composes one. Drawing from it gave a
   * black swatch, correctly — there was nothing there. The seeded eleven still exist, so `house_4` is a
   * real house to show while the size control sits underneath offering any other.
   */
  previewKind: string
}

export function isSizable(item: CompositionPaletteItem): item is SizedBuildingItem {
  return typeof (item as SizedBuildingItem).buildingType === 'string'
}

/** `house_4` → `house`; `stone_building` → `stone_building` (no trailing size to strip). */
export function typeOfKind(kind: string): string {
  const match = /^(.+)_(\d+)$/.exec(kind)
  return match ? match[1] : kind
}

/** The baked width a name encodes, or undefined when it encodes none. */
export function bakedWidthOfKind(kind: string): number | undefined {
  const match = /^(.+)_(\d+)$/.exec(kind)
  return match ? Number(match[2]) : undefined
}

/**
 * Fold the palette's size variants into one entry per composable type.
 *
 * Ordering is preserved by first appearance, so the palette does not reshuffle when the backend's type list
 * happens to be sorted differently from the catalog's.
 */
export function collapseSizedBuildings(
  sections: readonly CompositionPaletteGroup[],
  types: readonly BuildingType[],
): CompositionPaletteGroup[] {
  if (types.length === 0) return sections as CompositionPaletteGroup[] // nothing composable → nothing to fold
  const byType = new Map(types.map(t => [t.key, t]))

  return sections.map(section => {
    const out: CompositionPaletteItem[] = []
    const foldedAt = new Map<string, number>() // type → its index in `out`
    const baked = new Map<string, number[]>()

    for (const item of section.items) {
      const type = typeOfKind(item.kind)
      const spec = byType.get(type)
      if (!spec) {
        out.push(item) // authored object with no recipe — untouched
        continue
      }
      const width = bakedWidthOfKind(item.kind)
      if (width !== undefined) baked.set(type, [...(baked.get(type) ?? []), width].sort((a, b) => a - b))

      const at = foldedAt.get(type)
      if (at !== undefined) continue // already represented; its size is a control, not another button
      foldedAt.set(type, out.length)
      out.push({
        ...item,
        kind: type,
        label: labelForType(type),
        footprint: { w: spec.default.w, h: spec.default.h },
        buildingType: type,
        defaultSize: spec.default,
        bakedSizes: [],
        previewKind: item.kind, // the first seeded size seen; refined below to the one nearest the default
      } as SizedBuildingItem)
    }

    // Attach the baked widths once every item has been seen, so the list is complete — and pick the picture
    // from the baked size NEAREST the default, so a House shows the 4-wide one rather than whichever
    // happened to sort first.
    for (const [type, index] of foldedAt) {
      const entry = out[index] as SizedBuildingItem
      const widths = baked.get(type) ?? []
      const nearest = widths.length
        ? widths.reduce((best, w) => (Math.abs(w - entry.defaultSize.w) < Math.abs(best - entry.defaultSize.w) ? w : best))
        : undefined
      out[index] = {
        ...entry,
        bakedSizes: widths,
        previewKind: nearest === undefined ? entry.previewKind : `${type}_${nearest}`,
      } as SizedBuildingItem
    }
    return { ...section, items: out }
  })
}

/** `big_house` → "Big house". The type key is a slug; the palette shows a name. */
export function labelForType(type: string): string {
  const words = type.split('_')
  return words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ')
}
