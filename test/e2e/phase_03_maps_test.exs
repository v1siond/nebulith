defmodule Nebulith.E2E.Phase03MapsTest do
  @moduledoc """
  PHASE 3, GATE 1: a map round-trips. Save, reload, every cell and every setting identical.

  The context round-tripping in Elixir and the API round-tripping over HTTP are both true, and neither
  is the claim that matters to a person. This is the one that does: author on the real page, save,
  reload, and get back what was authored, out of `cells` and `cell_tiles` rather than a JSON blob.

  ## Why the GRID is compared, and not the payload

  A gate that compares the API's JSON against what was sent passes on a map that renders wrong,
  because the JSON is fine. The reported defect was "the z-width is not applied on load, but if I
  modify any of the values it changes correctly", and that "but" is the whole shape of it: the value is
  in the database, the editor can act on it, and only the first draw after a load is wrong.

  So what is compared is the GRID the engine is holding before the save against the grid it is holding
  after the reload, which is the thing the renderer actually reads.

  ## Why every field, and not the geometry

  An earlier shape of this compared size and span only. It passed on a map where the ornaments came
  back as boxes and the road markings came back full size, because what those two lose is `settings`
  and `pose`. A gate that checks a subset reports on that subset and reads as "the map round trips" to
  anybody skimming it.
  """
  use Nebulith.E2ECase, async: false

  @moduletag :e2e
  @moduletag :phase3

  alias Nebulith.E2E.GeneratePanel

  @cols 24
  @rows 24

  setup context do
    a_signed_in_editor(Elixir.Map.put(context, :map, %{cols: @cols, rows: @rows}))
  end

  describe "gate 1: a map round-trips" do
    test "authored on the page, saved to rows, reloaded identical, re-saved identical",
         %{session: session, map: template} do
      map_id = resolved_map_id(session, template.id)

      session = GeneratePanel.build_world(session, "city", "Woodland city")

      # PLANT WHAT MUST SURVIVE, rather than hoping the generator planted it. The animation check used
      # to assert that at least one animated tile made the round trip, and whether a woodland contains
      # a fountain is up to the generator that day: it passed for a week and then failed on a map with
      # no moving water in it. A gate that depends on what the dice rolled is testing the dice.
      plant_a_fountain(session)

      before = shape_of(session)

      assert before.total > 0, "nothing was authored, so this run proves nothing"
      assert before.animated > 0, "the fountain was not planted, so animation proves nothing"

      session = Editor.save(session, template.id)
      saved = rows_of(session, map_id)

      assert saved.cells >= 100,
             "the save wrote #{saved.cells} cells, so it did not go to the tables"

      assert saved.tiles >= 100, "the save wrote #{saved.tiles} tiles"

      # A REAL RELOAD. Re-rendering from the objects still in memory would prove nothing about loading.
      session = Editor.open(session, template.id)
      Canvas.wait_for_tiles(session, 1, timeout: 60_000)

      reloaded = rows_of(session, map_id)

      assert reloaded == saved,
             "a reload changed the map: #{inspect(saved)} became #{inspect(reloaded)}"

      # And saving what was just reloaded changes nothing either, which is the round trip closing.
      session = Editor.save(session, template.id)

      assert rows_of(session, map_id) == reloaded,
             "a second save changed the map: #{inspect(reloaded)} became #{inspect(rows_of(session, map_id))}"

      assert saved.cols == @cols and saved.rows == @rows,
             "the grid's own size did not travel: #{saved.cols}x#{saved.rows}"
    end

    test "every tile comes back the shape it went in", %{session: session, map: template} do
      session = GeneratePanel.build_world(session, "city", "Woodland city")
      plant_a_fountain(session)

      before = shape_of(session)
      assert before.total > 0, "nothing was authored, so this run proves nothing"

      session = session |> Editor.save(template.id) |> Editor.open(template.id)
      Canvas.wait_for_tiles(session, 1, timeout: 60_000)
      later = shape_of(session)

      assert later.total == before.total,
             "the map came back with #{later.total} tiles, not #{before.total}"

      # A floor is a tile like any other, but the grid has to know which tiles are floors to answer
      # "what is the ground here", and that is carried by the placement's own type rather than by any
      # column. Losing it is invisible in the payload.
      assert later.floors == before.floors,
             "the ground did not come back as ground: #{before.floors} floors saved, #{later.floors} loaded"

      assert later.spanning == before.spanning,
             "z-width was not applied on load: #{before.spanning} spanning saved, #{later.spanning} loaded"

      assert later.single == before.single,
             "a tile drawn as one billboard came back painted on every face: " <>
               "#{before.single} single saved, #{later.single} loaded"

      assert later.animated == before.animated,
             "an animation was lost: #{before.animated} animated saved, #{later.animated} loaded"

      assert later.posed == before.posed,
             "a tile nudged or resized inside its cell moved: " <>
               "#{before.posed} posed saved, #{later.posed} loaded"

      # Both sides, side by side. A one-sided dump of what was saved cannot tell a lost value from a
      # gained one, and the two call for opposite fixes.
      assert later.shapes == before.shapes,
             "tiles changed shape across the save:" <> diff(before, later)
    end
  end

  # ── what the engine is holding ────────────────────────────────────────────────────────────────

  # Every field that decides a DRAW, in a FIXED order. JSON.stringify preserves insertion order, so
  # the same four reaches written in a different sequence compared unequal and the gate reported a
  # round-trip failure on a tile that round-tripped perfectly.
  @shape_js """
  (() => {
    const grid = window.__nebulithGrid
    if (!grid) return null
    const shape = a => [
      a.col, a.row, a.label ?? a.tileKey ?? a.type, a.heightLevel ?? 0,
      a.height, a.width, a.depth,
      a.spanForward, a.spanAxis, a.spanBack, a.spanPerp, a.spanPerpBack,
      ['left-up', 'right-up', 'left-down', 'right-down'].map(d => a.thickness?.[d] ?? '-').join(','),
      a.settings?.display ?? '-', a.settings?.transparent ?? '-',
      a.settings?.fadeNear ?? '-', a.settings?.cutawayRoof ?? '-', a.settings?.actAsTile ?? '-',
      JSON.stringify({ dx: a.pose?.dx ?? 0, dy: a.pose?.dy ?? 0, rot: a.pose?.rot ?? 0, flip: a.pose?.flip === true, scale: a.pose?.scale ?? 1 }),
      a.shape ?? '-', a.zIndex ?? '-', a.opacity ?? '-', a.brightness ?? '-',
      a.animations ? JSON.stringify(a.animations) : '-', a.placedAt ?? '-',
      a.color ?? '-', a.sideColor ?? '-',
    ].join('|')
    return {
      total: grid.assets.length,
      floors: grid.assets.filter(a => a.type === 'floor').length,
      spanning: grid.assets.filter(a => (a.spanForward ?? 1) > 1).length,
      single: grid.assets.filter(a => a.settings?.display === 'single').length,
      posed: grid.assets.filter(a => a.pose && ((a.pose.dx ?? 0) || (a.pose.dy ?? 0) || (a.pose.rot ?? 0) || a.pose.flip === true || (a.pose.scale ?? 1) !== 1)).length,
      animated: grid.assets.filter(a => a.animations?.length).length,
      shapes: grid.assets.map(shape).sort(),
    }
  })()
  """

  defp shape_of(session) do
    raw = Browser.js(session, @shape_js) || %{}

    %{
      total: raw["total"] || 0,
      floors: raw["floors"] || 0,
      spanning: raw["spanning"] || 0,
      single: raw["single"] || 0,
      posed: raw["posed"] || 0,
      animated: raw["animated"] || 0,
      shapes: raw["shapes"] || []
    }
  end

  defp plant_a_fountain(session) do
    Browser.js(session, """
    (() => {
      const grid = window.__nebulithGrid
      const stamp = window.__nebulithStamp
      if (stamp && grid) stamp(grid, 'fountain', 2, 2, 'spring', 0, 0, {}, 0)
      return true
    })()
    """)

    Browser.wait_until(
      session,
      fn s -> shape_of(s).animated > 0 end,
      "the fountain to land on the map",
      timeout: 20_000
    )
  end

  # ── what the rows hold ────────────────────────────────────────────────────────────────────────

  defp resolved_map_id(session, template_id) do
    id =
      Browser.js(session, """
      fetch('/api/maps/for_template/#{template_id}')
        .then(r => r.ok ? r.json() : null)
        .then(b => b && b.data && b.data.map && b.data.map.id)
      """)

    assert is_binary(id), "the editor could not resolve a map for the template it has open"
    id
  end

  defp rows_of(session, map_id) do
    raw =
      Browser.js(session, """
      fetch('/api/maps/#{map_id}')
        .then(r => r.json())
        .then(b => ({
          cells: b.data.cells.length,
          tiles: b.data.cells.reduce((n, c) => n + c.tiles.length, 0),
          cols: b.data.grid.cols,
          rows: b.data.grid.rows,
        }))
      """) || %{}

    %{
      cells: raw["cells"] || 0,
      tiles: raw["tiles"] || 0,
      cols: raw["cols"],
      rows: raw["rows"]
    }
  end

  defp diff(before, later) do
    Enum.zip(before.shapes, later.shapes)
    |> Enum.reject(fn {a, b} -> a == b end)
    |> Enum.take(4)
    |> Enum.map_join("", fn {a, b} -> "\n    saved   #{a}\n    loaded  #{b}" end)
  end
end
