defmodule Nebulith.E2E.Phase03ShapesTest do
  @moduledoc """
  PHASE 3: a tile draws the shape its columns state.

  Every one of these was a defect on screen before it was a check here: ground standing a block proud
  of the map, doors one block tall, trunks squashed by their width instead of thinned by their
  thickness, and roofs drawing as a row of separate blocks because the span axis was read from a key
  no row has ever had.

  It reads the GRID rather than the payload, for the same reason phase 3's round trip does: the
  question is what the renderer was handed, not what the API said.
  """
  use Nebulith.E2ECase, async: false

  @moduletag :e2e
  @moduletag :phase3

  alias Nebulith.E2E.GeneratePanel

  setup context do
    # A TOWN, and a big one. Doors and roofs come from buildings, and a wilderness generator plants
    # none, so a scenario about doors has to ask for a place that has them.
    a_signed_in_editor(Elixir.Map.put(context, :map, %{cols: 60, rows: 60}))
  end

  setup %{session: session} do
    %{shapes: session |> GeneratePanel.build_world("city", "Woodland city") |> shapes()}
  end

  describe "the ground" do
    test "lies flat, at the height its catalogue row states", %{shapes: shapes} do
      assert shapes.floors != [], "the world has no ground in it, so this proves nothing"

      tall = Enum.reject(shapes.floors, &(&1["height"] == 0))

      assert tall == [],
             "#{length(tall)} of #{length(shapes.floors)} ground tiles stand proud of the map, " <>
               "e.g. #{example(tall)}"
    end
  end

  describe "a door" do
    test "is two blocks tall and thin on exactly one side", %{shapes: shapes} do
      assert shapes.doors != [], "the town has no doors in it, so this proves nothing"

      short = Enum.reject(shapes.doors, &(&1["height"] == 2))

      assert short == [],
             "#{length(short)} doors are not 2 blocks tall, e.g. #{example(short)}"

      # Thin on ONE side is a door in a wall. Thin on all four is a matchstick standing in a doorway.
      squeezed = Enum.reject(shapes.doors, &(length(&1["reaches"]) == 1))

      assert squeezed == [],
             "#{length(squeezed)} doors are squeezed from more than one side, e.g. #{example(squeezed)}"
    end
  end

  describe "a tree trunk" do
    test "is thinned by its thickness, never by its width or its depth", %{shapes: shapes} do
      assert shapes.trunks != [], "the world has no trees in it, so this proves nothing"

      # WIDTH AND DEPTH ARE SIZES. Thinning a trunk with them shrinks the whole tile, art and all, so
      # the crown comes away from the trunk it is supposed to be sitting on.
      narrowed = Enum.filter(shapes.trunks, &(&1["width"] != 1))

      assert narrowed == [],
             "#{length(narrowed)} trunks are made thin by width, e.g. #{example(narrowed)}"

      flattened = Enum.filter(shapes.trunks, &(&1["depth"] != 1))

      assert flattened == [],
             "#{length(flattened)} trunks are made thin by depth, e.g. #{example(flattened)}"

      silent = Enum.filter(shapes.trunks, &(&1["reaches"] == []))

      assert silent == [],
             "#{length(silent)} trunks state no thickness at all, e.g. #{example(silent)}"

      stubby = Enum.filter(shapes.trunks, &(&1["height"] < 1))
      assert stubby == [], "#{length(stubby)} trunks are less than a block tall"
    end
  end

  describe "a roof" do
    test "spans its cells as one tile, not one block per cell", %{shapes: shapes} do
      assert shapes.roofs != [], "the town has no roofs on it, so this proves nothing"

      spanning = Enum.filter(shapes.roofs, &(&1["spanForward"] > 1))

      assert spanning != [],
             "not one of #{length(shapes.roofs)} roofs spans its cells, so every roof is drawing as a " <>
               "row of separate blocks. e.g. #{example(shapes.roofs)}"
    end
  end

  # AN ASSERTION MESSAGE IS BUILT WHETHER OR NOT IT IS USED, so reaching into the offending list with
  # `hd` blows up on the empty list, which is exactly the case where the check passed. The failure then
  # reads as an ArgumentError in the test rather than as the thing that was being measured.
  defp example([]), do: "none"
  defp example([first | _]), do: inspect(first)

  # THE GROUND IS THE FLOOR TYPE, not a list of labels that look like ground. Matching on a road prefix
  # swept up `road_marking_along_row`, which is a regular tile painted on the road and has every right
  # to stand a block tall, and the gate then reported the map broken because the probe was.
  #
  # The trunk match is `trunk_mid` on purpose: `tree_dead` stacks whole cubes and is a different
  # silhouette, and holding it to the tree factory's shape would be asking it to be a different tree.
  defp shapes(session) do
    raw =
      Browser.js(session, """
      (() => {
        const grid = window.__nebulithGrid
        if (!grid) return null
        const of = a => ({
          label: a.label ?? a.tileKey ?? a.type,
          type: a.type,
          height: a.height,
          width: a.width,
          depth: a.depth,
          reaches: a.thickness ? Object.entries(a.thickness).filter(([, v]) => typeof v === 'number' && v > 0) : [],
          spanForward: a.spanForward,
          spanAxis: a.spanAxis,
        })
        const all = grid.assets.map(of)
        const pick = re => all.filter(a => re.test(String(a.label)))
        return {
          total: all.length,
          floors: all.filter(a => a.type === 'floor'),
          doors: pick(/^door/),
          trunks: pick(/^trunk_mid/),
          roofs: pick(/^roof/),
        }
      })()
      """)

    assert is_map(raw), "the grid is not on the page, so nothing was built"

    %{
      total: raw["total"],
      floors: raw["floors"],
      doors: raw["doors"],
      trunks: raw["trunks"],
      roofs: raw["roofs"]
    }
  end
end
