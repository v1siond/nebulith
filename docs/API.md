# nebulith HTTP API reference

The complete served API of the nebulith Elixir/Phoenix backend, as it actually behaves.

**No API doc existed before this file.** `docs/` had endpoint mentions scattered across
`TILE-BACKEND-MIGRATION.md` (§11 covers `GET /api/entities`), `GENERATION-SPEC.md` (line 70,
`GET /api/generators`), `EDITOR-INTERACTION-SPEC.md` (line 161, `editor_settings`), `MAP-MODEL.md`
(line 322) and `ARCHITECTURE.md` §1.6, but no single reference. Those sections stay authoritative for
*why* a payload is shaped the way it is. This file is the *what*: routes, shapes, types, status codes.

## How this document was produced

Every wire claim below was taken from a live capture against a running server on
**2026-09-12** (`date: Sat, 12 Sep 2026 19:12:34 GMT`, `x-request-id: GNSon6Iae3VQ9YoAA3KB`),
not from reading the JSON views. Every backend claim cites `file:line`. Where a shape could only be
established from code (because exercising it would create or destroy a row), it is marked
**UNVERIFIED (wire)** and the reason is given. See [§17](#17-unverified) for the full list.

---

## Table of contents

1. [Overview](#1-overview)
   - [1.1 Base URL and port](#11-base-url-and-port)
   - [1.2 Auth](#12-auth)
   - [1.3 CORS](#13-cors)
   - [1.4 Response envelope conventions](#14-response-envelope-conventions)
   - [1.5 Error conventions](#15-error-conventions)
   - [1.6 Route inventory](#16-route-inventory)
2. [`/api/tilesets`](#2-apitilesets)
3. [`/api/templates`](#3-apitemplates)
4. [`/api/games`](#4-apigames)
5. [`/api/games/:game_id/levels` and `/api/levels`](#5-apigamesgame_idlevels-and-apilevels)
6. [`/api/generators`](#6-apigenerators)
7. [`/api/buildings`](#7-apibuildings)
8. [`/api/ui`](#8-apiui)
9. [`/api/entities`](#9-apientities)
10. [`/api/combat`](#10-apicombat)
11. [`/api/zones`](#11-apizones)
12. [`/api/items`](#12-apiitems)
13. [`/api/abilities`](#13-apiabilities)
14. [`/api/editor_settings`](#14-apieditor_settings)
15. [`/api/cv`](#15-apicv)
16. [Observed inconsistencies](#16-observed-inconsistencies)
17. [UNVERIFIED](#17-unverified)

---

## 1. Overview

### 1.1 Base URL and port

`http://localhost:6328/api`

The port has one owner: `config/runtime.exs:29`.

```elixir
http: [port: String.to_integer(System.get_env("PORT") || "6328")]
```

`config/runtime.exs:23` states this is the single source of truth for the HTTP port in every
environment, and `config/dev.exs:23` deliberately sets no port so it cannot compete.

The frontend reads the base URL from the environment, `src/lib/nebulithApi.ts:12-13`:

```ts
export const NEBULITH_API =
  process.env.NEXT_PUBLIC_NEBULITH_API ?? 'http://localhost:6328/api'
```

Set `NEXT_PUBLIC_NEBULITH_API=http://localhost:6328/api` in `game-website/.env.local`. The literal
default is the last-resort value for a checkout with no `.env.local`, and the comment at
`nebulithApi.ts:10-11` notes it has to stay in step with nebulith's own default. Note that the
constant includes the `/api` suffix, so every call site concatenates a bare resource path
(`` `${NEBULITH_API}/tilesets` ``).

### 1.2 Auth

**There is no authentication or authorisation on any `/api` route.** The `:api` pipeline is
`plug :accepts, ["json"]` and nothing else (`router.ex:13-15`), and the `/api` scope pipes through
only that (`router.ex:33-34`).

`NebulithWeb.AdminAuth` (HTTP Basic Auth against the `admin_users` table) exists but is wired only
to the `/admin` browser scope, `router.ex:27-31`. It never runs for `/api`.

Consequences worth knowing before exposing this anywhere: any client can read and write every
template, game, level, tileset and UI profile. `Template.authorId` is a plain string with no relation
behind it and `isPublic` is never consulted by any route, which `ARCHITECTURE.md:106-109` also
records.

### 1.3 CORS

`lib/nebulith_web/endpoint.ex:30`:

```elixir
plug CORSPlug, origin: [~r/^http:\/\/localhost:\d+$/]
```

Any `http://localhost:<port>` origin is allowed. The plug sits above `Plug.Static` on purpose
(`endpoint.ex:18-29`): the baked tile PNGs must carry CORS headers too, because a cross-origin image
drawn into a canvas taints it and makes `getImageData`/`toDataURL` throw. The frontend's half of that
contract is `crossOrigin = 'anonymous'` on the tile images.

Measured behaviour:

| Request | Result |
|---|---|
| `GET /api/zones` with `Origin: http://localhost:3000` | `200`, `access-control-allow-origin: http://localhost:3000` |
| `GET /api/zones` with `Origin: https://evil.example` | `200`, **no** `access-control-allow-origin` header |
| `OPTIONS /api/ui` with `Origin: http://localhost:3000` | `204`, `allow-methods: GET,POST,PUT,PATCH,DELETE,OPTIONS`, `max-age: 1728000` |
| `GET /tiles/ascii/adobe.png` with `Origin: http://localhost:3000` | `200`, `access-control-allow-origin` present, `content-type: image/png` |

A disallowed origin is **not** rejected server-side. It gets a normal `200` with the body, and the
header is simply absent, so it is the browser that blocks the read. Anything that is not a browser
ignores CORS entirely.

### 1.4 Response envelope conventions

The API uses **three different envelopes**, and which one you get is per endpoint, not per verb.
This is factual, not a recommendation.

| Endpoint | Top-level keys (live) | Envelope |
|---|---|---|
| `GET /api/tilesets` | `["data"]` | wrapped |
| `GET /api/entities` | `["data"]` | wrapped |
| `GET /api/combat` | `["data"]` | wrapped |
| `GET /api/zones` | `["data"]` | wrapped |
| `GET /api/ui` | `["data"]` | wrapped |
| `GET /api/generators` | `["data"]` | wrapped |
| `GET /api/buildings` | `["data"]` | wrapped |
| `GET /api/items` | `["data"]` | wrapped |
| `GET /api/abilities` | `["data"]` | wrapped |
| `GET /api/games/:id/levels` | `["data"]` | wrapped |
| `GET /api/templates` | `["limit","offset","templates","total"]` | custom |
| `GET /api/games` | `["games"]` | custom |
| `GET /api/editor_settings` | `["editorSettings"]` | custom |
| `GET /api/templates/:id` | the record's own fields | **bare object** |
| `GET /api/games/:id` | the record's own fields | **bare object** |
| `GET /api/levels/:id` | the record's own fields | **bare object** |
| `GET /api/cv` | the payload's own fields | **bare object** (currently 500, see §15) |

So a collection is wrapped in `data` except for templates, games and editor settings, and a single
record is wrapped in `data` for tilesets but bare for templates, games and levels. Two consumers
defend against this by accepting either form (see §2 and §9).

### 1.5 Error conventions

Three distinct error paths are in play.

**1. `FallbackController`, the only structured one** (`lib/nebulith_web/controllers/fallback_controller.ex`).
Controllers that declare `action_fallback NebulithWeb.FallbackController` get:

- `{:error, %Ecto.Changeset{}}` becomes `422 Unprocessable Entity` with
  `%{errors: traverse_errors(...)}` (`fallback_controller.ex:10-15`, `changeset_json.ex:5-9`)
- `{:error, :not_found}` becomes `404` with `%{errors: %{detail: "Not Found"}}`
  (`fallback_controller.ex:18-23`, `error_json.ex:18-20`)

Declared by: `TilesetController:7`, `TemplateController:12`, `GameController:8`, `LevelController:15`,
`GeneratorController:11`, `BuildingController:22`, `EditorSettingController:12`. **Not** declared by
`EntityController`, `CombatController`, `ZoneController`, `UiController`, `ItemController`,
`AbilityController`, `CVController` (those are read-only over seeded data and raise instead).

Live confirmations:

```
POST /api/templates  {}  -> 422 {"errors":{"name":["can't be blank"],"assetsData":["can't be blank"],
                                            "groundData":["can't be blank"],"heightData":["can't be blank"]}}
POST /api/games      {}  -> 422 {"errors":{"name":["can't be blank"]}}
POST /api/games/:id/levels {} -> 422 {"errors":{"name":["can't be blank"]}}
GET  /api/templates/999999    -> 404 {"errors":{"detail":"Not Found"}}
GET  /api/buildings/not_a_building -> 404 {"errors":{"detail":"Not Found"}}
```

**2. Raised Ecto exceptions, which are not JSON.** Where a context uses a bang function or casts a
malformed id, the exception escapes and Phoenix renders its debug error page (HTML, in dev):

| Request | Status | Exception |
|---|---|---|
| `GET /api/tilesets/999999` | `404` | `Ecto.NoResultsError` (from `Catalog.get_tileset!/1`, `catalog.ex:43`) |
| `GET /api/games/999999` | `400` | `Ecto.Query.CastError` (`"999999"` is not a `:binary_id`) |
| `GET /api/levels/999999` | `400` | `Ecto.Query.CastError` |
| `GET /api/ui?game=does-not-exist` | `400` | `Ecto.Query.CastError` at `ui_source.ex:393` |
| `POST /api/tilesets` without the `tileset` wrapper | `400` | `Phoenix.ActionClauseError` |
| `PUT /api/editor_settings/:key` without a `value` key | `400` | `Phoenix.ActionClauseError` |

So `404` for a missing template is clean JSON, while `404` for a missing tileset and `400` for a
malformed uuid are HTML error pages. In production these become the generic
`{"errors":{"detail":...}}` from `ErrorJSON.render/2`, which returns the status message derived from
the template name (`error_json.ex:18-20`).

**3. No route.** `GET /api/editor_settings/nope` is `404 Phoenix.Router.NoRouteError`: only `index`
and `PUT :key` exist for that resource (`router.ex:68-69`).

### 1.6 Route inventory

**34 routes across 14 controllers**, all from `router.ex:33-71`. `resources` macros expand to both
`PATCH` and `PUT` for update.

| # | Method | Path | Controller action | §|
|---|---|---|---|---|
| 1 | GET | `/api/tilesets` | `TilesetController:9` | [2](#2-apitilesets) |
| 2 | POST | `/api/tilesets` | `TilesetController:18` | 2 |
| 3 | GET | `/api/tilesets/:id` | `TilesetController:27` | 2 |
| 4 | PATCH / PUT | `/api/tilesets/:id` | `TilesetController:32` | 2 |
| 5 | DELETE | `/api/tilesets/:id` | `TilesetController:40` | 2 |
| 6 | GET | `/api/templates` | `TemplateController:14` | [3](#3-apitemplates) |
| 7 | POST | `/api/templates` | `TemplateController:22` | 3 |
| 8 | GET | `/api/templates/:id` | `TemplateController:30` | 3 |
| 9 | PATCH / PUT | `/api/templates/:id` | `TemplateController:36` | 3 |
| 10 | DELETE | `/api/templates/:id` | `TemplateController:43` | 3 |
| 11 | GET | `/api/games` | `GameController:10` | [4](#4-apigames) |
| 12 | POST | `/api/games` | `GameController:14` | 4 |
| 13 | GET | `/api/games/:id` | `GameController:12` | 4 |
| 14 | PATCH / PUT | `/api/games/:id` | `GameController:22` | 4 |
| 15 | DELETE | `/api/games/:id` | `GameController:30` | 4 |
| 16 | GET | `/api/games/:game_id/levels` | `LevelController:17` | [5](#5-apigamesgame_idlevels-and-apilevels) |
| 17 | POST | `/api/games/:game_id/levels` | `LevelController:26` | 5 |
| 18 | PUT | `/api/games/:game_id/levels/order` | `LevelController:49` | 5 |
| 19 | GET | `/api/levels/:id` | `LevelController:20` | 5 |
| 20 | PATCH / PUT | `/api/levels/:id` | `LevelController:34` | 5 |
| 21 | DELETE | `/api/levels/:id` | `LevelController:41` | 5 |
| 22 | GET | `/api/generators` | `GeneratorController:13` | [6](#6-apigenerators) |
| 23 | GET | `/api/buildings` | `BuildingController:24` | [7](#7-apibuildings) |
| 24 | GET | `/api/buildings/:type` | `BuildingController:36` | 7 |
| 25 | GET | `/api/ui` | `UiController:12` | [8](#8-apiui) |
| 26 | PUT | `/api/ui` | `UiController:23` | 8 |
| 27 | GET | `/api/entities` | `EntityController:12` | [9](#9-apientities) |
| 28 | GET | `/api/combat` | `CombatController:12` | [10](#10-apicombat) |
| 29 | GET | `/api/zones` | `ZoneController:7` | [11](#11-apizones) |
| 30 | GET | `/api/items` | `ItemController:10` | [12](#12-apiitems) |
| 31 | GET | `/api/abilities` | `AbilityController:6` | [13](#13-apiabilities) |
| 32 | GET | `/api/editor_settings` | `EditorSettingController:14` | [14](#14-apieditor_settings) |
| 33 | PUT | `/api/editor_settings/:key` | `EditorSettingController:16` | 14 |
| 34 | GET | `/api/cv` | `CVController:10` | [15](#15-apicv) |

Also served outside `/api`: `GET /` (`PageController`), `GET /admin` (Basic Auth), `/dev/dashboard`
(LiveDashboard, dev only), and the static tile PNGs under `/tiles/**` via `Plug.Static`.

---

## 2. `/api/tilesets`

The largest and most important payload in the system: the art. Everything the renderer draws is a
baked backend image resolved by label, so a cold editor cannot draw a frame until this lands.

- **Controller** `lib/nebulith_web/controllers/tileset_controller.ex`
- **View** `lib/nebulith_web/controllers/tileset_json.ex`
- **Contexts** `Catalog.list_tilesets/0` (`catalog.ex:23`), `Catalog.list_tiles_for/1`
  (`catalog.ex:165`), `Catalog.list_compositions/0` (`catalog.ex:270`)
- **Schemas** `Catalog.Tileset` (`tileset.ex`), `Catalog.Tile` (`tile.ex`),
  `Catalog.Composition` (`composition.ex`), `Catalog.CompositionCell` (`composition_cell.ex`)
- **Consumed by** `src/engine/tileset/tilesetLoader.ts:192` (`loadTilesetsFromBackend`) and
  `:222` (`saveTilesetToBackend`)

### 2.1 `GET /api/tilesets`

No path or query params. `TilesetController:9-16` builds one entry per tileset, each carrying that
style's tiles, and attaches the style-agnostic composition set to every entry.

**Live counts:** 2 tilesets, `374` tiles each, `40` compositions each, `779` composition cells each.
`416988` bytes. Ordering is `position` then `key` (`catalog.ex:23-27`), so ascii comes first because
it is the editor's default.

Envelope: `{"data": [ <tileset row>, ... ]}` (`tileset_json.ex:7-9`).

#### Tileset row (`data_with_tiles/3`, `tileset_json.ex:29-40`)

| Field | Type | Live value (row 0) | Meaning |
|---|---|---|---|
| `id` | integer | `1` | Primary key. Needed for `PUT /api/tilesets/:id`. |
| `key` | string | `"ascii"` | The style id. A tileset row **is** an art style. |
| `name` | string | `"ASCII"` | Display name for the style picker. |
| `icon` | string | `"⌨"` | Affordance icon for the style picker. Exists so the frontend does not declare the style list itself (`tileset.ex:8-11`). |
| `position` | integer | `1` | Picker order. ascii `1`, emoji `2`. |
| `data` | map or null | `null` | The legacy blob. `tile_source.ex:14-15` notes it is left untouched by the seed. Both rows serve `null`. |
| `tiles` | object | 374 entries | Label to tile object. |
| `compositions` | object | 40 entries | Name to composition object. Identical set on every row. |

The two live rows: `{key: "ascii", name: "ASCII", icon: "⌨", position: 1}` and
`{key: "emoji", name: "Emoji", icon: "😀", position: 2}`.

#### One tile, exhaustively

`tiles` is keyed by label, so `data[0].tiles["adobe"]` is one tile. Produced by `tile_data/1`
(`tileset_json.ex:42-54`). Live, verbatim:

```json
{
  "title": "Adobe",
  "category": "terrain",
  "settings": {
    "variants": {
      "bg": ["rgba(160, 120, 80, 0.95)", "rgba(150, 110, 75, 0.92)"],
      "char": ["▓", "▒"],
      "fg": ["rgba(200, 160, 120, 0.90)", "rgba(190, 150, 110, 0.88)"]
    }
  },
  "height": 0.0,
  "glyph": "▚",
  "image_url": "/tiles/ascii/adobe.png",
  "blocking": false,
  "color_role": null,
  "emoji": null
}
```

Every tile carries exactly these nine keys, no more and no fewer (verified across all 748 tile
objects in both styles).

| Field | Type | Meaning and measured distribution |
|---|---|---|
| `image_url` | string, never null | The baked PNG, server-relative. `/tiles/<style>/<label>.png`. This is the render source of truth: art is an image, not a glyph. |
| `blocking` | boolean | Collision. `73` of 374 true, in **both** styles. Note the frontend inverts it, see §16.6. |
| `height` | float | Block height. Live: `0.0` for 186 tiles, `1.0` for 184, `0.5` for 4, per style. |
| `category` | string or null | Sidebar bucket. `null` on 53 tiles per style. Live values per style: `units` 79, `terrain` 77, `null` 53, `nature` 40, `walls` 38, `props` 26, `floors` 21, `roofs` 12, `roads` 12, `decor` 11, `windows` 3, `doors` 2. |
| `title` | string or null | Human label. `null` on 63 (ascii) and 64 (emoji) tiles. |
| `glyph` | string or null | The ascii character. Non-null on all 374 ascii tiles and on 8 emoji tiles. |
| `emoji` | string or null | The source emoji. Non-null on all 374 emoji tiles and on 8 ascii tiles. |
| `color_role` | string or null | Named colour slot the tint resolves through. |
| `settings` | object | Open per-tile jsonb. Empty `{}` on 3 ascii tiles and 0 emoji tiles. |

`settings` is where every extra per-tile fact lives, by design: `tile_source.ex:6-11` states there
are no palette or terrain side tables. Keys observed live across all tiles, with types:

| Key | Type | Meaning (source) |
|---|---|---|
| `variants` | object | Terrain `char`/`fg`/`bg` arrays. The ground index is built from these (`tilesetLoader.ts:130`). |
| `display` | string | Where the tile is painted on its block. Absent means `"all-faces"` (the default). `"single"` is one centred tile inside the block volume (`tile_source.ex:36-43`). |
| `transparent` | boolean | Block body is not drawn. Paired with `display: "single"` on every flower (`tile_source.ex:73-83`). |
| `fadeNear` | boolean | Eases translucent as the player approaches. On wall, window, door, storefront glass, awning (`tile_source.ex:44-69`). |
| `cutawayRoof` | boolean | Lifts off or hides entirely so interiors are visible. On roof, roof_top, flat_roof, parapet, rooftop_unit. |
| `minAlpha` | float | Floor the reveal may never take the tile below. `0.9` on door, so a door stays obvious while its wall fades (`tile_source.ex:47-49`). |
| `scaleZ` | float | Thickness. `0.3` on door: a thin panel, not a full cube. Distinct from `depth`, which counts cells. |
| `thicknessDir` | string | Which world axis it is thin along. `"left-down"` is the +row axis, the authored building front (`tile_source.ex:54-58`). |
| `pose` | object | Per-tile draw offsets. |
| `position` | string | Autotile piece role. Read as `?? 'single'` by the loader. |
| `color`, `colors` | string, object | Tint values. |
| `combat` | object | A hostile unit's stat block. Creature stats ride on the tile, not on `/api/combat` (`combat_controller.ex:4-6`). |
| `unitRole` | string | What kind of unit the tile is. |
| `artFrames` | list | Composed ascii art rows: a unit is a grid of characters baked to a PNG. |
| `frames`, `frameMs`, `animations` | list, integer, list | Animation source frames and timing. |
| `scaleX`, `scaleY` | float | Per-axis stretch. |

#### One composition, exhaustively

`compositions` is keyed by name. Produced by `comp_data/1` (`tileset_json.ex:56-69`). A composition
is a pre-built multi-cell object (a building, a tree, a bridge) stamped as per-cell tiles.

```json
{
  "title": null,
  "category": "props",
  "footprint": { "w": 3, "h": 3 },
  "cells": [
    { "label": "post",   "level": 0, "scale": 1.0, "dx": 0, "dy": 0, "walkable": false, "zIndex": 0,
      "settings": { "scaleY": 1.15, "scaleZ": 0.3 } },
    { "label": "bridge", "level": 0, "scale": 1.0, "dx": 0, "dy": 1, "walkable": true,  "zIndex": 0 },
    { "label": "post",   "level": 0, "scale": 1.0, "dx": 0, "dy": 2, "walkable": false, "zIndex": 0,
      "settings": { "scaleY": 1.15, "scaleZ": 0.3 } }
  ]
}
```

| Field | Type | Meaning |
|---|---|---|
| `footprint` | `{w, h}` integers | Grid size, south-facing. Rotation to face a road happens at stamp time in the frontend, so only one facing is stored (`building_compositions.ex:10-12`). |
| `title` | string or null | Apex signage. Only store and hospital carry one, so houses show no badge (`composition.ex:9-10`, `building_compositions.ex:62-64`). |
| `category` | string or null | Sidebar bucket, the **same** vocabulary a tile's `category` uses, so the palette groups compositions exactly like tiles instead of deriving a group from names (`composition.ex:12-14`). |
| `cells` | array | The tiles, sorted by `(dx, dy, level, label)`. |

Cell ordering is deliberate. `tileset_json.ex:63-66` explains the DB heap order is unstable because
a reseed reuses tuple slots, so the sort makes the payload reproducible. The render is
order-independent, so the sort stabilises the data only, not the look.

Cell fields (`cell_data/1`, `tileset_json.ex:75-81`):

| Field | Type | Always present | Meaning |
|---|---|---|---|
| `dx`, `dy` | integer | yes | Cell offset within the footprint. |
| `level` | integer | yes | Stack height, 0 at the ground. |
| `label` | string | yes | Which tile goes in this cell. |
| `walkable` | boolean | yes | Per-cell collision. A wall blocks, a door or interior does not. |
| `scale` | float | yes | Uniform draw zoom, so one cell can hold a tile bigger than one block. A tree canopy is one leaf cell at scale 2, not a nine-slice ring (`composition_cell.ex:11-14`). |
| `zIndex` | integer | yes | Draw priority, CSS style: higher renders later and overrides the positional depth sort. A fountain's water reads in front of the wall behind it (`composition_cell.ex:15-19`). |
| `animations` | array | **conditional** | Default animation envelopes. Omitted when the cell has none (`maybe_put_animations/2`, `tileset_json.ex:83-85`), so non-animated cells serve byte-identically to before the feature. |
| `settings` | object | **conditional** | Tuned per-cell tile overrides, camelCase, passed through verbatim. Omitted when absent (`maybe_put_settings/2`, `tileset_json.ex:90-91`). The lamp post cell stretches tall and thin, the bulb cell is a billboard lifted onto it (`composition_cell.ex:26-31`). |

### 2.2 `GET /api/tilesets/:id`

Path param `id`, integer. Renders `data/1` (`tileset_json.ex:18-27`), which is **not** the same
projection as index: no `tiles`, no `compositions`.

```
GET /api/tilesets/1  ->  200
{"data":{"data":null,"id":1,"name":"ASCII","position":1,"key":"ascii","icon":"⌨"}}
```

`GET /api/tilesets/999999` is `404 Ecto.NoResultsError` (HTML in dev) because the controller uses
`Catalog.get_tileset!/1` (`tileset_controller.ex:28`, `catalog.ex:43`).

### 2.3 `POST /api/tilesets`

Body must be wrapped: `{"tileset": {...}}` (`tileset_controller.ex:18`). Castable fields are
`key`, `name`, `icon`, `position`, `data`; `key` and `name` are required and `key` is unique
(`tileset.ex:19-24`).

On success: `201 Created`, a `location` header pointing at the new resource, body `{"data": ...}`
from `data/1` (`tileset_controller.ex:20-23`). **UNVERIFIED (wire):** not exercised, it would insert
a row. Sending an unwrapped body is `400 Phoenix.ActionClauseError` (verified).

Invalid params return `422` with `{"errors": {...}}` via the fallback.

### 2.4 `PATCH` / `PUT /api/tilesets/:id`

Body `{"tileset": {...}}`. Renders `data/1` on success (`tileset_controller.ex:32-38`).

This is the one tileset write the frontend performs, `tilesetLoader.ts:222-223`, and it writes only
the legacy blob:

```ts
body: JSON.stringify({ tileset: { data } })
```

The `id` comes from a load-time cache populated during `loadTilesetsFromBackend`
(`tilesetLoader.ts:63`, `:168`), so a save is impossible before a successful load.

**UNVERIFIED (wire):** not exercised, it would mutate the live tileset blob.

### 2.5 `DELETE /api/tilesets/:id`

`204 No Content` with an empty body on success (`tileset_controller.ex:44`). This is the **only**
delete in the API that does not return a JSON body, see §16.3. No frontend call site exists.

**UNVERIFIED (wire):** destructive, not exercised.

### 2.6 How the frontend reads it

`tilesetLoader.ts:194-195` tolerates either envelope:

```ts
const body = (await res.json()) as { data?: ApiTileset[] } | ApiTileset[]
const list = Array.isArray(body) ? body : (body.data ?? [])
```

It then renames on the way in (`toStyleTile`, `tilesetLoader.ts:94-113`):

| Wire | Internal |
|---|---|
| `image_url` | `image`, absolutised against the API origin |
| `glyph` or `emoji` | `char` |
| `color_role` | `colorRole` |
| `blocking` | `walkable`, **inverted** |
| `settings.color` | `color` |
| `settings.position` | `position`, defaulting to `'single'` |
| `key` | `id` (style list, `:165`) |

There is no bundled fallback. On failure the loader returns `[]` and the editor stays on the
loader or error state (`tilesetLoader.ts:208-211`).

---

## 3. `/api/templates`

A template is a saved map or stage. This is the CRUD the editor's gallery and save flow run on.

- **Controller** `lib/nebulith_web/controllers/template_controller.ex`
- **View** `lib/nebulith_web/controllers/template_json.ex`
- **Context** `Catalog.list_templates/3` (`catalog.ex:117`), `Catalog.get_template/1` (`catalog.ex:136`)
- **Schema** `Catalog.Template` (`template.ex`)
- **Consumed by** `src/lib/api.ts:125` (base), `:137` list, `:145` get, `:169` create, `:184` update, `:196` delete

`TemplateController:2-6` states the shapes exist to match what `src/lib/api.ts` already expected, so
the frontend only had to change its base URL. That is why this endpoint does not use the `data`
envelope.

The schema maps a pre-existing table created by the frontend's old Prisma migrations, so the table
name is `"Template"` and its columns are Prisma's camelCase identifiers, Postgres-quoted
(`template.ex:2-7`). The primary key is a **text** id, not a uuid, and timestamps are camelCase
naive datetimes (`template.ex:11`, `:36`).

### 3.1 `GET /api/templates`

Query params (`template_controller.ex:14-20`):

| Param | Type | Default | Behaviour |
|---|---|---|---|
| `category` | string | none | Filters. Blank string is coerced to nil, so `?category=` is the same as omitting it (`blank_to_nil/1`, `:50-52`). |
| `limit` | integer | `50` | Unparseable values fall back to the default (`to_int/2`, `:54-64`). |
| `offset` | integer | `0` | Same coercion. |

Verified live (1 template in the DB):

```
?limit=1            -> total=1 limit=1  offset=0 rows=1
?limit=1&offset=5   -> total=1 limit=1  offset=5 rows=0
?category=custom    -> total=1 limit=50 offset=0 rows=1
?category=nope      -> total=0 limit=50 offset=0 rows=0
?limit=abc          -> total=1 limit=50 offset=0 rows=1   (fell back to 50)
```

Note `total` respects the category filter but not limit or offset, and the echoed `limit`/`offset`
are the coerced values actually used.

Envelope, `template_json.ex:8-15`:

```json
{ "templates": [ ... ], "total": 1, "limit": 50, "offset": 0 }
```

**The list projection is deliberately light**: `groundData`, `heightData` and `assetsData` are
omitted because they are heavy grid blobs (`template_json.ex:4-7`, `list_item/1` at `:20-37`).

| Field | Type | Live |
|---|---|---|
| `id` | string | `"e5d08ef0-46f4-4050-a2f4-473158089949"` |
| `name` | string | `"Level 1"` |
| `description` | string or null | `null` |
| `category` | string | `"custom"` |
| `cols`, `rows` | integer | `40`, `40` |
| `thumbnail` | string or null | `null` |
| `isPublic` | boolean | `false` |
| `tags` | array of string | `[]` |
| `connectors` | array | `[]` |
| `entities` | array | populated, see below |
| `quests` | array | `[]` |
| `createdAt`, `updatedAt` | naive datetime string | `"2026-09-12T19:08:55"` (no timezone suffix) |

`entities` is present even in the light projection and can be large: the live row's entity carries a
full animation set (`char-idle`, `char-walk-up/down/left/right`, `char-run-*`), each with
`durationMs`, `loop`, `loopDelayMs`, `direction`, `trigger` and `frames` referencing tiles like
`emoji:walk`. The whole list response is `12785` bytes for a single template.

### 3.2 `GET /api/templates/:id`

Renders `full/1` (`template_json.ex:39-65`): the complete record including the grid blobs, as a
**bare object with no envelope**. Verified live, 23 top-level keys.

Adds to the list projection: `cellSize` (integer), `isoScale` (float), `slabBlocks` (integer),
`spawnCol`, `spawnRow` (integer), `groundData`, `heightData`, `assetsData` (arrays), `authorId`
(string or null).

Field meanings from `template.ex`:

| Field | Default | Meaning |
|---|---|---|
| `cols`, `rows` | `50`, `50` | Grid extent. |
| `cellSize` | `16` | Pixel size of a cell. |
| `isoScale` | `2.5` | Isometric scale factor. |
| `slabBlocks` | `1` | How thick the map's own body is, in blocks. The fourth number describing a map's shape alongside cols, rows and cellSize (`template.ex:20-22`). |
| `spawnCol`, `spawnRow` | `25`, `25` | Player start cell. |
| `groundData`, `heightData`, `assetsData` | required | The three grid layers, inline JSON via `Nebulith.EctoJSON`. |
| `connectors`, `entities`, `quests` | `[]` | Inline JSON, not normalised. |
| `authorId` | null | A plain string. The Prisma `User` table went with Prisma, so there is no relation to enforce (`ARCHITECTURE.md:108-109`). |

`404` is clean JSON here, because the controller uses the non-raising `Catalog.get_template/1`
(`template_controller.ex:31`) which returns `{:error, :not_found}` for the fallback to translate.

### 3.3 `POST /api/templates`

Flat body, no wrapper (`template_controller.ex:22-28`). Castable fields are the 21 listed at
`template.ex:39-41`. Required: `id`, `name`, `groundData`, `heightData`, `assetsData`
(`template.ex:47`). `catalog.ex:143` notes a text id is generated when the caller supplies none.

Success is `201 Created` with the full bare object. Verified failure: `422` listing all four missing
required fields (note `id` is absent from that list because it is generated).

### 3.4 `PATCH` / `PUT /api/templates/:id`

Partial update: only supplied keys change (`catalog.ex:152`). Returns the full bare object. The
frontend uses `PUT` (`api.ts:184-187`).

### 3.5 `DELETE /api/templates/:id`

Returns `200` with `{"success": true, "id": "<id>"}` (`template_controller.ex:46`), not `204`.

---

## 4. `/api/games`

A game is a named, ordered flow of templates (`game_controller.ex:2`). The `GameController` moduledoc
states it accepts and returns camelCase JSON.

- **Controller** `lib/nebulith_web/controllers/game_controller.ex`
- **View** `lib/nebulith_web/controllers/game_json.ex`
- **Context** `Nebulith.Games` (`games.ex`): `list_games/0:12`, `get_game!/1:17`, `create_game/1:25`, `update_game/2:33`, `delete_game/1:41`, `set_templates/2:46`
- **Schema** `Games.Game` (`game.ex`)
- **Consumed by** `src/lib/api.ts:219` (base), `:222` list, `:229` get, `:240` create, `:253` update, `:263` delete

### 4.1 `GET /api/games`

No params. Envelope `{"games": [...]}` (`game_json.ex:4`). **17 games live.** Ordered by name
(`games.ex:11`).

Row (`data/1`, `game_json.ex:8-16`):

| Field | Type | Live | Meaning |
|---|---|---|---|
| `id` | uuid string | `"97829bd2-78fa-4d8f-94aa-8d0cea5f8ffb"` | `binary_id` primary key (`game.ex:6`). |
| `name` | string | `"Game 1"` | Required (`game.ex:25`). |
| `description` | string or null | `null` | |
| `lastTemplateId` | string or null | `"e5d08ef0-..."` | The template the game reopens to (`game.ex:2`). Wire camelCase, DB `last_template_id`. |
| `templateIds` | array of string | `["e5d08ef0-..."]` | Ordered member templates, from the preloaded join (`game_json.ex:14`, `:19-20`). |

Live, 1 of 17 games has a non-empty `templateIds`; the rest are `[]`.

### 4.2 `GET /api/games/:id`

**Bare object, no envelope.** Verified live. `id` must be a valid uuid: `999999` raises
`Ecto.Query.CastError` and returns `400`, because `Games.get_game!/1` casts before it can miss
(`games.ex:17`).

### 4.3 `POST` / `PATCH` / `PUT` / `DELETE /api/games`

Flat camelCase body. `create` and `update` return the bare object; `create` is `201`.
`Games.update_game/2` syncs template membership when the body carries it
(`games.ex:33-39`, `sync_templates/2` at `:87`), which is how the frontend persists level order:

```ts
// src/components/game/games.tsx:159
void updateGame(g.id, { name: g.name, templateIds: g.templateIds }).catch(() => void refresh())
```

Reordering is done client-side before that call (`games.tsx:102-104`).

`DELETE` returns `{"success": true, "id": "<id>"}` (`game_controller.ex:34`).

Verified: `POST {}` is `422 {"errors":{"name":["can't be blank"]}}`.

---

## 5. `/api/games/:game_id/levels` and `/api/levels`

The layer between a game and its maps: game has many levels, level has many templates. The routes
are nested so the path itself carries whose levels these are, which is the fix for a UI that could
only show a list of games (`router.ex:46-48`, `level_controller.ex:4-9`).

- **Controller** `lib/nebulith_web/controllers/level_controller.ex`
- **View** `lib/nebulith_web/controllers/level_json.ex`
- **Context** `Nebulith.Levels` (`levels.ex`): `list_levels/1:18`, `get_level/1:25`, `create_level/2:40`, `update_level/2:52`, `delete_level/1:60`, `reorder/2:102`, `template_ids/1:33`
- **Schema** `Games.Level` (`level.ex`)
- **Consumed by** **nothing.** See §5.5.

### 5.1 `GET /api/games/:game_id/levels`

Envelope `{"data": [...]}` (`level_json.ex:6`), in play order. Verified live:

```json
{"data":[{"id":"3b4dbfc1-1aac-4f25-8385-7323ed939333","name":"Level 1","position":0,
          "description":null,"createdAt":"2026-09-11T17:05:47Z","updatedAt":"2026-09-11T17:05:47Z",
          "templateIds":[],"gameId":"97829bd2-78fa-4d8f-94aa-8d0cea5f8ffb"}]}
```

| Field | Type | Meaning |
|---|---|---|
| `id` | uuid string | `binary_id` (`level.ex:15`). |
| `gameId` | uuid string | Owning game. Wire camelCase, DB `game_id`. |
| `name` | string | Required (`level.ex:32`). |
| `description` | string or null | |
| `position` | integer | Play order. Unique per game (`level.ex:33`). |
| `templateIds` | array of string | The maps this level is built from, in order. A jungle with four caves is five maps that are one level, which is the whole reason the table exists (`level_json.ex:18-20`, `level.ex:2-11`). |
| `createdAt`, `updatedAt` | UTC datetime string | `"2026-09-11T17:05:47Z"`, **with** a `Z` suffix, unlike templates. |

### 5.2 `POST /api/games/:game_id/levels`

`game_id` comes from the path and is dropped from the body params before the changeset
(`level_controller.ex:26-32`). Returns `201` with the **bare** level object. Verified:
`POST {}` is `422 {"errors":{"name":["can't be blank"]}}`.

### 5.3 `PUT /api/games/:game_id/levels/order`

Body `{"levelIds": [...]}`, the whole ordered list of ids, first to last
(`level_controller.ex:48-50`). The guard requires a list, so a non-list body will not match the
clause. Returns the reordered collection in the **`data` envelope**, same as index.

Verified live with an idempotent single-id reorder:

```
PUT /api/games/97829bd2-.../levels/order   {"levelIds":["3b4dbfc1-..."]}
-> 200 {"data":[{ ...position: 0... }]}
```

Note the body key is `levelIds` (camelCase) while the route segment is `order` and the path param is
`game_id` (snake).

### 5.4 `GET`, `PATCH` / `PUT`, `DELETE /api/levels/:id`

Un-nested, because an id is enough once you have one (`router.ex:53`). `show` and `update` return the
**bare** object; `index` and `reorder` return the `data` envelope. `update` drops `id` and `game_id`
from the params so a level cannot be moved between games by an update (`level_controller.ex:36`).

`GET /api/levels/999999` is `400 Ecto.Query.CastError`. A well-formed but absent uuid returns a clean
`404`, because `Levels.get_level/1` returns `{:error, :not_found}` rather than raising, explicitly so
the controller's fallback can translate it (`levels.ex:23-25`). Verified live for the existing id
(`200`, bare object).

### 5.5 Nothing calls these routes

An exhaustive sweep of every `fetch(` in `game-website/src/` found **no call to any level route**:
not `GET /api/games/:id/levels`, not `POST`, not `PUT .../levels/order`, not `/api/levels/:id`. The
only non-GET nebulith calls in the frontend are `api.ts:170,185,197,241,254,263`,
`editorSettings.ts:78`, `uiProfile.ts:117` and `tilesetLoader.ts:223`.

Level membership instead travels as the flat `templateIds` array on `PUT /api/games/:id`
(`games.tsx:159`). So the `levels` table and its six routes are live and functional on the backend
while the frontend still models levels as a template list on the game. That is an observation about
the current state, not a recommendation.

---

## 6. `/api/generators`

The map-generator catalog. Read-only, fetched once at editor mount, and it drives the map-type menu
and every generate, so no grid range, density or unit count is hardcoded frontend-side
(`generator_controller.ex:2-6`).

- **Controller** `lib/nebulith_web/controllers/generator_controller.ex`
- **View** `lib/nebulith_web/controllers/generator_json.ex`
- **Context** `Catalog.list_generator_categories/0` (`catalog.ex:302`)
- **Schemas** `Catalog.GeneratorCategory` (`generator_category.ex`), `Catalog.Generator` (`generator.ex`)
- **Consumed by** `src/lib/generatorCatalog.ts:686` (`fetchGeneratorCatalog`)

`GET /api/generators`, no params. Envelope `{"data": [ <category>, ... ]}` (`generator_json.ex:5`).
`52336` bytes live.

Ordering is data, never insertion order or an alphabetical accident: categories by `position` then
`key`, generators likewise, so the editor's menu is authored in the DB (`catalog.ex:297-301`).

**Live: 4 categories, 24 generators including children.**

| `key` | `name` | `position` | top-level generators | total including children |
|---|---|---|---|---|
| `forest` | Forest | 0 | 3 | 13 |
| `settlement` | Settlement | 1 | 2 | 9 |
| `cave` | Cave | 2 | 1 | 1 |
| `temple` | Temple | 3 | 1 | 1 |

Category fields (`category/1`, `generator_json.ex:7-15`): `key`, `name`, `description`, `position`,
`generators`. A category is a bucket, not a runnable thing (`generator_category.ex:6-8`).

Generator fields (`generator/1`, `generator_json.ex:17-34`):

| Field | Type | Meaning |
|---|---|---|
| `key` | string | Unique generator id, e.g. `"forest_woodland"`. |
| `name` | string | Menu label, e.g. `"Woodland"`. |
| `description` | string | Menu help text. |
| `layout` | string or null | Layout strategy. |
| `variant` | string | **Which archetype to run** (`town`, `city`, `forest`, `cave`, `temple`). The editor used to send the category key, which broke once one category held two kinds (`generator_json.ex:23-24`, `generator.ex:62-65`). Nil on a subtype, which inherits its parent's. |
| `zones` | array of string | Which seasons this generator is valid for. |
| `position` | integer | Menu order. |
| `config` | object | Every knob the run is steered by. |
| `options` | array | What a person may switch on. A variation is an option, not another row (`generator.ex:58-61`). |
| `children` | array | Subtypes, same shape, any depth. Each already carries its parent's config merged under its own (`generator_json.ex:29-31`). A virtual field, never persisted (`generator.ex:68-71`). |

`config` is jsonb so adding a knob needs no migration, and the frontend reads it as one typed object
with nothing re-derived and nothing defaulted: a missing key means the generator does not do that
thing (`generator.ex:5-8`). Top-level `config` keys observed live: `grid`, `nature`, `palette`,
`trees`, `units`, `crossings`, `formation`, `settlement`, `buildings`, `subZones`.

`generator.ex:10-44` documents the shape. Live example, `forest_woodland`:

```json
"config": {
  "grid":      { "cols": {"min":30,"max":45}, "rows": {"min":24,"max":35},
                 "cellSize": 16, "isoScale": 2.5 },
  "nature":    { "canopy": 0.434, "flowers": 0.04, "groundCover": 0.2, "tallGrass": 0.12 },
  "formation": { "lattice": 5, "spacing": 2, "understory": 0.45 },
  "units":     { "enemies": 0, "enemyTypes": [], "townsfolk": 3 },
  "trees":     [ {"kind":"tree_column","weight":30}, {"kind":"tree","weight":22}, ... ],
  "palette":   { "canopy":"#5d7340", "floor":"#6f7f4a", "water":"#4f93b3", ... },
  "crossings": { "wood":   {"composition":"bridge_wood","tile":"bridge"},
                 "stone":  {"composition":"bridge_stone","tile":"cobblestone"},
                 "planks": {"composition":"bridge_plank","tile":"wooden_planks"},
                 "dirt":   {"colorOf":"path_dirt","tile":"floor"} }
}
```

Building sizes are deliberately absent from `config`: those are composition data already, on
`compositions.footprint_w/h` (`generator.ex:43-44`).

`options` entries carry `key`, `label`, `type`, `default` and, for choices, `choices` of
`{key, label}`. Live for `forest_woodland`: `exits` (`random`, `1`, `2`, `3`, `4`), `pathways`,
`river` (`none`, `random`, `through`, `divides`, `around`), and a boolean `crossing`.

**Frontend:** `generatorCatalog.ts:670` reads `json.data` and drops malformed rows rather than
renaming anything, warning the drop count (`:672-673`). There is no snake_case on this wire, so the
parsers read camelCase verbatim (`cellSize`, `isoScale`, `enemyTypes`, `subZones`, `colorOf` and so
on). It hard-fails on a non-OK response (`:687`); the caller catches and keeps an empty catalog
(`editorHooks.ts:233`).

---

## 7. `/api/buildings`

Buildings at any size. The design note is explicit: rather than three fixed house sizes, one house
type the user sizes freely (`building_controller.ex:5-8`).

- **Controller** `lib/nebulith_web/controllers/building_controller.ex`
- **Module** `Catalog.BuildingCompositions` (`building_compositions.ex`): `building_types/0:248`, `default_footprint/1:256`, `min_footprint/0:272`, `compose_building/4:290`
- **Consumed by** `src/lib/buildingSizes.ts:67` (types) and `:143` (compose)

Both actions use `json(conn, ...)` directly rather than a JSON view module.

### 7.1 `GET /api/buildings`

No params. `{"data": {"types": [...], "min": {...}}}` (`building_controller.ex:33`).
**14 types live.** Each default is that type's own authored footprint (`building_controller.ex:10-13`).

```json
{"data":{"min":{"h":3,"w":4},
         "types":[{"key":"apartment","default":{"h":5,"w":6}},
                  {"key":"barn","default":{"h":4,"w":7}},
                  {"key":"castle","default":{"h":6,"w":12}}, ... ]}}
```

Live types and defaults (w x h): `apartment` 6x5, `barn` 7x4, `castle` 12x6, `cathedral` 7x5,
`church` 6x5, `hospital` 6x4, `house` 4x4, `manor` 8x5, `office` 5x5, `smithy` 5x4, `stable` 6x3,
`store` 5x4, `temple` 8x4, `tower` 4x4. `min` is `{w: 4, h: 3}` (`building_compositions.ex:272`).

### 7.2 `GET /api/buildings/:type`

Composes one building to order. Path param `type`. Query params (`building_controller.ex:36-49`):

| Param | Type | Default | Notes |
|---|---|---|---|
| `width` | integer | the type's default `w` | Non-positive or unparseable falls back to the default (`int/2`, `:60-67`). |
| `depth` | integer | the type's default `h` | Same. |
| `material` | string | none | Wall material. Blank string is ignored (`put_opt/3`, `:69-71`). |
| `roof` | string | none | |
| `roofTop` | string | none | **camelCase query param**, mapped to the `:roof_top` option. |
| `wallTop` | integer | none | camelCase, mapped to `:wall_top`. |
| `seed` | integer | none | Makes the composition deterministic. |

The response is the **same shape `/api/tilesets` serves for a seeded composition**, deliberately, so
the editor stamps a generated building through the path it already has and needs no second code path
(`building_controller.ex:14-16`, `:82-83`).

```
GET /api/buildings/house?width=3&depth=3&seed=7  ->  200
data keys: ["name","title","category","cells","footprint"]
footprint: {"h":3,"w":3}, cells: 20
```

| Field | Type | Notes |
|---|---|---|
| `name` | string | The requested type, used where a seeded composition has its name. |
| `footprint` | `{w, h}` | The composed size. |
| `title` | string or null | `null` for house. |
| `category` | string | Always `"buildings"` (hardcoded at `building_controller.ex:89`; the module's own constant is at `building_compositions.ex:69`). |
| `cells` | array | `{dx, dy, level, label, walkable}` plus `settings` when non-empty. |

Cells are sorted by `(dx, dy, level, label)` for the same reproducibility reason as §2
(`building_controller.ex:92`). Note the composed cells carry **no `scale` and no `zIndex`**, unlike
seeded composition cells, so the shape is close to but not identical with `/api/tilesets`.

Live `house` cells show the authoring rules at work: one cell per vertical run with
`settings.scaleY: 4` rather than four stacked cells, and one roof cell per column carrying
`settings: {"depth": 4, "depthDir": "left-down"}`. Those rules are documented at
`building_compositions.ex:14-46`. An unknown type is a `404` rather than a composed guess, because
the editor must not receive a building for something the catalog cannot describe
(`building_controller.ex:51-52`); verified live.

The default `house` composes to `{w:4,h:4}` with brick walls; `?seed=7&width=3&depth=3` composes
wood walls, confirming material is part of the seeded roll.

**Frontend:** `buildingSizes.ts:54` and `:145-148` both read `json.data`. It maps hyphens to
underscores on the type key (`:95`) and renames footprint axes on read: `lengthOf` returns `w`,
`depthOf` returns `h` (`:189-190`). It always sends `width` and `depth` (`:139`) and can send
`material`, `roof`, `roofTop`, `seed`, but in practice **all three call sites pass no options**, so
only `width` and `depth` are ever sent.

---

## 8. `/api/ui`

The action catalog and the UI profile in force. One answer rather than four, because the frontend
needs all of it before it can draw a single frame (`ui_json.ex:4-8`).

- **Controller** `lib/nebulith_web/controllers/ui_controller.ex`
- **View** `lib/nebulith_web/controllers/ui_json.ex`
- **Module** `Catalog.UiSource` (`ui_source.ex`): `list_actions/0:516`, `profile_for/1:390,392`, `editable_profile/1:406,408`, `load/1:519-520`, `put_bars/2:465`, `put_elements/2:493`
- **Schemas** `Catalog.Ui.{Action, Profile, Binding, Element, Bar, BarSlot}` (`ui.ex`)
- **Consumed by** `src/game/uiProfile.ts:90` (GET) and `:116` (PUT)

### 8.1 `GET /api/ui`

Query param `game` (a game uuid), optional. A game with no profile of its own gets the seeded
default, which is the whole point of having one (`ui_controller.ex:2-7`). The fallback is
`ui_source.ex:393`: look up by `game_id`, `|| default_profile()`.

Envelope `{"data": {"actions": [...], "profile": {...}}}`. `profile` can be `null`
(`ui_json.ex:16`). `6805` bytes live.

Verified live:

| Request | Result |
|---|---|
| `GET /api/ui` | `200`, 19 actions, `profile.key="default"`, `gameId=null`, 19 bindings, 22 elements, 1 bar |
| `GET /api/ui?game=97829bd2-...` (a real game) | `200`, **identical**: still `key="default"`, `gameId=null`, because that game has no forked profile |
| `GET /api/ui?game=does-not-exist` | `400 Ecto.Query.CastError` at `ui_source.ex:393`: the value cannot be dumped to `:binary_id` |

Action (`ui_json.ex:13-14`): `key`, `category`, `label`, `defaultChord`, `position`. Live example:

```json
{"key":"move_up","category":"movement","label":"Move up","defaultChord":"W / ↑","position":0}
```

All 19 live actions, by category: movement (`move_up`, `move_down`, `move_left`, `move_right`, `run`,
`jump`), combat (`attack_primary`, `attack_special`, `power_1` to `power_4`), world (`interact`,
`target_next`), interface (`open_bag`, `open_journal`), mouse (`select`, `context`, `camera_pan`).
These are seeded engine capability, read-only to the frontend (`ui.ex:10`).

Profile (`ui_json.ex:18-28`):

| Field | Type | Live | Meaning |
|---|---|---|---|
| `key` | string | `"default"` | Unique profile key. |
| `name` | string | `"Default"` | |
| `gameId` | uuid or null | `null` | Nil is the seeded default every new game starts from (`ui.ex:34`). |
| `playerMay` | object | `{"keys":true,"layout":false,"settings":true}` | The author's limit on the player: which of keys, layout, settings a player may change (`ui.ex:36-37`, seeded at `ui_source.ex:299`). |
| `bindings` | array | 19 | |
| `elements` | array | 22 | |
| `bars` | array | 1 | Sorted by `position` (`ui_json.ex:26`). |

- **Binding** (`ui_json.ex:30-31`): `actionKey`, `input`, `editable`, `position`. Several rows for one
  action is an alternate binding (`ui.ex:64`). Live: `{"actionKey":"move_up","input":"W / ↑","editable":true,"position":0}`.
- **Element** (`ui_json.ex:33-34`): `elementKey`, `form`, `placement`, `editable`. One HUD element's
  placement per form; a profile carries Desktop and Mobile for each (`ui.ex:87`). Live:
  `{"elementKey":"vitals","form":"Desktop","placement":{"a":"BL","x":16,"y":16,"w":256,"h":64,"s":1,"o":1,"on":true,"z":20},"editable":true}`.
  The `placement` keys are terse: `a` anchor, `x`/`y` offset, `w`/`h` size, `s` scale, `o` opacity,
  `on` visible, `z` z-order (seeded at `ui_source.ex:48-58`).
- **Bar** (`ui_json.ex:36-47`): `name`, `position`, `rows`, `cols`, `settings`, `condition`, `slots`.
  `condition` nil means always up; a rule there is what swaps a bar in on an event, quest or ability
  (`ui_json.ex:43-44`, `ui.ex:110-113`). Live: the `Powers` bar, `rows:1`, `cols:4`,
  `settings:{"buttonPx":44,"gapPx":6,"showCooldown":true,"showEmpty":true,"showKeys":true}`.
- **BarSlot** (`ui_json.ex:49`): `slot`, `refKind`, `refKey`. A blank slot is a row with no ref, so a
  bar's shape is explicit (`ui.ex:140`). Live: `{"slot":0,"refKind":"action","refKey":"power_1"}`.

### 8.2 `PUT /api/ui`

Query param `game`. Body may carry `bars` and/or `elements`; each is written only when present
(`ui_controller.ex:26-27`). Responds with the **same** `index` shape, reloaded
(`ui_controller.ex:29`).

**Copy-on-write, and it matters.** `editable_profile/1` forks the default into a profile of its own
on a game's first write, so one game's edit never reaches every other game still on the default
(`ui_controller.ex:17-22`, `ui_source.ex:398-413`, `fork_default/1` at `:415`). The fork copies the
default's bindings, elements and bars, so a game starts from exactly what it was already showing.

With no `game`, `editable_profile(nil)` returns the default profile itself without forking
(`ui_source.ex:406`), so an empty-bodied `PUT /api/ui` writes nothing. Verified on that basis:

```
PUT /api/ui  {}  ->  200
data keys: ["actions","profile"];  profile.key="default", gameId=null
19 actions, 19 bindings, 22 elements, 1 bar
```

Write semantics worth knowing: `put_bars/2` **deletes every bar on the profile** and re-inserts the
list, taking `position` from the array index and ignoring any `position` you send
(`ui_source.ex:465-468`). `put_elements/2` upserts per `(profile_id, element_key, form)` and touches
only the forms present in the list (`ui_source.ex:492-507`).

**UNVERIFIED (wire):** the forked-profile response. No game in the live DB has its own profile, so
every observed response carries `key="default"` and `gameId=null`. The forked shape
(`key: "game-<uuid>"`, `name: "This game's UI"`, from `ui_source.ex:421-422`) was read from code, not
observed, because producing it would create a profile row.

**Frontend:** `uiProfile.ts:81-83` reads `json.data.actions` and `json.data.profile`. `saveBars`
(`:104`) and `saveElements` (`:109`) both `PUT` through a shared private `save()` (`:116-119`) and
install the PUT's own response (`:124`). `saveBars` is called from
`src/components/game/shell/BarsTab.tsx:71`; **`saveElements` has no call site anywhere in `src/`**.
On failure the HUD has no layout and the profile stays `null` (`:93-95`).

---

## 9. `/api/entities`

Entity to baked-tile resolution data. Read-only, fetched at load time, and the frontend holds no
entity data of its own (`router.ex:37-38`, `entity_controller.ex:6-11`).

- **Controller** `lib/nebulith_web/controllers/entity_controller.ex`
- **View** `lib/nebulith_web/controllers/entity_json.ex`
- **Module** `Catalog.EntitySource`, `resolution/0` at `entity_source.ex:99`
- **Consumed by** `src/engine/entity/entityLoader.ts:23`

`GET /api/entities`, no params. `872` bytes live. Envelope `{"data": {...}}` with four keys
(`entity_json.ex:9-18`). The keys are emitted in camelCase so the loader installs the payload
verbatim, the same pass-through convention `TilesetJSON` uses for `zIndex` (`entity_json.ex:4-8`).

Per the map model a unit is just a tile: the actual entity art already lives in the emoji tileset as
`units`-category rows served by `/api/tilesets`. What was missing was the small lookup from a
gameplay tag to a slug, which is all this endpoint is (`entity_source.ex:5-18`). It is static data
with no DB table, authored as an Elixir module (`entity_source.ex:23-25`).

| Field | Type | Live | Meaning |
|---|---|---|---|
| `dir` | string | `"/tiles/emoji/baked/entities"` | URL prefix for the baked entity PNGs. The frontend uses it only as a truthiness guard that a slug has a baked tile; the real render resolves `emoji:<slug>` against the emoji tileset (`entity_source.ex:28-32`). |
| `tiles` | object | 25 entries | Slug to the source emoji it was baked from. The **keys** are the baked slug set; the values mirror the bake pipeline's input (`entity_source.ex:34-35`). |
| `enemyTypeSlug` | object | 16 entries | An enemy's `enemyType` tag to the slug whose tile it draws. |
| `variantSlug` | object | 6 entries | A person's `variant` to the figure slug. |

Live payload in full:

```json
"tiles": { "adult":"🧑","alien":"👾","bat":"🦇","boy":"👦","child":"🧒","dragon":"🐉","elder":"🧓",
           "ghost":"👻","girl":"👧","goblin":"👺","grey-alien":"👽","guardian":"🗿","man":"🧍‍♂️",
           "ninja":"🥷","ogre":"👹","old-man":"👴","old-woman":"👵","person":"🧍","robot":"🤖",
           "skeleton":"💀","spider":"🕷️","vampire":"🧛","wolf":"🐺","woman":"🧍‍♀️","zombie":"🧟" },
"enemyTypeSlug": { "bandit":"ninja","bat":"bat","dragon":"dragon","ghost":"ghost","goblin":"goblin",
                   "guardian":"guardian","ogre":"ogre","orc":"ogre","skeleton":"skeleton",
                   "slime":"alien","spider":"spider","troll":"guardian","vampire":"vampire",
                   "wolf":"wolf","wraith":"ghost","zombie":"zombie" },
"variantSlug": { "alien":"grey-alien","child":"child","female":"woman","male":"man",
                 "old":"elder","robot":"robot" }
```

So a `bandit` draws the ninja tile and a `wraith` the ghost tile. Note the resolution is
many-to-one: `orc` and `ogre` both resolve to `ogre`, `troll` and `guardian` both to `guardian`.

**Frontend:** `entityLoader.ts:25-26` accepts either envelope, then validates:

```ts
const body = (await res.json()) as { data?: EntityResolution } | EntityResolution
const resolution = (body as { data?: EntityResolution }).data ?? (body as EntityResolution)
```

No bundled fallback: on failure the editor stays gated (`:34-35`).

---

## 10. `/api/combat`

The rules the fight runs on. Creatures are **not** here: an enemy is a unit tile marked hostile, so
its stat block rides on its tile and arrives with `/api/tilesets`
(`combat_controller.ex:2-7`, `combat_json.ex:3-6`).

- **Controller** `lib/nebulith_web/controllers/combat_controller.ex`
- **View** `lib/nebulith_web/controllers/combat_json.ex`
- **Module** `Catalog.CombatSource`, `rule_map/0` at `combat_source.ex:79`
- **Schema** `Catalog.GameRule` (`game_rule.ex`)
- **Consumed by** `src/game/combatCatalog.ts:85`

`GET /api/combat`, no params. `1369` bytes. Envelope is **double-nested**:
`{"data": {"rules": {...}}}` (`combat_json.ex:7`). Rule bundles are keyed by name. Live keys:
`combat`, `stats`, `props`, `trees`.

Every number here is the value the game already used, so seeding changed no behaviour, only where the
number lives. `combat_source.ex:10-18` records the provenance of each bundle in the old frontend
files, so the port can be re-checked.

**`rules.combat`** (`combat_source.ex:30-43`):

| Field | Live | Meaning |
|---|---|---|
| `regularMultiplier` | `1` | Regular hit coefficient. |
| `specialMultiplier` | `1.75` | Special hit coefficient. |
| `ragePerStrength` | `5` | Rage pool per point of strength. |
| `manaPerIntelligence` | `5` | Mana pool per point of intelligence. |
| `specialResourceCost` | `20` | What one special spends. |
| `minDamage` | `1` | The floor a mitigated melee physical hit can never fall below. |
| `specialResource` | `{"physical":{"key":"rage","failure":"insufficient-rage"},"magical":{"key":"mana","failure":"insufficient-mana"}}` | Which resource a special of each school spends, and how it fails when short. |

**`rules.stats`**: `player` `{strength:10, intelligence:10, defense:5, maxHp:100}`, `enemy`
`{strength:5, intelligence:0, defense:2, maxHp:30}`, `npc`
`{strength:1, intelligence:1, defense:0, maxHp:10}`, plus `respawnMs: 5000`.

**`rules.props`**: `caveDecor` characters, `constantRoleTile`
(`{"bush":"emoji:shrub","mushroom":"emoji:red-mushroom","rock":"emoji:boulder"}`), `mushroomTones`,
`rockShades`, and `propArt` mapping prop names to `{char, color}` (altar, brazier, pillar, torch).

**`rules.trees`**: `defaultFlowers`, an array of `{char, color}`, and `variants`, an array of
`{kind, weight}`: `tree` 32, `tree_tall` 22, `tree_round` 20, `tree_stub` 12, `bush` 8,
`bush_round` 6.

**Frontend, and this is the one endpoint with two installers.** `combatCatalog.ts:76-79` reads three
levels down for `json.data.rules.combat` and `json.data.rules.stats`. Then `:91` hands the same
`json.data.rules` to the zone catalog, which reads `.props` and `.trees` from it
(`zoneCatalog.ts:62-63`). One fetch, two consumers. Creature stats come from elsewhere, exactly as
the moduledoc says: `combatCatalog.ts:109` reads `styleTile('ascii', label)?.settings.combat` off the
tileset payload, and `:123` resolves `enemyTypeSlug` off `/api/entities`.

---

## 11. `/api/zones`

Every season and what it looks like (`zone_controller.ex:2`).

- **Controller** `lib/nebulith_web/controllers/zone_controller.ex`
- **View** `lib/nebulith_web/controllers/zone_json.ex`
- **Module** `Catalog.ZoneSource`, `list_zones/0` at `zone_source.ex:472`
- **Schema** `Catalog.Zone` (`zone.ex`)
- **Consumed by** `src/engine/zoneCatalog.ts:69`

`GET /api/zones`, no params. `5405` bytes. Envelope `{"data": [...]}` (`zone_json.ex:5`), in menu
order by `position` then `key` (`zone_source.ex:472`).

**7 zones live**, in order: `spring` (0), `summer` (1), `autumn`, `winter`, `desert`, `beach`, `lava`.

Fields (`zone/1`, `zone_json.ex:7-18`): `key`, `name`, `position`, `palette`, `tiles`, `flowers`,
`temple`, `cave`. Each group is jsonb because the generator reads each one whole and they differ in
shape (`zone.ex:5-6`).

| Field | Live example (spring) | Meaning |
|---|---|---|
| `palette` | `{"id":"spring","groundTypes":["meadow","grass_tall","grass"],"accentColor":"#ff9ecf","wallColor":"#6a5a3a","trail":"path","hazard":"water"}` | Ground palette and the tiles the season uses for trail and hazard. |
| `tiles` | `{"tree":"emoji:cherry-blossom","flower":"emoji:tulip","decor":"emoji:blossom"}` | The tile the season wears per role, as a `style:label` reference. |
| `flowers` | `{"variants":[{"char":"✿","color":"#ff8fc8"}, ...]}` | The blooms it scatters. |
| `temple` | `{"floor":"temple_floor","wall":[4 colours],"pillar":"#b9c6a6","altar":"#d8f0b0","torch":"#ffb24a","pool":"water","poolBlocks":true,"accent":"cave_moss","spikeChar":"▲","spikeColor":"#6a9f4a"}` | Temple palette for this season. |
| `cave` | `{"floor":"cave_floor","wall":[4 colours],"crystal":"#e79ec8","pool":"water","poolBlocks":true,"accent":"cave_moss","accentChance":0.14,"mushrooms":true}` | Cave palette. |

**`flowers` is null on 5 of 7 zones.** Only spring and summer carry blooms, each with 6 variants;
autumn, winter, desert, beach and lava serve `flowers: null`. That is deliberate and load-bearing:
`zone.ex:6-8` states a season that does not flower carries nil rather than an empty list, because
"this season has no blooms" and "this season blooms with nothing" are different statements that the
generator treats differently. Every zone carries a populated `temple` and `cave`.

**Frontend:** `zoneCatalog.ts:55` reads `json.data` and keeps only rows with a string `key` (`:56`).
No fallback: the catch at `:72-74` warns that nothing has a palette. Its prop and tree rules arrive
separately from `/api/combat` (see §10).

---

## 12. `/api/items`

The item catalog: weapons, armour, consumables, plus starter kits. Read-only, and the frontend
renders what the catalog serves and declares no stats of its own (`item_controller.ex:6-9`).

- **Controller** `lib/nebulith_web/controllers/item_controller.ex`
- **View** `lib/nebulith_web/controllers/item_json.ex`
- **Context** `Catalog.list_items/0` (`catalog.ex:231`)
- **Schema** `Catalog.Item` (`item.ex`)
- **Consumed by** `src/game/itemCatalog.ts:93`

`GET /api/items`, no params. `3927` bytes. Envelope `{"data": [...]}` (`item_json.ex:5`), in catalog
order. **21 items live.**

Fields (`data/1`, `item_json.ex:9-18`), camelCase on the way out to match the tileset payload:

| Field | Type | Meaning |
|---|---|---|
| `slug` | string | Unique id, e.g. `"wpn_sword"`. |
| `name` | string | `"Iron Sword"`. |
| `slot` | string | One of `weapon`, `armor`, `consumable` (validated, `item.ex:11`, `:30`). |
| `kind` | string | Sub-kind, e.g. `sword`, `axe`, `bow`, `gun`, `staff`, `shield`, `iron`, `leather`. |
| `stats` | object | The stat block, passed through verbatim because it **is** that block (`item_json.ex:7-8`). |
| `starterKits` | array of string | Which kits grant this item, e.g. `["warrior"]`. DB `starter_kits`. |

`stats` lives in jsonb because a weapon's and an armour piece's stat blocks are genuinely different
shapes; the columns carry only what the catalog is queried by (`item.ex:5-6`). Live weapon stats
(`wpn_sword`): `{"baseDamage":12,"baseDefense":2,"baseMagic":0,"hands":1,"intBonus":0,"range":"melee","reachCells":1,"school":"physical","strengthBonus":3}`.
Live armour stats (`arm_helmet_iron`): `{"defenseBonus":3,"intBonus":0,"slot":"helmet","strengthBonus":1}`.
A shield adds `blockChance`, leather adds `dodgeBonus`. Note `stats.slot` on armour is a **second,
finer** slot ("helmet", "chest", "gloves") distinct from the top-level `slot: "armor"`.

The `position` column exists on the schema (`item.ex:20`) but is **not served**.

**Frontend:** `itemCatalog.ts:95-96` reads `json.data`, renames `slug` to `id`, and **flattens** the
nested `stats` onto its variant block (`toItem`, `:34-75`). Kits are stored separately (`:85`). A row
whose `slot` is unknown is dropped (`:74`). No fallback, and the comment is explicit that one would
put items in the bag the backend does not have (`:98-102`).

---

## 13. `/api/abilities`

The ability registry. Read-only (`ability_controller.ex:5`).

- **Controller** `lib/nebulith_web/controllers/ability_controller.ex`
- **View** `lib/nebulith_web/controllers/ability_json.ex`
- **Context** `Catalog.list_abilities/0` (`catalog.ex:224`)
- **Schema** `Catalog.Ability` (`ability.ex`)
- **Consumed by** `src/game/abilities.ts:104`

`GET /api/abilities`, no params. `3022` bytes. Envelope `{"data": [...]}` (`ability_json.ex:4`).
**13 abilities live.**

Fields (`data/1`, `ability_json.ex:8-18`):

| Field | Type | Meaning |
|---|---|---|
| `slug` | string | Unique id, e.g. `"cleave"`. |
| `name` | string | `"Cleave"`. |
| `description` | string | Player-facing text. |
| `category` | string | Live values: `offensive`, `defensive`, `debuff`, `protection`, `healing`. |
| `animation` | string | Names the FX tile it plays. |
| `cooldownMs` | integer | DB `cooldown_ms`. |
| `effect` | object | The outcome. |

**No colour field, deliberately:** the ability's tint is its FX tile's, resolved by `animation`
label, so one fact has one owner (`ability_json.ex:6-7`, `ability.ex:3-4`).

Live example:

```json
{"slug":"cleave","name":"Cleave","category":"offensive","animation":"cleave",
 "cooldownMs":7000,"effect":{"damage":22},
 "description":"A wide, two-handed swing that cleaves through for heavy physical damage."}
```

`effect` shapes observed live: `{"damage":N}`, `{"healing":N}`, `{"shieldMs":N}`, and for debuffs
`{"damage":N,"debuff":{"kind":"slow|poison|weaken","durationMs":N,"magnitude":N}}`. `magnitude` is a
fraction for slow and weaken (`0.4`, `0.3`) and a flat rate for poison (`4`).

The `position` column exists (`ability.ex:17`) but is **not served**.

**Frontend:** `abilities.ts:106-107` reads `json.data` and renames `slug` to `id` (`:91-99`).
Worth flagging: `AbilityDef.requirements` (`abilities.ts:45`) is never populated from the wire, so
`meetsRequirements` (`:161`) always sees `undefined`. No fallback, registry stays empty on failure.

---

## 14. `/api/editor_settings`

A key to value store for editor chrome. The backend owns the editor's panel geometry so nothing is
hardcoded frontend-side (`editor_setting_controller.ex:2-6`, `router.ex:54-55`).

- **Controller** `lib/nebulith_web/controllers/editor_setting_controller.ex`
- **View** `lib/nebulith_web/controllers/editor_setting_json.ex`
- **Context** `Nebulith.Editor`: `all_settings/0` (`editor.ex:15`), `put_setting/2` (`editor.ex:20`)
- **Schema** `Editor.Setting` (`setting.ex`)
- **Consumed by** `src/lib/editorSettings.ts:69` (GET) and `:77` (PUT)

### 14.1 `GET /api/editor_settings`

No params. Envelope `{"editorSettings": {...}}`, a flat key to value map loaded once on mount
(`editor_setting_json.ex:5`). **20 keys live.**

The `key` is a stable modal or panel id and `value` is opaque JSON (`setting.ex:3-6`). Two value
shapes are live:

```json
{"editorSettings":{
  "animation":                      {"x":838,"y":78,"w":708,"h":726},
  "tileLibrary":                    {"x":1466,"y":96,"w":417,"h":693},
  "inspector.panel.looks":          {"x":1265,"y":458,"w":330,"h":380},
  "inspector.panelOpen.looks":      {"value":false},
  "inspector.section.animation":    {"value":true},
  "playerViewRange":                {"value":null}
}}
```

Geometry panels serve `{x, y, w, h}`; flags and scalars serve `{"value": ...}`. Live keys:
`animation`, `connectors`, `preview`, `stats`, `tileLibrary`, `triggers`, `worldPreview`,
`inspector.panel.looks`, `inspector.panel.size`, six `inspector.panelOpen.*`, four
`inspector.section.*`, and `playerViewRange`. Note `playerViewRange` is `{"value": null}`, so a key
can exist with a null payload.

There is **no** `GET /api/editor_settings/:key`. Requesting one is `404 Phoenix.Router.NoRouteError`.

### 14.2 `PUT /api/editor_settings/:key`

Path param `key`. Body must carry `value` (`editor_setting_controller.ex:16`). Upsert: insert on
first write, replace on later writes (`editor.ex:19`). Both `key` and `value` are required and `key`
is unique (`setting.ex:22-23`).

The response is a **bare** `{key, value}` object from `show`, **not** the `editorSettings` envelope
(`editor_setting_json.ex:8`). Verified live by re-writing an existing key with its current value:

```
PUT /api/editor_settings/inspector.panelOpen.looks   {"value":{"value":false}}
-> 200 {"value":{"value":false},"key":"inspector.panelOpen.looks"}
```

The doubled `value` is not a typo: the request wrapper key and the stored payload's own key are both
`value`. Omitting the wrapper is `400 Phoenix.ActionClauseError` (verified).

**Frontend:** `editorSettings.ts:71-72` reads `json.editorSettings` on GET and `json.value` on PUT
(`:83-84`), sending `JSON.stringify({ value })` (`:80`). It hard-fails on a non-OK response;
callers catch (`editorHooks.ts:73,77`).

---

## 15. `/api/cv`

The combined CV and portfolio payload, read-only (`cv_controller.ex:2-5`).

- **Controller** `lib/nebulith_web/controllers/cv_controller.ex`
- **Module** `Nebulith.CV`, `all_cv_data/1` at `cv.ex:12`
- **Consumed by** `src/lib/cv-data.ts:17` (`getAllCVData`)

`GET /api/cv`, query param `locale`, defaulting to `"en"` (`cv_controller.ex:11`). Responds via
`json(conn, ...)` with a **bare object, no envelope**.

### This endpoint is currently broken: HTTP 500

Every locale returns `500`. Verified for `en`, `es`, `it` and an unknown `zz`. The cause, from the
error page:

```
** (Postgrex.Error) ERROR 42P01 (undefined_table)
   relation "ProfessionalSummary" does not exist
   query: SELECT P0."headline", P0."tagline", P0."bio", P0."highlights", P0."headline_es", ...
          FROM "ProfessionalSummary" AS P0 LIMIT 1
   at lib/nebulith/cv.ex:59: Nebulith.CV.professional_summary/1
      lib/nebulith/cv.ex:14: Nebulith.CV.all_cv_data/1
      lib/nebulith_web/controllers/cv_controller.ex:12
```

`Nebulith.CV` reads the shared DB through schemaless Ecto queries against Prisma-era tables
(`cv.ex:2-6`), and the `"ProfessionalSummary"` table is not present in this database. The failure is
on the first of six datasets, so nothing is returned at all. This is consistent with
`ARCHITECTURE.md:113`, which notes the Prisma seed populated the CV tables and that Prisma was
removed.

The response body is the Phoenix HTML debug page (`90795` bytes), not JSON, so a client expecting
JSON gets a parse error rather than a clean status.

**Intended shape, from `cv.ex:12-20`.** Six top-level keys: `professionalSummary`, `currentRoles`,
`companies`, `featuredProjects`, `techStack`, `workExperience`. Localisation works by `_es` and `_it`
column twins, with `loc/3` picking the localised value and falling back to English
(`cv.ex:5-6`, helpers at `:23-35`). `professionalSummary` selects `headline`, `tagline`, `bio` and
`highlights` plus their twins (`cv.ex:41-58`).

**UNVERIFIED (wire):** the entire successful payload, every field and type inside those six keys.
The endpoint cannot return `200` against this database, so nothing below the top-level key list could
be observed. The key list itself is from code.

**Frontend:** `cv-data.ts:19` casts the bare response with no envelope unwrapping. This is the one
endpoint with a genuine bundled fallback: `src/app/cv/page.tsx:14-21` calls `getAllCVData` in a `try`
and falls back to `getStaticCVData(locale)` on empty **and** on throw, so the live 500 is invisible
on the page.

---

## 16. Observed inconsistencies

Every item below was measured, not inferred. No fixes proposed, this is a record of what is.

### 16.1 Three different collection envelopes

Collections are wrapped in `data` (tilesets, entities, combat, zones, ui, generators, buildings,
items, abilities, nested levels), except `templates` which uses `{templates, total, limit, offset}`,
`games` which uses `{games}`, and `editor_settings` which uses `{editorSettings}`. Measured top-level
keys are tabulated in §1.4. The template and game shapes are intentional: `TemplateController:2-6`
says they match what `src/lib/api.ts` already expected.

### 16.2 Single records are wrapped for tilesets and bare everywhere else

`GET /api/tilesets/:id` returns `{"data":{...}}` (`tileset_json.ex:15`), while
`GET /api/templates/:id`, `GET /api/games/:id` and `GET /api/levels/:id` return the record's own
fields at the top level (`template_json.ex:18`, `game_json.ex:6`, `level_json.ex:9`). All four
verified live.

### 16.3 Delete responses disagree

| Route | Response |
|---|---|
| `DELETE /api/tilesets/:id` | `204 No Content`, empty body (`tileset_controller.ex:44`) |
| `DELETE /api/templates/:id` | `200 {"success":true,"id":...}` (`template_controller.ex:46`) |
| `DELETE /api/games/:id` | `200 {"success":true,"id":...}` (`game_controller.ex:34`) |
| `DELETE /api/levels/:id` | `200 {"success":true,"id":...}` (`level_controller.ex:44`) |

The tileset delete is the only one without a body, and `{success, id}` is a shape no other endpoint
in the API uses.

### 16.4 snake_case and camelCase in the same object

`/api/tilesets` is the only endpoint serving snake_case field names, and it serves them **beside**
camelCase ones. Classifying only real field names, with map keys such as tile labels excluded:

- snake_case: `image_url`, `color_role` (tile objects, `tileset_json.ex:45`, `:51`)
- camelCase: `zIndex` (composition cells, `tileset_json.ex:76`)
- plus camelCase inside `settings`: `artFrames`, `cutawayRoof`, `fadeNear`, `frameMs`, `minAlpha`,
  `scaleZ`, `thicknessDir`, `unitRole`, `scaleX`, `scaleY`

So one tileset response carries `image_url` and `scaleY` in sibling positions. The `zIndex` choice is
documented and deliberate: `tileset_json.ex:71-72` states the DB column is `z_index` and the JSON key
the renderer reads is `zIndex`, so the loader maps it straight through. `image_url` and `color_role`
carry no such note and are renamed on the frontend instead (`tilesetLoader.ts:98`, `:101`).

Every other endpoint is uniformly camelCase: `lastTemplateId`/`templateIds` (games), `gameId`
(levels), `isPublic`/`createdAt` (templates), `enemyTypeSlug`/`variantSlug` (entities),
`actionKey`/`defaultChord`/`playerMay` (ui), `cooldownMs` (abilities), `starterKits` (items),
`editorSettings` (editor settings).

### 16.5 The `data` key collides with itself

`GET /api/tilesets` wraps in `data`, and a tileset row **has its own field named `data`** (the legacy
blob, `tileset_json.ex:25`, `:36`). So the access path for the blob is `json.data[0].data`, and it is
`null` on both live rows.

### 16.6 Collision is expressed three ways, one of them inverted

- A **tile** carries `blocking: true` means impassable (`tileset_json.ex:46`, `tile.ex:10`)
- A **composition cell** carries `walkable: true` means passable (`tileset_json.ex:76`,
  `composition_cell.ex:10`)
- The **frontend inverts** the tile one on read: `walkable: !tile.blocking`
  (`tilesetLoader.ts:98`)

So the same concept has opposite polarity depending on whether it sits on a tile or a cell, and the
client flips one of them. Measured: 0 of 748 tile objects carry `walkable`, and all 1558 composition
cells across both styles carry `walkable`.

Also measured: the string `collision` appears **zero** times in the entire 416988-byte tilesets
payload. No tile carries `collisions` at top level or inside `settings`. Whatever the collision model
is moving toward, `blocking` and `walkable` are what the wire serves today.

### 16.7 Timestamp formats differ between two adjacent resources

- Templates: `"2026-09-12T19:08:55"`, no timezone marker, because the column is a **naive** datetime
  inherited from Prisma (`template.ex:36`)
- Levels: `"2026-09-11T17:05:47Z"`, with `Z`, because the column is `utc_datetime`
  (`level.ex:25`)

Both are served under the same `createdAt`/`updatedAt` names, so a client cannot tell from the key
which format to expect.

### 16.8 Identifier types are mixed across resources

| Resource | Primary key | Malformed id behaviour |
|---|---|---|
| Tilesets | integer (`tileset.ex`, default) | `404 Ecto.NoResultsError` |
| Templates | **text** (`template.ex:11`) | clean `404` JSON |
| Games | uuid (`game.ex:6`) | `400 Ecto.Query.CastError` |
| Levels | uuid (`level.ex:15`) | `400 Ecto.Query.CastError` |

Three id types and three different failure modes for "this id is no good". Only the template path
produces the documented JSON error shape.

### 16.9 Error bodies are not uniformly JSON

`422` and the template and building `404`s are clean JSON via the fallback controller. But
`GET /api/tilesets/999999`, `GET /api/games/999999`, `GET /api/levels/999999`,
`GET /api/ui?game=does-not-exist`, `POST /api/tilesets` without its wrapper, and
`PUT /api/editor_settings/:key` without `value` all return the HTML debug page in dev. Seven of the
fourteen controllers declare no `action_fallback` at all (listed in §1.5).

### 16.10 Nested and flat casing mix inside one route

`PUT /api/games/:game_id/levels/order` takes a path param `game_id` (snake) and a body key
`levelIds` (camel), in the same request (`level_controller.ex:49`). Similarly
`GET /api/buildings/:type` accepts query params `width` and `depth` (flat) alongside `roofTop` and
`wallTop` (camel), which the controller maps to `:roof_top` and `:wall_top`
(`building_controller.ex:41-43`).

### 16.11 Two clients defensively accept either envelope

`tilesetLoader.ts:194-195` and `entityLoader.ts:25-26` both accept the payload wrapped in `data` or
bare. Both endpoints in fact always wrap (`tileset_json.ex:8`, `entity_json.ex:10`), so the tolerance
is currently unnecessary on both paths.

### 16.12 The same response is consumed by two unrelated installers

`/api/combat` is fetched once and fed to two modules: `combatCatalog.ts:76-79` takes
`json.data.rules.combat` and `.stats`, then `:91` passes `json.data.rules` to `zoneCatalog.ts:60-63`
which takes `.props` and `.trees`. So `/api/combat` carries season and prop art data that has nothing
to do with combat, and `/api/zones` alone is not enough to render a season.

### 16.13 Served columns and schema columns diverge

`Item.position` (`item.ex:20`) and `Ability.position` (`ability.ex:17`) exist and both default to `0`,
and both are used for catalog ordering, but neither is serialised (`item_json.ex:9-18`,
`ability_json.ex:8-18`). A client cannot reproduce the catalog order from the payload, only preserve
the array order it arrived in.

### 16.14 Six live routes have no consumer

Every level route (§5.5) is unused by the frontend, which persists level membership through
`PUT /api/games/:id` instead. Additionally `POST /api/tilesets` and `DELETE /api/tilesets/:id` have
no call site, and `saveElements` in `uiProfile.ts:109` is defined but never called, so the `elements`
half of `PUT /api/ui` is never exercised by the app.

### 16.15 Conditional keys mean absence is meaningful

Composition cells omit `animations` and `settings` entirely when empty rather than serving `null` or
`{}` (`tileset_json.ex:83-91`). Composed buildings do the same for `settings`
(`building_controller.ex:100-102`). This is documented as byte-compatibility with payloads from
before those fields existed. Separately, `zones.flowers` uses `null` to mean a genuinely different
thing from an empty list (`zone.ex:6-8`), so on this API a missing key, a null and an empty collection
are three distinct statements and which convention applies is per field.

### 16.16 `/api/buildings/:type` nearly matches the tileset composition shape

`BuildingController` states the composed shape is the same one `/api/tilesets` serves
(`:14-16`, `:82-83`), and it mostly is: `name`, `footprint`, `title`, `category`, `cells`. But the
composed cells carry only `{dx, dy, level, label, walkable}` plus optional `settings`, while seeded
composition cells also carry `scale` and `zIndex` (`tileset_json.ex:76`). Verified live on both.

---

## 17. UNVERIFIED

Items I could not establish from a live response, and why.

1. **`GET /api/cv` success payload.** The endpoint returns `500` for every locale because the
   `"ProfessionalSummary"` table does not exist in this database (§15). Only the six top-level key
   names are known, from `cv.ex:12-20`. No field, type or example value inside them was observed.
2. **`POST /api/tilesets` success response.** Not exercised: it would insert a tileset row. Shape read
   from `tileset_controller.ex:20-23` and `tileset_json.ex:14-16`. The unwrapped-body failure path was
   verified (`400`).
3. **`PATCH`/`PUT /api/tilesets/:id` success response.** Not exercised: it would overwrite the live
   tileset `data` blob. Shape read from `tileset_controller.ex:32-38`. The projection is `data/1`,
   which was verified via `GET /api/tilesets/:id`.
4. **All four `DELETE` routes.** Destructive, not exercised. Status and body read from
   `tileset_controller.ex:44`, `template_controller.ex:46`, `game_controller.ex:34`,
   `level_controller.ex:44`.
5. **`POST`/`PATCH`/`PUT` success bodies for templates, games and levels.** Not exercised: they would
   create or mutate rows. Each renders the same `show` projection I verified through the corresponding
   `GET`, so the shape is established; the `201` status for creates is from
   `template_controller.ex:25`, `game_controller.ex:17` and `level_controller.ex:29`. Their `422`
   validation bodies **were** verified live.
6. **The forked per-game UI profile.** No game in this database has its own profile, so every observed
   `/api/ui` response carries `key="default"` and `gameId=null`. The forked shape
   (`key: "game-<uuid>"`, `name: "This game's UI"`) is from `ui_source.ex:415-422`. Producing it would
   create a profile row.
7. **`PUT /api/ui` with a real `bars` or `elements` payload.** Only the empty-bodied call was made,
   which is provably a no-op (`ui_controller.ex:26-27` writes only when the key is present,
   `ui_source.ex:406` returns the default without forking when no game is given). The destructive
   detail that `put_bars/2` deletes all bars before re-inserting is from `ui_source.ex:465-468`, not
   observed.
8. **`/api/buildings/:type` options `material`, `roof`, `roofTop`, `wallTop`.** Accepted per
   `building_controller.ex:41-44`, but I only varied `width`, `depth` and `seed`. The valid value sets
   for those four are not enumerated by the controller, and I did not trace them into
   `building_compositions.ex`. The frontend never sends them (`buildingSizes.ts`, all three call sites
   pass no options).
9. **Production error bodies.** Every HTML error page I observed is the dev debug page. In production
   these become `ErrorJSON.render/2` output (`error_json.ex:18-20`), which I did not exercise, having
   only a dev server available.
10. **`Template.category` value set.** `"custom"` is the schema default (`template.ex:15`) and the only
    value present live (1 template). Whether other categories are in use is unknown; the filter accepts
    any string and returns `total: 0` for an unknown one.
