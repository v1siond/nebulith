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
