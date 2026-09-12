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

  describe "the doorway opens onto the ground — there is NO entrance apron (#49)" do
    # THIS GROUP WAS INVERTED, not deleted.
    #
    # It used to assert an apron: a `path` cell on the row in front of the facade, spanning every door
    # column. Alexander #49 removed it, and `assemble/6` says why — once every tile became a height-1 block
    # the apron stood UP as a raised block directly in front of the doors and BLOCKED the doorway it was
    # meant to serve. It is also redundant: the road or ground is already there, and walkability comes from
    # the layout rather than from a doorstep tile.
    #
    # So the property is real but the other way round, and it is worth guarding: re-adding an apron would
    # re-introduce exactly the bug #49 fixed. These tests fail if one ever comes back.
    for name <- @all do
      test "#{name}: nothing is placed on the row in front of the facade" do
        c = comp(unquote(name))

        assert entrance_cells(c) == [],
               "#{unquote(name)}: something sits in front of the doors — a raised block there blocks the doorway (#49)"
      end

      test "#{name}: no cell anywhere is the `path` doorstep tile" do
        c = comp(unquote(name))
        paths = Enum.filter(c.cells, &(&1.label == "path"))

        assert paths == [],
               "#{unquote(name)}: #{length(paths)} `path` cell(s) — the doorstep tile is gone, the ground carries the walkway"
      end
    end

    test "the building occupies exactly its own footprint, and never the row beyond it" do
      for name <- @all do
        c = comp(name)
        max_dy = c.cells |> Enum.map(& &1.dy) |> Enum.max()

        assert max_dy == c.footprint_h - 1,
               "#{name}: cells reach dy #{max_dy}, past its own depth of #{c.footprint_h}"
      end
    end

    test "the doorway is still walkable — removing the apron must not seal the building" do
      for name <- @all do
        c = comp(name)
        doors = door_columns(c) |> Enum.sort()

        walkable_front =
          c.cells
          |> Enum.filter(&(&1.dy == c.footprint_h - 1 and &1.walkable))
          |> Enum.map(& &1.dx)
          |> Enum.uniq()
          |> Enum.sort()

        assert walkable_front == doors,
               "#{name}: front row walkable at #{inspect(walkable_front)}, doors at #{inspect(doors)}"
      end
    end
  end

  # THE ENTRANCE RULE group is gone with `entrance_cells/2` itself.
  #
  # It tested the apron builder in detail — one door to one block, contiguous doors collapsing into one
  # z-width span, non-adjacent doors staying separate. Careful work, and all of it about a function no
  # building has called since #49 removed the apron: it stood UP in front of the doors and blocked the
  # doorway it served. The function had no caller but these tests, so it and they go together.
  #
  # What replaced the property is asserted above: nothing sits on the row in front of a facade, no cell
  # anywhere is the `path` doorstep tile, and the doorway is still walkable.

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
      test "#{name}: gable roof collapses to ONE depth-spanned bar per column, silhouette preserved" do
        c = comp(unquote(name))
        w = c.footprint_w
        h = c.footprint_h
        roofs = roof_cells(c)

        # ONE depth-spanned bar PER COLUMN = w blocks, instead of one cell per (col,row). There is no separate
        # ridge apex cap: it shortened one centre column and stuck a chunky block on top, which broke the
        # left/right symmetry — the PEAK-height columns wear the roof_top ridge tile instead.
        assert length(roofs) == w,
               "#{unquote(name)}: expected #{w} roof blocks, got #{length(roofs)}"

        # Every roof block spans the footprint DEPTH along +row (grid-aligned, anchored at the back row) and
        # BLOCKS — Alexander 2026-09-06: "roof should have collissions". (It used to be authored walkable on the
        # reasoning that the wall beneath carried the collision; that made "walkable" claim you may stand on a
        # roof, which is how the hero ended up standing on one.)
        for r <- roofs do
          assert st(r)["depth"] == h, "#{unquote(name)}: roof block missing depth=#{h}"
          assert st(r)["depthDir"] == "left-down"
          assert r.walkable == false

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

    test "house_5 gable roof is exactly 5 blocks — one bar per column, no apex cap" do
      assert length(roof_cells(comp("house_5"))) == 5
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

        # Every deck/parapet column spans the footprint depth along +row and BLOCKS, like the crown and every
        # gable bar — a roof is not a floor (Alexander 2026-09-06: "roof should have collissions").
        for d <- deck do
          assert st(d)["depth"] == h, "#{unquote(name)}: deck column missing depth=#{h}"
          assert st(d)["depthDir"] == "left-down"
          assert d.walkable == false
        end
      end
    end
  end
  # ── WALKABILITY (Alexander 2026-09-06, Images #1/#2) ────────────────────────────────────────────────────
  # "when entering through a door, the user goes over the roof instead of inside the house … we're most likely
  #  applying the properties wrong, plus roof should have collissions, so this shouldn't be a posssible bug"
  #
  # Two authoring defects this guards:
  #  1. `assemble` marked a column walkable by its COLUMN ALONE (`dx in doors`), ignoring the row — so the BACK
  #     wall directly opposite each door was walkable too, and you could stroll through the back of every
  #     building. Only the DOOR ROW (the front, dy = h-1) is an opening.
  #  2. Roof blocks were authored walkable, on the reasoning that the wall beneath carries the collision. A roof
  #     is not a floor: it BLOCKS.
  describe "walkability — only the doorway is an opening; walls and roofs block" do
    for name <- @all do
      test "#{name}: the door row's door columns are walkable, and nothing else on the ground floor is" do
        c = comp(unquote(name))
        front = c.footprint_h - 1

        ground = Enum.filter(c.cells, &(&1.level == 0))
        walkable_ground = ground |> Enum.filter(& &1.walkable) |> Enum.map(&{&1.dx, &1.dy})
        doors = ground |> Enum.filter(&(&1.label == "door")) |> Enum.map(&{&1.dx, &1.dy})

        assert doors != [], "#{unquote(name)} has no ground-floor door"
        assert Enum.sort(walkable_ground) == Enum.sort(doors),
               "#{unquote(name)}: walkable ground cells #{inspect(Enum.sort(walkable_ground))} should be exactly the doors #{inspect(Enum.sort(doors))}"

        assert Enum.all?(doors, fn {_dx, dy} -> dy == front end),
               "#{unquote(name)}: a door must sit on the front row #{front}"
      end

      test "#{name}: the back wall opposite a door is NOT walkable" do
        c = comp(unquote(name))
        back_row = Enum.filter(c.cells, &(&1.dy == 0))

        refute Enum.any?(back_row, & &1.walkable),
               "#{unquote(name)}: back-row cells #{inspect(back_row |> Enum.filter(& &1.walkable) |> Enum.map(&{&1.dx, &1.label}))} are walkable — you can walk through the back wall"
      end

      test "#{name}: every roof block blocks — a roof is not a floor" do
        c = comp(unquote(name))
        roofs = Enum.filter(c.cells, &roof_label?(&1.label))

        assert roofs != [], "#{unquote(name)} has no roof cells"

        refute Enum.any?(roofs, & &1.walkable),
               "#{unquote(name)}: walkable roof cells #{inspect(roofs |> Enum.filter(& &1.walkable) |> Enum.map(& &1.label))}"
      end
    end
  end

  defp roof_label?(label),
    do: String.starts_with?(label, "roof") or label in ["flat_roof", "parapet", "rooftop_unit"]
end
defmodule Nebulith.BuildingCompositionsContextTest do
  @moduledoc """
  THE THINGS THAT MAKE A PLACE A PLACE.

  Alexander, 2026-09-11: *"having different types of settlements implies having different objects, just like
  we added a bunch of new trees to be able to do the jungle and other forests, we have to add new buildings
  with design matching the context of the settlement"*, and *"cities have more skycrappers, towns have more
  houses"*.

  So the test that matters is not that a new type EXISTS, it is that it comes out a different SHAPE. The knob
  that does that is `wall_top_bonus`, because `wall_top` is `max(3, min(w - 3, 8)) + bonus`: measured, the
  walls run stable 2, house 3, barn 4, church 5, manor 6, apartment 7, tower 11.

  Note the stable is measured at its WALLS, not its peak. A gable's height grows with WIDTH
  (`max_peak = min(3, div(w + 1, 2))`), so the 6-wide stable carries a taller roof over its lower walls and
  tops out level with a 4-wide house. That is a stable: a big roof on short walls, not a small house.
  """
  use ExUnit.Case, async: true

  alias Nebulith.Catalog.BuildingCompositions, as: Buildings

  # The highest block a set of cells reaches. A cell holds a whole vertical RUN, so its top is its base level
  # plus its `scaleY` span (minimal cells, #30). Reading `level` alone would under-measure every wall pier.
  defp top(cells) do
    cells
    |> Enum.map(fn c -> c.level + (get_in(c, [:settings, "scaleY"]) || 1) - 1 end)
    |> Enum.max(fn -> 0 end)
  end

  defp composed(type) do
    {w, h} = Buildings.default_footprint(type)
    Buildings.compose_building(type, w, h, seed: 1)
  end

  defp wall_height(type) do
    composed(type).cells |> Enum.filter(&String.starts_with?(&1.label, "wall_")) |> top()
  end

  defp peak(type), do: composed(type).cells |> top()

  test "every type the module offers composes at its own default footprint" do
    for type <- Buildings.building_types() do
      {w, h} = Buildings.default_footprint(type)
      comp = Buildings.compose_building(type, w, h, seed: 1)

      assert %{footprint_w: ^w, footprint_h: ^h} = comp, "#{type} composed at the wrong size"
      assert comp.cells != [], "#{type} composed no cells"
    end
  end

  test "the new types are the town's and the city's own things" do
    for type <- ~w(stable barn smithy church manor apartment tower) do
      assert type in Buildings.building_types(), "#{type} is not composable"
    end
  end

  test "a stable squats and a tower goes up: the difference is SHAPE, not colour" do
    house = wall_height("house")

    # A stable is a roof you walk a horse under: the lowest walls of anything in the set.
    assert wall_height("stable") < house, "a stable's walls are not lower than a house's"
    assert wall_height("stable") == Enum.min(Enum.map(Buildings.building_types(), &wall_height/1))

    # And the city's things stand well over everything a town has.
    assert wall_height("apartment") > house + 3, "an apartment block is not taller than a house"
    assert peak("tower") > 2 * peak("house"), "a tower does not stand over a house"
    assert wall_height("tower") == Enum.max(Enum.map(Buildings.building_types(), &wall_height/1))
  end

  test "every new type is its own height, so a street of them has a skyline" do
    heights = Enum.map(~w(stable house barn church manor apartment tower), &wall_height/1)

    assert heights == Enum.sort(heights), "the heights do not step up: #{inspect(heights)}"
    assert length(Enum.uniq(heights)) == length(heights), "two of them are the same height"
  end

  test "a town's things are timber and a city's are not" do
    timber = fn type ->
      composed(type).cells |> Enum.any?(&String.starts_with?(&1.label, "wall_wood"))
    end

    assert timber.("stable")
    assert timber.("barn")
    refute timber.("tower")
    refute timber.("apartment")
  end

  test "the flat-roofed city blocks are flat, and the town's are gabled" do
    labels = fn type -> composed(type).cells |> Enum.map(& &1.label) |> MapSet.new() end

    for type <- ~w(apartment tower) do
      assert "flat_roof" in labels.(type), "#{type} has no flat deck"
    end

    for type <- ~w(stable barn smithy church manor) do
      assert Enum.any?(labels.(type), &String.starts_with?(&1, "roof")), "#{type} has no gable"
    end
  end
end
