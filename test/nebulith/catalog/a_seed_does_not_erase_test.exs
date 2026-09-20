defmodule Nebulith.Catalog.ASeedDoesNotEraseTest do
  @moduledoc """
  A SEED ADDS. IT DOES NOT TOUCH WHAT IT DID NOT WRITE.

  `upsert_tile` used to upsert with `replace_all_except`, so re-running a seeder replaced the whole settings
  map on every row it touched. Every fact written after the seed went with it: the tile-fact rules' own, a
  data migration's, and any pose tuned in the editor. That is one bug wearing a different costume every time
  it surfaces: rocks drawn as crates, a preview panel back to dropdowns, a tile walkable that should stop
  you. Nothing in the code changed on any of those days. A seeder ran.

  This is the gate. It writes a setting no seeder knows about, seeds again, and asks for it back.
  """
  use Nebulith.DataCase

  alias Nebulith.Catalog
  alias Nebulith.Catalog.TileSource

  setup do
    TileSource.seed()
    [tileset | _] = Catalog.list_tilesets()
    %{tileset: tileset}
  end

  defp tile(tileset, label) do
    tileset.key |> Catalog.list_tiles_for() |> Enum.find(&(&1.label == label))
  end

  describe "a second seed" do
    test "keeps a setting written after the first one", %{tileset: tileset} do
      Catalog.put_tile_setting(tileset.id, "rock", "scaleY", 0.42)

      TileSource.seed()

      assert tile(tileset, "rock").settings["scaleY"] == 0.42,
             "the seed erased a value nobody seeds, which is how a tuned pose disappears"
    end

    test "keeps the facts its own rules wrote, on every tile that carries one", %{
      tileset: tileset
    } do
      before =
        for t <- Catalog.list_tiles_for(tileset.key),
            t.settings["display"] || t.settings["fadeNear"] || t.settings["collision"],
            into: %{},
            do: {t.label, t.settings}

      assert map_size(before) > 0,
             "no tile carries a rule's fact at all, so this run proves nothing"

      TileSource.seed()

      after_seed =
        for t <- Catalog.list_tiles_for(tileset.key), into: %{}, do: {t.label, t.settings}

      for {label, settings} <- before, {key, value} <- settings do
        assert after_seed[label][key] == value,
               "#{label}.#{key} was #{inspect(value)} and the seed made it #{inspect(after_seed[label][key])}"
      end
    end

    test "still corrects a value it DOES state", %{tileset: tileset} do
      Catalog.put_tile_setting(tileset.id, "rock", "display", "all-faces")

      TileSource.seed()

      assert tile(tileset, "rock").settings["display"] == "single",
             "a seed that cannot correct a wrong value is not a source of truth either"
    end
  end

  describe "removing a fact" do
    test "takes that one key and leaves the rest of the map alone", %{tileset: tileset} do
      Catalog.put_tile_setting(tileset.id, "rock", "scaleY", 0.42)

      Catalog.delete_tile_setting(tileset.id, "rock", "scaleY")

      settings = tile(tileset, "rock").settings
      refute Map.has_key?(settings, "scaleY"), "the key is still there"
      assert settings["display"] == "single", "removing one key took the others with it"
    end
  end
end
