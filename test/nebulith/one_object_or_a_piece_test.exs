defmodule Nebulith.OneObjectOrAPieceTest do
  @moduledoc """
  A THING IS ONE OBJECT. A PIECE IS PART OF SOMETHING BUILT. NOTHING LOOSE DRAWS ON EVERY FACE.

  The report: *"ruins forest is still doing ornaments with multi face instead of single"* (image 283).

  ## What was measured before

  `ensure_ornaments/0` switched on a list of eleven label names. The ruins map strews `pillar`, which was not
  one of them, so a column came out as a cube with a column printed on each of its four faces. Counting the
  whole catalog: 36 of the 64 nature and decor tiles drew on every face, among them `crate`, `crystal`,
  `lamp`, `torch`, `key`, `hazard`, `coral` and eight whole-tree billboards.

  ## The rule is a question about the data, not a list

  A thing that is BUILT is built from pieces, and a piece is a cell of some composition: the trunk and the
  leaf of a tree, the stem of a cactus, the centre and the jets of a fountain. Everything else in the natural
  world is itself. So a label that appears in no composition's cells is one object and draws as one, and a
  list nobody has to remember to extend cannot fall behind the catalog.
  """
  use Nebulith.DataCase, async: false

  alias Nebulith.Catalog
  alias Nebulith.Catalog.TileSource

  setup do
    TileSource.seed()
    :ok
  end

  test "nothing loose in nature or decor draws on every face" do
    pieces = TileSource.composition_pieces()

    for tileset <- Catalog.list_tilesets() do
      cubes =
        for tile <- Catalog.list_tiles_for(tileset.key),
            TileSource.one_object?(tile, pieces),
            (tile.settings || %{})["display"] != "single",
            do: tile.label

      assert cubes == [],
             """
             #{length(cubes)} loose thing(s) in #{tileset.key} still draw on every face, so each reads as a
             crate with its picture printed on it:
               #{Enum.join(Enum.take(cubes, 15), ", ")}
             """
    end
  end

  test "a loose thing also drops its block shell, or the picture sits in a coloured box" do
    pieces = TileSource.composition_pieces()

    for tileset <- Catalog.list_tilesets() do
      boxed =
        for tile <- Catalog.list_tiles_for(tileset.key),
            TileSource.one_object?(tile, pieces),
            (tile.settings || %{})["transparent"] != true,
            do: tile.label

      assert boxed == [],
             "#{length(boxed)} loose thing(s) in #{tileset.key} keep their block shell: " <>
               Enum.join(Enum.take(boxed, 15), ", ")
    end
  end

  test "a PIECE is left alone, because a wall of a thing is not the thing" do
    pieces = TileSource.composition_pieces()

    assert MapSet.size(pieces) > 40,
           "only #{MapSet.size(pieces)} labels are composition cells, so this rule is classifying almost " <>
             "everything as loose"

    # The ones that must stay a piece, by what they ARE: a trunk is a section of tree, a stem a section of
    # cactus. If these ever stop being composition cells the rule above would flatten them to billboards.
    for piece <- ~w(trunk_mid cactus_stem water_c) do
      assert MapSet.member?(pieces, piece),
             "`#{piece}` is no longer any composition's cell, so it would be treated as one loose object"
    end
  end

  test "the rule reaches further than the list it replaced" do
    pieces = TileSource.composition_pieces()
    tiles = Catalog.list_tiles_for("emoji")

    loose = for tile <- tiles, TileSource.one_object?(tile, pieces), do: tile.label

    assert length(loose) > 11,
           "the rule covers #{length(loose)} labels, which is no more than the eleven names it replaced"
  end
end
