defmodule Nebulith.E2E.AVolcanoIsBurntTest do
  @moduledoc """
  A VOLCANIC MAP STANDS ON BLACK ROCK AND CARRIES ZONES OF BURNED TREES.

  His words: *"Volcanic also lost it's style entirely, and we no longer have zones with burned trees..."*.

  ## What was measured before

  A 40 x 40 volcanic build: `meadow 1505` of 1600 ground cells, `leaf_needle 178` and `leaf_gnarled 113` of
  living conifer, and not one burned tile. Its own regions ask for burned species by name: `crater` and
  `burnt` and `ashfall` between them name `tree_burned_pine`, `tree_burned_birch`, `tree_burned_oak` and
  `tree_burned_encina`, and all four are seeded compositions. So the catalogue was asking and the map was
  not answering.
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

  test "a volcano stands on black rock and burns its trees", %{session: session} do
    session
    |> GeneratePanel.choose_category("wilderness")
    |> GeneratePanel.choose_preset("Volcanic")
    |> GeneratePanel.build()

    Browser.wait_until(
      session,
      &(Canvas.tile_count(&1) > 0),
      "the volcano to put something on the map",
      timeout: 180_000
    )

    counts =
      for label <- Canvas.tile_labels(session),
          reduce: %{} do
        seen -> Elixir.Map.update(seen, label, 1, &(&1 + 1))
      end

    IO.puts("\n  WHAT THE VOLCANO IS MADE OF\n")

    for {label, n} <- Enum.sort_by(counts, &(-elem(&1, 1))) |> Enum.take(22) do
      IO.puts("    #{String.pad_trailing(label, 24)} #{n}")
    end

    refute Elixir.Map.has_key?(counts, "meadow"),
           "the volcano is still standing on meadow grass, #{counts["meadow"]} cells of it"

    rock = for {label, n} <- counts, label in ~w(volcanic_rock ash basalt obsidian magma lava), do: n

    assert Enum.sum(rock) > 400,
           "the volcano is standing on #{Enum.sum(rock)} cells of rock and ash, so it is not a volcano's ground"

    burnt = for {label, n} <- counts, label in ~w(trunk_charred leaf_scorched), do: n

    assert Enum.sum(burnt) > 0,
           """
           Nothing on the volcano is burned, and three of its regions ask for burned species by name. It grew
           #{inspect(Enum.take(Enum.sort_by(counts, &(-elem(&1, 1))), 10))}
           """
  end
end
