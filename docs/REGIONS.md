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


## 0b. HOW REGION WORK IS TESTED, and it is not optional

*"you're testing wrong, you are testing in complete random mode, that's why it fails ... you must setup the
map to not add extra stuff when you test the regions, no river, no bridge, set a specific number of pathways,
specific exits and validate the exits, the pathways and the overall design actually works and looks like the
region it says it should look like"* (2026-09-17).

A region measured on a map that ALSO rolled a river, a bridge and a random number of exits tells you nothing
about the region: the randomness moves more than the region does, and it reads as the region working. That is
exactly how a full day of region work came to be reported as done while every region still looked identical.

**`.probe/region.mjs` is the gate.** It pins every other choice and varies only the region:

```bash
PRESET=Beach RIVER=shore REGIONS=shore SHOT=1 node .probe/region.mjs
PRESET=Woodland REGIONS=edge,deep,glade,thicket,lakeside node .probe/region.mjs
```

It reports, per region, the cells, the water, the way cells and the ground, and `SHOT=1` renders it.

**A percentage is not evidence.** Reporting that picking `summit` took the summit from 8 per cent of the map
to 29 proves only that the weighting moved. It says nothing about whether the place IS what it is called, and
that is the only question. The evidence is what the region CONTAINS, and then the picture.

The first run of this harness, on a beach with everything pinned off, said it plainly: five regions, all
`meadow`, zero water, zero way cells, differing only in how many cells each claimed.

### 0b.1 Measure the BODY, not the share

A share per region cannot tell a region that owns its lake from one that merely has a neighbour's lake
spilling over the line. A BODY can: the harness reports every connected body of water and which regions its
cells fall in, and **one region per body is the pass mark**. A body listed as `50@bank` is that region's own
water; a body listed as `50@bank+glade` is a defect, and the harness says so on its own line.

### 0b.2 The instrument lies before the code does

Three separate readings in one session were the HARNESS being wrong, not the generator, and each one looked
exactly like a real defect:

1. **It could not see a pool.** It counted `groundSlugs()` only, and a region's standing water is a
   `water_still` prop stacked OVER the floor, so a `lakeside` carrying 113 cells of standing water reported
   zero. It now counts both, and reports them apart as `channel` and `standing`.
2. **It measured across a build.** A fixed `waitForTimeout` after clicking Build sometimes read the grid from
   one map and the region map from the next, which put a lake's cells under a neighbouring region's name. It
   now waits for the working overlay (`[role="status"]`) to appear and then detach, both for the page's own
   first build and for each build it asks for. Waiting only for `detached` is not enough: an element that does
   not exist yet is already detached.
3. **It read tree height as relief.** `top` took the max `heightLevel` over the cell's whole stack, so a flat
   wood reported relief 3.3. It reads the floor's own level now, through `grid.getHeight`, which is where
   `applyStageToGrid` puts a region's `level`.
4. **It read the new build's regions against the previous build's ground.** The page stores its region map
   BEFORE it applies the stage to the grid, so a wait that only asks "has the map stopped changing" returns
   instantly while the new build has not begun applying. Measured on a mountain: the regions were the ordered
   bands the template serves and the ground was the scatter of a preview built earlier, which reads exactly
   like a generator painting a region's floor and relief in the wrong place. Cross-checking tone against
   relief is what caught it, because the two disagreed with the region map in the SAME 1240 cells and agreed
   with each other, which no generator bug produces. The wait now captures `grid.groundVersion` before the
   click, waits for it to CHANGE, and only then waits for it to settle.

With all four fixed, the same mountain reports what it should: five bands, each in its own floor tone, relief
climbing 0 to 4 from foot to summit, and bare stone only on the crag and the summit.

Before believing a measurement that says a region leaks, cross-check it against something the map paints for
its own reasons. Each region's `floor` tone is the honest independent witness: reading the painted floor
colour back and comparing it to the published region map agreed on 1080 of 1080 cells, which is what proved
the generator was never at fault.


---

### 0b.3 One test per region, and it is the gate

*"AND WE SHOULD HAVE SPECIFIC TEST FOR EACH SINGLE ONE, JUNGLE x, JUNGLE y, ETC ... THE SAME WITH ALL
VARIATIONS ALL TEMPLATE GENERATORS, INCLUDING VILLAGES, TOWNS, CITIES AND OF COURSE ALL WIDLERNESS"*

`src/__tests__/engine/everyRegionIsItsOwnPlace.test.ts`. One named test per region of every generator that
serves them, 191 of them today. Each builds a map with everything but the region pinned (§0b) and asks the
only question that matters: **is this place tellable apart from every other place in its own set?**

A region passes against a sibling when the two differ on at least one axis a person can see:

| axis | threshold | what it catches |
|---|---|---|
| ground | the dominant PLANT differs | two regions running the same plant at two densities, which is one place twice |
| canopy | 0.05 trees per cell | a wood against a clearing |
| walkable | 0.12 | a thicket against open ground |
| water | 0.06 | a lakeside against a dry wood |
| stone | 0.06 | a ruin's heart against its forest |
| built | 0.05 | a park against a terrace |
| architecture | the roof and wall differ | a city's wealth tiers |
| relief | any step | a climb |

Scattered ornaments (`rock`, `dirt`) are NOT vegetation, however many of them there are: a meadow's field
stones outvoted the grass in the tally and made two different regions both read as `rock`.

It went 43 → 191 as the five dead fields in §3.6 were woken up, and every one of those was found by this test
rather than by looking at a map.

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
`level`, `built`, `formation` (lattice, spacing, understory, understoryTile), `trees`, `flowers`, `buildings`.

### 3.1 Every layout reads every field, and it did not used to

This was the largest single reason a region did not look like itself, and it was invisible because nothing
failed. The fields that shape the GROUND were read by whichever builder happened to be running:

| field | woodland | jungle | meadow | settlement |
|---|---|---|---|---|
| `floor` | yes | yes | no | no |
| `level` | yes | yes | no | no |
| `pools` | **no** | yes | **no** | no |
| `stone` | **no** | yes | **no** | no |

So the woodland's `lakeside` asked for 22% standing water and the meadow's `bank` for 12%, and neither builder
had a pool pass. The one region on the map named after a lake was the one place guaranteed to have no water in
it. The data had been right the whole time.

A layout decides how a map is COMPOSED (a woodland carves clearings out of trees, a jungle carves light gaps,
a meadow plants trees into open field). It does not get to decide which of a region's stated properties exist.
Three shared calls, one per phase, and a new region field works everywhere at once:

- `shapeRegions(ctx)` in **terrain**: partition, then `floor` and `level`
- `floodRegionPools(ctx, pal)` in **water**: `pools`, after the channel so a pool never lands on one
- `strewRegionRuins(ctx)` in **objects**: `stone`, after the planting so a trunk is never inside a wall

### 3.2 A pool, a lake and a sea are one field at three sizes

`WATER.md` §1 says a river, a lake and a beach are the same thing and differ only in the shape painted. The
pool pass only ever laid the PUDDLE: a translucent film over the floor, which is correct for a swamp hollow
and wrong for everything else.

The body decides, and the thresholds are the whole of it:

| body size | what it becomes |
|---|---|
| under 6 cells | nothing. Wet dirt does not read as water |
| 6 to 23 cells | a FILM over the floor. Flush, walkable, the swamp hollow, unchanged |
| 24 cells or more | real water ground. `borderTheWater` finds it and edges it, `classifyBody` reads it as a LAKE, or as a SEA where it runs along a map edge |

A region lake is added to `ctx.pools`, which is what `settleWaterDepth` means by standing water: *"Only the
CHANNEL gets one: a pool is standing water and standing water has no current."* Left out of that set, the
depth pass walks a flow field across the lake, hands every cell a heading, and `classifyBody` reads a current,
so the lake wears the river's white-water rim instead of a lake's dark one. Measured: exactly that, until the
lake was declared standing.

### 3.3 What a served share actually means

`pools` is scored as `shadeNoise(patch) > share * 2`, and `shadeNoise` is uniform 0..1. So the share is not a
percentage of cells, it is HALF of one:

| served `pools` | roughly how much of the region is wet |
|---|---|
| 0.08 | 16%, tide pools and puddles |
| 0.25 | 50% |
| 0.32 | 64%, enough to make one body rather than a pepper of films |
| 0.5 and up | all of it |

A share under about 0.3 tends to break into films instead of making a lake, which is why `oasis` at 0.18 was
an oasis with no water you could see from across the map.

### 3.4 `built`, and why a city had no parks

`built` is the share of a settlement region's PLOTS that carry a building. `buildingsPass` walked the
planner's plots and built every one, so `upper` / `middle` / `lower` could differ in wall material and in
nothing else: three names for one thing. A park, a market square, a green and a graveyard are ALL defined by
open ground inside a built-up place, and no region could say so, so none of them could exist.

A region that states no `built` is fully built, which is what every settlement did before, so nothing that
existed moves until the backend serves a number.

That is most of *"different layout, different everything"* already. What is NOT served, and what his examples
need:

- **A region's own WATER character.** *"in a swamp we might need to move through dirt paths and bridges
  constantly or jump on platforms"* against *"on a meadow that doesn't happen we can walk more"*. `pools` is a
  share of standing water; there is nothing for "how the ways cross it".
- **A region's own STRUCTURES.** *"we might find temples"*, *"in many cases we might have a dungeon"*, and the
  ruins gradient reaching an actual ruin. `stone` scatters fallen masonry; there is nothing that says a region
  CONTAINS a built thing.

Both are listed in section 5 as not built. Nothing here should pretend otherwise.

### 3.5 A region is told apart by what grows at knee height, not by a density

*"LIKE WHAT'S THE DIFFERENCE BETWEEN A THIKET JUNGLE AND A DENSE JUNGLE?? I'LL ANSWER, NOTHING, THERE'S NOT A
SINGLE THING THAT'S REALLY DIFFERENT."* (2026-09-18)

The jungle answered it in one line: all five of its regions served `formation.understoryTile: null`, so the
ground layer was the SAME PLANT in all five and the only thing separating them was how much of it there was.
**Two regions that differ by a density are two settings of one place.**

So each region states its own plant, its own amount of it, its own trunk spacing and a species mix that agrees
with all three. The pair he asked about:

| | canopy | understory | plant | spacing | species |
|---|---|---|---|---|---|
| `deep` | 1.3 | 0.2 | `clover` | 0 | `tree_giant` 45 |
| `thicket` | 0.15 | 2.0 | `thicket` | 2 | bush only |

A deep jungle is giant trunks over an OPEN dark floor, which is what a rainforest floor actually is. A thicket
has no big trees at all and a wall of bush at knee height. They were 1.15/1.2 against 0.5/1.45 before.

**The blocking `thicket` plant belongs to the JUNGLE and to nothing else.** `forest_woodland`, `forest_meadow`
and `forest_mountain` are each asserted to grow zero of it, because a wood full of invisible walls was the
original complaint. Everywhere else the densest region is `shrub` at a high understory: thick to look at, and
still walkable.

### 3.6 Every builder reads every field, and five of them did not

The same defect as §3.1, one layer down. Found by the per-region test in §0b.3, each one a field the backend
already served that nothing read:

| builder | what it ignored |
|---|---|
| `parseNature` | **`nature.tallGrass`**, served by every meadow and dropped by the parser's whitelist. `scatterTallGrass` returns on its first line without it, so no meadow has ever grown a blade of the tall grass it asks for |
| settlement nature | planted trees, ground cover and blooms by distance to the map edge alone, so a city's park and its market grew the same things |
| settlement objects | never read a region's `stone`, so a graveyard measured as a second park |
| meadow objects | never planted a region's understory at all, and its trees and ornaments ignored regions too |
| `placeBuilding` | recorded nothing about the neighbourhood a building stands in, so the architecture a city serves per tier could not be told apart downstream |

A parser that lists its fields by hand is the recurring shape here: `parseSubZones`, `parseBuildings` and now
`parseNature` have each silently dropped a served field. Copy what arrives; name only what needs a
served-zero distinguished from not-served.

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


### The settlements, from his words, and what each one needs

*"we must thread every single tipe of settlements the same way we treat forests, each one with their own
flavor, distinct vibe, dictinct ornaments, distinct architecture, distinct objects, colors, zones, etc"*.

Two axes, so this is 3 kinds x 9 biomes and not 9 sets. The KIND decides the zones and the architecture; the
BIOME decides the vegetation, the colours and the materials, which is the axis the settlement pass already
carries.

**City**, `scatter`. His list: *"cities might have parks, market sections, wealth based neighborhoods,
graveyard, etc"*.

| zone | what it is | what it needs |
|---|---|---|
| `upper` / `middle` / `lower` | the wealth neighbourhoods, which exist and now work | nothing, built |
| `park` | trees, no houses, a fountain and lamps down a path | **nothing new**: trees, `fountain`, `lamp_post` all exist |
| `market` | stalls, crates, awnings, no houses | **a STALL composition**, which does not exist |
| `graveyard` | rows of graves on bare ground, walled | ground can be `grave_dirt`, which exists; **a GRAVE prop does not** |

**Town**, `scatter`. *"towns have sections similar to city but less scale and they have different
architecture"*. So the same shape of set, fewer zones and its own materials, not a city scaled down.

**Village**, `scatter`. *"vilages are practically indian settlements, even more different architecture, simpler
settlements"*. This is the one that needs the most and has the least: a village today serves the same
`store / hospital / barn / stable / house` mix a town does, in different wall materials.

### The gate, stated plainly

`mud_hut` and `tent` are in the catalog and look like the answer. They are not, yet:

- `mud_hut` is `category: terrain, height: 0.0`, a FLOOR tile. It is also a whole building drawn into one
  tile, and `OBJECT-CONSTRUCTION.md` §1 condemns exactly that shortcut: *"take a WHOLE-OBJECT tile and flatten
  it into a billboard"* is the method every rejected object was built with. A hut is an OBJECT and wants
  construction pieces.
- `grave_dirt` is a floor and is genuinely usable as a graveyard's ground with no new art at all.
- `tent` is a height-1 prop and is usable as a prop.

So the split is:

**Buildable with no new art**: the `park` zone, the `graveyard` GROUND, and the wealth neighbourhoods, which
are already working.

**Blocked on `OBJECT-CONSTRUCTION.md` §4 step 1 and 1b**, which is a full stop and needs references in front
of him and his approval in words: the market STALL, the GRAVE prop, and the village's hut and tent
architecture as real compositions. Those are three object families, and the framework's own record is that
four objects were built without that gate and all four were rejected on sight.


### Woodland and jungle, `scatter`

`edge / deep / glade / thicket / lakeside` are woodland words and belong to a wood. A glade really is anywhere.

### Desert, `bands`

*"a desert is completely different from a forest"*

`erg` -> `hardpan` -> `wadi` -> `oasis`

Dune sea to the water, since the only gradient a desert has is how far you are from a drink.

---

---

## 4b. What each region measures today, with everything else pinned

Taken with `.probe/region.mjs` (river none, bridge none, exits 2, pathways 2), varying only the region. Every
row is from a read that passed the harness's own torn-read check.

| biome | measured |
|---|---|
| **mountain** | relief climbs `foot` 0, `slope` 1, `treeline` 2, `crag` 3, `summit` 4. Each band in its own floor tone. Bare stone only on crag (29 cells) and summit (217) |
| **volcanic** | the cone: `sheltered` 0, `ashfall` 1, `burnt` 2, `crater` 3. Floors darken `#594d46` to `#26201e` with the ash. Molten pools in 4 bodies, every one inside `lavaside` |
| **ruins** | masonry grades `forest` 0, `overgrown` 8%, `terraces` 25%, `courts` 44%, `heart` 65%. `heart` and `courts` stand a level above the rest |
| **beach** | sand pales toward the water, `#93a06a` inland to `#e8dcc0` at the shore. `dunes` ridge and `inland` raised a level. Tide pools in 3 bodies, all inside `shore` |
| **desert** | `oasis` holds ONE body of 451 cells, 79% of the region. `erg` dunes stand a level up. Four bands, four tones |
| **swamp** | wetness grades `margin` 0, `mire` 24%, `bog` 57%, `sink` 89%, `open_water` 90%, over five floor tones. The open water is ONE sheet across the wettest bands, which is what a swamp is |
| **woodland** | `lakeside` carries a 290-cell lake wearing lake shore pieces, and every other region is dry |
| **meadow** | `bank` carries its water in 2 bodies (24 and 75 cells), and every other region is dry |
| **city** | six neighbourhoods in six tones, `upper` a level above the rest, and `park` measured at ZERO buildings against `lower`'s 34 |

### What is NOT covered by these numbers

- The **user's own verdict at :3000**, which is the only "done" for anything visual. Everything above is a
  measurement, not an approval.
- **Jungle** was not measured separately. It shares the woodland's mechanism and its `lakeside` already worked
  before this pass, so it is inferred rather than shown.
- **Town and village** regions are served and parse, and were not measured.
- **Architecture per settlement kind.** *"vilages are practically indian settlements, even more different
  architecture"*. A village still builds the same houses a city does, only fewer of them and in different
  colours. Hut and tent compositions, market stalls and grave markers are new objects and sit behind the
  `OBJECT-CONSTRUCTION.md` §4 approval gate.

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
