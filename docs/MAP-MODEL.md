# Nebulith — Map Model, Views & the Cell/Block/Tile System

> **The source of truth for how a Nebulith map is built and viewed.**
> Read this BEFORE any work that touches maps, tiles, cells/blocks, generators, or the three views.
> New feature? Check this (+ the feature doc) and make sure the feature matches it.
> Fixing a bug? Confirm the fix matches this model.
> Touching tiles or cells/blocks? Understand this first, then update code.
>
> Standing workflow for ALL work: **check docs → understand context / high-level → do the work.**
>
> This is the canonical copy. `game-website/docs/MAP-MODEL.md` mirrors it and maps it to the code.

---

## 1. One map, three projections

There is **ONE map**: a grid of cells/blocks, each holding a **tile** (the art). Nothing is special-cased —
a house, a road, a mountain are all just **tiles in cells/blocks, stacked like legos / minecraft**. The three
views are **three projections of that one map**, rendered through the **same tile builder**. Because they are
the same map, **the views must match.**

```mermaid
flowchart TD
  MAP["ONE MAP — a grid of cells/blocks, each holds a TILE"]
  MAP -->|look from above| TOP["TOP view — Width x Depth (footprint), no height"]
  MAP -->|look from the front| TWOD["2D view — Width x Height (front elevation), depth collapsed"]
  MAP -->|full 3D| ISO["ISO view — Width x Height x Depth"]
```

## 2. What each view shows / hides

| View | You see | Axes | Hidden |
|------|---------|------|--------|
| **TOP** | the map from directly above | **Width × Depth** (footprint) | height / elevation |
| **2D**  | the map from the front | **Width × Height** (front elevation) | depth (collapsed) |
| **ISO** | the map in 3D | **Width × Height × Depth** | nothing |

Example — the SAME house in all three (the reference sketch):
- **TOP**: a roof **rectangle** (the footprint) + a door notch, on green ground.
- **2D**: gray wall rows + a red roof **gable / triangle** + windows + door — the front face; green ground, sky above.
- **ISO**: the full 3D house — walls + red gable roof + door/windows.

> **The ISO view is a ROTATABLE camera.** The three projections above are the *model*; the ISO view is drawn
> through a camera that can turn around the map — the **4 corners** (quarter-turns CW, an `Orientation`) plus a
> **continuous** spin between them the drag controller animates. The map's tile DATA never changes when you
> turn — the renderer rotates the `(col,row)` coordinate BEFORE the fixed iso projection (a turntable spin),
> and a tile's world-facing (a door's direction) is invariant; only the screen-side you view it from changes.
> Movement and drag stay **screen-fixed** (the map turns, the controls don't). The projection math, the camera
> focus/clamp/pan, the rotation, the depth sort, and the screen-fixed-input rule are all documented in
> [`RENDER-AND-CAMERA.md`](RENDER-AND-CAMERA.md).

## 3. The matching rules — the views are consistent by construction

The same thing appears in all three, so its dimensions are shared:

- **Width** — 2D = TOP = ISO front width.
- **Height** — 2D = ISO. (TOP hides it.)
- **Depth** — TOP = ISO. (2D hides it.)
- **Tiles match** — roof red, walls gray, door/windows in the same places, in every view; ground green, road black, everywhere.
- Change the map (add a floor, move the door) → **all three views change consistently**, because they read the same cells/blocks/tiles.

```mermaid
flowchart LR
  W[Width] --- TOPw[TOP width]
  W --- TWODw[2D width]
  W --- ISOw[ISO front width]
  H[Height] --- TWODh[2D height]
  H --- ISOh[ISO height]
  D[Depth] --- TOPd[TOP depth]
  D --- ISOd[ISO depth]
```

## 4. Blocks, cells, tiles — the containers and their contents

- **ISO grid = BLOCKS** — 3D containers `(col, row, level)`. Stack as many as you want for height/depth.
- **2D grid = CELLS** — `(col, row)`; **stack cells** to simulate elevation (height). Depth is collapsed.
- **TOP grid = cells** from above — elevation is not shown.
- A **cell/block has collision or not** — it blocks movement or it doesn't. **Collision is a per-cell SETTING,
  NOT derived from anything.** It is **NOT** computed from height (or type, category, label, or art style) —
  a **4-block-tall projection can be fully walkable**, a **4-block cave entrance** walkable, a **2-block open
  door** walkable. The user drives it directly via the inspector's **Blocked/Walkable** toggle
  (`setCellCollision` → `grid.setCollision`) — that setting is the **source of truth** for a cell's collision.
  When a tile is **painted**, it lands with **ONE uniform default for every tile**: **walkable** (non-blocking).
  Same default for every tile, height, art style and category — there is **no per-type blocking list and no
  height→collision rule** anywhere in the paint/insert path. **Height and collision are fully independent:** any
  height can carry any collision. (A generated/composition cell may carry its **own** authored `walkable` DATA —
  that is per-cell DATA on the block, not a code branch, so the generator path is unaffected.)
- A cell/block CAN carry a **draw priority** (`z_index`, CSS-style) — a higher value draws LATER (on top / in
  front), overriding the positional depth sort in every view. It's DATA on the cell (the editor's Z-Index control
  or a seeded default), not a render special-case. **Currently every cell defaults to 0** and sorts positionally —
  the capability is reserved for the later composition-optimization pass (e.g. giving a container a higher
  `z_index` than its contents so its front edge occludes them). See `ANIMATION-SYSTEM.md` → "z-index draw priority
  (a capability for composition optimization)".
- A **TILE** is the art inside a cell/block — an ascii glyph, an emoji, or an image, coming from the **DB
  tileset**. Ascii and emoji are just **two tilesets** of the same tile (same label, different art). The
  front end renders; the tile data comes from the DB — the front end hardcodes nothing.
- **An art style is made OF tiles, but not everything is BUILT WITH a tile-image.** *"Every tile is a baked
  image"* is a rule about the **ART** — when a tile carries art it is a baked image, never a raw glyph that
  renders `??` — **NOT** a rule that every cell must hold an image. A **ground can be a plain COLOURED block**:
  grass / roads / water are authored as a per-cell `color` on the floor block with **no image resource**
  (GENERATION-SPEC §5.5, *"reduce tiles — grass + water are colour"*), and the iso render draws a tinted slab
  (`!image && FLOOR_TYPE`). Tiles (image art) are spent only where art is genuinely needed — ornaments,
  structures, highlights. So a colour-only ground legitimately resolves to a colour, not an image.
- **Height is per-tile DATA, read UNIFORMLY.** Every tile carries its **own** block height in the DB, and every
  consumer (the editor brush `stackAssetTile`, the generator, the three renderers) reads it through the **same**
  path — there is **NO branch by tile type, category, label, or art style** anywhere in the insert/height/
  collision path. The MECHANISM is identical for every tile (*"all tiles behave and are inserted the same in the
  map, regardless of type or art style"*); only the **DATA** each tile carries differs:
  - a **GROUND/FLAT** tile — terrain, a **flower**, a fallen leaf, floor decor, a facade piece — has height
    **0/min**: in iso it shows on the **floor face** of the block only (no extrusion).
  - a **STANDING** tile — a tree, a rock, a mushroom, a cactus, a crate, a lamp, a building, a prop — has height
    **≥ 1**: it extrudes into a 3D **block**.
  Height affects only the **extrusion**; it does **NOT** affect collision (see the collision setting above — a
  tall block is walkable by default just like a flat tile). This is DATA per tile, **not** a category code branch
  — a data drift on one tile can never reopen a per-type split, because there is no per-type code. A tile's
  height can be **overridden per cell/block** in the right sidebar, and collision is set independently there via
  the Blocked/Walkable toggle; nothing else — its type/category/style — changes how it inserts. (Terrain is just
  the height-0 case painted onto the **FLOOR** via `placeGroundTile` rather than stacked, so it shows on the
  floor face — the same "height 0 = floor face" rule as any other flat tile.)
- A cell/block CAN carry a **`shape`** render setting (`square` default | `circle`) — DATA on the cell
  (`composition_cells.settings.shape` or a per-instance editor setting), never a render special-case.
  **`shape: circle` takes the SAME cuboid and BENDS ITS CORNERS ROUND**, NOT a repainted sphere (Alexander:
  *"ALL I WANT WITH THE SHAPE IS TO MANIPULATE THE SIDES OF THE CUBOID … bend the corners OF THE CUBOID to form
  a circle"*): the renderer draws the block's **normal cube — the tile painted on all three shaded faces, its
  background colour fill + art + per-face shading all kept — then CLIPS it to an ELLIPSE** so the silhouette
  rounds. The clip is the block's **INSCRIBED ellipse** (`roundedBlockEllipse`): `rx = footprint half-width`,
  `ry = √((stack/2)² + stack·tileH)` centred at the cuboid's mid-height — **tangent to the four slanted faces**,
  so **EVERY corner is bent away** (the top apex, the mid-side vertices, and the bottom) and there is **no
  straight-edge/arc kink**. The earlier `ry = stack/2 + tileH` passed through the apex + bottom and cut across
  the faces, leaving those three corners angular (Alexander circled the top point, a mid-right side corner, and
  the bottom) — the inscribe fixes all three. It stays **PROPORTIONAL** — a tall block → a tall oval (an egg
  standing up), a unit cube → a rounder blob — and is **NOT a sphere**: no single flat surface, no radial
  relight, the three faces + their seams still show; only the OUTLINE rounds. `square` is the plain cube. All
  three views route their `circle`/`square` through ONE shared shape dispatch (iso `ISO_SHAPE_DRAWERS`, 2D/top
  `drawFlatTileForShape`, whose face is a rectangle so its own inscribed-ellipse clip already rounds all four
  corners) — no per-view `if (shape === 'circle')` — so a new shape adds one map entry, never a branch
  (SOLID/OCP).
- A cell/block CAN carry an **`act_as_tile`** stacking SETTING (`settings.actAsTile`, default **false**). The
  **lego rule is unchanged**: a cell is EMPTY until a tile is put in it, and every FURTHER tile put in the same
  cell **STACKS ON TOP** of what is there (each tile occupies `its level + its own height`, `stackTop`) — floors
  included, so a composition dropped on floor tiles already stacks. **The law** (Alexander): *"there shouldn't be
  anything as floorStackLift whatsoever — FLOOR ARE TILES, ALL TILES STACK ON TOP LIKE LEGOS BY DEFAULT"* — so a
  floor lifts what stands on it through this ONE rule, needing no floor-special lift. (A `floorBlockLift` helper
  still exists for the composition/unit placement paths that don't yet route through `stackTop`; it is a
  deviation slated for removal once those paths read the shared stack, per this law.) `act_as_tile` makes a tile
  count as an occupant of **at least one block** for stacking, so the
  cell *"behaves as if a tile were already inside it"* and the next tile stacks ON TOP **even when the tile is
  FLAT** (height 0). Alexander: *"act_as_tile means the cell works by default as if a tile was inside of it
  already … adding a tile stacks it OVER the block; default is false; we change it in COMPOSITION when it makes
  sense — roads, whatever we must WALK OVER."* Decoupled from height (a height-≥1 tile already counts as ≥1, so
  the legos are byte-identical); authored per-tile in the DB `settings` or per composition cell, served verbatim
  by the backend, and editable in the inspector.

**Terminology — never interchange:**
- **CELL** = a 2D grid square `(col, row)`.
- **BLOCK** = a 3D unit `(col, row, level)`.
- **TILE** = the content/art placed into a cell/block.
- A **character / unit** is a depth-0 tile — the one map exception to "everything is a stacked tile."

## 5. Everything is tiles through ONE builder — no special renderer per view

A building, a tree, a mountain — all are **collections of tiles in cells/blocks**. There is **NO special
drawer** for a building, a roof, or anything (units/NPCs aside). Each view PROJECTS the same stamped tiles:
ISO stacks the blocks into a 3D shape, 2D collapses depth and stacks the cells into a front elevation, TOP
shows the footprint.

The roof is the clearest example: it is **roof tiles** projecting to a **triangle** (2D front), a **3D gable**
(ISO), and the **footprint rectangle** (TOP). To keep the block count low, a roof is authored as ONE
**depth-spanned** block PER COLUMN (roof-z-width): each column carries smart HEIGHT (`settings.scaleY` = its
gable-step height) AND smart Z-WIDTH (`settings.depth` = the footprint depth, along `settings.depthDir`), so a
whole ridge column is a single block spanning the depth instead of one tile per `(col,row)` — a gable falls to
`w+1` blocks. The three views still read the SAME data: ISO draws the depth block as one long box, 2D collapses
the depth onto the front face (the triangle), and TOP paints the tile across every covered footprint cell.
The **entrance apron** (the doorstep in front of a building's doors) uses the SAME z-width mechanism on the
facade axis — a 2-wide doorway is ONE `path` block with `settings.depth = 2` — and, being a **floor** tile, it
carries the floor's own minimal height, so the doorstep lies FLAT like the road it joins instead of standing up
as a kerb. Height comes from the tile, never from the stamp: **a composition cell is placed at its TILE's own
DB height** (§4), so a flat tile in a composition stays flat and a standing one stays a block.

**A generated stage SAVES what it stamped.** The live stamp and the save path (`stageToTemplate`) expand a
recorded composition ANCHOR — tree, building, decor — through the **same** per-cell mapping
(`compositionCellRender`), so every authored setting (`depth`/`depthDir` z-width, `scaleY` height, `scale`,
`pose`, `shape`, `light`, animations) and each tile's own height survive save → load. Cherry-picking fields on
save is what once reloaded a 2-wide entrance as one block and broke the roof spans.

**A composition cell resolves by its own LABEL, in every view.** A tree is two stacked cells — a `tree_trunk`
cell at level 0 and a `tree_canopy` cell above it — each carrying its OWN part label but the SAME composition
`type` ('tree'). Every renderer resolves a stacked cell (one that carries a `label` and `height ≥ 1`) by that
**label** — its own trunk/leaf/wall/roof tile — **before** the coarse whole-object KIND art is ever consulted
(`assetKind` collapses `tree_*` to the `tree` kind, whose emoji is the whole 🌲). So the trunk cell draws the
trunk tile and the canopy cell draws the leaf tile, each at its own stacked position, composing into ONE
coherent tree — identically in ISO (label cube per cell), 2D (label cell per level), and TOP (the top-of-stack
label per footprint cell). This label-first rule is what stops the 2D view from painting the whole-tree KIND
tile once per stacked cell — the "tree on tree" doubling — so **ANY** composition (tree, building, fountain,
lamp) translates consistently across the three views. It is DATA-driven (label + height), never a per-type
branch.

```mermaid
flowchart TD
  STAMP["a building is stamped as per-cell TILES (walls stack by level, roof = depth-spanned block per column)"]
  STAMP --> REG["the REGULAR tile builder — one path, no special drawer"]
  REG -->|project| TOPp["TOP: footprint rectangle"]
  REG -->|project| TWODp["2D: front elevation, depth collapsed"]
  REG -->|project| ISOp["ISO: 3D block stack with gable roof"]
```

### Per-tile SIZE modifier: `scaleZ` — THICKNESS, the 3D fill inside the cell

A tile's `scaleZ` is its **THICKNESS**: how much of its own block it fills along the **into-screen** axis.
`1` (the default) is a full cube; a **door is a thin panel in a wall** and ships at `0.3`
(`nebulith/lib/nebulith/catalog/tile_source.ex`, Alexander: *"they should be thin"*). Drawn at the default
thickness a door renders as a solid block and stops reading as a door at all.

**THICKNESS IS NOT FOOTPRINT.** They were once conflated, and the thickness control was deleted as
"redundant" — it is not:

| | `scaleZ` — **Thickness** | `depth` / `depthDir` — **Footprint** |
|---|---|---|
| Question | how much of ONE cell does the block fill? | how many CELLS does the tile span? |
| Unit | a fraction of a block (0 < t ≤ 1 typically) | whole blocks, always ≥ 1 |
| Range | any positive number | integers ≥ 1 (a tile occupies at least its own cell) |
| Editor control | **Thickness** — four directional sliders | **Footprint** — four directional sliders |
| Backend home | `tiles.settings.scaleZ` | `composition_cells.depth` + `depth_dir` |

**Where it comes from, in precedence order** — one resolver, `tileThickness()` in
`engine/tileset/tileset.ts`, is the single reader for all of it:

1. the placed instance's own `GridAsset.thickness` reaches (the editor's Thickness sliders; saved in `Template.assetsData`),
2. an explicit per-cell `composition_cells.settings.scaleZ` for a stamped composition,
3. the TILE's authored `tiles.settings.scaleZ` — the backend default,
4. nothing → a full block, unchanged.

A tile is therefore thin **wherever it lands**: generator-stamped (`game/runtime/composition.ts`) or
hand-painted (`game/editor/tileBrush.ts`). Both call the same reader — they are only allowed to *read* it,
never to invent one, and each keeping a private copy is exactly how the paint brush silently dropped it.

#### Thickness is four REACHES — the same shape as the Footprint

Thickness alone is not enough: it needs a direction, or the shrink happens along a **screen** axis and the
same door reads thin from one side of the house and solid from the other (Alexander, Image #3: *"it's only
applied viewing to MY front, not the front of the house"*).

A cell's two ground axes are the diamond's **diagonals**, not its screen extents — the top face runs
`t → t+u → t+u+v → t+v` with `u = (+tileW, +tileH)` (+col) and `v = (−tileW, +tileH)` (+row). So thickness
is expressed on those same four iso diagonals, as **four independent reaches** (`GridAsset.thickness`).

**Thickness and Footprint ask ONE question in two units** (Alexander: *"I pefer thickness UI to work like
z-width UI"*) — *how far does this tile reach toward ⟨direction⟩?*

| | Footprint (`depth` / `depthBack` / `depthPerp` / `depthPerpBack`) | Thickness (`thickness`) |
|---|---|---|
| Unit | whole CELLS | a fraction of ONE cell |
| Range | ≥ 1 — a tile always occupies its own cell | ≤ 1 — 1 reaches that face exactly |
| Control | four arrow + slider rows | the same four arrow + slider rows |

Along each axis the block spans from `1 − reach(back)` to `reach(forward)`, so a door with reach 1 toward
its wall and 0.3 the other way is a 0.3-thick panel **flush with that wall** — it sits *in* the wall rather
than floating mid-cell. The perpendicular axis is untouched, so a thin door is still a full-width door. Two
opposing reaches that would close the block keep a visible sliver rather than vanishing mid-drag. The pure
geometry is `reachGroundQuad()` in `engine/render/isoBlock.ts`; `thinGroundQuad()` is the hug-one-face
shorthand on top of it.

**Authoring.** The backend writes either form and `tileThicknessReach()` normalises both:
`{scaleZ: 0.3, thicknessDir: "left-down"}` (the shorthand a door uses — "0.3 thick, hugging this face") or
`{thickness: {"right-up": 0.3, …}}` (explicit per-direction reaches, for anything the shorthand cannot say).

**The controls read in SCREEN space, the data stays in WORLD space.** The arrow glyphs keep their position
in the 2×2 grid — ↖ is always the up-left corner, matching where the block grows on screen — and the world
axis under each is re-derived per camera facing (`dirsForFacing`). Alexander: *"the direction should match
and be aligned with the current cammera rotation, I rotated and the direction the propreties in the UI were
showing didn't match the view."* Storing world-space is what keeps a door thin toward its own wall as you
rotate; displaying screen-space is what makes the arrow you click the axis you see. Both the Thickness and
the Footprint rows do this.

Being a WORLD axis, it is rotated twice, exactly like `depthDir`:

| Rotation | Where | Why |
|---|---|---|
| the **building**'s | `composition.ts`, at stamp time | a house turned a quarter-turn has its doors thin toward **its** front |
| the **camera**'s | `iso.ts` `orientAssetForView` | turning the camera must not re-thin the door |

Doors are authored `left-down` (+row) because a building's front face is `dy == h - 1`
(`building_compositions.ex`) — the south-facing convention every composition is authored in.

**Without a direction** `scaleZ` keeps its historical screen-axis meaning, so nothing that renders today
changes until a tile is given one.

Rendered as the block's footprint in ISO (`render/iso.ts` → `isoBlockFaces(..., quad)`) and as the vertical
axis of the TOP/overhead view (`render/assetDimensions.ts`).

#### Footprint reads in CELLS, minimum 1

The Footprint sliders once showed the **extra** cells beyond the anchor, so `0` and `1` drew the identical
block and a fractional value did nothing at all — *"I have 0, but its behaving as if value was 1 … the UI is
wrong. The min is 1 cell"*. They now count **cells, including the tile's own**, with a floor of 1. The four
stored extents are unchanged; only the unit the user reads and types changed.

### Per-tile ROLE: `unitRole` — what a `units` tile places as

A `units` tile is the one family that can become something other than a block: a **character** the player
meets, or a **combat effect** that is just decoration. Which one is the tile's own DATA —
`tiles.settings.unitRole ∈ {person, enemy, fx}` — never a frontend classification of the slug.

| Role | `placementFor` | `entityKindForUnitTile` |
|---|---|---|
| `person` | `entity` | `npc` |
| `enemy` | `entity` | `enemy` |
| `fx` | `asset` (a pinned decoration) | `null` — not a character |

The hero stays the one distinguished entity: the `player` slug is checked first and its row's role is
`person` like any other figure ("only units are special, they move").

**Status: the READER is in (`game/editor/tilePlacement.ts` — `unitRole`, `entityKindForUnitTile`,
`placementFor`), the FIELD is NOT SEEDED yet.** The live API carries `unitRole` on 0 of 79 `units` rows, so
those readers still fall through to two bridge lists (`NON_ENTITY_UNIT` 13 FX + `PERSON_SLUGS` 23 figures) —
the §3.14b Tier-1 #2 violation itself. The served role always wins, so seeding the 79 rows in
`nebulith/lib/nebulith/catalog/tile_source.ex` deletes both lists with no other change. This is also the
grouping the Characters library needs to sub-divide its 79 creatures.

## 6. Elevation is stacked cells/blocks + collision — not special logic

A hill / mountain / cliff / staircase is just **cells/blocks stacked with collision**. The elevation system
already exists (a per-cell `height` grid; the ISO + TOP renders raise cells and draw cliff faces). The open
work is only **expanding the generators + tiles to place PLACES with elevation** (mountains, staircases,
cliffs, hills) — **not** new render logic. "Segmented code" per view is fine; the **logic is one system**.


### The collision flag means the WALK SURFACE

`grid.collision` is 2D — one flag per cell — while a building is 3D. The flag therefore has exactly one
meaning: **a unit walking the ground here is stopped**. The rule, shared by every writer:

> a cell is blocked ⟺ it holds a blocking tile at or below `unitStandLevel(grid, col, row)`

`unitStandLevel` is the level a unit stands at in that cell — **not 0**. Every cell carries a floor slab at
level 0, so a building's ground course sits at level 1. Blocking a cell for a tile at ANY level made an
upper storey seal the floor beneath it (the collision map traced the storeys instead of the walls); keying
it to `heightLevel === 0` instead would block nothing at all.

Three places implement it and must not drift: the composition stamp (`game/runtime/composition.ts`), the
template load (`lib/api.ts`), and the editor's own edits (`deriveCellCollision`).

**The overlay paints on that same surface.** `renderDebugOverlays` used to tint the raw ground plane, so on
every cell the red diamond sat a block BELOW the structure it described and spilled out from under buildings
onto the grass — "collissions don't match structures" (Alexander, Image #5). Measured across a generated
town: all 181 blocked cells were tinted 26 px low, a uniform one-block offset. It now lifts by
`grid.getHeight(col,row) * heightStep + isoStackLift(tileW, unitStandLevel(...))` — the SAME lift the render
puts a unit on, so the tint and the thing it describes cannot diverge.

## 7. The pipeline — generator → one grid → three renders

```mermaid
flowchart LR
  GEN["generators — stamp cells/blocks + tiles + collision"] --> GRID["ONE grid — ground / height / collision / assets"]
  GRID --> R1[renderTopView] --> TOP[TOP view]
  GRID --> R2[render2D] --> TWOD[2D view]
  GRID --> R3["render (iso)"] --> ISO[ISO view]
```

## 8. Tileset source of truth — the DB + one seed pipeline

Tiles are **DB data**, served by the nebulith backend (`:6328` by default, `PORT`-driven; `tilesets` table, one row per style key —
`ascii`, `emoji`). Each tile entry carries its **art** (`glyph`/`char` + optional `image` + `color`) plus
optional **sidebar metadata**: `category` (terrain/buildings/units/nature) marks a tile BROWSEABLE and groups
it; `title` is its display name. Entries with no `category` (wall pieces, tree corners, entity reskin tiles)
render on the map but never surface in the sidebar.

**A STYLE IS A SET OF BAKED IMAGES AND NOTHING ELSE.** Alexander: *"all arts have the exact same behavior and
engine and the only thing that changes is the tiles, that's all that changes, the tileset art … changing from
emoji to ascii shouldn't make a difference whatsoever, because we're just saying 'use this set of images
instead of this other one'."* So EVERY tile row in EVERY style carries a baked `image_url`, and the frontend
builds its Visual through ONE helper (`artStyle.tileVisual`) fed by ONE lookup (`styleTileArt`, a dispatch map
keyed by style id). **No renderer may branch on the style for anything but which tileset to read.** A `glyph`
is the LAST RESORT for a tile with genuinely no baked image — never a per-style art path, and never a pre-load
placeholder (the loader decodes every PNG before the render gate opens).

**The app reads ONLY the DB tilesets — the front end hardcodes no tile art AND no tile data.** `tilesetLoader`
fetches the rows on load and installs them (`EMOJI_TILESET` / `ASCII_TILESET`). BOTH the **map render** and the
**Tile Library sidebar** (`tilesForStyle` / `visualForTileId`) derive from those loaded tilesets — so the
sidebar always matches the map (no parallel hardcoded catalog that can drift).

**The holders start EMPTY and a loader gates the render — there is NO fallback.** Both `EMOJI_TILESET` and
`ASCII_TILESET` are empty until `/api/tilesets` installs the DB rows; there is no bundled default tileset. The
editor shows a **LOADING TILES loader** (and the RAF loop paints only a plain background) until the tiles are
ready, and an **error/retry** state if the load fails. **"Ready" means the baked PNG IMAGES are DECODED, not
just the JSON installed** — `loadTilesetsFromBackend` preloads + decodes every installed tile image
(`preloadTileImages`, into the same cache the render reads) *before* it resolves and the gate opens. This is
what killed the last flash (Image #70): opening on the JSON alone let the first frames paint the tile's GLYPH
fallback (the wall's brick emoji tiled across the cube faces — a repeated "S" / brown-crate building, an
un-drawn hero) for the ~1s the rasters were still decoding. The glyph is now ONLY the after-load neutral render
for a genuinely image-less / unknown label — never a pre-load placeholder — and the RAF hard-gate blocks even
the saved map from painting until ready. Nothing is ever drawn from frontend tile data — so a fresh load
(including an auto-loaded saved map) goes straight from loader → the correct DB style, with no wrong-style
flash at any point.

**Entity resolution is backend data too (a unit is just a tile).** How an entity resolves to a baked tile — an
enemy's `enemyType` → slug, a person's `variant` → slug, and the baked-slug set — used to be the last frontend
data file (`game/data/entityTiles.json`). It now lives in the backend (`Nebulith.Catalog.EntitySource`) and is
served by **`GET /api/entities`**; the frontend installs it into an EMPTY holder via `entityLoader` and the
render gate waits for it **alongside** the tilesets (no fallback). The frontend now holds **no** tile OR entity
data. See TILE-BACKEND-MIGRATION §11.

**Tile pipeline (Elixir backend → baked image → DB → app).** All tile DATA lives in the nebulith backend.
The game-website FRONTEND JSON (`tileKinds.json`/`emojiCatalog.json` + `gen-tileset-seeds.mjs`) was the
ONE-TIME frontend→backend migration import and is now DEAD — do not author tiles there.

```mermaid
flowchart LR
  SRC["Nebulith.Catalog.TileSource (Elixir) — label, glyph, emoji, colour, image_url"]
  SRC --> BAKE["priv/tilegen/tiles.json + bake.mjs (Noto/DejaVu → PNG)"]
  BAKE --> PNG["priv/static/tiles/&lt;style&gt;/&lt;label&gt;.png (Phoenix-served image)"]
  SRC --> SEED["seed (idempotent upsert)"] --> DB[("tiles / compositions DB")]
  DB --> API["GET /api/tilesets (:6328)"] --> APP["map render draws image_url + Tile Library"]
```

**To add or change a tile:** (1) author it in `Nebulith.Catalog.TileSource` (Elixir) with
`image_url: "/tiles/<style>/<label>.png"` — `glyph`/`emoji` are BAKE INPUTS only; (2) add a bake entry to
`priv/tilegen/tiles.json` `{label, mode, style, glyph|emoji}` and run `node priv/tilegen/bake.mjs`
(**incrementally: `node priv/tilegen/bake.mjs --only=<label>[,<label>]`** — adding ONE tile must not
re-rasterise the other ~400 through whatever fonts the baking machine happens to have)
(→ a baked PNG in `priv/static/tiles/`); (3) seed. NEVER `image_url: nil` + a raw glyph (**it silently costs the renderer its cube-sprite cache**, which is keyed on the tile having an image: an image-less tile re-draws its three faces live, with a `clip` each, every frame) (renders `??` on a
machine whose font lacks the emoji), and NEVER hand-edit tile art into a component or the renderer. Seeds are
FINE (Elixir → DB); only the frontend JSON is dead.

---

## Keeping this current

Update this doc (and its `game-website` mirror) whenever the model, the views, the tile system, or a feature
changes. Every session, every prompt: **check docs → understand → do the work.** Per-feature docs (with their
own mermaid flow) live alongside this and are written/updated as each feature is built or changed.
