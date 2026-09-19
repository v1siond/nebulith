# TILE DESIGN, the framework

How to design the ART of a tile so it reads as the thing it is named after. This is the companion to [`TILESET-AUTHORING.md`](TILESET-AUTHORING.md), which says where a tile lives and how it is baked, and to [`OBJECT-CONSTRUCTION.md`](OBJECT-CONSTRUCTION.md), which says how tiles are assembled into an object. Neither of those says what to actually draw. This does.

Read [`MAP-MODEL.md`](MAP-MODEL.md) and [`TILE-VOCABULARY-CONTRACT.md`](TILE-VOCABULARY-CONTRACT.md) first.

---

## 0. Sources

1. **westenfry isometric water tile tutorial**, `https://westenfry.com/tutorial/`. A 64x32 isometric tile animated over 16 frames, wave layers duplicated and staggered in time, palette reduced afterwards.
2. **jess::codes, "How I Created 2D Pixel Art Water"**, `https://www.youtube.com/watch?v=pGOLstWBCDA`. Rule tiles, frame by frame edge animation, and edge pixels coloured differently to make an outline `[01:40]`.
3. **This repo's own measurements.** Every numbered fact in §2 came out of a defect that shipped, so they are not style opinions.

---

## 1. How a tile is authored here

Non-negotiable, and it shapes every rule below.

- A tile is an **inline SVG on a `0 0 128 128` viewBox** in `nebulith/priv/tilegen/tiles.json`, baked to PNG by `bake.mjs`, seeded through `TileSource`.
- **One entry per style.** The same SVG appears once with `"style": "ascii"` and once with `"style": "emoji"`, each carrying its own `glyph` or `emoji` fallback. A style is only a different picture for the same label, never a different engine.
- **Art is drawn in white and grey, and the colour comes from the tile's `color` setting.** This is the single most important mechanical fact. `#ffffff` takes the full tint, `#d6d6d6` takes a slightly darker version of it, `#9a9a9a` a darker one again. One tile setting therefore produces a whole coherent set of tones, and a template can restyle the tile by changing one hex.
- A tile has **one colour setting and one luminance**. See §2.1.

---

## 2. The rules, each with the defect that produced it

### 2.1 One material, one luminance band

A tile's colour setting moves the **hue**, never the **tone**. Two tiles meant to be the same substance read as two substances the moment their ART is drawn at different luminance, no matter that they carry the same hex.

Measured: the river's three depth bands spanned luminance 194.7 to 91.2 while all three carried one colour. It stopped reading as water and started reading as three materials.

**Rule:** all pieces of one material are drawn inside a luminance band of about 25. Depth, wear, age and light are expressed by the tint or by a separate layer, not by redrawing the art darker.

### 2.2 Full bleed, or the block becomes an open crate

A tile with a transparent margin looks fine flat and becomes a hollow box the moment it is extruded into a block, because the extrusion shows the block's own dark interior through the gap.

Measured: `sq_brown`, `sq_green` and `sq_white` are baked from emoji glyphs with a 31.0%, 30.4% and 31.0% transparent margin. Eighteen tiles pointed at `sq_brown`, so every boardwalk plank, dirt path, bridge deck, cave floor and mud hut drew as an open box.

**Rule:** any tile that can be extruded is authored **full bleed**, edge to edge, no transparent margin. Check the alpha at the border before shipping it. A tile that is genuinely meant to have a hole (a ring, a jet of water) is a decor tile and must never be given a height.

### 2.3 A material is a FAMILY, not one picture

A surface that meets another surface needs edge pieces, or the boundary is a staircase of square corners. The canonical naming is in the vocabulary contract: `_tl _t _tr _l _c _r _bl _b _br`, nine pieces.

Measured: the dirt path was attempted three times as a colour change alone and always drew a staircase. On the reference the dirt-to-grass boundary wanders about 0.17 of a cell, which is detail that only exists INSIDE the art. It was fixed by authoring nine pieces with the boundary drawn into them.

Families already built and worth copying: `canopy` (9), `wall_stone` / `wall_brick` / `wall_plaster` / `wall_wood` (9 each), `path_edge` (8), `shore` (8), `fountain` (8).

**Rule:** if a material has a visible boundary with anything else, it is authored as a family. The centre piece is the fill, the eight others carry the boundary.


**A family is also a COST, and the cost is in the multiplier.** Source, 2026-09-17:
[Dual-grid tilesets](https://www.youtube.com/watch?v=jEWFSv3ivTg&t=77s), jess::codes. Eight neighbours means
256 unique tiles if nothing is folded, so every real tileset is a compromise: 15 pieces with the edges drawn
through the middle of a tile and therefore off the world grid, 47 aligned pieces, or a 16 piece subset that is
aligned but breaks on inner corners. The dual grid alternative keeps a second display grid offset by half a
tile and reads four overlapping neighbours, which caps it at 16 configurations, aligned, with rounded inner
AND outer corners.

Measured here: 719 labels, 288 inside autotile families, and **216 of those are water**, which is 30 per cent
of the catalog. That is not the nine pieces, which is already fewer than dual-grid's sixteen. It is 6 families
times 4 frames. When a new family is proposed, the question to ask is what MULTIPLIES, because the pieces are
the cheap part. Full writeup in [`GAPS-AND-ROADMAP.md`](GAPS-AND-ROADMAP.md) T-PERF-3.


### 2.4 The border is painted into the edge pieces

An outline around a material is not a shader pass, not an overlay and not a separate object. It is the edge pixels of the edge tiles, coloured differently from the body.

Source 2, `[01:40]`: *"When I was handdrawing all these sprites, I also made sure to color the edge pixels differently in order to create an outline for the water."*

In our pipeline this is free, because of §1. Draw the body at `#ffffff` and the rim at a fixed grey in the SAME SVG, and one `color` setting yields a tinted body with a naturally darker rim of the same hue. `shore_t` already does exactly this: a white band with a `#9a9a9a` stroke.

**Rule:** every edge and corner piece of a family carries a rim drawn at a darker grey than its body. The rim is 3 to 4 units wide on the 128 viewBox, which is about 3% of the tile.

### 2.5 Movement is frames on the piece, staggered

Animation belongs to the tile as `settings.artFrames` plus `frameMs`, the same envelope a unit uses. The pieces of a family animate, which is how an edge moves in and out while the interior stays calm (source 2, `[01:40]`).

Two facts from source 1:

- **16 frames** for a full water cycle.
- The wave layers are **duplicated and offset in time** so no single direction dominates. Then the palette is **reduced**, because the blur that appears between frames reads as mush rather than as water.

**Rule for this engine specifically: a surface animation must have no net direction.** The camera turns to four facings, so a tile that visibly flows one way is flowing the wrong way at three of them. Stagger is a correctness requirement here, not a style choice. Validate at all four facings.

### 2.5b A frame count must close the loop

If a frame shifts the art by a fixed step, the number of frames times the step has to equal exactly one period of the pattern, or the loop jumps when it wraps.

Measured: the water wave has a 32px period in the 128px tile and each frame shifted it 8px. Three frames jumped back a third of a period every cycle, which read as a flicker. Four frames advance exactly one period and the loop closes.

Better still, do not shift at all. A bobbing phase (crests moving up and down on a sine that returns to zero) closes by construction and has no direction, which is what §2.5 requires anyway.

### 2.6 Variants are different art, tints are not variants

A tint is one material in a different hue. A variant is a different material: different wave shape, different rim, different density of detail. Serving four hexes for `palette.water` gives four colours of the same substance, which is worth having, but it is not a choice of water.

**Rule:** a variant gets its own family of pieces. It may reuse the geometry helper that draws them, but the numbers that shape it differ, and it carries its own default colour.

### 2.6b A ground tile is resolved by KIND before its label

For a floor, `assetTileImage` asks `groundKind` first and only then the tile's own name. `groundKind` folds by regex, so `/water|oasis|koi_pond/` all become the kind `water` and draw one picture.

This is why authoring a second set of water art changes nothing on its own. **Before designing a variant of any ground material, check whether `groundKind` folds it.** If it does, the label has to be made to win first, or the art is invisible no matter how good it is.

### 2.7 Every tile carries a category, or it does not exist

The editor palette lists a tile only when its `category` is one of the browseable buckets. A tile with no category is invisible in the UI while still being paintable by the generator, which reads as "the tile is missing".

Measured: 53 of 411 tiles in the live tileset carry no category at all.

**Rule:** set the category when authoring. Related tiles go in the SAME bucket, so a user can find the whole family in one place. Do not scatter one material across terrain, nature and props.

### 2.8 Name it by the vocabulary, never by shape or by hyphen

`<base>_<edge>`, underscores, lowercase. The base is the material or role.

Measured: `deep-water` and `shallow-water` exist alongside `water_deep` and `water_shallow`. Four tiles for two things, because a hyphenated pair was added without checking the contract.

**Rule:** before authoring, grep the existing labels for the base word. If a name already exists in another spelling, the job is to converge them, not to add a third.

---

## 3. The checklist

Before a new tile is called done:

- [ ] Authored as SVG on the 128 viewBox in `tiles.json`, one entry per style
### 2.4 A tile authored for one style only falls back to a square

`road_center` is authored in `tiles.json` as an ASCII GLYPH and nothing else. On the emoji style there is no
art for it, so the street's centre marking resolves to a plain filled tile, which is what
*"the 'lines' are big squares instead of actual street lines"* is looking at.

The rule that catches this is §1: a tile is an inline SVG baked to PNG and seeded for BOTH styles. A glyph
only entry is an ascii-only tile, and any label the generator lays on a map every style can open has to be
authored as art, not as a character.

Check it the same way as the nine piece families: render every member. A marking drawn as a lane stripe also
needs its own direction, so it belongs to a piece family rather than being one square repeated along the way.

- [ ] Full bleed if it can ever be extruded, alpha checked at the border
- [ ] Drawn in white and greys so the `color` setting does the tinting
- [ ] Inside its material's luminance band
- [ ] Part of a nine piece family if it has a boundary with anything
- [ ] Edge and corner pieces carry a darker rim
- [ ] Any animation has frames on the piece and no net direction
- [ ] Category set, and the whole family in one bucket
- [ ] Name checked against existing labels for a rival spelling
- [ ] Baked with `bake.mjs`, seeded through a data migration, read back from the live API
- [ ] Looked at in the running game, at all four facings, and judged at :3000

---

## 4. The bake, end to end

```bash
export PATH=/home/visiond/.nvm/versions/node/v24.15.0/bin:$PATH
cd nebulith/priv/tilegen && node bake.mjs --only=<comma separated labels>
cd nebulith && mix nebulith.data_migrate --only <MigrationName>
curl -s localhost:6328/api/tilesets | grep <label>
```

Editing the seeder is not changing the database. Run the migration and read the field back from the live API before saying it is done.

---

## Source: foliage, and the independent confirmation of our colour model

**"How I made better foliage than 99% of games"**, kodiakwhale, 4:16,
`https://www.youtube.com/watch?v=GOfttJQ-FGw`, shared as *"good context on follage, useful to do lots of
different grass types"* and *"great context on how to build more complicated trees"*.

**"Stylized Grass & Trees for Pixel Art 3D in Godot 4"**, Eduardo Schildt, 18:09,
`https://www.youtube.com/watch?v=iPbYzFWECz4`, shared as *"godot style grass"*.

Both are 3D shader pieces. Most of what they teach is about the ART and the VARIATION, which is engine
agnostic, so it transfers here with no shader at all.

### The one that matters most, because it is our model arriving from outside

`[00:53]` to `[01:02]`: sample the texture for colour, then **map a COLOUR PALETTE onto the GREYSCALE of the
texture**. That is precisely what this document already requires (§1: white and greys only, the served colour
tints them) and what `foliageColor` does per biome. An independent source reaching the same design is the
strongest evidence we have that the tile model is right, and it is worth knowing we are not improvising.

### Fix the ART before you reach for a setting

`[00:29]` to `[00:38]`: *"If you want a game to have good graphics, of course, shaders are important. But a
Minecraft tree is always going to look like a Minecraft tree. If we want fluffy foliage, we first need to
improve our models."*

The local translation: no render setting rescues a bad tile. This was proved here the expensive way. A cactus
composition drew as a green box, and the cause was that `cactus.png` was a BLANK WHITE SQUARE. No amount of
scale, shape or display tuning would ever have fixed it; authoring the silhouette did, in one pass.

### What a leaf texture should actually be

`[02:53]` to `[03:00]`: The Witness's leaf textures are *"just a bunch of random individual leaves"*, not a
green mass. Our `leaf_center` should be judged against that: individual leaves at one luminance, not a blob.

`[03:55]` to `[04:03]`: interior shadow inside each clump, and a BLUISH tint on the parts in shadow. A warm
light and a cool shadow is the oldest trick in painting and it costs one extra tone in the art.

### Variation is three things, not one

`[00:41]` to `[00:50]`, for grass: randomly ROTATE, randomly adjust POSITION, and raise DENSITY. We serve
density already and place on a lattice. Rotation and sub-cell position jitter are the two we do NOT do, and
they are the cheapest remaining wins for making a field stop looking like a grid.

Cross-reference `TILE-EFFECTS.md` §0: this is the per-instance seed primitive again, applied to three
properties instead of one.

### Wind, for when setting-animation arrives

`[01:12]` to `[01:29]`: wind is a SCROLLING texture sampled over time, used for two things at once, a colour
shift and an actual bend. Two constraints stated plainly: the texture must be very SMOOTH (*"anything with
edges will look horribly unnatural"*) and it must TILE, or the repeat is visible.

Pair with `MATH-FOUNDATIONS.md` §3.1 (the sway is a sine) and §0.5 of `TILE-EFFECTS.md` (phase offset per
instance), and with the UV-gradient note: a crown sways, a trunk does not.

### Two performance facts worth keeping for PERFORMANCE.md

Not actionable yet, and `PERFORMANCE.md` does not exist, so they are parked here rather than lost:

1. `[02:12]` to `[02:22]`: batch per CHUNK, not per world. One batch is fastest to draw and worst to edit
   (changing one blade re-uploads everything). Chunking keeps *"99% of the performance gains"* while making
   an edit local. Our editor edits constantly, so if batching ever happens it has to be chunked.
2. `[02:28]` to `[02:42]`: level of detail by distance, *"if we were painting a landscape, we wouldn't paint
   individual leaves in the background like we would in the foreground"*.

### What it teaches us to OFFER

His stated reason for sending it: *"useful to do lots of different grass types"*. A grass TYPE is a tile plus
a density plus a placement rule, which is data we already serve. The gap is that every biome currently
reaches for `thicket` or `tall_grass` and nothing else, so a beach has a woodland's shrub in it. More grass
types is a catalog job, not an engine job.


### 2.9 A floor tile and a block are different tiles, and height is what says which

`volcanic_rock` was `category: terrain` at `height: 0.0`, which is a FLOOR: it paints a cell and occupies no
block. Building a composition out of it gives cells that extrude to nothing, which is the same defect
`ACactusIsAnObject` recorded from the other side ("Copying `tree_dead`'s 0.0 left a visible GAP between the
stacked segments").

Before using a label as a block, check its height. If it is 0.0 it is a floor, whatever its name suggests.

Promoting one is allowed and is usually better than minting a rival name: 2.8 says converge rather than add a
third spelling. Check what references it first. `volcanic_rock` was referenced by zero generators and zero
compositions, so promoting it broke nothing.

