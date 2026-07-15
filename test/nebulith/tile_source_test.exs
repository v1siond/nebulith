defmodule Nebulith.TileSourceTest do
  use Nebulith.DataCase

  alias Nebulith.Catalog
  alias Nebulith.Catalog.TileSource

  # Expected counts are derived straight from the source JSON so the test proves
  # every distinct label was ported (ascii `tiles` and `terrain` share a
  # tileset, so overlapping labels collapse to one row — hence the union).
  defp read_json(file) do
    :nebulith
    |> Application.app_dir("priv/repo/tilesets")
    |> Path.join(file)
    |> File.read!()
    |> Jason.decode!()
  end

  setup do
    ascii = read_json("ascii.json")
    emoji = read_json("emoji.json")

    expected_ascii =
      MapSet.new(Map.keys(ascii["tiles"]))
      |> MapSet.union(MapSet.new(Map.keys(ascii["terrain"])))
      |> MapSet.size()

    :ok = TileSource.seed()

    %{ascii: ascii, emoji: emoji, expected_ascii: expected_ascii, expected_emoji: map_size(emoji)}
  end

  test "ports every distinct ascii + emoji tile into its tileset", ctx do
    assert length(Catalog.list_tiles_for("ascii")) == ctx.expected_ascii
    assert length(Catalog.list_tiles_for("emoji")) == ctx.expected_emoji
  end

  test "ports both compositions with tree_small carrying 30 cells" do
    comps = Catalog.list_compositions()
    assert length(comps) == 2

    tree_small = Enum.find(comps, &(&1.name == "tree_small"))
    assert length(tree_small.cells) == 30
  end

  test "an ascii canopy tile carries its per-zone palette colors in settings" do
    canopy = Enum.find(Catalog.list_tiles_for("ascii"), &(&1.label == "leaf_center"))

    assert canopy.color_role == "canopy"
    # spring is one of the palette zones; canopy resolves to that zone's shade array.
    assert canopy.settings["colors"]["spring"]
  end

  test "an emoji tile carries its color in settings" do
    grass = Enum.find(Catalog.list_tiles_for("emoji"), &(&1.label == "grass"))

    assert grass.emoji
    assert grass.settings["color"]
  end
end
