# TREES: species, form, and what a forest is made of

How a tree is named, what decides which ones grow where, and how a wood gets its own flavour. Read [`TILE-DESIGN.md`](TILE-DESIGN.md) for the art rules and [`OBJECT-CONSTRUCTION.md`](OBJECT-CONSTRUCTION.md) for how a tree is assembled from tiles.

---

## 0. Where it came from

His words, 2026-09-16, correcting a first attempt that varied only the colour:

> *"when I said tree colors variation, what I really meant is that 1: all trees should have variations and 2, all generators should paint their trees logically based of their BIO, their environment, the subregion and the season."*

> *"summer is not the same as spring, which is not the same as autum. jungle trees are different from beach trees, different color, different form, because they have different environmental conditions, we need to think of all elements as the real life element they represent."*

> *"I'd also like to add more trees shape variations, for example, I like to see pines, palm tree, cypress, oak, weeping willow, cherry tree, encina... basically categorize the trees better and not 'big tree, small tree' which is really not that descriptive, instead it'd just prefer to have a descriptive type of tree, the size will always be determined by the tile setting, for example, the size and length of the trunk is just height, width, z-width and thickness.. maybe we add pre-defined presets for sizes, like 'big trunk, small trunk, no trunk' things like that, and allow users to edit or do whatever they want after."*

> *"i just want to make sure all forest have their own distinct flavor and that the list of elements and features users will use are clear."*

---

## 1. The law

**A tree is named for the SPECIES it is. Its size is a setting, not a name.**

`tree_big` and `tree_small` are the same tree twice, with a number baked into the name. An oak is an oak whether it is a sapling or three hundred years old, and how big it is belongs in the fields that already say so: height, width, z-width and thickness.

Two consequences:

- **A species name earns its place by being a different PLANT**: a different crown shape, a different trunk, a different leaf. `tree_cypress` and `tree_palm` are species. `tree_big` and `tree_tall` are adjectives.
- **Size is a preset over the same settings anyone can edit.** "Big trunk", "small trunk", "no trunk" name combinations of height and thickness; picking one fills the fields in, and the fields stay editable afterwards.

---

## 2. What exists today, measured

19 kinds are served, and they are two different vocabularies mixed together:

| Real species | Adjectives wearing a species slot |
|---|---|
| `tree_conifer`, `tree_cypress`, `tree_palm`, `tree_broadleaf`, `tree_coconut`, `tree_banana`, `tree_mangrove`, `tree_gnarled`, `tree_sapling` | `tree`, `tree_tall`, `tree_stub`, `tree_round`, `tree_small`, `tree_big`, `tree_column`, `tree_giant` |
| `bush`, `bush_round` | |

And the mixes, per wilderness environment:

    Woodland  column, tree, tall, round, conifer, stub, bush, sapling   (8)
    Jungle    round, big, bush_round, giant, palm, bush                 (6)
    Meadow    gnarled, broadleaf, round, big, bush_round                (5)
    Swamp     cypress, mangrove, bush_round, round                      (4)
    Mountain  conifer, tall, stub                                       (3)
    Beach     coconut, palm, banana, mangrove, bush_round               (5)
    Ruins     round, bush, stub, sapling                                (4)
    Desert    palm, coconut, stub, bush_round                           (4)
    Volcanic  conifer, tall, stub                                       (3)

**And none of it reaches the screen.** Measured on the compositions and then on three running maps:

> Every tree kind is the SAME TWO CELLS: a trunk and one `leaf_center`. They differ only in total height, 2 to 5 blocks. A woodland, a beach and a swamp all draw `trunk_mid` and `leaf_center` with identical art.

So `tree_palm` and `tree_conifer` are byte-identical apart from one being a block taller. A beach grows no palm, no coconut and no banana; it grows the same tree a woodland does, three blocks tall. The nine per-environment mixes are real served data that produces one plant.

That makes the naming problem secondary. The first version of this doc said "the environment axis is genuinely there", which was read off the served mixes without checking what they draw. It is not there. **A species has to BE a different plant before naming it one means anything.**

**What is missing, all of it measured:**

1. **Season does nothing.** The season changes the tile ART a species draws with, but not which species grow or what form they take. A spring wood and an autumn wood are the same trees in different colours.
2. **Sub-region ALREADY WORKS, and is invisible for the same reason.** Correcting an earlier claim in this doc: a woodland's five regions each serve their own mix (`edge` gnarled/round/bush, `deep` column/tall/tree/sapling, `thicket` bushes and saplings, `lakeside` broadleaf/round) and the engine reads it per cell: `ctx.zoneAt?.[row]?.[col]?.trees ?? ctx.treeMix`. The data and the code are both there. It shows nothing because the kinds it picks between all draw the same tree.

   That is the strongest argument for the build order below: giving the species distinct crowns makes the environment AND sub-region flavour appear at once, with no generator change at all.
3. **A settlement has no trees of its own.** Village, town and city all serve `trees: null`, so every town in the game falls back to one global default mix regardless of where it stands. A woodland town and a beach town grow the same trees.
4. **Mountain and Volcanic are identical**, the same three kinds in the same weights. Two environments with no flavour between them.
5. **Half the names are adjectives**, which is what makes the list unclear to anyone choosing from it.
6. **No size presets.** Height and thickness are per-tile settings with no named combinations.
7. **Species he asked for and the catalog does not have:** oak, weeping willow, cherry, encina, pine as its own thing rather than `conifer`.

### The crown attempt, built and REVERTED 2026-09-16

**Read this before proposing species art.** A per-species CROWN was built exactly as the build order below
used to describe it, rejected over three rounds, and reverted in full by the data migration
`TreesGoBackToWhatWorked`. Nothing of it survives in the catalog. What survives is why.

**What was built:** a `crown_<species>` tile per species, eleven of them plus four burned, drawn first as a
transparent `display: single` billboard so the silhouette would read, then redrawn as a full-bleed texture on
a crown cube when the billboard lost the leaf art. The tree compositions were repointed from `leaf_center`
onto their own crown.

**Why it failed, in his words, in the order he said them:**

1. *"the leafs aren't sized correctly in relation to the trunk, the leafts aren't not even connected to it."*
   A billboard is centred in its block; a cube fills it. So the crown floated above the trunk instead of
   sitting on it, and `SINGLE_TILE_FRAC` pinned it at 0.6 of a cell while the trunk filled 0.8 to 1.0, which
   made the trunk WIDER than the canopy.
2. *"the colors are super weird too."*
3. *"trees sizes are still not good. here how it was before, good decent sizing, needed more variants, but
   the proportions were better"* (Image #137 before, #138 after).
4. *"we lost vibe, vibrance, color, contrast ... none of the trees is different color or different tone."*
   `leaf_center` carries four shades PER SEASON and a tree's `variant` picks one, which is where the pink
   trees in a spring wood come from. The crowns carried one flat green, so a whole forest was one colour.
5. *"there's still a bunch of detached trees, you didn't fix all types, and I don't think you validated them
   visually like the framework say."* The family rule, broken: a fix judged on one tree.
6. *"WE REPLACED THE OLD SYSTEM WITHOUT TAKING WHAT WAS GOOD FROM IT."*
7. And the correction that defines the restart: *"i didn't requested to recover the exact old system, I
   requested to recover their proportions and colors, and I didn't mean to use the same colors everywhere
   either, i want colors that follow every single distinct type of forest and region, exactly how the
   references from real life I shared a few prompts ago ... all i wanted was to add more variants of types
   of trees and different coloring and we ended up changing the whole fucking system entirely for somethign
   that doesn't work. the old system had better coloring of tiles to contrast with the color of the leaf
   cell. Plus I don't think we're doing this correctly anyway, we're not following tileset building
   foundamentals."*

**So these are constraints on any future species work, not preferences:**

- **The leaf CONNECTS to the trunk.** Whatever a species is made of, it occupies its block and rests on the
  trunk. Anything centred in a volume floats. This is the first thing he checks.
- **Proportion comes from the OLD numbers.** `trunk_h`, `trunk_zoom`, `trunk_w`, `leaf_h`, `leaf_zoom` per
  species in `compositions/0` are the sizing he called good. Start from them, do not re-derive them.
- **Per-season shade variance is not optional.** Four shades a season, picked by `variant`, is what makes a
  stand read as a stand. Any new art has to keep that mechanism, not replace it with one colour.
- **The tile colour CONTRASTS with the leaf cell.** His words. The trunk and the ground read against the
  canopy, and flattening everything to one green loses it.
- **Colour follows the FOREST and the REGION**, against the six real-life references in
  `references/SOURCES.md` (beach brighter greens and yellowish, meadow orange and pink mixed in, jungle
  darker and denser, mountain pines thinning with altitude, desert its own thing entirely). One palette
  everywhere is the failure, and so is one palette per map.
- **Follow tileset-building fundamentals**, which means `TILE-DESIGN.md` gets read and its checklist walked
  BEFORE art is drawn, not after it is rejected.
- **Validate the whole FAMILY**, every species in one sheet, before saying anything is fixed.

**What the ask actually was, and still is:** more tree VARIANTS, and per-forest and per-region COLOURING.
Not a new rendering model.

### The burned four, built and reverted with the crowns

*"for volcanic add variations of burned trees, we'll assume the vulcan erupted, we can use woodland and
mountain trees, since a vulcan is just a mountain that erupts lava"*.

A burned tree is not a species, it is a woodland or mountain species after the fire. Four of them were built
as burned crowns, so they went when the crowns went, and Volcanic is back on the mountain's list. **This one
is still wanted** and gets rebuilt on whatever the species model turns out to be. The lava liquid and the
volcanic ash palette are NOT part of this and were kept.

---

## 2b. THE COLOUR AXES, BUILT 2026-09-16

*"add more tree variants with colors per biome, per region, per season"*. The colour half is built and
measured; the variant half is not.

### What was wrong, measured

Nine wild generators shared FOUR canopy colour pairs and every settlement served none. Against his
references (`references/SOURCES.md`): jungle 50 degrees too green, mountain 34 off, desert served a GREEN
where every reference is olive. **Not one real vegetation photo sits above 74 degrees; the engine served 86
to 124 everywhere.**

### The shape

| axis | owns | served as |
|---|---|---|
| SEASON | the TONE and the per-tree VARIANCE | `leaf_center.settings.colors[zone]`, four shades, picked by `variant` |
| BIOME | the HUE and SATURATION, and how seasonal it is | `palette.leaf`, `palette.leafSeasonality`, `palette.leafValue` |
| REGION | a small shift by how much light reaches | the sub-zone's `leafHue` / `leafValue` |

`engine/foliageColor.ts` holds the arithmetic, `stageGenerator.leafToneAt` gathers the inputs at the one
place trees are committed, and the stamp applies it as instance state so the composition template still
invents no colour (`OBJECT-CONSTRUCTION.md` §1.1).

**Seasonality is the load-bearing idea.** An autumn woodland turns orange, an autumn jungle does not. Hue
alone would erase one or the other. Woodland is authored at seasonality 1 / value 1, which returns the
season shade untouched, so the biome he approved is byte-identical and only the wrong ones moved.

### Measured after, in play mode, all seven biomes

| biome | hue | reference | mean value |
|---|---|---|---|
| Jungle | 75d | 74d | 0.59 |
| Beach | 63d | 57d | 0.89 |
| Desert | 45d | 35d | 0.72 |
| Mountain | 69d | 52d | 0.64 |
| Woodland | 110d | untouched by design | 0.87 |

Brightness ordering came out as the references say: swamp < jungle < mountain < desert < meadow < woodland <
beach. `.probe/biomeleaf.mjs` is the family sheet; `window.__leafTones()` is the seam.

### The parser bug underneath it, worth remembering

The first run changed nothing and looked exactly like a colour bug. `parsePalette` in `generatorCatalog.ts`
whitelisted thirteen palette keys BY HAND, so `leaf`, `leafSeasonality` and `leafValue` were served on 36
generators, curled correctly off the API, and silently dropped at the door. `parseSubZones` already carried
whatever arrived and says in its own comment that `parseSettlement` and `parseBuildings` had each lost a
newly served field the same way. That was the fourth. `parsePalette` now carries whatever arrives.

## 2c. THE UNDERGROWTH, AND FOUR SPECIES, BUILT 2026-09-16

*"finish the undergrowth then add the variants"*.

### Undergrowth

Measured on a desert map before: **193 thickets, every one `#2f6b2a`**, plus 12 shrubs at `#4fa03f` and the
undergrowth floor tint on exactly 193 cells. A flat green, no variation, under ochre trees.

It runs the SAME three axes now, with one input swapped: the hue identity comes from `palette.undergrowth`
rather than `palette.leaf`, because undergrowth stands in the shade of what is over it. That field already
existed and had the same shared-pairs defect (Beach == Desert), so it was corrected per biome at the same
time, and it keeps its second job as the floor tint under a thicket, so the patch and the plant standing on
it stop disagreeing.

After: desert `#baa75e` `#ddae72` `#9a884c`, jungle `#779336` `#68812f`, beach `#c7d15d` `#f9c676`.

**A tile now says whether it is foliage.** `settings.foliage` is served on the 23 labels that are green
foliage. The frontend was deciding this by label prefix (`leaf_`, `canopy_`), which is the frontend
inventing a fact about backend data and could never have covered `thicket` or `shrub`. Deliberately NOT
tagged: `rock`, flowers and blossoms, autumn litter, `potted-plant`, and the ground TERRAIN tiles.

### The four species

`tree_oak`, `tree_willow`, `tree_cherry`, `tree_encina`, from *"I like to see pines, palm tree, cypress,
oak, weeping willow, cherry tree, encina"*. Pine is `tree_conifer`; cypress and palm already existed.

Built with `tree_comp/1` like the nineteen before them, which is the point: the builder ASSERTS the crown is
wider than the trunk and seats it at `round(trunk_h * trunk_zoom)`, so a new species cannot come out
detached or thinner than its own bole, the two complaints that killed the crowns.

Where they grow, measured on built maps: woodland cherry 27 / oak 26 / willow 3, meadow cherry 39 / oak 32,
desert encina 45, beach encina 32, swamp willow 22. Woodland now grows 10 distinct species.

**The trap worth remembering: a region's tree mix SHADOWS the environment's.** The engine reads
`zoneAt[row][col].trees ?? ctx.treeMix`, so on any partitioned map an environment-level entry is dead data.
The first run added oak and cherry to woodland's environment mix and woodland grew neither. Both lists have
to name a species.

`.probe/speciesheet.mjs` stamps by kind through `__placeComposition` and counts what landed;
`.probe/objshot.mjs COMP=<kind>` renders one species alone, which is what made the silhouettes judgeable.

### STILL OPEN

1. **Meadow gets 4 tones, not 20**, because the meadow layout builds no `zoneAt`, so there is no region
   axis on it. His note asks for meadow to be the MOST varied ("they even have trees that are orange, pink,
   more varied"), so it is the one that most wants regions.
2. **Mountain is the weakest colour fit**, 69d against a 52d reference, because seasonality 0.4 pulls it
   toward the spring green. Deliberate (a mountain does hold some deciduous), but it is the number to
   revisit first.
3. **The FLOOR palette has the same shared-pairs defect.** Beach and Desert both serve floor `#7c8a4e` and
   floorAlt `#8c9a5b`, a greenish olive, so a desert's ground is green even now its trees and shrubs are
   not. That is the terrain axis, and `TERRAIN.md` is a MISSING framework in `FRAMEWORKS.md`: write it
   before touching this.
4. **Desert and beach grow coconut, banana and mangrove** in quantity, from their region species mixes. A
   palm at an oasis is fine; a banana and a mangrove in the Simpson Desert are not. Untouched here because
   it is a species-mix decision, not a colour one.
5. **Oak and encina read similarly**, both broad domes. Fair (both are oaks) but if more separation is
   wanted it has to come from art, not proportion.

## 2d. SETTLEMENTS GROW WHAT SURROUNDS THEM, 2026-09-17

*"make sure ALL FOREST VARIANTS AND ALL TOWN VARIANTS AND ALL VILLAGE VARIANTS AND ALL CITY VARIANTS ALSO
USE VEGETATION THAT MAKES SENSE IN THE CONTEXT OF THEIR BIOM, REGION AND SEASON."*

Measured before: **all 27 settlements served `trees: null`.** Not one had a species mix, so every town fell
back to one global default whatever biome it stood in. Woodland, Meadow, Ruins, Swamp and Volcanic
settlements served no `nature.canopy` either, so they had no density to plant from at all.

This was already written down as §2 finding 3 ("A settlement has no trees of its own") and nothing had acted
on it. The foliage work made it worse before better: settlements got their environment's leaf COLOUR while
still having no trees to put it on.

Each settlement now derives from its environment by name prefix, at run time, so nothing is retyped and a
change to a biome reaches its settlements for free:

  - `trees` verbatim from the environment
  - `nature.canopy` scaled, because a settlement is cleared ground: village 0.60, town 0.40, city 0.25
  - the city neighbourhood sub-zones get the mix too (upper 1.0, middle 0.75, lower 0.5), because a region's
    list SHADOWS the environment's and without it the environment entry is dead data on exactly the
    generators that have regions

Measured after, on real builds: Woodland town grows column/oak/cherry/conifer (10 species), Desert town
saguaro/gnarled/dead/encina/prickly, Jungle town giant/palm/big, Mountain village 211 conifers, Beach city
coconut/palm/mangrove, Swamp city cypress/willow. Zero settlements without a mix.

`.probe/species.mjs` and `.probe/playshot.mjs` take a `CATEGORY` now (Wilderness / Village / Town / City),
because a settlement is chosen from a select and not a top-level button, and matching only buttons reported
every town as NOT FOUND while the data was fine.


### 2c-bis. Two things the colour pass left behind, found by measuring 2026-09-17

**The meadow rendered FOUR leaf tones where every other biome rendered sixteen to twenty.**

Measured in summer with `.probe/biomeleaf.mjs`: woodland 20, jungle 20, beach 20, mountain 20, desert 16,
meadow **4**. The biome whose own reference says *"more mix of colors, due to flowers, they even have trees
that are orange, pink, more varied"* was the least varied thing on the engine.

The cause is the region axis never arriving. A tree reads its region in `leafToneAt`, off `ctx.zoneAt`, and
`partitionSubZones` was called by the jungle, then by the woodland when the same gap was found there, and
never by the meadow. Its five sub-zones were served, parsed, carried on the context and never asked for, so
its trees could only ever wear one of the four season shades. Partitioning it takes the meadow to 20.

The meadow's FLOOR is deliberately left out of that: `paintSubZoneFloors` would paint over the row gradient
`MEADOW_PALETTES` draws, and that gradient is the approved look. The regions reach its planting and nothing
else.

**Two biomes sat in the wrong place in the hue ORDER.**

`references/SOURCES.md` says to use the relationships and the relative ordering, never the absolute value.
Read that way the served set was worse than the individual errors suggested:

| biome | served hue | reference | |
|---|---|---|---|
| desert | 44 | 30-40 | fine |
| beach | 58 | 51-63 | fine |
| jungle | 78 | 74 | fine |
| mountain | 68 | 52 | 16 off, and ABOVE beach when it should sit below |
| meadow | 81 | 40 | 41 off, and the HIGHEST of all five when its reference is the second lowest |

Meadow being the greenest biome on the map is the exact inversion of its photograph, which is the most yellow
of the set and carries the highest saturation of any of them, 0.67. `TwoBiomesOutOfOrder` places both by RANK
rather than by copying a photograph's number, and the served order comes out `desert 44, meadow 46,
mountain 54, beach 58, jungle 78` against the reference order exactly. Hue and saturation only: value stays at
0.55 on both, because a tint moves the hue and the art carries the tone.

**And a warning for the next person who changes `palette.leaf`.** On a biome with a high `leafSeasonality` it
is very nearly a dead knob. `foliageColor` lerps `biome hue -> season hue` by seasonality, so at meadow's 0.95
a 35 degree move in `palette.leaf` reaches the rendered leaf as under 2 degrees. The migration above is
correct and its visible effect is small for that reason. If a biome needs to actually LOOK like its reference
in every season, `leafSeasonality` is the knob, and changing it trades away the season, so measure before
touching it.


---

## 3. The model

A tree that gets planted is decided by four things, in this order. Each one narrows what the one before it offered.

| Axis | Decides | Served on |
|---|---|---|
| **Environment** | Which species can grow here at all. A palm does not grow on a mountain. | The generator's `trees` mix (exists) |
| **Sub-region** | Which of those this part of the map favours. A glade is not a thicket. | A sub-zone's own mix (missing) |
| **Season** | What the species LOOKS like now, and which of them show at all. A cherry in blossom is not a cherry in November. | The tile's seasonal art (exists) plus a seasonal weighting (missing) |
| **Size preset** | How big this particular one is. | Named combinations of the existing height / width / z-width / thickness settings (missing) |

**Every one of those is data.** The engine picks from what is served and invents no species, no weighting and no size.

### Why the order matters

It goes from the hardest constraint to the softest. Environment is physical: a species either grows in this climate or it does not. Sub-region is local: both of these grow here, but this clearing favours the one that likes light. Season is appearance, not existence, with the exception of the deciduous ones. Size is per individual, and is the only one that varies between two trees standing side by side.

---

## 4. Build order

1. **Give each species its own form, WITHOUT breaking what the old trees got right.** A palm and a pine
   have to draw differently or every other axis is sorting between things that look the same. But the
   previous attempt at this was reverted, so the constraints in §2 bind it: the leaf connects to the trunk,
   the old proportions are the starting point, the per-season shade array survives, and the whole family is
   judged in one sheet. Read `TILE-DESIGN.md` and walk its checklist before drawing anything.
2. **Then rename the adjectives.** `tree_big`, `tree_small`, `tree_tall`, `tree_stub`, `tree_round`, `tree_column`, `tree_giant` become species or size presets of one. A vocabulary change is only worth doing once the things being named are actually distinct.
3. **Size presets.** "Big trunk", "small trunk", "no trunk" as named settings combinations, editable after picking.
4. **Sub-region mixes.** A sub-zone serves its own tree weighting; absent falls back to the template's.
5. **Seasonal weighting.** A species can be absent or favoured in a season, on top of the seasonal art it already has.
6. **Settlements get their own mixes**, derived from the environment they stand in, so a beach town grows palms.
7. **Mountain and Volcanic stop being the same list.**

Step 1 is the whole of "all forest have their own distinct flavor". Nothing below it is visible without it, and §2 records exactly how step 1 has already been got wrong once.

---

## 5. Checklist

- [ ] Every served kind names a species, never a size
- [ ] Size comes from settings, through a named preset, and stays editable
- [ ] Environment, sub-region and season each narrow what is planted, all from served data
- [ ] No two environments serve the same list
- [ ] A settlement grows what its surroundings grow
- [ ] Every new species is authored against a real reference
- [ ] Judged at :3000
