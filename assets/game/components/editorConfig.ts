// Editor tool TYPES + palette/stage DATA for the game-engine editor UI.
// Pure config moved out of the page (stage 5a) so the palette/menu data isn't
// re-allocated on every render and the JSX stays a flat map instead of dozens of
// near-identical hand-written swatches. No React here — just the unions, the
// tool→type lookup, and the swatch/season data the editor cards render.
import { type EntityKind } from '@/game/types'
import { type LayerId } from '@/engine/stageGenerator'

// ── editor tool state ────────────────────────────────────────────────

/** The five editor MODES the left tool-rail switches between. Each maps onto the
 *  existing fine-grained tool state — `select` arms nothing (click to inspect),
 *  `paint` reveals the tile palette, and `unit`/`building`/`connector` arm their
 *  respective placement tools. The `building` mode is user-labelled "Tile
 *  composition" now that it stamps ANY backend composition (buildings, trees,
 *  fountains, lamp posts…), not only buildings — the id stays `building` to avoid
 *  churning the unrelated `type:'building'` asset tag it has nothing to do with. */
export type EditorMode = 'select' | 'paint' | 'unit' | 'building' | 'connector'

// ── the LEFT RAIL — one idiom for every library (§4.5 of the games-page UX design) ──
/** A rail entry id. `select` arms nothing; `terrain`/`objects`/`characters` open a LIBRARY and arm a
 *  placement tool; `generate` and `rules` open a workspace panel. Kept separate from `EditorMode`
 *  because the rail is the USER-facing vocabulary (Terrain, Objects, Characters) while `EditorMode`
 *  is the tool state the canvas reads. */
export type RailId = 'select' | 'terrain' | 'objects' | 'characters' | 'generate' | 'rules' | 'artstyle' | 'hud'

export interface RailEntry {
  id: RailId
  /** The rail's icon — also reused by the empty-Inspector orientation card so the two read as one UI. */
  glyph: string
  label: string
  /** One plain-language line: what this rail entry is FOR. Shown as the rail tooltip and in the
   *  orientation card. "Say what a control does in the label" (§4.1.5). */
  hint: string
  /** The editor tool this entry arms, when it arms one. */
  mode: EditorMode | null
}

/** The rail, in order. ONE list drives the rail buttons, their tooltips and the orientation card, so a
 *  new library is one row here — never a second hand-written list that drifts from the first. */
export const EDITOR_RAIL: readonly RailEntry[] = [
  { id: 'select', glyph: '↖', label: 'Select', hint: 'click to inspect and edit', mode: 'select' },
  { id: 'terrain', glyph: '▢', label: 'Terrain', hint: 'paint the ground', mode: 'paint' },
  { id: 'objects', glyph: '⧉', label: 'Objects', hint: 'drop in a house', mode: 'building' },
  { id: 'characters', glyph: '☻', label: 'Characters', hint: 'add people', mode: 'unit' },
  { id: 'generate', glyph: '⚡', label: 'Generate', hint: 'build a whole world', mode: null },
  { id: 'rules', glyph: '⚑', label: 'Rules', hint: 'triggers, connections & quests', mode: null },
  // Its OWN group (Alexander, 2026-09-08): *"style is a separate group, which list all available art
  // styles, IE: tileset art style"*. It was a `🎨 Style: ASCII` dropdown in the top bar and then a control
  // in the view bar; neither made it a group. The rail is where groups live, so it lives here — and it is
  // named for what it lists, a TILESET's art, rather than the bare word "Style".
  { id: 'artstyle', glyph: '🎨', label: 'Art style', hint: 'swap the whole tileset\'s art', mode: null },
]

/** The rail entries the empty Inspector offers as starting points — everything that CREATES something
 *  (so not Select, and not Rules, which needs something to exist first). */
/**
 * THE RAIL, IN BANDS — the approved redesign's left rail.
 *
 * Alexander, 2026-09-08:
 *
 *   > there's 0 sense to put art style and generate to the bottom of the sidebar, those will be usually the
 *   > first options end users will play with... you aren't thinking as an end user
 *
 * So the order is the journey: make the world, put things in it, make it a game. Three things changed from
 * `EDITOR_RAIL` above, each for a stated reason:
 *
 *  · **`generate` leads, renamed "New world"** — it is the first thing anyone does with an empty map, and
 *    map size moved into it ("I think map size should be part of generate and we should have a different
 *    label for generate").
 *  · **`select` is gone.** Grouping by the object an action acts on showed it acts on nothing — it is the
 *    resting state of the cursor. When no brush is armed, clicking selects; that needs no button.
 *  · **`artstyle` is gone from the rail** — it moved to the top nav, before the game selector, because it
 *    is the skin the whole product wears rather than a step in building a level.
 *
 * `hud` is new: the player's UI (T-115 "Bartender"), which has no home in the editor today.
 */
export interface RailBand {
  /** The band heading, in the user's words. */
  title: string
  items: readonly RailEntry[]
}

export const EDITOR_BANDS: readonly RailBand[] = [
  {
    title: 'MAKE THE WORLD',
    items: [
      { id: 'generate', glyph: '⚡', label: 'New world', hint: 'Season, kind of place, preset and size — then build it', mode: null },
    ],
  },
  {
    title: 'PUT THINGS IN IT',
    items: [
      { id: 'terrain', glyph: '▦', label: 'Tiles', hint: 'ground, walls, roofs, nature and props', mode: 'paint' },
      { id: 'objects', glyph: '⌂', label: 'Objects', hint: 'ready-made buildings and props, stamped whole', mode: 'building' },
      { id: 'characters', glyph: '☻', label: 'Characters', hint: 'people, monsters and animals', mode: 'unit' },
    ],
  },
  {
    title: 'MAKE IT A GAME',
    items: [
      { id: 'rules', glyph: '⚑', label: 'Rules', hint: 'Doorways, quests and when-then rules', mode: null },
      { id: 'hud', glyph: '🖥', label: 'Player UI', hint: 'The HUD, keys and bars your players get', mode: null },
    ],
  },
]

/** Every rail id the bands actually declare. The rail is a TABLIST: `activeRailId` must always be one of
 *  these, or the tab strip shows nothing selected and the panel gates on an id no branch matches. */
export const RAIL_IDS: ReadonlySet<RailId> = new Set(EDITOR_BANDS.flatMap(b => b.items.map(i => i.id)))

/**
 * Which rail entry a canvas MODE corresponds to — the rail's selection when no panel was opened explicitly.
 *
 * `select` is the resting state: nothing is armed, so clicking inspects. The band list has no Select entry
 * (grouping by the object an action acts on showed it acts on none), so the resting state's home is the
 * rail's FIRST entry — New world, "the first thing anyone does with an empty map".
 *
 * This mapping used to live inside the editor component, pointing `select` at a `'select'` rail id. When the
 * design dropped that entry the map kept pointing at it, and a fresh load opened with NO tab selected and an
 * EMPTY 352px library column — every branch that renders the panel gates on an id nothing equals. It lives
 * here now, one screen below `EDITOR_BANDS`, and `railConfig.test.ts` asserts every value is a real entry.
 */
export const RAIL_BY_MODE: Record<EditorMode, RailId> = {
  select: 'generate',
  paint: 'terrain',
  building: 'objects',
  unit: 'characters',
  connector: 'rules',
}

export const EDITOR_RAIL_STARTERS: readonly RailEntry[] =
  EDITOR_RAIL.filter(e => e.id !== 'select' && e.id !== 'rules' && e.id !== 'artstyle')

/** Which tool the Entities card has armed. `erase` removes; `null` = off. */
export type EntityTool = EntityKind | 'erase' | 'collision' | null

/** The armed Tile-composition tool: the backend composition KIND to stamp (`house_4`, `fountain`,
 *  `lamp_post`, `tree_tall`…), or null when nothing is armed. Clicking the map STAMPS that composition's
 *  cells (the SAME path a tree/building uses) — there is no whole-composition select / move / rotate. It
 *  holds an arbitrary kind so the palette can arm EVERY composition the backend serves, not a fixed list. */
export type BuildingTool = string | null

// ── stage generator menu ─────────────────────────────────────────────
// The SEASONS, MAP TYPES and their LAYOUTS are backend records now (`GET /api/generators`, T-113 /
// §3.14b Tier-1 #1): the four tables that used to live here — STAGE_ZONES, STAGE_VARIANTS,
// STAGE_VARIANT_LABELS and VARIANT_LAYOUTS — duplicated `Nebulith.Catalog.GeneratorSource`'s own
// `zones` / categories / `layout` columns, hand-kept with nothing enforcing the match. `GenerateControls`
// reads `lib/generatorCatalog` instead, so adding a map type is a seed row and no frontend change.

/** The active-season button TINT. Presentation, not generator data — the seasons themselves come from the
 *  catalog, and a season with no tint here simply renders in the neutral active style. Keyed loosely so a
 *  new backend season needs no frontend edit to appear (only to be tinted). */
export const SEASON_BTN: Record<string, string> = {
  spring: 'bg-pink-600 ring-1 ring-pink-300',
  summer: 'bg-green-700 ring-1 ring-green-300',
  autumn: 'bg-orange-700 ring-1 ring-orange-300',
  winter: 'bg-sky-700 ring-1 ring-sky-300',
  desert: 'bg-yellow-700 ring-1 ring-yellow-300',
}

/** The tint an active season with no entry above falls back to — a colour choice, never generator data. */
export const SEASON_BTN_ACTIVE = 'bg-purple-600 ring-1 ring-purple-300'

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
