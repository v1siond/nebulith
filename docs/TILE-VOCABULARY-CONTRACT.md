# Nebulith — Tile-Vocabulary Contract (the keystone)

> Every system in Nebulith "speaks tiles," but they all speak a **different dialect**. The level
> grid, the parser's training labels, and the generator's captions must agree on **one** tile
> vocabulary or the AI pipeline can never line up with the engine. This is the single
> highest-leverage artifact in the whole project — more than any prose or any feature.

This doc (1) catalogs the **five+ vocabularies that exist today** and how they conflict, and
(2) proposes **one canonical contract** they should converge on.

---

## 1. The vocabularies that exist today

| # | Where | Keyed by | Category system | Example labels | Status |
|---|-------|----------|-----------------|----------------|--------|
| A | `game-website/src/engine/Tileset.ts` `TILES` | **descriptive identifier** | `nature / building / decoration / ground` | `trunk`, `foliage`, `wall_stone`, `roof_peak`, `water_deep`, `path_stone`, `cliff_face` | **De-facto engine contract** (editor palette uses it) |
| B | `game-website/src/engine/tileVocabulary.ts` `ALL_TILES` | single-letter char | `sky / background / structure / vegetation / ground / entity` | `wall_solid #`, `tree_crown_top Y`, `grass_short ,` | Legacy/platformer path |
| C | `game-website/src/engine/TileGrid.ts` `TILE_DEFS` | char | flat (`collision`, `defaultHeight`) | `grass .`, `water ~`, `wall █`, `roof ▀`, `tree @` | Top-down grid |
| D | `asciiComponents.ts` + `buildingComponents.ts` | component name | `vegetation / structure / decoration / terrain / character` | `TREE_LARGE`, `CASTLE_WALL_SECTION`, `PIPE_TALL` | Component library |
| E | `sprite-generator/training/.../models.py` `SpriteCategory` | enum | character/battler/enemy/boss + **4 coarse tiles** | `TILE_GROUND`, `TILE_WALL`, `TILE_WATER`, `TILE_DECORATION` | **Implemented** (what the parser actually emits) |
| F | `sprite-generator/training/docs/MODEL_TRAINING_TAXONOMY.md` | caption tokens | `tile_terrain` (9-piece), `tile_path`, `tile_wall_ext/int`, `tile_cliff` | `"...terrain tile, top down view, grass center tile..."` | **Spec only** (generator target) |
| G | `sprite-generator/training/docs/tileset_grammar_spec.md` | **descriptive edge name** | terrain/liquid/path/wall/cliff/shadow/building/prop/interior | `grass_c`, `grass_tl`, `water_tl`, `roof_red_peak`, `cliff_face_c`, `path_t_junction_b` | **Spec only** (`get_tile()` is a `pass` stub) |

### Why this is broken
- The **same descriptive name** (`wall`, `roof`, `tree`, `bush`, `flower`, `door`, `window`,
  `stairs`, `floor`) appears in **2–3 of A/B/C** bound to **different glyphs** and **different
  category systems**. Glyphs are *not* unique keys even within A (`█` = both `wall` and
  `cliff_face`; `~` = `roots` and `water_shallow`; etc.).
- The parser (E) emits only **4 coarse tile labels**. The engine grid (A) needs **hundreds** of
  descriptive ones. The generator target (F/G) wants **9-piece edge** names. So a LoRA trained on
  the parser's output could only ever produce `TILE_DECORATION`-grade labels — useless to the grid.
- **No translation layer exists**, and `sprite-generator` never references the engine vocabulary at
  all (beyond one aspirational README line). The promise "generated assets are labeled to match the
  engine tile vocabulary" is **unbuilt**.

```
  PARSER emits          ENGINE grid needs           GENERATOR wants
  ───────────           ─────────────────           ───────────────
  TILE_GROUND     ≠     grass_c, grass_tl, ...  ≠    terrain tile / grass center
  TILE_WALL       ≠     wall_stone, roof_peak.. ≠    tile_wall_ext, ...
  TILE_WATER      ≠     water_deep, water_tl... ≠    tile_water (9-piece)
  TILE_DECORATION ≠     (hundreds)              ≠    tile_path, tile_cliff, ...
        └───────────────── no shared contract ──────────────────┘
```

---

## 2. Proposed canonical contract

**Adopt the grammar spec (G) — 9-piece descriptive edge naming — as the single source of truth.**
It is the most expressive (the only one that can name edges/autotiles), it already has a written
spec, and the generator taxonomy (F) was designed against it. Everything else maps **to** it.

### 2.1 The naming scheme (from `tileset_grammar_spec.md`)
- **Base name** = material/role: `grass`, `dirt`, `water`, `path_stone`, `wall_brick`,
  `roof_red`, `cliff`, `floor_wood`, …
- **Edge suffix** (9-piece autotile): `_tl _t _tr _l _c _r _bl _b _br` (corners/edges/center),
  plus junctions (`_t_junction_b`, etc.) where the grammar defines them.
- **Full label** = `<base>_<edge>` → `grass_c`, `water_tl`, `roof_red_peak`, `cliff_face_c`.
- **Categories** (the top-level grouping): `terrain · liquid · path · wall · cliff · shadow ·
  building · prop · interior` (+ `character` for actors, kept separate — that half already agrees).

### 2.2 What each system does to converge
| System | Action |
|--------|--------|
| **Engine A (`Tileset.ts`)** | Re-key `TILES` to the canonical `<base>_<edge>` names (keep glyph + color + blocking as render metadata). This becomes the live contract the editor paints with. |
| **Engine B/C/D** | Demote to internal/legacy. Provide a one-way map `legacy → canonical` (B already has a `LEGACY_TO_NEW` map to extend). Do **not** add new tiles to B/C/D. |
| **Parser E** | Replace the 4 coarse `TILE_*` with a free-form `tile_name: string` carrying canonical labels; implement edge/autotile detection so a terrain tileset yields `grass_c`, `water_tl`, … (today: net-new logic). |
| **Generator F/G** | Caption format consumes canonical labels verbatim: `"<style>, terrain tile, <view>, <base> <edge> tile, ..."`. Implement the `get_tile(semantic_name, style)` stub against the same names. |
| **Export (`exportLayers`)** | Emit canonical labels in `tileMapping` (and fix the partial charMap bug) so a downstream engine gets the real names, not `'.'`. |

### 2.3 One artifact to rule them all
Create a **machine-readable vocabulary file** (e.g. `nebulith/tile-vocabulary.json`) listing every
canonical tile: `{ name, category, base, edge, glyph?, blocking, defaultHeight, description,
aliases:[legacy names] }`. Generate the engine's `TILES`, the parser's label set, and the
generator's caption tokens **from this one file** so they can never drift again. (Today they're
hand-maintained in 5+ places.)

---

## 3. Why this is the #1 unblock for the AI side

The user's near-term goal is **one art style fully working end-to-end** (Fantasy Dreamland) as a
POC. The blocker isn't "train the model" — it's that **there's nothing coherent to train it on**:
the parser emits labels the engine can't use. Freezing this contract (2.1) and implementing
edge-detection in the parser against it (2.2, row "Parser E") is what makes a trainable,
engine-compatible dataset possible. Model training comes *after* — and is comparatively routine.

See [`GAPS-AND-ROADMAP.md`](GAPS-AND-ROADMAP.md) for sequencing (note: the AI track is **deferred**
behind product hardening per the MVP priority).
