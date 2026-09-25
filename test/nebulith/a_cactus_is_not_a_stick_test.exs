defmodule Nebulith.ACactusIsNotAStickTest do
  @moduledoc """
  A CACTUS IS NARROWED BY ITS THICKNESS, NEVER BY ITS WIDTH.

  His words: *"cactus look horrible, we used width instead of thickness to make it, and looks too skynny,
  before it looked way better."*

  ## What was measured, and what the first reading of it got wrong

  Every upright bar ran 0.24 to 0.34 on BOTH ground axes: `scaleX 0.78, scaleY 3.4, scaleZ 0.3` for the main
  trunk. The first correction widened `scaleX` and left `scaleZ` where it was, on the reading that `scaleZ`
  was the panel's Thickness. It is not, quite: `tileThicknessReach` reads a bare `scaleZ` as "thin toward
  EVERY face", so at 0.3 each ground axis asks `reachGroundQuad` for `hi = 0.3` against `lo = 0.7`, the two
  sides cross, and the guard that stops a block vanishing mid-drag leaves a `MIN_SPAN` sliver of 0.05 of the
  cell on BOTH axes. That is a 2px line 85px tall. Measured off the render sheet, next to a barrel cactus
  that carries no `scaleZ` and draws 40px across at `scaleX` 0.72.

  So widening the width could never have shown up. A bar is thin the way a TRUNK is thin, which is the same
  correction in the same words (*"I REQUESTED TO EDIT THE THICKNES AND YOU CHANGED THE WITH"*): full width
  across, and a DIRECTED reach pulling in the axis that goes into the screen.

  `ACactusDrawsAsWideAsItIsBuiltTest` is the other half of this, in the browser, on the draw's own geometry.
  These two together are the rule: this one says what the catalog holds, that one says what the screen got.
  """
  use Nebulith.DataCase, async: false

  alias Nebulith.Catalog
  alias Nebulith.Catalog.TileSource

  # `reachGroundQuad` pairs these two on the +row axis, the one going into the screen.
  @into_screen ~w(left-down right-up)

  setup do
    TileSource.seed()
    :ok
  end

  test "no cactus bar is thinned by a bare scaleZ, which thins it toward every face at once" do
    collapsed =
      for comp <- cactuses(),
          cell <- comp.cells,
          s = cell.settings || %{},
          amount = s["scaleZ"],
          is_number(amount) and amount > 0 and amount < 1,
          not is_binary(s["thicknessDir"]),
          do: "#{comp.name}: #{cell.label} carries scaleZ #{amount} and names no direction"

    assert collapsed == [],
           """
           #{length(collapsed)} cactus bar is thinned toward every face at once, which collapses its span on
           BOTH ground axes and draws it as a line:
             #{Enum.join(collapsed, "\n  ")}
           """
  end

  test "every upright is full width across, because width is the axis you look at" do
    narrow =
      for comp <- cactuses(),
          cell <- comp.cells,
          s = cell.settings || %{},
          width = s["scaleX"],
          height = s["scaleY"],
          is_number(width) and is_number(height),
          # AN UPRIGHT, which is the case this is about: half again as tall as it is wide. A crossing bar is
          # wide and short by design, and an ARM is 0.44 of its trunk in the reference plate, so neither is
          # the thing he was looking at when he said it looks too skinny.
          height > width * 1.5,
          height > 1.5,
          width < 0.9,
          do: "#{comp.name}: #{cell.label} is #{width} across and #{height} tall"

    assert narrow == [],
           """
           #{length(narrow)} standing cactus bar is narrowed by its WIDTH, which is the control he said not
           to use:
             #{Enum.join(narrow, "\n  ")}
           """
  end

  test "a bar that was built thin is still thin INTO THE SCREEN, so widening it did not make it a cube" do
    # A BARREL IS NOT A BAR. It is a squat round thing whose depth SHOULD be full, and it was never the
    # complaint, so what this asks of is the cells built by `bar/6`: the saguaro's uprights and crossing bars,
    # and the prickly pear's pads, every one of which is a flat thing seen edge on. They are exactly the cells
    # that carried the bare `scaleZ`, so this is the same set, asked for the thing that replaced it.
    slabs =
      for comp <- cactuses(),
          cell <- comp.cells,
          cell.label in ~w(cactus_stem cactus_pad),
          s = cell.settings || %{},
          is_number(s["scaleY"]),
          do: {comp.name, cell.label, s["thickness"]}

    assert slabs != [], "no cactus bar carries a height, so this test measures nothing"

    fat =
      for {name, label, reach} <- slabs,
          not (is_map(reach) and Enum.all?(@into_screen, &(is_number(reach[&1]) and reach[&1] < 1))),
          do: "#{name}: #{label} states #{inspect(reach)}"

    assert fat == [],
           """
           #{length(fat)} cactus bar does not pull in the axis going into the screen, so widening it turned
           it into a cube rather than a slab:
             #{Enum.join(fat, "\n  ")}
           """
  end

  test "an arm is the share of its trunk the reference plate measures" do
    # `docs/references/SOURCES.md`, Cactus: the plate's saguaro is 25px of trunk and 11px of arm, so an arm
    # is 0.44 of its trunk. Pinned because it is the number that keeps the arms from reading as a second
    # trunk, and it came off the reference rather than out of the air.
    arms =
      for comp <- cactuses(),
          cell <- comp.cells,
          s = cell.settings || %{},
          pose = s["pose"] || %{},
          is_number(pose["dx"]) and abs(pose["dx"]) > 0.5,
          is_number(s["scaleY"]) and s["scaleY"] > 0.5,
          do: {comp.name, cell.label, s["scaleX"]}

    assert arms != [], "no saguaro has an arm standing off its trunk, so this test measures nothing"

    wrong = for {n, l, w} <- arms, w > 0.6, do: "#{n}: #{l} is #{w} across"

    assert wrong == [],
           "#{length(wrong)} arm is as thick as a trunk: #{Enum.join(wrong, ", ")}"
  end

  test "the saguaros are still there to measure" do
    names = for comp <- cactuses(), do: comp.name

    assert length(names) >= 4,
           "only #{length(names)} cactus composition exists, so the checks above prove little: " <>
             inspect(names)
  end

  defp cactuses do
    for comp <- Catalog.list_compositions(), String.starts_with?(comp.name, "cactus_"), do: comp
  end
end
