# Tileset Authoring — how tiles, autotiling & compositions work

> Reference for building tiles + compositions the RIGHT way (buildings, fountains, water, walls, trees).
> Read with MAP-MODEL.md (the map/views model) and TILE-VOCABULARY-CONTRACT.md (the `<base>_<edge>` naming).
> Applies to BOTH ascii and emoji tilesets, and BOTH 2D and 3D — one tileset, projected per view.

## 1. The model (don't deviate)
- Everything on the map is a **composition** = cells/blocks holding **tiles** (the art). Buildings, fountains, trees, walls — all compositions. No special drawers.
- A **tile** is one piece of art for one cell/block. It carries its **colour as a setting** (`settings.colors[zone]`), its ascii `glyph` and its `emoji`, its `category`/`title`, `blocking`/`walkable`.
- **Variety of colour = edit the tile's `settings`** (not new logic). **Variety of material = use DIFFERENT tiles** (e.g. `wall_brick` vs `wall_stone` vs `wall_wood`), not a recolour of one.

## 2. Autotiling — the standard way tilesets build shapes
A real tileset does NOT use one fill tile for a whole object. For each cell it places the RIGHT piece based on its neighbours:
- **center** (`_c`) — interior, all neighbours same material.
- **edges** (`_t _b _l _r`) — one side faces a different material.
- **corners** (`_tl _tr _bl _br`) — two sides face out.
- **transitions / junctions** — between two materials.

Common layouts: **9-piece / 3×3 minimal** (16 combos), **full bitmask** (47 tiles, RPG-Maker 6×8), **Wang / terrain sets** (edge+corner colours). We use the **`<base>_<edge>`** naming from TILE-VOCABULARY-CONTRACT §2.1.

## 3. Building compositions FROM pieces
Author a composition (`compositions` + `composition_cells`: `{dx,dy,level,label,walkable}`) that places the correct **piece** per cell:
- **Fountain** (per Alexander's ref): interior = `water_c`; the rim = **edge/corner pieces** — `fountain_t/b/l/r` (sides) + `fountain_tl/tr/bl/br` (corners); **jets** = `water_jet` tiles raised on top of some water cells. Not one `stone_rim` fill.
- **Building facade**: a **wall material** field (`wall_brick_c` / `wall_stone_c` / …) with **edge/corner** pieces where the wall meets air, **windows** (`window`, spaced grid — see below) and a **door** (`door`, sized per building) placed into the field, and a **roof** (`roof_*` with a ridge / gable pieces or a flat parapet). Different buildings use different wall **materials** (variety by tile) + colours (variety by setting).
- **Windows** (realistic, architecture-correct): a spaced GRID — window columns separated by wall, vertically aligned across floors, wall course between floors. Never a solid band.
- **Tree**: a **trunk** piece (brown) at the base + **leaf** pieces (canopy) above — combined, in BOTH ascii and emoji (emoji must NOT collapse to one 🌲).

## 4. Two tilesets, two views — one set of labels
The SAME label set (`water_c`, `wall_stone_l`, `fountain_tr`, `trunk`, `leaf`, …) exists in both the **ascii** tileset (a glyph) and the **emoji** tileset (an emoji that visually combines with its neighbours). Emoji compositions must be built from **part-emojis** (🟦 water, ⬜ rim, 💧 jet, 🟫 trunk, 🍃 leaf, 🧱 wall, 🪟 window …) — never a single whole-object emoji (⛲, 🌲). Both views PROJECT the same stamped tiles (MAP-MODEL §5): ISO = 3D stack, 2D = front elevation (depth collapsed), TOP = footprint.

## 5. How to add tiles / compositions (data only)
Author in nebulith `lib/nebulith/catalog/tile_source.ex` (tiles: glyph + emoji + `settings.colors` + category) and `building_compositions.ex` (compositions). Idempotent **upsert seed** via `mix run --no-start` (NEVER `mix ecto.reset` — shared `game_website` DB). Served via `/api/tilesets`; the frontend just stamps + renders. No tile art or design logic in the frontend.

## References (autotiling guides — for refreshers)
- Red Blob Games — Autotiling, interactive guide: https://www.redblobgames.com/articles/autotile/claude/
- GameMaker — Auto Tiles (tile-set editor): https://manual.gamemaker.io/lts/en/The_Asset_Editors/Tile_Set_Editors/Auto_Tiles.htm
- Godot forum — 3×3 minimal corner pieces explained: https://forum.godotengine.org/t/how-do-the-corner-pieces-in-tileset-autotile-3x3-minimal-work/15376
- Godot 4 TileMapLayer tutorial: https://codingquests.io/blog/godot-4-tilemaplayer-tutorial
- Concepts: RPG-Maker 47-tile autotile, Godot 3×3 minimal (16) / full bitmask (47), Tiled Wang/terrain sets, the dual-grid technique.
