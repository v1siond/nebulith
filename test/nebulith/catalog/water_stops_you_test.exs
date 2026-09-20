defmodule Nebulith.Catalog.WaterStopsYouTest do
  @moduledoc """
  *"I shouldn't be able to walk into ANY real water zone"*, and the two facts he asked for alongside it.

  These assert on the TILE rows, because that is where the answer has to live. The generator already refuses
  to let you walk into a river; what it could not do is survive a save, since the collision array it writes is
  not one of the columns a saved map has. A box on the tile is the same fact written somewhere that persists.

  The negative cases carry as much weight as the positive ones here: a rule that blocks `water_still` seals
  every ford on the map, and one that sinks `water_jet` drops a fountain's spray into its own basin.
  """
  use Nebulith.DataCase

  alias Nebulith.Catalog
  alias Nebulith.DataMigration.YouCannotWalkIntoWater
  alias Nebulith.Repo

  @full_cell [%{"x" => 0, "y" => 0, "w" => 1, "h" => 1}]

  setup do
    {:ok, ts} = Catalog.create_tileset(%{key: "ascii", name: "ASCII", data: %{}})

    # One of each shape the rule has to tell apart: an autotile piece, the named terrain tiles, the ford film,
    # the fountain's two object pieces, and the winter surface.
    for {label, height, settings} <- [
          {"water_smooth_river_tl", 0.0, %{}},
          {"water_lined_lake_c", 0.0, %{}},
          {"water", 0.0, %{}},
          {"water_deep", 0.0, %{}},
          {"oasis", 0.0, %{}},
          {"water_still", 0.0, %{}},
          {"water_c", 1.0, %{"collision" => @full_cell}},
          {"water_jet", 1.0, %{"collision" => @full_cell}},
          {"frozen_water", 0.0, %{}},
          {"grass", 0.0, %{}}
        ] do
      {:ok, _} =
        Catalog.upsert_tile(%{
          tileset_id: ts.id,
          label: label,
          color_role: "terrain",
          height: height,
          settings: settings
        })
    end

    :ok = YouCannotWalkIntoWater.run()
    %{tileset: ts}
  end

  defp tile(label) do
    Repo.one!(from t in Nebulith.Catalog.Tile, where: t.label == ^label)
  end

  describe "real water stops you" do
    test "an autotile piece carries a full-cell box" do
      assert tile("water_smooth_river_tl").settings["collision"] == @full_cell
      assert tile("water_lined_lake_c").settings["collision"] == @full_cell
    end

    test "the named terrain water does too" do
      for label <- ~w(water water_deep oasis) do
        assert tile(label).settings["collision"] == @full_cell, "#{label} should stop you"
      end
    end
  end

  describe "what is deliberately still walkable" do
    test "the ford film is not a wall, or every crossing on the map seals" do
      assert (tile("water_still").settings["collision"] || []) == [],
             "water_still occupies #{inspect(tile("water_still").settings["collision"])}, and you walk on it"
    end

    test "ice is the surface you walk on" do
      assert (tile("frozen_water").settings["collision"] || []) == [],
             "frozen_water occupies #{inspect(tile("frozen_water").settings["collision"])}, and you walk on it"
    end

    test "dry land is untouched" do
      assert (tile("grass").settings["collision"] || []) == [],
             "grass occupies #{inspect(tile("grass").settings["collision"])}, and you walk on it"

      assert tile("grass").height == 0.0
    end
  end

  describe "the surface stands proud of its bed" do
    test "real water is raised to 0.4" do
      for label <- ~w(water water_deep oasis water_smooth_river_tl) do
        assert tile(label).height == 0.4, "#{label} should read 0.4"
      end
    end

    test "the puddle film stays flat on the floor it lies over" do
      assert tile("water_still").height == 0.0
    end

    test "the fountain keeps its own block height" do
      assert tile("water_c").height == 1.0
      assert tile("water_jet").height == 1.0
    end
  end

  describe "everything sinks" do
    test "all water sits at stackAt 0, the film included" do
      for label <- ~w(water water_deep oasis water_still water_smooth_river_tl frozen_water) do
        assert tile(label).settings["stackAt"] == 0, "#{label} should sink what you drop in it"
      end
    end

    test "a fountain's jet is water leaving the ground, so it keeps its place in the stack" do
      refute Map.has_key?(tile("water_jet").settings, "stackAt")
      refute Map.has_key?(tile("water_c").settings, "stackAt")
    end
  end
end
