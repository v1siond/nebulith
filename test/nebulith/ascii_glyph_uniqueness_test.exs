defmodule Nebulith.AsciiGlyphUniquenessTest do
  @moduledoc """
  PERMANENT guard against "fake" ascii tiles.

  Measured at the time: **29 of 358 ascii tiles had no baked PNG at all** (those drew the literal `?`), and
  **170 more drew a byte-identical copy of another tile's picture** because they shared a glyph, `rose`,
  `tulip`, `sunflower` and `hibiscus` were one `❀` plate, `oak-tree`, `palm-tree` and `pine-tree` one `♣`.

  The ascii PNG is rasterised FROM the glyph, so "two tiles, one glyph" and "two tiles, one picture" are the
  same statement. Asserting glyph uniqueness here catches the whole class at the source, in the DB, where
  the fix belongs, instead of after a bake.

  ## The two legitimate ways to share a glyph

    * an AUTOTILING family: `wall_brick_tl`, `wall_stone_tl`, `wall_wood_tl` and `fountain_tl` all draw `▛`
      because that glyph IS the top-left corner SHAPE. Material is the tile's colour, never its glyph
      (TILESET-AUTHORING: autotiling is `<base>_<edge>` pieces; wall variety is material tiles). The same
      holds for the `trunk_` column, the `canopy_` ring, the `tree_` parts and the `roof_top` caps.
    * `adult` / `person` / `player` are ONE human figure whose colour says which.

  Anything else sharing a glyph is a tile the user cannot tell apart from another tile, which is the defect.
  """
  use Nebulith.DataCase

  alias Nebulith.Catalog
  alias Nebulith.Catalog.TileSource

  @family_prefixes ~w(wall_ fountain_ trunk_ canopy_ tree_ roof_top)
  @people ~w(adult person player)

  @static_root Path.join([__DIR__, "..", "..", "priv", "static"])

  setup do
    TileSource.seed()
    :ok
  end

  defp family?(label), do: Enum.any?(@family_prefixes, &String.starts_with?(label, &1))

  test "every ascii tile that names a distinct thing draws a distinct glyph" do
    collisions =
      Catalog.list_tiles_for("ascii")
      |> Enum.group_by(& &1.glyph, & &1.label)
      |> Enum.map(fn {glyph, labels} ->
        {glyph, labels |> Enum.reject(&(family?(&1) or &1 in @people)) |> Enum.sort()}
      end)
      |> Enum.filter(fn {_glyph, labels} -> length(labels) > 1 end)
      |> Enum.sort()

    assert collisions == [],
           "ascii tiles sharing one glyph draw the SAME picture, pick a distinct glyph in a migration:\n" <>
             Enum.map_join(collisions, "\n", fn {g, ls} -> "  #{g} → #{Enum.join(ls, ", ")}" end)
  end

  test "every ascii tile has a baked PNG on disk, a missing one renders as `?`" do
    missing =
      Catalog.list_tiles_for("ascii")
      |> Enum.reject(&File.exists?(Path.join(@static_root, &1.image_url || "")))
      |> Enum.map(& &1.label)
      |> Enum.sort()

    assert missing == [],
           "ascii tiles whose image_url points at no file (add them to priv/tilegen/tiles.json and bake):\n" <>
             Enum.join(missing, ", ")
  end

  test "so does every emoji tile, the rule is per-style-agnostic" do
    missing =
      Catalog.list_tiles_for("emoji")
      |> Enum.reject(&File.exists?(Path.join(@static_root, &1.image_url || "")))
      |> Enum.map(& &1.label)
      |> Enum.sort()

    assert missing == [], "emoji tiles with no baked file:\n" <> Enum.join(missing, ", ")
  end

  test "no ascii tile is left without a glyph to rasterise" do
    blank =
      Catalog.list_tiles_for("ascii")
      |> Enum.filter(&(&1.glyph in [nil, ""]))
      |> Enum.map(& &1.label)
      |> Enum.sort()

    assert blank == [], "ascii tiles with no glyph:\n" <> Enum.join(blank, ", ")
  end

end

defmodule Nebulith.OneEngineManyStylesTest do
  @moduledoc """
  A LABEL owns everything but the picture.

  `grass` is called "Grass", is `terrain`, is walkable and is a flat slab, in EVERY style, because those
  are facts about grass, not about which pictures you are looking at. Only the image differs.
  """
  use Nebulith.DataCase

  alias Nebulith.Catalog
  alias Nebulith.Catalog.TileSource

  @static Path.join([__DIR__, "..", "..", "priv", "static"])

  setup do
    TileSource.seed()
    styles = Catalog.list_tilesets()
    {:ok, styles: styles, by_style: Map.new(styles, &{&1.key, Map.new(Catalog.list_tiles_for(&1.key), fn t -> {t.label, t} end)})}
  end

  test "every style carries the SAME set of labels, a style is a set of pictures, not a set of things", ctx do
    [first | rest] = Enum.map(ctx.by_style, fn {key, tiles} -> {key, MapSet.new(Map.keys(tiles))} end)
    {first_key, first_labels} = first

    for {key, labels} <- rest do
      only_here = labels |> MapSet.difference(first_labels) |> Enum.sort()
      only_there = first_labels |> MapSet.difference(labels) |> Enum.sort()

      assert only_here == [], "#{key} has labels #{first_key} does not: #{Enum.join(only_here, ", ")}"
      assert only_there == [], "#{first_key} has labels #{key} does not: #{Enum.join(only_there, ", ")}"
    end
  end

  test "a label's NAME, BUCKET, HEIGHT and COLLISION are the same in every style", ctx do
    [{_key, reference} | rest] = Map.to_list(ctx.by_style)

    drift =
      for {key, tiles} <- rest,
          {label, tile} <- tiles,
          ref = reference[label],
          ref != nil,
          diff = label_diff(ref, tile),
          diff != nil do
        "#{label} (#{key}): #{diff}"
      end

    assert drift == [],
           "these are facts about the LABEL, not the style, they must not differ:\n" <> Enum.join(drift, "\n")
  end

  defp label_diff(a, b) do
    cond do
      a.title != b.title -> "title #{inspect(a.title)} vs #{inspect(b.title)}"
      a.category != b.category -> "category #{inspect(a.category)} vs #{inspect(b.category)}"
      a.height != b.height -> "height #{inspect(a.height)} vs #{inspect(b.height)}"
      a.blocking != b.blocking -> "blocking #{inspect(a.blocking)} vs #{inspect(b.blocking)}"
      true -> nil
    end
  end

  test "no tile is left showing a raw slug in the picker (§3.5)", ctx do
    nameless =
      for {_key, tiles} <- ctx.by_style, {label, tile} <- tiles, tile.title in [nil, ""], do: label

    assert Enum.sort(Enum.uniq(nameless)) == [], "tiles with no title fall back to their raw slug"
  end

  test "a tile draws ITS OWN picture whenever one has been baked for it", ctx do
    wrong =
      for {key, tiles} <- ctx.by_style,
          {label, tile} <- tiles,
          own = "/tiles/#{key}/#{label}.png",
          tile.image_url != own,
          File.exists?(Path.join(@static, own)) do
        "#{key}/#{label} points at #{tile.image_url} but #{own} exists"
      end

    assert wrong == [],
           "a tile pointing at another tile's picture is the 'fake tile' defect:\n" <> Enum.join(wrong, "\n")
  end
end

defmodule Nebulith.UnitRolesTest do
  @moduledoc """
  Every `units` tile knows WHAT IT IS (§3.14b #11).

  The frontend used to classify 36 backend-owned slugs in two hardcoded Sets (`NON_ENTITY_UNIT`,
  `PERSON_SLUGS`) to decide whether a `units` tile places a person, a monster or a combat effect. Those are
  deleted: `seed_unit_roles/0` writes `settings.unitRole` on every row, so the catalog answers it.

  That makes catalog COMPLETENESS load-bearing, a row with no role now places nothing at all, on purpose
  (an unclassified tile is a seeding gap to fix here, not something the editor should guess at). So it is
  asserted here, where a forgotten seeder fails immediately.

  It is also what §4.5's Characters library needs in order to sub-group its 79 creatures at all
  (§3.6: "79 creatures in a 256px dropdown, no grouping").
  """
  use Nebulith.DataCase

  alias Nebulith.Catalog
  alias Nebulith.Catalog.TileSource

  @roles ~w(person enemy animal fx)

  setup do
    TileSource.seed()
    :ok
  end

  defp unit_tiles do
    for tileset <- Catalog.list_tilesets(),
        tile <- Catalog.list_tiles_for(tileset.key),
        tile.category == "units",
        do: {tileset.key, tile}
  end

  test "every units tile carries a role the editor understands" do
    bad =
      for {key, tile} <- unit_tiles(),
          role = (tile.settings || %{})["unitRole"],
          role not in @roles,
          do: "#{key}/#{tile.label} → #{inspect(role)}"

    assert bad == [],
           "a units tile with no valid role places NOTHING (the editor no longer guesses):\n" <>
             Enum.join(bad, "\n")
  end

  test "the monsters are the enemy-type list, not a taste call" do
    enemies = Map.keys(Nebulith.Catalog.EntitySource.resolution().enemy_type_slug)

    by_label =
      unit_tiles()
      |> Enum.filter(fn {key, _} -> key == "emoji" end)
      |> Map.new(fn {_, tile} -> {tile.label, (tile.settings || %{})["unitRole"]} end)

    # Every served enemy type that IS a tile label must be roled `enemy`, bat, spider and wolf included,
    # which is what settles them from data rather than opinion.
    for slug <- enemies, Map.has_key?(by_label, slug) do
      assert by_label[slug] == "enemy", "#{slug} is a served enemy type but is roled #{by_label[slug]}"
    end
  end

  test "a role is the same in every style, it is a fact about the LABEL" do
    drift =
      unit_tiles()
      |> Enum.group_by(fn {_key, tile} -> tile.label end, fn {key, tile} -> {key, (tile.settings || %{})["unitRole"]} end)
      |> Enum.filter(fn {_label, roles} -> roles |> Enum.map(&elem(&1, 1)) |> Enum.uniq() |> length() > 1 end)
      |> Enum.map(fn {label, roles} -> "#{label}: #{inspect(roles)}" end)

    assert drift == [], "a unit's role must not differ per style:\n" <> Enum.join(drift, "\n")
  end
end


defmodule Nebulith.UnitArtTest do
  @moduledoc """
  A UNIT IS A GRID OF CHARACTERS, not one character.

    > all unit tiles are wrong … human like units should look like the user player, animals, and other
    > units are also composition of ascii characters grouped to create a given element … a dog is not a
    > single character, is a set of characters combined to form a dog, that was then converted to png to be
    > a tile … we applied bad logic, you tried the ascii art the same as emoji.

  `ensure_distinct_glyphs/0` makes every tile's picture distinct by giving it its own CHARACTER. That is
  right for a wall piece and wrong for a living thing: it turned `man` into `♂`, `woman` into `♀`, `dog`
  into `d`. The engine is one, every style draws baked image tiles and animates them, but a style's
  pictures are AUTHORED differently, and ascii composes a grid where emoji places a pictograph.

  These assert that distinction in the DB, where the fix belongs. A single-character unit fails here.
  """
  use Nebulith.DataCase

  alias Nebulith.Catalog
  alias Nebulith.Catalog.TileSource

  # The three LIVING roles. `fx` is excluded on purpose: a slash, a bolt or an arrow IS one stroke, so a
  # combat effect is legitimately a single mark rather than a figure.
  @living ~w(person enemy animal)

  @static Path.join([__DIR__, "..", "..", "priv", "static"])

  setup do
    TileSource.seed()
    :ok
  end

  defp living_units do
    for tile <- Catalog.list_tiles_for("ascii"),
        tile.category == "units",
        (tile.settings || %{})["unitRole"] in @living,
        do: tile
  end

  test "the premise: the catalog really does serve living units" do
    assert length(living_units()) > 50
  end

  test "every living unit has a composed FIGURE, more than one row AND more than one column" do
    flat =
      for tile <- living_units(),
          frames = (tile.settings || %{})["artFrames"],
          rows = frames && List.first(frames),
          rows == nil or length(rows) < 2 or Enum.max(Enum.map(rows, &String.length/1)) < 2 do
        "#{tile.label} → #{inspect(rows)}"
      end

    assert flat == [],
           "a unit drawn as a single character is the Image #13 defect, author it in " <>
             "priv/repo/tilesets/ascii_unit_art.json:\n" <> Enum.join(flat, "\n")
  end

  test "every frame matches frame 0's dimensions, so a cycling unit never jitters" do
    misaligned =
      for tile <- living_units(),
          frames = (tile.settings || %{})["artFrames"],
          frames != nil,
          [base | rest] = frames,
          {frame, i} <- Enum.with_index(rest, 1),
          dims(frame) != dims(base) do
        "#{tile.label} frame #{i}: #{inspect(dims(frame))} vs #{inspect(dims(base))}"
      end

    assert misaligned == [],
           "an animation frame must be authored at the SAME row count and widths as frame 0:\n" <>
             Enum.join(misaligned, "\n")
  end

  test "every frame names a picture that EXISTS on disk" do
    missing =
      for tile <- living_units(),
          frame <- (tile.settings || %{})["frames"] || [],
          not File.exists?(Path.join(@static, frame)),
          do: "#{tile.label} → #{frame}"

    assert missing == [],
           "a frame pointing at a file that is not baked draws nothing (run priv/tilegen/bake.mjs):\n" <>
             Enum.join(missing, "\n")
  end

  test "a unit carries as many pictures as it has authored frames" do
    mismatched =
      for tile <- living_units(),
          settings = tile.settings || %{},
          art = settings["artFrames"],
          art != nil,
          length(settings["frames"] || []) != length(art) do
        "#{tile.label}: #{length(art)} authored frames vs #{length(settings["frames"] || [])} baked"
      end

    assert mismatched == [], Enum.join(mismatched, "\n")
  end

  test "the movement frame is a DIFFERENT drawing, an identical frame animates nothing" do
    static =
      for tile <- living_units(),
          [base | rest] = (tile.settings || %{})["artFrames"] || [[]],
          rest != [],
          Enum.any?(rest, &(&1 == base)),
          do: tile.label

    assert static == [], "these units' frame 1 is a copy of frame 0:\n" <> Enum.join(static, ", ")
  end

  defp dims(rows), do: Enum.map(rows, &String.length/1)
end
