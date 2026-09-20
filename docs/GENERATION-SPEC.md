# Nebulith — Building Architecture & Stage Generation Spec

Status: **design in progress** (base rules locked 2026-06-21; formulas + themed generation being developed).
This is the spec we build the stage generator + building composer toward. See
[`ARCHITECTURE.md`](ARCHITECTURE.md) for current engine reality and
[`TILE-VOCABULARY-CONTRACT.md`](TILE-VOCABULARY-CONTRACT.md) for the tile naming the generator must emit.

> Note: "blocks" are collision-only (logical), not elevation — see memory
> `project-nebulith-collision-model`. A building's visual size comes from its **art/footprint**,
> not from raised terrain. All sizes below are in **grid cells**.

---

## 1. Building dimensions — LOCKED base rules

A building is a **multi-cell structure**, not a single tile. Two measures:
- **Length** = horizontal footprint along the facade (cells). The **facade length NAMES the composition**
  (`hospital_6`, `store_5`, `house_4`) — so the load-time stamp must use the plot's **facade** length, never
  the footprint's grid col-span. For an **east/west-facing** plot the grid col-span is the *depth*, not the
  facade length; deriving the composition kind from it asks for a non-existent composition (`hospital_4`) and
  stamps 0 cells, leaving a **foundation with no building** (the Image #42 orphan). Stamp a generated building
  by its recorded authoritative `PlacedBuilding.kind`, not by re-deriving from its col-span.
- **Height** = vertical extent of the drawn structure (cells): floors' body + roof.

**House — minimums (the base unit):**
- **Height ≥ 4 cells**: ≥ 3 cells of body (per the "≥3 tall" rule) **+ 1 cell roof**.
- **Length ≥ 8 cells.**
- **Door ≥ 2×2 cells** (2 wide × 2 tall) — a real walk-in opening, not a 1-cell mark.
- **Smallest possible house = 4 × 8** (height × length): 3 body + 1 roof, 8 long, 2×2 door.

**Floors:** each additional floor adds **+3 cells** of body height. Roof is always **+1**.
→ `height = floors × 3 + 1` (1-floor house = 4; 2-floor = 7; 3-floor = 10).

**Door:** width ≥ 2, height ≥ 2; placed on the facade, default centered (offset allowed). Bigger
structures use bigger entrances (gates) — see the formula.

---

## 2. Structure sizing formula (PROPOSED — to refine together)

Derive every structure type from the base house (8 long × 4 tall, 2×2 door) via per-type
multipliers. Starting point (tune by eye once the composer renders them):

| Structure | Length (cells) | Height (cells) | Door / gate | Notes |
|-----------|----------------|----------------|-------------|-------|
| **House (base)** | 8 | 4 (1 floor) | 2×2 | the unit |
| Big house | 12 | 7 (2 floors) | 2×2 | wider + taller |
| Store / shop | 10 | 4 | 3×2 (wide front) | wide display front |
| **Cathedral** (`card`? confirm) | 14 | 12 | 3×4 | tall nave + spire |
| Temple | 16 | 8 | 4×3 | columned, raised platform feel via art |
| Castle | 24 | 12 + towers | 4×4 gate | keep + perimeter towers (towers = +6 height) |
| Bridge | length = span | 2–3 | n/a | long + low; spans water/gaps |

General form: `length = base.length × kL(type)`, `height = floors(type) × 3 + roofUnits(type)`,
`door = clamp(scaleWithLength)`. Constraint: every habitable structure obeys the §1 minimums.

**Open question:** "card" in the user's list — assume **cathedral**? Confirm.

---

## 3. Themed stage generation (PROPOSED — limited input → good stage)

Goal: "frozen castle", "lava castle", etc. — a small, controlled input set produces a coherent,
good-looking stage (NOT random noise). This is the "control most of what the AI/generator
receives" principle from [`../README.md`](../README.md).

### 3.1 MVP preset matrix — zone × variant (START HERE)

> **Status (observed 2026-09 — the code is newer than this section).** The zone × variant matrix is a
> **backend catalog** now, not a frontend table: `GET /api/generators` serves the map-type CATEGORIES and
> the GENERATORS in them, each with the seasons it runs in and every knob a generate takes
> (`nebulith/lib/nebulith/catalog/generator_source.ex` → `generator_categories` / `generators`; client +
> selectors in `game-website/src/lib/generatorCatalog.ts`; T-113).
>
> The shipped catalog, read off the live API 2026-09-12: seasons `spring · summer · autumn · winter ·
> desert`, and FOUR categories, `forest · settlement · cave · temple`. Town and city merged into one
> `settlement` category (they are two presets of one kind of place, his *"City and town options are the same,
> it'd put them in a single category"*), and `forest` carries three layouts (`woodland`, `jungle`, `meadow`);
> `meadow_river` is gone, a river is an OPTION now. The catalog is a TREE: 24 generator rows, each a kind with
> its variations underneath (`generators.parent_id`, merged by `generator_tree/1`).
>
> Each generator's `config` carries its own grid range (`cols`/`rows` min-max, `cellSize`, `isoScale`),
> `units` (`townsfolk` / `enemies` / `enemyTypes`), and, for a settlement, `nature`, `settlement` tuning and
> the `buildings` material + colour palette.
>
> The zone PALETTES are MIGRATED (this sentence used to say they were not). They come from `GET /api/zones`
> plus the season-independent tables in `game_rules`; `src/engine/zones.ts` is now a set of READERS over that
> catalog, and the 302 lines of authored values are gone. A season the backend does not serve has no palette,
> and a caller with no palette plants nothing.
>
> The frontend holds **no** list of seasons, map types or layouts: the four tables that used to
> (`editorConfig.ts` `STAGE_ZONES` / `STAGE_VARIANTS` / `STAGE_VARIANT_LABELS` / `VARIANT_LAYOUTS`) were
> deleted with T-113. Adding a map type is a seed row. `lava` and `beach` still exist as `ZoneId` values
> but no generator runs in them, so they are off the menu; `frozen`/`verdant` are gone. The lava/frozen
> matrix below is the earlier design and does NOT describe the current build — reconcile it (and §7 of
> `EDITOR-INTERACTION-SPEC.md`) with the catalog before building to it.
>
> **Still frontend, deliberately:** the five generator LAYERS (`GENERATOR_LAYERS`, `editorConfig.ts`) are
> engine PASSES (`stageGenerator.ts` `LAYER_IDS`), not generator records, and `/api/generators` serves no
> layer list.
>
> **Not yet migrated, measured 2026-09-12 rather than assumed.** The settlement tuning constants in
> `engine/villageLayout.ts` are fine: every one resolves `served ?? CONSTANT`, so they are documented defaults
> and the served value always wins. Three siblings are NOT fine, because they shadow served data outright and
> the served value can never take effect:
>
> - `NATURE_MULT` (`stageGenerator.ts:913`) against the served `settlement.natureMultiplier`, which the backend
>   carries on EIGHT rows (town 1.3, city 0.5, town_small 1.8, town_forest 2.4, town_swamp 2.0, and more).
> - the `naturePass` literals `scatterGroundCover(ctx, 0.12)` / `scatterFlowers(ctx, 0.06)`
>   (`stageGenerator.ts:1005-1006`) against the served `nature` block that is already in scope. Its sibling
>   `tallGrass` IS read from the served block, which is what proves the wiring exists and these two bypass it.
> - the save path's `isoScale: 1.4` (`stageGenerator.ts:4907`) against a served `2.5`.
>
> The wider audit of frontend-held data lives in the workspace board, section B2.

Replace today's ~30 messy presets (many dead cultural themes) with a small, manageable matrix:
- **Zone** = elemental theme → palette + prop set. MVP: **lava** and **frozen** ONLY.
- **Variant** = place archetype → layout. MVP: **village, forest, cave, temple, boss-stage**.

MVP set (2 zones × 5 variants = 10 stages — enough to build a game):

| Zone | Variants |
|------|----------|
| **Lava** | lava village · lava forest (with a few caves) · lava cave · lava temple · lava boss-stage |
| **Frozen** | ice village · ice forest · ice cave · ice temple · ice boss-stage |

The **cave** is authored once per zone and **randomized per run** (reuse the archetype, vary the
layout) so it gives several playthroughs from one definition. Only after these two zones make a
playable game do we expand to more zones (jungle, underwater, beach, desert…) and variants. A stage
is therefore identified by `(zone, variant)` — e.g. `lava/temple`, `frozen/cave`.

**Inputs (the limited set):**
- `theme` — frozen / lava / desert / verdant / gothic / … → drives **palette** (ground, water,
  wall, accent colors + tile chars) and prop set.
- `archetype` — town / castle / temple-grounds / dungeon / boss-room / village → drives **layout**.
- `size` — small / medium / large → scales footprint + structure count.
- `view` — isometric / 2D-top / 2D-horizontal.

**LAYOUT-FIRST (the core principle).** Always define the STRUCTURE before the elements: partition
the map into sections/rooms, wire them into a connected network (spanning-tree corridors + edge
gates), and only THEN populate each section with elements. Never scatter elements and hope paths
emerge. (Forest = distributed clearing rooms → nearest-neighbour corridors → trees fill the rest;
modeled on HGSS / Infinite Fusion Viridian Forest = clearings + corridors + tree masses.)

**Pipeline (archetype-driven, not pure RNG):**
1. **Layout archetype** picks a coherent skeleton. e.g. *castle* = central keep + perimeter walls
   + gatehouse + courtyard; *town* = roads grid + plaza + houses along roads; *boss-room* = arena
   + entrance + boss anchor.
2. **Place structures** using the §2 sizing formula (real 8×4+ buildings with 2×2 doors), snapped
   to the layout (houses face roads, keep centers the castle, etc.).
3. **Apply theme palette** to ground/water/walls/props (frozen → ice/snow/blue; lava →
   ash/obsidian/ember). Tile labels per the vocabulary contract.
4. **Connect & populate** — roads/paths between structures, props, spawn point, and **connectors**
   (level/content/region) at doors and exits.
5. **Validate** — coherence checks (no buildings on water/roads, doors reachable, sizes legal).

"Good" = coherent archetype + legal sizing + themed palette + reachable doors — reproducible from
the 4 inputs. Expand archetypes/themes incrementally; make robust over time.

---

## 4. Build order (this subsystem)

1. **Building composer** — given (type, floors, length, theme) emit a legal multi-cell structure
   (walls + 2×2 door + windows + roof) as tiles/composite, obeying §1. Replaces the current
   single-`█` / tiny-composite buildings.
2. **Sizing formula** (§2) wired into the composer; tune visually.
3. **Archetype layouts** (§3 step 1–2) for a couple of archetypes (town, castle).
4. **Theme palettes** (§3 step 3) — start with 2 (e.g. frozen, lava).
5. **Connectors + validation** (§3 step 4–5).

Depends on a usable editor (the UI rebuild) to author/preview, and feeds the AI generator later
(the generator produces art for these same labeled structures).

---

## 5. THE LAYERS

A LAYER IS A SET OF THINGS IN A GIVEN CONTEXT. It is a subsystem, not a function, not a pass, not a call site:
*"a layer IS NOT a function or a method used in the engine, is the overal system that generates something"*.

The context here is A LEVEL BEING COMPLETE. That is wider than the map generator, and the two must not be
conflated: *"A LAYER DOESN'T NECESSARILLY RUNS IN THE GENERATOR, IS JUST A THING IN THE CONTEXT OF THE LEVEL
COMPLETION"*. Units are a layer of elements even though the generator does not scatter them.

### 5.1 The layers, in order

| # | layer | what it is | group |
|---|---|---|---|
| 1 | **grid + terrain** | the grid (size, cell, rows) and the terrain built on it, by zone / region / season, which determines what objects will be added and the type of floor | layout |
| 2 | **water** | blocks pathways | layout |
| 3 | **pathways** | the map's STRUCTURE. Adapts to the space water left on the grid. What is a pathway, what is a section to put objects in, where the exits are, how the pathway is drawn | layout |
| 4 | **objects** | where the generator enters into play. Tile compositions: buildings, nature, decor. Houses, fountains, trees. The LOOK of the pathway and of the exits is picked here too. Content AND ordering differ per zone: a jungle's objects are not a town's | objects |
| 5 | **units** | the creatures and townsfolk. Depends on everything above | |
| 6 | **fog** | to optimize, handle distance. NOT IMPLEMENTED | |
| 7 | **lightning** | affects all elements. NOT IMPLEMENTED | |
| 8 | **shadow** | depends on lightning and on positioned elements. NOT IMPLEMENTED | |
| 9 | **post processing / optimization** | NOT IMPLEMENTED | |

`layout` is the name for 1 to 3 together: *"layout refers to the underlying subsystem already mentioned (grid,
terrain, water, pathways), it groups them under it, we can name it differently, but basically those are the
'main' layers"*. `buildings` / `nature` / `decor` are the objects layer seen closer up.

**EVERY TEMPLATE RUNS THE SAME LAYERS.** A template does not own a pipeline. It varies by the DATA it feeds
them, and today only `objects` differs: *"basically the only layer that changes (sat the moment) is the objects
layer, in the future the light, fog and shadow will also change, because they depend on the base objects
layout"*.

### 5.2 Structure is pathways, LOOK is objects

The line between layers 3 and 4 is structure against appearance, and it is easy to put on the wrong side:

*"pathways doesn't necessarilly determines the LOOK of the pathway, that's usually done in the objects aprt,
where floor is actually painted with tiles specific to each map/region, etc. What the pathways determine is the
map structure, what is a pathway, what is a section to put objects, what are the exits, how's the pathway draw,
etc. then on the objects phase we can pick the type of pathway, type of exit, etc"*.

| pathways (layer 3) decides | objects (layer 4) decides |
|---|---|
| where the ways run and how they are drawn | which tile the way is surfaced with, and in what colour |
| how wide a way is | what lies ON it and what stands BESIDE it |
| which cells are a way and which are a section for objects | which entrance composition an exit wears |
| where the exits are and how many | what an exit looks like |

So a template's served pathway block is two things wearing one name, and they belong to different layers: the
width and the shape of the way are structure, the surface, its tone, the marking, the scatter and the lining
are look.

**The way's COLOUR belongs to the pathway kind, and to nothing else.** It lived in two places, the kind's
`surface` and the template's `palette.trail`, and the palette won every disagreement. So a mountain forest
asked for a gravel track and its inherited woodland palette painted the gravel brown, a swamp asked for a
boardwalk and the jungle palette painted the planks dirt, and a meadow, whose palette states no trail at all,
fell through to the raw tile and came out with a park path 45 points of luminance DARKER than its own lawn.
Every one of those is a template stating what its way is made of and losing to something it inherited. The
kind carries `tone` now and the palettes carry no trail, so there is one answer. A palette owns the ground,
the water and the shore; the pathway owns the way.

**A pathway is served WHOLE.** A subtype that names a different kind gets that kind and nothing of the one it
replaced. Merged key by key, a medieval city swapped asphalt for cobbles and went on inheriting the asphalt's
white centre line.

**Anything added is a TILE or an OBJECT.** *"anything added should be part of tiles and/or objects"*. No layer
invents a drawing primitive of its own.

**The exits and pathways chosen need a PREVIEW**: *"we should also have preview for the exits and pathways
selected"*. It shows the structure layer 3 produced before the objects layer dresses it, which is the same
thing as the layout filter stopping at layer 3.

### 5.3 What is NOT a layer

- **Region** and **elevation** are elements used INSIDE the terrain layer. *"region is not a layer, elevation
  is not a layer either"*.
- **Anything that is a step inside a layer.** Sealing the border, cutting the gates, keeping a way walkable and
  clearing what stands in it are all PATHWAYS. Flattening floors and blending transitions are TERRAIN. Stamping
  an entrance is OBJECTS. None of them is a layer, and each one that was given its own entry split logic that
  then only ever changed in one context: *"every time I've requested something, you've added a new thing that
  alñready existed and segmented logic into many code sections, then when one is changed, it only changes on a
  specific context instead of globally, hence why all your fixes suck and none was ever implemented as expected
  or only worked in a single map and not all"*.

### 5.4 Inputs are parameters ON a layer

Every input on the generator UI is a parameter of one layer: *"THE INPUTS ARE WHAT DEFINE THE PARAMETERS OF THE
FIRST LAYER, IN FACT EVERY INPUT FROM THE GENERATOR UI DOES EXACTLY THE SAME, IS A PARAMETER IN A GIVEN LAYER OF
THE SYSTEM"*. Size, cell and rows are parameters of layer 1. The river course is a parameter of layer 2. Exits
and pathway count are parameters of layer 3. The tree mix and the pathway surface are parameters of layer 4.

The UI's "layout" choice is ALSO a parameter, and it is a FILTER: *"LAYOUT IN THE UI JUST REFERS TO I WANT TO
ONLY EXECUTE THE SYSTEM UP TO THIS SPECIFIC LAYER. IE: ONLY GIVE ME AN EMPTY MAP WITH ALL PATHWAYS, GIVE AN
EMPTY MAP WITH A RIVER, GIVE THE FULL MAP, ETC"*. So the generator runs layers 1..N where N is what was asked
for.

### 5.5 Where the layers live

The layer LIST is backend data (`/api/generation_layers`): key, label, hint, position, seedable. The engine
binds a pass to each key and runs them in the served order, so adding fog is a row in the backend rather than a
release in this repo. A served layer the engine has no pass for does not run; a pass whose layer is not served
does not run either.

Seeding is per layer (`makeRng`, `GenerateOptions.seeds`), so re-rolling one layer changes only that layer:
every other layer, fed the same seed, reproduces identically.

### 5.6 How the code is built to it

**A VARIANT DECLARES PHASES, IT DOES NOT OWN A PIPELINE.** Every variant states `terrain`, `water`,
`pathways` and `objects`, and the layers call them. What a variant does not do it does not declare, rather
than the engine leaving a call out.

```ts
interface VariantPhases {
  terrain:   (ctx, rngs) => void   // the grid's ground, by zone, region and season
  water?:    (ctx, rngs) => void   // laid BEFORE the pathways, because it is what they go around
  pathways?: (ctx, rngs) => void   // the map's STRUCTURE
  objects?:  (ctx, rngs) => void   // everything placed, and the LOOK of the pathways and the exits
}
```

All eight went across: woodland, jungle, meadow, town, city, cave, temple, boss stage. Before this they were
eight private call sequences inside one 5,000-line file, and `terrain` was three layers behind one name.

**FREE SPACE IS A REAL THING, `ctx.claimed`.** *"objects are put in the free spaces that the map has after
pathways and river has run"*. Water, the pathways, the gate mouths and a wood's clearings all claim ground
before anything is placed, so the objects layer chooses from what is left rather than choosing anywhere and
being corrected afterwards. That replaced a SWEEP, which only works while the planting happens before the
pathways exist.

**TWO ENTRIES ARE NOT LAYERS AND ARE NAMED FOR WHY.** The PLAN is made ahead of terrain because a cave's
tunnels and a temple's corridors ARE its pathways and its rock is carved out of them; nothing outdoors reads
it during terrain. `terrain:finish` is the terrain layer's last word, because a shoreline cannot be blended
before the thing it borders exists.

**What the migration fixed on the way, each measured:**

| | before | after |
|---|---|---|
| a town with a river | severed, 1 to 3 buildings in the water | 113 to 203 water cells, 24 to 60 deck cells, none in the water, one piece |
| a woodland's served `palette.floor` | read by nothing | painted, and its path is now lighter than its ground |
| a path against its ground | jungle path darker than the field (79.1 vs 85.0) | lighter, as all nine references are |
| the border treeline | ran in pathways, and the floor repair cut back out through it | runs in objects, six holes closed |
| a pathway's own network | the sweep cleared 170 of the 487 cells a woodland cuts | all of them, by construction |
| floor painters | 7, one per variant | 1, `paintFloor(data)` |
| stranded-pocket sealers | 3 | 2 policies, interior and outdoors |
| the `ways` name | 135 uses across 43 files | gone; it is `pathways` |

### 5.7 Forest = the MEADOW layouts (rebuilt 2026-07-25 to match #24 / #14)

The forest variant builds one of three **meadow** layouts (references #14 = meadow, #24 = meadow + river, #26 =
meadow + two ways); the earlier `passages` / `open` / `lake` generators were **retired**. A `ForestLayout` is
`meadow | meadow_river | meadow_pass`, and a plain forest generate (no explicit layout) **randomly picks one**
(seeded via `ctx.rand`, so it reproduces).

Both build an OPEN muted-olive meadow that **DOMINATES** the map (an airy field, not a clearing hemmed by trees):

- **`meadow`** — the open field with faint rectangular **garden-plot** grid lines (a colour), subtle brown
  **dirt/earth** patches, a few grey field **rocks**, and tiny scattered **flowers** ("not everything is
  green"); a **SINGLE** cobblestone entrance on the near (**bottom-left**) edge, lined with **lamp posts** +
  colourful **flower beds**; and **SPARSE** tree **CLUMPS** framing the top / left / right edges plus a few at
  the bottom corners — **never a dense ring** (the dense tree-border was the wrong look).
- **`meadow_river`** — the same, PLUS a **colour-only WINDING river** hugging **three** sides (top / left /
  right), a meandering channel set in from the edge with sandy **BANKS**, leaving the near (bottom) edge **OPEN**
  for the entrance and a thin **LAND strip BEYOND** the river for the framing trees. It is **NOT** a 4-sided
  perimeter ring / moat. A walkable stone **BRIDGE** crosses it at the top-right.
- **`meadow_pass`** (#26) — the open field opened on **TWO opposite edges** (top + bottom, aligned on the same
  column) for a **through-route** you enter one side and exit the other, each way paved cobble + lined with lamp
  posts + flower beds. No river. Distinct from single-entrance `meadow` — a "variation = new type".

**Composition appearance (2026-07-25, toward #24 — validate on :3000):** tree/bush **canopies render as ROUNDED
crowns**, not leaf-faced cubes — the `leaf_center` cell defaults to the `shape:"circle"` FORM (MAP-MODEL §5, the
existing silhouette setting, NOT new shape logic). The entrance **lamp posts** carry a **small DARK lantern** bulb
by day (bulb `scale` 0.6→0.34 + an authored per-cell `settings.color`), still lighting warm gold at night via the
`night` colour animation. Both ride the general rule that a composition cell's **`settings.color` tints its baked
tile in the base render** (MAP-MODEL §8) — `stampComposition` now applies it, so any composition can ship a
recoloured cell.

The whole floor is a **COLOUR on a RAISED tile**: grass / earth / cobble are per-cell `floorColors` STATE the
generator writes on the flat-but-**height-1** `meadow` tile, and the river is the flat colour-only **height-1**
`water` tile (blue, blocking). Because the floor is a **height-1 BLOCK**, everything **stacks ON TOP of it**,
globally and data-driven from the tile's own height (`floorBlockLift`):

- **units** (the player, NPCs, enemies) render **lifted onto the block top** — they stand ON the meadow, not
  sunk through it (a flat town floor is height 0 → lift 0 → towns byte-identical). The lift is added to the
  unit's iso draw offset, the SAME `isoStackLift` trees/props ride.
- **ornaments** (flowers, rocks, decor) are placed at `heightLevel = floorBlockLift`, i.e. a **transparent
  billboard in a cell ON TOP of** the floor block — the floor colour shows beneath, no green cube around the
  bloom (a flower = `display:'single'` + `transparent`, MAP-MODEL §4). The generator emits **no 0-height tiles**.

TILES are spent only on **ornaments** (flowers, rocks) + the bridge — the "reduce tiles, grass + water are
colour" model. Colour is per-cell DATA the render READS (MAP-MODEL §4), never derived at render, and coarsened
to **ZONE/PATCH level** so `compressGround` merges the floor into runs (a **row-band** season gradient +
**patch checkerboard** plots + patch-quantised river ripple — the per-cell diagonal gradient + per-cell plot
grid-lines were the FPS killer). A single **reusable land-only guard** (`isWaterGround`/`isLandCell`) keeps
**every** prop, tree, lamp, ornament AND unit/spawn OFF water — nothing lands on a water cell except the bridge
deck. `repairFloorConnectivity` fills only TINY stranded pockets, so the land strip beyond the river stays a
deliberate separate area. Structure is locked by `stageGenerator.meadow.test.ts`; the visual match itself is
validated on the running game (:3000).

---

## 6. What a generator ROW is

§5 says what the LAYERS do. This says what they are fed, which is one row of `generators` served by
`GET /api/generators`. There are 38 of them: nine wilderness biomes and a village / town / city for each,
plus the standalone city types.

### 6.1 The row

| field | what it is |
|---|---|
| `key` | names exactly ONE row, `forest_woodland`, `town_swamp`. This is what a card is. |
| `layout` | which BUILDER runs: `woodland`, `jungle`, `meadow`, `town`, `city`. Three builders serve nine biomes. |
| `variant` | which archetype the engine runs it as: `forest`, `town`, `city`. |
| `zones` | the seasons this row may be generated in. |
| `config` | everything the build is made of (§6.2). |
| `options` | what the PANEL offers: exits, pathways, region, river, kind of crossing. |

`layout` and `key` are not the same thing and the difference has bitten twice: nine wilderness rows share
three builders, so looking a row up by its layout hands back whichever row declares that builder first.

### 6.2 The config sections

    grid          how big a map of this kind is, and its cell geometry
    nature        how thickly it is dressed: canopy, groundCover, flowers, tallGrass
    palette       the COLOURS it paints with: floor, litter, canopy, water, bank
    formation     how it DISTRIBUTES trees: lattice, spacing, understory, understoryTile
    trees         WHICH trees, as weights
    pathway       what its ways are made of: surface, width, tone, edge
    crossings     what a river is crossed on, by kind (§6.4)
    subZones      THE REGIONS it is made of (§6.3)
    regionLayout  how those regions are laid on the map: scatter / rings / bands
    terrain       HOW MUCH of what it contains (§6.5)
    units         who populates it
    settlement    plot and street tuning, settlements only
    buildings     the material and colour palette, settlements only

A section the row does not state is ABSENT, and the pass that reads it does nothing. That is the law
(`MAP-MODEL.md` §8), and it is why a town states no `formation` and grows no wood.

### 6.3 `subZones`: the regions, and they belong to the BIOME

Every row is made of regions, and they are ITS OWN. `REGIONS.md` §1.1. A woodland is
`high_forest / coppice / ride / windthrow / streamside`; a jungle is
`emergent / understory / light_gap / varzea / bamboo`; a town is
`centre / lanes / green / market / outskirts`. There is no shared set any more, and a "Glade" on a volcano
was the symptom that there used to be.

One region, in full, as served:

```json
{ "key": "coppice", "name": "Coppice", "weight": 3,
  "canopy": 0.30, "undergrowth": 1.60, "leafHue": 0, "leafValue": 0.0,
  "formation": { "lattice": 6, "spacing": 2, "understory": 1.55, "understoryTile": "shrub" },
  "trees": [ { "kind": "tree_sapling", "weight": 55 },
             { "kind": "bush", "weight": 30 },
             { "kind": "bush_round", "weight": 15 } ] }
```

A region may also state `floor` (its own ground tone), `level` (relief, mountain and volcano only),
`pools` (standing water), `stone` (fallen masonry) and `built` (the share of plots carrying a building,
settlements only).

**A region overrides the row, never the other way round.** The row's `formation` and `trees` are what a cell
no region claims gets. Picking a region in the panel makes the map THAT region, whole.

### 6.4 `crossings`: cut, or carried over

A way never paves over water (`PATHWAYS.md` §1b). Where it meets a river it stops at the bank, or a crossing
carries it:

    wood / stone    a composition, a built span standing over the channel
    dirt            reusesWay: the map's OWN way carried over, so in a city it is the city's street

### 6.5 `terrain`: how much of what it contains

Twenty-six numbers per row, measured in cells and in shares: the ground and bloom patch sizes, the depth of
the treeline that closes its edge, how far its gateway reaches in, the ford width, the smallest body that
counts as a lake, the pool sizing, the four ruin measurements and the meadow-layout ones.

These were constants in `stageGenerator.ts`. They are here because **a value a shared BUILDER reads has to be
served by every row that can run that builder**, and a constant named for one biome hides that. Moving the
meadow's into the meadow's row alone broke the around-course river and the framing trees on every other row
that runs the meadow builder.

### 6.6 Who owns the data

**The seeder owns the whole `config` column.** `GeneratorSource.seed/0` writes it from its own literal, so
anything a data migration adds on top is gone at the next seed. That erased ten migrations' worth of region
work, more than once, with nothing in the code having changed either time.

So a fact that must survive lives in the seeder, not in a migration on top of it. The gate is
`a_biome_has_its_own_regions_test.exs`: it seeds, and nothing else, and fails on a seeder that does not state
the sets itself.

Applying it to a database is `mix run -e 'Nebulith.Catalog.GeneratorSource.seed()'`. Nothing else writes these
rows: `/api/generators` is read-only, `index` and no more.
