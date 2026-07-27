// Editor tool TYPES + palette/stage DATA for the game-engine editor UI.
// Pure config moved out of the page (stage 5a) so the palette/menu data isn't
// re-allocated on every render and the JSX stays a flat map instead of dozens of
// near-identical hand-written swatches. No React here — just the unions, the
// tool→type lookup, and the swatch/season data the editor cards render.
import { type EntityKind } from '@/game/types'
import { type ForestLayout, type LayerId } from '@/engine/stageGenerator'

// ── editor tool state ────────────────────────────────────────────────

/** The five editor MODES the left tool-rail switches between. Each maps onto the
 *  existing fine-grained tool state — `select` arms nothing (click to inspect),
 *  `paint` reveals the tile palette, and `unit`/`building`/`connector` arm their
 *  respective placement tools. The `building` mode is user-labelled "Tile
 *  composition" now that it stamps ANY backend composition (buildings, trees,
 *  fountains, lamp posts…), not only buildings — the id stays `building` to avoid
 *  churning the unrelated `type:'building'` asset tag it has nothing to do with. */
export type EditorMode = 'select' | 'paint' | 'unit' | 'building' | 'connector'

/** Which tool the Entities card has armed. `erase` removes; `null` = off. */
export type EntityTool = EntityKind | 'erase' | 'collision' | null

/** The armed Tile-composition tool: the backend composition KIND to stamp (`house_4`, `fountain`,
 *  `lamp_post`, `tree_tall`…), or null when nothing is armed. Clicking the map STAMPS that composition's
 *  cells (the SAME path a tree/building uses) — there is no whole-composition select / move / rotate. It
 *  holds an arbitrary kind so the palette can arm EVERY composition the backend serves, not a fixed list. */
export type BuildingTool = string | null

// ── stage generator menu (zone × variant) ────────────────────────────
// Forest-only engine: 5 seasons, beach + lava removed.
export const STAGE_ZONES = ['spring', 'summer', 'autumn', 'winter', 'desert'] as const
// Active-zone button tint (seasonal accent).
export const SEASON_BTN: Record<(typeof STAGE_ZONES)[number], string> = {
  spring: 'bg-pink-600 ring-1 ring-pink-300',
  summer: 'bg-green-700 ring-1 ring-green-300',
  autumn: 'bg-orange-700 ring-1 ring-orange-300',
  winter: 'bg-sky-700 ring-1 ring-sky-300',
  desert: 'bg-yellow-700 ring-1 ring-yellow-300',
}
export const STAGE_VARIANTS = ['forest', 'town', 'city', 'cave', 'temple'] as const // forest, seasonal settlements (town → ~4× city), a seasonal cavern, + a seasonal temple dungeon

/** The user-facing name of each map type — the menu renders this instead of the raw id, and the layout
 *  group + re-roll copy read it so a header says "Forest layouts" and the hint names the current map. */
export const STAGE_VARIANT_LABELS: Record<(typeof STAGE_VARIANTS)[number], string> = {
  forest: 'Forest', town: 'Town', city: 'City', cave: 'Cave', temple: 'Temple',
}

// ── per-variant LAYOUT options (zone × variant × layout) ─────────────
// A LAYOUT is the general SHAPE the user steers within a map type; the generator randomizes the rest
// (GENERATION-SPEC §3/§5.4). The `id` must be a real `ForestLayout` (type-checked), the `label` is user-facing.
export interface LayoutOption { id: ForestLayout; label: string }

/** The forest's layouts — the single source the picker maps over. */
export const FOREST_LAYOUT_OPTIONS: ReadonlyArray<LayoutOption> = [
  { id: 'meadow', label: 'Meadow' },
  { id: 'meadow_river', label: 'Meadow + River' },
]

/** Layouts KEYED BY MAP TYPE — the menu looks a variant's layouts up here, so the same picker serves every
 *  variant with NO `variant === 'forest'` branch (GLOBAL, data-driven). A variant with no entry simply has no
 *  layouts yet, so its group is omitted — adding some is ONE row here + registering the builders in the engine
 *  (`FOREST_LAYOUTS`). Only `forest` has wired builders today; a layout whose builder isn't wired falls back
 *  to the default generate rather than crashing. */
export const VARIANT_LAYOUTS: Partial<Record<(typeof STAGE_VARIANTS)[number], ReadonlyArray<LayoutOption>>> = {
  forest: FOREST_LAYOUT_OPTIONS,
}

// ── universal generator LAYERS (the per-map-type sub-categories) ──────
/** The generator LAYERS every map type shares — a forest, a town, a temple all have a layout, structures,
 *  nature, decor and units. Re-rolling one re-generates just THAT layer of the CURRENT map, keeping the rest
 *  (GENERATION-SPEC §5). GLOBAL: the same five for every variant, never gated per map type. Order matches the
 *  engine's `LAYER_IDS`; `label`/`hint` are user-facing. Adding a layer = one row here + a pass in the engine. */
export const GENERATOR_LAYERS: ReadonlyArray<{ id: LayerId; label: string; hint: string }> = [
  { id: 'layout', label: 'Layout', hint: 'the bare shape — streets, plots & clearings, with structures and nature stripped' },
  { id: 'buildings', label: 'Buildings', hint: 'the structures, re-rolled in place' },
  { id: 'nature', label: 'Nature', hint: 'the trees, plants & greenery' },
  { id: 'decor', label: 'Decor', hint: 'the dressing — plazas, lamps & fountains' },
  { id: 'units', label: 'Units', hint: 'the creatures & townsfolk' },
]

// Shared field styling for the small editor form controls (triggers + animation editors).
export const SELECT_CLS = 'flex-1 rounded bg-gray-800 p-1 text-xs text-gray-100'
export const INPUT_CLS = 'w-full rounded bg-gray-800 p-1 text-xs text-gray-100'
