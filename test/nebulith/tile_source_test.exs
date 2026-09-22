defmodule Nebulith.TileSourceTest do
  use Nebulith.DataCase

  alias Nebulith.Catalog
  alias Nebulith.Catalog.BuildingCompositions
  alias Nebulith.Catalog.TileSource
  alias Nebulith.DataMigration.AsciiPathFloorHeight
  alias Nebulith.DataMigration.FlatTilesMinimalHeight

  # Expected counts are derived straight from the source JSON so the test proves
  # every distinct label was ported (ascii `tiles` and `terrain` share a
  # tileset, so overlapping labels collapse to one row, hence the union).
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

  test "ports every distinct ascii + emoji tile into its tileset (the DB is a SUPERSET of the JSON)",
       ctx do
    ascii_labels = MapSet.new(Catalog.list_tiles_for("ascii"), & &1.label)
    emoji_labels = MapSet.new(Catalog.list_tiles_for("emoji"), & &1.label)

    json_ascii =
      ctx.ascii["tiles"]
      |> Map.keys()
      |> MapSet.new()
      |> MapSet.union(MapSet.new(Map.keys(ctx.ascii["terrain"])))

    # every JSON-sourced tile is ported; seed ALSO authors extra pieces in Elixir (trunk/leaf/canopy/building),
    # so the DB is a SUPERSET, asserting an exact count would be stale the moment a piece is added.
    assert MapSet.subset?(json_ascii, ascii_labels)
    assert MapSet.subset?(MapSet.new(Map.keys(ctx.emoji)), emoji_labels)
    assert MapSet.size(ascii_labels) >= ctx.expected_ascii
    assert MapSet.size(emoji_labels) >= ctx.expected_emoji
  end

  test "ports the json-sourced + elixir-authored compositions, each with cells and a footprint" do
    comps = Catalog.list_compositions()
    names = MapSet.new(comps, & &1.name)

    # the legacy JSON comps + the elixir-authored family are all present (a plain total count would be brittle
    # the moment a building or tree variant is added).
    assert MapSet.subset?(MapSet.new(~w(tree_small tree_dead tree bush well fountain)), names)

    # THE CELL COUNT IS NO LONGER ASSERTED. It was 30 for tree_small, which was the count BEFORE #30's
    # minimal-cells rebuild collapsed each vertical run of identical tiles into one block carrying a
    # `scaleY`. A composition's cell count is now an artefact of that optimisation, so pinning a number
    # asserts the optimisation has not improved, what matters is that it has cells and a real footprint.
    tree_small = Enum.find(comps, &(&1.name == "tree_small"))
    assert tree_small.cells != []
    assert tree_small.footprint_w >= 1 and tree_small.footprint_h >= 1
  end

  test "the tree is EXACTLY 2 tiles, a thin tall trunk + a bigger leaf; the bush is trunkless (1 tile)" do
    comps = Catalog.list_compositions()
    tree = Enum.find(comps, &(&1.name == "tree"))
    bush = Enum.find(comps, &(&1.name == "bush"))

    assert tree.footprint_w == 1 and tree.footprint_h == 1
    assert bush.footprint_w == 1 and bush.footprint_h == 1

    assert length(tree.cells) == 2, "the optimized tree is one trunk + one leaf"
    assert length(bush.cells) == 1, "the bush is a single leaf mound (no trunk)"

    trunk = Enum.find(tree.cells, &(&1.label == "trunk_mid"))
    leaf = Enum.find(tree.cells, &(&1.label == "leaf_center"))

    # The hand-tuned trunk is a thin tall post: 3.15 blocks at 60%, which is 1.89 blocks drawn.
    #
    # THE AUTHORING NUMBERS AND THE CELL ARE NO LONGER THE SAME NUMBERS, and that is the point. A Zoom on
    # the cell is folded into the placed tile's width and depth, so a trunk authored at 60% came out 0.6 of
    # a cell across on both ground axes and was thin because it had been shrunk. What the cell states now
    # is the height it draws at and the reaches that pull its faces in, and 3.15 x 0.6 lives in the seeder
    # where the species is described.
    assert trunk.level == 0
    assert trunk.scale == 1.0, "a trunk carries no Zoom, or it is thin by its width again"
    assert trunk.settings["scaleY"] == 1.89
    assert trunk.settings["thickness"]["left-up"] > 0, "a trunk is thin by its thickness"
    assert leaf.level == 2 and leaf.scale == 1.35 and leaf.settings["scaleY"] == 2.0

    # DIMENSION SANITY: the trunk draws narrower than the leaves it carries. Measured as drawn width, which
    # is what the eye compares, and not as a Zoom the trunk no longer has.
    trunk_face = (1.0 - trunk.settings["thickness"]["left-up"]) * trunk.scale
    assert trunk_face < leaf.scale

    # the bush's one cell is a leaf on the ground, no trunk anywhere.
    assert hd(bush.cells).label == "leaf_center" and hd(bush.cells).level == 0
    refute Enum.any?(bush.cells, &(&1.label in ["trunk", "trunk_mid", "trunk_base"]))

    refute Enum.any?(comps, &(&1.name in ["big_tree_a", "big_tree_b", "bush_a", "bush_b"]))
  end

  test "a broadleaf crown is a CIRCLE and a conifer crown stays a box" do
    comps = Catalog.list_compositions()

    crown = fn name ->
      Enum.find(comps, &(&1.name == name)).cells |> Enum.find(&(&1.label == "leaf_center"))
    end

    # THIS USED TO SAY THE PLAIN `tree` CARRIED NO SHAPE, and that was overtaken. A crown's outline comes from
    # the composition and not from the picture, because the renderer paints the shaded block and then lays the
    # tile image over it, so a transparent corner shows the block rather than cutting it: a round tree with no
    # `shape` is a leafy cube. Seven species were rounded off for that reason and `tree` is one of them.
    #
    # What is still true is that it is not blanket. A conifer and a cypress are CONES, and rounding them is as
    # wrong as boxing an oak, so they keep the box until the renderer can draw a cone. That distinction is the
    # thing worth pinning, and the frontend twin of this test (treeCrownShape) sweeps all fifteen species.
    for round <- ~w(tree tree_round tree_big tree_palm) do
      assert crown.(round).settings["shape"] == "circle",
             "#{round} is round-crowned and has no circle"
    end

    for cone <- ~w(tree_conifer tree_cypress) do
      refute Map.has_key?(crown.(cone).settings, "shape"),
             "#{cone} is a cone and must not be rounded off"
    end

    # TRUNK WIDTH IS DERIVED NOW, so the numbers are no longer the authored 0.85 / 1.2 / absent. What the
    # seeder guarantees is the SHARE (`@trunk_to_crown`): a trunk is at most about a quarter of its own
    # crown, *"trunks that are almost as thick as the leaf section, which is bad ... reduce thicknes and
    # improve proportions of ALL trees that have trunk"*.
    #
    # AND THE SPREAD SURVIVES THE SHARE. A first pass clamped the width instead of scaling it, and since the
    # share sits below even the skinniest authored value, every one of the twenty-one species came out at the
    # identical 0.585. Asserting the share alone would have passed on that, so the ORDER is pinned too: it is
    # the half that says the trees are still different from one another.
    trunk = fn name ->
      Enum.find(comps, &(&1.name == name)).cells |> Enum.find(&(&1.label == "trunk_mid"))
    end

    # HOW WIDE A CELL ACTUALLY DRAWS, as a share of its own cell, which is the only number the eye sees and
    # so the only one worth comparing. Two different controls can narrow a cell and they do not compose the
    # same way: Width scales the whole block, a thickness reach pulls one face in and leaves the rest. What
    # is left over after both is the face.
    # A REACH IS HOW FAR THE BLOCK EXTENDS TOWARD THAT FACE, which with only the two "up" faces pulled in
    # is the drawn width itself. This computed `1 - reach`, which is what the seeder was writing at the
    # time, and both were wrong the same way: a trunk meant to be a quarter of its cell drew at
    # three-quarters, and twenty-one species were squeezed into a band where they all looked alike.
    #
    # `reachOf` answers 1 for a face nobody set, so a cell with no thickness at all fills its width.
    drawn_face = fn cell ->
      reach = get_in(cell.settings, ["thickness", "left-up"]) || 1.0
      (cell.settings["scaleX"] || 1.0) * cell.scale * reach
    end

    tall_trunk = trunk.("tree_tall")
    stub_trunk = trunk.("tree_stub")
    std_trunk = trunk.("tree")

    # A TRUNK'S WIDTH IS A THICKNESS, NOT A SCALE. Width squashes the whole block, so a trunk at 0.40 drew
    # as a squished slab; the reaches pull two faces in and leave the block its own size. This used to read
    # `settings["scaleX"]` and kept passing on the old model after the seeder moved off it.
    #
    # AND IT IS MEASURED AS A DRAWN WIDTH, not as a reach. A reach is how much is pulled IN, so comparing
    # reaches ranks the species backwards: the skinniest trunk has the LARGEST one. Reading them directly
    # was right only while the number in that slot was still a width wearing a thickness's name.
    assert drawn_face.(tall_trunk) < drawn_face.(std_trunk),
           "a tall tree's trunk is the skinny one, so the authored spread has been flattened"

    assert drawn_face.(std_trunk) < drawn_face.(stub_trunk),
           "a stub's trunk is the thick one, so the authored spread has been flattened"

    # THE SHARE RULE IS GONE, and so is the assertion that enforced it.
    #
    # It read "a trunk is at most a quarter of its crown", which is a rule about ALL trees, and a rule
    # about all trees is exactly what made twenty-one species come out within a few pixels of each
    # other. An object is tiles somebody put together and its numbers are its own: a species that wants
    # a fat trunk states one, and nothing here overrules it.
    #
    # What replaces it is a stronger claim, because it is about the whole family rather than a bound:
    # the species must actually DIFFER. A single shared rule creeping back in would collapse this.
    widths =
      comps
      |> Enum.filter(&String.starts_with?(&1.name, "tree"))
      |> Enum.map(fn comp -> Enum.find(comp.cells, &(&1.label == "trunk_mid")) end)
      |> Enum.reject(&is_nil/1)
      |> Enum.map(drawn_face)
      |> Enum.uniq()

    assert length(widths) > 5,
           "every tree has the same trunk width, so something is overriding what each species states"

    heights =
      comps
      |> Enum.filter(&String.starts_with?(&1.name, "tree"))
      |> Enum.map(fn comp -> Enum.find(comp.cells, &(&1.label == "trunk_mid")) end)
      |> Enum.reject(&is_nil/1)
      |> Enum.map(& &1.settings["scaleY"])
      |> Enum.uniq()

    assert length(heights) > 5, "every tree has the same trunk height"
  end

  test "the fountain/well basin rim and water default to z_index 0 (draw priority is a capability, not a default)" do
    # Reverted. The z_index CAPABILITY stays (the
    # column + the depth-sort override + the editor Z-Index control), but nothing carries a non-zero draw
    # priority by default, the rim and its water both sort positionally at 0.
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

    # the drops are gone, the interior is a 3×3 grid of blue water only, drawn a bit bigger (scale ~1.15)
    refute Enum.any?(fountain.cells, &(&1.label == "water_jet"))
    assert length(water) == 9
    assert Enum.all?(water, &(&1.scale == 1.15))

    # Only the CENTER ROW of 3 animates; the other 6 are STATIC blue water (no animation).
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

  test "the DEFAULT lamp_post bulb LIGHTS UP at night, a steady night-triggered color glow, no flicker" do
    # The DEFAULT lamp bulb
    # now carries EXACTLY ONE animation, a `night`-triggered `color` glow that HOLDS a constant warm value
    # (`from` == `to`, so it's steady, NOT a tween and NOT a flicker). In day the render bridge drops the night
    # animation → the plain unlit bulb; at night the colour tints the bulb art warm → a lit, glowing bulb. The
    # flicker lives ONLY on the `lamp_post_failing` variant (below). The post base never animates.
    lamp_post = Enum.find(Catalog.list_compositions(), &(&1.name == "lamp_post"))
    lamp = Enum.find(lamp_post.cells, &(&1.label == "lamp"))
    post = Enum.find(lamp_post.cells, &(&1.label == "post"))

    refute post.animations, "the post base never animates"

    anims = lamp.animations

    assert is_list(anims) and length(anims) == 1,
           "the default bulb carries exactly the steady night-lit glow"

    [lit] = anims
    assert lit["id"] == "lamp_night_lit"

    assert lit["trigger"] == %{"on" => "night"},
           "night-gated, off (unlit) in day, on (lit) at night"

    assert lit["kind"] == "settings"

    # STEADY: a single `color` track whose `from` == `to` (a held value, not a tween), so the bulb reads a
    # constant warm glow at night with NO flicker, the failing variant is the only one that dips.
    assert [%{"setting" => "color", "from" => from, "to" => to}] = lit["tracks"]
    assert from == to, "steady glow, the colour holds constant (not a tween)"
    refute lit["ease"] == "flicker", "the DEFAULT bulb is steady-lit, never a flicker"

    # …and the bulb still ships its night `light` glow POOL so a normal lamp lights its cell too.
    assert is_map(lamp.settings["light"])
    assert lamp.settings["light"]["on"] == true
  end

  test "the lamp_post_failing bulb is night-LIT and ALSO carries ONE irregular flicker, a dying street light" do
    # Only a MINORITY of lamps
    # get this variant (the generator tags ~18%). Its bulb shares the DEFAULT night-lit `color` glow AND adds a
    # SINGLE opacity flicker with `ease: "flicker"`, the frontend's irregular, STEPPED failing-bulb envelope, NOT
    # a smooth sine yoyo. Both are night-gated, so the bulb rests in day and is lit-but-flickering at night; the
    # ground pool follows the flicker (see LIGHTING.md).
    failing = Enum.find(Catalog.list_compositions(), &(&1.name == "lamp_post_failing"))
    assert failing, "lamp_post_failing composition missing"

    lamp = Enum.find(failing.cells, &(&1.label == "lamp"))
    post = Enum.find(failing.cells, &(&1.label == "post"))

    # the failing variant shares the SAME structure as the steady one, a post base + a lit bulb on top.
    refute post.animations, "the post base never animates"
    assert is_map(lamp.settings["light"]) and lamp.settings["light"]["on"] == true

    anims = lamp.animations
    assert is_list(anims), "the failing lamp bulb must carry its animations"
    assert length(anims) == 2, "the shared night-lit glow PLUS the flicker (lit AND failing)"

    # it carries the SAME steady night-lit glow the default bulb does…
    lit = Enum.find(anims, &(&1["id"] == "lamp_night_lit"))
    assert lit, "the failing bulb is still LIT at night, it shares the default night glow"
    assert [%{"setting" => "color", "from" => from, "to" => to}] = lit["tracks"]
    assert from == to

    # …plus the flicker (a DIFFERENT setting, opacity, so the two compose: lit and flickering).
    flicker = Enum.find(anims, &(&1["id"] == "lamp_flicker"))
    assert flicker, "the failing bulb flickers"
    assert flicker["trigger"] == %{"on" => "night"}, "night-gated, off in day, on at night"
    assert flicker["kind"] == "settings"
    assert flicker["ease"] == "flicker", "irregular/stepped failing-bulb envelope, not sine"
    assert flicker["loop"] == true

    refute flicker["yoyo"],
           "a yoyo would smooth the flicker back into a pulse, the failing bulb must not yoyo"

    # ONE opacity track dipping toward off (the bulb dims/cuts; the pool dims on the same beat downstream).
    assert [%{"setting" => "opacity", "from" => 1, "to" => to}] = flicker["tracks"]
    assert to < 1
  end

  test "the lamp bulb carries a default LIGHT setting, a warm night ground glow pool (intensity + distance)" do
    # The lamp cell
    # ships a `light` in its settings jsonb, served verbatim, copied onto the placed asset by stampComposition, # so lamps light by DEFAULT (radius 3.2 cells; a SATURATED warm gold #ffc24d so the pool reads as clearly "on"),
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

    # the POST base is not a light source, no light setting on it.
    refute post.settings && Map.has_key?(post.settings, "light")
  end

  test "z_index defaults to 0 on EVERY composition cell (nothing carries a non-zero draw priority by default)" do
    # After the revert, no cell is seeded with a non-zero draw priority, trees, bushes, all buildings, the
    # light post, AND the fountain/well rim + water all sort positionally at the column default 0.
    cells = Enum.flat_map(Catalog.list_compositions(), & &1.cells)
    assert cells != []
    assert Enum.all?(cells, &(&1.z_index == 0))
  end

  test "the light post is a composition, a `post` base at level 0 + the `lamp` on top at level 1" do
    lamp_post = Enum.find(Catalog.list_compositions(), &(&1.name == "lamp_post"))
    assert lamp_post, "lamp_post composition missing"
    assert lamp_post.footprint_w == 1 and lamp_post.footprint_h == 1

    cells = Enum.sort_by(lamp_post.cells, & &1.level)
    assert Enum.map(cells, & &1.label) == ["post", "lamp"]
    assert Enum.map(cells, & &1.level) == [0, 1]

    post = Enum.find(cells, &(&1.label == "post"))
    lamp = Enum.find(cells, &(&1.label == "lamp"))

    # WHAT IT OCCUPIES IS THE ONLY STATEMENT about walking through a cell. `walkable` was a flag the
    # stamp turned into this very box list, so the box list is what the composition stores now.
    stops? = fn cell ->
      case get_in(cell.settings, ["collision"]) do
        nil -> true
        boxes -> boxes != []
      end
    end

    assert stops?.(post), "the post base blocks movement"
    refute stops?.(lamp), "the lamp sits overhead, you walk under it"
  end

  test "the lamp_post cells carry the tuned tile settings, a tall thin post + a single bulb lifted on top" do
    # The reference is images #45/#46: copy the settings of the post … like a real post"): the
    # POST is ONE cell shaped into a tall, thin pole by its OWN settings (Height ~7 = scaleY, Zoom ~0.3 = scale),
    # and the BULB is a SINGLE-display billboard zoomed down + lifted to sit ON TOP of the post (Zoom ~0.6 =
    # scale, y ~-1.8 = pose.dy). The composition STRUCTURE is style-agnostic, ONE global `compositions` row
    # serves BOTH the ascii + emoji tileset entries, so these per-cell settings hold for both styles by
    # construction; only the post/lamp ART differs.
    lamp_post = Enum.find(Catalog.list_compositions(), &(&1.name == "lamp_post"))
    post = Enum.find(lamp_post.cells, &(&1.label == "post"))
    lamp = Enum.find(lamp_post.cells, &(&1.label == "lamp"))

    # POST (level 0), a tall, thin pole shaped by its settings.
    assert post.level == 0
    assert_in_delta post.scale, 0.3, 0.001
    assert_in_delta post.settings["scaleY"], 7.0, 0.001

    # BULB (level 1), a single centered billboard, zoomed down + lifted onto the post's top.
    assert lamp.level == 1
    assert lamp.settings["display"] == "single"
    assert_in_delta lamp.scale, 0.6, 0.001
    assert_in_delta lamp.settings["pose"]["dy"], -1.8, 0.001
  end

  test "the light-post pieces (post + lamp) are real baked tiles in BOTH styles, no nil image_url" do
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

    # The ridge apex is ROOF: it lifts off with the rest of the roof (cutawayRoof), it does not merely ease
    # translucent. While it carried fadeNear, a hero under a PEAK column, the door columns of every gable
    # house, was under no cutaway tile, so the roof never came off.
    assert emoji_roof_top.settings["cutawayRoof"] == true
    refute emoji_roof_top.settings["fadeNear"]
  end

  test "an ascii canopy tile carries its per-zone palette colors in settings" do
    canopy = Enum.find(Catalog.list_tiles_for("ascii"), &(&1.label == "leaf_center"))

    assert canopy.color_role == "canopy"
    # spring is one of the palette zones; canopy resolves to that zone's shade array.
    assert canopy.settings["colors"]["spring"]
  end

  test "an emoji tile carries its color in settings" do
    grass = Enum.find(Catalog.list_tiles_for("emoji"), &(&1.label == "grass"))

    assert grass.image_url
    assert grass.settings["color"]
  end

  test "wall/window/door tiles get fadeNear; every ROOF label gets cutawayRoof, in both styles" do
    for style <- ["ascii", "emoji"] do
      tiles = Catalog.list_tiles_for(style)

      for label <- ~w(wall window door) do
        tile = Enum.find(tiles, &(&1.label == label))
        assert tile.settings["fadeNear"] == true, "#{style} #{label} missing fadeNear"
      end

      # The whole roof VOLUME lifts off as one, body, ridge apex, flat deck, parapet and rooftop unit alike.
      # A roof that only eased translucent (or, for the apex, did nothing) left the hero unable to see the
      # inside of the building they were standing in.
      for label <- ~w(roof roof_top flat_roof parapet rooftop_unit) do
        tile = Enum.find(tiles, &(&1.label == label))
        assert tile, "#{style} #{label} missing"
        assert tile.settings["cutawayRoof"] == true, "#{style} #{label} missing cutawayRoof"
        refute tile.settings["fadeNear"], "#{style} #{label} should not have fadeNear"
      end
    end
  end

  # every template handles its floor the way the meadow does, colour on one flat tile.
  test "the flat floor is served in both styles: walkable terrain, level with the ground, its own picture" do
    for style <- ["ascii", "emoji"] do
      floor = Enum.find(Catalog.list_tiles_for(style), &(&1.label == "floor"))
      assert floor, "#{style} serves no flat floor"
      assert floor.category == "terrain"
      assert (floor.settings["collision"] || []) == [], "the flat floor is what you walk on"
      assert floor.height == 0.0
      assert floor.title == "Floor"

      on_disk = Application.app_dir(:nebulith, Path.join("priv/static", floor.image_url))

      assert File.exists?(on_disk),
             "#{style} floor points at #{floor.image_url}, which was never baked"
    end

    ascii = Map.new(Catalog.list_tiles_for("ascii"), &{&1.label, &1})

    # Same assertion, on the field that now holds the picture: the ascii png used to be rasterised FROM
    # the glyph, so "two tiles, one glyph" and "two tiles, one picture" were the same statement. Only the
    # second half still exists, and it is the half that mattered.
    refute ascii["floor"].image_url == ascii["meadow"].image_url,
           "the floor and the meadow draw the same picture"
  end

  # trees, buildings and any exterior element that can hide the player fade when you're close.
  test "trees and standing exterior tiles fade near the hero, flowers and markers stay solid" do
    for style <- ["ascii", "emoji"] do
      tiles = Map.new(Catalog.list_tiles_for(style), &{&1.label, &1})

      for label <-
            ~w(leaf_center trunk_mid canopy_c tree_top oak-tree bush boulder house castle tower fountain lamp),
          Map.has_key?(tiles, label) do
        assert tiles[label].settings["fadeNear"] == true,
               "#{style} #{label} does not fade near the hero"
      end

      for label <- ~w(rose tulip clover key hazard connector mushroom),
          Map.has_key?(tiles, label) do
        refute tiles[label].settings["fadeNear"],
               "#{style} #{label} fades, but it cannot hide anyone"
      end
    end
  end

  test "fading near the hero writes one key and leaves a tile's tuned settings alone" do
    ascii = Enum.find(Catalog.list_tilesets(), &(&1.key == "ascii"))
    Catalog.put_tile_setting(ascii.id, "leaf_center", "pose", %{"x" => 3})
    :ok = TileSource.ensure_fade_near()
    tile = Enum.find(Catalog.list_tiles_for("ascii"), &(&1.label == "leaf_center"))
    assert tile.settings["pose"] == %{"x" => 3}
    assert tile.settings["fadeNear"] == true
  end

  test "every tile carries its OWN height, and the SAME label carries the same one in every art style" do
    # The rule this file states and the one worth guarding:
    #
    # THE CLASSIFICATION LISTS ARE GONE, and they were the part contradicting that rule. This test used to
    # hardcode which labels are flat and which stand, which is the very type/category branch the model
    # forbids, and it had gone stale in two ways: it called `roof` flat and walkable, exactly the claim
    # COMBAT-AND-SYSTEMS-SPEC §9 forbids, and it called
    # `water` a flat floor when water is deliberately a height-1 block so ornaments stack on top of it.
    #
    # What replaces it is the ENGINE's own law: one label, one set of facts, a different picture per style.
    # A height that differs between ascii and emoji is a real defect; a height this test disagrees with is
    # not.
    ascii = Map.new(Catalog.list_tiles_for("ascii"), &{&1.label, &1.height})
    emoji = Map.new(Catalog.list_tiles_for("emoji"), &{&1.label, &1.height})

    shared = MapSet.intersection(MapSet.new(Map.keys(ascii)), MapSet.new(Map.keys(emoji)))
    assert MapSet.size(shared) > 100, "expected the two styles to share most labels"

    drift =
      shared
      |> Enum.filter(fn label -> ascii[label] != emoji[label] end)
      |> Enum.map(fn label -> "#{label}: ascii #{ascii[label]} vs emoji #{emoji[label]}" end)

    assert drift == [],
           "the same label must carry the same height in every style:\n  " <>
             Enum.join(drift, "\n  ")

    # Every tile HAS a height, and none is negative, the floor-vs-block boundary is a number, always present.
    for {label, height} <- ascii do
      assert height != nil, "#{label} carries no height"
      assert height >= 0, "#{label} has a negative height (#{height})"
    end

    # The one structural claim that is still true and still worth pinning: a STANDING object extrudes.
    for label <-
          ~w(wall house castle brick tower bank tree palm-tree rock boulder mushroom bush cactus potted-plant) do
      assert ascii[label] >= 1,
             "#{label} is a standing object, it must extrude into a block (height >= 1)"
    end
  end

  # THE DOORSTEP TEST IS GONE, with the thing it tested.
  #
  # It asserted that a building's entrance apron places a flat `path` tile. #49 removed the apron, once
  # every tile became a height-1 block the apron stood UP in front of the doors and blocked the doorway it
  # served, so no building places a `path` cell any more and `entrance_cells/2` had no caller but this.
  #
  # It also happened to be the only thing asserting `water` was flat, which is why removing it settles that
  # question rather than raising one: water is deliberately a height-1 terrain block so ornaments stack on
  # it (see the meadow layout, which says so), and it carries the same height in BOTH styles, which is the
  # rule that actually matters.

  test "AsciiPathFloorHeight puts a drifted ascii `path` back on the floor, settings untouched, idempotent" do
    # The live DB carries the pre-fix row (ascii `path` = a full block), a re-seed would clobber editor-tuned
    # poses, so the DATA fix ships as a data migration. It lands the SAME minimal flat height every other floor
    # tile already has (FlatTilesMinimalHeight), so the doorstep matches the road it joins.
    path = Enum.find(Catalog.list_tiles_for("ascii"), &(&1.label == "path"))
    settings_before = path.settings
    {1, _} = Catalog.set_tile_height(path.tileset_id, "path", 1.0)

    :ok = AsciiPathFloorHeight.run()
    fixed = Enum.find(Catalog.list_tiles_for("ascii"), &(&1.label == "path"))
    assert fixed.height == FlatTilesMinimalHeight.flat_height()
    assert fixed.settings == settings_before, "settings (colour/pose) survive the height-only fix"

    :ok = AsciiPathFloorHeight.run()

    assert Enum.find(Catalog.list_tiles_for("ascii"), &(&1.label == "path")).height ==
             FlatTilesMinimalHeight.flat_height()
  end

  # THE emoji.json RECONCILE test is gone.
  #
  # The DB is the source of truth. What is worth asserting about heights is asserted below, against the
  # seeded rows rather than against the file they came from.

  test "animals are UNITS/enemies, not nature; genuine nature (trees/rocks/plants) stays nature" do
    # User: "we have a bunch of enemy or unit tiles on the nature category, like bears, wolf, animals aren't
    # nature." seed() reads the category straight from emoji.json, so the recategorised animals land in `units`.
    emoji = Catalog.list_tiles_for("emoji")
    cat = fn label -> Enum.find(emoji, &(&1.label == label)).category end

    for label <- ~w(bear grey-wolf fox cow sheep horse rabbit deer owl butterfly cat dog) do
      assert cat.(label) == "units", "#{label} is an animal → belongs in units, not nature"
    end

    for label <- ~w(tree oak-tree rock boulder flower rose mushroom bush cactus potted-plant) do
      assert cat.(label) == "nature", "#{label} is genuine nature → stays in nature"
    end
  end

  test "reconcile_tile_categories moves a DRIFTED category back to emoji.json's, settings untouched" do
    # Pose-safe category sync (category COLUMN only), the same class of fix as the height reconcile. A tile
    # whose DB bucket drifted from emoji.json snaps back without a full reseed clobbering its poses.
    bear = Enum.find(Catalog.list_tiles_for("emoji"), &(&1.label == "bear"))
    settings_before = bear.settings

    {1, _} = Catalog.set_tile_category(bear.tileset_id, "bear", "nature")
    assert Enum.find(Catalog.list_tiles_for("emoji"), &(&1.label == "bear")).category == "nature"

    :ok = TileSource.reconcile_tile_categories()
    fixed = Enum.find(Catalog.list_tiles_for("emoji"), &(&1.label == "bear"))
    assert fixed.category == "units", "reconcile restores the emoji.json category (units)"
    assert fixed.settings == settings_before, "settings survive the category-only fix"
  end

  test "behavior settings don't clobber existing settings, and a roof cutaway stays on roofs" do
    ascii_tiles = Catalog.list_tiles_for("ascii")

    wall = Enum.find(ascii_tiles, &(&1.label == "wall"))
    assert wall.settings["colors"]
    assert wall.settings["fadeNear"] == true

    # A canopy FADES now: It still keeps its per-season colours
    # next to the new key, and it is never a roof, so it never lifts off.
    canopy = Enum.find(ascii_tiles, &(&1.label == "leaf_center"))
    assert canopy.settings["colors"]["spring"]
    assert canopy.settings["fadeNear"] == true
    refute canopy.settings["cutawayRoof"]

    grass = Enum.find(Catalog.list_tiles_for("emoji"), &(&1.label == "grass"))
    assert grass.settings["color"]
    refute grass.settings["fadeNear"]
    refute grass.settings["cutawayRoof"]
  end
end
