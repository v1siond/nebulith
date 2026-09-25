# Object construction

How a thing that is not a single tile gets built: a tree, a cactus, a ruin, a bridge, a house.

Open this before building any object. The checklist at the end is the gate, not a summary.

## 1. An object is CELLS, never a picture

The one law everything else follows from. An object is a COMPOSITION: a footprint, and a list of cells,
each holding a tile at a level with its own settings. It is the same lego model a building uses, so
every piece of it is selectable, editable and saveable like any other tile.

**A billboard tile is not an object.** A single-cell tile wearing a picture of a cactus is a picture of
a cactus. It cannot be walked around, lit, resized per part, or edited part by part. Measured: the
first cactus attempt shipped three single-cell tiles, and the whole of it had to be removed.

So the shape of every object is:

```elixir
%{
  footprint_w: 1,
  footprint_h: 1,
  category: "nature",          # the SAME bucket vocabulary tiles use
  cells: [
    %{dx: 0, dy: 0, level: 0, label: "trunk_mid", walkable: false, scale: 1.0, settings: %{...}},
    %{dx: 0, dy: 0, level: 2, label: "leaf_center", walkable: false, scale: 1.0, settings: %{...}}
  ]
}
```

## 2. A cell is not stuck filling its tile

This is the piece that makes shapes possible out of blocks, and it is the piece most often missed.

* `scaleX` sets a block's WIDTH and `scaleY` its HEIGHT, independently.
* `settings.pose` MOVES it inside its own tile (`lamp_post` sits its bulb on a 7-high post with
  `pose: {dy: -1.8}`).

So several bars can share one cell at different sizes and offsets, and that is how a shape gets built
out of rectangles. A saguaro is a tall narrow bar, a wide short bar crossing it, and two short bars
rising from that bar's ends. Plain rectangles. No curve is needed.

### `scaleZ` IS NOT A THIRD SIZE. It is the thickness shorthand.

This line used to read "`scaleX` / `scaleY` / `scaleZ` set a block's width, height and depth
INDEPENDENTLY", and that sentence is what a whole cactus ticket was built on. It is not what the engine
does. `tileThicknessReach` reads `scaleZ` as the SHORTHAND for a thickness, and a `scaleZ` with no
`thicknessDir` beside it means **thin toward every face at once**.

Measured: at `scaleZ 0.3` every face reaches 0.3, so along each ground axis `reachGroundQuad` gets
`hi = 0.3` and `lo = 1 - 0.3 = 0.7`. The two sides are pulled PAST each other, and the guard that stops a
block vanishing mid-drag keeps a `MIN_SPAN` sliver where they met: 0.05 of the cell, on BOTH ground axes.
That is a 2px line however tall the bar is. Every saguaro bar did exactly that, next to a barrel cactus
carrying no `scaleZ` and drawing 40px across at `scaleX 0.72`.

**So a bar is made thin by a DIRECTED reach.** Either `scaleZ` with a `thicknessDir` naming the face it
hugs, or the explicit `thickness` map naming the pair to pull in. `reachGroundQuad` pairs `right-down`
with `left-up` on the +col axis and `left-down` with `right-up` on +row, so a slab that is broad across
and thin into the screen states the +row pair and leaves +col alone:

```elixir
%{"scaleX" => 1.0, "scaleY" => 3.4, "thickness" => %{"left-down" => 0.67, "right-up" => 0.67}}
```

A reach of 1 is ignored by the reader, which is why the across pair is stated by being left out.

**And an upright is narrowed by its thickness, never by its width**, twice in his words: *"I REQUESTED
TO EDIT THE THICKNES AND YOU CHANGED THE WITH"* for a trunk, and *"we used width instead of thickness
to make it, and looks too skynny"* for a cactus. Width is the axis you look at. It stays full.

### A cell that states its own shape is never part of a RUN

The stamp collapses a vertical run of the same tile at one footprint cell into ONE block sized
`scaleY = run length`, so a wall column of 4 is 1 draw instead of 4. That is a performance rewrite and it
is only allowed because it renders identically, which holds exactly as long as the cells are
interchangeable unit cubes.

A saguaro's four bars all sit at `dx: 0, dy: 0`, and the tall upright and the wide crossing bar share a
label at consecutive levels. They were collapsed, and the collapse stamps the FIRST cell of the run: the
crossing bar, the thing that makes the object read as a saguaro instead of a post, was authored and never
drawn. So the rule is that the moment a cell carries a size, a pose, a thinning or a shape of its own,
one block sized `scaleY = run length` is a DIFFERENT object rather than a cheaper drawing of the same
one, and the run stops there.

## 3. Its numbers are its own

There is no shared formula, and inventing one is the recorded way this goes wrong. A cap of "trunk is
at most a quarter of its crown" plus a rescale of the authored spread made twenty-one species that
state different proportions all come out within a few pixels of each other, and every attempt to fix
one tree moved all twenty-one.

A species states what it gets. A builder function converts authoring words into cell words and does
nothing else:

* `trunk_zoom` is how much of its cell the trunk fills; `trunk_w` scales the across-axis against it.
* `trunk_h * trunk_zoom` is the height it draws at, because a species is authored as "3.15 blocks at
  60%" and a cell states one number.

No cap, no rescale, no guard that quietly rewrites the number.

## 4. Before modelling anything: find the reference

Step 1 is not code. It is finding real isometric art of the thing being built, recording it in
`docs/references/SOURCES.md` with its source, and getting it approved. **This is a full stop.**

An object built from a written description of a reference instead of the reference itself came out
nothing like the thing it was named after. A text description is not a reference.

The references already held are catalogued in `docs/references/SOURCES.md`; the files live in the
workspace, never in this repository, because they are licensed stock.

## 5. Check the art before extruding it

A tile with a transparent margin extruded into a block is an open crate, not a solid one. Measured at
31% margin. Look at the alpha before assuming a tile fills its cell.

## 6. Reuse the piece families that exist

Compositions are built FROM autotile piece families, not from one tile bent with a scale. A fountain is
`water_c` plus its rim edges and corners plus jets. `docs/TILE-DESIGN.md` §5 has the nine-piece scheme.

Before authoring a new tile, check whether the piece already exists under another label.

## 7. Where an object is DEFINED

In the catalog seeder (`TileSource`), with the tiles it needs seeded alongside it, because
`GeneratorSource.seed/0` and `TileSource.seed/0` are the single owners of that data
(`docs/CODING-STANDARDS.md` §4). A data migration that creates a composition is a second owner and the
next seed will not know about it.

A migration's job is to move an EXISTING database to the state the seeder already describes, never to
be the only place a thing is described.

## 8. Naming

Name the object for what it IS, not for where it is found. `forest_entrance` held a cave, which is why
it is now `cave_entrance_rounded` and friends. The name says the object; the generator says where it
goes.

## The checklist

1. **Which reference is this built against?** Named, recorded in `SOURCES.md`, approved. If there is
   none, that is step one and it is a full stop.
2. **Is it cells?** A footprint and a list of cells, not a single-cell billboard tile.
3. **Are its numbers its own?** No shared cap, no rescale of authored values across species.
4. **Is each bar thinned by a DIRECTED reach?** A wide bar must be thin on the other ground axis or it
   reads as a plus, and the thinning has to name which axis. A bare `scaleZ` thins toward every face and
   collapses the block to a sliver (§2). Width stays full: it is the axis you look at.
   And **step 8's browser layer is what proves this one**. A gate on the catalog numbers passed while the
   picture was a 2px line, because a number in a column is not a shape on a screen.
5. **Does every tile it names EXIST?** A composition naming a label nothing seeds places nothing, and
   it fails silently. Grep the catalog for every label before shipping it.
6. **Is it defined in the seeder**, not only in a migration?
7. **Does every member of its family render?** `test/e2e/the_render_sheet_test.exs` writes one portrait
   per member into `docs/renders/`. Look at all of them, not the one you built.
8. **Both test layers**, per `docs/TESTING.md`: a `mix test` gate on the data and a browser scenario.
9. **Which items could you not verify?** Say so.
10. **The visual verdict is his**, at :3000. A green suite is not done.
