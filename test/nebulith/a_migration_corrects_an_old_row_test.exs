defmodule Nebulith.AMigrationCorrectsAnOldRowTest do
  @moduledoc """
  THE TWO NEW DATA MIGRATIONS, RUN AT A ROW PUT BACK INTO THE STATE THEY EXIST TO CORRECT.

  `docs/TESTING.md` item 7: *"If the fix includes a DATA MIGRATION, is there a test that puts a row back into
  the old state and runs the migration at it? A test that seeds and reads passes whether the migration works
  or not."*

  That is exactly the trap here. `seed/0` runs both rules itself, so a test that seeds and then reads is
  green whether the migration is registered, whether it is correct, and whether it runs at all. So each of
  these breaks the row first, by hand, the way an existing database has it, and then runs only the migration.
  """
  use Nebulith.DataCase, async: false

  alias Nebulith.Catalog
  alias Nebulith.Catalog.TileSource
  alias Nebulith.DataMigration.AGrowingThingKeepsItsOpacity
  alias Nebulith.DataMigration.AThingIsOneObjectAPieceIsNot

  setup do
    TileSource.seed()
    :ok
  end

  test "a tree with no fade floor gets one" do
    tileset = hd(Catalog.list_tilesets())

    # THE OLD STATE: every growing thing carried no `minAlpha` at all, so it fell to whatever the game's
    # close band was, exactly like a wall.
    for tile <- Catalog.list_tiles_for(tileset.key), TileSource.stays_opaque?(tile.label) do
      Catalog.put_tile_setting(tileset.id, tile.label, "minAlpha", nil)
    end

    bare = Enum.count(growing(tileset), &(floor_of(&1) == nil))

    assert bare > 0, "the row could not be put back into the old state, so this proves nothing"

    AGrowingThingKeepsItsOpacity.run()

    still_bare = for tile <- growing(tileset), floor_of(tile) == nil, do: tile.label

    assert still_bare == [],
           "#{length(still_bare)} growing thing was left with no fade floor by the migration: " <>
             Enum.join(Enum.take(still_bare, 10), ", ")
  end

  test "a loose thing left drawing on every face is corrected" do
    tileset = hd(Catalog.list_tilesets())
    pieces = TileSource.composition_pieces()

    # THE OLD STATE: the rule was eleven label names, so everything else in nature and decor kept
    # `display: all-faces` and its block shell.
    for tile <- Catalog.list_tiles_for(tileset.key), TileSource.one_object?(tile, pieces) do
      Catalog.put_tile_setting(tileset.id, tile.label, "display", "all-faces")
      Catalog.put_tile_setting(tileset.id, tile.label, "transparent", false)
    end

    cubes = Enum.count(loose(tileset, pieces), &(display_of(&1) != "single"))

    assert cubes > 11,
           "only #{cubes} tiles were put back into the old state, which is no more than the eleven names " <>
             "the rule used to be, so this is not measuring the widening"

    AThingIsOneObjectAPieceIsNot.run()

    left = for tile <- loose(tileset, pieces), display_of(tile) != "single", do: tile.label

    assert left == [],
           "#{length(left)} loose thing still draws on every face after the migration: " <>
             Enum.join(Enum.take(left, 10), ", ")
  end

  defp growing(tileset) do
    for tile <- Catalog.list_tiles_for(tileset.key), TileSource.stays_opaque?(tile.label), do: tile
  end

  defp loose(tileset, pieces) do
    for tile <- Catalog.list_tiles_for(tileset.key), TileSource.one_object?(tile, pieces), do: tile
  end

  defp display_of(tile), do: (tile.settings || %{})["display"]

  defp floor_of(tile), do: (tile.settings || %{})["minAlpha"]
end
