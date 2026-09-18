# TERRAIN: what the ground is, and what colour it is

The floor of a map: which tile is laid, what tint it takes, and how that changes by biome, region and season.

Read [`MAP-MODEL.md`](MAP-MODEL.md) first (a floor is a TILE like any other, §4), then
[`TILE-DESIGN.md`](TILE-DESIGN.md) for how the art is drawn and [`TREES.md`](TREES.md) §2b for the three
colour axes, which this follows deliberately rather than inventing a second scheme.

---

## 0. Why this exists

It was a listed GAP in [`FRAMEWORKS.md`](FRAMEWORKS.md) while every biome's floor was being decided by
whoever touched it last. The result, measured off `/api/generators`:

| generators | floor | hue |
|---|---|---|
| **Beach == Desert** | `#7c8a4e` | 74d, an olive GREEN |
| Jungle == Swamp == Ruins | `#2f4a2a` | 111d |
| Woodland == Mountain | `#6f7f4a` | 78d |
| Meadow | none | paints a season gradient instead |
| Volcanic | `#4a3f3a` | 19d, its own ash |

**A desert's ground was a green olive, identical to a beach's.** Same defect the canopy had, and the
undergrowth after it: a handful of values shared across biomes that should not share anything.

---

## 1. The model

A floor is a TILE in the cell, at level 0, like everything else. Two things decide how it looks:

| | what it is | where it comes from |
|---|---|---|
| **The tile** | which ground is laid: `sand`, `grass`, `basalt`, `adobe`, `ash` | the layout, per region |
| **The tint** | the colour that tile is drawn in | `palette.floor` / `floorAlt`, per generator |

294 terrain tiles exist, including `sand`, `beach-sand`, `desert`, `adobe`, `ash`, `basalt`, `dead_grass`,
`frost` and `cliff`. The catalog is not the limitation; what a generator SERVES is.

### The two-tone rule

Every biome serves `floor` and `floorAlt`, and the generator mottles between them so a field never reads as
one flat fill. This already works and is not changed here. `litter` is the third tone, bare earth showing
through, and `bank` is the strip where ground meets water.

---

## 2. The colour, measured

Sampled off his own references (`references/SOURCES.md`), taking GROUND pixels only: warm hues (sand, rock,
earth) plus anything desaturated and bright, excluding the vegetation band and the blue of sky and water.

| Reference | ground share | hue | sat | val | reading |
|---|---|---|---|---|---|
| desert-simpson-australia | 74% | **23d** | 0.48 | 0.58 | red-orange sand |
| desert-plants | 43% | **4d** | 0.39 | 0.69 | pale red sand |
| beach-coastal-plain-brazil | 42% | n/a | **0.14** | 0.79 | pale, near neutral |
| beach-dunes-de-hoop | 26% | n/a | **0.13** | 0.69 | pale, near neutral |
| mountain-california-treeline | 28% | n/a | 0.16 | 0.52 | grey rock |
| meadow-lady-farm-steppe | 52% | 21d | 0.62 | 0.64 | golden dry earth |

**Two of those rows are not usable and saying so matters.** At saturation 0.13 a hue is meaningless, so the
beach readings say "pale and neutral" and nothing about hue. The jungle sample came back at sat 0.04 / val
0.84, which is sky haze between the leaves rather than ground, so the jungle floor is reasoned from leaf
litter instead of measured.

### What that gives each biome

Hue and saturation from the references where they are trustworthy, value kept inside a band the tile art can
carry (`colour-tints-luminance-stays`: the tint moves the hue, the art carries the tone).

| biome | ground is | hue | note |
|---|---|---|---|
| Desert | red-orange sand | ~22d | the strongest signal in the whole set, 74% of a frame |
| Beach | pale sand | ~40d, low sat | neutral and BRIGHT is the whole character |
| Mountain | grey rock | low sat | thins to bare stone with altitude |
| Woodland | leaf litter over soil | ~78d | untouched, it is the approved one |
| Jungle | dark wet litter | ~90d, dark | reasoned, not measured, and marked as such |
| Swamp | darker, wetter | ~80d, darkest | murk, not green |
| Ruins | overgrown stone | grey-green | stone showing through growth |
| Meadow | serves none | | it paints a season gradient, which is deliberate |
| Volcanic | ash and basalt | ~19d | already its own |

---

## 3. Region and season

The same three axes as foliage, so there is ONE idea in the engine and not two.

- **Biome** sets the hue, as above.
- **Region** already works: a sub-zone serves its own `floor`, and `paintSubZoneFloors` uses it. A glade, a
  deep wood and a lakeside are already different tones where a generator says so.
- **Season** is the tile's own per-zone colour, the same `settings.colors[zone]` array every tile carries.

**Not built:** the floor does not blend biome and season the way `foliageColor` does for a leaf. A winter
desert is a desert-coloured floor, not a frosted one. That is the obvious next step and it should reuse
`foliageColor`'s arithmetic rather than grow its own.

---


## 5. WHY EVERY REGION LOOKS THE SAME, found 2026-09-17

> *"in woodland, pikcing Edge of the wood, gives you the exact same design that all the others ... each region
> in any given type/bioma should have their own specific overall design and footprint"*, and the one that
> names it exactly: *"we have a 'shore' region on the beach forest and when I load it THERE'S NOT A FUCKING
> BEACH IN SIGHT, how's that we're in shore AND THERE'S NO BEACH????"*

Measured on a beach with `shore` picked, region by region:

| region | cells | water | **sand** | commonest ground |
|---|---|---|---|---|
| shore | 923 | 134 | **0** | `meadow` x712 |
| dunes | 185 | 33 | **0** | `meadow` x152 |
| palms | 185 | 30 | **0** | `meadow` x149 |
| backshore | 185 | 88 | **0** | `meadow` x86 |
| inland | 122 | 0 | **0** | `meadow` x122 |

Not one grain of sand on a beach, and the water that is there is a RIVER
(`water_smooth_river_c`), not a sea. He is right, and no amount of region data could have fixed it. There are
four layers to it and the region work sits on top of all four.

**1. No ground tile has any texture.** `beach-sand` is the glyph `⋄`, `meadow` is `⁘`, `floor` is `⸪`. Ground
tiles are glyph-baked line art at a few per cent alpha, so sand, grass and ash are near-invisible speckles
over a flat colour. Sand cannot look like sand because there is no sand picture.

**2. And then every one of them is replaced anyway.** `flattenFloors` swaps each open-ground material for the
single `floor` tile, keeping only the colour it wore. So a desert, a beach and a meadow are literally the same
tile in three tints. That is the whole visible difference between the biomes at ground level.

**3. A region can only modulate VEGETATION.** Canopy, undergrowth, species, a leaf tint, a floor tint. It
cannot state its ground, its water, its elevation or its structure. So "shore" and "inland" differ in how many
trees stand on identical ground.

**4. A beach has no sea.** Its only water is the optional river, the same river every other biome gets.

### What actually has to change

Region DATA is not the lever and never was. In order:

1. **Ground tiles need real art**, so sand reads as sand. `TILE-DESIGN.md` is the framework, and this is the
   same authoring gap that blocked the tropical species.
2. **`flattenFloors` has to stop erasing them**, or the art in step 1 is invisible. It exists for a reason
   worth finding before it is touched.
3. **A region must be able to state its terrain and its water**, not only what grows on it. That is the
   mechanism behind *"their own specific overall design and footprint"*.
4. **A beach needs a sea**: open water along an edge, which is a shape no current course draws.

Steps 1 and 2 are the ground, and ticket 2 rewrites the terrain layer wholesale (*"we'll apply math that will
randonmize the terrain forms ... run the terrain math as the first layer"*), so they belong with it rather
than ahead of it.


## 6. Checklist

- [ ] No two biomes share a floor pair
- [ ] Every biome's floor hue traces to a measured reference, or is marked as reasoned
- [ ] `floor` and `floorAlt` differ enough to mottle, and not so much that they read as two materials
- [ ] The floor is a TILE at level 0, never a special case
- [ ] A region that states its own floor still wins over the biome
- [ ] Judged at :3000, in play mode, against the reference
