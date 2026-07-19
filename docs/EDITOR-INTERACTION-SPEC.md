# Nebulith — Editor Interaction & Behavior Spec

Status: **design captured 2026-06-21** (Alexander). How the editor lets a non-dev select things
and configure their behavior, plus the UI reorg and art-style requirements.

## 1. Selection-driven configuration (the core interaction)
Clicking a placed thing **selects** it and opens its config on the **right sidebar** — stats/options
appear *only when selected*, never cluttering the left sidebar.
- **Click an entity** → selected → right panel shows: its **stats** (for combatants), and options to
  add **attacks**, **quests** (NPC), **movement patterns**, **actions/animations**.
- **Click a structure/asset** → selected → right panel shows its options (actions, animations,
  movement if applicable).
- **Important:** character/enemy stats must NOT show on the sidebar by default — only on selection.

## 2. Entity model (expanded)
An entity has a **type/role**: `decoration` · `enemy` · `npc` · `player` · and hit-behavior flags
`hittable` / `non_hittable` (and more as needed). Per entity, configurable:
- **Stats** (combatants): HP + the combat stats.
- **Attacks**: which attacks it can use.
- **Quests** (NPC quest-givers).
- **Movement patterns** (see §3).
- **Actions / animations** (see §4).

## 3. Movement patterns
- An entity (esp. an enemy) can have **many movement patterns**.
- Patterns run **sequential** (one after another) or **randomized** (pick at random).
- A pattern is a path/behavior (patrol a route, chase, wander a region, idle). Authored on the
  entity's right-panel config; the play loop drives the entity along the active pattern.

## 4. Asset / structure actions & animations
Some assets/structures carry **timed actions** and **looping animations**:
- A **cannon** fires every X seconds (a timed action → spawns a projectile / triggers an attack).
- A **lamp** runs a looping light animation (a visual loop, no gameplay effect).
- Same select→configure pattern: select the asset → set its action interval / animation on the right.
- Model: an asset can hold `actions[]` (timed/triggered) and `animation` (loop spec). The renderer
  plays the animation; the loop fires the actions on their interval.

## 5. UI reorg (reduce scrolling)
Current editor has TOO MUCH vertical scrolling. Target:
- **TOP NAV BAR:** **Export** + **Save / Load template** move here (out of the right sidebar).
- **LEFT sidebar:** Views + grid · Stage presets · **Assets — EXPANDABLE/collapsible** groups
  (Ground/Nature/Building/Decorations/Composite) so they don't all scroll at once.
- **RIGHT sidebar:** **Connectors** + **Entities** + the **selection config** panel (§1).
- Net: left = "what to place", right = "configure what's placed", top = file/export ops.

## 6. Composite/structure asset SCALING (bug → requirement)
**Bug:** selecting N cells then clicking e.g. "Well" stamps a **fixed 4-cell** `COMPOSITE_ASSETS`
shape (`placeCompositeAsset`), ignoring the selection — and it's not persisted to the template nor
visible in iso/2D. **Requirement:** a composite/structure must **scale to the selected cells** (40
selected → a 40-cell well), like a building stamped from its backend composition, be added as real grid assets
(labeled, per the keystone), persist in the template, and render in all three views.

## 7. Art styles
- **Default (regular) art style** in addition to lava + frozen → so we can generate a **regular
  forest**. The `verdant` zone already exists in the engine — expose it in the UI zone selector as
  the default ("Regular"/"Default"). Default zone = verdant.
- **Zone-styled trees** must match the selected style: lava → charred, frozen → frosted (done in the
  generator via TREE_PALETTES; verify they render per the selected zone).
- **Lava must look like lava:** the lava-zone floor (ash/rock/basalt) is now dark charred ground with
  ember glow (was neutral gray). Keep pushing the molten read.
- **Zone decorations:** **volcanoes** for lava, **mountains** for frozen — large multi-cell labeled
  decorations (render per-cell via the keystone path; emit from the generator + a label set).

## 8. Shared settings panel — a tile and a unit configure the SAME way
A selected TILE and a selected UNIT open the **same** floating settings panel, so configuring a unit
looks and works exactly like configuring a tile (Alexander: "have the same UX/UI for both, regular tiles
and units … but on units we'd might have a few extra things here and there, like the inventory").
- **One component.** The panel body is a single shared `SettingsPanelBody` = the tile `TileControls`
  (colour · width/height/zoom · x/y/z · rotate · flip) plus, for a unit only, a `UnitSettingsSection`
  appended underneath. A tile passes no unit model, so the extras never show; there is no forked copy.
- **The unit's shared settings.** A unit maps its own fields into the same control model: colour →
  `entity.color`, the scale axes → the unit's uniform `size`, and x/y/rotate/flip → a new `entity.pose`
  (same `TilePose` shape a tile carries; round-trips through the entity codec). All writers fan out to the
  selected unit via the same `patchSelectedEntity` path the sidebar uses — one source of truth.
- **Clean split, no tangle.** Asset-only controls that make no sense on a unit (Z Width, Z-Index, Display,
  Shape, Light, the z-slide) are simply not wired for a unit, so `TileControls` hides each of those rows —
  exactly the conditional a floor tile already relies on. Tile-only controls stay out of the unit view and
  vice-versa.
- **Unit-only extras** (`UnitSettingsSection`): the unit's identity + vitals (name, type/role, HP + combat
  stats, hittable / blocks-movement) and the entry points a tile never has — the **inventory** (player) and
  **quests** (NPC). These open the existing inventory / quest modals.
- **Render-parity is separate (#35).** The editor writes + persists every shared setting. Whether the unit
  RENDERER honors each one is the broader unit/tile render-parity work: today the on-canvas figure honors the
  **name** label; `size`/`color` are honored for enemies/NPCs but NOT the player (the player draws through a
  separate hero path); `pose` and the other shared settings are not yet read on a unit. Those are follow-ups.

## 9. The Paint palette + painted tiles (tileset painter — one source of truth)
The left **Paint** tool's tile list ("TERRAIN / TILES & GROUND / …") and a painted tile must be the SAME
system the GENERATOR and the RENDERER use — never a separate or hardcoded list.

- **Palette source = the DB tileset.** The palette is `tilesForStyle(styleId)`, which reads LIVE from the
  backend-loaded `EMOJI_TILESET` / `ASCII_TILESET` (installed by `tilesetLoader` from `:4000` `/api/tilesets`).
  A tile is browseable when its DB entry carries a `category` (terrain/buildings/units/nature); its name is the
  DB `title`, its art the DB image/glyph. There is NO parallel hardcoded catalog — the palette always matches
  the map. (The same tileset the generator's `resolveTile`/`resolveComposition` and the label→image renderer
  resolve from.)
- **A palette tile FULLY describes its DB tile.** `TileDef` carries the tile's DB **block height** and
  **settings** (the generic `fadeNear`/`cutawayRoof`/`display` blob), not just its art — so the brush can seed
  a painted asset that is byte-identical to a generated one.
- **A painted tile IS a normal, editable tile.** The brush (`stackAssetTile`) stamps a real `GridAsset` pinned
  to the exact tile (`tileOverride`) and **seeded from the DB tile**: its **height** (so a block tile — a
  boulder, a stone wall — paints as a real extruded BLOCK, not a flat single-face billboard; a flat tile stays
  flat), and its **settings** via the SAME `tileRenderBehavior` seam `stampComposition` uses. It is selectable,
  changeable (colour/shape/size/pose/display via the Inspector), and NEVER forced to a single flat default —
  exactly like a generated tile.
- **Apply a tile to ONE or MANY cells.** With a tile armed, a plain click paints the clicked cell; **shift-drag
  selects a rectangle of cells, then one click fills them all** (`applyArmedBrush` fans out over the selection,
  else the single clicked cell). ⌥Alt-click removes the top tile.
- **Apply settings to MANY selected tiles.** With multiple cells selected, editing a setting in the Inspector
  fans out to the i-th stacked tile of EVERY selected cell (`applyToSelectedCells` → the `setAsset*` writers) —
  one edit changes all selected tiles.

## Build order (after the current quest/inventory wiring)
1. Composite asset scaling + persistence/render (§6) — concrete bug.
2. UI reorg (§5) — top nav + expandable assets + right-side connectors/entities/selection.
3. Selection-driven config panel (§1) — the interaction backbone.
4. Entity types + movement patterns (§2,§3).
5. Asset/structure actions + animations (§4) — cannon/lamp.
6. Default art-style in UI + volcanoes/mountains decorations (§7).
