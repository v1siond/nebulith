defmodule Nebulith.E2E.SpecComplianceTest do
  @moduledoc """
  THE COMPLIANCE GATE `docs/SPEC.md` PROMISED AND DID NOT HAVE.

  Phase 3 withdrew its third gate and named what replaced it: *"What the gate was really guarding, that
  Depth is a SIZE and never a thickness, is covered by the thickness reaches being their own four columns,
  and `bin/e2e specCompliance` fails if `scaleZ` reappears on a placed tile."*

  There was no such test anywhere in the suite. A gate a plan promises and nobody wrote is worse than no
  gate, because the plan is then read as covered: the saguaro carried a bare `scaleZ` for as long as it has
  existed, drew as a 2 pixel line, and the thing that finally caught it was measuring a screenshot by hand.

      bin/e2e test/e2e/spec_compliance_test.exs

  `Nebulith.AThinTileSaysWhichWayTest` is the other half, on the catalogue. This half watches what actually
  reaches a map, because the catalogue being clean and the placement being clean are two facts: a stamp maps
  a cell onto a placement, and that mapping is exactly where a thickness turned into a size once already.

  ## SPEC's wording is not enough, and the gate says so rather than inheriting it

  Written literally, "fails if `scaleZ` reappears on a placed tile" cannot fail. Measured: putting the bare
  `scaleZ` back on every cactus bar and stamping the lot, this swept 2,000 placements and found none, because
  a cell's `scaleZ` is READ on the way through and written out as a thickness reach. The number never travels
  under that name, so the promised check would have watched the cactus collapse without a word.

  What DOES travel is the reach, and the defect is that reach having crossed itself: `reachGroundQuad` takes
  `hi` from one face and `lo = 1 - reach(opposite)`, and a bare `scaleZ` under a half puts `lo` above `hi` on
  both ground axes, which is a block with no span left. That is the gate with teeth, and the literal
  `scaleZ` check is kept beside it as a guard on a path that does not exist yet, declared as such.

  ## Every composition, not a sample

  The list comes from the running app, so an object added tomorrow is covered the day it is added, and an
  object that stops existing takes its own coverage with it.
  """
  use Nebulith.E2ECase, async: false

  @moduletag :e2e
  @moduletag timeout: 600_000

  # Room for every composition to stand apart, so nothing overlaps a neighbour and every one is its own
  # answer rather than a heap.
  @size %{cols: 60, rows: 60}
  @gap 4

  setup context do
    context
    |> Elixir.Map.put(:map, @size)
    |> a_signed_in_editor()
  end

  test "no placed tile has had its thinning cross itself, on a map holding every composition",
       %{session: session} do
    names = compositions(session)

    assert length(names) > 40,
           "the catalogue served #{length(names)} compositions, which is too few for this to be a sweep"

    stamp_every(session, names)

    collapsed =
      Browser.js(session, """
      (() => {
        const g = window.__nebulithGrid
        if (!g) return null
        // THE TWO GROUND AXES, each as the pair of opposing faces `reachGroundQuad` reads for it.
        //
        // DECLARED: this is a second copy of a fact `isoBlock.ts` owns, which is law 2, and it is here
        // knowingly. The check runs inside the page over the CDP wire and cannot import the module that
        // owns the pairing, and the alternative, asking the engine to expose it, would add a seam to the
        // product for a test's benefit. It is four strings and it is pinned by the test that made it fail,
        // so the day the pairing moves, this is the line that has to move with it.
        const AXES = [['right-down', 'left-up'], ['left-down', 'right-up']]
        const reachOf = (t, d) => {
          const v = t?.[d]
          return typeof v === 'number' && v > 0 && v < 1 ? v : 1
        }
        const seen = new Map()
        for (const a of g.assets ?? []) {
          const t = a.thickness
          if (!t) continue
          for (const [fwd, back] of AXES) {
            const hi = reachOf(t, fwd)
            const lo = 1 - reachOf(t, back)
            if (hi - lo >= 0.05) continue
            const key = (a.label ?? a.tileKey ?? a.type) + ' spans ' + lo.toFixed(2) + ' to ' + hi.toFixed(2)
            seen.set(key, (seen.get(key) ?? 0) + 1)
          }
        }
        return [...seen].map(([k, n]) => k + ' on ' + n + ' placement(s)')
      })()
      """)

    assert collapsed != nil, "the page held no grid, so this measured nothing"

    assert collapsed == [],
           """
           #{length(collapsed)} kind of placed tile has both sides of a ground axis pulled past each other,
           so it has no span left and draws as a line however tall it is:
             #{Enum.join(collapsed, "\n  ")}
           """
  end

  test "no placed tile carries scaleZ, which is SPEC's own wording", %{session: session} do
    # DECLARED: this one cannot fail on today's engine, and it is kept anyway. A cell's `scaleZ` is converted
    # to a reach on its way to a placement, so the name never travels; measured with the bare `scaleZ` put
    # back, this found none across 2,000 placements. It guards the day some path starts copying settings
    # through verbatim, and it is NOT evidence that anything is thin the right way. The test above is.
    stamp_every(session, compositions(session))

    offenders =
      Browser.js(session, """
      (() => {
        const g = window.__nebulithGrid
        if (!g) return null
        const seen = new Map()
        for (const a of g.assets ?? []) {
          // BOTH PLACES A PLACEMENT COULD BE CARRYING ONE: its own settings, and the untyped bag of served
          // columns this engine does not model, which exists precisely so an unmodelled column survives a
          // save and would therefore carry a `scaleZ` straight past a check that only read `settings`.
          const z = a.settings?.scaleZ ?? a.columns?.scaleZ
          if (z === undefined || z === null) continue
          const key = (a.label ?? a.tileKey ?? a.type) + ' scaleZ ' + z
          seen.set(key, (seen.get(key) ?? 0) + 1)
        }
        return [...seen].map(([k, n]) => k + ' on ' + n + ' placement(s)')
      })()
      """)

    assert offenders != nil, "the page held no grid, so this measured nothing"

    assert offenders == [],
           """
           #{length(offenders)} kind of placed tile reached the map carrying scaleZ. Depth is a SIZE and a
           thinning is a reach that names its direction, so a placement carrying scaleZ is the engine reading
           one number as both:
             #{Enum.join(offenders, "\n  ")}
           """
  end

  test "and the map it swept was actually full", %{session: session} do
    names = compositions(session)
    stamp_every(session, names)

    # A SWEEP OVER AN EMPTY MAP PASSES. That is the degenerate oracle this whole session turned on, so the
    # sweep above states how much it looked at rather than trusting that it looked at anything.
    placed = Canvas.tile_count(session)

    assert placed > length(names),
           "the sweep ran over #{placed} placements for #{length(names)} compositions, so most of them " <>
             "never landed and it proved nothing about them"
  end

  # EVERY COMPOSITION, LAID OUT SO NONE SITS ON ANOTHER.
  defp stamp_every(session, names) do
    for {name, i} <- Enum.with_index(names) do
      col = 2 + rem(i * @gap, @size.cols - 4)
      row = 2 + div(i * @gap, @size.cols - 4) * @gap
      Browser.js(session, "window.__placeComposition(#{Jason.encode!(name)}, #{col}, #{row})")
    end

    Browser.wait_for_js(session, "(window.__nebulithGrid?.assets?.length ?? 0) > 0", "the objects to land")
  end

  defp compositions(session) do
    Browser.js(session, """
    (async () => {
      const body = await (await fetch('/api/tilesets')).json()
      const comps = ((body.data || [])[0] || {}).compositions || {}
      return Object.keys(comps).sort()
    })()
    """) || []
  end
end
