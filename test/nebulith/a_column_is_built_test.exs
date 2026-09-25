defmodule Nebulith.AColumnIsBuiltTest do
  @moduledoc """
  A COLUMN IS A COMPOSITION: a plinth, drums, a capital. It is not one tile stretched.

  His words: *"ruins forest still uses tiles that it shouldn't, like... a 'pilar' tile, when in reality it
  should be a composition/object"*.

  ## What was measured before

  The ruins generator dropped the bare `pillar` tile as a prop, 22 of them on a 40 x 40 build, and the tile
  draws on every face, so each column was a cube with a column printed on all four sides. Inside the two
  buildings that use columns, `temple_8` and `cathedral_7`, a column was ONE `pillar` cell carrying
  `scaleY: 6`, which `docs/OBJECT-CONSTRUCTION.md` names as the thing not to do: an object composes from
  pieces, never one tile bent with scale.
  """
  use Nebulith.DataCase, async: false

  alias Nebulith.Catalog
  alias Nebulith.Catalog.TileSource

  setup do
    TileSource.seed()
    :ok
  end

  test "the catalogue carries a pillar you can stamp" do
    names = for comp <- Catalog.list_compositions(), do: comp.name

    assert "pillar" in names,
           "there is no `pillar` composition, so a generator asking for one still drops the bare tile"
  end

  test "it is built from stacked pieces, each its own block" do
    pillar = Enum.find(Catalog.list_compositions(), &(&1.name == "pillar"))

    levels = pillar.cells |> Enum.map(& &1.level) |> Enum.uniq() |> Enum.sort()

    assert length(levels) >= 3,
           "the pillar occupies #{length(levels)} level(s), so it is not built in courses: #{inspect(levels)}"

    assert levels == Enum.to_list(0..(length(levels) - 1)),
           "its courses skip a level, so it has a gap in it: #{inspect(levels)}"

    # A PLINTH AND A CAPITAL, wider than what they carry. That is what makes it read as a column seated on
    # the ground and finished at the top, rather than as a post.
    by_level = Elixir.Map.new(pillar.cells, &{&1.level, &1})
    shaft = by_level[1]
    base = by_level[0]
    cap = by_level[Enum.max(levels)]

    assert base.scale > shaft.scale, "the plinth is no wider than the shaft it carries"
    assert cap.scale > shaft.scale, "the capital is no wider than the shaft under it"
  end

  test "no cell of it is one tile stretched into a column" do
    pillar = Enum.find(Catalog.list_compositions(), &(&1.name == "pillar"))

    stretched =
      for cell <- pillar.cells,
          tall = (cell.settings || %{})["scaleY"],
          is_number(tall) and tall > 1.5,
          do: "#{cell.label} at scaleY #{tall}"

    assert stretched == [],
           """
           #{length(stretched)} cell of the pillar is one tile stretched to make the shaft, which is the thing
           a composition exists instead of: #{Enum.join(stretched, ", ")}
           """
  end

  test "no composition anywhere carries a column as one stretched tile" do
    stretched =
      for comp <- Catalog.list_compositions(),
          cell <- comp.cells,
          cell.label == "pillar",
          tall = (cell.settings || %{})["scaleY"],
          is_number(tall) and tall > 1.5,
          do: "#{comp.name}: pillar at scaleY #{tall}"

    assert stretched == [],
           """
           #{length(stretched)} column is still one tile stretched into a shaft. Measured before: `temple_8`
           carried six of them at scaleY 6 and `cathedral_7` four at scaleY 5.
             #{Enum.join(stretched, "\n  ")}
           """
  end

  test "a building that had columns still has them, in courses" do
    temple = Enum.find(Catalog.list_compositions(), &(&1.name == "temple_8"))

    refute temple == nil, "temple_8 is gone, so this checks nothing"

    drums = for cell <- temple.cells, cell.label == "pillar", do: cell.level

    refute drums == [], "the temple lost its columns entirely"

    assert length(Enum.uniq(drums)) > 1,
           "every drum of the temple's columns sits at one level, so they were not built up: " <>
             inspect(Enum.sort(Enum.uniq(drums)))
  end

  test "the ruins generator asks the catalogue instead of dropping the tile" do
    source = File.read!("assets/game/engine/stageGenerator.ts")

    [colonnade | _] = String.split(source, "function stampColonnade")
    body = source |> String.split("function stampColonnade") |> Enum.at(1) |> String.slice(0, 1400)

    assert String.contains?(body, "stampIfComposed(ctx, col, row, 'pillar')"),
           "the colonnade does not ask the catalogue for a pillar, so it is still placing the bare tile"

    assert colonnade != ""
  end
end
