# HITBOXES AND ELEVATION. The implementation spec.

**Date** 2026-09-14 · **Status** SPEC. No code was written, nothing in either repo was modified.
Part D of ticket 1, which absorbed ticket 2 on 2026-09-14. **Carries** the old #3 (*"3 is part of 2"*, a cell's own elevation and texture, first class) and the old #7
(hitboxes are PER VIEW). **Unblocks** #3, #5, #6, #7, #12 and #29.

---

## 1. The answer up front

A hitbox is a **solid authored on the TILE, in BLOCK units, in the tile's own frame**, and a tile carries as
many as it likes. A box can be attached to an **animation FRAME**, so the chain's boxes ride the chain. Three
solids: `square` (a cuboid), `skew` (a cuboid whose top slides sideways) and `triangle` (a cuboid whose top
face is a sloped patch, four corner heights). Each box says what questions it answers (`solid`, `support`,
`hurt`, `hit`, `sensor`), so one list serves collision, elevation, contact damage, spell damage and range.
**Elevation stays LEGO**: the integer `level` is still the ruler, and the triangle only shapes the surface
INSIDE one block, which is what makes a stair or a mountain read as a slope instead of a stack of cubes.
Per view, the box is authored ONCE and **projected**: iso takes the whole solid, top takes its footprint, 2D
takes its front elevation, with a per-view override for the rare case the projection is wrong. The grid is
already the broad phase, so there is no quadtree and no spatial hash, and every box is baked per
(tile, frame, view) at catalog install and read, never computed, in the loop.

---

## 2. Sources read before proposing anything

**Workspace:** `TICKETS.md` (row 2 in full, plus 3, 5, 6, 7, 12, 29), `HANDOFF-CURRENT.md`,
`2026-09-08-hitboxes-and-big-units-spec.md` (the earlier research pass), `2026-09-09-performance-and-scale-item.md`.

**Docs, both trees:** `MAP-MODEL.md` (§1 to §8), `TILE-VOCABULARY-CONTRACT.md`, `ANIMATION-SYSTEM.md`,
`EDITOR-INTERACTION-SPEC.md`, `ENGINE-ARCHITECTURE.md`, `COMBAT-AND-SYSTEMS-SPEC.md`, `CODING-STANDARDS.md`.
**Two doc statements are stale and this ticket fixes them**, see §9.

**Code, every claim below cites `file:line`:** `engine/collisionBoxes.ts`, `engine/cellStack.ts`,
`engine/IsometricGrid.ts`, `engine/render/iso.ts`, `engine/render/isoBlock.ts`, `engine/render/assetAnimation.ts`,
`engine/animation/tileAnimation.ts`, `engine/tileset/tileset.ts`, `engine/tileset/styleTiles.ts`,
`engine/tileset/tileViewSettings.ts`, `engine/generate/pipeline.ts`, `engine/generate/generationLayers.ts`,
`engine/movement.ts`, `game/runtime/movement.ts`, `game/runtime/combat.ts`, `game/runtime/targeting.ts`,
`game/editor/mapSnapshot.ts`, `components/game/editorConfig.ts`, `components/game/editorInspector.tsx`,
`components/game/editorAnimation.tsx`, `lib/api.ts`. Backend: `catalog/tile.ex`, `catalog/tile_source.ex`,
`catalog/composition.ex`, `catalog/composition_cell.ex`, `catalog/generation_layer.ex`, `catalog/game_rule.ex`,
`catalog/template.ex`, `nebulith_web/controllers/tileset_json.ex`, `nebulith_web/router.ex`.

**The live backend, curled, not inferred:** `GET http://localhost:6328/api/tilesets`, `GET /api/entities`.
Numbers in §3 are measured off that payload today.

**Video sources, transcribed with `yt-dlp` and cited by timestamp:** *"I Added ELEVATION to my 2D Game"*,
Isocore devlog, `https://www.youtube.com/watch?v=ez68sFkO6Qo`, read into §4.11 (perlin, the height profile,
the sorting problem). His instruction with it: *"we must use perlin(x,z) on our terrain for elevation"*.

**Web research:** 4 parallel passes, ~40 sources. §4 carries them with links, and says where the industry
disagrees and which side this spec takes.

---

## 3. What is true today, measured

### 3.1 The box system exists and holds one shape, 756 times

`GET /api/tilesets`, today: **378 tiles per style** (ascii and emoji, 1:1), so **756 rows, and every one of
them carries `settings.collision`**. Per style, **72 carry exactly one box and 306 carry an empty list**, so
**144 solid rows and 612 clear ones across both catalogs**. Every one of the 144 boxes is byte-identical:

```json
[{"x": 0, "y": 0, "w": 1, "h": 1}]
```

**One distinct box shape in the whole catalog.** That is `ensure_collisions/0`
(`tile_source.ex:2604`) writing `@whole_cell` for every row whose `blocking` column is true. The system is
wired end to end and holds no authored geometry at all. Nothing in the catalog says a door is a thin panel or
a trunk is a post, and nothing can say a surface is sloped, because the shape has no vertical axis.

### 3.2 The box is 2D, and it is the FOOTPRINT

`CollisionBox` is `{x, y, w, h}` in cell fractions (`collisionBoxes.ts:24`), where `y` is the ROW axis and `h`
is the ROW extent. There is no height term anywhere in it. `worldPointBlocked` (`collisionBoxes.ts:93`) tests a
world POINT against the cell's boxes and knows nothing about level. So today's collision is the TOP view's
answer being used for all three views, which is the opposite of the per-view rule.

`boxesForAsset` (`collisionBoxes.ts:52`) has one derivation left in it: a whole-cell box shrinks to the size
the tile is DRAWN at. That derivation goes away when real boxes exist, and until then it is the only thing
stopping a tree from blocking the gap beside it.

### 3.3 Elevation is two systems that do not know about each other

* **`grid.height[row][col]`** (`IsometricGrid.ts:174`), a per-cell integer, written by `setHeight`
  (`:502`), read by the iso renderer for the raise (`iso.ts:958`) and the cliff faces (`iso.ts:1565-1607`),
  saved as `Template.heightData` (`api.ts:283`, `template.ex:26`) and captured by undo
  (`mapSnapshot.ts:35`).
* **the LEGO stack**, `heightLevel` per asset plus `cellStackTop` / `unitStandLevel` / `stackContribution`
  (`cellStack.ts:174`, `:196`, `:205`), which derives what a unit stands on from the tile's `height`,
  `settings.stackAt` and `settings.actAsTile`.

They are added together in exactly two places (`iso.ts:2587` and the debug overlay's `surfaceLift`), by hand,
and nowhere else. **There is no third thing that answers "how high is the ground at this point".** There is no
sub-block surface at all, so a ramp cannot exist: the smallest step the engine can express is one whole block.

`grid.collision[row][col]` (`IsometricGrid.ts:177`) is a separate 2D int grid written from
`assetIsSolid` at placement (`:559`, `:627`). It is the only thing `isBlocked` reads, and `isBlocked` is the
only thing movement reads (`movement.ts`, `game/runtime/movement.ts`).

### 3.4 Animation already has everything a per-frame box needs

* A sprite animation's frames are `AnimFrame[]` = `{tileId?, char?, flipX?}`
  (`game/runtime/entityAnimation.ts:43`). **A frame is already a first-class record**, so it has somewhere to
  put boxes.
* `spriteFrameIndex(anim, nowMs, placedAtMs)` (`tileAnimation.ts:398`) is pure and clock-derived, and
  `spriteFrame(asset, now, style, view, dayNight)` (`render/assetAnimation.ts`) already resolves the LIVE
  frame for one asset in one view. **That function is the seam the whole per-frame half of this ticket hangs
  on, and it already exists.**
* An animation already declares `scope: {styles?, views?}` and `animationMatchesScope(anim, style, view)`
  (`tileAnimation.ts:379`) already gates by view. So "a thing that says which views it applies to" is an
  established pattern in this engine, not a new idea.
* Live: 4 tiles carry `settings.animations`, 70 carry `settings.frames` (frame image URLs) and 67 carry
  `settings.artFrames`. Only 5 frame rows exist as their own tiles (`water_f1..f3`, `decor_ripple_f1..f2`).

### 3.5 Per-view deviation is also an established pattern

`StyleTile.views?: Partial<Record<TileView, TileViewSettings>>` (`tileset/tileViewSettings.ts`), documented as
*"deviations only. An absent field falls back to the tile's shared value"*. A per-view hitbox override takes
exactly this shape, so nothing new has to be invented or explained.

### 3.6 A unit IS a tile

`/api/entities` serves only the tag-to-slug lookup. The unit ART is `units`-category rows in `/api/tilesets`:
**79 of them**. So boxes authored on a tile row cover bosses and animals for free. The play loop still carries
units as `Entity` objects, which is the one extra resolver §6 step 12 adds.

### 3.7 Collision is still invented in the frontend in places

16 `make*` prop factories in `stageGenerator.ts` and 11 literal `blocking: true` / `collision: true` writes
across `src/engine` and `src/game` outside tests (`stageGenerator.ts:446,485,549,550,551,562,644`,
`riverNetwork.ts:776`). `blocking` appears 232 times and `walkable` 378 times in `src`. Ticket 5 deletes them;
this ticket is what makes that possible, because it puts the fact they encode somewhere real.

### 3.8 Combat is cell arithmetic

`tickCannons` (`game/runtime/movement.ts`) uses `Math.abs(dCol) + Math.abs(dRow) <= CANNON_RANGE` with
`CANNON_INTERVAL_MS`, `CANNON_RANGE` and `CANNON_DAMAGE` as frontend constants. `findTarget`
(`game/runtime/targeting.ts`) walks an 8-way aim line by `reachCells`. Nothing in combat has any geometry in
it, so *"contact dmg, spell dmg, range"* has no box to ask.

### 3.9 2D is hidden on purpose

`SHOW_2D_VIEW = false` (`components/game/editorConfig.ts:194`), with his reason quoted in the file:
*"for now, let's hide 2d view ... we'll nail isometric, then catchup 2d back"*. The `'2d'` view id, every
handler and `renderTopView`'s 2D path all stay.

### 3.10 The performance budget, measured 2026-09-09

| scene | cells | ms/frame |
|---|---|---|
| empty grid | 1,600 | 6.5 |
| generated town | 1,600 | 12.4 |
| generated town | 14,400 | 33.2 |

Generation of a 120x120 town takes ~10 s, synchronous. Whatever this ticket adds has to be invisible in that
table, which §4.4 and §5.8 are built around.

---

## 4. Research: how real engines actually do this

Four parallel passes, ~40 sources. Each finding says what it means for THIS engine. Where the industry
disagrees, the disagreement is named and a side is picked with a reason.

### 4.1 A hitbox is per FRAME, and it is a GROUP of boxes

* **The FGC's own glossary** defines a hitbox as *"a predefined area (usually a GROUP of rectangles or
  circles)"* live only during a move's active frames. <https://glossary.infil.net/?t=Hitbox>
  → **Many boxes per thing, live only on some frames, is the norm.** His *"tiles has many hitboxes"* is not an
  exotic ask, it is the baseline.
* **Street Fighter 6**, via WistfulHopes' viewer (<https://github.com/WistfulHopes/SF6Mods>) and Ultimate
  Frame Data (<https://ultimateframedata.com/sf6/>), separates **six** box classes: hitbox, hurtbox, pushbox,
  throwbox, throw hurtbox and proximity block box.
  → **Roles are how the industry makes one box list answer many questions.** This is the model for his
  *"as platforms, to handle elevation, to deterine contact dmg, spell dmg, range"*.
* **Skullgirls**, Mizuumi's legend (<https://mizuumi.wiki/w/Skullgirls/Game_Data_Legend>) and data page
  (<https://mizuumi.wiki/w/Skullgirls/Game_Data>): eight colours, and the SAME hurtbox changes colour frame by
  frame as its invulnerability state changes (strike-invulnerable, throw-invulnerable, projectile-invulnerable,
  air-blocking). Measured: standing hurtboxes 262px to 456px at 720p, crouch 212 to 362, ground throw range
  102 to 275, fastest active hitbox 1 frame.
  → **A frame's box record carries STATE, not only geometry.** So the role list belongs on the BOX, per frame,
  not on the tile.
* **Correction to the brief, stated plainly:** there is no public Mike Zaimont / Lab Zero GDC talk on hitbox
  authoring, and no public Arc System Works talk on it either. The confirmed Skullgirls GDC talk is Mariel
  Cartwright's 2014 Animation Bootcamp session on animation timing
  (<https://www.gdcvault.com/play/1020017/Animation-Bootcamp-Fluid-and-Powerful>) and the confirmed Guilty Gear
  Xrd talk is Junya Motomura's on cel-shaded rendering
  (<https://www.ggxrd.com/Motomura_Junya_GuiltyGearXrd.pdf>). Neither covers collision authoring. The public
  record on how these games author boxes is community reverse engineering, not developer documentation.
* **How many boxes per frame?** No source publishes a policy number. The legend structures imply roughly
  **1 pushbox + 1 to 2 hurtboxes + 1 hitbox while active**, so on the order of **3 to 5 simultaneous boxes**.
  → Size the format for a handful per frame, not hundreds. A flat array is right, an index is not needed.

### 4.2 The long weapon, which is his exact example

* **2D practice**: hand-place several rectangles, one per segment of the swept arc, live on the frames that
  segment would connect. This is the "group of rectangles" definition applied literally.
* **3D practice**, documented in three independent places: attach the test to a **bone/socket** on the weapon
  and every simulation frame **sphere-trace from the socket's PREVIOUS frame world position to its CURRENT**
  one, so the swept volume is covered rather than two static poses.
  <https://combo-graph.github.io/collision/> · <https://github.com/rlewicki/MeleeTrace>
  → **His instinct is the 2D industry answer, verbatim:** *"we'd have to draw multiplw hitboxes that follow the
  same pattern of the chain"*. Take it. The sweep is the later upgrade for fast attacks that would otherwise
  tunnel through a target between two frames, and §10 lists it as out of scope for this ticket.

### 4.3 Where per-frame boxes get stored, in real formats

| format | shape vocabulary | per frame? | what it means here |
|---|---|---|---|
| **Aseprite slices** <https://www.aseprite.org/docs/slices/> | rectangle only | **yes**, a `keys[]` array, each entry `{frame, bounds, center}` | the closest precedent for our shape: a box keyed by FRAME INDEX |
| **Tiled** <https://doc.mapeditor.org/en/stable/reference/json-map-format/> | polygon, polyline, ellipse, point, each with `properties` | **yes, indirectly**: a tile's `animation[]` points at other tile IDs, and each of those tiles carries its own `objectgroup` | **this is already how our engine is built.** A sprite frame is `{tileId}`, and a frame's tile row can carry its own boxes. That half is free |
| **LDtk** | `tileRect` only, rectangles | no | not a model for us |
| **Spine / DragonBones** <http://esotericsoftware.com/spine-bounding-boxes> | arbitrary polygon, vertices **keyable per frame** | yes, the most powerful | overkill: our tiles are block-aligned solids, not deforming meshes |
| **PhysicsEditor** <https://www.codeandweb.com/physicseditor> | circles + auto-decomposed convex polygons | yes, as a workflow (one image per frame) | the authoring workflow we are copying, not the shape |
| **Box2D** <https://box2d.org/documentation/md_collision.html> | polygons must be **convex**, up to `b2_maxPolygonVertices` | n/a | **a reason to stay with boxes and wedges.** Concave means decomposition, and decomposition means a second representation to keep honest |

* **A real constraint, found and worth obeying:** a workflow writeup on this exact problem
  (<http://gsyfuy.blogspot.com/2019/04/workflow-for-authoring-hitbox-data-for.html>) rejects pure per-frame
  hand authoring past roughly 30 to 100 frames as unscalable, and rejects auto-deriving boxes from sprite alpha
  as unreliable *because the boxes are context sensitive*: no segmentation can tell the weapon from the torso.
  → **So a box must be authored ONCE at rest and overridden only on the frames that need it.** That is exactly
  the precedence ladder in §5.4, and it is why the ladder exists rather than a box per frame per tile.

### 4.4 Godot and Unity: two camps, and which one fits

* **Godot camp A** (the mainstream, GDQuest <https://www.gdquest.com/library/hitbox_hurtbox_godot4/>): an
  `Area2D` with a static `CollisionShape2D` whose `disabled` bool is keyframed by an `AnimationPlayer`, so the
  box is on for a TIME WINDOW. Godot's own docs confirm `disabled` and recommend `set_deferred`
  (<https://docs.godotengine.org/en/stable/classes/class_collisionshape2d.html>). kidscancode's recipe also
  keyframes the shape's `Extents` (<https://kidscancode.org/godot_recipes/3.x/animation/melee_attacks/>).
* **Godot camp B**: generate a distinct collision polygon per `AnimatedSprite2D` **frame index**, driven off the
  `frame_changed` signal (<https://docs.godotengine.org/en/stable/classes/class_animatedsprite2d.html>).
* **Unity** has no first-party answer and three camps argue in one thread
  (<https://discussions.unity.com/threads/2d-hitboxes-hurtboxes-based-on-frame.393545/>): animation events,
  keyframed collider properties, and a fully custom per-frame array. The fighting-game-grade poster abandons
  Mecanim outright because `Mathf.Floor(durationInFrames * normalizedTime)` is not frame-precise, and stores
  **a per-frame array of hitboxes and hurtboxes**. The `SpriteCollider` asset does the same
  (<https://github.com/Refsa/SpriteCollider>), with exactly two types, Hitbox and Hurtbox.
* **The disagreement**: time-window versus frame-index.
  **This spec picks frame-index**, for a reason that is specific to this engine and not a preference:
  `spriteFrameIndex` (`tileAnimation.ts:398`) is already pure and clock-derived, and `spriteFrame`
  (`render/assetAnimation.ts`) already resolves the live frame per view. A time window would be a SECOND clock
  to keep in step with that one, and the Unity thread is a record of what happens when those two drift.

### 4.5 Isometric: the world is not isometric, the CAMERA is

* **Amit Patel, Red Blob Games** (<https://simblob.blogspot.com/2014/07/pathfinding-on-isometric-grids.html>):
  *"Isometric is not part of the game world. Isometric is how you look at the game world."*
  → **The load-bearing sentence of this whole spec.** Boxes live in grid space, in blocks. Rotating the camera
  changes nothing about them, which is why the whole system stays cheap.
* **Clint Bellanger** (<https://clintbellanger.net/articles/isometric_math/>): *"Probably all of your game
  calculations (e.g. collisions) will happen in square map coordinates. You only project to screen pixels when
  you need to draw something."* Forward: `screen.x = (map.x - map.y) * W/2`, `screen.y = (map.x + map.y) * H/2`.
  → That is exactly `viewToScreen` in `iso.ts:505`, and its inverse is `screenToCell`. Nothing new is needed.
* **Factorio** (<https://lua-api.factorio.com/latest/prototypes/EntityPrototype.html>) is the best-documented
  data model in the field: `collision_box` is a float `BoundingBox` **relative to the entity**, default empty
  (*"Empty collision box means no collision"*), `selection_box` is a SEPARATE box for mouse picking, and
  `collision_mask.layers` is a third, independent set naming what it collides with.
  → **Three lessons, all taken.** A box is stated relative to the THING, not to a coordinate, which is precisely
  his correction. An empty box list means "no collision", which is already `collisionBoxes.ts:12`'s rule.
  And the mask layers are the `roles` idea, proven in a shipping game.
* **Diablo 2** (<https://d2mods.info/forum/viewtopic.php?t=38232>, and the reimplementation at
  <https://github.com/jankowskib/D2Ex2/blob/master/CollisionMap.cpp>): each tile is divided into **5x5
  subtiles**, binary blocked/free.
  → Sub-cell precision by SUBDIVIDING. We get the same precision from fractional box extents, which is finer,
  needs no second grid, and is already how `tileThicknessReach` states a door's 0.3 panel.
* **Age of Empires 2** (<http://richg42.blogspot.com/2018/02/on-age-des-pathingmovement.html>): **circular**
  obstruction radii for units, **square** footprints for buildings, over a discrete terrain grid, with
  villagers switching between two radii contextually.
  → Validates running both: a discrete grid for terrain and pathing, continuous boxes for props and units.
* **Project Zomboid** is the genuine dissent: a wall belongs to a square's **north or west EDGE**, never to the
  square, and `isBlockedTo(otherSquare)` is an edge query.
  **Side taken: per cell, with fractional boxes**, because a box flush against one face IS the edge wall, and
  this engine already authors exactly that: a door ships `scaleZ 0.3` + `thicknessDir left-down`
  (`tile_source.ex` @behavior_settings), resolved by `tileThicknessReach` (`tileset.ts:323`) into the four
  reaches `reachGroundQuad` (`isoBlock.ts:105`) builds the parallelogram from. Moving to edges would mean a
  second store keyed by edges and a second authoring surface, to express what the existing one already says.
* **Godot 4 TileSet** (<https://docs.godotengine.org/en/stable/tutorials/2d/using_tilesets.html>): collision
  polygons are authored per tile in **tile-local space**, and Y-sort is a separate, independent system.
  → Same split this spec keeps: boxes are tile-local, the depth sort stays where it is and is not touched.
* **Depth sorting with elevation** is a solved and SEPARATE problem: Shaun LeBron
  (<https://shaunlebron.github.io/IsometricBlocks/>) shows that raising z by 1 is geometrically the same as
  raising x and y by 1 in iso, and that the correct general answer is a topological sort with Tarjan's SCC for
  cycles; jwopitz (<https://jwopitz.wordpress.com/2008/09/03/absolute-isometric-depth-sorting/>) handles the
  tall-object-on-a-lower-plane case.
  → **Explicitly out of scope.** That is `isoDepthCompare` (`iso.ts:1642`) and ticket 7. Mixing them is how a
  collision change starts moving pixels.

### 4.6 Elevation: three models, and the one this engine already is

| model | who | shape |
|---|---|---|
| **stacked complete levels** | Dwarf Fortress, Tibia (16 floors, `zz` 00 to 15, ground = 07), Project Zomboid (8 storeys historically, up to 32 per chunk and down to -31 in B42) | `block[col][row][level]`, integer, index lookup |
| **per-item continuous Z** | Ultima Online: every item carries its own Z, a `surface` tiledata flag marks standable, the player *"snapped to the first surface below their Z anchor point at their feet"*, and too large a Z gap is impassable | runtime scan, no level concept |
| **corner heights / heightmap** | OpenTTD (4 corners N/E/S/W, `SLOPE_W=0x01 SLOPE_S=0x02 SLOPE_E=0x04 SLOPE_N=0x08`, `SLOPE_FLAT=0x00`, named 2- and 3-corner combos plus `SLOPE_STEEP`, `SLOPE_ELEVATED`, `SLOPE_HALFTILE`, `NUM_SLOPES = 19`), SimCity 4 (greyscale 0 to 255, sea level 83) | one surface, locally tilted |

Sources: <https://dwarffortresswiki.org/index.php/DF2014:Ramp> · <https://tibiamaps.io/guides/map-file-format> ·
<https://projectzomboid.com/blog/news/2022/09/upstairs-downstairs/> ·
<https://www.raphkoster.com/games/snippets/ultima-online-terrain/> ·
<https://raw.githubusercontent.com/OpenTTD/OpenTTD/master/src/slope_type.h>

**The sharpest disagreement in the whole research**, and it has to be settled: the elevation researcher's
verdict is that a LEGO `(col,row,level)` engine should take model 1 and NOT corner heights, because
*"retrofitting OpenTTD-style corner heights onto integer levels would break the one-block-per-cell invariant"*.

**Side taken: both, on a hard line that Dwarf Fortress itself draws.**

> **The integer `level` stays authoritative for every question of game LOGIC.** Which block this is, which
> level a unit is on, what stacks on what, what the depth sort compares, what pathing walks. That is model 1,
> it is what `heightLevel` + `cellStackTop` already implement, and nothing in this ticket touches it.
>
> **The corner heights only shape the SURFACE INSIDE one block.** They are bounded by that block and can never
> move a unit to another level. That is what turns a stair from a stack of cubes into a slope you glide up.

Dwarf Fortress draws the same line: its z-level logic is fully discrete, and its RAMP is the one move that
changes X, Y and Z together in a single step. Project Zomboid draws it too: the player's Z is floored to get
the floor index (*"if your Z is 0.99 instead of 1.00 you are NOT on floor 2"*), and the continuous part is only
what lives between the floors. And it is the gap in the record worth naming: **AoE2 publishes its integer
elevation (1 to 7, extended to 16 in DE) and its flat +25% downhill / -25% uphill, and publishes no formula at
all for how a unit's rendered Z interpolates across a ramp tile.** That unwritten formula is what the triangle
box is for.

**Why four corners and not a one-axis ramp:** OpenTTD needs **19** named slopes, and it derives all of them
from four corner heights rather than authoring a shape per case. A one-axis ramp cannot express a mountain's
outside corner, and he asked for mountains. Four numbers cover stairs, ramps, corners and plateaus, and a
`square` is just all four equal.

**The rejected alternative, named:** Minecraft's stairs are **two boxes**, a bottom slab plus a back step, with
no continuous ramp at all (<https://learn.microsoft.com/en-us/minecraft/creator/documents/voxelshapes>). That
is cheaper and it is what this engine would get by stacking. It is rejected because it is exactly the look
ticket 7 was rejected for. The useful half of it is kept: **several boxes on one tile is normal**.

**And one more model that is NOT a model:** RPG Maker has no Z axis at all, only draw-order layers and a "star"
passability value meaning *defer to the layer beneath*. Civilization VI's hills are a movement cost, not a
height. Both are here so nobody proposes them later.

### 4.7 Slopes: the surface height function

* **The Sonic Physics Guide** (<https://info.sonicretro.org/SPG:Solid_Tiles>) is the canonical source: each
  16x16 tile stores a **height array of 16 values**, one per pixel column, plus a single **angle byte** (0 to
  255) resolved through a lookup table, used both to rotate the sprite and to split ground speed into X and Y.
  → **Our triangle is the analytic form of exactly this.** The array is that same function pre-sampled per
  column. The array buys non-linear curves (loops), which this engine does not want, so a bilinear read of four
  corners is the cheaper equivalent. The ANGLE is worth copying: derive it from the corners rather than storing
  it, so the two can never disagree.
* **Celeste / TowerFall** (<https://www.maddymakesgames.com/articles/celeste_and_towerfall_physics/index.html>):
  every collider is an axis-aligned integer box, movement is one pixel at a time with a callback on the first
  blocking pixel. **The canonical article does not cover slopes at all**, so Celeste is not evidence either way
  and it is not cited as such here.
* **Godot** gives a collision polygon per tile plus a `one_way_collision` bool and a
  `one_way_collision_margin` on the moving body, which is how a platform is passable from below.
  → `one_way` is a role in our model, listed in §10 as not built by this ticket.

### 4.8 Walkable slope, with the actual numbers

* **Unreal**: `WalkableFloorAngle` default **44.765 degrees**, stored as `WalkableFloorZ = cos(angle)`, with
  per-surface `WalkableSlopeBehavior` overrides (Increase up to 90, Decrease down to 0 meaning never walkable).
  <https://dev.epicgames.com/documentation/en-us/unreal-engine/walkable-slope-in-unreal-engine>
* **Source / GoldSrc**: `PM_CategorizePosition` walks a surface only when the plane normal's Z is **greater
  than 0.7**, which is `acos(0.7) ~ 45.57 degrees`. GoldSrc snaps to ground only 2 units below the player;
  Source's `StayOnGround` searches `StepSize` (typically 18 units) below, **and that one difference is why
  GoldSrc characters bounce down slopes and Source characters glide**.
  <https://www.ryanliptak.com/blog/source-vs-goldsrc-movement-slopes/>
* **Unity**: `CharacterController.slopeLimit`, plain degrees, the doc's own example sets 45.
* **Ultima Online**: too large a Z gap between two surfaces was simply impassable, and that rule lived in the
  tile definitions.
  → **Three numbers become backend `game_rules` data, never constants:** `maxStep` (how high you may step up),
  `maxSlope` (how steep a surface you may stand on, ~45 degrees everywhere in the industry) and `snapDown`
  (how far below your feet a surface still holds you). **The third one is not optional**: without it a unit
  walking DOWN a ramp bounces, which is the GoldSrc bug, measured and written up.

### 4.9 Per view: the verdict, and it goes against a literal reading of the requirement

**Nobody keeps separately authored collision per camera projection.** Every case examined keeps ONE spatial
representation and derives the current view's answer by projecting it, with an explicit rule for the depth
ambiguity that projecting introduces.

* **Fez** is the closest anything gets, and it is the key case
  (<https://theinstructionlimit.com/behind-fez-collision-and-physics>,
  <https://gdcvault.com/play/1015731/Cubes-All-the-Way-Down>). The world is genuinely 3D: triles, each a
  16x16x16 volume, with one solid flag per trile. The camera has **four fixed facings**. Collision is computed
  against the CURRENT facing's 2D projection: the engine looks up the 4 nearest 1D rows of candidate collider
  cells in screen space and walks each **front to back**, and the nearest solid trile along the current depth
  axis wins. Which world axis IS "depth" changes per facing; the trile data never does. **The per-facing map is
  a CACHE rebuilt once on rotation, not authored data.** Player depth ambiguity is settled by three authored
  rules: Gomez always renders in front, always stands on the platform nearest the camera, and his depth never
  visibly changes.
* **Super Paper Mario**: depth "panes", and in 2D mode everything in the player's pane has its hitbox extruded
  and the player is snapped to a depth within it.
* **Crush** (PSP): 5 fixed angles, each flattening the one 3D level along a different axis.
* **echochrome**: goes furthest, colliding against the screen-space silhouette outright, *"what you see is the
  truth"*, overriding the real 3D geometry when perspective makes disjoint paths look joined.
* **Godot and Unity**: collision layers/masks are a gameplay filter, completely orthogonal to camera
  projection. **No engine feature in either selects authored collision sets by projection.**

**So what does *"hitboxes are PER VIEW"* and *"the system should select the hitbox layer associated with the
view and apply it correctly"* become?** It becomes exactly Fez: **one authored solid, a per-view PROJECTION,
cached per view, with a per-view override for the case the projection cannot express.** The selection is real
and it is a real function (`hitBoxesForView`), the per-view answers genuinely differ (iso keeps the volume, top
keeps the footprint, 2D keeps the front elevation), and his statement of the three views in MAP-MODEL §2 is
precisely the projection table. What it does NOT become is three hand-authored sets per tile, because the only
game that ever needed something close to that derived them and cached them, for the reason Fez's own author
gives: a derived view updates every facing from one edit, and hand-kept sets do not.

### 4.10 Performance: the grid is already the broad phase

* **Broad phase then narrow phase** is the settled split (Ericson, *Real-Time Collision Detection*, p.14;
  <https://lavalle.pl/vr/node262.html>). Box2D's broad phase is a dynamic AABB tree costing roughly
  `k*log(n)` (<https://box2d.org/doc_version_2_4/classb2_dynamic_tree.html>).
* **A spatial hash IS a uniform grid.** Teschner et al.
  (<https://matthias-research.github.io/pages/publications/tetraederCollision.pdf>) define it as splitting each
  axis by a cell size and combining the per-axis indices; the hash exists only to compress an unbounded or
  sparse grid into a finite table. A quadtree's entire value is adapting cell size to uneven density
  (<https://gameprogrammingpatterns.com/spatial-partition.html>).
  → **This world is bounded, uniform, and every box is grid-aligned. The index is `row * cols + col`.** There
  is no hash to compute and no density to adapt to. **No quadtree, no spatial hash, and the reason is stated
  rather than assumed.**
* **Sweep and prune** wins only under high temporal coherence and degrades toward O(n^2) when many objects
  share an axis (<https://leanrada.com/notes/sweep-and-prune/>). A grid gets the coherence benefit for free,
  because an entity that has not changed cell costs zero broad-phase work.
* **The JS budget**: ~10,000 boxes per frame is the measured practical 60fps ceiling, and the article
  attributes the cost to **cache locality and indirect memory access, not operation count**
  (<https://0fps.net/2015/01/23/collision-detection-part-3-benchmarks/>).
  → Our worst case is a few hundred boxes in view. **Two orders of magnitude inside the ceiling.**
* **What actually costs in V8** (<https://web.dev/articles/speed-v8>, and
  <https://www.gamedev.net/articles/programming/general-and-gameplay-programming/writing-fast-javascript-for-games-interactive-applications-r3516/>):
  per-frame allocation feeding GC, hidden-class instability from adding properties after construction,
  megamorphic call sites, sparse arrays. Structure-of-arrays over array-of-structs is worth 10 to 40% on
  hot per-field loops.
  → Every box is constructed once at install with **every field present** (no optional-property shape churn),
  the per-frame resolver writes into a **reused buffer**, and the hot path is monomorphic.
* **Triangle cost**: the general AABB-versus-triangle test is 13 SAT axes (Akenine-Moller,
  <https://fileadmin.cs.lth.se/cs/Personal/Tomas_Akenine-Moller/code/tribox_tam.pdf>); point-in-triangle by
  three edge functions is about 9 flops.
  → **We never pay either.** Our triangle is a **height field over an axis-aligned footprint**, not a free
  triangle in space, so the test is the square's 6 compares plus one bilinear read of four corners. That is the
  single reason the third shape is affordable, and it is why the shape is a **wedge** and not a polygon.
* **Fighting games bake and look up**, they do not compute geometry in the simulation loop
  (<https://fighterfundamentals.home.blog/2019/03/30/frame-data-and-hitboxes/>).
  → Bake per `(tile, frame, view)` at catalog install. §5.8.

---

---

### 4.11 Choosing the heights: `perlin(x, z)`, and why one noise is not enough

**This is settled, not open.** His instruction, 2026-09-16: *"we must use perlin(x,z) on our terrain for
elevation, ticket 2 context"*.

**Source:** *"I Added ELEVATION to my 2D Game"*, Isocore devlog, 12:06,
`https://www.youtube.com/watch?v=ez68sFkO6Qo`. A Unity 2D isometric sandbox that went from a flat world to a
stacked one, so the problems it hits are ours almost line for line: an orthographic camera, a block-stacked
world, and a sorting order that has to survive objects taller and wider than one cell.

#### What it teaches us to BUILD

1. **Pure random per column is unusable** `[04:29]` to `[04:41]`. *"The change in height are just way too
   drastic and unpredictable."* A `rand()` per cell is terrain-shaped noise, not terrain.
2. **A periodic function is the opposite failure** `[04:44]` to `[04:50]`. A sine curve changes gradually and
   *"just repeats itself every time"*, so the organic randomness is gone. Both halves are needed at once.
3. **Perlin is exactly the pairing of the two** `[04:53]` to `[05:08]`: a value between a set minimum and
   maximum, 0 and 1 in his case, that *"instead of jumping harshly ... smoothly transitions between them"*.
   This is the whole reason it is the named choice.
4. **Octaves add detail without changing the range** `[05:17]` to `[05:37]`: summing the noise at rising
   frequency and falling amplitude keeps the result inside 0 to 1 but *"has much more detail and looks more
   organic"*. One octave reads artificial; several read like ground.
5. **ONE noise field still comes out flat and samey**, and this is the step that matters most `[05:42]` to
   `[06:43]`. A single field is applied to a constant base height (sea level), so the whole map is gentle
   undulation with no structure in it. The fix is a SECOND, lower-frequency noise field read through a
   **height profile**: a table of bands that maps the second field's value to the BASE height for that
   region. Where the band changes, the base height jumps, and *"that results in some very nice looking
   cliffs"*. The first field is then added on top of whatever base the profile gave, so you get *"small
   details, large cliffs and mountains"* from the same two functions.

   So the shape is, and this is the part to implement:

   ```
   base   = profile(noise2(x, z))        // a band table: a step function, deliberately discontinuous
   detail = octaves(noise1(x, z))        // smooth, small amplitude
   height = base + detail
   ```

   The cliffs come from the profile being a STEP function. Smoothing it would remove exactly the feature it
   exists to produce.

   His worked example is a band table like `[0, 0.25) → -10`, `[0.25, 0.85) → 5`, with a narrow band near
   `0.58` jumping to `25`. **The auto-transcript garbles those bounds** (the last band sits inside the
   previous one), so take the SHAPE as the fact and treat the numbers as illustrative: a small number of
   bands, most of the map on one or two of them, and a narrow high band that produces the rare peak.
6. **Water falls out of elevation rather than being placed** `[06:45]` to `[06:51]`: *"each air block that is
   below the level of zero becomes water"*, which gives lakes and oceans for free. Cross-reference
   `WATER.md`: that framework paints water as terrain, and this is the generator rule that would decide
   WHERE, once elevation exists. It does not replace painting a river by hand, it adds the bodies nobody
   placed.
7. **Depth perception is the unsolved cost of an orthographic camera** `[07:01]` to `[07:48]`, and he says so
   plainly: a sprite far away is the same size as one close, so *"it's very hard to tell where a certain
   layer ends and where a new one begins"*. He added outlines on the edges where terrain drops; it helps,
   but *"it's not possible to tell how far down it goes"*, and he asks the audience for ideas. **Take this
   as a warning, not a solution.** Our §4.5 camera facts and `RENDER-AND-CAMERA.md` say the same thing from
   the other direction, and it means elevation needs a readability pass of its own (shading by level,
   cast shadow, a rim that darkens with depth) budgeted as part of the work rather than discovered after.
8. **Sorting is where the time actually goes**, `[08:01]` to `[10:49]`, and he calls it *"the most difficult
   problem that I faced"*. Four facts worth having before we start:
   - Flat sort order is `-(x + y)`: adding the axes gives horizontal rows, negating puts near rows in front
     `[08:27]` to `[08:52]`.
   - Adding the height value to that works **for blocks only** `[08:55]` to `[09:03]`.
   - Averaging a multi-cell object's cell orders *"breaks as soon as an object has a diameter larger than
     two"* `[09:11]` to `[09:22]`, and he could not find a closed-form fix.
   - What worked `[09:29]` to `[09:58]`: **weight the y-axis so it dominates**, sort within a layer by the
     MEDIAN of that layer's cells, and **slice any object taller than one block into horizontal slices at
     runtime**, giving each slice its own base order plus the weighted layer order. That is how a single
     scalar can sort objects bigger than 2 cells.
   - The trap that cost him a rewrite `[10:06]` to `[10:49]`: a whole tilemap layer shares ONE sorting order
     because it is one mesh, so a unit can render in front of or behind the layer but never BETWEEN two
     blocks of it. He had to write per-block sorting. **We are not exposed to this one**, because this
     engine already draws per cell from a stack rather than as a batched mesh, and that is worth knowing
     before someone proposes batching terrain for performance: it would buy frame time and cost the ability
     to stand between two blocks.

#### What it teaches us to OFFER

Per the two-halves rule at the top of `FRAMEWORKS.md`, the second reading:

- **The height profile is a served preset, not a constant.** It is a band table, which is data, and it is
  precisely the knob that decides whether a map is rolling farmland, a plateau with cliffs, or a mountain
  range. A user should pick "rolling", "plateau", "mountains", "canyon" and get a different band table,
  exactly the way a generator already picks a liquid or a crossing. Author the tables in the backend beside
  the other generator config.
- **Octave count and amplitude are the "how rugged" slider**, and they are two numbers, so they can be one
  served option with named steps rather than raw fields.
- **This is the same shape as the `physics` presets** in `TILE-EFFECTS.md` §3: a named piece of maths defined
  in the backend, chosen by the user by its RESULT rather than written by them. Elevation should not invent a
  second mechanism for that. Whichever way a preset gets expressed there, this uses it.
- **Noise-against-a-threshold is already in the bank.** `TILE-EFFECTS.md` §0 lists it as primitive 1, lifted
  out of the grass source, and the height profile is that primitive with several thresholds instead of one.
  Two sources arriving a day apart described the same tool, which is the argument for one implementation of
  it rather than one per feature.

#### What this changes in the plan

**Step 14** below is the row this lands in. It currently says the pass *"raises regions and cuts a ramp
wherever a way crosses a level change"* without saying how the regions are chosen. They are chosen by
`base + detail` above, the profile is served, and the ramp cutting stays exactly as written: a cliff from a
band edge is what makes a ramp necessary in the first place.

### 4.12 The terrain math runs FIRST, and it decides the mountains too

His note, 2026-09-17, which changes where this lands in the layer order:

> *"our elevation will change everything on terrain, because we'll apply math that will randonmize the terrain
> forms, and based of that, we want to use the same formulla to determine the volcano and other mountains
> height, that said, we still can have some pre-made objects, but in most cases, we'll just run the terrain
> math as the first layer that runs after grid-generatoon, before rivers, and pathways and everything else."*

Three things follow, and none of them is what the current order does.

1. **It is the FIRST layer after the grid**, ahead of water. Today `terrain` paints a floor and the relief a
   region asks for, and the river is cut afterwards. Under this, the land has its shape before anything is cut
   into it, and the river then runs downhill through relief that already exists rather than carving a channel
   into a flat plane.
2. **One formula for every raised thing.** A volcano's height and a mountain's height come out of the same
   function, sampled at different places, rather than a mountain being terrain and a volcano being an object
   with its own hand-set `scaleY` profile. The volcano composition built on 2026-09-17 is explicitly a
   placeholder for that: *"we'll handle the elevation in ticket 2, for now we just need to have the base art"*.
3. **Pre-made objects survive but stop being the rule.** *"we still can have some pre-made objects, but in most
   cases"* the math decides.

`REGIONS.md` §4 states mountain and volcanic region sets with `level` steps between their bands. Those are a
PLACEHOLDER for this formula and must give way to it, not compete with it.


## 5. The data model

### 5.1 Where a box lives, and why there

**A box is a SETTING on the TILE**, in `tiles.settings.hitboxes`. Not a column, not a table, not a new
resource. His words: *"in most cases, we'd just threat it as an extra layer of settings applied on top of
everything else"*.

Four reasons this is the right home and not a convenience:

1. `settings` is already served **verbatim** (`tileset_json.ex` `tile_data/1` passes `t.settings` straight
   through) and read verbatim (`tilesetLoader.ts:128`). Adding a key costs zero wiring on either side.
2. `Catalog.put_tile_setting/4` is **pose-safe**: it merges one key and leaves every editor-tuned pose alone.
   A column or a full upsert would `replace_all` and clobber them, which is a mistake this repo has already
   made once and written down.
3. It rides the **same precedence ladder** as `height`, `stackAt`, `actAsTile` and `collision`, so collision
   cannot drift from the facts it has to agree with. That ladder is `cellStack.ts:222`, `:247` and
   `collisionBoxes.ts:42`, and it is three identical functions today.
4. **A unit is a tile.** 79 `units`-category rows. Boxes on a tile row cover the boss for free.

The same key rides three more places, unchanged in shape:

| where | column | who writes it |
|---|---|---|
| a tile | `tiles.settings.hitboxes` | the backend seeders and migrations |
| a composition cell | `composition_cells.settings.hitboxes` | the backend, copied onto the placed asset by `stampComposition` exactly like `animations` and `light` |
| one placed tile | `GridAsset.settings.hitboxes`, round-tripped in `Template.assetsData` | the editor inspector |
| one animation FRAME | `AnimFrame.hitboxes` inside `settings.animations[].frames[]` | the animation modal |

### 5.2 The box itself

**A box is stated in BLOCKS, in the TILE's own frame.** Not in cell fractions glued to a coordinate. His
correction, verbatim: *"collissions and hitboxes aren't glued to a coordinate, they're part of a cell, in fact,
they're linked to the tile in the cell"*. Factorio states it the same way: `collision_box` is a bounding box
**relative to the entity**.

The frame's origin is the tile's anchor block's near-lower corner. `+col`, `+row` and `up` are the axes, and
the unit is one BLOCK. So a box rides its tile through zoom, pose, thickness, z-width, stack level and
building rotation, and it does not have to be restated when any of those change.

```ts
// src/engine/hitbox/hitbox.ts
import type { TileView } from '@/engine/tileset/tileViewSettings'

/** The three solids, in his words. `triangle` is the SOLID whose side elevation is the triangle: a wedge. */
export type HitShape = 'square' | 'skew' | 'triangle'

/**
 * What questions this box answers. One box list serves every system, which is the whole point
 * ("as platforms, to handle elevation, to deterine contact dmg, spell dmg, range"), and a role is what keeps a
 * boss's chain from becoming a floor you can stand on.
 */
export type HitRole =
  | 'solid'   // you cannot pass through it
  | 'support' // you can stand on its top face. THIS is the elevation role
  | 'hurt'    // it TAKES damage (the body of the thing)
  | 'hit'     // it DEALS damage (contact damage, the swinging chain)
  | 'sensor'  // it notices without blocking (range, spell area, a trigger volume)

export interface HitBox {
  /** Which solid. Drives a dispatch map, one tester per shape, never an if-chain. It also buys the fast path:
   *  a `square` is 6 compares, a `triangle` adds a bilinear read, so the 99% case never pays for the 1%. */
  shape: HitShape

  /** The near corner, in the tile's own frame, in BLOCKS. */
  col: number
  row: number
  level: number

  /** Extents in blocks: width along +col, depth along +row, height up. Fractions are the point: a door panel
   *  is `d: 0.3`, the same 0.3 `tile_source.ex` already authors as `scaleZ`. */
  w: number
  d: number
  h: number

  /** TRIANGLE ONLY. The four corner heights of the TOP face, in blocks above `level`, in GRID order:
   *  [colMin/rowMin, colMax/rowMin, colMax/rowMax, colMin/rowMax]. Grid order, never screen names, because the
   *  camera turns and the grid does not (`DEPTH_CELL_STEP` states its axes the same way, isoBlock.ts:258).
   *  A stair sets one pair low and the other high; a mountain's outside corner sets three low and one high.
   *  A `square` is all four equal to `h`, which is why OpenTTD derives 19 named slopes from 4 numbers. */
  top?: readonly [number, number, number, number]

  /** SKEW ONLY. How far the TOP face slides, in blocks, along +col and +row. The same shear
   *  `reachGroundQuad` already builds (isoBlock.ts:105), so the renderer draws it with the basis it has. */
  lean?: { col: number; row: number }

  /** Absent is not allowed on the wire: the seeder writes it on every box, so "nobody got round to it" and
   *  "this box answers nothing" can never look the same. That distinction is why `ensure_collisions/0` writes
   *  an empty list rather than skipping a row. */
  roles: readonly HitRole[]

  /** PER-VIEW DEVIATIONS ONLY, the same contract `TileViewSettings` states. Absent means the box is
   *  PROJECTED (§5.6), which is the normal case. */
  views?: Partial<Record<TileView, HitBoxView>>
}

export interface HitBoxView {
  /** false = this box does not exist in this view at all. */
  on?: boolean
  /** Restate any of the box's own fields for this view. An absent field keeps the PROJECTED value. */
  box?: Partial<Pick<HitBox, 'shape' | 'col' | 'row' | 'level' | 'w' | 'd' | 'h' | 'top' | 'lean'>>
  /** Restate the roles for this view. Absent keeps the box's own. */
  roles?: readonly HitRole[]
}
```

**The three shapes, drawn in words:**

| shape | solid | side elevation | what it is for |
|---|---|---|---|
| `square` | a cuboid | a rectangle | a wall, a trunk, a body, a flat floor |
| `skew` | a cuboid whose top face slides sideways | a parallelogram | a leaning post, a slanted wall, a roof face, an overhang |
| `triangle` | a cuboid whose top face is a sloped patch | **a triangle** | **a stair tread, a ramp, a mountain face, a mountain corner** |

**On the name.** He wrote *"square, skewed/triangle"*. `triangle` is kept as his word. What is stored is the
SOLID, and its side elevation is the triangle he means, which is also exactly what the 2D view will show when
2D comes back (§6). Naming the solid rather than its silhouette is what lets one name work in all three views.

### 5.3 The surface height inside a box

```ts
/** The TOP of this box at the point (u, v) inside its own footprint, u and v in [0,1]. In blocks. */
export function boxTopAt(box: HitBox, u: number, v: number): number
```

* `square` and `skew`: `box.level + box.h`. A skew slides its top, it does not tilt it.
* `triangle`: `box.level + bilinear(box.top, u, v)`, which is
  `t0*(1-u)*(1-v) + t1*u*(1-v) + t2*u*v + t3*(1-u)*v`. Six multiplies and three adds.

That is the Sonic Physics Guide's height array, expressed analytically instead of sampled per column. The
array form buys non-linear curves (loops); this engine does not want those, so four numbers and a bilinear read
is the cheaper equivalent of the same function.

**The slope ANGLE is derived, never stored.** Sonic stores an angle byte beside the height array, and two
stored facts about one surface is two facts that can disagree. `boxSlopeAt(box, u, v)` returns the gradient from
the same four corners.

### 5.4 Which boxes are live, right now, on this asset

One ladder, four rungs, first hit wins. It mirrors `assetStackAt` and `assetActsAsTile` exactly, plus one rung
for the frame:

1. **the LIVE FRAME's boxes**, when the asset is playing a sprite animation in this view and the current frame
   declares a `hitboxes` key,
2. else **the asset's own** `asset.settings.hitboxes` (the editor, per placed tile),
3. else **the tile row's** `settings.hitboxes` (the backend, per label),
4. else **`[]`**, which means nothing solid. That is already the stated rule
   (`collisionBoxes.ts:12`: *"a tile is solid where its boxes are, and a tile with no boxes is not solid at
   all"*).

**An empty list is a statement, an absent key is not.** A frame that declares `hitboxes: []` has NO boxes,
which is what a wind-up frame needs. A frame that declares nothing inherits the tile's resting boxes. This is
the same distinction `water_still` already uses with its empty `animations` list, and the same one
`ensure_collisions/0` writes on every row.

**Why a ladder rather than a box per frame per tile:** the authoring research is explicit that hand-authoring
every frame does not scale past roughly 30 to 100 frames, and that auto-deriving from sprite alpha does not
work because boxes are context sensitive. The ladder means a tile is authored ONCE at rest and only the frames
that differ carry an override. A four-frame water tile carries zero frame overrides; a boss's swing carries
four.

The seam already exists. `spriteFrame(asset, now, style, view, dayNight)` in `render/assetAnimation.ts`
resolves the live frame today, gated by `animationMatchesScope` and the day/night rule. This ticket exports a
sibling that returns the same selection without resolving the picture:

```ts
/** The live sprite frame SELECTION for an asset in a view: which animation, which index, which frame.
 *  The picture-resolving `spriteFrame` becomes a thin caller of this, so there is ONE clock and one winner. */
export function spriteFrameSelection(
  asset: GridAsset, nowMs: number, style: Style, view: TileView, dayNight: DayNight,
): { animation: SpriteAnimation; index: number; frame: AnimFrame } | null
```

### 5.5 The frame

```ts
// src/game/runtime/entityAnimation.ts, one field added
export interface AnimFrame {
  tileId?: string
  char?: string
  flipX?: boolean
  /** The boxes that are live WHILE THIS FRAME SHOWS. Absent inherits the tile's resting boxes; an EMPTY list
   *  says this frame has none, which is what a wind-up frame needs. */
  hitboxes?: HitBox[]
}
```

That is the whole of the animated half. It works because this engine already made a frame a record
(`entityAnimation.ts:43`) and already made frame selection pure and per view. It is the same place Aseprite
puts a slice key and the same place Tiled effectively puts a per-frame collision shape.

**`flipX` flips the boxes too.** A mirrored frame whose boxes do not mirror is a bug that reads as
"the hit registers on the wrong side", and it has to be in the resolver, not left to the author.

### 5.6 Rotation

A box authored south-facing must turn with its building, exactly like `depthDir` and `thicknessDir` already do
(`rotateDepthDir`, `isoBlock.ts:272`; `rotateThicknessReach`, `:135`).

```ts
/** Turn a box by `rotation` CW quarter-turns about the tile's own anchor. Offsets rotate (col,row) -> (-row,col),
 *  `w` and `d` swap on an odd turn, the four corner heights cycle, `lean` rotates like an offset. */
export function rotateHitBox(box: HitBox, rotation: number): HitBox
```

**The CAMERA turning does not touch a box.** Red Blob: *"Isometric is not part of the game world."* Boxes are
grid-space facts, so a camera turn costs nothing, which is the whole reason this stays affordable.

### 5.7 Elevation

Two things exist today and they stay two things, on a line that Dwarf Fortress and Project Zomboid both draw:

**The CELL's elevation stays an integer, and stays authoritative.** `grid.height[row][col]`
(`IsometricGrid.ts:174`), whole blocks, saved as `Template.heightData`, captured by undo, drawn as cliffs
(`iso.ts:1565`). Every question of game LOGIC is answered off it and off `heightLevel`: which block this is,
what stacks on what, what the depth sort compares. **Nothing in this ticket changes any of that.**

**The SURFACE inside a block is what the triangle shapes.** Bounded by its own block, never able to move a unit
to another level.

```ts
// src/engine/hitbox/ground.ts

/** The surface height, in BLOCKS, at the fractional point (u,v) inside cell (col,row).
 *  The cell's own elevation plus the highest `support` top at that point. ONE reader, so the renderer, the
 *  walker and the overlay cannot drift the way the hand-written sum at iso.ts:2587 and the debug overlay's
 *  `surfaceLift` can. */
export function groundTopAt(grid: BoxGrid, col: number, row: number, u: number, v: number): number

/** The surface a unit standing at `fromZ` rests on: the HIGHEST support top within [fromZ - snapDown,
 *  fromZ + maxStep]. Null when there is none, which is a fall. */
export function standSurfaceAt(
  grid: BoxGrid, col: number, row: number, u: number, v: number, fromZ: number, rules: MoveRules,
): number | null
```

That is Ultima Online's rule exactly: *"players were snapped to the first surface below their Z anchor point at
their feet"*, with a `surface` flag marking which things are standable. Our `support` role IS that flag.

**`snapDown` is not optional.** GoldSrc searched 2 units below the player and its characters bounce down
slopes; Source's `StayOnGround` searches `StepSize` (about 18 units) and its characters glide. That difference
is measured and written up, and skipping it is choosing the bouncing version.

**`unitStandLevel` (`cellStack.ts:196`) keeps its signature and becomes a call into `groundTopAt`.** Every
caller is untouched. The test that matters is that it returns the SAME number as today on a generated town,
cell for cell, before any ramp exists.

**What ticket 3 asked for, "a cell carries its own elevation and texture, first class", is then true:** the
elevation is `grid.height` (already saved and undoable), the texture is the floor TILE (already an asset since
floors stopped being a separate store), and the surface between blocks is the floor tile's own `support` box.
Three facts, each on the thing it describes, none derived at draw time.

### 5.8 Per view: the selection rule

**Authored once, projected per view, cached per view, overridable per view.**

```ts
/** The boxes this asset presents to `view`, for the frame that is live at `nowMs`. Memoized per
 *  (tileset, label, animation id, frame index, view), so a frame's answer is computed once per catalog install
 *  and read from a map thereafter. Fighting games bake, they do not compute in the loop. */
export function hitBoxesForView(
  asset: GridAsset, view: TileView, nowMs: number, style: Style, dayNight: DayNight,
): readonly HitBox[]

/** Project ONE box into ONE view. Pure, total, unit-tested per shape. */
export function projectBox(box: HitBox, view: TileView): HitBox | null
```

The projection table is MAP-MODEL §2's table, made executable:

| view | axes kept | axes collapsed | what happens to the shape |
|---|---|---|---|
| `iso` | col, row, level | none | the box as authored. Width x Height x Depth |
| `top` | col, row | level, h | the FOOTPRINT. `level` 0, `h` 1, `top` and `lean` dropped: top view hides elevation |
| `2d` | col, level | row, d | the FRONT ELEVATION. `row` 0, `d` 1, and a `triangle`'s four corners fold to the two on the col axis, `max(top[0],top[3])` at colMin and `max(top[1],top[2])` at colMax, so the wedge's silhouette IS the triangle |

`projectBox` returns the same `HitBox` type with the collapsed axes normalised rather than a second type. Two
reasons, both real: one type means one set of testers and one dispatch map, and one object shape means V8 keeps
a single hidden class down the hot path.

A box with `views: { top: { on: false } }` simply does not exist in the top view. A box with
`views: { '2d': { box: { h: 2 } } }` is the projected 2D box with its height restated. **Deviations only**, the
contract `TileViewSettings` already states.

**Why projection and not three authored sets, said plainly:** §4.9. Nobody authors per-projection collision.
Fez, which comes closest and is the reference case, keeps ONE trile grid and rebuilds a per-facing cache on
rotation, because a derived view updates every facing from a single edit and hand-kept sets do not. The
selection he asked for is real and it is `hitBoxesForView`; what it selects is a projection.

### 5.9 The Elixir side, exactly

No new table and no new column. One new module for validation, one migration per authoring batch.

```elixir
defmodule Nebulith.Catalog.HitBox do
  @moduledoc """
  ONE hitbox, as a tile's `settings.hitboxes` entry.

  A box is stated in BLOCKS, in the TILE's own frame: `col`/`row`/`level` is its near corner and `w`/`d`/`h`
  its extents. It is not a coordinate on the map, it is a fact about the tile, so it rides the tile through
  zoom, pose, thickness, z-width and rotation without being restated.

  `roles` is what lets ONE list answer collision, elevation, contact damage, spell damage and range. It is
  written on every box: an empty list says "this box answers nothing", an absent key would only say nobody got
  round to it, and that distinction is the reason `ensure_collisions/0` writes a list on all 756 rows.
  """

  @shapes ~w(square skew triangle)
  @roles ~w(solid support hurt hit sensor)

  @doc "A plain cuboid. The default box, and what every solid tile gets from the migration."
  def square(col, row, level, w, d, h, roles \\ ["solid"]) do
    %{"shape" => "square", "col" => col, "row" => row, "level" => level,
      "w" => w, "d" => d, "h" => h, "roles" => roles}
  end

  @doc """
  A wedge: the four corner heights of the top face, in GRID order
  [colMin/rowMin, colMax/rowMin, colMax/rowMax, colMin/rowMax].
  """
  def triangle(col, row, level, w, d, {t0, t1, t2, t3}, roles \\ ["support"]) do
    %{"shape" => "triangle", "col" => col, "row" => row, "level" => level,
      "w" => w, "d" => d, "h" => Enum.max([t0, t1, t2, t3]),
      "top" => [t0, t1, t2, t3], "roles" => roles}
  end

  @doc "A cuboid whose top face slides. `lean` is the slide in blocks along +col and +row."
  def skew(col, row, level, w, d, h, lean_col, lean_row, roles \\ ["solid"]) do
    %{"shape" => "skew", "col" => col, "row" => row, "level" => level,
      "w" => w, "d" => d, "h" => h,
      "lean" => %{"col" => lean_col, "row" => lean_row}, "roles" => roles}
  end

  @doc "Is this a box the engine can read? A malformed one is DROPPED, never half-installed."
  def valid?(%{"shape" => shape, "roles" => roles} = box) when shape in @shapes and is_list(roles) do
    Enum.all?(~w(col row level w d h), &is_number(Map.get(box, &1))) and
      Enum.all?(roles, &(&1 in @roles)) and
      top_valid?(shape, Map.get(box, "top"))
  end

  def valid?(_box), do: false

  defp top_valid?("triangle", [_, _, _, _] = top), do: Enum.all?(top, &is_number/1)
  defp top_valid?("triangle", _top), do: false
  defp top_valid?(_shape, _top), do: true
end
```

Separate clauses with `when` guards, no `else`, which is the house rule for Elixir.

### 5.10 The JSON on the wire

`settings` is served verbatim, so this is what `GET /api/tilesets` carries with no controller change at all:

```json
"wall_brick_c": {
  "height": 1,
  "image_url": "/tiles/ascii/wall_brick_c.png",
  "settings": {
    "hitboxes": [
      { "shape": "square", "col": 0, "row": 0, "level": 0,
        "w": 1, "d": 1, "h": 1, "roles": ["solid"] }
    ]
  }
},
"door": {
  "settings": {
    "hitboxes": [
      { "shape": "square", "col": 0, "row": 0.7, "level": 0,
        "w": 1, "d": 0.3, "h": 1, "roles": ["solid"] }
    ],
    "scaleZ": 0.3, "thicknessDir": "left-down"
  }
},
"stair_up": {
  "settings": {
    "hitboxes": [
      { "shape": "triangle", "col": 0, "row": 0, "level": 0,
        "w": 1, "d": 1, "h": 1, "top": [0, 0, 1, 1],
        "roles": ["support"] }
    ]
  }
},
"boss_flail": {
  "settings": {
    "hitboxes": [
      { "shape": "square", "col": 0.2, "row": 0.2, "level": 0,
        "w": 0.6, "d": 0.6, "h": 2, "roles": ["solid", "hurt"] }
    ],
    "animations": [
      { "id": "flail_swing", "kind": "sprite", "durationMs": 640, "loop": false,
        "spriteTrigger": { "on": "attack" },
        "frames": [
          { "tileId": "ascii:boss_flail_a1", "hitboxes": [] },
          { "tileId": "ascii:boss_flail_a2", "hitboxes": [
            { "shape": "square", "col": 1.0, "row": 0.3, "level": 1,
              "w": 0.5, "d": 0.5, "h": 0.5, "roles": ["hit"] },
            { "shape": "square", "col": 1.5, "row": 0.3, "level": 1.2,
              "w": 0.5, "d": 0.5, "h": 0.5, "roles": ["hit"] },
            { "shape": "square", "col": 2.0, "row": 0.3, "level": 1.4,
              "w": 0.6, "d": 0.6, "h": 0.6, "roles": ["hit"] }
          ] },
          { "tileId": "ascii:boss_flail_a3", "hitboxes": [
            { "shape": "square", "col": 0.3, "row": 1.0, "level": 1,
              "w": 0.5, "d": 0.5, "h": 0.5, "roles": ["hit"] },
            { "shape": "square", "col": 0.3, "row": 1.5, "level": 0.8,
              "w": 0.5, "d": 0.5, "h": 0.5, "roles": ["hit"] },
            { "shape": "square", "col": 0.3, "row": 2.0, "level": 0.6,
              "w": 0.6, "d": 0.6, "h": 0.6, "roles": ["hit"] }
          ] },
          { "tileId": "ascii:boss_flail_a4", "hitboxes": [] }
        ] }
    ]
  }
}
```

**That last one is his chain, in data.** Three boxes tracing the chain, on the two frames the chain is out, and
nothing on the wind-up and recovery frames. The body box on the tile row stays `hurt` throughout, because the
ladder inherits it: the frames override only the boxes, not the tile.

### 5.11 What is DATA and what is CODE

| | |
|---|---|
| **DATA, backend, all of it** | every box on every tile; every box on every composition cell; every per-frame box inside an animation; which roles each box carries; `maxStep`, `maxSlope`, `snapDown` (a `game_rules` row, `key: "movement"`); the `elevation` generation-layer row; the ramp/stair tiles and the objects made from them |
| **CODE, frontend, and only this** | the three shape testers behind a dispatch map keyed by `shape`; `projectBox`; `rotateHitBox`; the precedence ladder; the bilinear read; the four queries (`pointBlocked`, `groundTopAt`, `boxesOverlap`, `boxesInRange`); the bake |
| **Never code, ever** | which tiles are solid; what shape any box is; how big any box is; any threshold; any list of labels |

**And the reason it is a FUNCTION, not a const:** `hitBoxesForView` and `moveRules()` read through a function
at call time. A module-level `const` would freeze the EMPTY catalog at import and serve nothing for the life of
the tab, which is the exact bug that once served a brute 8 damage instead of 18, and which
`generationLayers.ts` opens with a warning about.

---

## 6. Isometric now, 2D later, and exactly what that costs

*"for now, let's hide 2d view, it has huge gaps with isometric at this point and working on catching it up
would just slow us down, so we'll nail isometric, then catchup 2d back"* (2026-09-14). `SHOW_2D_VIEW = false`
sits at `components/game/editorConfig.ts:194` with that quote in the file.

### 6.1 What is BUILT for isometric

Everything. `hitBoxesForView(asset, 'iso', ...)` returns the full authored solid, the three testers run in 3D,
`groundTopAt` reads the support boxes, the walker uses it, combat uses it, and the overlay draws it.

### 6.2 What is BUILT for top

The projection, and its tests. The top view has no elevation to show (MAP-MODEL §2), so its answer is the
footprint, which is exactly what `boxesForAsset` returns today. That makes it the **compatibility path**: every
current caller of `collisionBoxes.ts` is a top-view caller whether it knows it or not, and step 2 of the plan
routes them through `projectBox(box, 'top')` so their answers are byte-identical.

### 6.3 What is STUBBED for 2D, precisely

**Built and tested:** `projectBox(box, '2d')` and its unit tests, per shape, including the corner fold that
turns a wedge into its triangle silhouette. So the DATA half of 2D is done and pinned in this ticket.

**Not built:** nothing in `render/topdown.ts`'s 2D path calls it, the 2D renderer draws no overlay, and no 2D
walker exists. `SHOW_2D_VIEW` stays `false`.

### 6.4 What catching 2D up costs later, item by item

| item | work |
|---|---|
| the data | **zero.** Every box is already authored, and `projectBox(box, '2d')` already has its answer and its tests |
| the walker | `standSurfaceAt` takes `(col, row, u, v)`; the 2D walker passes `(col, level)` instead. One call site, no new rule |
| the overlay | one drawer, mirroring the iso one, against the 2D renderer's own projection |
| combat | zero. It asks `hitBoxesForView(..., view)` and the view is a parameter already |
| authoring | zero. The inspector's per-view override row already lists `2d` |
| the flag | flip `SHOW_2D_VIEW` to true |

**There is no redesign in that list, and that is the point of projecting rather than authoring per view.** If
2D had its own authored set, catching it up would mean authoring 756 tiles a second time before a single pixel
moved. The one thing catching up 2D really costs is the 2D RENDERER's own gaps, which are ticket-sized work on
`topdown.ts` and are nothing to do with this system.

---

## 7. The implementation plan

Fifteen steps. Each is shippable and testable on its own, and each says what he should SEE at :3000 when it
lands. **Steps 1, 4, 8, 12 and 14 are backend-first**: the data exists before any frontend reads it, which is
the rule the whole repo runs on.

Steps 1 to 5 change NOTHING on screen, by design. That is what makes them safe, and step 6 is where they become
visible all at once.

---

### Step 1 · BACKEND. The shape exists, written on all 756 rows

**Changes** `nebulith/lib/nebulith/catalog/hit_box.ex` (new, §5.9). `tile_source.ex` gains
`ensure_hitboxes/0`, which walks every tileset and every tile and writes `settings.hitboxes` through
`Catalog.put_tile_setting/4` (pose-safe, so every hand-tuned pose survives), derived from today's
`settings.collision`: a non-empty list becomes one `square(0, 0, 0, 1, 1, max(tile.height, 1), ["solid"])`, an
empty list becomes `[]`. Migration `20260915010000_seed_hitboxes.exs` runs it.

**Test** `test/nebulith/hitboxes_seeded_test.exs`: all 756 rows carry the key; the rows that carry a non-empty
`collision` today are exactly the rows that carry a non-empty `hitboxes`, matched label by label in both
styles (144 of them); every box passes `HitBox.valid?/1`; the tile's own `height` is the box's `h`, so a
0.5-height water row does not get a 1-block box. Not a degenerate oracle: it asserts the count and the per-row
match, not "a key is present somewhere".

**At :3000** nothing. Curl `/api/tilesets` and the key is there. Any visible change here is a bug.

---

### Step 2 · FRONTEND. One reader, and the old one delegates to it

**Changes** `src/engine/hitbox/hitbox.ts` (new): the types, `parseHitBoxes` (a malformed box is DROPPED, never
half-installed, the rule `tileRenderBehavior` already follows), the precedence ladder `hitBoxesFor(asset)`,
`projectBox(box, view)` and `rotateHitBox`. `src/engine/collisionBoxes.ts` keeps its whole public surface and
re-implements `boxesForAsset` as *"project my hitboxes into the top view and hand back the footprint"*.

**Test** `src/__tests__/engine/hitbox/projection.test.ts` (the table in §5.8, per shape, all three views) and
`src/__tests__/engine/hitbox/ladderFromBackend.test.ts`, which installs a MOCKED `/api/tilesets` body through
`installTilesets` and asserts the boxes come back off it. Plus the one that matters: the existing
`collisionBoxes.test.ts` and `collisionRoundTrip.test.ts` must pass **unchanged**.

**At :3000** nothing, and the unchanged suite is the proof.

---

### Step 3 · FRONTEND. The three shapes, as geometry

**Changes** `src/engine/hitbox/shapes.ts`: `boxHoldsPoint`, `boxTopAt`, `boxSlopeAt`, `boxesOverlap`, behind
`const SHAPE_TESTERS: Record<HitShape, ShapeTester>`. One drawer per shape, never an if-chain, the same pattern
`ISO_SHAPE_DRAWERS` already uses.

**Test** `src/__tests__/engine/hitbox/shapes.test.ts`: the bilinear read at the four corners and the centre of a
`[0,0,1,1]` wedge (0, 0, 1, 1 and 0.5); a `skew` holding a point its unsheared twin does not; overlap and
non-overlap in each axis separately, so a broken axis cannot hide behind the other two.

**At :3000** nothing.

---

### Step 4 · BACKEND. A support box on every tile that holds something up

**Changes** `ensure_support_boxes/0`: every tile whose `height > 0`, plus every tile carrying `actAsTile`, gains
a `support` role on its existing box, with the top at the height the frontend derives TODAY from `height`,
`settings.stackAt` and `settings.actAsTile` (`cellStack.ts:205`, `:222`, `:247`). Migration.

**Test** the Elixir test asserts the derivation per row. The frontend test is the one that counts:
`src/__tests__/engine/hitbox/standLevelParity.test.ts` builds a generated town and asserts
`groundTopAt(col,row,0.5,0.5) === unitStandLevel(col,row)` for **every cell on the map**, on today's code path.
A single mismatch fails it.

**At :3000** nothing.

---

### Step 5 · FRONTEND. `groundTopAt` becomes the one reader

**Changes** `src/engine/hitbox/ground.ts` (new): `groundTopAt` and `standSurfaceAt`. `cellStack.unitStandLevel`
keeps its signature and becomes a call into it. `iso.ts:2587` and the debug overlay's `surfaceLift` stop
hand-summing elevation plus stack and call it too.

**Test** the parity test from step 4, now against the NEW path, plus a realCanvas test that the hero is drawn at
the same pixel before and after on a generated town.

**At :3000** the hero stands exactly where it stands today. **If anything moved, the step is wrong.**

---

### Step 6 · FRONTEND. The overlay, so he can SEE the boxes

**Changes** `src/engine/render/hitboxOverlay.ts`: for every visible asset, resolve
`hitBoxesForView(asset, 'iso', now, style, dayNight)` and draw each as a wire solid through the frame's own
`toScreen`/`tileW`/`tileH`/`heightStep` (the `__nebulithProject` seam, `iso.ts:526`), coloured by role:
solid grey, support green, hurt blue, hit red, sensor yellow. A toggle in the view bar beside the existing
collision overlay.

**Test** `src/__tests__/render/hitboxOverlay.realcanvas.test.ts` through `@napi-rs/canvas`: place a wall with a
known box, render, and assert the drawn edges land on the four projected corners the seam predicts. Assert a
tile with no boxes draws nothing, so an overlay that paints everything cannot pass.

**At :3000** **turn it on and every wall wears a cube, every floor wears a slab, and a door wears a thin
panel.** This is the first thing he can look at, and it is what proves steps 1 to 5 were real rather than
green.

---

### Step 7 · FRONTEND. Authoring a box on the selected tile

**Changes** a seventh row in `INSPECTOR_SECTIONS` (`game/editor/inspectorSections.ts`), id `hitboxes`, title
"Hitboxes". A `HitboxControls` block in `components/game/editorInspector.tsx`: a list of the tile's boxes, an
add and a remove, a shape picker, the six extents, the four corner heights when the shape is `triangle`, the
role checkboxes, and a per-view row (iso / top / 2d) offering on-off plus an override. Writes
`asset.settings.hitboxes`; round-trips through `Template.assetsData` and `captureMapSnapshot`.

**Test** the round trip through `serializeGrid` and back; a test that the inspector writes ONLY the fields that
are pinned, so a tile the user did not touch carries no `hitboxes` key and keeps inheriting its row.

**At :3000** select a wall, drag its box thinner, and the step-6 overlay follows it live.

---

### Step 8 · BACKEND. A ramp and a stair, authored, and they are OBJECTS

**Changes** `ramp` and `stair` tiles in both styles, each carrying a `triangle` support box (`top: [0,0,1,1]`
for a ramp rising along +row), plus the baked art through the existing `priv/tilegen/tiles.json` to
`bake.mjs` to seed pipeline. Compositions `ramp_grass`, `ramp_stone`, `stair_up` and `stair_corner`, each with
`category: "terrain"`, so they appear in the Objects library with no frontend change at all.

**Test** an Elixir test that each new tile's box is a valid `triangle` with `support`; the style-parity tests
must stay green (both catalogs 1:1, which has caught a one-sided seeder before).

**At :3000** **the Objects list has a Ramp and a Stair.** Place one, and the overlay shows a wedge, not a cube.
His rule holds: *"any time we add a new functionality it just becomes a new object we can just place and play
with"*.

---

### Step 9 · FRONTEND. Walking up the ramp

**Changes** the player and enemy steppers ask `standSurfaceAt` for the target point and refuse a step whose rise
is more than `maxStep`. The hero's draw height reads `groundTopAt` at its FRACTIONAL position, so it glides
across a ramp instead of popping at the cell boundary. `maxStep`, `maxSlope` and `snapDown` come from a
`game_rules` row through a FUNCTION (`moveRules()`), never a const.

**Test** a unit walks a 1-block ramp and its height rises monotonically across the cell, sampled at
u = 0, 0.25, 0.5, 0.75, 1; it cannot climb a 1-block cliff; it does NOT bounce walking down (assert the height
is monotonic on the way down too, which is the GoldSrc bug the `snapDown` rule exists for).

**At :3000** **walk up the ramp from step 8, and walk back down it smoothly.** This is ticket 6.

---

### Step 10 · FRONTEND. Boxes that belong to a frame

**Changes** `AnimFrame.hitboxes` (§5.5). `spriteFrameSelection` exported from `render/assetAnimation.ts`, with
`spriteFrame` re-implemented as a thin caller of it so there is one clock and one winner. The ladder's first
rung goes live. `flipX` mirrors the boxes.

**Test** a two-frame sprite animation where frame 0 declares `hitboxes: []` and frame 1 declares one box, read
at two clock times, asserting a different answer at each. An absent key on frame 0 inherits the tile's boxes,
an empty list does not: **both cases asserted**, because that distinction is the whole design.

**At :3000** turn on the overlay over a river: the water's boxes change with its frames.

---

### Step 11 · FRONTEND. Authoring a box per frame

**Changes** each frame row in `TileAnimationEditor` (`components/game/editorAnimation.tsx`, the strip at
`:223`) gains a box editor reusing step 7's control, plus a "same as rest" state so the common case writes
nothing.

**Test** the modal writes `hitboxes` only on frames the user touched; a frame set to "none" writes `[]` and a
frame never touched writes no key.

**At :3000** author a two-frame swing and watch the box appear and disappear with the frames.

---

### Step 12 · BACKEND. The boss with the chain, as the proof slice

**Changes** a `boss_flail` unit tile with a 4-frame attack sprite animation whose middle two frames carry three
`hit` boxes tracing the chain (§5.10's payload, authored as a migration), plus the frame art. An `Entity`-side
resolver so a unit in the play loop reads the same tile row that a placed tile does.

**Test** the boxes live on exactly the two frames; a target standing where frame 2's third box lands is hit and
a target one block further out is not.

**At :3000** **place the boss, let it swing, and the chain's boxes sweep with it.** This is his example, built.

---

### Step 13 · FRONTEND. Combat asks the boxes

**Changes** `findTarget`, `tickCannons`, `weaponReach` and the projectile impact ask
`hitBoxesForView(..., 'iso')` and overlap `hit` against `hurt` instead of Manhattan distance.
`CANNON_INTERVAL_MS`, `CANNON_RANGE` and `CANNON_DAMAGE` (`game/runtime/movement.ts`) become served numbers.

**Test** an attack that misses by geometry misses; a `hurt` box that is taller than one block is hit by a high
attack and missed by a low one, which is a thing that cannot be expressed at all today.

**At :3000** hits land where the boxes are, and the overlay shows why when they do not.

---

### Step 14 · BACKEND. An `elevation` generation layer

**Changes** a row in `generation_layers` (`key: "elevation"`, positioned after `terrain` and before `ways`),
and a pass bound to that key in `stageGenerator` that raises regions and cuts a ramp wherever a way crosses a
level change. The layer LIST is already backend data with full CRUD (`generationLayers.ts`,
`generation_layer.ex`), so this is a row plus a bound function, and the existing test requiring every engine
layer to have a panel row keeps it honest.

**Test** every generated map with elevation has a walkable route from every exit to every other exit, asserted
by a flood fill that uses `standSurfaceAt` rather than `isBlocked`. That is the test that would have caught the
204-of-240 exits defect in ticket 1.

**At :3000** **generate a mountain forest and walk up the mountain.** Ticket 7's *"mountain forest IS SUPER
WEIRD"* is what this is aimed at, and the LOOK of it is still ticket 7's, not this one's.

---

### Step 15 · Cleanup, and the docs in the same turn

**Changes** `settings.collision` is dropped from the payload and from every reader; `collisionBoxes.ts` is
deleted and its callers point at `hitbox/`. `MAP-MODEL.md` §4 and §6 are corrected in the SAME commit (§9).
Ticket 5's `blocking` and `walkable` removal lands on top of this and is no longer blocked.

**Test** a grep test: zero occurrences of `settings.collision` in `src`; the full suite green.

**At :3000** nothing, again. The system is then one system with one name.

---

### The order, and why

| | |
|---|---|
| 1 to 5 | **the data and the reader, with nothing visible changing.** Each one is provable by a test that says "the answer is identical" |
| 6 | **the first thing he can see**, and the audit of 1 to 5 |
| 7 | he can author one |
| 8 to 9 | **elevation lands: a ramp exists and he walks up it.** This is the payoff of the triangle |
| 10 to 12 | **the animated half lands: the chain.** This is the payoff of the frame |
| 13 | combat stops being arithmetic |
| 14 | generation places elevation |
| 15 | the old system goes |

Steps 8 to 9 and 10 to 12 are independent of each other. If he wants the chain first, swap the pairs.

---

## 8. The editor and authoring story

*"these hitboxes must be as drawable as the tile"*.

### 8.1 Three surfaces, one control

**A. The Hitboxes section in the Inspector.** A seventh row in `INSPECTOR_SECTIONS`, which is a table, so
adding it is a row and not a branch (`inspectorSections.ts` says so in its own header). The control is one
component reused everywhere else a box is authored:

```
Hitboxes                                              [2 boxes ▾]
┌───────────────────────────────────────────────────────────────┐
│ ● box 1      shape  [square] [skew] [triangle]                │
│   at    col 0.00   row 0.70   level 0.00                      │
│   size  w   1.00   d   0.30   h     1.00                      │
│   does  [x] blocks  [ ] stand on  [ ] takes dmg               │
│         [ ] deals dmg  [ ] senses                             │
│   views  iso [on]   top [on]   2d [on]          [override ▾]  │
│                                                   [remove]    │
│ ● box 2 ...                                        [+ add]    │
└───────────────────────────────────────────────────────────────┘
```

When `shape` is `triangle` the size row grows four corner heights, laid out as the grid square they describe so
the number's POSITION is the corner it sets:

```
   corners   row-   [0.00]  [0.00]
             row+   [1.00]  [1.00]
                     col-    col+
```

The role checkboxes read in plain words, not in the role ids, the same way `EDITOR_RAIL`'s hints do. The ids are
what the data carries.

**B. Drawing it on the map.** The step-6 overlay is not read-only: with the Hitboxes section open, each box's
projected corners become drag handles on the canvas, using the picker that already exists
(`pickIsoBlocksAll`, `iso.ts:1787`) plus the projection seam (`__nebulithProject`, `iso.ts:526`). Dragging a
handle writes the same `asset.settings.hitboxes` the fields write. **There is one writer**, which is what stops
the numbers and the drag from disagreeing.

**C. Per frame, in the animation modal.** `TileAnimationEditor`'s frame strip (`editorAnimation.tsx:223`)
already lets you add and remove frames. Each frame row gains a small state control with three states:

* **same as rest** (the default, writes NO key, inherits the tile's boxes),
* **none** (writes `[]`, the wind-up frame),
* **own** (opens the same control as A, writes that frame's boxes).

The three states are the three cases in the ladder, shown as three words, so the distinction between an absent
key and an empty list is something he SEES rather than something he has to remember.

### 8.2 It becomes an OBJECT

*"any time we add a new functionality it just becomes a new object we can just place and play with, that's the
beauty of our engine, that's why we buyilt it like legos ... we can build our own objects, save them, and reuse
thenevber we want, the system can export them as tiles for us too, so it becomes a tileset builder too"*.

A composition with a `category` is browseable in the Objects library, grouped by that served value, with no
frontend change (`composition.ex`'s `category`, rendered by `CompositionSection` in `editorChrome.tsx:112`).
So every shape this ticket makes possible ships as an object:

| object | what it is | category |
|---|---|---|
| **Ramp** (grass, stone, wood) | one `triangle` support box rising along one axis | terrain |
| **Stair** (up, corner) | a `triangle` per tread, or one wedge for a smooth run | terrain |
| **Slope corner** | a `triangle` with three corners low and one high, the mountain's outside corner | terrain |
| **Platform** | a flat `support` box floating at a level, with no `solid` | terrain |
| **Ledge** | a `skew` overhang | terrain |
| **Damage zone** | a `sensor` + `hit` box with no `solid`, so it hurts and does not block | props |
| **Invisible wall** | a `solid` box on a tile with no art | props |

Seven new placeable things, and **not one of them needs a line of frontend code**: each is a tile row plus a
composition row plus baked art. That is the test of whether this model is right, and it passes.

### 8.3 The tileset-builder half

Because a box is a tile SETTING, "save my own object and reuse it" is already the composition path. An object
he builds in the editor and saves carries its cells' boxes with it, and exporting it as a tile carries them
too. Nothing extra is needed for that, and nothing here blocks it.

### 8.4 The visual method, which is part of the work

*"we should have a design, then model over said design, then compare the end rsult visually with the originald
esign, and report when it has been validated they're the same or close"*.

For every step that changes what he sees (6, 8, 9, 12, 14) the deliverable is a COMPARISON, not a commit:

1. the design first (a drawn reference for the ramp's profile, the stair's tread run, the chain's arc),
2. build to it,
3. render it through the `.probe` harness (`game-website/.probe`, seeded worlds, the `__nebulithGrid` and
   `__nebulithProject` seams, all four camera facings, several animation frames per facing, which is what
   `matrix.mjs` already does for 42 combinations),
4. put the render beside the design and report THAT.

**A commit and a green suite are not a report**, and the four-facing sweep is not optional: the navy river
defect was invisible at facing 0 and reported four times.

---

## 9. Two doc statements this ticket corrects, in the same commit

Both are in `MAP-MODEL.md` (and its mirror in `game-website/docs/`), both are stale, and both would send the
next person the wrong way.

1. **§4**: *"A cell/block has collision or not, it blocks movement or it doesn't. Collision is a property of
   the cell/block, independent of the tile it holds."* That is no longer true and is the opposite of his own
   later instruction: *"collissions and hitboxes aren't glued to a coordinate, they're part of a cell, in fact,
   they're linked to the tile in the cell"*. Collision is a property of the TILE, and the cell's answer is the
   union of what its tiles declare (which is what `deriveCellCollision` already computes, `cellStack.ts:160`).
2. **§6**: *"The elevation system already exists ... The open work is only expanding the generators + tiles to
   place PLACES with elevation, not new render logic."* Half true. The per-cell integer exists; the
   **sub-block surface does not**, so a ramp cannot be expressed at all, and that IS new logic. §5.7 replaces
   the paragraph.

`ANIMATION-SYSTEM.md` §2 gains `hitboxes` in the `AnimFrame` line. `MAP-MODEL.md` gains the §5.8 projection
table beside its §2 view table, since the two say the same thing and should sit together.

---

## 10. Risks and open questions

### Resolved, with the recommendation and the reason

| # | question | call | why |
|---|---|---|---|
| R1 | boxes in cell fractions or in blocks, in the tile's frame? | **blocks, tile frame** | his own correction, plus Factorio's `collision_box` is relative to the entity. A coordinate box cannot follow a swinging weapon |
| R2 | per-frame by time window or by frame index? | **frame index** | `spriteFrameIndex` is already the clock. A window would be a second clock to keep in step, and the Unity thread is the record of that going wrong |
| R3 | polygons or boxes and wedges? | **boxes and wedges** | Box2D requires convex and decomposes concave into several fixtures anyway. A wedge's height test is a bilinear read, a polygon's is 13 SAT axes |
| R4 | one-axis ramp or four corner heights? | **four corners** | OpenTTD derives 19 named slopes from four numbers, and a one-axis ramp cannot express a mountain's outside corner. He asked for mountains |
| R5 | replace `grid.height` with support boxes? | **no, keep both, on the DF line** | the integer level stays authoritative for logic; the corners only shape the surface inside one block. Replacing it is a save-format change and it would break the one-block-per-cell invariant the whole LEGO model rests on |
| R6 | quadtree or spatial hash? | **neither** | the world IS a bounded uniform grid, so the index is `row * cols + col`. A hash compresses a sparse grid we do not have; a quadtree adapts to a density we do not have |
| R7 | per-cell or per-edge collision (Project Zomboid)? | **per cell, fractional** | a box flush against one face IS the edge wall, and this engine already authors exactly that as a door's `scaleZ 0.3` + `thicknessDir`. Edges would need a second store and a second authoring surface to say the same thing |
| R8 | new key `hitboxes` or evolve `collision`? | **new key, and `collision` is deleted in step 15** | the thing changed from a 2D footprint rectangle into a 3D solid. Keeping the name would make the old meaning look current, and this repo has three names for one fact already |
| R9 | does the camera turning move a box? | **no** | Red Blob: isometric is how you look at the world, not part of it. This is what keeps the cost at zero |
| R10 | does `flipX` mirror the boxes? | **yes, in the resolver** | a mirrored frame whose boxes do not mirror registers hits on the wrong side, and it must not be left to the author to remember |

### These four need HIS decision, because each changes what he sees

**Q1. Can you stand on top of a wall?**
A `solid` box stops you passing through. Whether its TOP is also a `support` you can walk on is a game
decision, not a technical one, and it is visible the moment elevation works: it is the difference between a
town you can walk the rooftops of and a town you cannot.
*Recommendation:* start with `solid` only on walls, so nothing changes today, and add `support` per tile when
he wants a rooftop. It is a data edit, not code, either way.

**Q2. Where should the boxes come from for the 306 tiles that declare none?**
Today 306 of 378 rows carry an empty list, which means "walk through me". That is correct for a flower and
wrong for a tree trunk, and it is why `boxesForAsset` still derives a box from the drawn size
(`collisionBoxes.ts:52`). Once real boxes exist that derivation should go, and then **something has to author
those 306**.
*Recommendation:* author them in ONE batch by category (trunks, rocks, walls, furniture get real boxes; ground
plants, decor and blooms stay empty), as a migration, sized from the art. Roughly 40 to 60 rows actually need a
box; the rest genuinely are empty.
*His call:* whether that batch belongs in this ticket or in its own row. It is the difference between step 8
landing in a day and landing in three.

**Q3. What are `maxStep`, `maxSlope` and `snapDown`?**
The industry numbers are consistent: about 45 degrees for the slope limit (Unreal 44.765, Source's normal
Z > 0.7 which is 45.57, Unity's doc example 45). `maxStep` and `snapDown` have no industry consensus because
they are tuned per game, and they are the two he will FEEL.
*Recommendation:* `maxSlope` 45 degrees, `maxStep` 0.5 blocks (so a half-block kerb is a step and a full block
is a climb), `snapDown` 0.5 blocks. All three as `game_rules`, so tuning them is a row and not a release.
*His call:* the two feel numbers, after he walks the step-9 ramp.

**Q4. Should a ramp read as a smooth wedge or as stepped treads?**
Both are one `triangle` box away from each other: a smooth ramp is one wedge across the cell, a staircase is
several small wedges or Minecraft's two-box tread. **The COLLISION is the same either way; the ART is not.**
*Recommendation:* a ramp is smooth, a stair is stepped treads, because that is what the words mean and it gives
two visibly different objects from one mechanism.
*His call, and it is a LOOK call:* this is exactly the kind of thing §8.4 says to put a design beside a render
for, before building it.

### Risks worth naming

* **The parity tests in steps 4 and 5 are the whole safety net.** If `groundTopAt` does not return exactly what
  `unitStandLevel` returns today, on every cell of a generated town, the hero moves and the cause will look
  like a render bug three steps later. Those tests are not optional and they are not a formality.
* **A degenerate oracle is the specific way this could go green while broken.** The trap here is asserting a
  box "exists" when a `??` fallback can manufacture one. Every test asserts the thing itself: the COUNT of
  boxes, the per-row match against a mocked payload, the drawn corner positions against the projection seam.
* **Step 6's overlay could paint everything and look right.** Its test must assert that a tile with no boxes
  draws NOTHING, or an overlay that tints every cell would pass.
* **Performance is not the risk here, allocation is.** The arithmetic is two orders of magnitude inside the
  measured JS ceiling. What can hurt is a `.map` per asset per frame, which is already 11 calls in the render
  path and already visible as jitter. The resolver writes into a reused buffer and publishes `__hitboxMs`
  beside `__isoRenderMs` and `__stageLayerMs`, so a regression is visible rather than absorbed.
* **The 2D projection can rot while 2D is hidden.** Its tests are what stop that, and they are written in
  step 2, not deferred with the renderer.

---

## 11. What this does NOT cover

Stated plainly so nobody assumes otherwise.

* **The 2D view itself.** The projection and its tests, yes. The 2D renderer, walker and overlay, no.
  `SHOW_2D_VIEW` stays `false`. §6.4 is the bill.
* **Swept / continuous collision.** Boxes are tested per tick at their current pose, so a very fast attack can
  pass through a target between two frames. The industry answer is the swept sphere along a bone
  (MeleeTrace), and it is a later ticket. Nothing here blocks it.
* **Polygon, capsule or mesh shapes.** Three solids, chosen because their tests are cheap and because Box2D's
  own convexity constraint says what polygons cost.
* **The depth sort.** `isoDepthCompare` is not touched. Topological sorting with Tarjan for cycles is the known
  general answer and it belongs to ticket 7, not here.
* **Pathfinding.** Still cell-based, still `isBlocked`. Boxes make a finer answer possible; nothing in this
  ticket spends it.
* **Physics.** No gravity, no ragdoll, no momentum, no restitution. The jump stays a timed visual hop
  (`JUMP_MS`, `JUMP_PEAK_PX`).
* **One-way platforms.** A role could express it (Godot's `one_way_collision` plus its margin). Not built.
* **Multi-part bosses with severable parts / weak points.** The role model supports it; nothing here builds it.
* **Deleting `blocking` and `walkable`.** That is ticket 5, 232 and 378 occurrences respectively. This ticket
  unblocks it by giving the fact a real home; step 15 is where the two meet.
* **How raised ground LOOKS.** The washed-out grey slabs, the dirt texture and the relief are tickets 7 and 8.
  This ticket makes a slope EXIST and walkable. Making it look like a mountain is separate and is a design
  comparison, not a data change.
* **Elevation in generation beyond one layer.** Step 14 lands the layer and a walkable route. Which biomes get
  mountains, how tall, and how they read is tickets 7, 32 and 15.

---

## 12. How this gets validated, not just tested

| step | the proof |
|---|---|
| 1, 4, 8, 12, 14 | curl the backend and read the row back. Editing a seeder is not changing the DB |
| 2, 3, 5, 10, 13 | jest, against a MOCKED backend payload, asserting the thing rather than a derivable string |
| 6, 7, 9, 11 | `@napi-rs/canvas` real-pixel tests through the production render path |
| 6, 8, 9, 12, 14 | **his eyes at :3000**, with the design beside the render, all four camera facings, several animation frames per facing, through `.probe/matrix.mjs` |

`export PATH=/home/visiond/.nvm/versions/node/v24.15.0/bin:$PATH` before every jest run, or a bare
`Unexpected token .` reads like a syntax error in the code when it is nvm resolving node v10.

**And the only "done" that counts is his at :3000.** A commit and a green suite are not a report.
