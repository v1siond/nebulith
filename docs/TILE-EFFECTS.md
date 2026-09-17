# TILE EFFECTS: textures, animation and physics

What water turned out to need, generalised so every tile can have it. This is the framework for effects that sit ON a tile rather than being baked into its art.

Read [`TILE-DESIGN.md`](TILE-DESIGN.md) first (what the tile's own art must be) and [`WATER.md`](WATER.md) (the case this came from). Nothing here is built yet; this is the design to build against.

---

## 0. Where it came from

His words, 2026-09-16, after the water work:

> *"the water uncovered something, we need better tile UI/UX and systems too. for example, we have water that can have many layers, like textures, physics. I think those should be new system that are applied to all tiles."*

> *"the textures are pretty straight forward I think, we can add textures on top of tiles and animate them."*

> *"physics is the tricky one, we must be able to add/define physic formulas on the backend, and user should be able to just select the type of physic base of the result of the math in the cartessian plane, so for water we used wave physics randomized, that's one physic preset, we can have many for all kinds of thing, we can have electricity physics for example."*

> *"animations now are more complex too, because they can be sprite based, just changing sprites; they can be setting base, IE: opacity, width; they can be physics, where a specific physics behavior is applied to the element."*

> *"I want to be able to expand what we did with water to ALL other tiles and cells, but as configurable thing that is controlled in the backend and that is available to users as simple options."*

And the open question, in his words: *"my only doubt is how to define element, it can be the tile initially and cell initially, but I think we might want to be able to add animations to layers too, like we might want to animate textures."*

### Source: grass, and what it settles

**"How I made grass better than 99% of games"**, Dylearn, 17:22, `https://www.youtube.com/watch?v=OxsuWDtjuGw`. A shader piece, but almost everything in it is a rule about VARIATION and TIMING that a tile engine needs just as much.

What to take, read for both halves (what to build, and what to offer):

1. **Two kinds of heterogeneity, and they are different** `[02:00]`. COLOUR PATCHES come from sampling a world-space noise texture against a threshold, so neighbouring cells share a tone and the field reads as patches rather than static. ACCENT INSTANCES come from a per-instance seed against a threshold, so a subset differs in size, height, colour AND sprite. Patches are about place; accents are about the individual.
2. **Paint the patches on the FLOOR as well as on what stands in it** `[02:30]`, "to ensure consistent coloring". A field whose grass is patchy over a flat floor reads as decals on a carpet.
3. **Two noises multiplied, at scales related by an irrational number** `[04:00]` to `[04:30]`, so the pattern never repeats. Using pi for the ratio is the trick, and it is cheap.
4. **Quantise TIME, not the movement** `[08:00]` to `[08:30]`. He tried snapping the rotation to fixed positions and it fell apart at small angles and drifted with speed. Quantising the time the noise is sampled at gave the low-frame-rate charm properly.
5. **And phase-shift every instance** `[09:00]`. Quantised time alone made the whole field update on the same frame, "it just looked laggy". Each blade gets a phase offset from its own world position modulo the frame time. **This is the same rule the water surface needed for a different reason**: a field that moves in lockstep reads as a mistake, exactly as a surface that moves in one direction reads as a conveyor.
6. **A reactive mask is a distance falloff** `[10:30]`: distance from the player over a radius, inverted, raised to an exponent to control how sharp the edge is.

Points 1, 4 and 5 are the ones that apply here with no shader at all: they are about which tile a cell picks and when its frames advance, and both are things a served effect can express.

### The maths underneath it, lifted out of the grass

At his instruction: *"it has mathematical foundamentals we can apply to other systems, like the textures, wind, etc, add note to extract other information outside of the grass context and look for useful usages of it."*

Seven primitives. None of them is about grass; grass is just where this source happens to use them. Each one is a candidate `physics` preset or a served effect parameter, and the third column is where it is worth trying FIRST.

| Primitive | What it does | Where else it pays |
|---|---|---|
| **Noise against a threshold** | Turns a smooth field into REGIONS. Neighbours share a value, so the result reads as patches rather than static. | Which floor tint a cell wears, where a species clusters, ore veins, snow and frost patches, damp ground near water, the depth ramp in `WATER.md` |
| **Per-instance seed** from an id or world position | Gives each object a stable random number WITHOUT storing anything. The same cell always answers the same. | A tile's variant, a building's material, a tree's size preset, which of a family's frames a cell starts on. This is already how the leaf shade is picked |
| **Two noises multiplied, scales in an irrational ratio** | Kills visible repetition, because the two never line up again. Pi is the cheap choice | Any tiling texture: the water surface, clouds, fog, a terrain tint, anything drawn over a large area |
| **Quantised time** | A stepped, low-frame-rate look that stays correct at small movements and does not drift with speed. He tried quantising the MOVEMENT first and it fell apart | Every sprite animation in the game, if a chunkier look is ever wanted |
| **Per-instance phase offset** (seed mod frame time) | Stops a whole field updating on the same frame, which reads as lag | Every animated tile placed in numbers: water, fire, torches, flags, crops, idle units. The single most reusable idea in the video |
| **Dot product for alignment** | Scales an effect by how much two directions agree, 1 when parallel and 0 when perpendicular | Applying an effect only at certain camera facings, light falling on a slope, wind against a wall, anything directional in a world that turns |
| **Inverted distance, raised to an exponent** | A radial mask whose edge softness is one number | Player proximity (grass parting, the existing `fadeNear`), light radius, damage falloff, fog-of-war edges, shadow softness |
| **A UV gradient as a proportional weight** | Makes an effect stronger at the top of a thing than at its bottom, by multiplying it by the inverted vertical coordinate | **Wind on a tree**: a crown should sway and a trunk should not. Also flags, smoke, tall grass, anything rooted at one end |

The last one is the one to reach for soonest: it is the difference between a tree that sways and a tree that slides.



---

## 1. The three kinds of animation

The engine already has ONE of these and calls it "animation", which is why the word needs splitting.

| Kind | What changes | Built today |
|---|---|---|
| **Sprite** | Which picture is drawn. A list of frames and a frame time. | Yes. `settings.frames` + `frameMs`, plus the `sprite` animation envelope. 67 unit tiles and both water sets use it. |
| **Setting** | A numeric property over time: opacity, width, height, tint. | Partly. A `settings` envelope with `tracks` exists and is used for exactly one thing, water's flat opacity. Nothing varies a track over time yet. |
| **Physics** | A named formula drives a property, deterministically, from time and position. | No. This is the new one. |

A tile may carry more than one at once. Water's surface is a sprite loop and a settings track together, and that pairing is already in the data.

---

## 2. Textures

A texture is a picture drawn OVER a tile, in its own pass, with its own colour, opacity and animation. It is not part of the tile's art and does not change what the tile IS.

Water needs three of them (caustics on the bed, the surface sheen, foam), which is what makes this worth generalising rather than hard-coding.

The shape this wants:

- A texture names a tile LABEL for its picture, so it comes through the same bake pipeline and is authored by the same rules as any other tile art.
- A tile carries an ordered list of them. Order is the draw order.
- Each entry states its own opacity, tint, scale and animation.
- A texture is drawn clipped to the tile's own footprint, so it cannot bleed into a neighbour.

Open, and to be settled when it is built: whether a texture can itself carry a texture (his *"we might want to animate textures"* suggests the answer is that a texture is an ELEMENT like any other, not a leaf).

---

## 3. Physics

The hard one, and the reason this doc exists rather than a ticket.

**The model he described:** a physics preset is a named piece of maths, defined in the BACKEND, that produces a value over the cartesian plane and time. The user does not write maths; they pick a preset by what it looks like. Water's surface is "randomised waves, varying amplitude and frequency". Electricity would be another.

So a preset is roughly: given `(x, y, t)` and a few served parameters, return a number. What that number DRIVES is separate: it can offset a texture, modulate an opacity, pick a sprite frame, or tint.

Two things this framework asserts before anything is coded:

1. **A preset is DATA, not code in the frontend.** The parameters, the ranges and the defaults are served. The frontend evaluates a declared form; it does not carry a library of named effects. This is the same rule as every other served catalog.
2. **It has to be cheap and deterministic.** It runs per visible cell per frame. Deterministic means the same cell at the same time gives the same value at every camera facing and on every machine, which is also what makes it testable. See the facing rule in `TILE-DESIGN.md` §2.5: an effect with a net direction is wrong at three of the four facings.

**Not yet decided, and needing research before it is:** how the formula is expressed so it is both served and safe. Options seen in real engines are a small expression language, a fixed set of parameterised primitives (sine sum, noise, ramp, pulse), or a shader snippet. The middle one fits this codebase best on first look, because it keeps the data declarative and the evaluation fast, but this needs the research pass the framework rule demands before it is chosen.

---

## 4. What an effect is attached TO

His open question, and the thing to settle first, because everything else depends on it.

The candidates, and what each would mean:

| Attach to | Means | Cost |
|---|---|---|
| **Tile (the catalog row)** | Every instance of that label everywhere gets it. | Cheapest. No per-map data. Cannot vary by place. |
| **Cell (the placed asset)** | This one cell has it. | Per-map data, and a map carries thousands of cells. |
| **Layer** | Everything the layer drew gets it, which is how his water layers read. | Matches the water model exactly. No such attachment point exists yet. |

**The recommendation this framework makes:** attach to the TILE as the default, allow a per-cell override the way every other setting already works (`settings` on the asset wins over the catalog row), and add the LAYER as a third scope when the layer stack can carry data of its own. The precedent is already in the code: `assetActsAsTile` and `assetStackAt` both read a per-instance override first and the served tile second. An effect should read the same way, so there is one rule for how a setting is resolved rather than two.

---

## 5. Build order

Nothing here is built. In dependency order:

1. **Split the word "animation"** into the three kinds above, in the data and in the editor, so a person can tell which they are adding.
2. **Textures**, the straightforward one. A list on the tile, drawn in order, each with its own tint and opacity.
3. **Setting tracks that actually vary**, which is a small step from what exists (the envelope is there, it just holds constants today).
4. **Physics presets**, after the research pass that picks how a formula is expressed.
5. **Layer scope**, once the layer stack can hold data.

Water is the proving ground for all five, because `WATER.md` already names exactly which effect each of its layers needs.

---

## 6. Checklist

- [ ] The three kinds of animation are distinguishable in the data and in the UI
- [ ] A texture is a tile label through the normal bake pipeline, never a special asset
- [ ] Every preset and its parameters are served from the backend
- [ ] An effect resolves per-instance override first, then the served tile, the same as every other setting
- [ ] Deterministic: same cell, same time, same value at all four facings
- [ ] Measured against a stated frame budget (see the missing `PERFORMANCE.md`)
