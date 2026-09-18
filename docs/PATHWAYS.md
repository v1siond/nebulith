# Pathways

The way through a map: what one is, how wide, where it leaves, and what may stand near it.

The model was implemented six times under six names before it was collapsed into one, and it has lived in
code comments and a ticket row ever since. This is that model, written down. Read
[`GENERATION-SPEC.md`](GENERATION-SPEC.md) §5 first for where the pathway layer sits in the build order, and
[`DESIGN-ENTRANCES.md`](DESIGN-ENTRANCES.md) for what an exit LOOKS like.

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

## 2. Structure and look are different layers

`GENERATION-SPEC.md` §5.2 draws this line, and it is the one most easily put on the wrong side:

| pathways (layer 3) decides | objects (layer 4) decides |
|---|---|
| where the ways run, and how wide | which tile the way is surfaced with, and in what colour |
| which cells are a way, which are a section for objects | what lies ON it and what stands BESIDE it |
| where the exits are and how many | which entrance composition an exit wears |

**The width is structure. The entrance art is look.** An entrance composition must never decide how wide a
gate is. That exact inversion is the bug this document was written after: the four entrances were authored
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
- `gateLaneHalf`, the mouth at the border, half the width so the lane always covers the gate
- the water keep-out margin, `ceil(width / 2) + 1`

A literal width anywhere else is a bug in waiting. The five call sites that once held `WOODLAND.pathWidth`
are why a rainforest machete trail, a clifftop path and a four-lane seafront street were all three cells
across with nothing but a colour between them.

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

1. `grep` for a literal path width. Every one must be `pathwayWidth(ctx)` or derived from it.
2. Generate at all three served widths, 2, 3 and 4, and assert `cells per exit === served width` for each.
3. Assert **zero** plants on any gate cell, for a wilderness, a village, a town and a city. Cities are the
   case that breaks: they are the only width-4 templates and they use the settlement layout, not the forest one.
4. Assert the forest is still alive in the same run. A guard that empties the map reports a perfect zero for
   every "is anything in the way" question, and that reads exactly like success.
5. Every exit has a connector, with as many cells as the gate.
6. Read the exit cells from `__exits()`, never by guessing at the border. A border scan on `blocking` reports
   40-cell "mouths", because what closes a forest border is trees, not collision.
