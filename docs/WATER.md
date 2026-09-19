# WATER, the framework

Water is not one blue tile. It is a stack of layers drawn in a fixed order, each one answering a different question, and it looks wrong the moment any of them is missing or folded into another. This is the framework to follow for rivers, pools, swamp water, sea and the shoreline.

Read [`MAP-MODEL.md`](MAP-MODEL.md) first, §6 in particular. Nothing here overrides the stacking law.

---

## 0. Sources

1. **"How I Created 2D Pixel Art Water For My Indie Game"**, Fishy Games, 8:41, `https://www.youtube.com/watch?v=DkfKwfjaVx0`. Five layers plus a shoreline pass. Timestamps cited throughout as `[mm:ss]`. Transcript pulled with `yt-dlp --skip-download --write-auto-sub`.
2. **Isometric water tile tutorial**, westenfry, `https://westenfry.com/tutorial/`. A 64x32 isometric water tile animated over **16 frames**, waves staggered so the motion reads as non-directional, palette reduced afterwards to kill the blur the interpolation leaves behind.

3. **"How I Created 2D Pixel Art Water, Unity Shader Graph"**, jess::codes, 14:10, `https://www.youtube.com/watch?v=pGOLstWBCDA`. Four layers over a **rule tile** base, which is the closest of the three to how we actually draw. Cited as `[mm:ss]` under source 3.

Source 1 is a shader over a flat plane. Source 2 is a baked isometric tile. Source 3 is the useful hybrid: hand drawn autotiles underneath, a shader over the top. **We are source 2's shape with source 1's layer model**, so every layer below states its tile-engine form, not its shader form.

### Source 3's four layers, and what it settles

Its stack is a gradient, a wavy texture, specular highlights, and seafoam, over a hand drawn rule tile base `[01:15]`. Three things in it are decisions we do not have to make again:

- **The border is painted into the tile art.** *"When I was handdrawing all these sprites, I also made sure to color the edge pixels differently in order to create an outline for the water"* `[01:40]`. The outline is not a shader pass and not a separate object, it is the edge pixels of the edge tiles.
- **The base is a rule tile, animated frame by frame.** *"To get the tiles to connect to each other like so, I used something called a rule tile. You can also choose to add a frame by frame animation to the rule tiles, which is how I made the edges move in and out"* `[01:40]`. A rule tile is an autotile family, which is exactly `<base>_<edge>` in our contract, and the animation rides the pieces.
- **Foam is NOT driven by depth.** He tried depth first, the 3D technique, and it *"caused too much foam in shallower parts of the beach"* `[12:30]`. What worked is blurring the water sprite's own alpha and using that blurred edge to fade the foam in. So depth drives the tint and the caustics, the EDGE drives the foam.

And three approaches it records as failures, so we skip them:

1. Hand animating all the waves, *"extremely time consuming and it didn't even look that good"* `[00:25]`.
2. A shader that just slides the water edges back and forth, *"some areas looked quite problematic"* `[00:50]`.
3. Generating a texture per chunk instead of using tiles: *"I definitely don't recommend doing this as I remember encountering so many issues trying to make the chunks look seamless"* `[00:50]`. Tiles are the right unit, which is what we already have.

Two more of its details worth keeping. The height map it builds is tiny, 176 by 176 for a five chunk radius, and it still reads smooth because bilinear sampling does the blur for free `[03:45]`. And the distortion has to be quantised or the pixels stop being square: multiply the coordinates by the pixels-per-tile number, floor, divide back `[08:20]`. Same lesson as source 1's centre-pixel trick, stated as arithmetic.

---

## 1. The law

**Water is terrain. It is a floor tile like any other, and everything that makes it read as water is an effect layer sitting on top of it.**

His correction, 2026-09-16, which replaces the channel model this doc was first written against:

> *"we don't need a river channel layer whatsoever, that was implemented because I thought it'll facilitate things with water, but after watching various videos and understanding the logic behind it, I realized it's wrong. water is just terrain, floor tiles, the difference is that it contains many layers of effects on it, so I think we can remove the river channel logic entirely, and just paint rivers, lakes, beaches using regular water tiles, the only thing we need is to have some type of algorithm that takes care of correctly positioning the 'border water tiles' on the actual border of the other terrain."*

And the algorithm, in his words:

> *"we can do that by simply having a record of the tiles of coordinates of the 'edges' of whatever body of water we're drawing, so let's say we do a lake, it's a big circle, we identify what coordinates are in the border of the circle, then we ensure those use the tiles that have the border color, and voila, looks like river, like lake, like anything, even when it's at the same level of the terrain."*

That is an autotile pass, and it is the whole of the geometry problem. A body of water is a SET of cells. Every cell whose orthogonal neighbour is not water is a boundary cell, and its position in the mass picks which of the nine pieces it wears. No channel, no carve, no depth bands, no special subsystem.

### What follows from it

- **A river, a lake and a beach are the same thing**: a set of cells painted with a water tile, with the edge pass run over it. They differ in the SHAPE that is painted, nothing else.
- **Water does not need its own elevation.** It reads as water at the same level as the terrain around it, because the border tile is what says "this is the edge of a body of water".
- **The effects are layers ON the tile**, not different tiles: depth tint, caustics, the animated surface, reflections, foam.
- **The river channel machinery goes.** Carving, depth banding, collision by band and the rest of it are solving a problem that does not exist once water is terrain.
- **The border is drawn against whatever the water MEETS, not only against the bank.** His refinement,
  2026-09-17: *"water border should show in anything that 'collapses' with it, so a big rock in middle,
  definitely needs borders"*. Read literally, "every cell whose orthogonal neighbour is not water" makes a
  boulder standing midstream invisible to the edge pass, because its cell is still PAINTED water: the water
  around it is all interior and the rock sits in a flat sheet with no shore. So the edge test asks about OPEN
  water, the body minus whatever stands in it, while the painted set stays the whole body, since the ground
  under a boulder is water and stays water. BLOCKING is the test: a lily is on the water, not in its way.
- **Stacking is still how you see through water.** A ford is a transparent water tile over a dirt floor tile, which is the puddle model, and that is stacking working normally rather than a special case.

### Superseded

An earlier version of this doc said "water never replaces the ground, the floor stays the floor and the water is a film stacked over it". That was written from source 1's opening step and it is only half right: the film IS how you get a see-through ford, but for ordinary open water the water tile is simply the floor. Kept here so the change is visible rather than silently rewritten.

Source 1 is making the same point from the other side: *"Right now, the water and land are the same image. Let's remove the water and put it on its own layer so it doesn't affect the land and the docks"* `[00:00]`. What it separates is the water from the LAND ART, so the water can carry its own effects. It does not make water a thing that floats above the terrain.

Consequences that are not negotiable:

- What stands on the bottom (rocks, weed, a sunken crate) is placed with the TERRAIN and the water effects draw over it `[00:20]`. It is not water decor.
- Depth is a NUMBER on the cell that effects read, not a different tile family.
- A bridge is an OBJECT above the water. It never rewrites the cells it spans.

### The fold that makes every water look the same

`assetTileImage` resolves a ground cell by its KIND first and only falls back to the tile's own name. `groundKind` folds everything matching `/water|oasis|koi_pond/` onto the single kind `water`. So **every water label in the game draws the one `water` picture**, whatever it is called.

The seeder already knows and says so: it used to animate `water`, `water_shallow` and `water_deep` and was cut back to `water` alone, because *"a floor resolves its art through groundKind, which collapses every water label to the kind water, so water_shallow / water_deep rows supply the LABEL and the walkability and nothing visual at all. Animating them was art nobody could ever see."*

Two consequences, and both are load bearing:

1. **A water VARIANT is impossible while the fold wins.** Seed a second set perfectly and it still draws the first one's picture. The label has to win over the kind for water before any of this is visible.
2. The depth bands were never three pictures. They are three labels sharing one picture, so the luminance spread noted below came from the tiles' own art, not from what a generated river draws.

The fix is the model the rest of the engine already uses: the label names the thing, and the picture is resolved from the label. The kind stays as the fallback for a name the catalog does not carry.

### What the code does today, against the law

`ctx.ground[row][col] = 'water_deep'` in `riverNetwork.ts` overwrites the terrain. The label IS the water, so the ground beneath a river does not exist. Two places already obey the law and are the pattern to copy:

- the **ford**: ground keeps the route's surface, `water_still` goes on as a `ground_decor` prop with its own opacity, stack contribution 0.
- the **swamp pool**: same shape, a film over dry ground. `waterDepth` has a comment about exactly this, that a pool no longer carries a water ground label.

Generalising that film to the channel is the water-as-a-layer work, and it is what makes every layer below possible.

---

## 1b. Liquids

A channel is filled with a LIQUID, and water is one of them. His words, 2026-09-16: *"the lava river shouldn't be the default for volcanic, just another option on water, we can call water liquids or something"*, and *"we also must do lava, which is basically water colored as lava"*.

| Liquid | Pieces it wears | What differs |
|---|---|---|
| Smooth water | its own family | the layered look |
| Lined water | its own family | the outlined look |
| **Lava** | the smooth family's | its COLOUR, and that nothing wades it |

Two rules follow, and they are the whole of what makes lava lava:

1. **A liquid is a choice on any map, never a property of a place.** A volcano keeps its river unless somebody asks for lava, and a woodland can have a lava river if somebody wants one.
2. **Lava needs no art.** It is the water pieces, border pieces included, painted the served `palette.lava` tone. What it does need is the behaviour: nothing wades molten rock at any depth, a POOL of it blocks as surely as a channel of it, and a ford is refused outright so a map gets a bridge or no crossing at all.

Both halves of that behaviour were found by measuring rather than reasoning: a first pass left 23 lava cells walkable, and every one was a pool, because the depth pass walks the channel only and a pool at ground level is walkable on purpose.

---

## 1b. The rim is drawn IN the art, and how dark it may be

His rule, from the start: *"a [river] should have white borders due to the current, lake should be more darker
because it doesn't have current, and beach should be a mix, to simulate the effect of beach waves getting to
the sand"*. The rim tone therefore lives in the TILE, not in a colour setting, because one setting cannot make
a rim both lighter and darker than its own body.

**And there is an upper bound on the darkness, which the lake broke.** 2026-09-18, on a map of open water:
*"water is above floor level in comparison with the rest of terrain"*.

It was not. Measured four independent ways, water and land were flush: stage elevation 0 for both, grid height
0 for both, the floor asset's own height unset on both, and every water autotile piece seeded at `height: 0.0`
exactly like `meadow` and `floor`. What stood up was the ART. The lake's edge pieces carried

```
<path d="M0 13 H128" stroke="#4e4e4e" stroke-width="15" opacity="1.0"/>
```

a SOLID near-black bar, 15 of 128 pixels, at full opacity, with nothing to break it up. On an iso diamond a
band like that reads as a vertical face, so a lake looked like a raised slab and an island inside one looked
like a pit with walls.

Measured against the water field's own luminance (220.1), before and after:

| kind | rim | before | after | what it is |
|---|---|---|---|---|
| river | `#ffffff` w15 | **+34.4** | +34.4 | the current throwing up white water |
| beach | `#6a6a6a` w16 + a white line at w8 | **-36.1** | -36.1 | a wave reaching sand, both at once |
| lake  | `#4e4e4e` w15 op1.0 → `#545454` w12 op0.85 | **-69.5** | **-42.5** | still water going deep at the edge |

The lake is still the darkest of the three, which is what he asked for. What changed is that it is no longer
*twice* the beach's drop, opaque, and thick enough to read as masonry.

**The law:** a rim states the KIND of edge, and it may not state a HEIGHT. If an edge band reads as a wall
face, it is too dark, too wide or too opaque, whatever the tile's `height` field says. Keep a rim's drop
inside roughly 45 luminance of its own field, and give a dark one something to break it up.

Baked with `node priv/tilegen/bake.mjs --only=<labels>` from `priv/tilegen/tiles.json`, which is where the
shape of every water piece lives.

## 2. The stack, bottom to top

Drawn in this order. Each row states what it is, and what it is in THIS engine.

| # | Layer | What it answers | Tile-engine form |
|---|---|---|---|
| 0 | **Bed** | What is under the water | The real terrain tile, unchanged. Objects on the bottom sit here with the terrain. |
| 1 | **Depth tint** | How deep is it here | One water material whose COLOUR is driven by the depth number. Not three tile labels. |
| 2 | **Caustics** | The light rings on the bottom | A tiled bright texture drawn ON THE BED, alpha falling off with depth. |
| 3 | **Surface** | The water itself | The animated water tile, 16 frames, staggered, non-directional. |
| 4 | **Reflection** | What is standing beside it | The mirrored sprite of the bank's objects, drawn into the water and distorted with the surface. |
| 5 | **Shoreline** | Where water meets land | Foam and wet sand, animated, non-linear. |
| 6 | **Surface light and shadow** | Sun on the water, shadows cast onto it | Handled with the map's lighting and shadow layers, not invented here. |

### Layer 1, depth tint

Real water darkens with depth through absorption and scattering, which a game fakes with a **height map**: a black and white image, white high, black low, blurred, then colour ramped in the shader, white to light blue and black to dark blue `[00:20]` to `[01:20]`. *"The blurrier the image, the longer it will take for the water to get deeper"* `[01:00]`.

**We already have the height map.** `waterDepth()` in `riverNetwork.ts` is a breadth-first walk outward from the banks: 1 means touching the bank, higher means further from any bank. That map IS the blurred image, computed rather than painted, and the blur radius is the walk itself.

What is wrong today is the second half. The depth is collapsed into three LABELS (`water_shallow` at depth <= 1, `water_open`, `water_deep` at depth >= 3), each a different picture. Three pictures of three materials is why the river measured luminance 194.7 at one band and 91.2 at another and stopped reading as one substance.

**The rule:** one water material, one art, one luminance. Depth moves the COLOUR along a ramp, the way a tile's colour setting is meant to work. A colour tint moves the hue, never the tone.

- The ramp is served data (shallow colour, deep colour), per template, like every other palette entry.
- Shallow to deep is continuous across the depth map, not stepped at 1 and 3.
- **Walkability is separate from the tint.** A ford is walkable because it is a ford, not because it is pale.

### Layer 2, caustics

*"You ever go swimming in a pool and see these weird light rings covering the floor? Well, they're called caustics"* `[01:40]`. Calculating them properly is prohibitive, so the texture is faked and tiled `[02:20]`. The fact that matters most:

> *"They aren't a surface level thing. They sit at the bottom of the water. This means that as the water gets deeper, the harder it is to see the caustics. So we just need to do the same calculations we did to the ocean floor."* `[02:40]`

This is the "lightning effect, a texture with brighter colour" from the brief, and its position is the correction: it belongs **under** the water, on the bed, attenuated by the same depth map, not floating between two water layers.

Tile-engine form: a `water_caustics` tile drawn as a film on the bed cell, beneath the surface film, its opacity a function of depth. It animates slowly and independently of the surface so the two do not beat against each other.

### Layer 3, surface

The video weighs three ways to move the surface `[03:00]` to `[06:20]`:

1. **Particle physics.** Rejected with arithmetic: about 6.5 trillion GPUs to render 18 grams of water, seconds per frame even with fattened particles `[03:00]` to `[04:20]`.
2. **Vertex displacement.** A dense plane whose vertices are moved by *"a bunch of different sine waves with different amplitudes and frequencies moving in random directions"* `[04:40]`. This is the wave maths from the brief, and note that the video **did not implement it**: *"I thought it would be overkill for just a simple task like this"* `[05:00]`.
3. **Texture displacement.** Chosen. A DUDV map stores per-pixel UV offsets as colours, the shader converts colour to offset and samples the bed through it, so the bottom appears to ripple `[05:20]` to `[06:00]`.

Then the correction that matters for a pixel game: distorting smoothly *"looks nasty"* against pixel art, so the distortion is quantised, sampling the centre pixel of each virtual pixel block (his are 3 by 3) and flooding that colour across the block `[06:20]`.

**Our form is source 2, not any of these three.** We draw baked PNG tiles, there is no per-pixel shader pass in the draw path, and sine waves have nothing to displace. The tile-native equivalent of the whole ripple problem is the westenfry method:

- one **16 frame** animation on the water tile,
- the wave shapes **staggered** between duplicated layers so no single direction dominates and the water does not read as a conveyor belt,
- the palette **reduced** after the stagger, because the blur that shows up between frames is what makes it read as mush rather than as water.

The engine already carries this: a tile's `settings.artFrames` plus `frameMs` is how a unit animates, and the same envelope drives a ground tile. Frames are authored through the existing tile pipeline (SVG on a 128 viewBox, baked, seeded), one entry per style.

**Non-directional matters here specifically.** Our camera turns to four facings. A surface animation with a direction reads as flowing the wrong way at three of them. The stagger is what makes the tile survive rotation, so it is a correctness requirement, not a style preference.

### Layer 4, reflection

3D does this with a second render pass from a mirrored camera `[06:40]`. That is unavailable to us and unnecessary: *"you can't just vertically flip an image and show the bottom side of the object. Wait, that actually just worked"* `[07:20]`. Then the flipped image is put through the same distortion as the water `[07:40]`.

Tile-engine form: for each object standing on a bank cell, draw its sprite flipped on the screen vertical into the water cells in front of it, clipped to water, alpha low, drawn ABOVE the surface film but BELOW the shoreline. It uses the same frame offset as the surface animation so the reflection wobbles with the water rather than independently.

Facings: the reflection must be recomputed per facing, since which cells are "in front of" the object changes when the camera turns. Validate at all four.

### Layer 5, shoreline

The last pass, and the video calls it the one that sold the scene. Hand animated rather than computed: a sand sprite with one pixel removed per frame, then *"the shoreline shouldn't be linear. Instead, I duplicated and removed some frames to make the animation look more shoreliny"*, plus wet sand and foam `[07:40]` to `[08:20]`.

Two facts to keep: the motion is **non-linear in time** (frames duplicated and dropped, not a constant march), and there are **two extra materials** at the edge, wet sand and foam, not just moving dry sand.

**Foam comes from the EDGE, not from depth.** Source 3 tried depth and got too much foam across a shallow beach `[12:30] source 3`. The fix was to blur the water sprite's alpha and fade the foam with that. In a tile engine the blurred alpha IS the autotile edge piece: a cell whose piece is an edge or corner carries foam, an interior piece does not.

We already compute the bank set in `riverNetwork.ts`, so the edge cells are known. What is missing is the edge ART and its frames.

### Layer 5b, why a shoreline lands in the wrong place

Three separate defects put a border in open water, and they compound, so fixing one leaves the picture nearly
unchanged. Each is measurable on its own and each has a test.

**1. A body with no interior.** A border is drawn on cells whose orthogonal neighbour is not water, so a
channel only has banks if it has a middle. `carveChannel` paints ONE HORIZONTAL RUN PER ROW around a
meandering centreline, which measures the width across the MAP, not across the current. On a centreline of
slope `m` the perpendicular half-width of that run is only `half / sqrt(1 + m^2)`, and the meander reaches
about 4 columns per row on a 60-wide map, so a river configured 3.2 wide came out under one cell thick
wherever it ran at an angle. Every cell then touches land, every cell is honestly a bank, and there is no
middle left to be the middle of. The same arithmetic breaks the body into pieces: consecutive runs stop
overlapping once the slope passes `2 * half`. Measured on woodland seeds 1 to 5 before the fix: **11, 9, 11, 3
and 12 separate bodies**, with 20% of cells midstream. After: **one body every time, 40% midstream**.

The fix is to divide the run by `cos(theta)`, which is exact for a locally straight line: the perpendicular
distance from a point to a line is its horizontal offset times `cos(theta)`, so asking for
`|offset| <= half * sec(theta)` asks for a true perpendicular distance of `half`. Connectivity comes free,
since `2 * half * sqrt(1 + m^2)` always exceeds `m`.

**2. A rim on the wrong edge of its own cell.** The autotile label names a WORLD side (`_t` is
`!filled(col, row - 1)`, so its land is north) and the art paints that rim along one edge of its own IMAGE.
Those two frames are not the same frame. The iso top face hands the texture `eA = top.b - top.a`, which points
NORTH, and `eB = top.d - top.a`, which points EAST, while a tile is authored as an ordinary top-down square,
x east and y south. So a picture sits one quarter-turn off the face it lands on, and at rest `_t` laid its rim
on the cell's WEST edge. On a river running north to south that is white water straight across the channel.

This is not a new claim about the engine: `textureTurnForHeading` is `heading + 1`, and the `1` in it is this
same correction. It is why a river's CURRENT has always run the right way while the border pieces, which never
turned at all, did not.

**3. The camera turns the map but not the picture.** `orientCell` turns the grid coordinate into the view
frame before the fixed projection, so the map rotates. The texture was drawn unturned, so at any facing but 0
the rim kept pointing at the screen edge it pointed at before the map moved under it.

2 and 3 are one rule: **a tile's picture is authored in the world frame, so it takes the same quarter-turns
the camera gives the coordinate.** `turns = PICTURE_TO_GRID + facing`.

> **The correction above was WIRED TO A CONDITION THAT COULD NEVER BE TRUE, 2026-09-18, and this section said
> it was done for two days.** `iso.ts` asked `isWaterSetLabel(assetKind(asset))`. `assetKind` FOLDS every
> water label onto the single kind `water` (§1, "the fold that makes every water look the same"), while
> `isWaterSetLabel` tests membership in the set of PIECE labels. So the question was "is the string `water`
> one of `water_smooth_river_tl` and its siblings", the answer was always no, and not one border picture was
> ever turned. It asks `asset.tileKey` / `asset.label` now.
>
> **And the test this section cited, `waterRimFacesItsBank`, did not exist.** A framework claiming a fix is
> not the fix, and citing a test that was never written is how a constant-false condition lives for two days.
> The gate is `waterBordersFaceTheLand.test.ts`, which asserts BOTH halves: the piece each cell wears faces
> every side that meets land, and the label the renderer is handed is one it will actually turn.
>
> **A fourth defect, found by the same test.** Off the map counted as land, so a cell on the border row wore a
> rim facing the void, and a nine-piece family names at most two sides, so it lost a real bank to do it.
> `waterPieces` takes the map bounds now and treats outside as water: there is nothing out there to have a
> shore against. It is sound rather than a nudge because the nine-piece family is CLOSED under a
quarter-turn (`tl -> tr -> br -> bl`, `t -> r -> b -> l`, interior to itself), so turning a piece's texture is
the same answer as relabelling the cell for the rotated grid.

**Every other grid-authored family has defect 2 and 3 too** (roads, tree masses, building footprints). Only
water is corrected today, because only water's edge art is directional enough to see it. A family joins by
being named alongside `isWaterSetLabel` at the one site in `iso.ts` that sets `turns`.

**Two traps when measuring any of this.** Measure the rim direction from the TOP FACE's own centre, not the
cell's base: the top face is drawn a block higher, and taking the base centre adds a constant upward bias that
reads `_b` as pointing north, which no quarter-turn of that basis can produce. And do not try to settle it
from screenshots: every build is a different random map, half the water sits under canopy, and a photograph
cannot say which of two shorelines a pale band belongs to. The geometry is pure, so ask it.


### Layer 5c, a shore around whatever stands in the water

*"water border should show in anything that 'collapses' with it, so a big rock in middle, definitely needs
borders"* (2026-09-17).

`borderTheWater` builds two sets now rather than one:

    body    every water cell. This is what gets PAINTED, because the ground under a boulder is still water
    open    the body minus every cell with something solid in it. This is what the EDGE TEST asks about

`openWater` subtracts blocking props, composition anchors and tree anchors. Blocking rather than merely
present, because a lily or a fallen leaf is on the water and not in its way, and blocking is the same fact
that stops you walking through the thing.

Measured on real builds across woodland, jungle, meadow, swamp and beach: 79 boulders standing in water, all
79 with water bearing an edge piece on every side of them, none missed.

**The nine-piece family cannot express a cell open on three sides, and standing objects make that common.**
Measured 2026-09-19 through the saved map: every remaining unbordered side sits beside a boulder standing in
the water. The edge pass correctly treats that cell as not-water (this section's own rule), which can leave a
cell open on E, S and W at once; `bl` names two of the three and the third is lost. His instruction is *"we
draw a border connected to each thing that IS NOT water in the direction of the thing"*, which one piece per
cell cannot satisfy: it needs the full sixteen-piece set, or a border drawn PER SIDE as an overlay rather than
as one piece per cell. Recorded, measured and counted, not solved.

**Known limit:** a composition counts at its ANCHOR cell only, so a multi-cell structure standing in water
would border one cell of its footprint rather than all of them. Nothing in the catalog stands in open water
across more than one cell today, so it is recorded rather than solved.



### Measured 2026-09-17: the current families hold the band, the legacy tiles do not

| family | tiles | luminance min | max | spread |
|---|---|---|---|---|
| `water_smooth_river` | 36 | 211.6 | 225.6 | 14.0 |
| `water_smooth_beach` | 36 | 197.9 | 211.9 | 14.1 |
| `water_smooth_lake` | 36 | 180.5 | 211.9 | 31.4 |
| `water_lined_river` | 36 | 235.4 | 240.6 | 5.1 |
| `water_lined_beach` | 36 | 210.1 | 235.4 | 25.4 |
| `water_lined_lake` | 36 | 198.5 | 235.4 | 37.0 |
| **legacy** (`water`, `water_c`, `water_bend`, `water_deep`, `water_shallow`, `water_still`, `water_jet`) | **26** | **144.5** | **255.0** | **110.5** |

So the rule holds where it was applied and fails where it was not. Each current family sits inside a band a
rim can vary within; the legacy set spans 110 points, with `water_c` and `water_jet` blown out at pure 255,
which is the defect `colour-tints-luminance-stays` names: the art carries the tone, so art at 255 and art at
144 cannot read as one substance however they are tinted.

There is also a stale `water_lined_<piece>` set with no KIND segment (`water_lined_c`, `water_lined_b` and the
rest) still baked alongside the three kinded `water_lined_*` families, which is a rival spelling of the same
thing (`TILE-DESIGN.md` 2.8).

**Not fixed here.** Which legacy tiles are still placed by anything is a question for the label sweep, and
deleting a baked tile that something still resolves is how a map ends up with holes in it. Recorded with the
numbers so the next water pass starts from measurement rather than from scratch. It is the same 268-PNG
surface T-PERF-3 counts from the other direction.


### Layer 6, light and shadow

Out of scope for this doc beyond one rule: the water layers are RECEIVERS. A shadow falling across a river is the shadow layer's business and must land on the surface, not be baked into a water tile. See [`LIGHTING.md`](LIGHTING.md), and `SHADOWS.md` when it exists.

---

## 3. What exists today

| Piece | State |
|---|---|
| Water phase in the pipeline | Declared and running before pathways, for woodland, jungle, meadow, cave and settlement. Temple and boss stage have no water. |
| Water as a film over ground | Only for fords and swamp pools. The water tile still IS the ground for open water. |
| The channel | **GONE, 2026-09-19.** The `depth` option is deleted from the catalog (`ABodyOfWaterIsLevel`). |
| Where water sits | **Elevation 0, and the surface stands 0.4 proud of its bed** (`YouCannotWalkIntoWater`, 2026-09-19). It was flat at 0 (`WaterLiesFlat`), and he asked for the body back: *"increase the elevation of the water, looks like it's at 0, but I think we can increase it to .4 or .5 to better simulate the terrain edges"*. A zone is cut one block below its bank, so a 0.4 surface sits 0.6 under it and the cut shows along the channel. A body too small to be a zone sits at its floor's level, so there the surface stands 0.4 ABOVE the bank. `water_still` keeps height 0: the puddle film is the one he signed off as flat. |
| The `height` COLUMN | Water's height is a top-level column on the tile row, NOT a key in `settings`. It reads as absent if you only inspect settings, which is how `water` sat at 0.5 unnoticed while `grass` was 0.0. `water_still` stays 0.0 (the ford and puddle film, flattened by `APuddleLetsYouSeeTheGround`). `water_c` and `water_jet` stay 1.0: those are the FOUNTAIN's basin and jets, object pieces rather than terrain, and they are why a town square's fountain draws as a tall blue box. |
| Water stops you | **The tile carries a full-cell collision box** (`YouCannotWalkIntoWater`). *"I shouldn't be able to walk into ANY real water zone"*. See §Collision below. |
| Everything sinks | **Every water tile serves `stackAt: 0`**, the film included. *"what happens when you put something in water? it sinks"*. The fountain's `water_c` and `water_jet` are excluded: a jet is water leaving the ground. |
| Depth map | `waterDepth()` exists and is correct, including the ford and bridge exceptions. |
| Depth to colour | Not done. Three banded labels instead. |
| Caustics | Nothing |
| Animated surface | Nothing. The water tile is static. |
| Reflections | Nothing |
| Shoreline | Bank set is computed, no foam, no wet edge, no animation |
| Objects on the bottom | Nothing places them |

---

## 4. Build order

Each step is finished when it is judged at :3000, not when it renders in a probe.

1. **Water becomes a film over the real ground**, matching the ford. Acceptance: deleting the water layer leaves a complete map with no holes, and nothing anywhere asks whether a ground label contains "water" to decide what a cell is. *The CHANNEL half of this is done (2026-09-19): no cut, one surface per body. The film half is not: an open water cell's ground label is still the water tile.*

   **Levelling a body to its lowest cell was WRONG and was reverted the same day.** It generalised a narrow
   report ("the town had water over the floor level at height .5") into every template: a body that touched
   one low cell dragged its whole surface down, and on a beach the water is half the map. Water sits at 0.

   **Why the cut had to go, measured.** The option defaulted to "1" with no way to turn it off, so every river
   on every template was cut. A cut subtracts a constant per cell, which KEEPS the ground's unevenness, so one
   body came out at several heights at once. Across all 40 generators: woodland 183 cells at -1 and 11 at 0;
   BEACH 174 at -1 and 158 at 0; mountain spread over four levels. Each step reads as its own pool, which is
   the report: *"WE'RE USING RIVERS AND BEACH WATER LIKE POOLS/PODDLES"*. After: every generator and every
   zone, 176 combinations, one elevation per body and nothing proud of its bank.
2. **Depth drives colour** on one water material. Acceptance: the whole river measures inside one luminance band, and shallow to deep reads as a gradient rather than three stripes.
3. **Caustics on the bed**, attenuated by the same depth map. Acceptance: visible in the shallows, gone in the deep.
4. **The 16 frame surface**, staggered and palette reduced. Acceptance: no directional drift at any of the four facings.
5. **Shoreline**, foam and wet edge, non-linear frames.
6. **Reflections** of bank objects.
7. **Objects on the bottom**, placed with the terrain.

Steps 1 and 2 are prerequisites for everything after them, because 3 through 6 all read the depth map or the film.

---

## 5. The brief against the sources

Recorded so the difference is not lost. The brief given was: regular water drawing, then a deep simulation layer on top, then a lighting effect as a brighter texture in the middle of the deep and flat water, then a physics layer of randomised wave maths with varying amplitude and frequency, then reflections, then shadows, then objects at the bottom with the terrain.

| Brief | Source | Correction |
|---|---|---|
| Regular water drawing | Layer 0 and 1 | Agrees, and the video's first move is separating water from land, which is the law above |
| Deep simulation on top | Layer 1 | It is a height map read by the colour ramp, and it is not "on top", it tints the water itself |
| Lighting effect, brighter texture, in the middle | Layer 2, caustics | Position is different. They sit **on the bottom**, and they FADE with depth `[02:40]` |
| Physics layer, randomised wave maths | Layer 3, option 2 | Correctly described, and the video **rejected** it as overkill and used texture displacement instead `[05:00]`. For a tile engine neither applies; the 16 frame staggered tile is our form |
| Reflections | Layer 4 | Agrees. The 2D form is a vertical flip plus the same distortion |
| Shadows | Layer 6 | Not a layer in the video. The video's extra pass is the animated **shoreline**, which is missing from the brief and is the one the author says sold it |
| Objects at the bottom with the terrain | Layer 0 | Agrees, and it is the video's first step, not its last |

---

## 6. Checklist

Before calling any water work done:

- [ ] The ground under every water cell is a real terrain tile, and the map is complete without the water layer
- [ ] Depth is one number per cell, read by everything that varies with depth
- [ ] One water material, one luminance band, colour varying by depth
- [ ] Caustics on the bed, fading with depth, never on the surface
- [ ] Surface animation shows no direction at any of the four facings
- [ ] Reflections clipped to water and wobbling with the surface
- [ ] Shoreline animates non-linearly and carries foam and a wet edge
- [ ] Every body is ONE connected body, at ONE elevation, and never above the ground beside it
- [ ] Sweep EVERY generator crossed with EVERY zone, not one template. 40 generators, 176 combinations
- [ ] Each border piece's rim faces the bank its label names, at ALL FOUR camera facings
- [ ] EVERY side of every water cell that meets land carries a border facing it, counted, not sampled, and
      counted through the SAVED MAP (`e2e/waterBorders.mjs`), not a stage object a test made up
- [ ] The count of cells open on THREE OR FOUR sides is reported separately. A nine-piece family names at
      most two, so those are a catalog gap and not a choosing mistake, and the two must never hide each other
- [ ] The renderer's "is this a border piece" test is given the LABEL, never a folded kind
- [ ] Anything standing IN the water has the water bordered around it, not just the outer bank
- [ ] Nothing branches on a tile label containing the word "water"
- [ ] Judged at :3000

---

## Collision: water is solid, and the crossings are the exceptions

Added 2026-09-19, from *"collissions aren't correct on water zones, I shouldn't be able to walk into ANY real
water zone"* and, in the same breath, *"when I generate a new world, collissions look ok, when I reload the
world all collissions are gone"*. Those turned out to be one fault with two halves.

### Where the fact has to live

A saved map has six columns: `groundData`, `heightData`, `assetsData`, `connectors`, `entities`, `quests`.
**There is no collision layer.** So what stops you is DERIVED from the assets every time a map loads, and
anything that exists only in the generator's runtime `collision[][]` array does not survive a save.

The generator's own rule was already right, one line in `riverNetwork.ts`:

```ts
collision[row][col] = frozen || ctx.decks.has(key) ? false : !wadeable.has(key)
```

Water stops you unless it is ice, has a bridge over it, or is shallow enough to wade. That is why a freshly
built world behaved and a reloaded one did not.

So the rule moved to where it persists:

- **The water TILE carries a full-cell collision box.** 454 rows, every autotile piece plus `water`,
  `water_deep`, `water_shallow`, `water_bend`, the `water_f*` frames, `deep-water`, `shallow-water`,
  `koi_pond` and `oasis`. A hand-painted lake now stops you exactly like a generated one, with nothing written
  by the generator at all.
- **The cells the generator deliberately OPENS carry a per-instance empty box list.** `declaredBoxes` prefers
  an asset's own `settings.collision` over its tile's, and an empty array means "this cell declares nothing
  solid". `applyStage` writes it wherever the generator's array says a water cell is passable, which is every
  bridge deck, ford and ice cell. Without it the tile's box would seal every crossing on the map.

### Flush water lies flat; cut water stands proud

The tile's 0.4 exists so a CUT channel shows its edge against the bank it runs below. A body that was never
cut sits at the level of the ground around it, and that same 0.4 turns it into a slab standing ON the floor,
which reads as a basin. *"we should increase water elevation of everything EXCEPT the pools/puddles, which
are ALWAYS 0"*.

`layPoolFilm` already says why one label cannot do both, so the CELL states its own height and the tile keeps
the channel's: `applyStage` writes `height: 0` on any water floor with no higher ground beside it. Cut is
measured from the elevation rather than assumed, which is exactly what `levelTheWater` does to a zone and
does not do to a pool.

A pool proper is unaffected: it is the film model already (the floor stays floor, `water_still` lies over it
at `stackAt: 0`, translucent), which is the "terrain visible below" half of the same instruction.

### Three things that are NOT real water

- `water_still` is the FILM a ford, a pool and a swamp puddle lay over ground that stays ground. It never
  blocks: *"a ford is walkable because it is a ford"*. It keeps height 0, and it does take `stackAt: 0`.
- `water_c` and `water_jet` are the FOUNTAIN's basin and jets, object pieces rather than terrain. They already
  block, they stand a block tall, and they are excluded from the sinking rule.
- `frozen_water` and `ice_water` are the winter surface you walk ON.

### The race that made it look intermittent

`assetIsSolid` falls back to the SERVED TILE when an asset pins no boxes of its own. Deriving the collision
map before the tileset has loaded therefore answers "nothing is solid" for every asset that leans on its tile,
which is most of them. Loading a saved map did exactly that derivation, and the two were not ordered.

Measured, three identical runs of `e2e/waterCollision.mjs` on the same build: of 92 solid water cells, a
reload restored 92, then 1, then 8. So `rebuildCollisionFromAssets` is exported and run AGAIN the moment the
tileset lands. It only ever turns cells on, so it is idempotent and re-running it can undo nothing.

### Two rules that fell out of it

- **`blocking` and collision boxes are BOTH asked**, until the deprecated flag is actually gone. 20 tile rows
  in the catalog set `blocking` while declaring no box, and a generated `pillar` is one of them, so asking
  only about boxes swapped one set of missing collisions for another.
- **Nothing is solid with nothing in it.** The assets ARE the collision data, so a cell marked solid while
  holding no asset cannot survive a save, and measurably did not: one cell per map, always on the outer row,
  stopping you before the save and letting you through after it. `applyStage` clears those, which makes the
  built map agree with the loaded one by construction and removes a wall nobody can see.

### The gate

`assets/e2e/waterCollision.mjs` builds a world with a river through the UI, reads what is solid, saves it,
loads it in a FRESH page and reads again. The two have to agree, and the water cells have to be solid in both.
It makes its own scratch template and deletes it afterwards, because the editor's Save updates the template it
has open, and on a database with one saved map that means overwriting the user's work. That happened once.

Backend half: `test/nebulith/catalog/water_stops_you_test.exs`, which pins the tile rows, including the three
exclusions above (a rule that blocks `water_still` seals every ford on the map).
