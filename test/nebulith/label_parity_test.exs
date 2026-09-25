defmodule Nebulith.LabelParityTest do
  @moduledoc """
  A LABEL HAS A PICTURE IN EVERY ART STYLE, AND PARITY IS A QUERY.

  *"at a base level an art style is just a tileset, that's it... they're just a tileset, a set of png
  images. The system will handle all tilesets globally, all rules from one art style apply to the other,
  the only difference is the tiles (pngs) that each tileset provides."*

  So the only thing an art style may differ in is the picture. A label present in one style and missing
  from another is a tile that vanishes when you switch styles, and until now finding one meant sweeping
  the catalog by hand. It is one query: any label whose count of tilesets is short of the total.

  The second case is the other half of the same rule. A tile with no picture at all has nothing to draw,
  and the renderer's answer to that has historically been to invent a character, which is the defect this
  whole model exists to remove.
  """
  use Nebulith.DataCase, async: false

  alias Nebulith.Catalog.TileSource

  setup do
    TileSource.seed()
    :ok
  end

  test "no label is missing from any tileset" do
    %{rows: rows} =
      Repo.query!("""
      SELECT t.label,
             count(DISTINCT t.tileset_id) AS have,
             (SELECT count(*) FROM tilesets) AS want
      FROM tiles t
      GROUP BY t.label
      HAVING count(DISTINCT t.tileset_id) < (SELECT count(*) FROM tilesets)
      ORDER BY t.label
      """)

    assert rows == [],
           "these labels are missing from a tileset, so they vanish when the art style changes:\n" <>
             Enum.map_join(rows, "\n", fn [label, have, want] ->
               "  #{label}: in #{have} of #{want}"
             end)
  end

  test "the catalog actually has more than one style, so the query above proves something" do
    %{rows: [[styles]]} = Repo.query!("SELECT count(*) FROM tilesets")
    assert styles >= 2, "only #{styles} tileset(s); parity across one style is not parity"
  end

  test "every tile has a picture" do
    %{rows: rows} =
      Repo.query!("""
      SELECT ts.key, t.label
      FROM tiles t
      JOIN tilesets ts ON ts.id = t.tileset_id
      LEFT JOIN tile_images i ON i.tile_id = t.id AND i.tileset_id = t.tileset_id
      WHERE i.id IS NULL
      ORDER BY ts.key, t.label
      LIMIT 40
      """)

    assert rows == [],
           "these tiles have no picture, so there is nothing to draw:\n" <>
             Enum.map_join(rows, "\n", fn [style, label] -> "  #{style}/#{label}" end)
  end

  test "a tile's picture is not silently a placeholder for a whole family" do
    # NOT an assertion about naming. An emoji ground tile is deliberately a flat coloured square shared by
    # many labels, with the colour coming from settings, so "the file is named after the label" is a rule
    # nobody set and would fail on about a hundred rows that are exactly right.
    #
    # What this records instead is the narrower thing: how many tiles wear a picture belonging to ANOTHER
    # NAMED tile. Measured at 16, all of them the emoji nine-slice tree pieces pointing at leaf_center.png
    # and trunk.png. In the emoji style nine distinct leaf pieces would all draw the same leaf, so this may
    # be deliberate. It is pinned at the measured number so the figure cannot grow unnoticed while the
    # question is open.
    %{rows: rows} =
      Repo.query!("""
      SELECT ts.key, t.label, i.image_path
      FROM tiles t
      JOIN tilesets ts ON ts.id = t.tileset_id
      JOIN tile_images i ON i.tile_id = t.id AND i.tileset_id = t.tileset_id
      WHERE EXISTS (
        SELECT 1 FROM tiles o
        WHERE o.tileset_id = t.tileset_id
          AND o.label <> t.label
          AND i.image_path LIKE '%/' || o.label || '.png'
      )
      ORDER BY ts.key, t.label
      """)

    assert length(rows) <= 16,
           "#{length(rows)} tiles wear another named tile's picture, up from the 16 measured:\n" <>
             Enum.map_join(rows, "\n", fn [style, label, url] ->
               "  #{style}/#{label} -> #{url}"
             end)
  end
end
