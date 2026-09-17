defmodule Nebulith.ParametricBuildingsTest do
  @moduledoc """
  BUILDINGS AT ANY SIZE, `BuildingCompositions.compose_building/4`.

  `building_compositions_test.exs` already asserts the ELEVEN authored buildings cell-for-cell, and they are
  now composed through this same function, so that suite is the proof that this generalises the seeds
  rather than replacing them with something merely similar. This suite covers what it adds: the sizes nobody
  authored.
  """
  use ExUnit.Case, async: true

  alias Nebulith.Catalog.BuildingCompositions, as: BC

  defp labels(comp), do: comp.cells |> Enum.map(& &1.label) |> MapSet.new()
  defp front_row(comp), do: Enum.filter(comp.cells, &(&1.dy == comp.footprint_h - 1))
  defp door_cols(comp) do
    front_row(comp)
    |> Enum.filter(&(&1.label == "door"))
    |> Enum.map(& &1.dx)
    |> Enum.uniq()
    |> Enum.sort()
  end

  describe "every type composes at a size nobody authored" do
    test "each type builds at 9 x 5, a footprint no seed has" do
      for type <- BC.building_types() do
        comp = BC.compose_building(type, 9, 5, seed: 1)
        assert comp.footprint_w == 9, "#{type} lost its width"
        assert comp.footprint_h == 5, "#{type} lost its depth"
        assert comp.cells != [], "#{type} composed nothing"
      end
    end

    test "a store of any size, the ask, literally" do
      for w <- [4, 5, 7, 11], d <- [3, 4, 6] do
        comp = BC.compose_building("store", w, d)
        assert comp.footprint_w == w and comp.footprint_h == d
        # A shop is still a shop at every size: its storefront glazing and awning survive.
        assert "display_window" in labels(comp), "store #{w}x#{d} lost its display window"
        assert "awning" in labels(comp), "store #{w}x#{d} lost its awning"
      end
    end

    test "a hospital of any size keeps its own walls and roof" do
      comp = BC.compose_building("hospital", 10, 6)
      assert "roof_hospital" in labels(comp)
      assert Enum.any?(labels(comp), &String.starts_with?(&1, "wall_plaster"))
    end
  end

  describe "the door rule holds at every width" do
    test "centred, and a PAIR exactly when the width is even" do
      for w <- 4..14 do
        cols = BC.compose_building("house", w, 4) |> door_cols()
        expected = if rem(w, 2) == 1, do: [div(w, 2)], else: [div(w, 2) - 1, div(w, 2)]
        assert cols == expected, "width #{w}: doors at #{inspect(cols)}, expected #{inspect(expected)}"
      end
    end

    test "the doorway is the only walkable opening on the front row" do
      comp = BC.compose_building("house", 8, 4)
      walkable = front_row(comp) |> Enum.filter(& &1.walkable) |> Enum.map(& &1.dx) |> Enum.uniq() |> Enum.sort()
      assert walkable == door_cols(comp)
    end
  end

  describe "height follows width, so a wide building is not a tall wall's worth of squat" do
    test "taller walls as the footprint grows, and never shorter" do
      tops =
        for w <- [4, 6, 8, 10, 12] do
          comp = BC.compose_building("house", w, 4)
          comp.cells |> Enum.map(& &1.level) |> Enum.max()
        end

      assert tops == Enum.sort(tops), "height must be monotonic in width, got #{inspect(tops)}"
      assert List.last(tops) > List.first(tops), "a 12-wide building is no taller than a 4-wide one"
    end
  end

  describe "what the user may override, the selected roof, walls, windows and doors\"" do
    test "the wall material" do
      comp = BC.compose_building("house", 6, 4, material: "wall_stone")
      assert Enum.any?(labels(comp), &String.starts_with?(&1, "wall_stone"))
      refute Enum.any?(labels(comp), &String.starts_with?(&1, "wall_brick"))
    end

    test "the roof body and its apex" do
      comp = BC.compose_building("house", 6, 4, roof: "roof_slate", roof_top: "roof_top_slate")
      assert "roof_slate" in labels(comp)
      assert "roof_top_slate" in labels(comp)
      refute "roof" in labels(comp)
    end

    test "the wall height" do
      short = BC.compose_building("castle", 12, 6, wall_top: 4)
      tall = BC.compose_building("castle", 12, 6)
      assert Enum.max(Enum.map(short.cells, & &1.level)) < Enum.max(Enum.map(tall.cells, & &1.level))
    end
  end

  describe "the material is ROLLED, not fixed" do
    test "a house's material varies across seeds, that is the wall variety the world generator wants" do
      materials =
        for seed <- 0..8 do
          BC.compose_building("house", 6, 4, seed: seed)
          |> labels()
          |> Enum.filter(&String.starts_with?(&1, "wall_"))
          |> Enum.map(&(&1 |> String.split("_") |> Enum.take(2) |> Enum.join("_")))
          |> Enum.uniq()
        end
        |> List.flatten()
        |> Enum.uniq()

      assert length(materials) > 1, "every seed gave the same material: #{inspect(materials)}"
    end

    test "the same seed gives the same building, a thumbnail must not re-roll" do
      a = BC.compose_building("house", 7, 4, seed: 42)
      b = BC.compose_building("house", 7, 4, seed: 42)
      assert a == b
    end

    test "a type whose material is its identity does not roll" do
      for seed <- 0..5 do
        comp = BC.compose_building("hospital", 6, 4, seed: seed)
        assert Enum.any?(labels(comp), &String.starts_with?(&1, "wall_plaster"))
      end
    end
  end

  describe "the boundary" do
    test "offers a minimum, and a default footprint per type taken from the authored one" do
      assert BC.min_footprint() == {4, 3}
      assert BC.default_footprint("house") == {4, 4}
      assert BC.default_footprint("castle") == {12, 6}
      assert BC.default_footprint("nonsense") == nil
    end

    test "composes EXACTLY the size asked for, without silently applying the minimum" do
      # The minimum is advice for the caller. A composer that rewrites its input is the same defect as a
      # map-size field that rewrites yours, and the authored `house_3` is a live 3-wide building.
      comp = BC.compose_building("house", 3, 4)
      assert comp.footprint_w == 3
    end

    test "refuses an unknown type loudly rather than composing something arbitrary" do
      assert_raise ArgumentError, fn -> BC.compose_building("spaceport", 6, 4) end
    end
  end
end
