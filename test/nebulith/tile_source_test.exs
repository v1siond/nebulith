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

  test "ports every distinct ascii + emoji tile into its tileset (the DB is a SUPERSET of the JSON)", ctx do
    ascii_labels = MapSet.new(Catalog.list_tiles_for("ascii"), & &1.label)
    emoji_labels = MapSet.new(Catalog.list_tiles_for("emoji"), & &1.label)

    json_ascii =
      ctx.ascii["tiles"] |> Map.keys() |> MapSet.new() |> MapSet.union(MapSet.new(Map.keys(ctx.ascii["terrain"])))

    # every JSON-sourced tile is ported; seed ALSO authors extra pieces in Elixir (trunk/leaf/canopy/building),
    # so the DB is a SUPERSET — asserting an exact count would be stale the moment a piece is added.
    assert MapSet.subset?(json_ascii, ascii_labels)
    assert MapSet.subset?(MapSet.new(Map.keys(ctx.emoji)), emoji_labels)
    assert MapSet.size(ascii_labels) >= ctx.expected_ascii
    assert MapSet.size(emoji_labels) >= ctx.expected_emoji
  end

  test "ports the json-sourced + elixir-authored compositions, tree_small carrying 30 cells" do
    comps = Catalog.list_compositions()
    names = MapSet.new(comps, & &1.name)

    # the legacy JSON comps + the elixir-authored family are all present (a plain total count would be brittle
    # the moment a building or tree variant is added).
    assert MapSet.subset?(MapSet.new(~w(tree_small tree_dead tree bush well fountain)), names)

    tree_small = Enum.find(comps, &(&1.name == "tree_small"))
    assert length(tree_small.cells) == 30
  end

  test "the tree is EXACTLY 2 tiles — a thin tall trunk + a bigger leaf; the bush is trunkless (1 tile)" do
    comps = Catalog.list_compositions()
    tree = Enum.find(comps, &(&1.name == "tree"))
    bush = Enum.find(comps, &(&1.name == "bush"))

    assert tree.footprint_w == 1 and tree.footprint_h == 1
    assert bush.footprint_w == 1 and bush.footprint_h == 1

    assert length(tree.cells) == 2, "the optimized tree is one trunk + one leaf"
    assert length(bush.cells) == 1, "the bush is a single leaf mound (no trunk)"

    trunk = Enum.find(tree.cells, &(&1.label == "trunk_mid"))
    leaf = Enum.find(tree.cells, &(&1.label == "leaf_center"))

    # the user's hand-tuned settings: trunk = Zoom(scale) 0.6 / Height(scaleY) 3.15 (a thin tall post); leaf =
    # Zoom 1.35 / Height 2 (a bigger cube), lifted to level 2 so it sits ON the trunk top.
    assert trunk.level == 0 and trunk.scale == 0.6 and trunk.settings["scaleY"] == 3.15
    assert leaf.level == 2 and leaf.scale == 1.35 and leaf.settings["scaleY"] == 2.0

    # DIMENSION SANITY: the trunk is thinner + less zoomed than the leaves.
    assert trunk.scale < leaf.scale

    # the bush's one cell is a leaf on the ground — no trunk anywhere.
    assert hd(bush.cells).label == "leaf_center" and hd(bush.cells).level == 0
    refute Enum.any?(bush.cells, &(&1.label in ["trunk", "trunk_mid", "trunk_base"]))

    refute Enum.any?(comps, &(&1.name in ["big_tree_a", "big_tree_b", "bush_a", "bush_b"]))
  end

  test "the round variant ships a CIRCLE canopy (shape on the leaf cell); the square tree carries none" do
    comps = Catalog.list_compositions()
    round_leaf = Enum.find(comps, &(&1.name == "tree_round")).cells |> Enum.find(&(&1.label == "leaf_center"))
    square_leaf = Enum.find(comps, &(&1.name == "tree")).cells |> Enum.find(&(&1.label == "leaf_center"))

    assert round_leaf.settings["shape"] == "circle"
    refute Map.has_key?(square_leaf.settings, "shape")

    # skinny/thick TRUNK width is a per-variant setting (Alexander: "trunk width is a variable"): tall = 0.85
    # (skinnier), stub = 1.2 (thicker); the standard trunk omits Width entirely (default 1).
    tall_trunk = Enum.find(comps, &(&1.name == "tree_tall")).cells |> Enum.find(&(&1.label == "trunk_mid"))
    stub_trunk = Enum.find(comps, &(&1.name == "tree_stub")).cells |> Enum.find(&(&1.label == "trunk_mid"))
    std_trunk = Enum.find(comps, &(&1.name == "tree")).cells |> Enum.find(&(&1.label == "trunk_mid"))
    assert tall_trunk.settings["scaleX"] == 0.85
    assert stub_trunk.settings["scaleX"] == 1.2
    refute Map.has_key?(std_trunk.settings, "scaleX")
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

  test "the DEFAULT lamp_post bulb LIGHTS UP at night — a steady night-triggered color glow, no flicker" do
    # Alexander: "the bulb should change appearance when night mode = true, but it doesn't". The DEFAULT lamp bulb
    # now carries EXACTLY ONE animation — a `night`-triggered `color` glow that HOLDS a constant warm value
    # (`from` == `to`, so it's steady, NOT a tween and NOT a flicker). In day the render bridge drops the night
    # animation → the plain unlit bulb; at night the colour tints the bulb art warm → a lit, glowing bulb. The
    # flicker lives ONLY on the `lamp_post_failing` variant (below). The post base never animates.
    lamp_post = Enum.find(Catalog.list_compositions(), &(&1.name == "lamp_post"))
    lamp = Enum.find(lamp_post.cells, &(&1.label == "lamp"))
    post = Enum.find(lamp_post.cells, &(&1.label == "post"))

    refute post.animations, "the post base never animates"

    anims = lamp.animations
    assert is_list(anims) and length(anims) == 1, "the default bulb carries exactly the steady night-lit glow"

    [lit] = anims
    assert lit["id"] == "lamp_night_lit"
    assert lit["trigger"] == %{"on" => "night"}, "night-gated — off (unlit) in day, on (lit) at night"
    assert lit["kind"] == "settings"

    # STEADY: a single `color` track whose `from` == `to` (a held value, not a tween), so the bulb reads a
    # constant warm glow at night with NO flicker — the failing variant is the only one that dips.
    assert [%{"setting" => "color", "from" => from, "to" => to}] = lit["tracks"]
    assert from == to, "steady glow — the colour holds constant (not a tween)"
    refute lit["ease"] == "flicker", "the DEFAULT bulb is steady-lit, never a flicker"

    # …and the bulb still ships its night `light` glow POOL so a normal lamp lights its cell too.
    assert is_map(lamp.settings["light"])
    assert lamp.settings["light"]["on"] == true
  end

  test "the lamp_post_failing bulb is night-LIT and ALSO carries ONE irregular flicker — a dying street light" do
    # Alexander: "it should be more irregular, it's supposed to represent a failing bulb". Only a MINORITY of lamps
    # get this variant (the generator tags ~18%). Its bulb shares the DEFAULT night-lit `color` glow AND adds a
    # SINGLE opacity flicker with `ease: "flicker"` — the frontend's irregular, STEPPED failing-bulb envelope, NOT
    # a smooth sine yoyo. Both are night-gated, so the bulb rests in day and is lit-but-flickering at night; the
    # ground pool follows the flicker (see LIGHTING.md).
    failing = Enum.find(Catalog.list_compositions(), &(&1.name == "lamp_post_failing"))
    assert failing, "lamp_post_failing composition missing"

    lamp = Enum.find(failing.cells, &(&1.label == "lamp"))
    post = Enum.find(failing.cells, &(&1.label == "post"))

    # the failing variant shares the SAME structure as the steady one — a post base + a lit bulb on top.
    refute post.animations, "the post base never animates"
    assert is_map(lamp.settings["light"]) and lamp.settings["light"]["on"] == true

    anims = lamp.animations
    assert is_list(anims), "the failing lamp bulb must carry its animations"
    assert length(anims) == 2, "the shared night-lit glow PLUS the flicker (lit AND failing)"

    # it carries the SAME steady night-lit glow the default bulb does…
    lit = Enum.find(anims, &(&1["id"] == "lamp_night_lit"))
    assert lit, "the failing bulb is still LIT at night — it shares the default night glow"
    assert [%{"setting" => "color", "from" => from, "to" => to}] = lit["tracks"]
    assert from == to

    # …plus the flicker (a DIFFERENT setting — opacity — so the two compose: lit and flickering).
    flicker = Enum.find(anims, &(&1["id"] == "lamp_flicker"))
    assert flicker, "the failing bulb flickers"
    assert flicker["trigger"] == %{"on" => "night"}, "night-gated — off in day, on at night"
    assert flicker["kind"] == "settings"
    assert flicker["ease"] == "flicker", "irregular/stepped failing-bulb envelope, not sine"
    assert flicker["loop"] == true
    refute flicker["yoyo"], "a yoyo would smooth the flicker back into a pulse — the failing bulb must not yoyo"

    # ONE opacity track dipping toward off (the bulb dims/cuts; the pool dims on the same beat downstream).
    assert [%{"setting" => "opacity", "from" => 1, "to" => to}] = flicker["tracks"]
    assert to < 1
  end

  test "the lamp bulb carries a default LIGHT setting — a warm night ground glow pool (intensity + distance)" do
    # Alexander: "a regular setting that allows me to control the light intensity and distance". The lamp cell
    # ships a `light` in its settings jsonb — served verbatim, copied onto the placed asset by stampComposition —
    # so lamps light by DEFAULT (radius 3.2 cells; a SATURATED warm gold #ffc24d so the pool reads as clearly "on"),
    # and the editor's Light control edits them per placement. The post base never lights.
    lamp_post = Enum.find(Catalog.list_compositions(), &(&1.name == "lamp_post"))
    lamp = Enum.find(lamp_post.cells, &(&1.label == "lamp"))
    post = Enum.find(lamp_post.cells, &(&1.label == "post"))

    light = lamp.settings["light"]
    assert is_map(light), "the lamp bulb must ship a default light setting"
    assert_in_delta light["intensity"], 1.0, 0.001
    assert_in_delta light["distance"], 3.2, 0.001
    assert light["color"] == "#ffc24d"
    assert light["on"] == true

    # the POST base is not a light source — no light setting on it.
    refute post.settings && Map.has_key?(post.settings, "light")
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

  test "the lamp_post cells carry the tuned tile settings — a tall thin post + a single bulb lifted on top" do
    # Alexander built the reference (Images #45/#46, "copy the settings of the post … like a real post"): the
    # POST is ONE cell shaped into a tall, thin pole by its OWN settings (Height ~7 = scaleY, Zoom ~0.3 = scale),
    # and the BULB is a SINGLE-display billboard zoomed down + lifted to sit ON TOP of the post (Zoom ~0.6 =
    # scale, y ~-1.8 = pose.dy). The composition STRUCTURE is style-agnostic — ONE global `compositions` row
    # serves BOTH the ascii + emoji tileset entries — so these per-cell settings hold for both styles by
    # construction; only the post/lamp ART differs.
    lamp_post = Enum.find(Catalog.list_compositions(), &(&1.name == "lamp_post"))
    post = Enum.find(lamp_post.cells, &(&1.label == "post"))
    lamp = Enum.find(lamp_post.cells, &(&1.label == "lamp"))

    # POST (level 0) — a tall, thin pole shaped by its settings.
    assert post.level == 0
    assert_in_delta post.scale, 0.3, 0.001
    assert_in_delta post.settings["scaleY"], 7.0, 0.001

    # BULB (level 1) — a single centered billboard, zoomed down + lifted onto the post's top.
    assert lamp.level == 1
    assert lamp.settings["display"] == "single"
    assert_in_delta lamp.scale, 0.6, 0.001
    assert_in_delta lamp.settings["pose"]["dy"], -1.8, 0.001
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

  test "whole-object building tiles are 3D BLOCKS (height >= 1); terrain + facade parts stay FLAT (0)" do
    # THE PAINTER BUG: a painted wall/house/castle came in FLAT because its DB block height had drifted to 0.
    # Whole-object buildings must extrude into an all-faces iso cube by default; a floor/facade must not.
    emoji = Catalog.list_tiles_for("emoji")
    by = fn label -> Enum.find(emoji, &(&1.label == label)) end

    for label <- ~w(wall house castle brick tower bank altar pillar tent stadium torii-gate) do
      assert by.(label).height >= 1, "#{label} must be a 3D block (height >= 1)"
    end

    # a floor is NOT a block: terrain + thin facade parts + water features stay flat.
    for label <- ~w(grass water path road sand door window glass-window wooden-door fountain well roof) do
      assert by.(label).height == 0, "#{label} must stay flat (height 0)"
    end
  end

  test "reconcile_building_heights restores a drifted block height, leaving the tile's settings untouched" do
    # Proves the surgical, pose-safe fix: reconcile touches ONLY the height column, so editor-tuned poses
    # (which live in `settings`) survive — unlike a full upsert, which would replace_all and clobber them.
    wall = Enum.find(Catalog.list_tiles_for("emoji"), &(&1.label == "wall"))
    assert wall.settings["fadeNear"] == true # the tile's own behaviour/pose lives in settings

    # simulate the DB DRIFT that caused the painter bug: the block height silently fell to 0.
    {1, _} = Catalog.set_tile_height(wall.tileset_id, "wall", 0)
    assert Enum.find(Catalog.list_tiles_for("emoji"), &(&1.label == "wall")).height == 0

    # reconcile pulls the height back from emoji.json — height COLUMN only.
    :ok = TileSource.reconcile_building_heights()
    fixed = Enum.find(Catalog.list_tiles_for("emoji"), &(&1.label == "wall"))
    assert fixed.height >= 1, "reconcile restores the intended block height"
    assert fixed.settings["fadeNear"] == true, "settings (behaviour/pose) survive the height-only fix"
  end

  test "standing NATURE tiles are 3D BLOCKS (height >= 1); flat ground overlays stay FLAT (0)" do
    # User (Image #60): a painted palm tree / plant came in FLAT while buildings painted as blocks — the SAME
    # height-drift class. Standing nature objects (trees/rocks/crates/lamps/mushrooms/animals) must extrude;
    # flat ground overlays (flowers/leaves/floor items) must stay decals.
    emoji = Catalog.list_tiles_for("emoji")
    by = fn label -> Enum.find(emoji, &(&1.label == label)) end

    for label <- ~w(tree palm-tree pine-tree oak-tree rock boulder crate lamp mushroom bush cactus potted-plant cow) do
      assert by.(label).height >= 1, "#{label} (a standing object) must be a 3D block (height >= 1)"
    end

    for label <- ~w(flower rose tulip sunflower fallen-leaf maple-leaf clover hazard key) do
      assert by.(label).height == 0, "#{label} (a flat ground overlay) must stay flat (height 0)"
    end
  end

  test "reconcile_nature_heights restores a drifted standing-nature height, leaving settings untouched" do
    # Same surgical, pose-safe fix as buildings — height COLUMN only, so a tile's settings survive.
    palm = Enum.find(Catalog.list_tiles_for("emoji"), &(&1.label == "palm-tree"))
    settings_before = palm.settings

    {1, _} = Catalog.set_tile_height(palm.tileset_id, "palm-tree", 0)
    assert Enum.find(Catalog.list_tiles_for("emoji"), &(&1.label == "palm-tree")).height == 0

    :ok = TileSource.reconcile_nature_heights()
    fixed = Enum.find(Catalog.list_tiles_for("emoji"), &(&1.label == "palm-tree"))
    assert fixed.height >= 1, "reconcile restores the intended standing-nature block height"
    assert fixed.settings == settings_before, "settings (colour/pose) survive the height-only fix"
    # a flat overlay is NOT wrongly extruded by the reconcile
    assert Enum.find(Catalog.list_tiles_for("emoji"), &(&1.label == "flower")).height == 0
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
