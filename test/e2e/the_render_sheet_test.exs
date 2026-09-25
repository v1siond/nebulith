defmodule Nebulith.E2E.TheRenderSheetTest do
  @moduledoc """
  RENDERS EVERY MEMBER OF A FAMILY, SIDE BY SIDE, SO A FAMILY CAN BE JUDGED AS A FAMILY.

  *"I fixed the trees" after looking at one tree is how a user ends up reporting the other fourteen
  back to you.* `docs/FRAMEWORKS.md` says that for anything visual applying to a family the evidence
  must cover every member, and that if no tool renders them all, building that tool is the first task.
  This is that tool.

  It is not a pass/fail gate. It asserts only that every member actually drew, because a sheet with a
  hole in it is worse than no sheet: the hole is invisible and the missing member reads as approved.
  The judgement is made by LOOKING at the picture it writes.

  ## Run it

      bin/e2e test/e2e/the_render_sheet_test.exs --include sheet

  Excluded from the normal run because it writes files and answers a question no assertion can.
  The sheets land in `docs/renders/`, which is where the reference renders already live.

  ## Why the real editor and not a canvas harness

  A separate harness draws what it was told to draw. This stamps through `__placeComposition`, the same
  path a click takes, onto a real map in the real editor with the real catalog behind it, so what the
  sheet shows is what the game shows. A sheet that can disagree with the game is a sheet that will.
  """
  use Nebulith.E2ECase, async: false

  @moduletag :e2e
  @moduletag :sheet
  @moduletag timeout: 900_000

  # Big enough to space every member out so nothing overlaps its neighbour, small enough to build fast.
  @size %{cols: 60, rows: 60}
  # Cells between one member and the next. A giant is 2 cells across and rises several blocks, so this
  # is the spacing at which the tallest member still cannot lean into the one behind it.
  @gap 5

  setup context do
    context
    |> Elixir.Map.put(:map, @size)
    |> a_signed_in_editor()
  end

  @tag :sheet
  test "every tree family, one portrait each", %{session: session} do
    families = compositions_in(session, "nature")

    assert length(families) >= 10,
           "the catalog serves #{length(families)} nature compositions, so this sheet would not show " <>
             "the family it exists to show: #{inspect(families)}"

    # ONE PORTRAIT PER MEMBER, not one grid of all of them. The first version laid the whole family out
    # and photographed it at 50%, which produced a picture in which no blob could be named: it showed
    # that something was wrong without saying which member was wrong, and a defect you cannot name you
    # cannot fix. Each member now gets the middle of the map to itself, at a zoom where its trunk and
    # its crown are separately legible, and the file is named after it.
    missing =
      for family <- families, not portrait(session, family), do: family

    assert missing == [],
           "these members never drew, so their portrait is of empty ground and they would read as " <>
             "approved: #{inspect(missing)}"

    IO.puts("""

    #{length(families)} portraits in docs/renders/family-*.png:
      #{Enum.join(families, ", ")}
    """)
  end

  # THE MIDDLE OF THE MAP, CLEARED, then this member alone, then the camera on it.
  defp portrait(session, family) do
    mid_col = div(@size.cols, 2)
    mid_row = div(@size.rows, 2)

    Browser.js(
      session,
      "window.__clearRegion(#{mid_col - @gap}, #{mid_row - @gap}, #{mid_col + @gap}, #{mid_row + @gap})"
    )

    before = Canvas.tile_count(session)

    Browser.js(
      session,
      "window.__placeComposition(#{Jason.encode!(family)}, #{mid_col}, #{mid_row})"
    )

    drew = Canvas.tile_count(session) > before

    Browser.js(session, "window.__centerOn(#{mid_col}, #{mid_row})")
    Browser.wait_for_js(session, "(window.__nebulithDrawn ?? []).length > 0", "#{family} to draw")
    PhoenixTest.Playwright.screenshot(session, "family-#{family}.png")

    drew
  end

  # EVERY COMPOSITION IN A BUCKET, asked of the running app rather than written down here. A sheet with
  # a hardcoded list stops covering the family the day somebody adds a member, which is the exact
  # moment it most needed to.
  defp compositions_in(session, category) do
    Browser.js(session, """
    (async () => {
      const body = await (await fetch('/api/tilesets')).json()
      const comps = ((body.data || [])[0] || {}).compositions || {}
      return Object.keys(comps).filter(name => (comps[name] || {}).category === #{Jason.encode!(category)}).sort()
    })()
    """) || []
  end
end
