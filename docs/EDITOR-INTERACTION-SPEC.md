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

## 8. ONE unified inspector card — a tile and a unit share the SAME card
A selected TILE and a selected UNIT render the **same** right-sidebar card (`PropertiesPanel`), so a unit is
configured exactly like a tile — NOT a separate parallel unit sidebar (Alexander: "one single right sidebar,
I want the same we use for tiles, with the extra unit options added … the unit data can be merged in to the
general tile card").
- **One card component.** `PropertiesPanel` is the single card. For a CELL it shows a collision row + the
  compact tile summary. For a UNIT the page passes `unitSection`, which HIDES the collision row (a unit isn't
  a cell) and folds the unit's data UNDER the same tile summary. The unit's sprite IS its tile ("everything is
  a tile"): colour swatch, Open Tile Library, and "Edit settings…" all come from the shared tile summary.
- **The unit's shared settings.** A unit maps its own fields into the same `TileControlModel`: colour →
  `entity.color`, the scale axes → the unit's uniform `size`, x/y/rotate/flip → `entity.pose` (same `TilePose`
  a tile carries; round-trips through the entity codec). Writers fan out via `patchSelectedEntity` — one
  source of truth. "Edit settings…" opens the SAME floating `SettingsPanelBody` (tile-only body: colour ·
  width/height/zoom · x/y/z · rotate · flip) a tile opens — asset-only rows (Z Width, Z-Index, Display, Shape,
  Light, z-slide) stay hidden for a unit exactly as they do for a floor tile.
- **Unit-only extras** (`UnitSettingsSection`, folded INTO the card): appearance (figure variant + size
  preset), the unit's identity + vitals (name, type/role, HP + combat stats, hittable / blocks-movement), and
  the entry-point buttons a tile never has — **inventory** (player), **quests** (NPC), **attacks** (enemy) —
  which open their own modals.
- **Animate is a button opening the IDENTICAL modal a tile uses.** The old inline unit "Animation" section
  (figure/size/colour + frame-list summary + "See more…") is REMOVED. The card's "✦ Animate…" button opens the
  ONE shared `TileAnimationEditor` in a floating modal — the SAME modal a tile opens, with **BOTH** add-buttons:
  **"✦ Add settings animation"** (position/scale/colour/opacity envelopes, exactly like a tile) AND **"✦ Add
  sprite animation"** (the frame-swap walk/idle/attack cycle). The user: *"both unit and tiles should use the
  same animations modal... which is the one used by settings animation on tile."* A unit stores the same unified
  `Animation[]` a tile does in `Entity.unitAnimations`; its frame-swap render list (`Entity.animations`) is the
  derived sprite subset the untouched frame renderer plays. **Render-parity follow-up:** a unit's settings-kind
  envelope persists + authors but the entity renderer doesn't apply it yet (see §render-parity below).
- **Movement pattern is removed (dead code).** The unit "Movement pattern" authoring section + `EntityMovementBody`
  + the waypoint-authoring plumbing (`waypointMode`, `appendWaypoint`) are deleted. Enemy patrol still runs at
  play time from `entity.movement` (spawner default / `advanceEnemyMovement`); only the unused authoring UI is gone.
- **Render-parity is separate (#35).** The editor writes + persists every shared setting; whether the unit
  RENDERER honors each is the broader render-parity work (name honored; `size`/`color` for enemies/NPCs but not
  the player's hero path; `pose` not yet read on a unit; a unit's **settings-kind animation** persists + authors
  in the shared modal but the entity renderer doesn't apply the envelope yet — sprite frames do render). Those
  are follow-ups.

## 9. Triggers — a button + a modal (not an inline expando)
Both the cell card and the unit card carry a **"⚑ Triggers…"** button (with a count badge). It opens a
trigger-authoring **floating modal** (`TriggerEditor` in a `FloatingPanel`, like the settings panel), NOT an
inline expando. It edits the SAME trigger data as before — a cell's `enter`/`interact` triggers
(`setTriggersForCell`) or a unit's `defeat` triggers (`setTriggersForEntity`).

## 10. Movable, resizable modals with backend-persisted geometry
Every editor modal that hosts a settings-style body is a draggable + resizable **non-blocking** `FloatingPanel`
(Alexander: "move and resize them at will and I want to save the position, size, as settings for the editor in
the elixir backend"). This now covers: **settings** (tile + unit), **animation** (unit — the shared tile-animation modal, both kinds),
**tileAnimation** (per-tile settings tweens), **triggers**, and **attacks** (enemy).
- **Backend owns the geometry.** nebulith exposes a small key→value editor-settings store — `GET
  /api/editor_settings` returns `{editorSettings: {<modalId>: {x,y,w,h}}}`, `PUT /api/editor_settings/:key`
  upserts one modal's geometry. `key` is the modal id (`settings`/`animation`/`triggers`/`attacks`/
  `tileAnimation`); `value` is the panel's `{x,y,w,h}`. A single global record per key (no per-user auth).
- **Frontend never hardcodes geometry.** The editor loads the whole map once on mount (`getEditorSettings`),
  restores each panel's saved position/size on open, and on every drag/resize END upserts the one key
  (`saveEditorSetting`, debounced). `FloatingPanel` emits the final geometry via `onGeometryChange`.

## 11. The Paint palette + painted tiles (tileset painter — one source of truth)
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
- **Z-Width is a 3D block operation — the iso render honours it even on a base-flat tile.** A placed tile
  extrudes into a real iso BLOCK when it has a base **height ≥ 1** OR the user sets **Z-Width** (directional
  depth > 1). Z-Width declares "this tile is a block extruded N cells along a diagonal", so the iso renderer
  routes it through the block path (`drawIsoTileForShape` → `drawIsoTileBlock`) and extrudes it — a Z-Width tile
  stands at least one block tall. There is **no 2D logic on the isometric side**: the old flat-billboard path
  silently dropped `depth`/`depthDir` + `display`, so a painted wall set to Z-Width 3 still drew a flat 2D face
  — that path is now bypassed once any 3D intent (height or Z-Width) is present, and **Display (all-faces /
  single) then applies to the extruded block**. A genuinely-flat tile (base height 0, no Z-Width, e.g. a
  flower or a decal) stays a billboard.
- **Coarse whole-object BUILDING tiles paint as all-faces 3D blocks by DEFAULT — no Z-Width needed.** A tile's
  default flatness is its DB `height`. The whole-object building emoji tiles (`wall`, `house`, `castle`, `bank`,
  `tower`, `tent`, `stadium`, `torii-gate`, … — every coarse building) carry **height ≥ 1**, so painting one
  seeds `GridAsset.height ≥ 1` and it renders as a full iso CUBE the moment it lands, painted on **all faces**
  (Display defaults to `all-faces`; nothing is ever forced to `single`). This corrects a **DB DRIFT**: those
  heights had fallen to `0`, so a painted wall came in as a flat billboard and only became a block once the user
  hand-raised Z-Width. Genuinely-flat tiles stay flat by the same rule: terrain (`grass`/`water`/`path`/`road`/
  `sand` = 0) and thin **facade parts** (`door`/`window`/`glass-window`/`wooden-door`/`roof` = 0) are NOT blocks
  — a floor is not a cube. Making a coarse tile a block-by-default is a **backend `height` reseed**
  (`emoji.json` → `TileSource.seed_sample` reconciles the height column, poses preserved), never a frontend
  override.
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
