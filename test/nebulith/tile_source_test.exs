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

  test "the fountain/well basin rim and water default to z_index 0 (draw priority is a capability, not a default)" do
    # Reverted (Alexander: "just leave everything on 0 by default for now, it'll work fine; we'll only need
    # specific z-index once we start working composition optimization"). The z_index CAPABILITY stays (the
    # column + the depth-sort override + the editor Z-Index control), but nothing carries a non-zero draw
    # priority by default — the rim and its water both sort positionally at 0.
    for name <- ["fountain", "well"] do
      comp = Enum.find(Catalog.list_compositions(), &(&1.name == name))
      {water, rim} = Enum.split_with(comp.cells, &(&1.label == "water_c"))

      assert length(water) >= 3, "#{name} should have water cells"
      assert rim != []
      assert Enum.all?(water, &(&1.z_index == 0)), "#{name} water defaults to z_index 0"
      assert Enum.all?(rim, &(&1.z_index == 0)), "#{name} rim defaults to z_index 0"
    end
  end

  test "the fountain interior is all blue water (no water_jet drops), a bit bigger; only the center row of 3 carries the yoyo height-grow" do
    fountain = Enum.find(Catalog.list_compositions(), &(&1.name == "fountain"))
    water = Enum.filter(fountain.cells, &(&1.label == "water_c"))

    # the drops are gone — the interior is a 3×3 grid of blue water only, drawn a bit bigger (scale ~1.15)
    refute Enum.any?(fountain.cells, &(&1.label == "water_jet"))
    assert length(water) == 9
    assert Enum.all?(water, &(&1.scale == 1.15))

    # Only the CENTER ROW of 3 animates (Alexander: "in the 9 blocks version, the 3 in the center are the ones
    # to animate"); the other 6 are STATIC blue water (no animation).
    animated = Enum.filter(water, & &1.animations)
    assert length(animated) == 3
    assert length(water) - length(animated) == 6

    for cell <- animated do
      assert [grow] = cell.animations
      assert grow["id"] == "fountain_water_grow"
      assert grow["yoyo"] == true
      assert grow["loop"] == true
      assert grow["tracks"] == [%{"setting" => "height", "from" => 1, "to" => 4}]
    end
  end

  test "z_index defaults to 0 on EVERY composition cell (nothing carries a non-zero draw priority by default)" do
    # After the revert, no cell is seeded with a non-zero draw priority — trees, bushes, all buildings, the
    # light post, AND the fountain/well rim + water all sort positionally at the column default 0.
    cells = Enum.flat_map(Catalog.list_compositions(), & &1.cells)
    assert cells != []
    assert Enum.all?(cells, &(&1.z_index == 0))
  end

  test "the light post is a composition — a `post` base at level 0 + the `lamp` on top at level 1" do
    lamp_post = Enum.find(Catalog.list_compositions(), &(&1.name == "lamp_post"))
    assert lamp_post, "lamp_post composition missing"
    assert lamp_post.footprint_w == 1 and lamp_post.footprint_h == 1

    cells = Enum.sort_by(lamp_post.cells, & &1.level)
    assert Enum.map(cells, & &1.label) == ["post", "lamp"]
    assert Enum.map(cells, & &1.level) == [0, 1]

    post = Enum.find(cells, &(&1.label == "post"))
    lamp = Enum.find(cells, &(&1.label == "lamp"))
    refute post.walkable, "the post base blocks movement"
    assert lamp.walkable, "the lamp sits overhead (walkable)"
  end

  test "the light-post pieces (post + lamp) are real baked tiles in BOTH styles — no nil image_url" do
    for style <- ["ascii", "emoji"], label <- ["post", "lamp"] do
      tile = Enum.find(Catalog.list_tiles_for(style), &(&1.label == label))
      assert tile, "#{style} missing #{label} tile"
      assert tile.image_url not in [nil, ""], "#{style} #{label} must carry a baked image_url"
    end
  end

  test "the generic roof_top apex cap has an emoji twin (cross-style parity fix)" do
    emoji_roof_top = Enum.find(Catalog.list_tiles_for("emoji"), &(&1.label == "roof_top"))
    assert emoji_roof_top, "emoji roof_top parity twin missing"
    assert emoji_roof_top.image_url == "/tiles/emoji/roof_top.png"
    # walkable apex cap that eases translucent near the hero (inherits roof_top's fadeNear)
    assert emoji_roof_top.settings["fadeNear"] == true
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
