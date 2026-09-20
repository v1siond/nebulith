defmodule Nebulith.Catalog.AGroundPlantIsAPictureTest do
  @moduledoc """
  A GROUND PLANT IS A PICTURE OF A PLANT, NOT A CUBE OF PLANT.

  Measured on the live catalog before the fix: of the nineteen ground plants, **fourteen** said
  `display: "single"` and **five did not** (`clover`, `flower`, `wheat`, `fallen-leaf`, `maple-leaf`). All
  five are height 1.0, so each one drew as a solid block wearing the plant's picture on its top face. A
  `flower` takes its zone's colour, which is why a meadow's blooms came out as a grid of red, blue, purple
  and gold crates.

  Fourteen were right by accident: whoever authored those rows happened to write the key. `ensure_ground_plants/0`
  wrote `stackAt` and `occupies` and said nothing about how the thing draws, so a plant could be half
  described and nothing anywhere would say so.

  Four facts, one rule, one list:

      stackAt: 0        it stands at your feet, so the next tile lands on the ground and not on its head
      occupies: false   you walk through it
      display: single   it draws as ONE face
      transparent: true and the ground shows through that face

  This is the gate. It seeds and asks the catalog, so a plant that arrives with two of the four set fails
  here rather than on his screen.
  """
  use Nebulith.DataCase

  alias Nebulith.Catalog
  alias Nebulith.Catalog.TileSource

  setup do
    TileSource.seed()
    :ok
  end

  defp plants do
    for tileset <- Catalog.list_tilesets(),
        tile <- Catalog.list_tiles_for(tileset.key),
        TileSource.ground_plant?(tile.label),
        do: {tileset.key, tile}
  end

  describe "every ground plant states all four" do
    test "it draws as ONE face, and the ground shows through it" do
      rows = plants()
      assert length(rows) >= 19, "only #{length(rows)} ground plants, so this run proves little"

      blocks =
        for {style, tile} <- rows,
            (tile.settings || %{})["display"] != "single",
            do: "#{style}/#{tile.label}"

      assert blocks == [],
             "these draw as a solid block instead of a picture: #{inspect(Enum.uniq(blocks))}"

      opaque =
        for {style, tile} <- rows,
            (tile.settings || %{})["transparent"] != true,
            do: "#{style}/#{tile.label}"

      assert opaque == [],
             "these draw their face opaque, so the ground does not show through: #{inspect(Enum.uniq(opaque))}"
    end

    test "it stands at your feet and you walk through it" do
      rows = plants()

      standing =
        for {style, tile} <- rows,
            (tile.settings || %{})["stackAt"] != 0,
            do: "#{style}/#{tile.label}"

      assert standing == [], "these do not stack at their base: #{inspect(Enum.uniq(standing))}"

      solid =
        for {style, tile} <- rows,
            (tile.settings || %{})["collision"] not in [[], nil],
            do: "#{style}/#{tile.label}"

      assert solid == [], "these stop you walking through them: #{inspect(Enum.uniq(solid))}"
    end

    test "the five that were wrong are covered by name, so this cannot pass by an empty list" do
      # The exact labels measured wrong on the live catalog. Naming them means the case still fails if the
      # rule's list ever stops covering one of them, which a sweep over `ground_plant?/1` alone would not.
      by_label = Map.new(plants(), fn {_style, tile} -> {tile.label, tile.settings || %{}} end)

      for label <- ~w(clover flower wheat fallen-leaf maple-leaf) do
        assert Map.has_key?(by_label, label), "#{label} is no longer a ground plant"
        assert by_label[label]["display"] == "single", "#{label} draws as a block again"
      end
    end
  end
end
