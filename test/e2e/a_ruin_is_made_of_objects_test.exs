defmodule Nebulith.E2E.ARuinIsMadeOfObjectsTest do
  @moduledoc """
  EVERY LOOSE THING LYING IN A RUIN IS ONE OBJECT, not a cube wearing its picture on every face.

  His words: *"ruins forest is still doing ornaments with multi face instead of single"* (image 283).

  A cube painted with a rock on all four faces reads as a crate with a rock printed on it. `display: single`
  draws ONE picture standing in the cell and `transparent: true` drops the block shell, which is what makes a
  boulder read as a boulder. `TileSource.ensure_ornaments/0` writes both, for the labels it knows about.
  """
  use Nebulith.E2ECase, async: false

  @moduletag :e2e
  @moduletag :phase8
  @moduletag timeout: 900_000

  alias Nebulith.Catalog
  alias Nebulith.Catalog.TileSource
  alias Nebulith.E2E.GeneratePanel

  @size %{cols: 40, rows: 40}

  setup context do
    context
    |> Elixir.Map.put(:map, @size)
    |> a_signed_in_editor()
  end

  test "nothing loose in a ruin draws on every face", %{session: session} do
    # FALLEN COURTS, so the colonnade is certain. A ruin leads with a random region otherwise, and on a run
    # that came up "terraces" there was no column on the map and this read as a fix that had not landed.
    session
    |> GeneratePanel.choose_category("wilderness")
    |> GeneratePanel.choose_preset("Ruins")
    |> GeneratePanel.choose_option("Fallen courts")
    |> GeneratePanel.build()

    Browser.wait_until(
      session,
      &(Canvas.tile_count(&1) > 0),
      "the ruins to put something on the map",
      timeout: 180_000
    )

    on_map =
      for tile <- Canvas.tiles(session),
          tile["type"] != "floor",
          label = tile["label"] || tile["tileKey"],
          is_binary(label),
          uniq: true,
          do: label

    refute on_map == [], "the ruins map placed nothing standing at all"

    # WHAT SHOULD BE ONE OBJECT, asked of the catalog with the same rule the seeder writes by, so the browser
    # and the backend cannot disagree about what a loose thing is.
    pieces = TileSource.composition_pieces()

    single =
      for tile <- Catalog.list_tiles_for("emoji"),
          TileSource.one_object?(tile, pieces),
          into: %{},
          do: {tile.label, (tile.settings || %{})["display"]}

    cubes = for label <- on_map, single[label] && single[label] != "single", do: label

    assert cubes == [],
           """
           #{length(cubes)} loose thing(s) standing in the ruin draw on every face, so each reads as a crate
           with its picture printed on it: #{Enum.join(cubes, ", ")}
           """

    # …AND THE RUIN ACTUALLY PUT SOME DOWN, so this cannot pass on a map with nothing loose in it.
    loose = for label <- on_map, Elixir.Map.has_key?(single, label), do: label

    refute loose == [],
           "the ruin placed no loose object at all, so nothing here was checked. It placed " <>
             inspect(Enum.take(on_map, 12))

    # …AND ITS COLUMNS ARE BUILT, not dropped as a tile.
    #
    # NOT "the drums sit at several levels": `stampComposition` collapses a vertical run of the same tile into
    # one block sized by the run, which is its own performance rule and renders identically, so a built column
    # shows ONE drum block. What a bare tile can never produce is the plinth and the capital standing in the
    # same cell as the drum, so that is what this asks.
    columns =
      Browser.js(session, """
      (() => {
        const g = window.__nebulithGrid
        if (!g) return []
        return g.assets
          .filter(a => (a.label || a.tileKey) === 'pillar')
          .map(a => g.assets
            .filter(o => o.col === a.col && o.row === a.row && o.type !== 'floor')
            .map(o => o.label || o.tileKey))
      })()
      """) || []

    refute columns == [], "the ruin raised no column at all"

    bare =
      for stack <- columns,
          not Enum.any?(stack, &(&1 == "wall_stone_c")),
          do: stack

    assert bare == [],
           """
           #{length(bare)} column stands as a bare drum with no plinth and no capital, so the ruin is still
           dropping the `pillar` tile instead of stamping the composition. They hold
           #{inspect(Enum.take(bare, 3))}.
           """
  end
end
