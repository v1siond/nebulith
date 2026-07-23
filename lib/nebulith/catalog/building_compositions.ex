defmodule Nebulith.Catalog.BuildingCompositions do
  @moduledoc """
  Baked building COMPOSITIONS — a pre-built building (house/store/hospital/…) is a
  composition template stamped as per-cell tiles, exactly like a tree (MAP-MODEL §5,
  TILE-BACKEND-MIGRATION §4). NOT a procedural unit.

  Each entry is a footprint (`footprint_w` × `footprint_h`, south-facing) + one
  `composition_cells` row per tile: `{dx, dy, level, label, walkable, settings}`.
  Labels are wall/window/door/roof/roof_top. A cell's collision follows its ground
  block (a wall blocks; a door/interior is walkable), so every tile in a cell shares
  its walkability. Rotation to face a road happens at STAMP time (frontend), so only
  the south facing is stored.

  ## Three authoring rules (tickets #30 + #31 + #32)

  **Symmetric facades (#31).** Windows are a BILATERALLY SYMMETRIC grid — `window?/2`
  places a window only where the distance to the nearer facade edge is ODD, so the two
  edge columns are ALWAYS walls (a window is never at the bare edge), the pattern mirrors
  across the centreline, and the smallest window-bearing facade is `wall·window·wall`.
  Windows sit on the same columns on every floor (vertically aligned). The DOOR is centred
  (`door_cols/1` — one column for odd widths, a 2-wide centred opening for even widths). The
  ROOF is one consistent colour (`roof`/`roof_top` share it, or the slate pair for masonry).
  The ENTRANCE apron (`entrance_cells/2`) is built from that SAME `door_cols/1` list, so it always
  matches the doors block for block — 2 doors → a 2-block entrance, 3 doors → a 3-block one — with
  each contiguous run collapsed to ONE z-width block (G7).

  **Minimal cells (#30).** Each vertical RUN of the same tile in a column is authored as ONE
  cell sized `settings.scaleY = span` (a 4-tall wall pier → 1 cell, not 4 stacked). This is
  render-IDENTICAL to the old per-level stack — the frontend already draws a collapsed run as a
  single `scaleY` block (MAP-MODEL §4, height is per-tile DATA read uniformly) — so authoring it
  pre-collapsed only shrinks the stored cell count, never the look. A window/door breaks the run
  (its own label) and stays its own block, so the spaced grid is preserved.

  **Roof z-width collapse (#32).** A ROOF is authored as ONE depth-spanned block PER COLUMN, not one
  cell per (col,row). Each column carries smart HEIGHT (`settings.scaleY` = its gable-step height) AND
  smart Z-WIDTH (`settings.depth` = the footprint depth, with `settings.depthDir = "left-down"` = the
  +row axis), anchored at the back row (dy=0). The frontend's iso long-box draws that one block spanning
  the whole depth, 2D collapses the depth onto the front face, and TOP paints the tile across the covered
  footprint cells — so a gable falls from one cell per (col,row) to just **w+1 blocks** (a house 5-wide →
  6), a flat roof to ≈w+1, with the per-column silhouette byte-preserved. Roof cells are walkable (the wall
  beneath a perimeter column already carries the collision; interior roof was always walkable) — only the
  flat-roof crown, which sits above no wall, stays blocking. This is ROOFS ONLY; walls keep their per-column
  9-slice `scaleY` piers (#30).
  """

  # Per-composition TYPE-SPECIFIC tile remaps — today ONLY store's apex badge. Every building is now box-BUILT
  # (house/store/office/stone_building/civic), so each emits its material + roof pieces DIRECTLY from the facade
  # and carries NO wall/roof remap here — that includes hospital (plaster walls + green gable passed straight to
  # `house/3`) and big_house/temple/cathedral/castle. store keeps only its blue apex-sign badge: `flat_roof`
  # emits a generic `roof_top` crown, which we SWAP to `roof_top_store`. Everything unlisted keeps its tile.
  @type_tiles %{
    "store_5" => %{"roof_top" => "roof_top_store"}
  }

  # A building's NAME → the apex badge the renderer draws (data for the signage). Only store/hospital
  # carry one; houses/others have none → no badge.
  @titles %{"store_5" => "Store", "hospital_6" => "Hospital"}

  @doc """
  Every baked building composition, keyed by type_length (hyphens in the type become underscores).

  Cells reference type-specific tiles (per `@type_tiles`) and store/hospital carry their apex-signage
  `title`, so the seeded compositions render each building's own colours + name.
  """
  def all do
    for {name, comp} <- definitions(), into: %{} do
      {name, comp |> remap_cells(name) |> put_title(name)}
    end
  end

  # Swap each cell's label for its type-specific tile (unlisted labels pass through unchanged).
  defp remap_cells(%{cells: cells} = comp, name) do
    overrides = Map.get(@type_tiles, name, %{})

    %{
      comp
      | cells: Enum.map(cells, fn c -> Map.update!(c, :label, &Map.get(overrides, &1, &1)) end)
    }
  end

  # Attach the apex-signage title when this building has one (store/hospital); leave it off otherwise.
  defp put_title(comp, name) do
    case Map.get(@titles, name) do
      nil -> comp
      title -> Map.put(comp, :title, title)
    end
  end

  # ── Facade GRAMMAR (symmetric windows + centred door) ──────────────────────
  # house/store/office/civic are AUTHORED from a compact facade spec, not a hand-listed cell dump, so the
  # symmetric-realism rule is explicit in code. Every building is the SAME shape: a perimeter WALL box whose
  # FRONT/BACK faces carry a BILATERALLY SYMMETRIC window grid (`window?`), a CENTRED door on the front
  # (`door_cols`), capped by a roof (gable or flat). Interior columns hold only the roof VOLUME so ISO reads a
  # solid roof; 2D collapses depth onto the front face (MAP-MODEL §2-3). EVERY building — hospital included —
  # is box-built this way; identity (plaster + green roof, slate gable, …) rides in as the builder's material
  # args.

  defp cell(dx, dy, level, label, walkable),
    do: %{dx: dx, dy: dy, level: level, label: label, walkable: walkable}

  # A FACADE WINDOW column (#31): bilaterally symmetric about the centreline, edges ALWAYS walls. A window sits
  # where the distance to the nearer edge is ODD — so col 0 / w-1 (distance 0) stay walls, a window at col `dx`
  # is mirrored by one at `w-1-dx` (their edge-distances are equal), and the smallest window-bearing facade is
  # `wall·window·wall` (w=3). Widths whose two centre columns share an odd edge-distance carry a centred
  # `window·window` pair (the blessed symmetric double, TILESET-AUTHORING §25); the rest alternate window/wall.
  defp window?(dx, w), do: dx > 0 and dx < w - 1 and rem(min(dx, w - 1 - dx), 2) == 1

  # The DOOR is CENTRED on the facade (#31): a single centre column for odd widths, a centred 2-wide opening
  # for even widths (so an even facade reads symmetric AND the entrance meets the ≥2-wide door rule,
  # GENERATION-SPEC §1). Returned as the set of door columns.
  defp door_cols(w) when rem(w, 2) == 1, do: [div(w, 2)]
  defp door_cols(w), do: [div(w, 2) - 1, div(w, 2)]

  defp perimeter?(dx, dy, w, h), do: dx == 0 or dx == w - 1 or dy == 0 or dy == h - 1

  @doc """
  The ENTRANCE apron for a facade's `door_cols` — the walkable ground tiles you step onto to reach the doorway.

  The entrance is derived from the SAME door-column list that places the doors, so it ALWAYS matches them
  block for block (G7: *"the walk-in ENTRANCE opening must ALWAYS match the door's width"*): 2 doors → a
  2-block entrance, 3 doors → a 3-block entrance. Each CONTIGUOUS run of door columns collapses to ONE
  z-width block (`settings.depth` = the run length along `depthDir: "right-down"`, the +col facade axis) —
  the same depth-span mechanism the roof uses on the +row axis (#32), so a 2-wide doorway costs one cell
  instead of two. Doors separated by a wall get one block EACH (nothing spans across the wall between them).

  `dy` is the row the apron sits on — pass the footprint depth so it lands on the ground row directly in
  FRONT of the facade. The stamp rotates it with the building, so it always faces the road.
  """
  def entrance_cells(door_cols, dy) do
    door_cols
    |> contiguous_runs()
    |> Enum.map(&entrance_cell(&1, dy))
  end

  # Group a column list into CONTIGUOUS runs: [2, 3] → [[2, 3]]; [1, 4] → [[1], [4]]; [1, 2, 5] → [[1, 2], [5]].
  defp contiguous_runs(cols) do
    cols
    |> Enum.sort()
    |> Enum.chunk_while([], &extend_or_break/2, &flush_run/1)
  end

  defp extend_or_break(col, []), do: {:cont, [col]}
  defp extend_or_break(col, [prev | _] = run) when col == prev + 1, do: {:cont, [col | run]}
  defp extend_or_break(col, run), do: {:cont, Enum.reverse(run), [col]}

  defp flush_run([]), do: {:cont, []}
  defp flush_run(run), do: {:cont, Enum.reverse(run), []}

  # ONE entrance block per run, anchored at the run's leftmost column. A single column stays a plain cell; a
  # wider run carries its z-width so the apron is one block, not one per door.
  defp entrance_cell([dx], dy), do: cell(dx, dy, 0, "path", true)

  defp entrance_cell([dx | _] = run, dy) do
    cell(dx, dy, 0, "path", true)
    |> Map.put(:settings, %{"depth" => length(run), "depthDir" => "right-down"})
  end

  # Build the wall box: for every PERIMETER column, collapse levels 0..wall_top (labelled by `facade_fun`) into
  # the FEWEST cells (`wall_column`). The door column is walkable end-to-end (you pass through the doorway);
  # every other facade column blocks. Roof cells come from `roof_cells`, and the ENTRANCE apron from the SAME
  # `doors` list the facade used — so the doorstep can never drift from the doors it serves.
  defp assemble(w, h, wall_top, doors, facade_fun, roof_cells) do
    walls =
      for dy <- 0..(h - 1), dx <- 0..(w - 1), perimeter?(dx, dy, w, h) do
        wall_column(dx, dy, wall_top, dx in doors, facade_fun)
      end

    cells = List.flatten(walls) ++ roof_cells ++ entrance_cells(doors, h)
    %{footprint_w: w, footprint_h: h, cells: cells}
  end

  # ONE perimeter column, MINIMAL-CELL (#30): walk levels 0..wall_top labelling each with `facade_fun`, then
  # group each RUN of the same tile into a single `scaleY`-sized cell. A window/door has its own label, so it
  # breaks the run and stays its own block — the spaced window grid survives the collapse.
  defp wall_column(dx, dy, wall_top, walkable, facade_fun) do
    0..wall_top
    |> Enum.map(fn level -> {level, facade_fun.(dx, dy, level)} end)
    |> collapse_runs(dx, dy, walkable)
  end

  # Group consecutive same-label levels into runs → one cell per run at the run's base level, `scaleY` = span.
  defp collapse_runs(levels, dx, dy, walkable) do
    levels
    |> Enum.chunk_by(fn {_level, label} -> label end)
    |> Enum.map(fn chunk ->
      {base_level, label} = hd(chunk)
      stacked_cell(dx, dy, base_level, label, walkable, length(chunk))
    end)
  end

  # A cell sized to its vertical run: a 1-tall run is a plain cell; a taller run carries `settings.scaleY`
  # (Height), so ONE block renders the whole run instead of `span` stacked unit cubes. `scaleY` is the exact
  # setting the frontend already applies to a collapsed run, so the render is unchanged (MAP-MODEL §4).
  defp stacked_cell(dx, dy, level, label, walkable, 1),
    do: cell(dx, dy, level, label, walkable)

  defp stacked_cell(dx, dy, level, label, walkable, span),
    do: cell(dx, dy, level, label, walkable) |> Map.put(:settings, %{"scaleY" => span})

  # A depth-spanned ROOF block (roof-z-width, ticket #32): ONE cell per COLUMN that spans the whole footprint
  # DEPTH along the +row (south) axis via `depth`/`depthDir`, carrying its gable-step HEIGHT as `scaleY` —
  # instead of one cell per (col,row). Anchored at the BACK row (dy=0) so the +row (`left-down`) span reaches
  # forward across the footprint; the frontend rotates the direction with the footprint when a building faces
  # east/west/north. WALKABLE: a perimeter roof column sits directly above a wall that already carries the
  # collision, and the interior roof volume was always walkable — so the roof itself never blocks (only the
  # flat-roof crown, which sits above no wall, keeps blocking).
  defp roof_span_cell(dx, level, label, depth, span) do
    settings = %{"depth" => depth, "depthDir" => "left-down"}
    settings = if span > 1, do: Map.put(settings, "scaleY", span), else: settings
    cell(dx, 0, level, label, true) |> Map.put(:settings, settings)
  end

  # A GABLE roof (houses): each COLUMN (dx) is ONE depth-spanned block (roof-z-width #32) — smart HEIGHT
  # (`scaleY` = the column's gable-step height, peak ≤3, falling off from the centre) + smart Z-WIDTH (`depth`
  # = footprint depth, spanning the ridge/row axis). The centre column caps its top block with the `roof_top`
  # ridge apex, so a gable is w+1 blocks (w column bodies + 1 apex) instead of one cell per (col,row). The
  # per-column peak heights (the triangular silhouette) are byte-preserved. `roof`/`roof_top` name the roof
  # MATERIAL — ONE colour (#31): default red gable, or the slate/plaster-green pairs — never mixed.
  defp gable_roof(w, h, wall_top, roof \\ "roof", roof_top \\ "roof_top") do
    center = (w - 1) / 2
    max_peak = min(3, div(w + 1, 2))
    eave = wall_top + 1

    # ONE depth-spanned bar PER COLUMN, at its SYMMETRIC gable-step height — no separate apex cap (the old cap
    # shortened one centre column + stuck a chunky block on top, which broke the left/right symmetry). The
    # PEAK-height columns wear the `roof_top` ridge tile; the lower steps wear `roof`. So a gable is exactly `w`
    # clean bars: w=4 → [1,2,2,1] (2 low `1×depth` bars + 2 ridge `2×depth` bars), w=5 → [1,2,3,2,1].
    for dx <- 0..(w - 1) do
      levels = max(1, max_peak - trunc(Float.floor(abs(dx - center))))
      label = if levels == max_peak, do: roof_top, else: roof
      roof_span_cell(dx, eave, label, h, levels)
    end
  end

  # A FLAT roof (store/office): each COLUMN (dx) is ONE depth-spanned block (roof-z-width #32) spanning the
  # footprint depth — the two SIDE columns as a `parapet` lip, the interior columns as the walkable `flat_roof`
  # deck (the front/back lip folds into those column ends, so there is no separate per-cell rim). One raised
  # detail block sits at the centre — the `roof_top` SIGN (badge anchor) for a titled shop, else a plain
  # `rooftop_unit` AC/vent. That crown sits above NO wall, so it is the ONE roof cell that stays BLOCKING (a
  # single, non-spanned cell). Result ≈ w+1 blocks (a store w=5 → 6) instead of one cell per (col,row).
  defp flat_roof(w, h, wall_top, opts \\ []) do
    roof_level = wall_top + 1

    columns =
      for dx <- 0..(w - 1) do
        label = if dx == 0 or dx == w - 1, do: "parapet", else: "flat_roof"
        roof_span_cell(dx, roof_level, label, h, 1)
      end

    crown_label = if opts[:title], do: "roof_top", else: "rooftop_unit"
    crown = cell(div(w - 1, 2), div(h - 1, 2), roof_level + 1, crown_label, false)
    columns ++ [crown]
  end

  # HOUSE — 2 living floors + a gable roof, in a WALL MATERIAL (brick/wood/stone, per definitions). Windows sit
  # on the upper course of each floor (levels 1 & 3) on the SYMMETRIC window columns; a centred door spans the
  # ground floor; a wall course separates the floors. The FRONT face is autotiled from the material's
  # center/edge/corner pieces; back + sides are the plain center piece. `roof`/`roof_top` name the gable
  # material (red by default; slate for the stone house).
  defp house(w, mat, roof \\ "roof", roof_top \\ "roof_top") do
    h = 4
    wall_top = 3
    doors = door_cols(w)

    facade = fn dx, dy, level ->
      front = dy == h - 1
      front_or_back = dy == 0 or dy == h - 1

      cond do
        front and dx in doors and level in [0, 1] -> "door"
        front_or_back and window?(dx, w) and level in [1, 3] -> "window"
        front -> material_piece(mat, dx, level, w, wall_top)
        true -> "#{mat}_c"
      end
    end

    assemble(w, h, wall_top, doors, facade, gable_roof(w, h, wall_top, roof, roof_top))
  end

  # STORE — 5×4, 2 floors, flat roof, in a BRICK wall material. Ground FRONT = a BOUNDED storefront centred on
  # the door: a `display_window` on the two columns flanking the door (never a full-width band) with a striped
  # `awning` course directly above them — only over that storefront width. The rest of the ground-floor front
  # stays autotiled brick; the upper floor is a SYMMETRIC window grid (`window?`). Back + sides are the plain
  # brick center. Keeps its blue "Store" apex badge (flat_roof title).
  defp store do
    w = 5
    h = 4
    wall_top = 3
    doors = door_cols(w)
    door_col = div(w, 2)
    mat = "wall_brick"

    facade = fn dx, dy, level ->
      front = dy == h - 1

      # storefront = the door column + the columns immediately flanking it (3 cells centred on the door).
      storefront = front and abs(dx - door_col) <= 1

      cond do
        front and dx == door_col and level in [0, 1] -> "door"
        storefront and level == 0 -> "display_window"
        storefront and level == 1 -> "awning"
        front and level == 3 and window?(dx, w) -> "window"
        front -> material_piece(mat, dx, level, w, wall_top)
        true -> "#{mat}_c"
      end
    end

    assemble(w, h, wall_top, doors, facade, flat_roof(w, h, wall_top, title: true))
  end

  # OFFICE / APARTMENT — 5×5, 3 floors, flat roof, in a STONE wall material. A regular SYMMETRIC window grid
  # (aligned every floor), a centred door, a small rooftop unit. Taller than a house or store. Front face
  # autotiled stone; back + sides the plain stone center.
  defp office do
    w = 5
    h = 5
    wall_top = 5
    doors = door_cols(w)
    mat = "wall_stone"

    facade = fn dx, dy, level ->
      front = dy == h - 1
      front_or_back = dy == 0 or dy == h - 1

      cond do
        front and dx in doors and level in [0, 1] -> "door"
        front_or_back and window?(dx, w) and level in [1, 3, 5] -> "window"
        front -> material_piece(mat, dx, level, w, wall_top)
        true -> "#{mat}_c"
      end
    end

    assemble(w, h, wall_top, doors, facade, flat_roof(w, h, wall_top))
  end

  # CIVIC (big civic buildings: temple / cathedral / castle) — a taller masonry box, built EXACTLY like a
  # house/office: a perimeter wall box in a `mat` MATERIAL whose FRONT + BACK faces carry a SYMMETRIC window
  # grid (`window?`, at the aligned `win_levels` odd courses so a wall course sits between floors), a centred
  # door on the ground floor, and a gable roof (`roof`/`roof_top` name its ONE colour — red default, slate for
  # stone). `w`/`h`/`wall_top` come from each building's own footprint + height. Front face autotiled; back +
  # sides the plain center piece.
  defp civic(w, h, wall_top, mat, win_levels, roof, roof_top) do
    doors = door_cols(w)

    facade = fn dx, dy, level ->
      front = dy == h - 1
      front_or_back = dy == 0 or dy == h - 1

      cond do
        front and dx in doors and level in [0, 1] -> "door"
        front_or_back and window?(dx, w) and level in win_levels -> "window"
        front -> material_piece(mat, dx, level, w, wall_top)
        true -> "#{mat}_c"
      end
    end

    assemble(w, h, wall_top, doors, facade, gable_roof(w, h, wall_top, roof, roof_top))
  end

  # STONE BUILDING — the material+piece SAMPLE (TILESET-AUTHORING §3). A 5×4 box (matches the store footprint,
  # so the generator can render its single store from this) whose wall field is the `wall_stone` MATERIAL — a
  # DISTINCT tile from brick, its grey in `settings.colors`. The FRONT face is autotiled from center/edge/corner
  # stone pieces; a SYMMETRIC window grid (`window?`) sits on the interior columns, a centred door, a gable roof
  # (via the shared gable_roof). Back + side faces stay plain `wall_stone_c`.
  defp stone_building do
    w = 5
    h = 4
    wall_top = 3
    doors = door_cols(w)

    facade = fn dx, dy, level ->
      front = dy == h - 1

      cond do
        front and dx in doors and level in [0, 1] -> "door"
        front and window?(dx, w) and level in [1, 3] -> "window"
        front -> material_piece("wall_stone", dx, level, w, wall_top)
        true -> "wall_stone_c"
      end
    end

    assemble(w, h, wall_top, doors, facade, gable_roof(w, h, wall_top))
  end

  # The autotile piece for a FRONT-FACE cell of a wall MATERIAL — `dx` runs along the facade, `level` up the
  # wall — the SAME 9-piece scheme the fountain rim uses, applied to the front-elevation rectangle (corners at
  # its four corners, edges along each side, `<base>_c` inside). `base` is the material (`wall_stone`,
  # `wall_brick`, `wall_wood`), so one function autotiles every material facade.
  defp material_piece(base, dx, level, w, wall_top) do
    left = dx == 0
    right = dx == w - 1
    bottom = level == 0
    top = level == wall_top

    suffix =
      cond do
        top and left -> "tl"
        top and right -> "tr"
        bottom and left -> "bl"
        bottom and right -> "br"
        top -> "t"
        bottom -> "b"
        left -> "l"
        right -> "r"
        true -> "c"
      end

    "#{base}_#{suffix}"
  end

  defp definitions do
    %{
      # Residential MATERIAL variety (spec mapping): brick / wood / stone houses; the stone house takes a
      # slate gable, brick + wood keep the red gable.
      "house_3" => house(3, "wall_brick"),
      "house_4" => house(4, "wall_wood"),
      "house_5" => house(5, "wall_stone", "roof_slate", "roof_top_slate"),
      "store_5" => store(),
      "office_5" => office(),
      "stone_building" => stone_building(),
      # Hospital — box-built like the houses (6-wide, h=4, 2 floors + gable), so its windows are a symmetric
      # spaced grid instead of a solid band. Its identity rides in as builder args: plaster walls + a green
      # gable (roof_hospital / roof_top_hospital); the "Hospital" apex badge stays via @titles.
      "hospital_6" => house(6, "wall_plaster", "roof_hospital", "roof_top_hospital"),
      # Big civic buildings — box-built like the houses so their windows are a symmetric spaced grid.
      # WIDTH from the name; h/wall_top preserve each one's authored footprint + height. big_house = brick +
      # red gable; temple/cathedral/castle = stone + slate.
      "big_house_6" => house(6, "wall_brick"),
      "temple_8" => civic(8, 4, 5, "wall_stone", [1, 3, 5], "roof_slate", "roof_top_slate"),
      "cathedral_7" => civic(7, 5, 4, "wall_stone", [1, 3], "roof_slate", "roof_top_slate"),
      "castle_12" => civic(12, 6, 8, "wall_stone", [1, 3, 5, 7], "roof_slate", "roof_top_slate")
    }
  end
end
