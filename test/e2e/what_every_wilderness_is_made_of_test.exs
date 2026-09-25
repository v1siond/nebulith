defmodule Nebulith.E2E.WhatEveryWildernessIsMadeOfTest do
  @moduledoc """
  EVERY WILDERNESS, BUILT, AND WHAT EACH ONE ACTUALLY PUT ON THE GROUND.

  `docs/FRAMEWORKS.md`: *"For anything visual that applies to a FAMILY of things, the evidence covers EVERY
  member. Build the sheet that renders all of them at a size you can judge, and look at it."* The eleven
  wilderness presets are such a family, and every report in this batch is about one of them looking wrong.

  The border seal is the case in point. It is ONE rule that runs on all eleven, so changing what a bare
  place is shut with has to be judged on all eleven and not on the one that was reported.

  It asserts two things and prints the rest. A measurement that fails on a judgement call is a measurement
  nobody takes, but a border that came open or a grey cube that came back are facts, not judgements.
  """
  use Nebulith.E2ECase, async: false

  @moduletag :e2e
  @moduletag :phase8
  @moduletag timeout: 3_600_000

  alias Nebulith.E2E.GeneratePanel

  @size %{cols: 40, rows: 40}

  setup context do
    context
    |> Elixir.Map.put(:map, @size)
    |> a_signed_in_editor()
  end

  test "every wilderness builds, keeps its border shut, and stands no grey cube in it", %{
    session: session,
    map: map
  } do
    presets = wildernesses()

    refute presets == [], "the catalog serves no wilderness at all, so there is nothing to sweep"

    rows = for preset <- presets, do: measure(session, map, preset)

    IO.puts("\n  WHAT EVERY WILDERNESS IS MADE OF\n")

    for row <- rows do
      IO.puts("""
        #{row.preset}: #{row.tiles} tiles, ground reaches #{row.high}
          border      #{row.reached} of #{row.ring} edge cells can be walked to, #{row.raised} standing above zero
          walked    #{row.walked} cells of #{row.cells}
          water       #{row.water} cells
          top labels  #{row.top}
          got out at  #{row.openings} opening(s): #{holes_line(row.holes)}
      """)
    end

    # WHERE THE WALK GETS OUT, not how many cells wide that is.
    #
    # This counted reachable EDGE CELLS against a quarter of the ring, and both halves of that were wrong.
    # A gate is `pathWidth` cells across, so one honest opening counts three times: measured on volcanic,
    # 20 to 40 reachable cells that resolve to four paved gate lanes and a couple of river mouths, failing a
    # ceiling of 39 on some seeds and passing on others. A gate is not a defect and a threshold that a legal
    # map crosses on half its seeds is not a gate, it is a coin toss. The same count would also pass a map
    # with one bare cell open in its border, which IS the defect the rule exists to catch.
    #
    # So the rule is asked directly, in two halves, and neither needs a threshold:
    #
    #   1. EVERY way out is a way, or water. A paved cell is a gate and a wet one is a river mouth the band
    #      closed over; anything else is bare ground you can stroll out across.
    #   2. There are a HANDFUL of openings, counted as contiguous runs around the ring rather than as cells.
    blind = for row <- rows, row.gates_known == 0, do: row.preset

    assert blind == [],
           "#{length(blind)} wilderness published no gate cells, so the check below cannot tell a gate " <>
             "from a hole and would pass either way: #{inspect(blind)}"

    bare =
      for row <- rows,
          row.bare != [],
          do: "#{row.preset} is open on bare ground at:\n    " <> Enum.join(row.bare, "\n    ")

    assert bare == [],
           """
           #{length(bare)} wilderness lets you walk off it over open ground. A border opens at its gates and
           at nothing else, so every edge cell a walk arrives at has to be a way or water:
             #{Enum.join(bare, "\n  ")}
           """

    # A generator serves a handful of pathways and each opens one gate. Eight is already past any exit count
    # the catalog offers, so it is the ceiling on OPENINGS, where the old number was a ceiling on cells.
    caved =
      for row <- rows,
          row.openings > 8,
          do: "#{row.preset} (#{row.openings} openings across #{row.reached} cells)"

    assert caved == [],
           """
           #{length(caved)} wilderness is open in more places than it has gates:
             #{Enum.join(caved, "\n  ")}
           """

    cubed = for row <- rows, row.rocks > 0, do: "#{row.preset} (#{row.rocks})"

    assert cubed == [],
           """
           #{length(cubed)} wilderness still stands grey rock cubes along its border. Elevation is the
           ground's height (SPEC A2), not a block placed on it:
             #{Enum.join(cubed, "\n  ")}
           """

    # AND THE WALK ACTUALLY WENT SOMEWHERE. A flood that never left its seed reports a sealed border for a map
    # it never looked at, which is the shape of a measurement that cannot fail.
    unwalked = for row <- rows, row.walked * 5 < row.cells, do: "#{row.preset} (#{row.walked}/#{row.cells})"

    assert unwalked == [],
           """
           #{length(unwalked)} wilderness could not be walked across, so its border reading means nothing:
             #{Enum.join(unwalked, "\n  ")}
           """

    # A BIOME THAT NAMES ITS OWN GROUND STANDS ON IT.
    #
    # Asked of the catalog, never of a list here: whichever regions state a `ground`, those labels have to be
    # what the built map is made of. A region stating a sand TONE over the season's meadow grass is grass in a
    # sand colour, which is the whole of *"the beach forest no longer looks like beach forest"*.
    wrong_ground =
      for row <- rows,
          named = named_grounds(row.preset),
          named != [],
          missing = named -- row.grounds,
          missing != [],
          do: "#{row.preset} names #{inspect(named)} and stands on #{inspect(row.grounds)}"

    assert wrong_ground == [],
           """
           #{length(wrong_ground)} wilderness states a ground of its own and did not put it down:
             #{Enum.join(wrong_ground, "\n  ")}
           """

    built = for row <- rows, row.tiles > 100, do: row.preset

    assert length(built) == length(presets),
           "only #{length(built)} of #{length(presets)} wildernesses put anything down, so the rest of " <>
             "this proves nothing: #{inspect(presets -- built)}"
  end

  # WHAT IS STANDING IN THE CELLS THE WALK GOT OUT THROUGH. Printed for every preset, not only a failing one:
  # a border that leaks is answered by knowing whether the hole is bare ground, a way, or water, and asking
  # that question only on a red run means reproducing the run first.
  defp holes_line([]), do: "nowhere"

  defp holes_line(holes) do
    Enum.map_join(holes, ", ", &"#{&1["cell"]} h#{&1["height"]} #{&1["stack"]}")
  end

  # WHICH GROUND TILES THIS WILDERNESS'S OWN REGIONS NAME, from the catalog. Empty for a biome that names
  # none, which keeps the season's ground and is checked by nothing here.
  defp named_grounds(preset) do
    for row <- Nebulith.Catalog.GeneratorSource.generators(),
        row.category == "wilderness",
        row.name == preset,
        region <- row.config["subZones"] || [],
        # …EXCEPT A REGION THAT FLOODS. One that states `pools` is under water by the time the map is built,
        # so its ground is correctly not on it: the desert's `oasis` is a pool, and demanding its ground
        # appear is demanding the oasis be dry.
        region["pools"] in [nil, 0],
        ground = region["ground"],
        is_binary(ground),
        uniq: true,
        do: ground
  end

  # WHICH WILDERNESSES EXIST, asked of the catalog rather than typed out here. A list typed into a test goes
  # stale the first time an environment is added or stops being wild, and it fails as "the button is
  # missing", which reads like a defect in the panel.
  defp wildernesses do
    for row <- Nebulith.Catalog.GeneratorSource.generators(),
        row.category == "wilderness",
        do: row.name
  end

  # ONE PRESET, BUILT ON A FRESH MAP, then read back off the grid the page holds.
  defp measure(session, map, preset) do
    session =
      session
      |> Editor.open(map.id)
      |> GeneratePanel.choose_category("wilderness")
      |> GeneratePanel.choose_preset(preset)
      |> GeneratePanel.build()

    Browser.wait_until(
      session,
      &(Canvas.tile_count(&1) > 0),
      "#{preset} to put something on the map",
      timeout: 240_000
    )

    tiles = Canvas.tiles(session)
    labels = for t <- tiles, l = t["label"] || t["tileKey"], is_binary(l), do: l

    edge = reachable_edge(session)

    %{
      preset: preset,
      tiles: length(tiles),
      rocks: Enum.count(labels, &(&1 in ~w(cliff_face rock_face))),
      water: Enum.count(labels, &String.starts_with?(&1, "water")),
      grounds: Enum.uniq(labels),
      reached: edge["reached"],
      walked: edge["walked"],
      cells: edge["cells"],
      ring: edge["ring"],
      raised: edge["raised"],
      high: edge["high"],
      holes: edge["holes"] || [],
      openings: edge["openings"],
      gates_known: edge["gatesKnown"] || 0,
      bare: edge["bare"] || [],
      top: top_labels(labels)
    }
  end

  @doc false
  # CAN YOU GET OUT ANYWHERE BUT A GATE? That is what the border rule actually says, and counting how many
  # ring cells stop you is not it: with a two-deep band the outer row can be walkable and still unreachable,
  # because the row inside it is shut. So this walks the map the way a person does, from the middle outward
  # over what is not solid, and reports which EDGE cells that walk arrives at.
  defp reachable_edge(session) do
    Browser.js(session, """
    (() => {
      const g = window.__nebulithGrid
      if (!g) return null
      let ring = 0, raised = 0, high = 0
      for (let row = 0; row < g.rows; row++) {
        for (let col = 0; col < g.cols; col++) {
          const h = g.getHeight(col, row)
          if (h > high) high = h
          if (col !== 0 && row !== 0 && col !== g.cols - 1 && row !== g.rows - 1) continue
          ring++
          if (h > 0) raised++
        }
      }
      // FROM THE MIDDLE, over everything that does not stop you.
      const seen = new Set()
      const queue = []
      const push = (c, r) => {
        if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return
        const key = c + ',' + r
        if (seen.has(key) || g.isBlocked(c, r)) return
        seen.add(key)
        queue.push([c, r])
      }
      // FROM SOMEWHERE YOU CAN ACTUALLY STAND. Seeding the exact middle is not safe: on a beach the middle
      // is water, the flood starts nowhere, and the map reports a perfectly sealed border it never walked.
      // So the seed is the nearest walkable cell to the middle, searched outward.
      const midCol = Math.floor(g.cols / 2), midRow = Math.floor(g.rows / 2)
      let seeded = false
      for (let ring = 0; ring < Math.max(g.cols, g.rows) && !seeded; ring++) {
        for (let dc = -ring; dc <= ring && !seeded; dc++) {
          for (let dr = -ring; dr <= ring && !seeded; dr++) {
            if (Math.max(Math.abs(dc), Math.abs(dr)) !== ring) continue
            const c = midCol + dc, r = midRow + dr
            if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) continue
            if (g.isBlocked(c, r)) continue
            push(c, r)
            seeded = true
          }
        }
      }
      for (let i = 0; i < queue.length; i++) {
        const [c, r] = queue[i]
        push(c + 1, r); push(c - 1, r); push(c, r + 1); push(c, r - 1)
      }
      // …AND WHAT IS STANDING IN THE ONES IT REACHED. A count says a border leaks; it does not say whether
      // the hole is bare ground the seal skipped, a way it spared, or water it could not close. Naming the
      // cells is the difference between a failure you can act on and one you have to reproduce first.
      // EVERY EDGE CELL THE WALK ARRIVED AT, with what is standing in it.
      const gates = new Set(window.__gateCells ?? [])
      const out = []
      for (const key of seen) {
        const [c, r] = key.split(',').map(Number)
        if (c !== 0 && r !== 0 && c !== g.cols - 1 && r !== g.rows - 1) continue
        const here = (g.assets ?? []).filter(a => a.col === c && a.row === r)
        const labels = here.map(a => a.label ?? a.tileKey ?? a.type)
        out.push({
          col: c,
          row: r,
          cell: key,
          height: g.getHeight(c, r),
          stack: labels.join('+') || 'nothing',
          // A GATE, ASKED OF THE MAP. This classified a way by its LABEL, a list of paved-looking prefixes
          // written down here, and a meadow's gate lanes are bare grass: six of them came back as holes in a
          // border that was doing exactly what it should. `__gateCells` is the generator's own gate list,
          // published by `applyStage`, so the question goes to the map instead of to a guess.
          gate: gates.has(key),
          // …and a river MOUTH is water, which the band closes over rather than counting as a way out.
          wet: labels.some(l => String(l).startsWith('water') || String(l).startsWith('lava')),
        })
      }

      // HOW MANY OPENINGS, not how many cells. A gate is `pathWidth` cells across, so counting cells counts
      // one opening three times and a map with four honest gates reads as twelve holes. Contiguous edge
      // cells are ONE opening, walked around the ring in order.
      const onRing = new Set(out.map(o => o.cell))
      const ring_path = []
      for (let c = 0; c < g.cols; c++) ring_path.push([c, 0])
      for (let r = 1; r < g.rows; r++) ring_path.push([g.cols - 1, r])
      for (let c = g.cols - 2; c >= 0; c--) ring_path.push([c, g.rows - 1])
      for (let r = g.rows - 2; r > 0; r--) ring_path.push([0, r])
      const open = ring_path.map(([c, r]) => onRing.has(c + ',' + r))
      let openings = 0
      for (let i = 0; i < open.length; i++) {
        const prev = open[(i - 1 + open.length) % open.length]
        if (open[i] && !prev) openings++
      }
      if (openings === 0 && open.every(Boolean)) openings = 1

      return {
        reached: out.length,
        openings,
        gatesKnown: gates.size,
        bare: out.filter(o => !o.gate && !o.wet).map(o => o.cell + ' h' + o.height + ' ' + o.stack),
        holes: out.slice(0, 12),
        ring, raised, high, walked: seen.size, cells: g.cols * g.rows,
      }
    })()
    """) || %{"reached" => 0, "ring" => 0, "raised" => 0, "high" => 0}
  end

  # THE SIX IT PUT DOWN MOST, which is the fastest way to see a biome that has lost its own look.
  defp top_labels(labels) do
    labels
    |> Enum.frequencies()
    |> Enum.sort_by(&(-elem(&1, 1)))
    |> Enum.take(6)
    |> Enum.map_join(", ", fn {label, n} -> "#{label} #{n}" end)
  end
end
