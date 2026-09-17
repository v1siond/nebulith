# REGIONS: what a biome is made of, and how you move through it

## 0. Why this exists

*"none of the regions from volcanic type are different and they don't look like volcanic regions at all.
there's no sense of getting close to the volcano for example, because all of them are the same as the other
forests, even when the context is different"* (2026-09-17).

And the general form of it, in the same message:

> *"most regions should be edited per type per biom, the zones of a meadow aren'tn the sme of a swamp ... so we
> need to have logical sectons per BIOM, not generic ones repeated across all of them. and each region should
> create a distinct template, different layout, different everything to represent the actual region"*

`TERRAIN.md` covers what colour a region's ground is. `GENERATION-SPEC.md` says a region is an element inside
the terrain layer. Neither says what regions a biome HAS or how they sit on the map, so this does.

---

## 1. The law

**A region is a PLACE YOU MOVE THROUGH, not a patch of different colour.**

Two things follow, and the second is the one that was missing entirely.

### 1.1 The set belongs to the BIOME

There is one shared set of five today, `edge / deep / glade / thicket / lakeside`, reused by all nine wild
environments with only the floor tones swapped. Those five are woodland words. A desert has no deep wood, a
volcano has no glade, and a beach's "lakeside" is the sea.

Measured on 2026-09-17: `forest_volcanic` served the MOUNTAIN's five regions byte for byte, same keys, same
names, same conifer and stub tree lists, only the floors darkened.

**Rule:** every biome states its own regions. Sharing a set across biomes is the defect, not the saving.

### 1.2 The set is ORDERED, and the map lays it out in that order

Every example he gave is a gradient or a position, never a scatter:

| biome | his words |
|---|---|
| volcanic | *"there's no sense of getting close to the volcano"* |
| swamp | *"gradually gets more wet and with deeper rivers"* |
| ruins | *"sections where some parts of ruin show and they gradually increase until you reach the actual ruins"* |
| mountain | *"is not same the bottom of the mountain, the middle and the top"* |
| beach | *"is not the same inside the beach jungle or on the end or start of it"* |

`partitionSubZones` is a seeded Voronoi scatter: one seed per kind, the rest drawn by weight, nearest seed
wins. It puts every kind in random blobs all over the map. **No region CONTENT can produce a sense of approach
on top of a scatter**, which is why the volcanic bands built earlier that day read as "the same as the other
forests" even though their species and floors were right.

**Rule:** a region set declares its ARRANGEMENT, and the partition honours it.


### 1.3 A SETTLEMENT is not an exception to any of this

I got this wrong on 2026-09-17 and he corrected it. I had written that a city's `upper` / `middle` / `lower`
were about wealth rather than biome, so sharing them across all eleven city templates was not the defect §1.1
names. His answer:

> *"is not just wealth, cities have many different environments and different architecture, and saiod
> architecture varies per BIOMA, and the same happens with villages and towns. For example, cities might have
> parks, market sections, wealth based neighborhoods, graveyard, etc. towns have sections similar to city but
> less scale and they have different architecture, and vilages are practically indian settlements, even more
> different architecture, simpler settlements... In short, we must thread every single tipe of settlements the
> same way we treat forests, each one with their own flavor, distinct vibe, dictinct ornaments, distinct
> architecture, distinct objects, colors, zones, etc"*

So both laws in §1 apply to settlements without modification, on TWO axes rather than one:

- **the KIND**: a village is not a small town. *"vilages are practically indian settlements, even more
  different architecture, simpler settlements"*, and a town is *"similar to city but less scale"* with an
  architecture of its own.
- **the BIOME**: a jungle city and a mountain city are not one city in two tints, any more than a jungle and a
  mountain are one forest in two tints.

And a settlement's zones are not only classes. He names parks, market sections, wealth neighbourhoods and a
graveyard, so the set is a set of PLACES, of which "where the money lives" is one.

**What is built of this today: almost nothing.** Cities serve three zones, `upper` / `middle` / `lower`, the
same three on all eleven, and villages and towns serve none at all. A settlement now partitions its zones and
a building is built of what its own zone states, which had to be fixed first (see below), but the SETS
themselves are still one shared triple.


### The two bugs that had to be fixed before any of it could show

Both are the served-and-ignored shape this file keeps finding, and neither was visible from the data: the
backend served it, the type declared it, and nothing read it.

1. **No settlement ever partitioned its zones.** `partitionSubZones` had three callers and all three were
   forests, so `ctx.zoneAt` was undefined on every village, town and city. Eleven city templates served three
   fully specified neighbourhoods each, and not one cell of a map ever belonged to one.
2. **A zone's `buildings` was dropped at parse.** `parseBuildings` requires `storeRoof`, `hospitalRoof` and
   `fixedWall` as well as the three lists, and those are MAP-level identity: the colours that keep a store
   looking like a store anywhere in town. A neighbourhood has no business restating them and none of them
   does, so `parseBuildings` returned undefined for every zone on every city. A zone states only what makes it
   DIFFERENT, so it parses as an overlay now and is merged over the map's palette rather than replacing it.

Measured on a medieval city after both: `upper` went from 155 stone against 175 brick to **190 stone against
39 brick**, which is its served stone-only list, and `lower` carries 41 `wall_wood` where it had none.
`wall_wood` is served by no map-level palette and by `lower` only, so where it lands is proof on its own.


---

## 2. The three arrangements

| arrangement | what it means | for |
|---|---|---|
| `scatter` | nearest-seed Voronoi, today's behaviour | a wood, where a glade really is anywhere |
| `rings` | region 0 at the centre, the last at the rim | a volcano, a ruin, anything you APPROACH |
| `bands` | parallel strips across the map, region 0 on one edge | a mountain foot to summit, a beach sea to inland |

`rings` and `bands` read the region ORDER in the served list. The list stops being a bag and becomes a
sequence, so the order is data and changing it changes the map.

Both keep `weight`, which becomes the THICKNESS of the ring or band rather than a seed count, so a big
`sheltered` and a small `crater` still mean what they meant.

Both keep the border wobble the scatter has, or the rings read as drawn with a compass.

---

## 3. What a region may state

Already served and read: `weight`, `canopy`, `undergrowth`, `floor`, `leafHue`, `leafValue`, `pools`, `stone`,
`level`, `formation` (lattice, spacing, understory, understoryTile), `trees`, `flowers`, `buildings`.

That is most of *"different layout, different everything"* already. What is NOT served, and what his examples
need:

- **A region's own WATER character.** *"in a swamp we might need to move through dirt paths and bridges
  constantly or jump on platforms"* against *"on a meadow that doesn't happen we can walk more"*. `pools` is a
  share of standing water; there is nothing for "how the ways cross it".
- **A region's own STRUCTURES.** *"we might find temples"*, *"in many cases we might have a dungeon"*, and the
  ruins gradient reaching an actual ruin. `stone` scatters fallen masonry; there is nothing that says a region
  CONTAINS a built thing.

Both are listed in section 5 as not built. Nothing here should pretend otherwise.

---

## 4. The sets, from his words

Each row is his description first, then what the region states. `->` is the order, centre or first edge first.

### Volcanic, `rings`, you approach the cone

*"there's no sense of getting close to the volcano"*

`crater` -> `burnt` -> `ashfall` -> `sheltered` -> `lavaside`

Bare ash and snags at the middle, dead trunks, then survivors among the dead, then living forest at the foot.
Built 2026-09-17 as `AVolcanoBurnsInBands`; the CONTENT is right and the arrangement was still a scatter.

### Ruins, `rings`, Machu Picchu

*"a forest with ruins is like machu pichu, like you should have sections where some parts of ruin show and
they gradually increase until you reach the actual ruins in many cases we might have a dungeon"*

`heart` -> `courts` -> `terraces` -> `overgrown` -> `forest`

`stone` climbs toward the middle and the canopy opens, so the wood thins as the masonry takes over. The
`heart` wants a real built thing, which is section 5's gap.

### Mountain, `bands`, foot to summit

*"is not same the bottom of the mountain, the middle and the top"*

`foot` -> `slope` -> `treeline` -> `crag` -> `summit`

`level` climbs with the band, so the steps between them are cliffs. The canopy thins upward to nothing, which
is the rule already recorded in `SOURCES.md`: *"the higher you get to the mountain the less vegetation there
is"*.

### Beach, `bands`, sea to inland

*"is not the same inside the beach jungle or on the end or start of it, in middle jungle we'll see things like
rivers that reach the beach, on the outside we'll see the actual beach"*

`shore` -> `dunes` -> `palms` -> `backshore` -> `inland`

Open sand and marram at the sea edge, palms behind it, and closed jungle inland with the rivers that run down
to the beach.

### Swamp, `bands`, drying to drowned

*"a swamp gradually gets more wet and with deeper rivers, we might find temples or something"*

`margin` -> `mire` -> `bog` -> `sink` -> `open_water`

`pools` climbs across the set. The deep end is the one that needs the crossings, which is section 5's other
gap.

### Meadow, `scatter`, and that is correct

*"a meadow is not that wet, and rivers aren't gonna be as prominent as in a swamp, on a meadow that doesn't
happen we can walk more"*

`pasture` / `hedgerow` / `orchard` / `bank` / `common`

A meadow genuinely has no gradient: the hedge is where the hedge is. This is the one biome the scatter suits,
and it keeps it.

### Woodland and jungle, `scatter`

`edge / deep / glade / thicket / lakeside` are woodland words and belong to a wood. A glade really is anywhere.

### Desert, `bands`

*"a desert is completely different from a forest"*

`erg` -> `hardpan` -> `wadi` -> `oasis`

Dune sea to the water, since the only gradient a desert has is how far you are from a drink.

---

## 5. What is NOT built

- **The border treeline floods whichever regions sit at the map edge, and on `bands` that is always the first
  and last.** `sealMapEdge` plants a tree on EVERY cell of the two-deep border ring, using that cell's own
  region species, because the border has to be shut everywhere except a gate. On a scatter that is harmless,
  since the ring crosses every region. On `bands` the ring's north and south sides lie entirely inside the
  two END regions, which are exactly the ones a gradient makes sparsest.

  Measured on an 80x80 mountain, region by region, with `.probe/regionsheet.mjs`:

  | region | share of map | trees per 100 cells |
  |---|---|---|
  | foot | 31% | 14.5 |
  | slope | 23% | 8.9 |
  | treeline | 23% | 7.2 |
  | crag | 15% | 8.0 |
  | **summit** | **8%** | **72.0** |

  The summit is served `canopy: 0.02` and that IS honoured: of its 179 trees only about 10 come from the
  canopy field and the rest are the sealed border. So the densest place on a mountain is its summit, against
  his own rule for that biome, *"the higher you get to the mountain the less vegetation there is"*. The beach
  `shore` has the same shape: 219 trees, every one a `bush_round`, on a region served `canopy: 0.05`.

  **This needs a decision rather than a patch.** The seal exists to block the border, in his words *"a edge in
  a town help us to put a bunch of trees around it"*, and a summit still needs a shut border. What it does not
  need is a wood: a bare summit's border is ROCK. Serving what a region seals its edge WITH is the obvious
  answer and is not built, and guessing it here would be inventing a system. Recorded, not fixed.

- A region cannot state its own crossings, so *"dirt paths and bridges constantly or jump on platforms"* has
  nowhere to live.
- A region cannot state a STRUCTURE, so the ruins `heart`, the swamp's temple and the dungeon are scatter and
  colour rather than a place with something in it.
- Per-region ELEVATION exists (`level`) but the terrain math that will decide real relief is ticket 2. His
  note, 2026-09-17: *"our elevation will change everything on terrain, because we'll apply math that will
  randonmize the terrain forms, and based of that, we want to use the same formulla to determine the volcano
  and other mountains height ... we'll just run the terrain math as the first layer that runs after
  grid-generatoon, before rivers, and pathways and everything else"*. So mountain `bands` and their `level`
  steps are a placeholder for that formula, not a rival to it.
- The burned/unburned pair is deliberately NOT an option: *"we don't need dormant/erupted, we already have
  rules and triggers ... we'll just have two templates exactly equal, but one has the trees with color and the
  other will be affected by the eruption"*, swapped by a rule at game level as a cutscene. What this framework
  owes that future is only the VARIATIONS, *"having the regions and the option to specify burned/not burned or
  something"*, which the volcanic set provides.

---

## 6. Checklist

Before calling region work done:

- [ ] The set belongs to this biome, and no key in it is a word from another biome
- [ ] The set is in ORDER, and the order is the one you would walk
- [ ] The arrangement is stated and is the one his description implies
- [ ] Each region differs from its neighbours in more than colour: species, density, formation or floor
- [ ] Measured on a real build, region by region, not eyeballed on one screenshot
- [ ] Every biome checked, not the one that was complained about
- [ ] Judged at :3000
