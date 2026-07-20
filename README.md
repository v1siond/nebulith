# Nebulith — backend & source of truth

Nebulith is the **Elixir/Phoenix backend** for the Nebulith game engine. It is the **sole owner
of all tile data**: the tileset catalog, the compositions (trees, buildings, fountains…), default
tile animations, per-tile settings (colour, height, collision, shape), and the editor's own chrome
settings. It bakes every tile to a flat PNG and serves the catalog over a JSON API.

The [`game-website`](../game-website) frontend is a **pure renderer + editor** — it fetches the
catalog and builds maps with it, holding **no tile art and no tile data of its own**.

> **Read the docs first.** [`docs/`](docs/) is the source of truth for the model. Start with
> [`docs/MAP-MODEL.md`](docs/MAP-MODEL.md) and [`docs/TILE-BACKEND-MIGRATION.md`](docs/TILE-BACKEND-MIGRATION.md).

---

## The model

Everything on the map is a **tile** placed into a **cell** (2D, `col,row`) / **block** (3D,
`col,row,level`) — stacked like legos. A house, a road, a tree, a mountain are all just tiles in
cells/blocks; there are no special cases and no per-object drawers (units aside).

Every tile is a **baked image resolved by its label**. `ascii` and `emoji` are two *tilesets* — two
arts of the same label — so **changing the art style only reskins the map; it never restructures it.**
Tiles are **uniform**: nothing about a tile's behaviour branches on its type, category, or art style.
They differ only in **data** the tile carries — `height`, `color_role`, `blocking`, `shape`,
`settings`, default `animations` — and every consumer (editor brush, generator, the three renderers)
reads that data through one path. Collision **derives from height** uniformly (a tile above ground
blocks; a ground/flat tile is walkable), overridable per cell/block. Compositions (a tree, a
building) are simply **collections of labeled cells** stamped into the grid — the same one tile
builder projects them to all three views (ISO 3D, 2D front elevation, TOP footprint).

---

## Requirements

- **Elixir 1.20 / OTP 29** (pinned in [`.tool-versions`](.tool-versions); `mix.exs` allows `~> 1.15`)
- **PostgreSQL** — dev uses the database `game_website`, **shared with the game-website Prisma app**
  (see the caveat below)
- **Node** (for the tile bake pipeline in `priv/tilegen/`, only when regenerating tile PNGs)

## Run it

```bash
mix setup            # deps.get + ecto.setup (create, migrate, seed) + assets
mix phx.server       # or: iex -S mix phx.server
```

Dev serves on **http://localhost:4001** (`config/dev.exs` — port 4000 is taken by another local BEAM
app; production defaults `PORT` to 4000 in `config/runtime.exs`). The frontend points at
`NEXT_PUBLIC_NEBULITH_API` (default `http://localhost:4001/api`), and CORS allows any `localhost:<port>`.

`mix setup` runs the granular steps if you prefer them individually:

```bash
mix deps.get
mix ecto.setup       # ecto.create + ecto.migrate + run priv/repo/seeds.exs
```

### Seeding the catalog

`priv/repo/seeds.exs` (run by `mix setup` / `mix ecto.setup`) seeds an admin user and then calls
`Nebulith.Catalog.TileSource.seed()` — the full, **idempotent upsert** of the ascii + emoji tiles
and all compositions from the Elixir data module. Re-run any time:

```bash
mix run priv/repo/seeds.exs
```

For an incremental reseed of just the sample tiles + compositions, from IEx:

```elixir
Nebulith.Catalog.TileSource.seed_sample()   # upserts sample tiles/compositions; preserves editor-tuned poses
```

> **⚠ Never `mix ecto.reset`.** The dev DB is **shared with the game-website Prisma app** — a reset
> drops the whole `game_website` database (saved templates/games included). Nebulith only ever *adds*
> its own tables and never alters the Prisma-owned ones. To reset tile data safely, roll back +
> re-run only the tile migrations and re-seed, or truncate the `tiles`/`compositions`/
> `composition_cells` tables and re-seed. See [`docs/TILE-BACKEND-MIGRATION.md`](docs/TILE-BACKEND-MIGRATION.md) §4.

### Tests

```bash
PORT=4123 mix test   # PORT avoids a clash with a local service on the default port
mix precommit        # compile --warnings-as-errors + deps.unlock --unused + format + test
```

### Tile bake pipeline

Tile art is a **baked PNG**, not runtime-drawn. Authoring flow:

1. Author the tile in `Nebulith.Catalog.TileSource` (label, `glyph`/`emoji` as bake inputs,
   `settings.colors`, `category`, `title`, `image_url: "/tiles/<style>/<label>.png"`).
2. Add a bake entry to `priv/tilegen/tiles.json` and run `node priv/tilegen/bake.mjs`
   → writes `priv/static/tiles/<style>/<label>.png` (served by Phoenix `Plug.Static`).
3. Re-seed.

Never `image_url: nil` + a raw glyph (renders `??` on machines missing the font), and never hand-edit
tile art into a component. See [`docs/TILESET-AUTHORING.md`](docs/TILESET-AUTHORING.md).

---

## HTTP API

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/tilesets` | **The tile catalog.** Per style: `tiles: {label → {image_url, blocking, height, category, title, glyph, emoji, color_role, settings}}` + `compositions: {name → {footprint, title, cells[]}}` |
| REST | `/api/tilesets`, `/api/templates`, `/api/games` | CRUD resources (`except: [:new, :edit]`) |
| `GET` / `PUT` | `/api/editor_settings`, `/api/editor_settings/:key` | Editor chrome geometry (backend owns panel position/size) |
| `GET` | `/api/cv` | CV content for the host site |
| `GET` | `/tiles/<style>/<label>.png` | Baked tile images (static) |
| `GET` | `/` · `/admin` · `/dev/dashboard` | Home · admin (auth) · LiveDashboard (dev only) |

The `/api/tilesets` shape is built by `NebulithWeb.TilesetJSON` — `zIndex` (from the `z_index`
column) and `animations`/`settings` are camelCased/omitted-when-empty so the frontend maps them
straight onto each cell.

## Key modules

| Module | Responsibility |
|--------|----------------|
| `Nebulith.Catalog` | The context — tilesets, tiles, compositions, templates (`list_tilesets`, `list_tiles_for`, `list_compositions`, `upsert_tile`, `upsert_composition_with_cells`, `set_tile_height`/`set_tile_category`) |
| `Nebulith.Catalog.TileSource` | **The authored source of truth** — the Elixir data module that defines every tile + composition and seeds them (`seed/0`, `seed_sample/0`, height/category reconcilers) |
| `Nebulith.Catalog.Tile` | A tile row: `label`, `glyph`, `emoji`, `color_role`, `blocking`, `height`, `category`, `title`, `image_url`, `settings` (jsonb); unique on `(tileset_id, label)` |
| `Nebulith.Catalog.Composition` / `.CompositionCell` | A composition = `footprint_w/h` + `title`; cells = `{dx, dy, level, label, walkable, scale, z_index, animations, settings}` |
| `Nebulith.Catalog.BuildingCompositions` | Baked building-composition definitions (walls/windows/doors/roof cells) |
| `Nebulith.Editor` / `.Setting` | Editor UI chrome — a key→value settings store |
| `NebulithWeb.TilesetController` + `TilesetJSON` | Serves `/api/tilesets` |
| `NebulithWeb.EditorSettingController` | Serves `/api/editor_settings` |
| `priv/tilegen/bake.mjs` + `tiles.json` | The tile → PNG bake pipeline |

---

## Documentation

`docs/` is the canonical spec set for the whole engine (the `game-website` repo mirrors the model docs).

| Doc | What it covers |
|-----|----------------|
| [`MAP-MODEL.md`](docs/MAP-MODEL.md) | **Start here.** The cell/block/tile model, the three views, height→collision, `shape`, the tile pipeline |
| [`TILE-VOCABULARY-CONTRACT.md`](docs/TILE-VOCABULARY-CONTRACT.md) | The `<base>_<edge>` tile naming and the vocabularies to converge on |
| [`TILESET-AUTHORING.md`](docs/TILESET-AUTHORING.md) | How to author tiles, autotiling pieces, and compositions the right way |
| [`TILE-BACKEND-MIGRATION.md`](docs/TILE-BACKEND-MIGRATION.md) | Why/how the backend owns all tile data; the Ecto model, bake, and serving contract |
| [`NEBULITH-SOURCE-OF-TRUTH.md`](docs/NEBULITH-SOURCE-OF-TRUTH.md) | The wider system map and roadmap (predates the backend split — read for vision, not current layout) |
| [`EDITOR-INTERACTION-SPEC.md`](docs/EDITOR-INTERACTION-SPEC.md) | The editor interaction model the frontend implements |
| [`ANIMATION-SYSTEM.md`](docs/ANIMATION-SYSTEM.md) | The tile animation envelope + z-index draw priority |
| [`LIGHTING.md`](docs/LIGHTING.md) | The day/night lighting model |
| [`GENERATION-SPEC.md`](docs/GENERATION-SPEC.md) | The layer-pass stage/town generator + scoped randomize |
| [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`FEATURES.md`](docs/FEATURES.md) · [`ENGINE-ARCHITECTURE.md`](docs/ENGINE-ARCHITECTURE.md) · [`ALGORITHMS.md`](docs/ALGORITHMS.md) · [`GAPS-AND-ROADMAP.md`](docs/GAPS-AND-ROADMAP.md) · [`COMBAT-AND-SYSTEMS-SPEC.md`](docs/COMBAT-AND-SYSTEMS-SPEC.md) · [`TRIGGERS-SPEC.md`](docs/TRIGGERS-SPEC.md) | System architecture, feature flows, the game layer, generator algorithms, and roadmap |

## Contributing

- **The backend owns all tile/composition/animation data.** Author tiles in `TileSource` (Elixir) and
  seed — never hardcode tile art or tile data in the frontend.
- **Keep tiles uniform.** No branch on tile type/category/art style in the insert/height/collision
  path; a tile differs only by its DATA. Add a capability as one map entry, not an `if` (SOLID/OCP).
- Follow the senior engineering bar: guard clauses over nesting, dispatch maps over long conditionals,
  small focused modules, explicit errors, behaviour-tested code. `AGENTS.md` has the fuller house
  rules; run `mix precommit` before pushing.
