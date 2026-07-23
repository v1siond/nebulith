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
- **One card component, ONE control set.** `PropertiesPanel` is the single card and it renders the SAME
  controls in the same order for a cell and for a unit — **Collision (Blocked/Walkable) · Clear tiles · the
  tile chip + Colour · Add tile / Replace tile · Edit settings… · Animate… · Remove tile · Triggers… · Save
  map**. A UNIT passes `unitSection`, which only **ADDS** its extras under the tile summary; it hides nothing.
  There is **no unit menu** any more (Alexander: *"we should just have one tile UI … should be the same FOR
  ALL TILES, including units, all tiles behave the same"*). The unit's sprite IS its tile ("everything is a
  tile"): the tile chip shows its baked art, colour / Replace tile / "Edit settings…" all come from the shared
  tile summary.
- **The unit's small header card is GONE.** The `▸ PLAYER (PLAYER) @ 32,10` `SelectionHeader` pill above the
  unit section was removed (*"we must remove the player small card"*); the unit's name rides the card title
  and its own Name row. The bespoke **Delete / Deselect** pair is gone too — deleting a unit is the standard
  **Remove tile** (*"we're replacing the unit menu with the tile card, so we'd have remove tile, add tile and
  clear tiles"*); Esc still clears the selection.
- **ONE collision control.** The card's `Collision [Blocked] [Walkable]` toggle serves a unit as well: for a
  unit it writes `entity.blocksMovement`. The old standalone **"Blocks movement" checkbox is deleted** — one
  collision control for everything.
- **Clear tiles works on a unit too**, targeting the cell the unit stands on, through the SAME
  `clearTilesAt(cells)` primitive a cell selection uses (undoable).
- **The FIGURE variant row (neutral/male/female/old/child/alien/robot) is REMOVED.** A unit is a tile, so its
  art is swapped with the card's regular **Replace tile** button, whose Tile Library lists the character tiles
  (the `units` category) — *"units are just tiles, so if we want to replace a tile we should use the regular
  replace tile button and see a list of characters to pick"*. `Entity.variant` survives as DATA (the
  randomizer + the spawner still set it); only its authoring row is gone.
- **`⛊ Stats…` is a BUTTON opening a draggable/resizable modal** (`UnitStatsBody` in a `FloatingPanel`,
  geometry id **`stats`**): HP / DEF / STR / INT / DODGE%, **Hittable**, the enemy's kill-quest tag and its
  respawn timer — *"stats would be a button that shows a draggable, movable, resizable modal where we control
  all those extra unit settings"*. **Name and Size (1×/2×/3×) stay as ROWS on the card**, not in the modal.
- **Inventory & abilities, Quests and Attacks are buttons on the SAME card** (`🎒 Inventory & abilities…`
  for the player, `❒ Quests…` for an NPC, `⚔ Attacks / abilities…` for an enemy), each opening its existing
  modal with its existing data — *"inventory and abilities must be moved to the tile menu and show the data
  as it does when clicking on current unit menu"*.
- **The unit's shared settings.** A unit maps its own fields into the same `TileControlModel`: colour →
  `entity.color`, the scale axes → the unit's uniform `size`, x/y/rotate/flip → `entity.pose` (same `TilePose`
  a tile carries; round-trips through the entity codec). Writers fan out via `patchSelectedEntity` — one
  source of truth. "Edit settings…" opens the SAME floating `SettingsPanelBody` (tile-only body: colour ·
  width/height/zoom · x/y/z · rotate · flip) a tile opens — asset-only rows (Z Width, Z-Index, Display, Shape,
  Light, z-slide) stay hidden for a unit exactly as they do for a floor tile.
- **Unit-only extras** (`UnitSettingsSection`, folded INTO the card): the two identity ROWS a unit keeps
  inline — **Name** and the **Size** preset (1×/2×/3×; a boss scales its stats with its figure) — plus the
  entry-point buttons a tile never has: **stats** (every unit), **inventory** (player), **quests** (NPC),
  **attacks** (enemy), each opening its own modal.
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
- **A MANUALLY-added enemy is STATIC — auto-patrol is a SCATTER-only default.** An enemy with no authored
  `movement` inherits the runtime `DEFAULT_ENEMY_PATROL` (`advanceEnemyMovement`) and wanders. That auto-liveliness
  should happen only when SCATTERING, not when you place a single enemy by hand (Alexander: *"when I add enemies,
  they're added with animation by default, which should only happen when 'scattering'"* — an enemy carries no
  frame-animation, so the visible "animation" IS the patrol movement). So the top-nav **◈ Unit → Enemy** builder
  pins a **stationary single-waypoint pattern** (`{ mode:'sequential', waypoints:[{col,row}] }` → a no-op in the
  stepper) — the placed enemy stays put until the user authors movement in the Inspector. **Scatter** (⤳ Scatter /
  `spawner.buildEnemy`) still attaches a real `makePatrol`, and trigger-spawned waves still use the default patrol,
  so both keep moving.
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
**tileAnimation** (per-tile settings tweens), **triggers**, **attacks** (enemy), **stats** (unit),
**connectors** and **tileLibrary**.
- **Backend owns the geometry.** nebulith exposes a small key→value editor-settings store — `GET
  /api/editor_settings` returns `{editorSettings: {<modalId>: {x,y,w,h}}}`, `PUT /api/editor_settings/:key`
  upserts one modal's geometry. `key` is the modal id (`settings`/`animation`/`triggers`/`attacks`/`stats`/
  `tileAnimation`/`connectors`/`tileLibrary`); `value` is the panel's `{x,y,w,h}`. The store takes ANY key, so
  a new panel needs no backend change. A single global record per key (no per-user auth).
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
- **The Paint palette lists REGULAR tiles only — no units.** Terrain / buildings / nature are paintable; the
  **`units` category (player / enemies / NPCs) is dropped from the Paint palette** (`TilePalette` empties the
  `units` group). Units are placed through the top-nav **◈ Unit** flow, NOT armed as a paint brush (Alexander:
  *"we have 'enemy' tiles, outside of the 'units' option from the top nav … the paint should work for regular
  tiles"*). The **Tile Library** (pin a tile as an element override) still browses all four categories — only
  the paint brush omits units. **Animals (bear, wolf, fox, cow, …) are `units`, NOT `nature`** (the user:
  *"we have a bunch of enemy or unit tiles on the nature category, like bears, wolf — animals aren't nature"*):
  they are enemies placed through the Unit flow (`entityKindForUnitSlug` → `enemy`), so genuine nature (trees,
  rocks, plants, flowers, mushrooms) is all that remains paintable under `nature`.
- **A palette tile FULLY describes its DB tile.** `TileDef` carries the tile's DB `category`, `title`, art, and
  **settings** (the generic `fadeNear`/`cutawayRoof`/`display` blob), plus the tile's own block `height`. The
  paint brush READS that height (see the next bullet) — height is the tile's DATA, read the same way everywhere.
- **A painted tile IS a normal, editable tile — and EVERY tile is inserted through the SAME uniform path, reading
  its OWN height.** The brush (`stackAssetTile`) stamps a real `GridAsset` pinned to the exact tile
  (`tileOverride`) and reads **the tile's own DB `height`** through ONE line — `h = tile.height ?? 0`. There is
  **NO branch by tile type, category, label or art style** anywhere in the paint/placement path; the mechanism is
  identical for every tile, only the height DATA differs:
  - a **GROUND/FLAT** tile (a **flower**, a fallen leaf, floor decor, a facade piece — DB height `0`) inserts
    **flat**: in iso it shows on the **floor face** only.
  - a **STANDING** tile (a tree, a rock, a building, a prop, a lamp, a mushroom — DB height `≥ 1`) inserts as an
    extruded **block**.
  The user's rule, repeated in caps: *"all tiles behave and are inserted the same in the map, regardless of type
  or art style"* — the **mechanism** is uniform; the height is per-tile DATA. **Collision is INDEPENDENT of
  height** — it is a per-cell **SETTING** with **ONE uniform default for every tile: walkable** (non-blocking),
  set directly via the Inspector's **Blocked/Walkable** toggle (`grid.setCollision`), which is the **source of
  truth** (MAP-MODEL §4). Height>0 tiles are *commonly* blocked, but that is a habit, **NOT a rule** — a
  4-block-tall projection can be fully walkable, and a flat tile can block. (A generated/composition cell may
  carry its own authored `walkable` DATA as its default.) The tile's own authored `settings` ride along via the
  SAME `tileRenderBehavior` seam `stampComposition` uses, and the asset is selectable + changeable
  (colour/shape/size/pose/display/height/**collision** via the Inspector).

  **Roadmap — conditional collision (lands with the collisions + UI work).** The flat Blocked/Walkable setting is
  the **base**; on top of it sits a **triggers-like** system of higher-priority conditional overrides —
  *"if the element has a conditional-collision rule → use that, else fall back to the base setting."* Wanted
  drivers: a **unit** defaults collision **off** (non-blocking) but flips **on when the player targets it** (so
  units are interactable without being walls) — settable on a **multi-selected** set of units; a **ghost power**
  that removes collision even for the **player** (walk through walls in some sections). The base setting remains
  the source of truth whenever no conditional rule applies.
- **Z-Width is a 3D block operation.** A STANDING painted tile (height ≥ 1) lands as an iso BLOCK, so **Display
  (all-faces / single) applies to it by default**; **Z-Width** extrudes it FURTHER along a diagonal (directional
  depth > 1) through the block path (`drawIsoTileForShape` → `drawIsoTileBlock`). Even a height-0 tile becomes a
  block the moment Z-Width is set (the old flat-billboard path that silently dropped `depth`/`depthDir` +
  `display` is gone) — Z-Width only changes how far a block extrudes.
- **Height is per-tile DATA (no per-category code branch).** A tile's flatness is decided by **its own** DB
  `height` (ground/flat = `0`, standing = `≥ 1`), read uniformly — NOT by a per-category rule. `TileSource.seed`/
  `seed_sample` runs **`reconcile_tile_heights`**, which writes each buildings+nature tile's OWN `emoji.json`
  height onto the DB height column (`t["height"] || 0`), pose-safe — height column only, so editor-tuned poses
  survive; `emoji.json` → reseed, never a frontend override. Terrain is just the height-0 case painted onto the
  **FLOOR** via `placeGroundTile` (the floor-vs-stack boundary `placementFor` is built on) — the same "height 0 =
  floor face" rule as any other flat tile. If a flower should stand or a prop should lie flat, that is a per-tile
  **height** edit on THAT tile — never a category rule.
- **Apply a tile to ONE or MANY cells.** With a tile armed, a plain click paints the clicked cell; **shift-drag
  selects a rectangle of cells, then one click fills them all** (`applyArmedBrush` fans out over the selection,
  else the single clicked cell). ⌥Alt-click removes the top tile.
- **Apply settings to MANY selected tiles.** With multiple cells selected, editing a setting in the Inspector
  fans out to the i-th stacked tile of EVERY selected cell (`applyToSelectedCells` → the `setAsset*` writers) —
  one edit changes all selected tiles.

## 12. The Tile-composition tool + placement preview (stamp ANY composition, see it first)
The left tool-rail's **Tile composition** tool (formerly "Building") stamps a whole **backend composition** —
its per-cell tiles — with one click, the SAME path the generator uses (`stampComposition`), NOT a special
building unit. It was renamed + generalised because the old card hardcoded a building-only list; a composition
is any multi-cell template the DB serves, and the tool now places **every one the randomizer uses**.

- **The palette lists EVERY backend composition, grouped — never a hardcoded subset.** The card
  ("Tile compositions") is built by `buildCompositionPalette(ASCII_TILESET)` from the loaded tileset's
  `compositions` map (served by `/api/tilesets`), so it lists the full set the world generator stamps:
  **Buildings** (house/store/hospital/temple/manor/cathedral/castle/office/…), **Nature** (tree + its
  tall/round/stub variants, bushes), and **Props** (fountain, well, lamp post). Grouping is data-driven:
  a composition with a ground-level **`door` cell** (`compositionFacesRoad`) is a *Building*; a `tree*`/`bush*`
  kind is *Nature*; everything else is a *Prop*. Each button shows the composition's **footprint size (w×h)** so
  you know how many cells it takes before placing. A new backend composition appears here automatically — no
  frontend list to edit.
- **Placement is composition-generic (`planComposition`).** The clicked cell is the footprint **CENTRE**.
  A *Building* (has a door) rotates to face the **nearest road** (`nearestRoadFacing` → `facingRotation`, the
  footprint axes swapping for east/west); a *Prop/Nature* composition drops **unrotated**. A stamp is refused
  when a footprint cell is out of bounds, blocked (tree/water/another building), or — for a building only — on a
  road/path. This is the SAME `planComposition` the ghost preview draws, so *what you see is exactly what lands*.
- **A placement GHOST previews the footprint on hover, BEFORE the click.** While a composition is armed and the
  cursor is over the map, a translucent **shadow** is drawn at the hovered cell: each occupied cell's footprint,
  plus (in iso) a faded raised box for the massing/height, tinted **green when it fits / red when it's blocked**.
  It follows the cursor and clears on disarm / mode-switch / pointer-leave. The footprint cells come from the
  composition's OWN cell data (`compositionFootprintCells`, deduped across stack levels, rotation-aware), so the
  shadow is byte-accurate to the stamp. It's computed only on mouse-move (not every frame) and only when armed
  → cheap. Drawn in the iso view (`drawCompositionGhostIso`) and the top-down view (`drawCompositionGhostFlat`);
  the 2D front-elevation view omits it (a col/row footprint doesn't map onto a side elevation).

## 13. Right-sidebar inspector tools (clear / connectors / add-replace tile) — SHIPPED 2026-07
Four right-sidebar reworks so the Inspector is where you SEE and change what's on a cell, without hunting the
left rail. All reuse the existing seams — the `FloatingPanel` (draggable/resizable, geometry persisted in
editor-settings) and the left Paint tool's placement path — with NO fork and NO tile-type branch.

- **See the selected tile + Clear tiles (Image #67).** The cell card shows a **thumbnail of the selected tile's
  baked art** (`TilePreview`, a sibling of the divider text so it never pollutes the header) and a **prominent
  "🧹 Clear tiles"** action in the CELL section. Clear tiles **EMPTIES the whole cell** so it goes BARE: it pops
  EVERY stacked tile via the SAME erase primitive ⌥Alt-click uses (`removeTopAsset`, popping until bare + re-
  deriving collision) **AND clears the cell's GROUND/floor tile** — a **road / terrain / plaza is a floor tile
  too**, so `clearGroundTile` resets it to the bare default (`grass`, no colour override, no dims) and collision
  goes walkable. This is **uniform — NO branch on the tile's type/category/height/style**; a road, water and
  plaza all clear the exact same way. Captured by undo/redo (`checkpointHistory` snapshots the ground before the
  clear, so Ctrl+Z restores BOTH the stacked tiles AND the cleared road). It shows even when the selected tile
  is the floor, and — since the unified card (§8) — for a **UNIT** too, where it targets the cell the unit
  stands on through the SAME `clearTilesAt(cells)` primitive.
- **Connectors — a right-sidebar button + a draggable modal.** The Connector tool is **off the left tool-rail**
  (`RAIL_MODES` drops it); its entry is a **"↗ Connectors" button in the right sidebar** that opens a draggable
  `FloatingPanel` (`ConnectorsPanelBody`, geometry id `connectors`) hosting the WHOLE flow — the Edit/Exit
  authoring toggle, the saved-connector list, and (while editing) the target / when / spawn-cell form + Save /
  Delete. The connector DATA + behaviour are unchanged; only the entry + host moved. Opening the panel arms
  click-to-add authoring (and drops the other exclusive tools); closing it disarms + drops the edited connector.
  **Opening with an active cell SELECTION lands STRAIGHT in the editing VIEW** (the target/when/spawn form) for
  that selection — **one click, no second click** (user: *"if I have multi select and click connectors I expect
  to see the editing view, but instead I have to click again"*). `openConnectorPanel` calls
  `connectorEditFromSelection` (pure): a saved connector overlapping the selection loads (its whole cell set),
  otherwise the selection itself becomes a fresh connector; with NO selection the panel just stays armed, ready
  to draw. Same routing as a canvas connector click — no fork.
- **Tile Library moves BELOW Colour + opens a draggable/resizable modal.** In the cell card the tile-add button
  sits **below the Colour swatch** (`ArtSection` rendered after colour) and opens the Tile Library as a
  draggable/resizable `FloatingPanel` (geometry id `tileLibrary`), NOT the old centred `Modal`.
- **"Add tile" / "Replace tile" by cell status + paint the selection (same path as the left Paint tool).** The
  tile-add button NAMES itself by CELL STATE (no tile-type branch): **"Add tile"** on a bare cell (floor only),
  **"Replace tile"** once the cell holds a stacked tile (`levelCount > 1`). Picking a tile in the Library:
  - for a **CELL selection** → PAINTS it onto the whole selection through the SAME per-cell placement the left
    Paint tool runs (`paintTileOnSelection` → `placeArmedTileAt` → `placementFor` + `placeGroundTile` /
    `stackAssetTile`), so a terrain tile replaces the floor and a standing tile stacks — identical to the left
    brush. The selection is kept so you can keep painting and the label flips Add→Replace. `TileLibraryBody`
    runs in `paint` mode (prose "paint it onto the selected cells", no "Follow style").
  - for a **UNIT** → the button always reads **"Replace tile"** (a unit always carries art) and picking a tile
    PINS it as the unit's figure override (`setSelectionOverride`). The Library lists all four categories, so
    the `units` characters are the list you pick from — this is now the ONLY way to change a unit's figure
    (the Figure variant row was deleted, §8).
  The left Paint tool and this right-sidebar paint COEXIST and land the exact same tiles — one placement path.

## Randomize — macro (per-layer) + micro (selection) — SHIPPED 2026-07

The randomizer is scoped, not all-or-nothing (user: "randomize every stage… only trees… only buildings…
just the MAP without structures nor nature… single/set of units/tiles/compositions… randomize the
animation for a unit"). It has two slices, both built on the generator's seedable **layer passes**
(see `GENERATION-SPEC.md` §5).

### Macro — the `⚡ Generate ▾` menu (`GenerateControls`)
Below the whole-map variant buttons, a **"Randomize just one layer — keeps the rest of the map"** row:
**Layout only · Buildings · Trees / Nature · Decor · Units**. Every full generate captures a per-layer
**seed set** (`lastGenRef`); clicking a layer re-rolls ONLY that layer's seed and regenerates — the
untouched layers, fed the same seeds, reproduce, so visually only the picked layer moves:
- **Layout only** — new streets + plots, structures and nature stripped (`stripToLayout`): the bare map.
- **Trees / Nature only** — new trees/flowers, buildings + roads untouched.
- **Buildings** — repaint the buildings in place (fresh materials + roof/wall tones via an
  `applyStageToGrid` salt); geometry is a plot decision, so it stays put. *Visible in ISO/2D, not in the
  flat top view (top shows the roof cap).*
- **Units** — re-scatter the enemies/townsfolk; the map is untouched.
- **Decor** — re-roll the plaza + lamps.

Non-settlement archetypes (forest/cave/temple/boss) aren't decomposed into layers, so any scope there
re-rolls the whole archetype via its layout rng. Debug seam: `window.__randomizeLayer(layer)`.

### Micro — "🎲 Randomize selected" (Inspector button + `R` hotkey)
With a selection, re-roll ONLY the selection's random attributes (`randomizeSelected`); nothing else on
the map moves (proven: 0 pixels change outside the selection). Works for one or many.
- **Tile(s)** → a new colour from the tile's OWN role palette (rock shades / mushroom tones / the zone's
  flowers, else a tonal variant of its own tone) + a chance to flip the render shape (cube ↔ ball). Never
  an arbitrary value — only attributes the backend data legitimises.
- **Unit** → a different figure variant (npcs) + a fresh wander animation (`randomMovementAnimation`); the
  player is left alone.

The button sits at the top of the cell inspector ("Randomize selected (N)") and the unit inspector
("Randomize unit"). Debug seam: `window.__randomizeSelected()`.

## Build order (after the current quest/inventory wiring)
1. Composite asset scaling + persistence/render (§6) — concrete bug.
2. UI reorg (§5) — top nav + expandable assets + right-side connectors/entities/selection.
3. Selection-driven config panel (§1) — the interaction backbone.
4. Entity types + movement patterns (§2,§3).
5. Asset/structure actions + animations (§4) — cannon/lamp.
6. Default art-style in UI + volcanoes/mountains decorations (§7).
