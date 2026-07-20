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
- **Fountain** (per Alexander's ref): interior = **all `water_c`** (blue water, drawn a bit bigger at `scale` 1.15); the rim = **edge/corner pieces** — `fountain_t/b/l/r` (sides) + `fountain_tl/tr/bl/br` (corners). Not one `stone_rim` fill. The water animates BY DEFAULT — each interior cell ships the yoyo **height-grow** animation (`fountain_water_grow`: grow the column 1→4 blocks then back, on loop; see `ANIMATION-SYSTEM.md` §6). No `water_jet` drop tiles (the drops levitated — retired).
- **Building facade**: a **wall material** field (`wall_brick_c` / `wall_stone_c` / …) with **edge/corner** pieces where the wall meets air, **windows** (`window`, symmetric grid — see below) and a **door** (`door`, sized per building) placed into the field, and a **roof** (`roof_*` with a ridge / gable pieces or a flat parapet). Different buildings use different wall **materials** (variety by tile) + colours (variety by setting).
- **Windows — BILATERALLY SYMMETRIC (tickets #30/#31)**: per facade, windows **mirror across the wall centreline** and are always **flanked by walls** — the two edge columns are ALWAYS walls (a window is never at the bare edge), so the minimum unit is `wall·window·wall` and it grows into balanced mirrored patterns (`wall·window·wall·window·wall`, `wall·wall·window·window·wall·wall`, …). Windows sit on the **same columns on every floor** (vertically aligned), with a **wall course between floors**. The rule is one function: a window sits where the **distance to the nearer edge is odd** (`window?/2`), which is edge-walled + symmetric for every width. Never a solid band, never a scattered/edge window.
  - **DOOR**: **centred** on the facade — one column for odd widths, a **2-wide centred opening** for even widths (also meets the ≥2-wide entrance rule).
  - **ROOF**: **one consistent colour** — the gable body + apex share ONE material pair (`roof`/`roof_top`, or `roof_slate`/`roof_top_slate`, or the hospital green); never a mixed/patchy roof.
- **Minimal cells (#30) — author already block-optimized**: a same-tile vertical RUN is authored as **ONE cell** sized `settings.scaleY = span` (a 4-tall wall pier → 1 cell, not 4 stacked; a gable column → 1 cell). This is **render-identical** — the frontend already draws a collapsed run as a single `scaleY` block (MAP-MODEL §4), so pre-collapsing only shrinks the stored `composition_cells` (~45% fewer across the buildings), never the look. A window/door has its own label, so it breaks the run and stays its own block — the symmetric grid survives the collapse.
- **Tree**: a **trunk** piece (brown) at the base + **leaf** pieces (canopy) above — combined, in BOTH ascii and emoji (emoji must NOT collapse to one 🌲). (Same `settings.scaleY` height authoring as the walls above.)

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
