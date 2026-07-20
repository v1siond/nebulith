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

  ## Two authoring rules (tickets #30 + #31)

  **Symmetric facades (#31).** Windows are a BILATERALLY SYMMETRIC grid — `window?/2`
  places a window only where the distance to the nearer facade edge is ODD, so the two
  edge columns are ALWAYS walls (a window is never at the bare edge), the pattern mirrors
  across the centreline, and the smallest window-bearing facade is `wall·window·wall`.
  Windows sit on the same columns on every floor (vertically aligned). The DOOR is centred
  (`door_cols/1` — one column for odd widths, a 2-wide centred opening for even widths). The
  ROOF is one consistent colour (`roof`/`roof_top` share it, or the slate pair for masonry).

  **Minimal cells (#30).** Each vertical RUN of the same tile in a column is authored as ONE
  cell sized `settings.scaleY = span` (a 4-tall wall pier → 1 cell, not 4 stacked). This is
  render-IDENTICAL to the old per-level stack — the frontend already draws a collapsed run as a
  single `scaleY` block (MAP-MODEL §4, height is per-tile DATA read uniformly) — so authoring it
  pre-collapsed only shrinks the stored cell count, never the look. A window/door breaks the run
  (its own label) and stays its own block, so the spaced grid is preserved.
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
    %{comp | cells: Enum.map(cells, fn c -> Map.update!(c, :label, &Map.get(overrides, &1, &1)) end)}
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

  # Build the wall box: for every PERIMETER column, collapse levels 0..wall_top (labelled by `facade_fun`) into
  # the FEWEST cells (`wall_column`). The door column is walkable end-to-end (you pass through the doorway);
  # every other facade column blocks. Roof cells come from `roof_cells`.
  defp assemble(w, h, wall_top, doors, facade_fun, roof_cells) do
    walls =
      for dy <- 0..(h - 1), dx <- 0..(w - 1), perimeter?(dx, dy, w, h) do
        wall_column(dx, dy, wall_top, dx in doors, facade_fun)
      end

    %{footprint_w: w, footprint_h: h, cells: List.flatten(walls) ++ roof_cells}
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

  # A GABLE roof (houses): a triangular stack whose height per column falls off from the centre (peak ≤3).
  # Each column's roof VOLUME is authored as ONE `scaleY` cell (minimal-cell #30); the centre-back apex is the
  # `roof_top` cap on its own cell. Perimeter roof caps block; the interior roof volume is walkable.
  # `roof`/`roof_top` name the roof MATERIAL — ONE colour (#31): default red gable, or the slate pair for stone
  # buildings — never mixed.
  defp gable_roof(w, h, wall_top, roof \\ "roof", roof_top \\ "roof_top") do
    center = (w - 1) / 2
    max_peak = min(3, div(w + 1, 2))
    eave = wall_top + 1
    doors = door_cols(w)
    apex_col = div(w - 1, 2)

    for dy <- 0..(h - 1), dx <- 0..(w - 1), reduce: [] do
      acc ->
        levels = max(1, max_peak - trunc(Float.floor(abs(dx - center))))
        peri = perimeter?(dx, dy, w, h)
        walkable = dx in doors or not peri
        # The centre-back column caps its top level with the `roof_top` apex; its body run is one level shorter.
        apex? = dx == apex_col and dy == 0
        body_span = if apex?, do: levels - 1, else: levels

        body =
          if body_span > 0,
            do: [stacked_cell(dx, dy, eave, roof, walkable, body_span)],
            else: []

        apex = if apex?, do: [cell(dx, dy, eave + levels - 1, roof_top, walkable)], else: []

        acc ++ body ++ apex
    end
  end

  # A FLAT roof (store/office): a parapet lip around the edge, a walkable deck inside (one level → already
  # minimal), and one raised detail block at the centre — the `roof_top` SIGN (badge anchor) for a titled shop,
  # else a plain `rooftop_unit` AC/vent block.
  defp flat_roof(w, h, wall_top, opts \\ []) do
    roof_level = wall_top + 1
    doors = door_cols(w)

    deck =
      for dy <- 0..(h - 1), dx <- 0..(w - 1) do
        peri = perimeter?(dx, dy, w, h)
        label = if peri, do: "parapet", else: "flat_roof"
        cell(dx, dy, roof_level, label, dx in doors or not peri)
      end

    crown_label = if opts[:title], do: "roof_top", else: "rooftop_unit"
    deck ++ [cell(div(w - 1, 2), div(h - 1, 2), roof_level + 1, crown_label, false)]
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
