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
- **Length** = horizontal footprint along the facade (cells).
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
