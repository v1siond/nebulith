# Editor interaction

What a pointer gesture means on the map canvas, and how a click decides what it acted on.

Open this before changing anything about clicking, hovering, selecting, placing or dragging on the
canvas. The rules below are the contract; the checklist at the end is the gate.

## 1. There is no DOM on a canvas, so a click is resolved, not received

Every gesture lands on one `<canvas>`. Nothing under the pointer is an element, so a click has to be
resolved against a record of what was drawn.

`render` rebuilds `isoTileHits` every frame as it draws, one entry per drawn thing, carrying the
silhouette it actually painted. `pickIsoTilesAt(x, y)` walks that record front to back. This is the
INVERTED pick: you get the tile you can SEE, not the flat cell the cursor's ground coordinate maps to,
so a tall, lifted, slid or posed tile is picked where it is drawn rather than where its base cell is.

A unit is in that record too. `recordUnitHit` pushes its billboard silhouette with `source: 'entity'`
and its `entityId`, which is what makes a click on a standing figure resolve to the figure rather than
to the floor drawn under its feet.

Two resolutions exist, and both are legitimate:

| | reads | right for |
|---|---|---|
| `pickIsoTilesAt` → `source` / `entityId` | the last frame's drawn silhouettes | iso and 2D, where a thing is drawn away from its cell |
| `entityAtFootprint` on `screenToCell` | the cells a unit occupies | top view, which has no per-tile record, and as the fallback everywhere |

Resolve with the record first and fall back to the footprint. Never invent a third hit-test: a new one
disagrees with the highlight, and the disagreement shows up as "it selected the wrong thing".

## 2. A click selects the thing you pointed at, whatever the sidebar has armed

    if I click on a given unit I should select it, regardless of the sidebar option I'm in

The armed tools (a palette tile, the entity tool, the building tool) are about PLACING. Each used to
act on the cell and return before any unit hit-test ran, so with a tool in hand a click on a unit
painted the ground under it. Editing a unit you had just placed meant leaving the tool, clicking the
unit, and arming the tool again.

**So a unit under the pointer is selected first, in every placement mode.** The unarmed path already
resolved entity-first; this gives the armed paths the same answer, from the same resolution.

## 3. Alt is the override that says "the cell, not the thing on it"

A unit stands on a floor, and that floor has to stay editable. `Alt` was already the modifier for
exactly this in the unarmed path ("edit the floor even under a unit"), so it is the modifier here too:

* plain click, on a unit → select the unit
* `Alt` + click → the armed tool acts on the CELL, unit or no unit
* `Shift` + click → the selection gesture, unchanged, so a bulk selection can still be built

One modifier, one meaning, everywhere. A second way of saying "ignore the unit" would be a second
thing to remember.

## 4. §2 is about the tools that PLACE, and only those

A tool whose whole subject is ALREADY the thing under the pointer has to keep the click, or it loses
its only gesture. Three deliberate exceptions, written here rather than left in the code to be
rediscovered:

| mode | why it keeps the click |
|---|---|
| **Remove a character** (`entityTool === 'erase'`) | it exists to delete the unit you click on. Unit-first would leave no way to delete one at all |
| **Paint invisible walls** (`entityTool === 'collision'`) | it sets a CELL's own blocking flag, and a unit standing there is not what is being edited |
| **Connector mode** | it marks a SET of cells; unit-first would make a unit's cell impossible to put in a connector |

`placesAUnit` asks the question of the tool rather than testing for a list of names at the call site,
so a fourth entity tool has to answer it.

This is the exception that is easiest to get wrong, because §2 reads like it should apply everywhere.
It was got wrong once already, in the first version of this very change: the guard said
`armedTile || entityTool || buildingTool` and broke the erase tool, and nothing but reading it again
caught it.

## 5. Mouse-down decides, mouse-up commits, when a drag is possible

With NO tool armed, plain left-drag pans the camera. So an unarmed click cannot act on mouse-down: it
stashes the resolved pick in `downCellRef` and the mouse-up commits it, but only if the pointer never
moved (`dragMovedRef`).

With a tool armed, plain drag does not pan, so those paths act on mouse-down directly.

When adding a gesture, say which of the two it is. A placement that acts on mouse-down inside the
pannable path fires on every drag.

## 6. Repeated clicks at one spot walk back through what is stacked there

`pickCellForSelectCycling` advances an index through the overlapping hits when consecutive clicks land
within `PICK_CYCLE_TOL` of each other, so an occluded tile is reachable without moving the camera.
Hover must NOT use it, or moving the pointer would advance the cycle; hover uses the frontmost pick.

## 7. The hover preview and the click must resolve identically

`hoveredCellRef` is set from the same resolution the click uses, so the dim hover cube previews the
exact thing a click will take. Any change to how a click resolves has to change hover in the same
turn, or the editor starts highlighting one thing and selecting another.

## Still to build

Named here so the gap is a decision rather than a discovery. See `SPEC.md` phase 4.

* **Auto-select what was just placed.** *"It'd expect to autoselect the unit I just added to the map
  too, in most cases I'd want to edit right away, edit it's stats and what not."*
* **An explicit add / select toggle**, raised as a possibility rather than a requirement: *"maybe we
  have a toggle 'add - select'? but even then it's just weird"*. §2 removes most of the need for one.
* **Bulk add.** *"maybe I want to add many selected units and the same time"*.
* **Bulk edit.** *"select a few and assign the same stats and same abilities"*. The selection model
  already carries a set of cells; what is missing is an inspector that edits a set of UNITS.

## The checklist

Before reporting any pointer, selection or placement change as done:

1. Does the change resolve through the EXISTING pick, or did it add a new hit-test? A new one drifts
   from the highlight. Say which it uses.
2. Does hover resolve the same way the click does (§7)? Check both.
3. Is it a mouse-down or a mouse-up gesture, and is that right for whether a drag is possible (§5)?
4. Does it hold in ISO, 2D and TOP? Top view has no per-tile record, so the footprint fallback is the
   only resolution there.
5. Does `Alt` still reach the cell under a unit, and does `Shift` still build a selection (§3)?
6. Is there a browser scenario that clicks the real canvas and asserts on what the app then holds?
   `docs/TESTING.md` has the framework; a canvas has no DOM to assert on, so assert on the state.
7. Did it fail on the code before the fix? A gate that cannot fail is decoration.
8. Which items could you NOT verify? Say which.
