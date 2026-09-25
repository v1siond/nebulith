defmodule Nebulith.AThinTileSaysWhichWayTest do
  @moduledoc """
  A TILE THAT IS THIN SAYS WHICH WAY IT IS THIN.

  `docs/SPEC.md` §8 phase 3 withdrew its third gate and said what replaced it: *"What the gate was really
  guarding, that Depth is a SIZE and never a thickness, is covered by the thickness reaches being their own
  four columns, and `bin/e2e specCompliance` fails if `scaleZ` reappears on a placed tile."*

  That gate did not exist. This is the catalogue half of it, and
  `Nebulith.E2E.SpecComplianceTest` is the half that watches a built map.

  ## What a bare `scaleZ` does

  `tileThicknessReach` reads `scaleZ` as the SHORTHAND for a thickness, and spells out what a bare one means:
  thin toward EVERY face. Each ground axis then asks `reachGroundQuad` for `hi = scaleZ` against
  `lo = 1 - scaleZ`, so at anything under a half the two sides cross, and the guard that stops a block
  vanishing mid-drag leaves a `MIN_SPAN` sliver of 0.05 of the cell on BOTH axes.

  Measured on the saguaro, whose bars were the only cells in the catalogue carrying one: 2 pixels across and
  85 tall, beside a barrel cactus at 40 across carrying none. *"cactus look horrible, we used width instead
  of thickness to make it, and looks too skynny"*, and that is it in pixels.

  So a `scaleZ` WITH a `thicknessDir` is the documented shorthand and is fine: the door ships one and is a
  panel in a wall rather than a sliver. A `scaleZ` with no direction is the defect, and it is asked of the
  whole catalogue here rather than of the one family that happened to be reported.
  """
  use Nebulith.DataCase, async: false

  # EACH SWEEP SEEDS THE CATALOGUE FIRST, and seeding it is the slow part, around half a minute. Four
  # read-only sweeps therefore cost four seeds, which runs past the 60 second default whenever anything else
  # is using the same Postgres. The sweeps are separate on purpose, so that a tile defect and a composition
  # defect are two answers rather than one, and the timeout is what moves instead.
  @moduletag timeout: 300_000

  alias Nebulith.Catalog
  alias Nebulith.Catalog.TileSource

  # THE CATALOGUE IS WALKED ONCE, not once per sweep. Each of these asks the same two questions of the same
  # rows, and re-reading them per test is the shape that timed out at 60 seconds the first time this ran
  # beside a browser suite on the same Postgres.
  setup do
    TileSource.seed()

    tiles =
      for %{key: key} <- Catalog.list_tilesets(), tile <- Catalog.list_tiles_for(key), do: tile

    cells =
      for comp <- Catalog.list_compositions(), cell <- comp.cells, do: {comp.name, cell}

    {:ok, tiles: tiles, cells: cells}
  end

  test "no tile in the catalogue is thinned toward every face at once", %{tiles: tiles} do
    bare =
      for tile <- tiles,
          s = tile.settings || %{},
          amount = s["scaleZ"],
          is_number(amount) and amount > 0 and amount < 1,
          not is_binary(s["thicknessDir"]),
          do: "#{tile.label} carries scaleZ #{amount} and names no direction"

    assert bare == [],
           """
           #{length(bare)} tile is thinned toward every face at once, which crosses its own span on both
           ground axes and draws it as a line however tall it is:
             #{Enum.join(Enum.uniq(bare), "\n  ")}
           """
  end

  test "no composition cell is thinned toward every face at once", %{cells: cells} do
    bare =
      for {name, cell} <- cells,
          s = cell.settings || %{},
          amount = s["scaleZ"],
          is_number(amount) and amount > 0 and amount < 1,
          not is_binary(s["thicknessDir"]),
          do: "#{name}: #{cell.label} carries scaleZ #{amount} and names no direction"

    assert bare == [],
           """
           #{length(bare)} composition cell is thinned toward every face at once, so the object it belongs to
           draws as a line:
             #{Enum.join(bare, "\n  ")}
           """
  end

  test "the catalogue is big enough for those two to mean something", %{tiles: tiles, cells: cells} do
    assert length(tiles) > 300 and length(cells) > 200,
           "the catalogue holds #{length(tiles)} tiles and #{length(cells)} composition cells, which is " <>
             "too little for the sweeps above to be evidence of anything"
  end

  test "a thin tile that DOES name its direction is left alone", %{tiles: tiles} do
    directed =
      for tile <- tiles,
          s = tile.settings || %{},
          is_number(s["scaleZ"]),
          is_binary(s["thicknessDir"]),
          do: tile.label

    # THE OTHER HALF OF THE RULE, and the reason the two sweeps above are written as they are. A door is a
    # thin panel in a wall and says so with a direction, so the shorthand is supported and the rule is about
    # the MISSING direction. Without this, deleting `scaleZ` outright would pass both sweeps above and lose a
    # working control, which is a fix that breaks the thing it was meant to protect.
    assert directed != [],
           "no tile in the catalogue uses the directed shorthand any more, so the two sweeps above are " <>
             "banning something nothing does, and they would pass just as well if thickness were deleted"
  end

end
