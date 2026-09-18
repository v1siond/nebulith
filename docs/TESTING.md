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
