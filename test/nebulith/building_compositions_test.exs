defmodule Nebulith.BuildingCompositionsTest do
  @moduledoc """
  The building-composition RULES (#30 minimal cells + #31 symmetric facades), asserted on the authored DATA
  (Nebulith.Catalog.BuildingCompositions) — not pixels. These are the source-of-truth guards for every seeded
  building.
  """
  use ExUnit.Case, async: true

  alias Nebulith.Catalog.BuildingCompositions

  @all ~w(house_3 house_4 house_5 store_5 office_5 stone_building hospital_6 big_house_6 temple_8 cathedral_7 castle_12)
  # GABLE buildings pair a roof BODY + APEX in ONE material (one colour); flat-roof shops (store/office) are excluded.
  @gable ~w(house_3 house_4 house_5 stone_building hospital_6 big_house_6 temple_8 cathedral_7 castle_12)
  # The OLD per-level stacked cell counts (before the height-collapse rebuild) — the #30 win is measured against them.
  @old_cell_counts %{
    "house_3" => 56,
    "house_4" => 72,
    "house_5" => 92,
    "store_5" => 77,
    "office_5" => 122,
    "stone_building" => 92,
    "hospital_6" => 112,
    "big_house_6" => 112,
    "temple_8" => 176,
    "cathedral_7" => 155,
    "castle_12" => 396
  }
  # The single {body, apex} roof material each gable building may use — a mixed roof would carry labels from two.
  @roof_pairs [
    MapSet.new(["roof", "roof_top"]),
    MapSet.new(["roof_slate", "roof_top_slate"]),
    MapSet.new(["roof_hospital", "roof_top_hospital"])
  ]

  defp comp(name), do: BuildingCompositions.all() |> Map.fetch!(name)

  # Expand a (possibly scaleY-collapsed) cell back to the per-level tiles it covers: a cell at `level` with
  # `settings.scaleY = n` occupies levels level..level+n-1 (the render draws one block that tall).
  defp expand(c) do
    span =
      case Map.get(c, :settings) do
        %{"scaleY" => s} -> trunc(s)
        _ -> 1
      end

    for l <- c.level..(c.level + span - 1), do: {c.dx, c.dy, l, c.label}
  end

  defp expanded(cells), do: Enum.flat_map(cells, &expand/1)

  # The label on a given FACE (min dy = back, max dy = front) at column dx / level, or nil.
  defp face_label(tiles, face, dx, level) do
    at = Enum.filter(tiles, fn {cdx, _cdy, cl, _l} -> cdx == dx and cl == level end)

    case at do
      [] ->
        nil

      _ ->
        {_, _, _, label} =
          Enum.reduce(at, fn {_, dy, _, _} = a, {_, bdy, _, _} = b ->
            keep = if face == :front, do: dy > bdy, else: dy < bdy
            if keep, do: a, else: b
          end)

        label
    end
  end

  defp window?(label), do: is_binary(label) and String.starts_with?(label, "window")
  defp wall?(label), do: is_binary(label) and String.starts_with?(label, "wall")

  # A window shows at (dx, level) if EITHER face carries one (some buildings window the front only, others
  # front+back; the door only ever suppresses the CENTRED columns, so the union stays symmetric).
  defp window_at?(tiles, dx, level),
    do: window?(face_label(tiles, :front, dx, level)) or window?(face_label(tiles, :back, dx, level))

  defp window_cols(tiles, w, level) do
    for dx <- 0..(w - 1), window_at?(tiles, dx, level), do: dx
  end

  defp window_levels(tiles, w, max_level) do
    for level <- 0..max_level,
        Enum.any?(0..(w - 1), &window_at?(tiles, &1, level)),
        do: level
  end

  describe "#31 symmetric facades — windows mirror across the centreline, edges are walls" do
    for name <- @all do
      test "#{name}: window grid is bilaterally symmetric, edge-walled, min wall·window·wall, aligned across floors" do
        c = comp(unquote(name))
        w = c.footprint_w
        tiles = expanded(c.cells)
        max_level = tiles |> Enum.map(fn {_, _, l, _} -> l end) |> Enum.max()
        levels = window_levels(tiles, w, max_level)

        assert levels != [], "#{unquote(name)} should carry windows"

        top_cols = window_cols(tiles, w, List.last(levels))
        assert top_cols != [], "#{unquote(name)} top floor should carry windows"

        for level <- levels do
          cols = window_cols(tiles, w, level)

          # BILATERAL SYMMETRY — a window at dx is mirrored by one at w-1-dx.
          for dx <- cols do
            assert (w - 1 - dx) in cols,
                   "#{unquote(name)} L#{level}: window at #{dx} has no mirror at #{w - 1 - dx} (cols=#{inspect(cols)})"
          end

          # EDGES ARE WALLS — never a window at column 0 or w-1 (min unit is wall·window·wall).
          refute 0 in cols, "#{unquote(name)} L#{level}: a window sits on the bare left edge"
          refute (w - 1) in cols, "#{unquote(name)} L#{level}: a window sits on the bare right edge"
          # flanked: the smallest facade still has a wall on each side of its window.
          assert wall?(face_label(tiles, :back, 0, level))
          assert wall?(face_label(tiles, :back, w - 1, level))

          # ALIGNED — every window column also appears on the top floor (windows stack, never wander).
          assert Enum.all?(cols, &(&1 in top_cols)),
                 "#{unquote(name)} L#{level}: window cols #{inspect(cols)} not aligned with top #{inspect(top_cols)}"
        end
      end
    end
  end

  describe "#31 door is centred on the facade" do
    for name <- @all do
      test "#{name}: the door column(s) are centred (symmetric about the facade centreline)" do
        c = comp(unquote(name))
        w = c.footprint_w
        tiles = expanded(c.cells)
        door_cols = for {dx, _dy, _l, "door"} <- tiles, uniq: true, do: dx
        assert door_cols != [], "#{unquote(name)} should have a door"
        # centred = the door span's midpoint is the facade midpoint (mirror-symmetric column set).
        assert Enum.sum(door_cols) * 2 == length(door_cols) * (w - 1),
               "#{unquote(name)}: door cols #{inspect(door_cols)} are not centred on width #{w}"
      end
    end
  end

  describe "#31 roof is a single consistent colour (one roof material, never mixed)" do
    for name <- @gable do
      test "#{name}: gable roof labels come from exactly ONE {body, apex} material pair" do
        c = comp(unquote(name))
        roof_labels = for %{label: l} <- c.cells, String.starts_with?(l, "roof"), into: MapSet.new(), do: l
        assert MapSet.size(roof_labels) > 0
        pair = Enum.find(@roof_pairs, &MapSet.subset?(roof_labels, &1))
        assert pair, "#{unquote(name)}: roof labels #{inspect(MapSet.to_list(roof_labels))} mix materials"
      end
    end
  end

  describe "#30 minimal cells — authored pre-collapsed (fewer stored cells than the old stack)" do
    for name <- @all do
      test "#{name}: stored cell count is below the old per-level stack and below the expanded level count" do
        c = comp(unquote(name))
        stored = length(c.cells)
        # Expanding every scaleY cell back to per-level tiles recovers the full stack — stored must be smaller,
        # i.e. at least one run actually collapsed.
        expanded_count = length(expanded(c.cells))
        assert stored < expanded_count, "#{unquote(name)}: nothing collapsed (stored=#{stored})"
        # And below the recorded OLD stacked count (the #30 win metric).
        old = Map.fetch!(@old_cell_counts, unquote(name))
        assert stored < old, "#{unquote(name)}: not reduced vs old stack (#{stored} !< #{old})"
      end
    end

    test "every collapsed cell carries an integer scaleY ≥ 2 (a 1-tall run stays a plain cell)" do
      scaleys =
        for name <- @all,
            c <- comp(name).cells,
            s = Map.get(c, :settings),
            is_map(s),
            Map.has_key?(s, "scaleY"),
            do: s["scaleY"]

      assert scaleys != [], "no cell collapsed — the height optimisation did not run"
      assert Enum.all?(scaleys, &(is_integer(&1) and &1 >= 2))
    end
  end
end
