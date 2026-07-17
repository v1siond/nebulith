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

  test "ports the json-sourced + elixir-authored compositions, tree_small carrying 30 cells" do
    comps = Catalog.list_compositions()
    assert length(comps) == 4

    tree_small = Enum.find(comps, &(&1.name == "tree_small"))
    assert length(tree_small.cells) == 30
  end

  test "ports the tree + bush compositions" do
    comps = Catalog.list_compositions()

    tree = Enum.find(comps, &(&1.name == "tree"))
    bush = Enum.find(comps, &(&1.name == "bush"))

    assert tree.footprint_w == 3
    assert tree.footprint_h == 1
    assert bush.footprint_w == 3
    assert bush.footprint_h == 1

    assert length(tree.cells) == 5
    assert length(bush.cells) == 4

    assert Enum.any?(tree.cells, &(&1.label == "trunk_base" and &1.level == 0))
    refute Enum.any?(bush.cells, &(&1.label in ["trunk", "trunk_base"]))

    refute Enum.any?(comps, &(&1.name in ["big_tree_a", "big_tree_b", "bush_a", "bush_b"]))
  end

  test "the fountain's water cells carry a draw-priority z_index; the rim/edge pieces stay 0" do
    # The bug fix (Images #34/#36): the water (basin `water_c` + raised `water_jet`) gets a high z_index so the
    # depth sort draws it IN FRONT of a wall behind the fountain. The rim keeps the default 0. Pure DATA on the cell.
    fountain = Enum.find(Catalog.list_compositions(), &(&1.name == "fountain"))
    {water, rim} = Enum.split_with(fountain.cells, &(&1.label in ["water_c", "water_jet"]))

    assert length(water) >= 6
    assert Enum.all?(water, &(&1.z_index == 10))
    assert rim != []
    assert Enum.all?(rim, &(&1.z_index == 0))
  end

  test "z_index defaults to 0 on every non-fountain-water cell (no regression to the depth sort)" do
    comps = Catalog.list_compositions()
    non_water = Enum.flat_map(comps, fn c -> Enum.reject(c.cells, &(&1.label in ["water_c", "water_jet"])) end)
    assert Enum.all?(non_water, &(&1.z_index == 0))
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

  test "wall/window/door/roof_top tiles get fadeNear, roof gets cutawayRoof, in both styles" do
    for style <- ["ascii", "emoji"] do
      tiles = Catalog.list_tiles_for(style)
      wall = Enum.find(tiles, &(&1.label == "wall"))

      assert wall.settings["fadeNear"] == true, "#{style} wall missing fadeNear"

      roof = Enum.find(tiles, &(&1.label == "roof"))
      assert roof.settings["cutawayRoof"] == true, "#{style} roof missing cutawayRoof"
      refute roof.settings["fadeNear"], "#{style} roof should not have fadeNear"
    end
  end

  test "behavior settings don't clobber existing settings and stay scoped to building tiles" do
    ascii_tiles = Catalog.list_tiles_for("ascii")

    wall = Enum.find(ascii_tiles, &(&1.label == "wall"))
    assert wall.settings["colors"]
    assert wall.settings["fadeNear"] == true

    canopy = Enum.find(ascii_tiles, &(&1.label == "leaf_center"))
    assert canopy.settings["colors"]["spring"]
    refute canopy.settings["fadeNear"]
    refute canopy.settings["cutawayRoof"]

    grass = Enum.find(Catalog.list_tiles_for("emoji"), &(&1.label == "grass"))
    assert grass.settings["color"]
    refute grass.settings["fadeNear"]
    refute grass.settings["cutawayRoof"]
  end
end
