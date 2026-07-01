// Editor tool TYPES + palette/stage DATA for the game-engine editor UI.
// Pure config moved out of the page (stage 5a) so the palette/menu data isn't
// re-allocated on every render and the JSX stays a flat map instead of dozens of
// near-identical hand-written swatches. No React here — just the unions, the
// tool→type lookup, and the swatch/season data the editor cards render.
import { type BuildingType } from '@/engine/buildingComposer'
import { type EntityKind } from '@/game/types'

// ── editor tool state ────────────────────────────────────────────────

/** The five editor MODES the left tool-rail switches between. Each maps onto the
 *  existing fine-grained tool state — `select` arms nothing (click to inspect),
 *  `paint` reveals the tile palette, and `unit`/`building`/`connector` arm their
 *  respective placement tools. */
export type EditorMode = 'select' | 'paint' | 'unit' | 'building' | 'connector'

/** Which tool the Entities card has armed. `erase` removes; `null` = off. */
export type EntityTool = EntityKind | 'erase' | 'collision' | null

/** Which building tool is armed. Place-<type> drops a fresh building; select picks
 *  one to move/rotate/delete; delete removes the one under the click; null = off. */
export type BuildingTool = 'select' | 'place-house' | 'place-store' | 'place-hospital' | 'delete' | null

/** Map a Place-<type> tool to the BuildingType it authors. */
export const BUILDING_TOOL_TYPE: Partial<Record<NonNullable<BuildingTool>, BuildingType>> = {
  'place-house': 'house',
  'place-store': 'store',
  'place-hospital': 'hospital',
}

// ── asset palette data (drives the Assets card) ──────────────────────
export type GroundSwatch = { char: string; name: string; bg: string; fg: string; groundType: string }

export const GROUND_SWATCHES: readonly GroundSwatch[] = [
  { char: '.', name: 'Grass', bg: '#1a5522', fg: '#33aa33', groundType: 'grass' },
  { char: '~', name: 'Water', bg: '#1155aa', fg: '#55bbff', groundType: 'water' },
  { char: '=', name: 'Road', bg: '#7a6644', fg: '#ccbb88', groundType: 'road' },
  { char: '#', name: 'Plaza', bg: '#aa9966', fg: '#eeddbb', groundType: 'plaza' },
  { char: '|', name: 'Bridge', bg: '#664422', fg: '#bb8844', groundType: 'bridge' },
]

export const NATURE_TILE_KEYS: readonly string[] = [
  'trunk', 'trunk_thick', 'foliage', 'foliage_light', 'foliage_dark', 'stump',
]

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
export const STAGE_VARIANTS = ['forest', 'town', 'city', 'cave'] as const // forest, seasonal settlements (town → ~4× city), + a seasonal cavern
