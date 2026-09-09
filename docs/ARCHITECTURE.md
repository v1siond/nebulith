# Nebulith — Architecture

End-to-end technical map of all four systems, synthesized from a five-front audit (2026-06-21).
Read [`../README.md`](../README.md) first for the elevator view.

`file:line` citations were verified at audit time; treat line numbers as approximate.

---

## 1. Engine + Editor (in `game-website`)

### 1.1 The surprising shape: the "engine" is mostly the editor

The directory `src/engine/` is **not** where the live game runs. It contains:

- A **legacy 2D-platformer runtime** — `GameEngine.ts` (canvas + `requestAnimationFrame` loop +
  offscreen static-layer cache), `Camera.ts` (2D follow camera), `Player.ts` (3-row ASCII
  sprite player **with a real jump**: `isJumping`, `jumpForce`, gravity). This stack is only
  consumed by a throwaway page, `src/pages/engine-test.tsx`.
- An **isometric/grid data model** — `IsometricGrid.ts` owns the iso **projection math**
  (`worldToScreen`, ~`:103`) plus `ground[][]`, `height[][]`, `collision[][]`, and an `assets[]`
  list. It is **data + geometry only — it does not render.**
- A **second grid model** — `TileGrid.ts` ("v2", per-cell `{char,height,collision}` + its own
  `TILE_DEFS`), used by the top-down view.
- **Tile vocabularies + components** — `Tileset.ts` (the editor palette: `TILES`,
  `COMPOSITE_ASSETS`, `TERRAIN_PRESETS`), `tileVocabulary.ts` (legacy single-letter set),
  `asciiComponents.ts` + `buildingComponents.ts` (multi-line ASCII components; the latter has a
  `DoorTrigger`/`targetScene` skeleton).
- `MapComposer.ts` — composites ASCII components into a grid. **Dead code** (imported nowhere).
- `adapters/legacyAdapter.ts` — converts an old `GameAsset` into engine `LevelData`.
- `index.ts` — a **partial** barrel (omits `MapComposer`, `asciiComponents`, `buildingComponents`,
  `tileVocabulary`).

**The live engine is `src/pages/personal-projects/game-engine/templates.tsx` (~5,272 lines).**
It contains the real game loop, *all* isometric/top-down rendering, view-mode switching, the
player block model (`CHAR_HEIGHT = 3`), and the connector logic. It imports only `IsometricGrid`
from the engine folder — the platformer runtime, the jump in `Player.ts`, and the `DoorTrigger`
skeleton are **orphaned**.

> Implication: `templates.tsx` is simultaneously the editor *and* the runtime. It is the single
> most important — and most overloaded — file in the system. Decomposing it is prerequisite work
> for almost any feature or UI change (see roadmap).

### 1.2 The two data/render pipelines

**A) Platformer (2D horizontal)** — `GameAsset` → `convertLegacyAsset()` → `LevelData` →
`engine.loadLevel()` (computes per-cell `ComputedTile`, bakes a static offscreen layer) →
`engine.gameLoop()` (player + camera + animated tiles). *Only used by the test page.*

**B) Grid / Iso (the real editor)** — `TILES`/`COMPOSITE_ASSETS` placed into an `IsometricGrid`
via `placeTile`/`placeComposite` (maintains `collision[][]`, `height[][]`) → `IsometricGrid`
produces depth-sorted projected coords → **rendering + game loop live in `templates.tsx`**.

### 1.3 View modes

There are effectively **five** display modes, driven by **three module-level globals**
(`debugMode`, `topViewMode`, `flowViewMode`) **plus** a `viewType: 'isometric' | '2d'` React
state — a dual source of truth that is the system's worst structural smell.

| Mode | Renderer (in `templates.tsx`) | Notes |
|------|-------------------------------|-------|
| **ISO** | `render()` (~`:3885`) | Diamond iso tiles, height as front/side faces, depth-sorted by `col+row`. Projection math from `IsometricGrid`. |
| **2D** | `render2D()` (~`:4270`) | Orthographic 3/4 view, height as stacked shelves. |
| **TOP** | `renderTopView()` (~`:5043`) | Flat blueprint. **The only view that draws connectors and supports cell selection/painting.** |
| **DEBUG** | overlays on ISO (`renderDebugOverlays`) | Collision overlay. |
| **FLOW** | `FlowViewOverlay` React canvas | Node-graph of connected templates (editor nav, not gameplay). |

Editing tools (palette, resize, save/load, export, connector UI) only render in **TOP/DEBUG**
(`showTopView || showDebug`). You **cannot edit, save, or place connectors in the playable ISO/2D
views**, and connectors are invisible there.

### 1.4 Playable actions — reality

`PlayerState` = `{x, z, facing, moving, frame}` — **no `y`, no jump, no action state.** The game
loop implements **move + collision only**. **Interact, jump, attack, touch do not exist** in the
editor's play loop — even though `Player.ts` already has a working jump and `buildingComponents.ts`
has a trigger skeleton. (See `TILE-VOCABULARY-CONTRACT.md` neighbor doc and the roadmap.)

### 1.5 Connector / trigger system — **data-complete but functionally inert**

The defining feature — connect templates so an action teleports the player to another level — is
**authored, persisted, and visualized, but never fires in play.**

`Connector` (`src/lib/api.ts:5-13`):
```ts
interface Connector {
  col: number; row: number
  targetTemplateId: string; targetTemplateName?: string
  interaction: 'walk' | 'interact' | 'auto'
  spawnCol: number; spawnRow: number   // where to land in the target
}
```
- **Authoring** (works): `connectorMode`, `saveConnector()`/`deleteConnector()`, a form to pick
  target + interaction. **But no UI sets `spawnCol/spawnRow`** — they're hardcoded to `25,25`.
- **Rendering** (partial): only `renderTopView` draws connectors; `render()`/`render2D()` don't
  even take a connectors param.
- **Triggering** (missing): the game loop never checks "player cell == connector cell." No
  teleport ever fires during play. The only inter-template navigation today is **clicking a node
  in FlowView** (an editor convenience).
- The engine's orphaned `DoorTrigger`/`targetScene` is the trigger system that was meant for this.

### 1.6 Persistence + API

- **Postgres via the Elixir backend (nebulith).** The `"Template"` record holds grid layers
  (`groundData`, `heightData`, `assetsData`) plus `connectors` / `entities` / `quests` as **inline JSON**,
  not normalized. **No auth/ownership is enforced** by any route; `isPublic` is never checked.
  **Prisma was removed in `0e3eba9`** — the table it left behind is now created and owned by
  `nebulith/priv/repo/migrations/20260907120000_create_template_table.exs`. `authorId` survives as a plain
  string: the Prisma-owned `User` table went with Prisma, so there is no relation to enforce.
- `CustomAsset` model exists in the schema but has **no API route** (unreachable).
- **REST CRUD** at `/api/templates` (Pages router) — list/create (`index.ts`), get/update/delete
  (`[id].ts`). Client wrapper in `src/lib/api.ts` (+ `serializeGrid`/`deserializeToGrid`).
- `prisma/seed.ts` seeds only CV/portfolio tables — **a fresh DB has zero templates.**

### 1.7 Exporters

Two, both **client-side blob downloads** (no server export route; no Tiled/`.tmx`/Godot/Unity
format anywhere):

1. **Template "Layers" export** — `exportLayers()` (`templates.tsx:~2903`) → `<name>-layers.json`:
   `{metadata, tileMapping, layers:{ground, groundTypes, height, collision, buildings, nature,
   decorations, npcs, full}, spawn, connectors}`. **This is the canonical export.** Data-only by
   design (no behavior, no art — exactly the "export data, not functionality" rule).
   - **Bug:** `tileMapping`/`charMap` is hardcoded and partial (~5 ground + ~13 asset chars vs.
     hundreds of `TILES`). Themed grounds (snow/sand/stone/`road_center`…) **fall through to `'.'`
     grass**, and collision only special-cases `'water'` — so themed/generated maps export
     corrupted.
2. **Sprite ZIP export** — in the Pixellab sprite tool (`src/app/sprite-generator/page.tsx`), PNG
   frames + sprite sheets + metadata via JSZip. (Different concern from level export.)

### 1.8 AI integration from the website

`src/lib/pixellab.ts` + `src/app/api/pixellab/route.ts` proxy to **Pixellab.ai (third-party)** as a
**temporary** generator until the in-house model is trained. It does **not** call the
`sprite-generator` backend. Some client functions (`generateBitforge`, `rotate`, `inpaint`) have no
proxy action — unreachable.

---

## 2. Sprite generator (in `sprite-generator`)

- **Backend** — `backend/main.py` FastAPI, Pixellab-compatible API shape. **Image generation is a
  placeholder** (returns a drawn stick figure). Only PIL-based animation (`animation_generator.py`)
  and MediaPipe skeleton estimation (`skeleton_estimator.py`) actually work.
- **Planned model** — Stable Diffusion 1.5 + **LoRA** per art style, via `diffusers`. Training is
  shell scripts (`train_all.sh`, `train_items_quick.sh`) that call a **missing
  `scripts/train_lora.py`** and point at a **non-existent `datasets/sprites/` path**.
- **Frontend** — `sprite-generator-ui`; posts to a **non-existent `/api/generate-sync`**.
- **State** — `loras/` and `test_outputs/` are **empty: nothing is trained.** The extractor *did*
  produce a real ~1.2GB Fantasy Dreamland dataset with `.txt` captions, so the pipeline is stuck
  precisely at the **data → training** bridge.
- **Taxonomy** — `training/docs/MODEL_TRAINING_TAXONOMY.md` plans ~18 game art styles and a
  dimension matrix (**style × asset-type × view × genre × animation × size**) — this is the
  concrete encoding of the "system controls the inputs, prompt only refines" model. Only **Fantasy
  Dreamland** is in progress.

## 3. Tileset parser (in `sprite-generator/training`)

- **What it is:** a **character/battler/boss sprite extractor** for RPG-Maker-style sheets — *not*
  a terrain-tileset parser. Pipeline (`sprite_extractor/core.py` `extract_all()`): pack discovery →
  asset-type classification → size selection → grid extraction → resize → save PNG + `.txt` caption
  (`"{style}, {asset}, {category}, game asset, transparent background, {tags}"`).
- **Rules:** one concrete `FantasyDreamlandRule` (regex pack-name match, folder→content-type,
  grid-from-dimensions). `FallbackRule` exists but is **not registered**.
- **Grids handled:** fixed character/battler/boss sheet shapes (3×4, 9×6 SV battler, 4×5 boss).
  **Terrain tilesets are not decomposed** — when content type is `tileset`, `categorize_cell`
  returns one flat `TILE_DECORATION`. There is **no edge/autotile detection, no 9-piece naming.**
- **This is "the parsing blocker":** the half that turns arbitrary tilesets into engine-vocabulary
  labels does not exist; only fixed-grid character sheets work.
- **Doc drift:** `architecture.md` documents a dedup "Layer 5" and per-sprite `.json` metadata that
  **don't exist in code** (only `.png` + `.txt` are written); a deleted `dedup_processor.py` left a
  stale `.pyc`; sprite-count stats are stale; `get_largest_size_in_pack` is referenced but
  **undefined** (latent `AttributeError`, only on a debug path).

---

## 4. The two unconnected seams (why the system isn't whole yet)

1. **Website ↔ in-house generator:** the site uses Pixellab.ai as an interim; the in-house model
   isn't trained, so there's nothing to point it at yet.
2. **The tile-label contract:** five different "tile" vocabularies across the systems, none of which
   agree. This is the structural keystone — it gets its own doc:
   [`TILE-VOCABULARY-CONTRACT.md`](TILE-VOCABULARY-CONTRACT.md).

---

## 5. Documentation reality

- `game-website`: **no engine docs at all** — `README.md` is `create-next-app` boilerplate; the only
  specs under `docs/` are homepage theme/section designs. The audit (this set) is the first.
- `sprite-generator`: **rich docs** (`training/docs/INDEX.md` + architecture/extractor/categorization/
  taxonomy/grammar-spec/adding-art-styles). Accurate for the extractor; **aspirational ahead of
  code** for the model, dedup, JSON metadata, and the tile grammar.
- Both repos also carry their own `.claude/` folders (cleanup item; `game-website`'s was removed
  2026-06-21).
