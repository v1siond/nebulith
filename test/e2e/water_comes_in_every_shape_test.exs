defmodule Nebulith.E2E.WaterComesInEveryShapeTest do
  @moduledoc """
  A BEACH MAP GETS BEACH WATER, AND A LAKE CAN BE ASKED FOR BY NAME.

  His words: *"the beach forest no longer looks like beach forest, we alos lost the beach and laken water
  options from the generators"*.

  ## What was measured before

  Two shapes were fully built and unreachable. `carveShore` paints a sea along one map edge and `carveBody`
  paints a standing body, and the river option offered four courses: none, random, through, divides, around.
  So the only route to a beach or a lake was picking a biome whose regions happened to ask for pools.

  The beach map itself asked for `around`, the perimeter river, which runs a ring one cell in from the edge.
  It covers no edge, so `classifyBody` read it as a river and it wore river pieces: measured on a 40 x 40
  build, 91 `water_smooth_river_c` cells and not one beach piece, on the one map whose whole point is a beach.

  `Nebulith.APickerCannotMissAValueTest` proves the catalog offers every shape the engine paints. This proves
  the shapes reach the ground.
  """
  use Nebulith.E2ECase, async: false

  @moduletag :e2e
  @moduletag :phase8
  @moduletag timeout: 900_000

  alias Nebulith.E2E.GeneratePanel

  @size %{cols: 40, rows: 40}

  setup context do
    context
    |> Elixir.Map.put(:map, @size)
    |> a_signed_in_editor()
  end

  test "the beach's water wears the beach's own pieces", %{session: session} do
    session
    |> GeneratePanel.choose_category("wilderness")
    |> GeneratePanel.choose_preset("Beach")
    |> GeneratePanel.build()

    Browser.wait_until(
      session,
      &(Canvas.tile_count(&1) > 0),
      "the beach to put something on the map",
      timeout: 180_000
    )

    pieces = water_pieces(session)

    refute pieces == %{}, "the beach map carries no water at all"

    beach = for {label, n} <- pieces, String.contains?(label, "beach"), do: {label, n}

    refute beach == [],
           """
           The beach map's water carries no beach piece. It is wearing #{inspect(Elixir.Map.keys(pieces))}.
           A body that runs along a map edge is a shore, and the pieces for it are baked; the map was asking
           for the wrong shape.
           """
  end

  test "a lake can be asked for by name, and comes out a lake", %{session: session} do
    session =
      session
      |> GeneratePanel.choose_category("wilderness")
      |> GeneratePanel.choose_preset("Woodland")
      |> GeneratePanel.choose_option("A lake in the middle")
      |> GeneratePanel.build()

    Browser.wait_until(
      session,
      &(Canvas.tile_count(&1) > 0),
      "the woodland to put something on the map",
      timeout: 180_000
    )

    pieces = water_pieces(session)

    refute pieces == %{},
           "a lake was asked for and the map came back dry, so the choice reaches no builder"

    lake = for {label, n} <- pieces, String.contains?(label, "lake"), do: {label, n}

    refute lake == [],
           """
           A lake was asked for and the water came out as #{inspect(Elixir.Map.keys(pieces))}. A body that
           touches no edge and carries no flow is a lake, and `classifyBody` is what names it, so this is the
           shape that was painted rather than the naming.
           """
  end

  defp water_pieces(session) do
    for label <- Canvas.tile_labels(session),
        String.starts_with?(label, "water"),
        reduce: %{} do
      seen -> Elixir.Map.update(seen, label, 1, &(&1 + 1))
    end
  end
end
