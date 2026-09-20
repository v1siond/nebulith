# Pathways

The way through a map: what one is, how wide, where it leaves, and what may stand near it.

The model was implemented six times under six names before it was collapsed into one, and it has lived in
code comments and a ticket row ever since. This is that model, written down. Read
[`GENERATION-SPEC.md`](GENERATION-SPEC.md) §5 first for where the pathway layer sits in the build order, and
[`DESIGN-ENTRANCES.md`](DESIGN-ENTRANCES.md) for the history of what an exit was once dressed with, and why
it is not dressed with anything now.

---

## 1. What a pathway is

**A pathway is a STRETCH, with one or two exits.** Not a line from a hub. A THROUGH road leaves the map at
both of its ends, so it is one pathway with two exits. A cross is therefore **two pathways and four exits**,
not four pathways.

    through   ═══════════════   2 exits, leaves the map at both ends
    spur      ═══════════○      1 exit, stops inside the map at a dead end
    branch          ╱           joins another pathway rather than the border

The planner (`pathNetwork.ts`) produces, for one map:

| it produces | what it is |
|---|---|
| `gates` | one per exit: the EDGE cells the way runs off by, plus the cell just inside |
| `cells` | every cell the network covers, at full width |
| `spine` | the one-cell centre line of that same network |
| `deadEnds` | where a spur stops inside the map |
| `hub` | where the pathways meet |

`spine` exists so width can vary without severing anything: the centre line is always carved, the rest of the
band is carved where the map wants width, and connectivity holds by construction.

## 1b. A way never overwrites water

**A pathway does not pave over water. Where a way meets water it is CUT, or it CONTINUES ON A CROSSING.**

> *"pathways DON'T overwrite water sections, with the exception of bridges, which mean, if a pathway is
> intersected by a river for example, then it's either cut, or it continues with a bridge (any of the types)"*

There is no third option. A street drawn across open water is the defect this rule exists to stop, and it was
live: the settlement paver wrote its street into every cell `layout.roads` claimed without asking what was
already there, and the water layer runs BEFORE it. Measured on a 50x50 town with a river through it, **60 to
79 cells of channel paved over per map**, so the river read as a road with a blue stripe under it. `openGates`
did the same thing at the border, copying the street's ground onto the cell where the river leaves the map.

The forest paver (`wearTheWay`) has skipped water since forests got rivers. Both draw the same kind of way, so
both follow the same rule.

**How to measure it.** Not by the ground label. A paver that writes over a water cell also erases the evidence
that it was one, so "is any water cell paved" answers zero on the broken map for the same reason it answers
zero on the fixed one. `StageData.water` publishes what the water layer CLAIMED, and that is the set to ask.

### The crossing kinds, and what "dirt" means

| kind | what it lays |
|---|---|
| `wood` / `stone` | a composition, a built span standing over the channel |
| `dirt` | **the map's own way, carried over the water**: in a city that is the city's street, in a wood the wood's track |

> *"if it's 'dirt bridge', it means, we reuse the terrain of the map, so in a city the dirt path is just a
> regular street, in a town, village, forest it'll be whatever terrain they are using"*

So `dirt` serves `reusesWay`, never a colour of its own. It served `colorOf: path_dirt` for every template,
which put a stripe of brown track through a city's streets, which is the one thing a crossing meant to
disappear into the map must not do.

### A way is made of a cell, and things stand ON it

> *"I'm fine adding tiles or whatever when necessary, in fact, in the street we have the lines tiles to make
> it look like an actual street"*

The surface of a way is the cell it is drawn on. The markings, the kerbs and everything else that makes it
read as a street are tiles laid on top of it by the objects phase. Saying "a way is never a tile" confuses the
two and is wrong about the second.

## 2. Structure and look are different layers

`GENERATION-SPEC.md` §5.2 draws this line, and it is the one most easily put on the wrong side:

| pathways (layer 3) decides | objects (layer 4) decides |
|---|---|
| where the ways run, and how wide | which tile the way is surfaced with, and in what colour |
| which cells are a way, which are a section for objects | what lies ON it and what stands BESIDE it |
| where the exits are and how many | what the way out is surfaced with, and what flanks it |

**The width is structure, and it is decided ONCE.** Nothing downstream may re-derive it. A painter that
rebuilds a way's width from a constant of its own has invented a second width, and every guard in the system
is attached to the first one. That exact inversion is the bug this document was written after: the four entrances were authored
3 cells wide because `WOODLAND.pathWidth` was the constant 3, and `DESIGN-ENTRANCES.md` recorded the number
as a fact. When width became served per template, 9 generators started serving 2 and the 5 CITIES started
serving 4, and the gate art went on covering 3. A city's fourth cell was ordinary ground, so the scatter
planted a tree in the way out.

## 3. The width is served, and everything asks it

`pathwayWidth(ctx)` is `ctx.pathway?.width`, off the template's served pathway block. Measured on the served
catalogue: **9 generators serve 2, 24 serve 3, 5 serve 4** (every city), and 2 serve none (cave, temple).

Everything that cuts, clears, claims or dresses a way reads that one function. Nothing carries its own copy:

- the route planner, for how wide it plans
- the route cutter, for how wide it carves
- `gateOn`, which cuts a gate at **exactly** `width` cells
- the gateway painter, which takes the gate's OWN CELLS rather than a width at all
- the water keep-out margin, `ceil(width / 2) + 1`

A literal width anywhere else is a bug in waiting. The five call sites that once held `WOODLAND.pathWidth`
are why a rainforest machete trail, a clifftop path and a four-lane seafront street were all three cells
across with nothing but a colour between them.

### A painter takes CELLS, never a width

The gateway painter used to take one cell and spread its own lane `GATEWAY_HALF = 2` either side of it, so
**every way out on every template was drawn 5 cells across**, whatever was served. The gate itself was cut at
the served width, so a served 3 gave a 5-cell paved opening around a 3-cell gate, and the two extra cells
were ordinary unguarded ground in plain sight. `sealMapEdge` then walled the border with trees, sparing the
gate and planting in the two beside it. Reported as:

    [tree][    ][    ][    ][tree]      five cells, and two of them hold a tree

The fix is not a second constant to keep in step. A painter is handed `gate.cells` and carries them inward,
so the way it draws is cell for cell the way the plan cut, and the flank stands one cell outside the gate's
own ends. There is then nothing left that CAN disagree.

### The plan seals its own border

The corridor cutter paints a `width × width` SQUARE around every point it walks through. A leg that runs
ALONG the line one cell inside the border therefore paints the border line for its whole length, so the plan
published border cells that were never a gate: measured on a meadow, a 3-cell south gate came with FIVE
border cells of route, the two extra ones paved and planted on.

`planRoutes` strips them before it returns (`sealTheBorder`). The border opens at the gates and nowhere else,
and the layer that cuts the ways is the one that has to say so.

## 4. The exit contract

An exit is the one place on a map whose meaning is "somewhere else". Four rules, all measured:

1. **An exit is the full served width.** `gateOn` cuts exactly `width` cells. A way 4 wide exits through 4
   cells, never 3. *"I want ALL cells from the exit setup, not 1, not 2."*
2. **Nothing stands in a gate cell.** Gate cells join `claimed` and `pathwayCells` the moment the plan is
   made, in `plannedRoutes`, so EVERY layout inherits it. It used to be done only by the two forest layouts,
   folding their own gate lanes in, and a city never spoke for its gates at all.
3. **Every placer must ask.** A rule that lives in one of eleven placers is not a rule. `fillVillageNature`
   asked about paving, roads, buildings and fit, and not about `claimed`, which is why a settlement planted
   in its own way out while every forest did not.
4. **An exit arrives wired.** Each gate is born with a walk connector covering all of its cells and no
   target, because the target is the one thing that cannot be inferred. `exitConnectors` builds them from
   the plan's own gates, so the cell count follows the served width by construction.
5. **NOTHING is written into a gate cell, art included.** Not a plant, not a prop, and not the way's own
   verge: `wearTheWay` draws a tongue of the field over the boundary where a way meets the grass, and at a
   gate the only thing beside the way is the sealed border, so it drew grass across the way out. A gate cell
   carries the way's surface and nothing else.
6. **An exit wears NO composition.** Four entrance objects used to be stamped on the gates
   (`DESIGN-ENTRANCES.md`). They are gone. Each was authored at a fixed 3 cells, which is a second width by
   another name, and each was assembled out of tiles doing jobs they are not for.
7. **An exit you cannot walk to is not an exit.** *"the geneartor added an impossible exit in the town map,
   blocked by river, without any real pathway, exits are only part of a real pathway"*. Rules 1 to 6 are all
   about the gate CELLS and none of them asks the only question a person walking cares about, which is
   whether the gate joins the rest of the map. Water is what breaks it, and the generator already knew: the
   note on the general water layer records *"the river SEVERED it, three exits asked for came back as two
   reachable sides"*. `dropStrandedExits` measures every gate against the map's largest walkable region and
   removes the ones that reach nothing, gate and connector together.

   **Dropped, not bridged.** The crossings pass has already put its spans where the ways cross water, so a
   second one built to rescue a gate would stand in water nothing asked to cross. And the region has to be
   the LARGEST one, not merely "somewhere walkable": a gate opening onto a sealed pocket of three cells is as
   impossible as one on the far bank, and one measure catches both.

## 5. What may stand beside a way

`claimed` is the ground an earlier layer has spoken for: the way, its gate lanes, the banks water left, the
cells a clearing carved. It means **do not plant here**. Read it, never re-derive it:

- `collision` says whether you can WALK somewhere. It is not a description of what is in a cell, and using it
  as one is how the canopy started planting in pools the moment a pool stopped blocking.
- The ground LABEL says what a cell is made of. `isWaterGround`, `isBuiltFloor`, `isRoadGround` answer that.
- `treeColumnClearsPaving` is a TOWN rule (built floor or road). It is not a stand-in for "is this the way":
  applying it to a forest rejects the whole wood, because a woodland's ground is neither.

## 6. Checklist

Before calling any pathway or exit change done:

1. `grep` for a literal path width, `HALF` constants included. Every one must be `pathwayWidth(ctx)`, derived
   from it, or better still replaced by the gate's own cells.
2. Generate at all three served widths, 2, 3 and 4, and assert `cells per exit === served width` for each.
3. Assert **zero** plants on any gate cell, for a wilderness, a village, a town and a city. Cities are the
   case that breaks: they are the only width-4 templates and they use the settlement layout, not the forest one.
4. Assert the forest is still alive in the same run. A guard that empties the map reports a perfect zero for
   every "is anything in the way" question, and that reads exactly like success.
5. Every exit has a connector, with as many cells as the gate.
5b. Every exit is reachable: its cells are in the map's largest walkable region (rule 7). A map generated
   with a river across it is the case that catches this, and a count of exits alone will not.
6. Read the exit cells from `__exits()`, never by guessing at the border. A border scan on `blocking` reports
   40-cell "mouths", because what closes a forest border is trees, not collision.
7. Measure the DRAWN opening, not a set the defect can edit. `pathwayCells` is the wrong witness: `sealMapEdge`
   DELETES a border cell from it at the moment it plants a tree there, so a test asking that set passes on the
   broken map. Ask the ground and the floor colour, which is what is actually on screen.
7b. **Not one cell of water is paved.** Ask `StageData.water`, the set the water layer claimed, never the
   ground label: the paver that overwrites a water cell also erases the evidence it was one, so the ground
   answers the same on a broken map as on a fixed one (§1b).
8. Serve `options.pathways` or `options.exits` in every test that measures an exit. `resolvePathways` returns
   null without them, so a build that omits them plans NO routes, and every case guarded by `if (!routes)`
   passes having asserted nothing. That is how 24 green cases sat on top of a broken exit.
9. Run the new check against the OLD code before believing it. A gate that cannot fail is not a gate.
