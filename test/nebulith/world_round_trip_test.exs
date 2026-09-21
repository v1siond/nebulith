defmodule Nebulith.WorldRoundTripTest do
  @moduledoc """
  GATE 1 OF PHASE 3: a map round-trips. Save, reload, every cell and every setting identical.

  This is the gate the plan names first, and it is the one that could not pass while a map's contents
  were three JSON blobs: a blob has no schema, so nothing in it could be defaulted, constrained or
  compared. What is being asserted is not "the save worked". It is that the exact thing a person
  authored is the exact thing that comes back, field by field, with nothing quietly dropped and nothing
  quietly invented.
  """
  use Nebulith.DataCase

  alias Nebulith.World
  alias Nebulith.World.CellTile

  setup do
    {:ok, map} =
      World.create_map(%{
        "map" => %{"name" => "Round trip"},
        "grid" => %{
          "cols" => 4,
          "rows" => 3,
          "cell_size" => 24,
          "iso_scale" => "2.75",
          "slab_blocks" => 2
        }
      })

    %{map: map}
  end

  describe "the shape of a map" do
    test "the grid's own numbers come back, which they never did before", %{map: map} do
      {:ok, loaded} = World.load_map(map.id)

      assert loaded["grid"]["cols"] == 4
      assert loaded["grid"]["rows"] == 3
      assert loaded["grid"]["cell_size"] == 24
      assert loaded["grid"]["iso_scale"] == "2.75"
      assert loaded["grid"]["slab_blocks"] == 2
    end
  end

  describe "a tile that moves" do
    test "keeps its animation and its clock origin", %{map: map} do
      # A fountain rose and faded when it was stamped and sat still forever after a reload, because
      # `cell_tiles` had no column for this and the save simply dropped it. It cannot be re-derived from
      # the label either: a fountain has nine `water_c` cells and three of them animate.
      loop = %{
        "id" => "rise",
        "durationMs" => 900,
        "delayMs" => 120,
        "loop" => true,
        "trigger" => "load",
        "frames" => [%{"dy" => 0, "scale" => 1}, %{"dy" => -0.2, "scale" => 1.1}]
      }

      sent = %{
        "cells" => [
          %{
            "col" => 1,
            "row" => 1,
            "tiles" => [%{"label" => "water_c", "animations" => [loop], "placed_at" => "0"}]
          },
          # …and the tile beside it, which does not move, so absence stays absence.
          %{"col" => 2, "row" => 1, "tiles" => [%{"label" => "water_c"}]}
        ]
      }

      {:ok, _} = World.save_map(map.id, sent)
      {:ok, loaded} = World.load_map(map.id)

      [moving, still] = Enum.sort_by(loaded["cells"], & &1["col"])
      [water] = moving["tiles"]

      assert [returned] = water["animations"]
      assert returned["id"] == "rise"
      assert returned["durationMs"] == 900
      assert returned["loop"] == true
      assert length(returned["frames"]) == 2
      assert Decimal.equal?(water["placed_at"], Decimal.new("0"))

      assert hd(still["tiles"])["animations"] in [nil, []]
    end
  end

  describe "a saved map" do
    test "comes back cell for cell and setting for setting", %{map: map} do
      sent = %{
        "cells" => [
          %{
            "col" => 0,
            "row" => 0,
            "ground_height" => 3,
            "surface" => "ramp_n",
            "submerge" => "0.4",
            "tiles" => [
              %{
                "width" => "2.0",
                "height" => "3.5",
                "depth" => "0.5",
                "thickness_lu" => "0.25",
                "thickness_rd" => "0.75",
                "thickness_axis" => "left-up",
                "span_forward" => 3,
                "span_perp_back" => 2,
                "span_axis" => "right-down",
                "nudge_x" => "-0.5",
                "rotation" => "45.0",
                "mirror" => true,
                "art_scale" => "1.25",
                "slide_amount" => "2.0",
                "slide_direction" => "left-down",
                "draw_order" => 7,
                "stack_at" => 0,
                "act_as_tile" => true,
                "display" => "single",
                "transparent" => true,
                "shape" => "cone",
                "color" => "#3a7d44",
                "color_role" => "canopy",
                "opacity" => "0.8",
                "brightness" => "1.4",
                "side_color" => "#241a10",
                "leaf_color" => "#5fa86b",
                "fade_near" => true,
                "cutaway_near" => true,
                "min_alpha" => "0.15",
                "sign_text" => "The Inn",
                "foliage" => true,
                "water_heading" => "e",
                "surface" => "ornament",
                "pinned" => true
              }
            ]
          },
          %{"col" => 1, "row" => 0, "ground_height" => -2, "tiles" => []},
          %{"col" => 2, "row" => 2, "tiles" => [%{"shape" => "circle"}, %{"shape" => "square"}]}
        ]
      }

      {:ok, saved} = World.save_map(map.id, sent)
      {:ok, reloaded} = World.load_map(map.id)

      assert saved == reloaded, "two loads of one map disagreed"

      for cell <- sent["cells"] do
        got =
          Enum.find(reloaded["cells"], &(&1["col"] == cell["col"] and &1["row"] == cell["row"]))

        assert got, "cell #{cell["col"]},#{cell["row"]} did not come back at all"

        for {key, value} <- cell, key != "tiles" do
          assert got[key] == value,
                 "cell #{cell["col"]},#{cell["row"]} #{key}: sent #{inspect(value)}, got #{inspect(got[key])}"
        end

        for {tile, index} <- Enum.with_index(cell["tiles"]) do
          back = Enum.at(got["tiles"], index)
          assert back, "tile #{index} of cell #{cell["col"]},#{cell["row"]} is missing"

          for {key, value} <- tile do
            assert back[key] == value,
                   "tile #{index} #{key}: sent #{inspect(value)}, got #{inspect(back[key])}"
          end
        end
      end
    end

    test "keeps its tiles in the order they were stacked", %{map: map} do
      colors = ~w(#111111 #222222 #333333 #444444)

      {:ok, _} =
        World.save_map(map.id, %{
          "cells" => [%{"col" => 1, "row" => 1, "tiles" => Enum.map(colors, &%{"color" => &1})}]
        })

      {:ok, loaded} = World.load_map(map.id)
      [cell] = loaded["cells"]

      assert Enum.map(cell["tiles"], & &1["color"]) == colors
      assert Enum.map(cell["tiles"], & &1["stack_index"]) == [0, 1, 2, 3]
    end

    test "a tile that was removed is actually gone", %{map: map} do
      {:ok, _} =
        World.save_map(map.id, %{
          "cells" => [
            %{"col" => 0, "row" => 0, "tiles" => [%{"color" => "#aaa"}, %{"color" => "#bbb"}]}
          ]
        })

      {:ok, _} =
        World.save_map(map.id, %{
          "cells" => [%{"col" => 0, "row" => 0, "tiles" => [%{"color" => "#aaa"}]}]
        })

      {:ok, loaded} = World.load_map(map.id)
      [cell] = loaded["cells"]

      assert length(cell["tiles"]) == 1
      assert hd(cell["tiles"])["color"] == "#aaa"
    end

    test "a cell that was cleared is gone, not left behind", %{map: map} do
      {:ok, _} =
        World.save_map(map.id, %{
          "cells" => [
            %{"col" => 0, "row" => 0, "tiles" => []},
            %{"col" => 1, "row" => 1, "tiles" => []}
          ]
        })

      {:ok, _} = World.save_map(map.id, %{"cells" => [%{"col" => 0, "row" => 0, "tiles" => []}]})
      {:ok, loaded} = World.load_map(map.id)

      assert length(loaded["cells"]) == 1
    end
  end

  describe "what a caller does not say" do
    test "comes back as the DATABASE's default, not as nothing", %{map: map} do
      {:ok, _} =
        World.save_map(map.id, %{"cells" => [%{"col" => 0, "row" => 0, "tiles" => [%{}]}]})

      {:ok, loaded} = World.load_map(map.id)

      [%{"tiles" => [tile]}] = loaded["cells"]

      # Every default the plan states, arriving from the column rather than from a renderer's `??`.
      assert tile["width"] == "1.0"
      assert tile["height"] == "1.0"
      assert tile["depth"] == "1.0"
      assert tile["stack_at"] == 1, "stack_at's default is 1, and there is no ambiguity about it"
      assert tile["display"] == "all_faces"
      assert tile["shape"] == "square"
      assert tile["surface"] == "plain"
      assert tile["opacity"] == "1.0"
      assert tile["brightness"] == "1.0"
      assert tile["rotation"] == "0.0"
      assert tile["act_as_tile"] == false
      assert tile["transparent"] == false
      assert tile["span_forward"] == 1

      assert Enum.all?(
               ~w(thickness_lu thickness_ru thickness_ld thickness_rd),
               &(tile[&1] == "1.0")
             )
    end

    test "every settable column is present on the way out, so nothing is left to be invented", %{
      map: map
    } do
      {:ok, _} =
        World.save_map(map.id, %{"cells" => [%{"col" => 0, "row" => 0, "tiles" => [%{}]}]})

      {:ok, loaded} = World.load_map(map.id)

      [%{"tiles" => [tile]}] = loaded["cells"]
      served = MapSet.new(Elixir.Map.keys(tile))

      for field <- CellTile.settable_fields() do
        assert MapSet.member?(served, Atom.to_string(field)),
               "#{field} is a column and the payload does not carry it, so a reader has to guess"
      end
    end
  end

  describe "the vocabulary" do
    test "has no zoom, and no walkable or blocking either", %{map: _map} do
      names = Enum.map(CellTile.settable_fields(), &Atom.to_string/1)

      for banned <- ~w(zoom walkable blocking blocked blocks_movement is_solid occupies) do
        refute banned in names, "#{banned} came back into the schema"
      end
    end

    test "keeps depth and span as different words for different questions" do
      names = Enum.map(CellTile.settable_fields(), &Atom.to_string/1)

      assert "depth" in names, "depth is the size into the screen"
      assert "span_forward" in names, "span counts whole cells"
      refute "depth_back" in names, "two controls both called depth is the clash this phase ends"
    end
  end
end
