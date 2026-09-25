defmodule Nebulith.E2E.ATownBelongsToItsCountryTest do
  @moduledoc """
  A DESERT TOWN STANDS ON SAND. A VOLCANIC VILLAGE STANDS ON ASH.

  His words: *"all these issues apply to their settlements counterpart... it also applies to towns and
  villages"*.

  ## What was measured before

  `settlement_config` carried no `palette` at all, so `ctx.palette` was undefined in every settlement and
  `openGround` fell through to the season's first ground. Every village, town and city of every environment
  was laid out on meadow grass in the season's green, whatever country it was supposed to be in. The engine
  had read `palette.groundTile` since the open-ground pass was written, and nothing ever served one.

  It prints the rest, because how a town LOOKS is his call at :3000; what it is STANDING on is a fact.
  """
  use Nebulith.E2ECase, async: false

  @moduletag :e2e
  @moduletag :phase8
  @moduletag timeout: 3_600_000

  alias Nebulith.E2E.GeneratePanel

  @size %{cols: 40, rows: 40}

  # THE THREE THAT NAME A COUNTRY WITH ITS OWN GROUND, one of each size, so the rule is checked on a village,
  # a town and a city rather than three of the same.
  @places [
    {"village", "Desert village", ~w(sand sand_dune sandstone)},
    {"town", "Volcanic town", ~w(ash volcanic_rock basalt obsidian)},
    {"city", "Beach city", ~w(sand sand_dune)}
  ]

  setup context do
    context
    |> Elixir.Map.put(:map, @size)
    |> a_signed_in_editor()
  end

  defp ground_of(%{"type" => "floor"} = tile), do: tile["tileKey"] || tile["label"]
  defp ground_of(tile), do: tile["label"] || tile["tileKey"]

  test "a settlement stands on the ground of the country it is in", %{session: session, map: map} do
    rows =
      for {category, preset, expected} <- @places do
        session =
          session
          |> Editor.open(map.id)
          |> GeneratePanel.choose_category(category)
          |> GeneratePanel.choose_preset(preset)
          |> GeneratePanel.build()

        Browser.wait_until(
          session,
          &(Canvas.tile_count(&1) > 0),
          "#{preset} to put something on the map",
          timeout: 240_000
        )

        # A FLOOR IS NAMED BY ITS TILE, not by the word "floor". A settlement's ground assets carry
        # `label: "floor"` with the ground slug in `tileKey`, so counting the label alone reports 1548 cells
        # of "floor" and tells you nothing about what a place is standing on.
        counts =
          for tile <- Canvas.tiles(session),
              label = ground_of(tile),
              is_binary(label),
              reduce: %{} do
            seen -> Elixir.Map.update(seen, label, 1, &(&1 + 1))
          end

        sample =
          Browser.js(session, """
          (() => {
            const g = window.__nebulithGrid
            if (!g) return null
            const f = g.assets.find(a => a.type === 'floor')
            return f ? { label: f.label, tileKey: f.tileKey, type: f.type, keys: Object.keys(f).slice(0, 14) } : null
          })()
          """)

        IO.puts("\n  #{preset} FLOOR SAMPLE: #{inspect(sample)}\n")

        {preset, counts, expected}
      end

    IO.puts("\n  WHAT EACH SETTLEMENT IS MADE OF\n")

    for {preset, counts, _} <- rows do
      top =
        counts
        |> Enum.sort_by(&(-elem(&1, 1)))
        |> Enum.take(8)
        |> Enum.map_join(", ", fn {label, n} -> "#{label} #{n}" end)

      IO.puts("    #{String.pad_trailing(preset, 18)} #{top}")
    end

    grassy =
      for {preset, counts, _} <- rows,
          n = counts["meadow"],
          is_integer(n) and n > 0,
          do: "#{preset} (#{n} cells of meadow)"

    assert grassy == [],
           """
           #{length(grassy)} settlement is still laid out on meadow grass, whatever country it is in:
             #{Enum.join(grassy, "\n  ")}
           """

    wrong =
      for {preset, counts, expected} <- rows,
          own = for({label, n} <- counts, label in expected, do: n),
          Enum.sum(own) < 200,
          do: "#{preset} stands on #{Enum.sum(own)} cells of #{inspect(expected)}"

    assert wrong == [],
           """
           #{length(wrong)} settlement is not standing on its own country's ground:
             #{Enum.join(wrong, "\n  ")}
           """
  end
end
