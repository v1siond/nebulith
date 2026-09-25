# Reference art, and where it came from

Isometric art we MODEL AGAINST. None of it ships, and none of the image FILES live in this repository: they are
licensed stock previews, so they sit in the workspace at `.claude-workspace/game-website/references/` and only
their sources are recorded here. Every tile this engine draws is authored in `priv/tilegen/tiles.json`, baked
by `bake.mjs` and served from the database.

**Why this file exists.** An object was built from a written description of a reference instead of the reference
itself, and came out nothing like the thing it was named after. A text description is not a reference. Step 1 of
`../OBJECT-CONSTRUCTION.md` is: find real isometric art of the thing you are about to build, record it here, and
get it approved before modelling anything.

**A first set was gathered from OpenGameArt and REJECTED on sight**: *"none of the references are good, I'll
share ones witht he same name"*. The set below is his.

## Sheets, and what each one is for

| Reference | For | What to take from it |
|---|---|---|
| [Isometric bridge collection](https://img.magnific.com/free-vector/bridges-details-isometric-elements-collection-with-modern-metallic-constructions-ancient-wooden-stone-viaducts-spans-isolated-vector-illustration_1284-30093.jpg) | **THE bridge sheet.** 11 bridges, one of every type asked for | Split into `references/split/bridge-01..11`. Stone arch viaduct, brick trestle on cylindrical piers, gatehouse bridge with crenellated towers, suspension bridge, steel truss viaduct, steel arch on concrete cylinders, WOOD arched footbridge, red stone humped bridge, rope-and-plank footbridge, modern highway on piers with lamp posts, stone bridge with turreted towers |
| [River, roads, canal bridges](https://media.istockphoto.com/id/1723579707/vector/isometric-river-roads-canal-bridges-tower-engineering-modern-water-highway-and-landmark.jpg) | Crossings in context, on actual water | `split/canal-01..10`. How a deck MEETS the bank, which is where ours fails |
| [Bridge set icons](https://media.istockphoto.com/id/683004652/vector/bridge-set-icons.jpg) | 17 more crossings, small | `split/iconbridge-01..17` |
| [Cave entrance in forest](https://thumbs.dreamstime.com/b/illustration-shows-cave-entrance-surrounded-lush-vegetation-rocky-terrain-dark-create-mysterious-adventurous-397889678.jpg) | Forest cave entrance | Rock mass, vegetation crowding it |
| [Underground cave entrance, forest](https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQANtDP7302QpHoHBaHaIj9hkqHkWLHZdD7DeDHi21bQS9oADwJ6htVJx9t) | **THE cave entrance reference** | A rocky outcrop with a DARK MOUTH cut into it, greenery growing over the top, boulders scattered at its feet, a stream beside it. The mouth is a hole in a MASS, never a dark patch on the floor |
| [Forest portal](https://thumbs.dreamstime.com/b/isometric-pixel-art-landscape-river-rocks-glowing-portal-tree-digital-green-environment-serene-features-winding-387810876.jpg) | A portal as an exit marker | A standing RING with a glow, on open ground, read from across the map |
| [Dense forest, dark entrance](https://image.cdn2.seaart.me/2025-08-10/d2bsiode878c73apibdg/7506483bec52b2d911e98ec282b38f97_high.webp) | **The best single reference we have for a woodland** | The way out is not one big arch object. It is the PATH, plus the dark canopy closing in either side, plus scatter. Also carries two small plank bridges over a stream, ruined columns, benches, logs, rocks and blooms. Study the whole picture, not just the entrance |
| [Bridge gate town](https://i.redd.it/z5x9szk30xt61.jpg) | A gate that is also a crossing | |
| [Gate and fence types](https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTGR8UyGj-sGu2-Irn9Vc1r0_YBmnwUQx0qKpQWGrgK5T1c9Kz7aspI9eM) | Fence and gate PANELS, 16 of them | `split/gate-01..16`. Not map entrances, despite the name: these are garden and boundary fences. Still worth having, because every one is a post, panel, post family, which is the construction we want |

## Splitting a sheet into its pieces

One image holding twelve bridges becomes twelve references. `.claude-workspace/game-website/references/` holds
the sheets and the pieces; the splitter floods the near-white ground, labels what is left as connected blobs,
drops anything under a pixel-count floor, and writes each blob with a small margin. Bounding-box merging is OFF
on purpose: neighbouring isometric objects have overlapping boxes, so merging chains the whole sheet into one.

## Adding one

Same projection this engine draws, or it teaches the wrong proportions and is worse than nothing. Record the
row before the file is used. Do not commit licensed stock into this repository.

## More to draw on

His list, not yet gathered: entrances to **Pokemon** towns and cities, **Zelda**, **Death's Door**, **Ori**,
**Hollow Knight**.

## Recovered from the whole prompt history, 2026-09-15

*"IF I PASS A FUCKING REFERENCE, IS BECAUSE I WANT TO SAVE IT, STORE IT AND WORK IN THE FUCKING OBJECT OR
DESIGN UNTIL IT MATCHES THE REFERENCE AS CLOSE TO 100% AS POSIBLE, ANYTHING LESS THAN THAT IS UNACEPTABLE"*.

The sheets above were gathered for the bridge and entrance work. They are not everything he has sent: sweeping
every prompt turned up **41 more** that had only ever existed in the chat, against 10 already held. They are
in `.claude-workspace/game-website/references/by-subject/`, filed by what they are, with the sentence he typed
around each recorded in `_recovered.json`. Same rule as above: the FILES stay out of this repository.

Nine were filtered back OUT. They were screenshots of our own renders, which he sends to report a defect: the
opposite of a reference, the thing to change rather than the thing to match.

| subject | count | what is in it |
|---|---|---|
| `by-subject/bridges/` | 2 | more crossings in context, on actual water |
| `by-subject/buildings/` | 6 | church and cathedral photographs, and an isometric modern block |
| `by-subject/entrances/` | 5 | a cave mouth in lush vegetation, the isometric forest whose canopy closes over the path, and the dense forest entrance he called good |
| `by-subject/objects/` | 3 | objects he pointed at while asking for the compositions list to be kept up to date |
| `by-subject/pathways/` | 9 | the nine he sent for pathway variance (beach city street, clifftop path, rocky track, woodland crossroads, park path, trail beside a river, swamp boardwalk to a cave, swamp trail to a temple, swamp island), plus a park with a plank bridge and a forest path winding between trees |
| `by-subject/trees/` | 5 | the five behind 'we need to have more variance of trees, like we are using the same for all forest variations' |
| `by-subject/units/` | 1 | how a human unit should read |
| `by-subject/unsorted/` | 2 | shared without a sentence naming them; open them before using them |
| `by-subject/water/` | 7 | rivers and banks in context, and the shots behind 'we should use optimized tiles with z-width' and the swamp water complaints |
| `by-subject/whole-map/` | 1 | whole isometric scenes to model the overall read against: an RPG town with market stalls and wooden paths, and a conifer forest |

### Still missing

Vecteezy refuses every automated request, so three he linked are recorded by URL and label only, and need
saving by hand from a browser:

- *"pathway from rocky terrain, rocky rustic pathway"*, `static.vecteezy.com/.../051/331/589/non_2x/isometric-forest-path-illustration...`
- isometric hill with river, `static.vecteezy.com/.../073/164/866/small/isometric-hill-with-r...`
- isometric park or forest, `static.vecteezy.com/.../025/339/328/small/isometric-park-or-for...`

## Method sources, not art

Written and filmed explanations of HOW an effect is built, as opposed to art to model against. These get read
and turned into a framework doc, never applied from memory. See [`../FRAMEWORKS.md`](../FRAMEWORKS.md).

| Source | For | What was taken |
|---|---|---|
| [How I Created 2D Pixel Art Water For My Indie Game](https://www.youtube.com/watch?v=DkfKwfjaVx0), Fishy Games, 8:41 | **THE water layer model** | Five layers plus a shoreline pass: water on its own layer with objects on the bed, depth from a blurred height map read by a colour ramp, caustics tiled ON THE BOTTOM and fading with depth, surface movement (particle sim and vertex displacement both weighed and rejected, texture displacement via a DUDV map chosen, then quantised so it stays pixelated), reflections as a vertical flip put through the same distortion, and a hand animated non-linear shoreline with foam and wet sand. Transcript with timestamps in the workspace at `references/method/water-video-transcript.txt`, facts cited by timestamp in [`../WATER.md`](../WATER.md) |
| [Isometric water tile tutorial](https://westenfry.com/tutorial/), westenfry | **The tile-native form of a moving surface** | A 64x32 isometric water tile animated over 16 frames. Waves are duplicated and staggered in time so the motion reads as non-directional, which is what lets it survive the camera turning to all four facings. The palette is reduced afterwards because the interpolation leaves a blur that reads as mush |

## Vegetation, by biome

His, 2026-09-16, with the instruction that a forest must read as the real place it represents: *"jungle trees are different from beach trees, different color, different form, because they have different environmental conditions, we need to think of all elements as the real life element they represent."* Files in the workspace at `references/by-subject/vegetation/`.

| File | Biome | What to take |
|---|---|---|
| `beach-coastal-plain-brazil.jpg` | Beach | *"beaches usually have brighter greens than the ones we're seeing, even trees with other colors, like yellowish"* |
| `meadow-lady-farm-steppe.jpg` | Meadow | *"more mix of colors, due to flowers, they even have trees that are orange, pink, more varied"* |
| `jungle-rainforest-treetops.jpg` | Jungle | *"more enredaderas, darker trees, denser"* |
| `mountain-california-treeline.jpg` | Mountain | *"multiple zones of dirt and rock, and lots of pines and green areas"*, and the rule that matters most: *"the higher you get to the mountain the less vegetation there is"* |
| `desert-simpson-australia.jpg`, `desert-plants.jpg` | Desert | *"Desert vegetation is diferent too"* |
| `beach-dunes-de-hoop-south-africa.jpg` | Beach | the dune half of the same note, scrub rather than canopy |
| [`by-subject/volcano/volcano-01.jpg`](https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTGlCTqBYm_e9BNNAgX6MHihw3ECZLoRh06Mf3GsLnJu1EtagIaBI6vUpk&s=10) | Volcano | **The closest to our read**, a low-poly ISOMETRIC diorama. A faceted grey-blue cone, a dark crater notch, three or four lava tongues down the flanks, an ash skirt at the base, conifers growing up to the ash line and not onto it |
| [`by-subject/volcano/volcano-02.webp`](https://media.craiyon.com/2025-09-15/YYmQcWVtS2i1zWleNTWRig.webp) | Volcano | Two cones behind a tropical coast. Vegetation THINS WITH HEIGHT: dense palm at the base, bare rock at the top. One bright lava streak per cone |
| [`by-subject/volcano/volcano-03.webp`](https://media.craiyon.com/2025-09-15/ztGHimJSTmiNaWBJ9i861A.webp) | Volcano | A map-style cone. Lava runs BRANCH down the flanks like rivers all the way to the sea; bare dark rock on the upper cone, green scrub lower, palms at the shore |

**The first `beach-coastal-plain-brazil.jpg` was never an image.** It was an HTML error page saved with a
`.jpg` name, so the beach biome had no reference at all while its palette was being judged. He re-sent it
(CNN/Getty) plus the De Hoop dunes, and a ResearchGate link that refuses non-browser requests and was
dropped. Check `file` on a downloaded reference before trusting it.

### MEASURED, 2026-09-16, not eyeballed

Vegetation pixels only (saturation > 0.18, value > 0.12, hue inside the yellow-through-green band), sampled
off each file at 260px. `a-reference-is-a-contract` demands the comparison be measured, so here it is, with
what the engine served at the time beside it.

| Reference | veg share | **hue** | sat | val | four shades, dark to light |
|---|---|---|---|---|---|
| beach-coastal-plain-brazil | 39% | **51d** | 0.53 | 0.54 | `#53510f` `#726c20` `#938342` `#dec7a8` |
| beach-dunes-de-hoop | 42% | **63d** | 0.46 | 0.39 | `#2e3d09` `#595937` `#636d47` `#85894f` |
| desert-plants | 61% | **40d** | 0.53 | 0.63 | `#6b5531` `#948e53` `#b69544` `#e0bb87` |
| desert-simpson-australia | 44% | **30d** | 0.44 | 0.53 | `#584838` `#825d3c` `#9c7b60` `#b58f70` |
| jungle-rainforest-treetops | 54% | **74d** | 0.58 | 0.39 | `#2c3c1b` `#495a1a` `#66721c` `#7e8c2c` |
| meadow-lady-farm-steppe | 85% | **40d** | 0.67 | 0.58 | `#666520` `#8c8029` `#a6a22e` `#c4925d` |
| mountain-california-treeline | 26% | **52d** | 0.39 | 0.27 | `#26271e` `#32352a` `#484435` `#69553e` |

**The deltas that condemned the old palette**, measured against what `/api/generators` served:

| biome | engine served | hue | reference hue | error |
|---|---|---|---|---|
| Jungle | `#2e6b32` | 124d | 74d | **50d too far toward pure green** |
| Mountain | `#5d7340` | 86d | 52d | 34d off, and far too bright and saturated |
| Desert | `#4f9147` | 114d | 30-40d | **a GREEN where the reference is olive and ochre** |
| Beach | `#4f9147` | 114d | 51-63d | same green as Desert, byte-identical, ~55d off |

**The volcano, read as structure (2026-09-17).** All three share one silhouette, and it is the contract for
any volcano built here:

1. a grey cone, bare at the top, the biggest mass and the first thing the eye lands on
2. a dark crater notch at the summit
3. lava tongues running DOWN the flanks, branching
4. a plume above it
5. **vegetation thinning with height**, bare at the summit and green at the foot

Mass 5 is the one that cost nothing to build, because it is not a distance calculation: *"we don't need to
measure, just use regions for that, that's why they exist"*. It is `AVolcanoBurnsInBands`.

Three observations that only show up once it is measured:

1. **Every reference sits between 30d and 74d.** Not one real vegetation photo is a pure green. The engine
   served 86d to 124d everywhere, which is why the maps read as plastic.
2. **Value separates the biomes more than hue does.** Mountain 0.27 and jungle 0.39 against desert 0.63 and
   meadow 0.58. "Darker, denser" is a VALUE statement, and dropping value is what makes a jungle read.
3. **Saturation is the meadow's signature**, 0.67, the highest of the set, which is the measured form of
   *"more mix of colors, due to flowers ... more varied"*.

Use the HUE relationships and the RELATIVE ordering, never the absolute value: a photo's 0.27 carries the
scene's lighting, and transplanting it onto a tile tint would paint a near-black tree. The tile art already
carries the tone (`colour-tints-luminance-stays`), so the tint moves the hue.

## Cactus, 2026-09-17

His, with *"here's the cactus variants I expected"*, after calling the first attempt *"a bit weird"*
(Image #146: tall thin pointed columns that read as green arrowheads).

| File | What to take |
|---|---|
| `by-subject/cactus/cactus-variants-expected.png` | A botanical plate of cactus FORMS. Saved in the workspace, not the repo. |

What the plate actually shows, form by form, because "a cactus" is not one shape:

1. **Saguaro**: a tall heavily ribbed column with ARMS that leave the trunk low and curve UP to run parallel
   to it. The arms are the single most recognisable thing about it and the first attempt had none.
2. **Barrel**: squat, round, much wider than tall, ribs running pole to pole, often flowering on top.
3. **Prickly pear**: flat oval PADS branching off each other, not a column at all.
4. **Cluster**: several short ribbed columns from one base.
5. **Single pad**, a lone oval, for scatter.

### Three measured reasons the first attempt read wrong

1. **No arms.** A 1x1 footprint cannot carry them. The plate's saguaro is unmistakable BECAUSE of them.
2. **Pointed top.** The crown art's dome collapsed to a point once `scaleX` narrowed the cell, so it read as
   an arrowhead. Every cactus on the plate is rounded at the top.
3. **Vertical ribs chevron on an iso cube.** A cube shows two faces at opposing skews, so vertical stripes
   mirror into a herringbone and the shape reads as a leaf. This is a general TILE-DESIGN fact and it is why
   the leaf tiles use a non-directional clump pattern rather than stripes. Ribbing on a cactus has to be
   carried by DOTS (areoles) and subtle shading, not by strong vertical lines.

### MEASURED against the plate, 2026-09-24

`a-reference-is-a-contract` says the comparison is measured, never eyeballed, so here it is. Vegetation
pixels off `cactus-variants-expected.png` at full size, plate item 3 (the saguaro), read row by row against
the cream paper ground.

| What | Reference plate | What that is, in cells |
|---|---|---|
| Trunk thickness | 25px | of a 295px plant, **0.085 of its height** |
| Plant height | 295px | our saguaro is 3.4 cells tall |
| Arm thickness | 11px | **0.44 of the trunk** |
| Arm centre, off the trunk's | 19px | **0.76 trunk widths**, so the arm just touches |
| Full span with arms | 66px | 2.6 trunk widths, 0.22 of the plant's height |

The arm ratios are used directly: an arm is `scaleX` 0.44 and stands 0.72 of a cell off the trunk, which is
where a full-width trunk's face and a 0.44 arm's face meet.

**An arm's HEIGHT is not in this table on purpose.** It cannot be read off this plate: over the band where
the arms rise they overlap the trunk, and the neighbouring plant's ink enters the same columns, so every
figure that comes out is contaminated. The arms keep the heights they were authored with rather than take an
invented number, and how far up they should reach is his to judge on the render.

**The trunk ratio is deliberately NOT used.** 0.085 of 3.4 cells is 0.29, which is what the bars already held
when he said *"looks too skynny"*. A botanical proportion drawn 3 cells tall on a 30-cell map reads as a line,
and his correction names the mechanism rather than the number: width is the axis you look at and stays full,
thickness is the axis into the screen and is what gets pulled in. So the plate sets the arms' proportions and
the trunk is full width, thinned into the screen by a directed reach.

### What the object is built of

| Object | Built against | Recorded |
|---|---|---|
| The saguaro's bars | `by-subject/cactus/cactus-variants-expected.png` plus his sketch, *"a saguaro is a TALL NARROW BAR, a WIDE SHORT BAR crossing it, and two SHORT BARS rising from that bar's ends"* | the table above |
| The pillar composition | No reference art. Built from the rule that a standing structure is a composition of course pieces, the same base/shaft/capital the bridge uprights and the built columns already use | `../OBJECT-CONSTRUCTION.md` |

The pillar is the honest gap: it was modelled on the catalog's own column construction rather than on
isometric art of a pillar, and step 1 of `../OBJECT-CONSTRUCTION.md` asks for the art. It is a composition of
existing approved pieces rather than a new shape, which is why it was built at all, but the reference is
still owed.
