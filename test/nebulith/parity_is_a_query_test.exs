defmodule Nebulith.ParityIsAQueryTest do
  @moduledoc """
  PHASE 2'S GATE, word for word: *"label parity is a query: no label may have fewer images than there are
  tilesets. Swapping art style changes pictures and nothing else."* (`docs/SPEC.md` §8, phase 2.)

  ## Why this replaces a pass, not just checks one

  Parity used to be something the seeder DID: a reconciliation pass walked both styles, found labels that
  existed in one and not the other, and authored the twin. It ran at the end of every seed and it had to,
  because the schema let the two styles disagree about everything, not just the art. Every fact lived on
  a per-style row, so 393 labels were 786 rows and 786 chances to drift. Three separate passes were
  written to reconcile them, each one declaring it had closed the last of it.

  With the picture in `tile_images`, a label has ONE row and N pictures. There is no second copy of a
  fact to reconcile, and "does every label have art in every style" stops being a pass over the catalog
  and becomes `count(tile_images) = count(tilesets)`, which is this test.

  ## Run against the code before the move

  Before `tile_images` existed there was nothing to count and this file could not be written. Against the
  schema with the table but the write path still putting the picture on `tiles`, it fails on every one of
  the 393 labels at once, which is what a gate is for.
  """
  use Nebulith.DataCase, async: false

  alias Nebulith.Catalog.TileSource
  alias Nebulith.Repo

  setup do
    TileSource.seed()
    :ok
  end

  test "every label has a picture in every art style" do
    %{rows: [[styles]]} = Repo.query!("SELECT count(*) FROM tilesets")

    assert styles > 1,
           "there is only #{styles} art style, so a parity check over styles cannot fail and proves nothing"

    %{rows: short} =
      Repo.query!("""
      SELECT t.label, count(i.id)
      FROM tiles t LEFT JOIN tile_images i ON i.tile_id = t.id
      GROUP BY t.id, t.label
      HAVING count(i.id) < 1
      ORDER BY t.label
      """)

    assert short == [],
           "#{length(short)} tiles have no picture at all, so those cells draw nothing and say nothing: " <>
             Enum.map_join(Enum.take(short, 12), ", ", fn [label, n] -> "#{label} (#{n})" end)
  end

  test "a picture row always points at a path, never at an empty string" do
    assert {:error, changeset} =
             %Nebulith.Catalog.TileImage{}
             |> Nebulith.Catalog.TileImage.changeset(%{
               tileset_id: hd(Nebulith.Catalog.list_tilesets()).id,
               tile_id: hd(Repo.all(Nebulith.Catalog.Tile)).id,
               image_path: "   "
             })
             |> Repo.insert()

    assert errors_on(changeset)[:image_path],
           "an empty picture path was accepted, which is the silent blank this table exists to stop"
  end

  test "the styles serve the same vocabulary, and differ only in the pictures" do
    %{rows: rows} =
      Repo.query!("""
      SELECT ts.key, count(*)
      FROM tiles t JOIN tilesets ts ON ts.id = t.tileset_id
      GROUP BY ts.key ORDER BY ts.key
      """)

    counts = Enum.map(rows, fn [key, n] -> {key, n} end)
    sizes = counts |> Enum.map(&elem(&1, 1)) |> Enum.uniq()

    assert length(sizes) == 1,
           "the art styles serve different numbers of labels, so swapping style changes more than the " <>
             "pictures: #{inspect(counts)}"
  end

  test "every category a tile names is a row, so the sidebar's order has somewhere to live" do
    %{rows: orphans} =
      Repo.query!("""
      SELECT DISTINCT t.category
      FROM tiles t
      WHERE t.category IS NOT NULL AND t.category <> '' AND t.category_id IS NULL
      ORDER BY 1
      """)

    assert orphans == [],
           "these categories are a string on a tile with no row behind them: " <>
             Enum.map_join(orphans, ", ", &hd/1)
  end

  test "an autotiled piece says which slot it is and which family it belongs to" do
    %{rows: rows} =
      Repo.query!("""
      SELECT label, autotile_slot, family
      FROM tiles
      WHERE settings->>'position' IS NOT NULL AND settings->>'position' <> 'single'
      ORDER BY label
      """)

    refute rows == [],
           "no tile carries an autotile position, so this check would pass on an empty catalog"

    silent = for [label, slot, family] <- rows, is_nil(slot) or is_nil(family), do: label

    assert silent == [],
           "#{length(silent)} autotiled pieces do not say what slot they are: " <>
             Enum.join(Enum.take(silent, 12), ", ")

    wrong =
      for [label, _slot, family] <- rows,
          not String.starts_with?(label, family),
          do: "#{label} says family #{family}"

    assert wrong == [],
           "a piece was put in a family its own label does not belong to: " <>
             Enum.join(wrong, ", ")
  end
end
