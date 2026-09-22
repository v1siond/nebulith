defmodule Nebulith.Catalog.AnOrnamentIsOneObjectTest do
  @moduledoc """
  A BARE SEED PRODUCES ROCKS THAT LOOK LIKE ROCKS.

  An ornament is one object lying on the ground, so it draws as a single billboard inside a transparent
  block. Drawn the default way it is a cube with its picture painted on the top and both visible faces, which
  reads as a stone crate.

  Both facts, how it draws and whether it stops you, used to live in a data migration that patched the rows
  `TileSource.seed/0` had written. `upsert_tile` REPLACES the whole settings map, so every reseed put the
  crates back, and nothing in the code had changed. This is the gate that keeps the facts in the seeder: it
  fails on a seeder that does not state them.
  """
  use Nebulith.DataCase

  alias Nebulith.Catalog
  alias Nebulith.Catalog.TileSource

  @whole_cell [%{"x" => 0, "y" => 0, "w" => 1, "h" => 1}]

  setup do
    TileSource.seed()

    rows =
      for tileset <- Catalog.list_tilesets(),
          tile <- Catalog.list_tiles_for(tileset.key),
          TileSource.ornament?(tile.label),
          into: %{},
          do: {{tileset.key, tile.label}, tile}

    %{rows: rows}
  end

  describe "how an ornament draws" do
    test "every ornament is a single tile in a transparent block, in every style", %{rows: rows} do
      assert map_size(rows) > 0, "the catalog has no ornaments at all, so this run proves nothing"

      for {{style, label}, tile} <- rows do
        assert tile.settings["display"] == "single",
               "#{style}/#{label} draws #{inspect(tile.settings["display"])}, so it is a cube with a " <>
                 "picture on every face"

        assert tile.settings["transparent"] == true,
               "#{style}/#{label} is not transparent, so its billboard sits in a solid block"
      end
    end
  end

  describe "what an ornament does to you" do
    test "a rock, a boulder and a log stop you, and occupy their whole cell", %{rows: rows} do
      solid =
        for {{style, label}, tile} <- rows,
            label in ~w(rock boulder wood-log),
            do: {style, label, tile}

      assert length(solid) >= 3, "not every solid ornament is in the catalog: #{inspect(solid)}"

      for {style, label, tile} <- solid do
        assert tile.settings["collision"] == @whole_cell,
               "#{style}/#{label} is a boulder and occupies #{inspect(tile.settings["collision"])}, " <>
                 "so you walk straight through it"
      end
    end

    test "a mushroom, a shell and a bush are walked over", %{rows: rows} do
      walkover =
        for {{style, label}, tile} <- rows,
            label not in ~w(rock boulder wood-log),
            do: {style, label, tile}

      assert walkover != [], "no walk-over ornaments, so this run proves nothing"

      for {style, label, tile} <- walkover do
        assert tile.settings["collision"] == [],
               "#{style}/#{label} is walked over but occupies #{inspect(tile.settings["collision"])}"
      end
    end
  end

  describe "the seeder owns it" do
    test "seeding again says the same thing, so a reseed cannot undo it", %{rows: first} do
      TileSource.seed()

      again =
        for tileset <- Catalog.list_tilesets(),
            tile <- Catalog.list_tiles_for(tileset.key),
            TileSource.ornament?(tile.label),
            into: %{},
            do:
              {{tileset.key, tile.label}, {tile.settings["display"], tile.settings["collision"]}}

      for {key, tile} <- first do
        assert again[key] == {tile.settings["display"], tile.settings["collision"]},
               "#{inspect(key)} changed across a second seed: #{inspect(again[key])}"
      end
    end
  end
end
