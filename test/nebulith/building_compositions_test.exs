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

  # The flat-roof shops (excluded from the gable set) — a deck of depth-spanned columns + one crown.
  @flat ~w(store_5 office_5)

  defp comp(name), do: BuildingCompositions.all() |> Map.fetch!(name)

  # A cell's settings map (nil when it carries none) — never raises on a settings-less cell.
  defp st(c), do: Map.get(c, :settings) || %{}

  # Every ROOF cell (gable body/apex, flat deck/parapet/crown) — the same set the frontend's isRoofLabel spans.
  defp roof_cell?(%{label: l}),
    do: String.starts_with?(l, "roof") or l in ["flat_roof", "parapet"]

  defp roof_cells(c), do: Enum.filter(c.cells, &roof_cell?/1)

  # The block HEIGHT (scaleY span) a cell renders — its authored scaleY or 1.
  defp cell_span(c) do
    case st(c) do
      %{"scaleY" => s} -> trunc(s)
      _ -> 1
    end
  end

  # The gable peak-height (in blocks) expected at column dx — the UNCHANGED silhouette formula (peak ≤ 3,
  # falling off from the centre). The roof-z-width collapse must preserve this per-column height exactly.
  defp gable_levels(dx, w) do
    center = (w - 1) / 2
    max_peak = min(3, div(w + 1, 2))
    max(1, max_peak - trunc(Float.floor(abs(dx - center))))
  end

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

  # The ENTRANCE apron of a composition — the ground cells authored on the row directly IN FRONT of the
  # facade (dy == footprint_h, one past the front wall row), where the frontend's driveway lands.
  defp entrance_cells(c), do: Enum.filter(c.cells, &(&1.dy == c.footprint_h))

  # The facade COLUMNS one entrance cell covers: its anchor `dx` plus its z-width span along +col
  # (`settings.depth`, `depthDir: "right-down"`). A plain cell covers its own column only.
  defp entrance_cols(cell) do
    span = Map.get(st(cell), "depth", 1)
    Enum.to_list(cell.dx..(cell.dx + span - 1))
  end

  # Every DOOR column the composition actually places — `door_cols/1` as realised in the authored data.
  defp door_columns(c) do
    for {dx, _dy, _l, "door"} <- expanded(c.cells), uniq: true, do: dx
  end

  # A window shows at (dx, level) if EITHER face carries one (some buildings window the front only, others
  # front+back; the door only ever suppresses the CENTRED columns, so the union stays symmetric).
  defp window_at?(tiles, dx, level),
    do:
      window?(face_label(tiles, :front, dx, level)) or
        window?(face_label(tiles, :back, dx, level))

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

          refute (w - 1) in cols,
                 "#{unquote(name)} L#{level}: a window sits on the bare right edge"

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

  describe "entrance matches the doors — the apron spans every door column (G7)" do
    for name <- @all do
      test "#{name}: the entrance covers EXACTLY the door columns" do
        c = comp(unquote(name))
        doors = c |> door_columns() |> Enum.sort()
        covered = c |> entrance_cells() |> Enum.flat_map(&entrance_cols/1) |> Enum.sort()

        assert covered == doors,
               "#{unquote(name)}: entrance covers #{inspect(covered)} but the doors are at #{inspect(doors)}"
      end

      test "#{name}: every entrance cell is a walkable ground tile on the row in front of the facade" do
        c = comp(unquote(name))
        cells = entrance_cells(c)
        assert cells != [], "#{unquote(name)} has no entrance in front of its door"

        for e <- cells do
          assert e.label == "path",
                 "#{unquote(name)}: entrance is #{e.label}, not the walkable path tile"

          assert e.level == 0, "#{unquote(name)}: the entrance must sit on the ground (level 0)"

          assert e.walkable == true,
                 "#{unquote(name)}: you must be able to walk onto the entrance"
        end
      end
    end

    test "a 1-door facade (house_3, odd width) gets ONE entrance block, no z-width" do
      c = comp("house_3")
      assert [e] = entrance_cells(c)
      assert door_columns(c) == [e.dx]
      refute Map.has_key?(st(e), "depth"), "a single-column entrance needs no z-width span"
    end

    test "a 2-door facade (house_4, even width) collapses to ONE entrance block of z-width 2" do
      c = comp("house_4")
      assert [e] = entrance_cells(c)
      assert st(e)["depth"] == 2

      assert st(e)["depthDir"] == "right-down",
             "the entrance spans the FACADE axis (+col), not the depth axis"

      assert entrance_cols(e) == Enum.sort(door_columns(c))
    end

    test "every even-width facade carries a 2-block entrance and every odd-width facade a 1-block one" do
      for name <- @all do
        c = comp(name)
        covered = c |> entrance_cells() |> Enum.flat_map(&entrance_cols/1)
        expected = if rem(c.footprint_w, 2) == 0, do: 2, else: 1

        assert length(covered) == expected,
               "#{name} (w=#{c.footprint_w}): entrance is #{length(covered)} blocks"
      end
    end
  end

  describe "the entrance RULE — door columns in, entrance blocks out" do
    alias Nebulith.Catalog.BuildingCompositions, as: BC

    test "1 door → 1 entrance block" do
      assert [%{dx: 4, dy: 4, level: 0, label: "path", walkable: true}] =
               BC.entrance_cells([4], 4)
    end

    test "2 contiguous doors → ONE entrance block of z-width 2" do
      assert [e] = BC.entrance_cells([2, 3], 4)
      assert e.dx == 2
      assert e.settings == %{"depth" => 2, "depthDir" => "right-down"}
    end

    test "3 contiguous doors → ONE entrance block of z-width 3" do
      assert [e] = BC.entrance_cells([2, 3, 4], 5)
      assert e.dx == 2
      assert e.settings == %{"depth" => 3, "depthDir" => "right-down"}
    end

    test "non-adjacent doors → ONE entrance block EACH (no span across the wall between them)" do
      assert [left, right] = BC.entrance_cells([1, 4], 4)
      assert left.dx == 1
      assert right.dx == 4
      refute Map.has_key?(left, :settings) and Map.has_key?(right, :settings)
    end

    test "a mixed facade spans each contiguous RUN and leaves the lone door plain" do
      assert [pair, lone] = BC.entrance_cells([1, 2, 5], 4)
      assert pair.dx == 1
      assert pair.settings == %{"depth" => 2, "depthDir" => "right-down"}
      assert lone.dx == 5
      refute Map.has_key?(lone, :settings)
    end

    test "no doors → no entrance" do
      assert BC.entrance_cells([], 4) == []
    end
  end

  describe "#31 roof is a single consistent colour (one roof material, never mixed)" do
    for name <- @gable do
      test "#{name}: gable roof labels come from exactly ONE {body, apex} material pair" do
        c = comp(unquote(name))

        roof_labels =
          for %{label: l} <- c.cells, String.starts_with?(l, "roof"), into: MapSet.new(), do: l

        assert MapSet.size(roof_labels) > 0
        pair = Enum.find(@roof_pairs, &MapSet.subset?(roof_labels, &1))

        assert pair,
               "#{unquote(name)}: roof labels #{inspect(MapSet.to_list(roof_labels))} mix materials"
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

  describe "roof-z-width — each roof COLUMN is ONE depth-spanned block (smart height + smart z-width)" do
    for name <- @gable do
      test "#{name}: gable roof collapses to w+1 depth-spanned blocks, per-column silhouette preserved" do
        c = comp(unquote(name))
        w = c.footprint_w
        h = c.footprint_h
        roofs = roof_cells(c)

        # w body columns + 1 ridge apex = w+1 blocks (house_5 → 6), instead of one cell per (col,row).
        assert length(roofs) == w + 1,
               "#{unquote(name)}: expected #{w + 1} roof blocks, got #{length(roofs)}"

        # Every roof block spans the footprint DEPTH along +row (grid-aligned, anchored at the back row) and is
        # walkable — the wall beneath a perimeter column already carries the collision, interior roof was always
        # walkable, so the roof itself never blocks.
        for r <- roofs do
          assert st(r)["depth"] == h, "#{unquote(name)}: roof block missing depth=#{h}"
          assert st(r)["depthDir"] == "left-down"
          assert r.walkable == true

          assert r.dy == 0,
                 "#{unquote(name)}: a depth-span roof must anchor at the back row (dy=0)"
        end

        # SILHOUETTE preserved — each column's roof sits ON the eave and peaks at the UNCHANGED gable height.
        eave = roofs |> Enum.map(& &1.level) |> Enum.min()

        for dx <- 0..(w - 1) do
          at = Enum.filter(roofs, &(&1.dx == dx))
          assert at != [], "#{unquote(name)}: column #{dx} lost its roof"
          base = at |> Enum.map(& &1.level) |> Enum.min()
          peak = at |> Enum.map(&(&1.level + cell_span(&1) - 1)) |> Enum.max()
          assert base == eave, "#{unquote(name)}: column #{dx} roof doesn't sit on the eave"

          assert peak - eave + 1 == gable_levels(dx, w),
                 "#{unquote(name)}: column #{dx} peak changed (#{peak - eave + 1} levels, want #{gable_levels(dx, w)})"
        end
      end
    end

    test "house_5 gable roof is exactly 6 blocks (the named target)" do
      assert length(roof_cells(comp("house_5"))) == 6
    end

    for name <- @flat do
      test "#{name}: flat roof collapses to depth-spanned deck/parapet columns + one blocking crown" do
        c = comp(unquote(name))
        w = c.footprint_w
        h = c.footprint_h
        roofs = roof_cells(c)

        # w depth-spanned deck/parapet columns + 1 crown = w+1.
        assert length(roofs) == w + 1,
               "#{unquote(name)}: expected #{w + 1} flat-roof blocks, got #{length(roofs)}"

        crown? = fn %{label: l} -> String.starts_with?(l, "roof_top") or l == "rooftop_unit" end
        {crowns, deck} = Enum.split_with(roofs, crown?)
        assert length(crowns) == 1, "#{unquote(name)}: expected exactly one rooftop crown"
        [crown] = crowns

        # The crown sits above NO wall → it stays BLOCKING and is a single, non-spanned cell.
        assert crown.walkable == false
        refute Map.has_key?(st(crown), "depth")

        # Every deck/parapet column spans the footprint depth along +row and is walkable.
        for d <- deck do
          assert st(d)["depth"] == h, "#{unquote(name)}: deck column missing depth=#{h}"
          assert st(d)["depthDir"] == "left-down"
          assert d.walkable == true
        end
      end
    end
  end
end
