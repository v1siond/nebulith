# Tile System — Backend Ownership Migration (design)

*Design doc — 2026-07-14. Status: proposed, pending implementation plan.*

> **One line:** Make the nebulith Elixir backend the sole owner of all tile data — tiles
> become real DB rows whose art is a **baked image** referenced by a relocatable URL — and
> reduce the `game-website` frontend to a pure renderer that fetches tiles and *builds maps
> with them*. The frontend holds **no tile art and no tile data**.

---

## 1. Why (the problem)

The directive (Alexander, verbatim): *"the backend HOLDS ALL THE DATA the frontend JUST LOADS
DATA. Tiles are DATA, IMAGES … the frontend DOESN'T HAVE nor SHOULD HAVE ANY TILE ART NOR DATA;
the frontend is just an interface for a system that BUILDS maps WITH THE TILES, all TILES COME
FROM BACKEND."*

Today the opposite is true:

- **The tile/composition source-of-truth lives in the frontend repo.** `game-website/src/game/data/`
  holds `compositions.json`, `tileKinds.json`, `emojiCatalog.json`, `entityTiles.json`, and a
  generator (`scripts/gen-tileset-seeds.mjs`) authors the tiles and *exports them down* into
  nebulith. `nebulith/priv/repo/seeds.exs` even says so: *"Seed the built-in tilesets from the
  JSON exported out of the game-website frontend."*
- **The backend is a dumb blob store.** `Nebulith.Catalog.Tileset` is `{key, name, data :map}` —
  an opaque JSON map. The backend cannot reason about a tile; it regurgitates whatever the
  frontend generated.
- **The frontend draws the art itself.** `drawIsoTileBlock` renders a *glyph* on the cube faces
  at runtime, and `asciiTileset.ts` ships a **bundled default tileset** (`CELL_GLYPHS`,
  `COLOR_ROLE_BY_LABEL`, `POSITION_BY_LABEL`, zone palettes) it renders from before the API loads.
  That embedded art is the deepest instance of the violation.

This blocks the stated future: *"in the future we'll move all tiles into a google bucket … having
all tiles in the repo is not scalable."* You can't relocate art to a bucket when the art is
frontend glyph-drawing code.

## 2. Goals / non-goals

**Goals**
- Tiles are **DB rows** in nebulith (real tables — "a real database of tiles"), each with a
  **relocatable image reference** (static path today, GCS/bucket URL later — no code change to move).
- Tile **art is a baked image** (placeholder art for now: ascii glyphs and emoji rendered to PNGs
  via a **playwright screenshot + cut** pipeline that lives in the backend repo).
- The frontend contains **zero** tile art and **zero** tile data — it fetches `/api/tilesets`
  and renders. Deleting the frontend tile-data files must leave the app fully functional.
- The **composition model is preserved**: a tree/house stays a stack of labeled blocks across
  cells + levels; only the paint source per block changes (backend image, not frontend glyph).
- The three views (iso / 2D / top) and all engine behavior (stamping, stacking, per-tile
  selection, collision, proximity fade) behave the same.
- **The frontend is a thin, swappable renderer.** All tile DATA lives in the backend behind a
  complete `/api/tilesets` contract, so the JS frontend can later be reimplemented in another stack
  (e.g. C#) for performance with the same functionality and **no backend change**. Rendering +
  map-building is the frontend's job by design; nothing tile-*data* ever is. (JS stays for MVP/speed.)

**Non-goals (now)**
- Real hand-drawn tile art. Placeholders (baked ascii/emoji) stand in until a bucket of real art exists.
- The GCS bucket itself. We only make the schema + serving *bucket-ready* (URL indirection).
- The AI sprite generator / vocabulary-contract convergence (separate, deferred track).

## 3. Target architecture

```
 nebulith (Elixir) = SOLE OWNER of tile data + art
 ┌──────────────────────────────────────────────────────────────────┐
 │ A. SOURCE (authored in Elixir data modules, seeded into tables)    │
 │      tiles:        label, glyph, emoji, color_role, blocking,      │
 │                    height, category, title  (glyph/emoji = bake    │
 │                    inputs only)                                     │
 │      compositions: name, footprint{w,h}, cells[dx,dy,level,label,  │
 │                    walkable]                                        │
 │                              │ seed                                 │
 │ B. Ecto tables  tilesets(style) ─< tiles ;  compositions ─< cells  │
 │                              │                                      │
 │ C. IMAGE BAKE  (priv/tilegen/, playwright, build-time)             │
 │      reads tile rows → renders each to a flat TINTABLE png →        │
 │      priv/static/tiles/<style>/<label>.png → writes tiles.image_url │
 │                              │                                      │
 │ D. API  GET /api/tilesets → per style: { tiles: {label →           │
 │      {image_url, blocking, height, color_role, category,title}},   │
 │      compositions: {name → {footprint, cells[]}} }                 │
 │    + static:  GET /tiles/<style>/<label>.png                       │
 └──────────────────────────────────────────────────────────────────┘
                               │  HTTP  (loader already exists)
 game-website (frontend) = PURE RENDERER
   loadTilesetsFromBackend() → holders filled from API (start EMPTY)
   render: wrap tile image_url on the cube faces (iso) / blit flat (2D,top)
           + apply colour/variant tint (compositing, not art)
   NO compositions.json · tileKinds · emojiCatalog · entityTiles ·
   tilesetSeed · gen-tileset-seeds.mjs · bundled default art
```

**Key property (why it's tractable):** the composition/stacking/selection engine is untouched.
The migration is "swap the paint source + move the data home," not an engine rewrite.

## 4. Backend data model (Ecto — "a real database of tiles")

Repurpose the existing `tilesets` table as the **style** (`ascii`, `emoji`) and hang real tiles
off it. New migrations (following the existing `create_tilesets` pattern):

- **`tilesets`** (exists) — one row per style: `key` (`"ascii"|"emoji"`), `name`.
- **`tiles`** (new) — one row per (style, label):
  `tileset_id` (FK), `label`, `glyph`, `emoji`, `color_role`, `blocking :boolean`,
  `height :integer`, `category`, `title`, **`image_url :string`** (the relocatable reference —
  `"/tiles/ascii/leaf_center.png"` today; a bucket URL later). Unique on `(tileset_id, label)`.
  `glyph`/`emoji`/`color_role` are retained as **bake inputs** so images can be regenerated.
- **`compositions`** (new) — style-agnostic (a composition references tile *labels*, resolved to a
  tile per active style): `name`, `footprint_w`, `footprint_h`.
- **`composition_cells`** (new) — `composition_id` (FK), `dx`, `dy`, `level`, `label`, `walkable`.

**Decided (approved 2026-07-14):** compositions ARE Ecto tables (`compositions` +
`composition_cells` above), for the same scalability/queryability reason tiles get tables (and
future admin editing).

**Authoring:** an Elixir data module (e.g. `Nebulith.Catalog.TileSource`) holds the canonical tile
+ composition definitions and the seed inserts/upserts them into the tables (idempotent, like the
current seeds). This is the "Data Modules + Ecto Tables" you asked for: modules author, tables store.

**Model (per MAP-MODEL §4/§8 — everything is a tile):** EVERY tile is a `tiles` row, including
terrain/ground (terrain is just another tile). A tile carries its art (`glyph`/`emoji` + optional
`image_url` + a **color**) + `category`/`title`/`blocking`/`height`. There are **no** palettes or
terrain tables and **no** residual blob — all the richer per-tile data lives in the tile's
**`settings` jsonb**: the ascii per-zone/variant palette colors (a tile's color comes from its
settings, not a shared palette), the autotile `position`, emoji `pose`/`views`, and the terrain
`char/fg/bg` variants. So the ascii `tiles` + ascii `terrain` + emoji maps all become tile rows;
`compositions` become rows; nothing tile-related stays in `tilesets.data`.

**Dev note (shared-DB caveat).** The nebulith dev DB is **shared with the game-website Prisma DB**
(`config/dev.exs`: `localhost/game_website`) — it holds saved templates/games. Do **not**
`mix ecto.reset` (it `ecto.drop`s the whole shared DB and would destroy Prisma data). Reset tile
data *safely* instead: roll back + re-run only the tile migrations (`mix ecto.rollback` to the tile
migrations) and re-seed, or truncate the `tiles`/`compositions`/`composition_cells` tables and
re-seed from the Elixir source module. Alexander said "feel free to reset it" — confirm scope, since
here "reset tiles" ≠ "drop everything." (nebulith only ever ADDS its own tables and never alters the
Prisma-owned ones.)

## 5. Image bake pipeline (placeholders, playwright + cut)

A build-time step in the **backend** repo — `nebulith/priv/tilegen/` — renders each tile to a flat
image. It is the one unavoidably-browser step; it lives in nebulith and emits only backend assets,
so the frontend still holds nothing.

- Input: the tile rows (label + glyph/emoji + color_role) — read from the DB or the source module.
- Render: a headless page lays out **all tiles as an atlas grid** (each cell = the glyph, or the
  emoji, centered on a transparent square), playwright **screenshots** it, and the script **cuts**
  the grid into per-tile PNGs — literally *"ascii images generated by us (playwright screenshots +
  cut)"*, and the same for emoji.
- **Tintable:** ascii glyphs are baked as a neutral/white mask on transparent so the engine applies
  the tile's colour and per-variant seasonal tint at draw time — seasonal forests stay free (no
  image per variant). Colour still originates from backend data (`color_role`/palette); the frontend
  only *composites* it.
- Output: `nebulith/priv/static/tiles/<style>/<label>.png`, and the pipeline writes each row's
  `image_url`.

**Bucket-ready:** because the frontend consumes `image_url` verbatim, moving art to GCS later is a
data change (rewrite the column to bucket URLs), not a code change — the reason tables were required.

## 6. Serving

- **Images:** static files under `priv/static/tiles/…`, served by Phoenix (`Plug.Static`). (Decision
  B: baked png static files.) Bucket URLs later bypass this entirely.
- **API:** `GET /api/tilesets` (endpoint exists) — extend `TilesetJSON`/`TilesetController` to build,
  per style, `{ tiles: {label → {image_url, blocking, height, color_role, category, title}},
  compositions: {name → {footprint, cells[]}} }` from the new tables (no more opaque blob). The
  existing loader (`tilesetLoader.ts` → `setAsciiTileset`/`setEmojiTileset`) adapts to the new shape.

## 7. Frontend changes (deletions + one renderer swap)

**Delete (tile art/data — must all go):**
- `src/game/data/compositions.json`, `tileKinds.json`, `emojiCatalog.json`, `entityTiles.json`,
  `tilesetSeed.json`
- `scripts/gen-tileset-seeds.mjs`
- The **bundled default art** in `src/engine/tileset/asciiTileset.ts` + `emojiTileset.ts`
  (`CELL_GLYPHS`, `COLOR_ROLE_BY_LABEL`, `POSITION_BY_LABEL`, zone palettes, and any emoji defaults).
  Keep only the in-memory holder + setter; **holders start empty** and are filled by the API.
  **DONE (2026-07-20):** `emojiTileset.ts` now initialises `EMOJI_TILESET = {}` (its ~60-entry bundled
  default is deleted), matching the already-empty `ASCII_TILESET`. There is no bundled tile data left in the
  frontend and no fallback — see §10 for the loader gate that replaced the "first-frame flash" risk.

**Renderer swap (art → image, geometry stays):**
- `drawIsoTileBlock` (`render/iso.ts`): stop drawing a glyph; draw the tile's `image_url` on the
  cube's top + two side faces, keeping the existing shape/shading/tint math.
- `render/topdown.ts` + `render/birdseye.ts`: blit the flat image (with tint) instead of the glyph.
- Add an **image preloader/cache** keyed by `image_url` (load on tileset fetch; draw a neutral
  placeholder rect until an image resolves so the first frame never blocks).
- Compositions come from the API response; `stampComposition` consumes them the same as today.

*Implementation note (from the code audit):* the frontend **already has the image path** —
`fillIsoFaceWithTile` paints an image onto cube faces and `tileImage`/`tintedImage` (in
`render/shared.ts`) load + cache + luminance-tint. So the render change is "resolve label→image and
pass it through the existing path" (+ prefix `image_url` with the backend origin), **not** a
from-scratch rewrite. The real frontend work is deleting the bundled default art (`asciiTileset.ts`
builds from `cellTileset.ts`; `emojiTileset.ts` has a hardcoded default) without breaking the derived
`EMOJI_STYLE`/catalog/ground reads.

**Unchanged:** stamping, stacking (`cellStack`), per-tile selection/picking (`isoBlocksUnder`),
collision, proximity fade, the stage generator's anchors.

## 8. Tests

Engine tests currently import the frontend `tilesetSeed.json` fixture (via
`__tests__/helpers/tilesetSeed.ts`). After the deletion:

- Replace it with a **captured `/api/tilesets` response fixture** under `src/__tests__/fixtures/`
  (clearly a test artifact — a recorded backend response — **not** shipped tile data), loaded by the
  same `useSeedTileset()` helper.
- Images are **mocked** — tests assert geometry, labels, stacking, collision, and selection, never
  pixels. `treeComposition.test.ts` et al. keep testing the block structure the API now serves.
- Add backend tests (ExUnit): the seed populates tiles/compositions; the API renders the expected
  shape; `image_url` is present and well-formed.

## 9. Migration order (each step keeps the app green)

1. **Backend model** — migrations for `tiles` / `compositions` / `composition_cells`; schemas; the
   `TileSource` data module; idempotent seed. (Old blob seed kept until step 4 cuts over.)
2. **Bake pipeline** — `priv/tilegen/` playwright script → placeholder PNGs in `priv/static/tiles/`
   + `image_url` on rows.
3. **API** — `TilesetJSON` serves the new tiles+compositions shape from the tables.
4. **Frontend render swap** — loader adapts to the new shape; renderer draws images + tint;
   preloader added. App still runs off the (now image-backed) backend.
5. **Delete frontend tile data/art** — remove the JSON files, the generator, and the bundled
   defaults; holders start empty. **DONE (2026-07-20):** the last bundled default (`EMOJI_TILESET`) is
   removed and the editor now loader-gates the render (see §10). `game/data/entityTiles.json` (baked
   entity/enemy resolution — no DB source yet) is the one remaining frontend data file, deferred.
6. **Tests** — repoint to the API fixture; add backend ExUnit tests. Full suite green.

Validation is against Alexander's running instance (per project rule): drive the real game with
Playwright and confirm the look on his server — never self-certify a headless render.

## 10. Risks

- **First-frame flash** — **SOLVED (2026-07-20) by a loader gate, not a fallback.** The frontend ships no
  bundled tile data, so there is nothing to paint before `/api/tilesets` installs. The editor renders a
  **LOADING TILES loader** (RAF paints only a plain background) until a tileset is installed, then draws the
  DB style directly; a failed load shows an **error/retry** state — never frontend tiles. Result: loader →
  correct DB style, with no wrong-style frame in between. (Per-image decode is still covered by the neutral
  placeholder in the render path; that is separate from the tileset-load gate.)
- **Ascii legibility as a flat tile** (a single glyph on a square can look sparse vs. the current
  face-drawn glyph) → tune atlas cell size / glyph scale in the bake; it's a bake-tuning knob, not
  an architecture change.
- **Fixture drift** (test fixture vs. live API) → generate the fixture from the real endpoint and
  add a backend test asserting the shape, so drift fails loudly.
- **Two-repo coordination** (schema + API + frontend shape must land together) → the phased order
  above keeps each step runnable; the shape cutover (steps 3–4) is the one lockstep change.
