// Editor tool TYPES + palette/stage DATA for the game-engine editor UI.
// Pure config moved out of the page (stage 5a) so the palette/menu data isn't
// re-allocated on every render and the JSX stays a flat map instead of dozens of
// near-identical hand-written swatches. No React here — just the unions, the
// tool→type lookup, and the swatch/season data the editor cards render.
import { type EntityKind } from '@/game/types'

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

// Shared field styling for the small editor form controls (triggers + animation editors).
export const SELECT_CLS = 'flex-1 rounded bg-gray-800 p-1 text-xs text-gray-100'
export const INPUT_CLS = 'w-full rounded bg-gray-800 p-1 text-xs text-gray-100'
