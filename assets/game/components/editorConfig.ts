// Editor tool TYPES + palette/stage DATA for the game-engine editor UI.
// Pure config moved out of the page (stage 5a) so the palette/menu data isn't
// re-allocated on every render and the JSX stays a flat map instead of dozens of
// near-identical hand-written swatches. No React here — just the unions, the
// tool→type lookup, and the swatch/season data the editor cards render.
import { type BuildingType } from '@/engine/buildingTypes'
import { type EntityKind } from '@/game/types'

// ── editor tool state ────────────────────────────────────────────────

/** The five editor MODES the left tool-rail switches between. Each maps onto the
 *  existing fine-grained tool state — `select` arms nothing (click to inspect),
 *  `paint` reveals the tile palette, and `unit`/`building`/`connector` arm their
 *  respective placement tools. */
export type EditorMode = 'select' | 'paint' | 'unit' | 'building' | 'connector'

/** Which tool the Entities card has armed. `erase` removes; `null` = off. */
export type EntityTool = EntityKind | 'erase' | 'collision' | null

/** Which building PLACE tool is armed. Place-<type> STAMPS a pre-built building composition (its cells,
 *  like placing a tree); there is no whole-building select / move / rotate / delete. null = off. */
export type BuildingTool =
  | 'place-house' | 'place-big-house' | 'place-store' | 'place-hospital'
  | 'place-temple' | 'place-cathedral' | 'place-castle' | null

/** Map a Place-<type> tool to the BuildingType it stamps. */
export const BUILDING_TOOL_TYPE: Partial<Record<NonNullable<BuildingTool>, BuildingType>> = {
  'place-house': 'house',
  'place-big-house': 'big-house',
  'place-store': 'store',
  'place-hospital': 'hospital',
  'place-temple': 'temple',
  'place-cathedral': 'cathedral',
  'place-castle': 'castle',
}

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
