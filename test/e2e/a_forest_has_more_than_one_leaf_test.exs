defmodule Nebulith.E2E.AForestHasMoreThanOneLeafTest do
  @moduledoc """
  A GENERATED FOREST PUTS DOWN MORE THAN ONE KIND OF LEAF.

  His words: *"we need to have more variance of trees, like we are using the same for all forest
  variations"*, recorded in `docs/references/SOURCES.md` beside the five images it was sent with, and
  again as *"a specific leaf tile per tree FAMILY, not per tree object"*.

  `Nebulith.ATreeFamilyHasItsOwnLeafTest` proves the CATALOG says so. This proves it reaches the ground:
  build a woodland on the real page and read back what the cells are actually holding. A species table
  that is correct and a generator that never asks for those species would pass the first and fail here,
  which is the shape every regression in this area has had.
  """
  use Nebulith.E2ECase, async: false

  @moduletag :e2e
  @moduletag :phase8
  @moduletag timeout: 600_000

  alias Nebulith.E2E.Browser
  alias Nebulith.E2E.Canvas
  alias Nebulith.E2E.GeneratePanel

  @size %{cols: 48, rows: 48}

  setup context do
    context
    |> Elixir.Map.put(:map, @size)
    |> a_signed_in_editor()
  end

  test "a woodland grows more than one family of tree", %{session: session} do
    session
    |> GeneratePanel.choose_category("wilderness")
    |> GeneratePanel.choose_preset("Woodland")
    |> GeneratePanel.build()

    Browser.wait_until(
      session,
      &(Canvas.tile_count(&1) > 0),
      "the woodland to put something on the map",
      timeout: 120_000
    )

    leaves =
      for label <- Canvas.tile_labels(session),
          String.starts_with?(label, "leaf"),
          do: label

    refute leaves == [], "the woodland grew no foliage at all"

    kinds = Enum.uniq(leaves)

    assert length(kinds) > 1,
           "every tree in the woodland drew the same leaf, which is the defect: #{inspect(kinds)}"

    # …AND NOT THE OLD SHARED ONE. `leaf_center` is the three characters `@&@` baked into a picture, and
    # it being back would mean the family table stopped being read on the way to the map.
    assert Enum.all?(kinds, &(&1 != "leaf_center")),
           "a tree is still drawing the shared leaf: #{inspect(kinds)}"
  end
end
