defmodule Nebulith.ABuildingIsNotATileTest do
  @moduledoc """
  PHASE 2'S OTHER DELETE: *"Every tile whose name is a building, because a building is a construction of
  tiles."* (`docs/SPEC.md` §8, phase 2.)

  `docs/OBJECT-CONSTRUCTION.md` §1 is the rule in full: a single cell wearing a picture of a building is a
  picture, not a building. You cannot walk into it, light it, resize a part of it or edit it piece by
  piece, and no amount of work on the picture changes that.

  ## What this checks that a list of names does not

  Two things, and the second is the one that matters in a year:

    1. The nineteen billboards are gone, reading the list from the migration that deleted them so the
       names have one owner.
    2. No tile is named after a building the composition builder already knows how to BUILD. That is the
       rule rather than the list, so a billboard added tomorrow under a name nobody thought of is still
       caught, as long as the engine can build the thing.

  ## Measured before the deletion

  19 building billboards in each style, and the confusion they caused was live: `house` was both a tile
  and a composition TYPE, so the same word meant a picture in one place and eleven sizes of real building
  in another.
  """
  use Nebulith.DataCase, async: false

  alias Nebulith.Catalog
  alias Nebulith.Catalog.BuildingCompositions
  alias Nebulith.Catalog.TileSource
  alias Nebulith.DataMigration.ABuildingIsNotATile

  setup do
    TileSource.seed()
    :ok
  end

  test "not one of the nineteen billboards is in the catalog, in either style" do
    for style <- ~w(ascii emoji) do
      labels = MapSet.new(Catalog.list_tiles_for(style), & &1.label)

      assert MapSet.size(labels) > 100,
             "#{style} serves #{MapSet.size(labels)} tiles, so this check would pass on anything"

      left =
        for label <- ABuildingIsNotATile.billboards(), MapSet.member?(labels, label), do: label

      assert left == [],
             "#{style} still seeds a picture of a whole building as one tile: " <>
               Enum.join(left, ", ")
    end
  end

  test "no tile is named after a building the engine can actually build" do
    buildable = BuildingCompositions.building_types()

    assert length(buildable) > 3,
           "the composition builder knows #{length(buildable)} building types, which is too few for this " <>
             "check to mean anything"

    labels = MapSet.new(Catalog.list_tiles_for("ascii"), & &1.label)

    clashes = for type <- buildable, MapSet.member?(labels, type), do: type

    assert clashes == [],
           "a tile carries the name of a building the engine builds from pieces, so the same word means " <>
             "a picture in one place and a real construction in another: " <>
             Enum.join(clashes, ", ")
  end

  test "the buildings themselves are still there, as compositions made of pieces" do
    names = MapSet.new(Catalog.list_compositions(), & &1.name)

    for expected <- ~w(house_3 house_4 house_5) do
      assert MapSet.member?(names, expected),
             "deleting the billboard took the real building with it: #{expected} is gone"
    end

    house = Enum.find(Catalog.list_compositions(), &(&1.name == "house_3"))

    assert length(house.cells) > 4,
           "a building is a construction of tiles, and this one has #{length(house.cells)} cells"
  end
end
