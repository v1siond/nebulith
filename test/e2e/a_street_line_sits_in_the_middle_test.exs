defmodule Nebulith.E2E.AStreetLineSitsInTheMiddleTest do
  @moduledoc """
  A CENTRE LINE IS IN THE CENTRE.

      pathways on cities should always be odd numbers, in order to put lines in the center

  Reported twice. The marked street was four cells across, and four has no middle: `markAcross` picks
  `from + ((run - 1) >> 1)`, which on a run of four is one cell in, leaving one cell of carriageway on
  one side and two on the other. The line could only ever be drawn off centre, and it looked exactly
  like that.

  ## Why this is measured on a built city and not on the served width

  `AMarkedStreetHasAMiddleTest` gates the data: the width is odd and the migration moves an existing
  database to it. That is the cause. This is the EFFECT, and it is the half that was wrong on his
  machine while every data check was green, because the migration read a key no row carries and so
  changed nothing.

  ## What it measures

  Every dash is a `road_marking_along_row` or `road_marking_along_col` tile, placed at the middle of
  one cross-section of carriageway. So from each dash this walks perpendicular to its own street,
  counting road cells until the road stops. Contiguity is the same relation the generator used to find
  the cross-section in the first place, so the two counts add up to that run, and equal counts is
  exactly what "the line is in the middle" means. A junction never enters into it: a run wider than
  the carriageway gets no line at all, which is what a junction looks like.
  """
  use Nebulith.E2ECase, async: false

  @moduletag :e2e
  @moduletag :phase8
  # Four world builds at 100x60, on a software rasteriser.
  @moduletag timeout: 900_000

  alias Nebulith.E2E.GeneratePanel

  # Wide enough to lay a street grid with real cross-sections in it. A small map builds a lane or two
  # and then the count of dashes is small enough that being right is luck.
  @size %{cols: 100, rows: 60}

  setup context do
    context
    |> Elixir.Map.put(:map, @size)
    |> a_signed_in_editor()
  end

  # HOW MANY CITIES. The complaint is about how OFTEN, not about one map: *"cities are still not
  # generating odd streets 100% of the"*. One generated city is one sample of a random process, and a
  # gate that takes one sample cannot answer a question about frequency. It caught this itself: the
  # single-city version passed twice and failed once, which says nothing about which of the two it is.
  @cities 4

  test "every dash down every city street has as much road one side as the other", %{
    session: session
  } do
    session = GeneratePanel.build_world(session, "city", "Woodland city")

    reports = Enum.map(1..@cities, fn n -> {n, inspect_city(session, n)} end)

    # EVERY `r` BELOW IS A REAL MAP, because `marks/1` insists on one. That guarantee is load bearing:
    # `nil > 0` is TRUE in Elixir, an atom sorting above a number, while `nil <= 20` is FALSE. So a read
    # that can come back nil, compared with those two operators, gives one crash and one check that
    # quietly passes. It did exactly that here before `marks/1` was made to wait for an answer.

    # THE SUBJECT FIRST. A sufficiency check asserted ahead of this one MASKS it: the first version
    # refused a city that laid 19 dashes against a floor of 20, and in doing so never reported whether
    # any of those 19 were off centre, which is the only thing this scenario exists to find out.
    crooked =
      for {n, r} <- reports, r["offCount"] > 0 do
        "city #{n}: #{r["offCount"]} of #{r["marks"]} dashes off centre (#{Enum.join(r["off"], "; ")})"
      end

    assert crooked == [],
           "a carriageway with no middle cell to put the line in, in #{length(crooked)} of " <>
             "#{@cities} cities. " <> Enum.join(crooked, " | ")

    # …AND THEN WHETHER THAT PASS MEANT ANYTHING. Across the whole sample, not per city: how many
    # marked streets one city happens to lay is the generator's business and varies honestly, so a
    # per-city floor is a number invented here that fails on legitimate variation. What must not happen
    # is a city with NO dashes counting as evidence, or a sample too small to say anything.
    silent = for {n, r} <- reports, r["marks"] == 0, do: "city #{n}"
    total = Enum.sum(for {_n, r} <- reports, do: r["marks"])

    assert silent == [],
           "#{Enum.join(silent, ", ")} laid no street markings at all, so it is not evidence that " <>
             "markings are centred. Either it built no marked street or the tile is named something else"

    assert total >= 100,
           "#{@cities} cities laid #{total} dashes between them, which is too small a sample to say " <>
             "a centre line is centred 100% of the time"
  end

  # The first city is already built; every one after it is a fresh press of Build, which is how a
  # person asks for another. Reported per city so a failure says whether it is every city or one.
  defp inspect_city(session, 1), do: marks(session, 1)

  defp inspect_city(session, n) do
    session |> GeneratePanel.build() |> marks(n)
  end

  # NEVER nil. A rebuild republishes the grid and re-fetches the catalog, so a read taken in the gap
  # comes back empty, and an empty read is not an answer about street markings. Waiting for a real one
  # is the difference between a scenario that reports the world and a scenario that reports its own
  # timing, and the comparisons above cannot tell those apart (see the note beside `thin`).
  defp marks(session, n) do
    Browser.wait_value(session, read_marks(), timeout: 30_000) ||
      flunk(
        "city #{n} never answered what its street markings are, so it was never inspected. " <>
          state_of(session)
      )
  end

  # WHAT IS ACTUALLY THERE when the read gives up. "No answer" is the symptom of a grid that never
  # came back, a grid that came back EMPTY, and a fetch that threw, and those are three different
  # bugs. A rebuild settling at zero assets is the same shape as the 100x100 world that builds nothing,
  # so this has to say which one it is rather than leave them indistinguishable.
  defp state_of(session) do
    Browser.js(session, """
    (() => {
      const g = window.__nebulithGrid
      return JSON.stringify({
        grid: !!g,
        groundAt: typeof g?.groundAt,
        cols: g?.cols ?? null,
        rows: g?.rows ?? null,
        assets: (g?.assets ?? []).length,
      })
    })()
    """) || "and it could not even say what it is holding"
  end

  defp read_marks do
    """
    (async () => {
      // THE CATALOG IS FETCHED ONCE, EVER. This expression is POLLED, and re-fetching every tile of
      // every style on each attempt made one read slow enough to blow its own budget on a 100x60 city:
      // it returned nothing, the poll retried the same expensive thing, and the scenario reported
      // "the page never answered" about a world that was sitting there with 8,099 assets in it.
      //
      // Reduced to what is actually needed too: which SLUGS are roads, not the whole catalogue.
      if (!window.__roadSlugs) {
        const body = await (await fetch('/api/tilesets')).json()
        const tiles = ((body.data || []).find(t => t.key === 'ascii') || {}).tiles || {}
        // WHAT IS A ROAD IS THE BACKEND'S ANSWER. `path_stone` is filed under roads and does not look
        // like one from its label, so a name test here would measure a different street to the generator.
        window.__roadSlugs = new Set(
          Object.keys(tiles).filter(slug => (tiles[slug] || {}).category === 'roads'),
        )
      }
      const roadSlugs = window.__roadSlugs

      // NULL, NOT AN EMPTY ANSWER, while a rebuild is still republishing the grid. `wait_value` polls
      // until this stops being null, so a zero here would be taken as "this city laid no markings" and
      // the scenario would report its own timing as a defect in the world.
      const grid = window.__nebulithGrid
      if (!grid || typeof grid.groundAt !== 'function') return null
      if (!(grid.assets || []).length) return null

      const road = (c, r) =>
        c >= 0 && r >= 0 && c < grid.cols && r < grid.rows && roadSlugs.has(grid.groundAt(c, r))

      const reach = (col, row, dc, dr) => {
        let n = 0
        while (road(col + dc * (n + 1), row + dr * (n + 1))) n++
        return n
      }

      const marks = (grid.assets || []).filter(
        a => a.label === 'road_marking_along_row' || a.label === 'road_marking_along_col',
      )

      const off = []
      for (const m of marks) {
        // A dash laid by the pass that reads streets edge-on down the COLUMNS lies on a cross-section
        // running along +row, and the other pass is its mirror.
        const alongRow = m.label === 'road_marking_along_row'
        const dc = alongRow ? 0 : 1
        const dr = alongRow ? 1 : 0
        const before = reach(m.col, m.row, -dc, -dr)
        const after = reach(m.col, m.row, dc, dr)
        if (before === after) continue
        off.push(`${m.col},${m.row} has ${before} road cells one side and ${after} the other`)
      }

      return { marks: marks.length, offCount: off.length, off: [...new Set(off)].slice(0, 8) }
    })()
    """
  end
end
