# Testing

How this project is tested, and what is not accepted as a test.

Written 2026-09-18 after a suite of 4,877 node tests was green while the map had trees in its exits, twice in
one session. The rule below is not a preference, it is a standing instruction.

---

## 1. The two layers, and both are mandatory

Every feature gets BOTH. Not one, not "the important one".

| layer | what it is | where it runs |
|---|---|---|
| **Backend unit tests** | Elixir, `mix test`. Every module, every branch, positive and negative. | `test/` |
| **Frontend end to end** | Playwright driving the REAL page. Click through, use the feature the way a person uses it, assert the app behaved. | `test/e2e/` |

> *"WE ALWAYS DO FULL BACKEND UNIT TEST, WE ALWAYS DO REAL FRONTEND END TO END TESTING."*

An end to end test is a CLICK-THROUGH. It opens the page, picks the things a person picks, presses the
buttons a person presses, and then asserts. Anything that calls an engine function directly and inspects the
object it returns is not a frontend test, whatever it is written in.

## 2. Jest is not a frontend test tool here

> *"JEST IS ONLY USEFUL WHEN WE WANNA TEST NODEJS BACKENDS, IS NOT GOOD FOR FRONTEND WHATSOEVER"*

It is out. Not reduced, not kept for the tricky parts: out. The reason is not taste, it is that a node test
supplies its own inputs, so it tests the app you IMAGINED rather than the one that runs. Two measured failures
from one session:

- The exit tests built stages without `options.pathways`. `resolvePathways` returns null without it, so
  `stage.routes` was null and every assertion sat behind `if (!stage.routes) continue`. **24 green cases
  asserting nothing**, while the reported defect was live on screen.
- Rewritten to assert on `stage.pathwayCells`, they passed on the BROKEN code too, because `sealMapEdge`
  deletes a border cell from that set at the moment it plants a tree on it. The witness was edited by the
  defect.

Neither is possible when the browser is producing the inputs.

## 3. The canvas, and what you assert instead

The map is a `<canvas>`, so there is no DOM node for a tree and no `assert_has("tree")`. That does not make
the page untestable, it decides WHAT you assert:

> *"my expectation is that we just use the UI and validate that the data is correct, as simple as that"*

So: **drive the UI, assert the data the UI produced.** The test database is right there, so read the row.

    "go to X, select Y, pick river type, click generate world, click save" -> expect xxxx

```elixir
test "a way out is the served width and nothing stands in it", %{conn: conn} do
  conn
  |> visit("/templates")
  |> click("Wilderness")
  |> click("Woodland")
  |> select("Pathways", option: "2")
  |> click_button("Generate world")
  |> click_button("Save")

  template = Repo.one!(from t in Template, order_by: [desc: t.updatedAt], limit: 1)
  assert opening_width(template.groundData) == 3
  assert plants_in_opening(template.assetsData) == []
end
```

Everything after the last click is a plain data assertion in Elixir against the row the page wrote. No
reconstruction of inputs, and the test says what the bug report says.

## 3b. Running the end-to-end layer

It is Elixir. `PhoenixTest.Playwright` drives a real browser from inside `mix test`, against the TEST
endpoint (port 4002, `nebulith_test`), inside the Ecto sandbox. The cases live in `test/e2e/`.

**THE TEST DATABASE IS THE POINT.** The first version of this layer was Node scripts pointed at the DEV
server on 6328, and a run that clicked Save overwrote the only saved map in the dev database. His words:

> *"tests should always use the test database, if you wanted to use my level, you could've fetched the data
> and seeded into the test"*

So a case seeds what it needs (`TileSource.seed()`, `GeneratorSource.seed()`) into its own transaction, and
nothing it clicks can reach real data.

### The browser

This machine is Ubuntu 20.04 (focal). Playwright stopped shipping a chromium for focal, and the Elixir
driver needs 1.63 or newer, so the local driver cannot run here. The browser runs in a container instead and
is reached over a websocket, which is the route the package documents for exactly this case.

```sh
docker run -d --rm -p 3111:3111 --name nebulith-pw --init \
  --workdir /home/pwuser --user pwuser mcr.microsoft.com/playwright:v1.63.0-noble \
  /bin/sh -c "npx -y playwright@1.63.0 run-server --port 3111 --host 0.0.0.0"

GW=$(ip route | awk '/default/{print $3}')
MYIP=$(ip -4 addr show eth0 | awk '/inet /{print $2}' | cut -d/ -f1)
PLAYWRIGHT_WS_ENDPOINT="ws://$GW:3111/" PHOENIX_TEST_BASE_URL="http://$MYIP:4002" mix test test/e2e
```

Two addresses because the browser is on the other side of a network boundary: the test reaches the SERVER at
the docker gateway, and the browser reaches the APP at this machine's own address (which is why the test
endpoint binds 0.0.0.0 rather than loopback).

Without `PLAYWRIGHT_WS_ENDPOINT` the `:e2e` tag is excluded and `mix test` runs the unit suite as usual, so
the suite never depends on a browser being up.

### Two traps, both cost a session

- **`PhoenixTest.Playwright.evaluate/2` returns the CONN, not the value**, so it can be piped. Reading its
  result as the answer yields a struct: every check silently false, every measurement silently zero, which is
  the degenerate oracle again. `PlaywrightEx.Frame.evaluate(frame_id, expression: js)` returns `{:ok, value}`.
- **Wait on a signal, not a timer.** The editor re-renders when the fetched generator catalog lands, which
  detaches whatever input is being typed into. `window.__generatorsReady` exists for this.

## 4. What makes a test real

1. **It fails on the old code.** Run every new check against the code BEFORE the fix. A gate that cannot
   fail is decoration. This is not optional and it is the step that catches everything in §2.
2. **It asserts the thing exists**, not a derived string a fallback can manufacture.
3. **The witness is not something the defect can edit.** Ask the saved row or the painted ground, never a
   working set the failing pass mutates.
4. **No case may silently skip.** A `continue` or an `if (!x) return` inside a test body is a case that
   passes having asserted nothing. Raise instead.
5. **A family is tested across every member**, not the one member you looked at.
6. **Never weaken a test to make it pass.** If the thing it defended was removed, delete it and say why.

## 5. Checklist

Before calling any feature done:

1. Backend: `mix test` covers the new module, both the working path and the failing one.
2. Frontend: an E2E case exists that clicks through the feature exactly as a person would.
3. The E2E case was run against the pre-fix code and FAILED there.
4. No node/Jest test was added for anything that touches the page.
5. The assertion reads saved data or served data, never an internal set the pass under test writes to.
