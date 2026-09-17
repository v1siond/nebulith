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
the camera gives the coordinate.** `turns = PICTURE_TO_GRID + facing`, measured correct at all four facings in
`waterRimFacesItsBank`. It is sound rather than a nudge because the nine-piece family is CLOSED under a
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

### Layer 6, light and shadow

Out of scope for this doc beyond one rule: the water layers are RECEIVERS. A shadow falling across a river is the shadow layer's business and must land on the surface, not be baked into a water tile. See [`LIGHTING.md`](LIGHTING.md), and `SHADOWS.md` when it exists.

---

## 3. What exists today

| Piece | State |
|---|---|
| Water phase in the pipeline | Declared and running before pathways, for woodland, jungle, meadow, cave and settlement. Temple and boss stage have no water. |
| Water as a film over ground | Only for fords and swamp pools. The channel still overwrites `ground`. |
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

1. **Water becomes a film over the real ground**, channel included, matching the ford. Acceptance: deleting the water layer leaves a complete map with no holes, and nothing anywhere asks whether a ground label contains "water" to decide what a cell is.
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
- [ ] Every body is ONE connected body, and a channel has interior cells to be the middle of
- [ ] Each border piece's rim faces the bank its label names, at ALL FOUR camera facings
- [ ] Nothing branches on a tile label containing the word "water"
- [ ] Judged at :3000
