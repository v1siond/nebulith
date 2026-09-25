defmodule Nebulith.E2E.AMountainIsHighGroundTest do
  @moduledoc """
  A MOUNTAIN CLIMBS. IT IS NOT A ROW OF GREY BLOCKS.

  The report, on a generated mountain forest: *"image 281 shows a bunch of gray grenish blocks... if you
  want to do elevation, just increase height on terrain sections"*.

  ## What was measured before

  `sealMapEdge` shuts the map's border. Where nothing grows it shut the border with `cliff_face` props, one
  cube per cell, coloured from `zone_source.ex`'s `rockShades` (five mossy greys, `#5a5f55` and friends).
  On the mountain the `summit` band states `canopy: 0.05` against a `bareCanopy` of 0.10, and with a band
  layout the summit IS the map's top edge, so the whole top strip came out as a wall of grey-green cubes
  standing on top of the summit's own raised ground.

  The elevation was never the problem: `raiseRegions` already puts every band at the `level` it states, so
  the mountain already climbs from 0 at the foot to 4 at the summit, and `drawGridSkirt` already draws the
  step between two bands as a cliff. The cubes were a second, worse answer to a question the terrain had
  already answered.

  `docs/SPEC.md` A2: *"this is not two system, it's just one with two applications, there's height and
  height can be achieved by increasing it on a tile or stacking."* A border that needs shutting where nothing
  grows is shut by standing the ground up, which is the first application.
  """
  use Nebulith.E2ECase, async: false

  @moduletag :e2e
  @moduletag :phase8
  @moduletag timeout: 900_000

  alias Nebulith.E2E.GeneratePanel

  @size %{cols: 48, rows: 48}

  setup context do
    context
    |> Elixir.Map.put(:map, @size)
    |> a_signed_in_editor()
  end

  test "a generated mountain has no grey rock cubes, and still climbs", %{session: session} do
    session
    |> GeneratePanel.choose_category("wilderness")
    |> GeneratePanel.choose_preset("Mountain")
    |> GeneratePanel.build()

    Browser.wait_until(
      session,
      &(Canvas.tile_count(&1) > 0),
      "the mountain to put something on the map",
      timeout: 180_000
    )

    tiles = Canvas.tiles(session)

    rocks =
      for tile <- tiles,
          label = tile["label"] || tile["tileKey"],
          is_binary(label),
          label in ~w(cliff_face rock_face),
          do: label

    assert rocks == [],
           """
           #{length(rocks)} grey rock cube(s) are still standing on the mountain. Elevation is the ground's
           height, not a block placed on top of it (SPEC A2), and these are what the screenshot shows.
           """

    # …AND THE GROUND ACTUALLY CLIMBS, so this cannot pass by a generator that stopped raising anything.
    heights = Browser.js(session, "(window.__nebulithGrid?.height ?? []).flat()")

    assert is_list(heights) and heights != [], "the map served no per-cell height at all"

    reached = heights |> Enum.filter(&is_number(&1)) |> Enum.max(fn -> 0 end)

    assert reached >= 3,
           "the mountain's highest ground is #{reached} blocks up, so it is not climbing: the bands state " <>
             "levels 0 to 4 and `raiseRegions` is what writes them"
  end

  # BLOCKED ON PHASE 4, and failing on purpose until then, which is what this tag is for.
  #
  # A saved map carries no collision column: `docs/SPEC.md` §9 sends `settings.collision` to
  # `collision_boxes`, a table phase 4 creates. So what is solid is rebuilt on load by asking each ASSET, and
  # a border shut by the generator survives only if an asset carries it.
  #
  # MEASURED BOTH WAYS, on the same 48 x 48 mountain. With the rock cubes the seal used to stand: after a save
  # and a reload you can walk out of 156 of 156 edge cells. With the ground raised instead: 188 of 188. The
  # border has never survived a round trip, and taking the cubes out did not cause it. Live, both are shut:
  # 10 and 12 reachable edge cells respectively.
  @tag :awaiting_phase
  test "the mountain's border is still shut after a save and a reload", %{session: session, map: map} do
    session
    |> GeneratePanel.choose_category("wilderness")
    |> GeneratePanel.choose_preset("Mountain")
    |> GeneratePanel.build()

    Browser.wait_until(
      session,
      &(Canvas.tile_count(&1) > 0),
      "the mountain to put something on the map",
      timeout: 180_000
    )

    live = reachable_edge(session)

    # THE ROUND TRIP. A saved map carries no collision column, so what is solid is rebuilt by asking each
    # asset. The seal used to be a rock cube, which is an asset and answered; it is raised ground now, and a
    # placement's own collision box has no column until phase 4 (`collision_boxes`). So this asks the only
    # question that matters: after a save and a reload, can you still not walk out?
    session = Nebulith.E2E.Editor.save_and_reopen(session, map.id)

    after_reload = reachable_edge(session)

    assert after_reload["walked"] * 5 > after_reload["cells"],
           "the reloaded mountain could not be walked across, so this reading means nothing: " <>
             inspect(after_reload)

    assert after_reload["reached"] * 4 <= after_reload["ring"],
           """
           After a save and a reload you can walk out of #{after_reload["reached"]} of the mountain's
           #{after_reload["ring"]} edge cells, against #{live["reached"]} before the save. The border seal is
           not surviving the round trip.
           """
  end

  test "the mountain's border is still shut, and shut by the ground", %{session: session} do
    session
    |> GeneratePanel.choose_category("wilderness")
    |> GeneratePanel.choose_preset("Mountain")
    |> GeneratePanel.build()

    Browser.wait_until(
      session,
      &(Canvas.tile_count(&1) > 0),
      "the mountain to put something on the map",
      timeout: 180_000
    )

    edge = reachable_edge(session)

    assert edge["raised"] > 0,
           "no border cell of the mountain stands above zero, so nothing was raised at all"

    assert edge["reached"] * 4 <= edge["ring"],
           """
           you can walk out of #{edge["reached"]} of the mountain's #{edge["ring"]} edge cells, so taking the
           rock cubes out left the border open instead of standing it up.
           """
  end

  # CAN YOU GET OUT ANYWHERE BUT A GATE? Counting how many ring cells stop you is not the question: with a
  # two-deep band the outer row can be walkable and still unreachable. So this walks the map the way a person
  # does and reports which EDGE cells that walk arrives at.
  defp reachable_edge(session) do
    Browser.js(session, """
    (() => {
      const g = window.__nebulithGrid
      if (!g) return null
      let ring = 0, raised = 0
      for (let row = 0; row < g.rows; row++) {
        for (let col = 0; col < g.cols; col++) {
          if (col !== 0 && row !== 0 && col !== g.cols - 1 && row !== g.rows - 1) continue
          ring++
          if (g.getHeight(col, row) > 0) raised++
        }
      }
      const seen = new Set()
      const queue = []
      const push = (c, r) => {
        if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return
        const key = c + ',' + r
        if (seen.has(key) || g.isBlocked(c, r)) return
        seen.add(key)
        queue.push([c, r])
      }
      const midCol = Math.floor(g.cols / 2), midRow = Math.floor(g.rows / 2)
      let seeded = false
      for (let ringN = 0; ringN < Math.max(g.cols, g.rows) && !seeded; ringN++) {
        for (let dc = -ringN; dc <= ringN && !seeded; dc++) {
          for (let dr = -ringN; dr <= ringN && !seeded; dr++) {
            if (Math.max(Math.abs(dc), Math.abs(dr)) !== ringN) continue
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
      let reached = 0
      for (const key of seen) {
        const [c, r] = key.split(',').map(Number)
        if (c === 0 || r === 0 || c === g.cols - 1 || r === g.rows - 1) reached++
      }
      return { reached, ring, raised, walked: seen.size, cells: g.cols * g.rows }
    })()
    """)
  end
end
