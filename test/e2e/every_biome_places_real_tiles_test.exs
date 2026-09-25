defmodule Nebulith.E2E.EveryBiomePlacesRealTilesTest do
  @moduledoc """
  EVERY BIOME BUILDS, AND EVERYTHING IT PUTS DOWN IS A TILE THE CATALOG SERVES.

  The silent failure this exists to catch, measured on the volcano: the mix named four `tree_burned_*`
  species, the catalog contained none of them, and the generator placed nothing. No error, no warning,
  nothing in a log. From the outside it reads as "we no longer have zones with burned trees", which is
  exactly how it was reported, and it survived every backend test because the backend was self
  consistent: the mix named a species and the species was simply absent.

  `docs/OBJECT-CONSTRUCTION.md` checklist item 5 is the rule, and `Nebulith.AVolcanoGrowsBurnedWoodTest`
  gates the half that can be answered from the data: a composition may only name tiles that exist. This
  is the other half, and it is the half no data check can reach: a label is chosen at RUN TIME, by a
  maker function inside the stage generator, from noise and a region's own mix. It never appears as a
  literal anywhere a grep can find it. So the only way to know what a biome actually places is to build
  one and look at what came out.

  ## Why every wilderness preset, in one scenario

  Because the defect is per biome and it was reported per biome: the desert lost its cactuses, the
  volcano lost its burned wood, the beach and the ruins each came back wrong. Checking the one that was
  most recently mentioned is how the other eight get reported back afterwards. `docs/FRAMEWORKS.md`:
  for a FAMILY, the evidence covers every member.

  ## What it asserts, and what it deliberately does not

  Two things, both of which are true of a working map whatever the art direction:

    1. Every biome puts something down at all. A preset that builds an empty map is the loudest possible
       defect and the easiest one to not notice in a screenshot of trees.
    2. Every label it puts down is served by the catalog in the style being drawn.

  It says NOTHING about whether a biome looks right, because that is not a thing an assertion decides.
  The visual verdict is his, at :3000.
  """
  use Nebulith.E2ECase, async: false

  @moduletag :e2e
  @moduletag :phase8
  @moduletag timeout: 1_800_000

  alias Nebulith.Catalog
  alias Nebulith.E2E.Browser
  alias Nebulith.E2E.Canvas
  alias Nebulith.E2E.GeneratePanel

  # Big enough that a region with a small share still gets cells. A volcano's crater is a ring inside a
  # ring, and on a small map it can round away to nothing, which would make a green run meaningless.
  @size %{cols: 60, rows: 60}

  # THE PRESETS, named as the panel names them. Not read from the catalog at run time on purpose: if a
  # biome ever disappears from the panel this list is what notices, and a check that enumerates whatever
  # happens to be there cannot notice an absence.
  @presets ~w(Woodland Jungle Meadow Swamp Mountain Beach Ruins Desert Volcanic)

  # A map is not empty. Well below what any biome actually places, because the point is to catch NOTHING,
  # not to pin a number that art direction will move.
  @least 200

  setup context do
    context
    |> Elixir.Map.put(:map, @size)
    |> a_signed_in_editor()
  end

  test "every wilderness biome builds, and places only tiles the catalog serves", %{
    session: session
  } do
    served = MapSet.new(Catalog.list_tiles_for("ascii"), & &1.label)

    assert MapSet.size(served) > 100,
           "the catalog serves #{MapSet.size(served)} ascii tiles, so this check would pass on anything"

    report = for preset <- @presets, into: %{}, do: {preset, build_and_read(session, preset)}

    empty = for {preset, labels} <- report, labels == [], do: preset

    assert empty == [],
           "these biomes built an EMPTY map, which is the loudest defect and the easiest to miss: " <>
             Enum.join(empty, ", ")

    thin =
      for {preset, labels} <- report, length(labels) < @least, do: "#{preset} (#{length(labels)})"

    assert thin == [],
           "these biomes put down almost nothing, so something they ask for is resolving to nothing: " <>
             Enum.join(thin, ", ")

    # THE LABEL CHECK. A placed label the catalog does not serve draws nothing, silently, which is the
    # whole defect. Reported per biome, and all of them at once, because finding them one run at a time
    # is what made this take a week.
    unserved =
      for {preset, labels} <- report,
          label <- Enum.uniq(labels),
          not MapSet.member?(served, label),
          do: "#{preset} places #{label}"

    assert unserved == [],
           "a biome places a label nothing seeds, so that cell draws nothing and says nothing: " <>
             Enum.join(Enum.uniq(unserved), ", ")

    # …AND THE OTHER DIRECTION, which the check above cannot see. Everything placed being real says
    # nothing about what was ASKED FOR and never arrived: a mix naming only species the catalog lacks
    # places nothing at all, and a map full of correct grass passes every assertion above. That is
    # precisely the shape the burned wood defect had.
    #
    # A tree is stamped as CELLS, so a biome that grew any tree at all put a trunk down. A biome with no
    # trunk anywhere means its whole mix resolved to nothing.
    woodless =
      for {preset, labels} <- report,
          not Enum.any?(labels, &String.starts_with?(&1, "trunk")),
          do: preset

    assert woodless == [],
           "these biomes grew no wood at all, so their tree mix is naming species that resolve to " <>
             "nothing: " <> Enum.join(woodless, ", ")

    # AND THE VOLCANO SPECIFICALLY, because it is the one that was reported and the one whose species
    # were missing. Its `burnt` region gives the four charred species 85 of its 100 weight, so on a
    # 60x60 map charred wood is not a coin toss.
    assert "trunk_charred" in report["Volcanic"],
           "the volcano grew no charred wood, which is what \"we no longer have zones with burned " <>
             "trees\" looks like: it placed #{inspect(Enum.uniq(report["Volcanic"]))}"

    IO.puts("""

    #{map_size(report)} biomes built:
    #{Enum.map_join(Enum.sort(report), "\n", fn {preset, labels} -> "  #{preset}: #{length(labels)} placed, #{length(Enum.uniq(labels))} distinct labels" end)}
    """)
  end

  # ONE BIOME: build it and read back every label on the map.
  defp build_and_read(session, preset) do
    session
    |> GeneratePanel.choose_category("wilderness")
    |> GeneratePanel.choose_preset(preset)
    |> GeneratePanel.build()

    # A build that produced nothing must fall through to the assertions above rather than hang here, so
    # this waits for tiles but does not insist on them.
    Browser.wait_until(
      session,
      &(Canvas.tile_count(&1) > 0),
      "#{preset} to put something on the map",
      timeout: 120_000
    )

    Canvas.tile_labels(session)
  rescue
    # A biome that never drew is a RESULT, not a crash: it is the first thing asserted, by name.
    _ -> []
  end
end
