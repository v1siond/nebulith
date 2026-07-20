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

> **Status (observed 2026-07 — the code is newer than this section).** The shipped editor's zone
> selector now speaks **seasons**: `spring · summer · autumn · winter · desert`
> (`game-website/src/components/game/editorConfig.ts` `STAGE_ZONES`; palettes in
> `src/engine/zones.ts`), with variants `forest · town · city · cave · temple` (`STAGE_VARIANTS`).
> `lava` and `beach` still exist as `ZoneId` values but are off the UI menu; `frozen`/`verdant` are
> gone. The lava/frozen matrix below is the earlier design and does NOT describe the current build —
> reconcile it (and §7 of `EDITOR-INTERACTION-SPEC.md`) with the seasonal model before building to it.

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

## 5. Layer-pass architecture (the macro/micro randomize foundation) — SHIPPED 2026-07

The stage generator is built from independent, **seedable LAYER passes** rather than one monolithic
pass, so the user can randomize the whole map OR just one layer ("randomize the map… only trees…
only buildings… just the MAP which contains the distribution of things without actual structures").
This is the foundation for the editor's scoped **Generate ▾** randomize (macro) and the selection
re-roll (micro).

### 5.1 The layers (`stageGenerator.ts` `LayerId` / `LAYER_IDS`)

| Layer | Pass | What it owns |
|-------|------|--------------|
| **layout** | `layoutPass(ctx, settlement) → VillageLayout` | terrain/ground distribution + roads + plots + plaza — the "map without structures nor nature" |
| **buildings** | `buildingsPass(ctx, layout)` | one typed composition stamped per plot (kind is a plot decision; appearance variety is rolled at load) |
| **nature** | `naturePass(ctx, layout, settlement)` | trees / bushes / flowers / ground cover |
| **decor** | `decorPass(ctx, layout)` | plaza centrepiece (well/fountain) + street lamps |
| **units** | *(editor)* | enemy/npc scatter — owned by the editor's entity store, not the generator |

### 5.2 Seeding contract (`makeRng`, `GenerateOptions.seeds`)

- Every stochastic helper draws from **`ctx.rand`** (a `Rng = () => number`), never `Math.random`
  directly, so a pass is **pure given its rng**.
- `generateStage({ …, seeds })` takes an optional **per-layer seed**. A layer with a seed draws from
  a reproducible `makeRng(seed)` (mulberry32) stream; a layer left out draws from the global
  `Math.random`. **Omitting `seeds` entirely reproduces the pre-split generator byte-for-byte** — the
  behaviour-preservation guarantee (locked by `stageGenerator.layers.test.ts`'s seeded digest
  baselines).
- **Re-roll one layer** = change only that layer's seed and regenerate: the other layers, fed the same
  seeds, reproduce identically, so only the re-rolled layer changes.

### 5.3 Order is load-bearing

`placeSettlement` composes the passes **layout → buildings → decor → nature** (the same order the
generator always ran): layout carves roads before buildings reserve plots, and **decor paves the
plaza before nature plants** so no tree lands on the square. The `LayerId` list orders layout,
buildings, nature, decor, units for the *menu*; the settlement *executes* decor before nature.

### 5.4 Honest scope (what has real generator randomness)

Only **layout** and **nature** carry stochastic generator RNG today. **buildings** are
deterministic from the layout (a building's kind comes from its plot; the plaza variant from
settlement size) — their visible re-roll is an **appearance** re-roll (material / roof / wall colour)
performed at load in the editor's `applyStageToGrid`, not new generator geometry. **decor** is
deterministic in its GEOMETRY (the plaza centrepiece + the lamp POSITIONS come from the layout), but
it does carry ONE small stochastic pick from the **decor** rng: `markFailingLamps` flips a tiny random
subset of the placed lamps (usually 1, sometimes 2, occasionally 0) to the flickering
`lamp_post_failing` variant, so a decor re-roll re-picks WHICH lamps flicker while the rest stay steady
(see `LIGHTING.md` §4 — "only 1 or 2 lamps flicker"). **units** are an editor entity concern. The non-settlement archetypes (forest / cave / temple / boss) remain
single whole-map generators reading `ctx.rand` (seeded via the layout rng); they are not decomposed
into these layers.
