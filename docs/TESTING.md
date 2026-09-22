# Testing

Everything this project tests is tested in Elixir. There are two layers and a feature gets both.

| Layer | What it covers | How it runs |
|---|---|---|
| **Unit** | modules, pure functions, controllers, changesets, the catalog | `mix test` |
| **Scenario** | anything a person can see or do, driven through a real browser | `bin/e2e` |

```bash
mix test                                     the unit layer
bin/e2e                                      every scenario
bin/e2e test/e2e/phase_03_maps_test.exs      one file
bin/e2e --only phase3                        one phase
```

There is a third command, and it is not a test layer:

```bash
bin/probe fps            how many frames a big map draws
bin/probe treeSheet      stamp every tree species and measure the silhouettes
bin/probe groundCensus   what the ground of a generated world is made of
```

Probes are instruments. They PRINT numbers and never fail, because their job is to answer a question
you are holding rather than to guard a rule. Keeping them apart from the gates matters: a script that
cannot fail sitting in a list of gates makes the list look longer than it is. `waterBorders` is the
exception, still a gate and still there, waiting to be ported.

`mix test` on its own SKIPS the scenario layer, because a machine with no browser still has to be able
to run the unit suite. That skip is also how a whole layer can rot unseen, so CI runs `bin/e2e` too.

## Why there is no node test suite

There was one: 323 files, 4,775 cases. It was deleted, and the reasons are worth keeping because they
are the reasons not to start another one.

**A node test supplies its own inputs, so it tests the app you imagined rather than the one that
runs.** The clearest measurement: the suite fed the generator three fields by hand and measured zero
trees on a map the editor draws in full. Every assertion after that was about a world that does not
exist.

**Nothing ran it, so it rotted in a day.** It was not in CI. On the day it was deleted, 107 of its 323
suites failed and 568 of its cases were red, and six commits had landed against code it covered
without anyone finding out.

**It had stopped describing the app.** Ten call sites constructed `new IsometricGrid(4, 4, 32)`
against a constructor that takes a config object, so every initialisation loop ran zero times and the
assertions passed against a grid the app cannot build. One file asserted a height was 5 and then that
it was undefined, two lines apart. The captured tileset fixture that 116 files imported still carried
`glyph`, `emoji` and `walkable`, none of which the backend has served since phases 2 and 3 removed
them.

**A large green number beside a live defect is worse than no number at all.** It is the thing that
gets pointed at when somebody asks whether this is covered.

So: no jest, no vitest, no node test runner. A pure function is tested in `mix test` if it lives in
Elixir. A pure function that only exists in the frontend is tested through the UI that calls it,
because that is the only place its real inputs come from.

## The scenario layer

`phoenix_test_playwright` drives a real Chromium at the real Phoenix endpoint from inside `mix test`.

**It cannot touch real data.** `config/test.exs` starts the endpoint on 4002 against `nebulith_test`,
and the Ecto sandbox holds a transaction for the length of each scenario. The browser joins that
transaction because the sandbox metadata rides in on its user agent and the endpoint's
`Phoenix.Ecto.SQL.Sandbox` plug reads it back off. A scenario that clicks Save writes into a
transaction that is rolled back. It could not always: when this layer drove the dev server, a run that
clicked Save overwrote a real saved map.

### How the browser is reached

Playwright stopped shipping a chromium for Ubuntu 20.04 at 1.63 and the Elixir driver wants 1.63 or
newer, so the local driver cannot start here. The documented route for exactly that is a Playwright
SERVER reached over a websocket, and `bin/e2e` starts one in a container.

Two addresses have to be right and `bin/e2e` works both out rather than having them written down:

* **The browser, from Elixir.** `ws://127.0.0.1:3111/`. The container must publish on IPv4; a publish
  that lands on `[::1]` only is refused at `127.0.0.1` and at `localhost`.
* **The app, from the browser.** The browser is in the container and has to call back to the app on
  this machine. Under Docker Desktop `host.docker.internal` resolves to the WINDOWS host, not to this
  WSL distro, and the connection is refused. Measured: the distro's own address answers 200, and
  `host.docker.internal` answers nothing. So the script reads `hostname -I` and uses that.

CI runs the same script with the same container, even though a GitHub runner could skip it. A
difference between how CI runs something and how a person runs it hides a defect for exactly as long
as it exists, and this repo has paid for that twice.

### What a scenario looks like

```elixir
defmodule Nebulith.E2E.Phase04CollisionsTest do
  use Nebulith.E2ECase, async: false

  @moduletag :e2e
  @moduletag :phase4

  setup :a_signed_in_editor

  test "a reloaded map stops you where the built one did", %{session: session, map: map} do
    session = GeneratePanel.build_world(session, "city", "Woodland city", ["Winds through (easy to cross)"])
    built = audit(session)

    assert built.water > 0, "the built map has no water, so it proves nothing about walking into water"
    assert built.water_blocked > 0, "you can walk straight into the river"

    back = session |> Editor.save_and_reopen(map.id) |> audit()
    assert back.solid == built.solid
  end
end
```

### The parts

| Module | What it is for |
|---|---|
| `Nebulith.E2ECase` | `use` this. Brings in the helpers and the setups |
| `Nebulith.E2E.Browser` | `js/2`, `wait_until/4`, `wait_for_js/4`. Talking to the page |
| `Nebulith.E2E.Account` | `an_admin/1`, `sign_in/3`. Being somebody |
| `Nebulith.E2E.World` | `seed_catalog/0`, `scratch_map/1`. The data a scenario needs |
| `Nebulith.E2E.Editor` | `open/2`, `save/2`, `save_and_reopen/2`. The editor page |
| `Nebulith.E2E.Canvas` | `tiles/1`, `drawn/1`, `click_cell/3`, `pixel_at_cell/3`. The map |
| `Nebulith.E2E.GeneratePanel` | `build_world/4`. Building a world through the panel |
| `Nebulith.E2E.StubApi` | `stub/2`, `assert_served/2`. Answering an API call with a stated payload |

Two setups cover almost everything: `:a_signed_in_editor` (catalog seeded, admin signed in, an empty
map open) and `:a_signed_in_admin` (signed in, nothing else).

## Asserting on a canvas

The map is one `<canvas>`. There are no nodes to query and no text to match. That decides WHAT is
asserted, not whether: drive the UI, then check that the data is right.

**The content.** `window.__nebulithGrid` is the grid the app is holding, tile by tile, with every
setting on it. A scenario that places a tile and reads the grid is asserting on the data the app
actually has.

**The draw.** `window.__nebulithDrawn` is what the renderer DECIDED for each tile in the last frame:
which image, at which pixel, or nothing at all. When something is missing from the screen the draw log
names the tile responsible. Five pixel detectors once agreed only that a pixel was wrong; one line
recording the decision said that a kind had no tile, so the floor drew nothing and the canvas showed
through.

**The row.** After a save, read the row out of the test database. What a save is FOR is the row.

**The pixels, when the question really is about pixels.** `Canvas.pixel_at_cell/3` reads the canvas
back through its own 2D context, so "is there a navy hole in the ground at 12,7" is answered with the
four numbers the browser has. No baseline image, nothing to regenerate per machine.

**A baseline screenshot, for layout and chrome.** `assert_screenshot/3` runs Playwright's own
comparator and writes diffs to `test/snapshots/__diff__/`. Use it for panels and pages. Do not use it
on a generated world: worlds are random, and a baseline made here will not match one made on a runner.

**The user's eye decides whether it looks right.** A scenario proves a fact about the data, never that
a picture is beautiful. The generate panel scenario is the pattern: it hashes each card's image and
asserts the hashes are DISTINCT, which proves every card drew its own map without asserting a pixel.

## The mocked backend

The Elixir Playwright binding carries no request interception: no route, no fulfill, no abort. There
are two ways to decide what the page is served, and they are for different jobs.

**Real rows, for the happy path.** A fixture written through `Catalog.create_template/1` runs the real
changeset, the column defaults fire, and the real controller serialises the real struct. The payload
follows the exact schema BY CONSTRUCTION, because it went through the schema. This is the default and
most scenarios need nothing else.

**A stub, for what the backend is not supposed to produce.** `StubApi.stub/2` installs a `fetch`
wrapper before the page loads, so it survives the reload in the middle of a round trip. Use it for an
error, an empty catalog, a field arriving null: the things real rows cannot express.

Two rules for a stub:

1. **Build the payload in Elixir from the app's own code**, never by typing JSON. `MapController.schema_payload/0` serialises from `World.CellTile` itself. A hand-written stub is a second copy of the schema, and the moment a column is added the scenario is testing an app that no longer exists while staying green.
2. **Assert the stub was used.** `StubApi.assert_served/2` fails when a path a scenario declared was never asked for. A stub that never fires lets the page talk to the real backend while the scenario passes, proving something else entirely.

## Gates written ahead of their work

The spec gives every phase a gate and says plainly which of them cannot pass yet. Writing that gate
FIRST is the point: a gate added after the fix has never been seen to fail, so it proves nothing.

But a suite that is red on purpose stops being read. So a gate for work that has not been done
carries `:awaiting_phase`, is left out of a normal run, and is asked for by name:

```bash
bin/e2e --include awaiting_phase           the browser ones
mix test --include awaiting_phase          the unit ones
```

Waiting, and on what:

| Gate | Waiting on | What it reports today |
|---|---|---|
| `phase_04_collisions_test.exs` | Phase 4, `collision_boxes` | On a freshly generated city a brick wall is WALKABLE until the map is reloaded, and a tree's canopy BLOCKS until the map is reloaded and then stops. The same defect from both sides: what a cell occupies is decided twice, once by the generator in memory and once by the loader from the rows, and the two do not agree |
| `spec_compliance_test.exs`, "every column a placement can state is carried across the wire" | The rest of phase 3: the payload's field list becoming a copy generated from the schema | Seven columns a placement can state never reach the wire, because `mapPayload.ts` names its 42 fields one at a time: `thickness_axis`, `stack_at`, `color_role`, `leaf_color`, `foliage`, `surface`, `pinned`. Nothing authors them today, so nothing is being lost yet, and a hand-written list is exactly the thing that falls behind without anyone noticing |

A gate here is never weakened to make it pass, and never deleted because it is red. When its phase
lands, the tag comes off.

## Writing one

**A new test must be run against the code BEFORE the fix, and must fail there.** A gate that cannot
fail is decoration, and this repo has shipped several.

Three shapes of gate that cannot fail, all of them found here:

* **A degenerate oracle.** The expected value is computed by the same arithmetic as the actual, or a `??` in the code under test can manufacture it. A "floor-safe" test stayed green while the code deleted the floor, because the fallback produced the same `'grass'` the test had painted.
* **A wait that is already satisfied.** `wait_for_tiles(1)` after pressing Build returns instantly if the map already had tiles, handing the scenario the world it started with. Wait for the thing to CHANGE and then settle.
* **A loop with nothing in it.** An empty list silently skips every assertion inside it. Assert the count first, then the contents.

And say out loud when a run proved nothing:

```elixir
assert built.water > 0, "the built map has no water, so it proves nothing about walking into water"
```

## Traps already paid for

* `PhoenixTest.Playwright.evaluate/2` returns the CONN so it can be piped, not the value. Reading its result as the answer gives you a struct, so every check is quietly false and every count quietly zero. `Browser.js/2` is the one that hands back the value.
* The editor holds a full-screen overlay until the tileset installs. A click before it lifts lands on the overlay, which Playwright reports as an element intercepting pointer events rather than as a missing button. `Editor.ready/1` waits it out.
* The generator catalog arrives by fetch and re-renders the panel, which detaches whatever input was being typed into.
* Preset buttons carry their description inside them, so matching on the words alone resolves to the divs nested in the button. Category options are rendered as a name plus a count, so the label changes whenever a generator is added. `GeneratePanel` reads both off the page.
* **Match on RENDERED text, not on `textContent`.** The inspector's section header reads `SIZE & POSITION` on screen and `Size & position` in the DOM: the capitals come from a CSS text-transform. A selector written from what you can see finds nothing, and reads exactly like a section that is not there.
* **A cell has to be ON SCREEN to be clicked.** The camera shows a window onto the map, so most cells project outside the canvas. Clicking one of those is not a click on nothing, it is a click somewhere else, and it comes back as a wall of driver log about the document intercepting pointer events. `Canvas.a_visible_tile/2` picks one you can reach.
* **The app has to be BUILT the way it is served.** `Plug.Static` is configured `gzip: not code_reloading?`, so dev serves `app.css` and test serves `app.css.gz`. Building without digesting leaves a stale `.gz` beside a fresh `.css` and the browser is handed the old one. Measured: a three day old stylesheet with 43 rules in it, which rendered the documentation's contents rail 4848px wide in a 1700px window and read exactly like a layout defect. `bin/e2e` runs `MIX_ENV=dev mix assets.deploy`, in the dev environment because tailwind and esbuild are dev-only dependencies and produce a stub without them.
* **The editor needs a desktop window.** The driver's default viewport is 1280x720, and at that width the generate panel lies over the middle of the canvas, so a click meant for a tile lands on the panel. `config/test.exs` sets 1700x1000.
* **A mouse down and up at a point is not a click.** Use the driver's own click with a `position`, which carries the click count the page listens for.
* A category or option that is not found must FAIL. The node version swallowed a miss with a catch that did nothing, so a run where the river button had been renamed built a dry map and then asserted about water on it.

## The checklist

Before saying a change covered by this document is done, walk this and state the evidence for each
item. "I followed the framework" without per-item evidence is the failure this exists to stop.

1. Does the change have a unit test in `mix test`, positive and negative paths?
2. Does it have a scenario in `test/e2e`, driven through the UI with real user actions?
3. Was the scenario run against the code BEFORE the fix, and did it fail there? Say so.
4. Can the scenario fail at all? Check it for the three shapes above.
5. Does the scenario assert on the data the app holds, and on the row after a save, not only on a picture?
6. For anything visual applying to a FAMILY of things (tiles, species, variants), does the evidence cover EVERY member? Build the sheet that renders all of them and look at it.
7. Does `bin/e2e` pass, and `mix test` pass?
8. Which items could you NOT verify? Say which, rather than leaving them to be found.

The user's own look at the running app is the only "done" for anything visual. A green suite is not a
verdict on how it looks.

## Scenarios still to build

Written down so the gap is a list rather than a surprise. Ordered by what has no real coverage
anywhere and matters most.

1. Stacking and height: place a tile on an occupied cell and it stacks by the lower tile's real height; `act_as_tile` on a flat road raises what stands on it.
2. Undo and redo: remove a tile, press ctrl+z, it comes back.
3. Collision for everything that is not water: buildings, trunks, unit footprints, built against reloaded.
4. Camera rotation and picking at all four facings: click the top of a five-tall wall and get the wall.
5. The 2D and Top views: every scenario today reads ISO.
6. Art style switch: place a pine under emoji, toggle, it becomes the ascii pine.
7. Selection editing: marquee, copy, paste with levels and collision intact.
8. Combat, abilities, inventory, quests, triggers: an entire area with no browser coverage.
9. Animation playback, not just survival: a fountain's jets out of sync, a lamp lighting at night.
10. No navy holes through the ground, and the player view range clipping the map body at its ring.
11. The editor panels, beyond the slider limits.
12. Generation beyond woodland and city: cave, temple, meadow, jungle, arena, regions, pathways.
