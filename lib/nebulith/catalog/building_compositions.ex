defmodule Nebulith.Catalog.BuildingCompositions do
  @moduledoc """
  Baked building COMPOSITIONS — a pre-built building (house/store/hospital/…) is a
  composition template stamped as per-cell tiles, exactly like a tree (MAP-MODEL §5,
  TILE-BACKEND-MIGRATION §4). NOT a procedural unit.

  Each entry is a footprint (`footprint_w` × `footprint_h`, south-facing) + one
  `composition_cells` row per stacked tile: `{dx, dy, level, label, walkable}`.
  Labels are wall/window/door/roof/roof_top. A cell's collision follows its ground
  block (a wall blocks; a door/interior is walkable), so every tile in a cell shares
  its walkability. Rotation to face a road happens at STAMP time (frontend), so only
  the south facing is stored.

  GENERATED, do not hand-edit: produced by baking the frontend render pipeline
  (composeBuilding → buildingCellTiles) once per (type,length) generation uses, so a
  stamped composition matches what the three views drew before buildings became data.
  """

  # Per-composition TYPE-SPECIFIC tile remaps for the buildings that still list generic `wall`/`roof`/
  # `roof_top` cells — today only hospital (the last HAND-AUTHORED building) and store's apex badge. We SWAP
  # those generic labels to the building's own material/roof pieces; the shapes are untouched. The box-BUILDERS
  # (house/store/office/stone_building/civic) emit their material pieces DIRECTLY from the facade, so they carry
  # NO wall remap here — that includes big_house/temple/cathedral/castle now that they're box-built (brick+red
  # gable / stone+slate gable straight from the builder). store keeps only its blue apex-sign badge
  # (roof_top_store); hospital keeps its plaster walls + green roof. Everything unlisted keeps the default tile.
  @type_tiles %{
    "store_5" => %{"roof_top" => "roof_top_store"},
    "hospital_6" => %{
      "wall" => "wall_plaster_c",
      "roof" => "roof_hospital",
      "roof_top" => "roof_top_hospital"
    }
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

  # ── Composition BUILDER (spaced-window realism) ────────────────────────────
  # house/store/office/civic are AUTHORED from a compact facade spec, not a hand-listed cell dump, so the
  # realism rule is explicit in code. Every building is the SAME shape: a perimeter WALL box whose
  # FRONT/BACK faces carry the door + a SPACED WINDOW GRID — window, wall, window … on EVEN columns,
  # vertically aligned across floors (never a solid band, never every cell — TILESET-AUTHORING §25) — capped
  # by a roof (gable or flat). Interior columns hold only the roof VOLUME so ISO reads a solid roof; 2D
  # collapses depth onto the front face (MAP-MODEL §2-3). Only hospital stays hand-authored below (its
  # plaster + green-roof identity is handled via @type_tiles).

  defp cell(dx, dy, level, label, walkable),
    do: %{dx: dx, dy: dy, level: level, label: label, walkable: walkable}

  # EVEN columns (0, 2, 4 …) are window columns → the spaced grid.
  defp window_col?(dx), do: rem(dx, 2) == 0

  defp perimeter?(dx, dy, w, h), do: dx == 0 or dx == w - 1 or dy == 0 or dy == h - 1

  # Build the wall box: for every PERIMETER cell, stack levels 0..wall_top labelled by `facade_fun`.
  # The door column is walkable end-to-end (you pass through the doorway); every other facade cell
  # blocks. Roof cells come from `roof_cells`.
  defp assemble(w, h, wall_top, door_col, facade_fun, roof_cells) do
    walls =
      for dy <- 0..(h - 1),
          dx <- 0..(w - 1),
          perimeter?(dx, dy, w, h),
          level <- 0..wall_top do
        cell(dx, dy, level, facade_fun.(dx, dy, level), dx == door_col)
      end

    %{footprint_w: w, footprint_h: h, cells: walls ++ roof_cells}
  end

  # A GABLE roof (houses): a triangular stack whose height per column falls off from the centre
  # (peak ≤3). Every column gets the eave course; inner columns rise to the ridge; the centre-back
  # apex is the `roof_top` cap. Perimeter roof caps block; the interior roof volume is walkable.
  # `roof`/`roof_top` name the roof MATERIAL — default red gable, or the slate pair for stone buildings.
  defp gable_roof(w, h, wall_top, roof \\ "roof", roof_top \\ "roof_top") do
    center = (w - 1) / 2
    max_peak = min(3, div(w + 1, 2))
    eave = wall_top + 1
    door_col = div(w, 2)
    apex_col = div(w - 1, 2)

    for dy <- 0..(h - 1), dx <- 0..(w - 1), reduce: [] do
      acc ->
        levels = max(1, max_peak - trunc(Float.floor(abs(dx - center))))
        peri = perimeter?(dx, dy, w, h)

        cells =
          for i <- 0..(levels - 1) do
            apex = i == levels - 1 and dx == apex_col and dy == 0
            label = if apex, do: roof_top, else: roof
            cell(dx, dy, eave + i, label, dx == door_col or not peri)
          end

        acc ++ cells
    end
  end

  # A FLAT roof (store/office): a parapet lip around the edge, a walkable deck inside, and one raised
  # detail block at the centre — the `roof_top` SIGN (badge anchor) for a titled shop, else a plain
  # `rooftop_unit` AC/vent block.
  defp flat_roof(w, h, wall_top, opts \\ []) do
    roof_level = wall_top + 1
    door_col = div(w, 2)

    deck =
      for dy <- 0..(h - 1), dx <- 0..(w - 1) do
        peri = perimeter?(dx, dy, w, h)
        label = if peri, do: "parapet", else: "flat_roof"
        cell(dx, dy, roof_level, label, dx == door_col or not peri)
      end

    crown_label = if opts[:title], do: "roof_top", else: "rooftop_unit"
    deck ++ [cell(div(w - 1, 2), div(h - 1, 2), roof_level + 1, crown_label, false)]
  end

  # HOUSE — 2 living floors + a gable roof, in a WALL MATERIAL (brick/wood/stone, per definitions). Windows
  # sit on the upper course of each floor (levels 1 & 3) on even columns; a 1×2 centred door spans the ground
  # floor; a wall course separates the floors. The FRONT face is autotiled from the material's center/edge/
  # corner pieces; back + sides are the plain center piece. `roof`/`roof_top` name the gable material (red
  # by default; slate for the stone house).
  defp house(w, mat, roof \\ "roof", roof_top \\ "roof_top") do
    h = 4
    wall_top = 3
    door_col = div(w, 2)

    facade = fn dx, dy, level ->
      front = dy == h - 1
      front_or_back = dy == 0 or dy == h - 1

      cond do
        dx == door_col and dy == h - 1 and level in [0, 1] -> "door"
        front_or_back and window_col?(dx) and level in [1, 3] -> "window"
        front -> material_piece(mat, dx, level, w, wall_top)
        true -> "#{mat}_c"
      end
    end

    assemble(w, h, wall_top, door_col, facade, gable_roof(w, h, wall_top, roof, roof_top))
  end

  # STORE — 5×4, 2 floors, flat roof, in a BRICK wall material. Ground FRONT = a storefront: a wide display
  # window + centred door + a striped awning band above it. Upper front = spaced windows. The remaining front
  # wall is autotiled brick; back + sides are the plain brick center. Keeps its blue "Store" apex badge.
  defp store do
    w = 5
    h = 4
    wall_top = 3
    door_col = div(w, 2)
    mat = "wall_brick"

    facade = fn dx, dy, level ->
      front = dy == h - 1

      cond do
        front and dx == door_col and level in [0, 1] -> "door"
        front and level == 0 -> "display_window"
        front and level == 1 -> "awning"
        front and level == 3 and window_col?(dx) -> "window"
        front -> material_piece(mat, dx, level, w, wall_top)
        true -> "#{mat}_c"
      end
    end

    assemble(w, h, wall_top, door_col, facade, flat_roof(w, h, wall_top, title: true))
  end

  # OFFICE / APARTMENT — 5×5, 3 floors, flat roof, in a STONE wall material. A regular spaced window GRID
  # (even columns × every floor, aligned), a 1×2 centred door, a small rooftop unit. Taller than a house or
  # store. Front face autotiled stone; back + sides the plain stone center.
  defp office do
    w = 5
    h = 5
    wall_top = 5
    door_col = div(w, 2)
    mat = "wall_stone"

    facade = fn dx, dy, level ->
      front = dy == h - 1
      front_or_back = dy == 0 or dy == h - 1

      cond do
        dx == door_col and dy == h - 1 and level in [0, 1] -> "door"
        front_or_back and window_col?(dx) and level in [1, 3, 5] -> "window"
        front -> material_piece(mat, dx, level, w, wall_top)
        true -> "#{mat}_c"
      end
    end

    assemble(w, h, wall_top, door_col, facade, flat_roof(w, h, wall_top))
  end

  # CIVIC (big civic buildings: temple / cathedral / castle) — a taller masonry box, built EXACTLY like a
  # house/office: a perimeter wall box in a `mat` MATERIAL whose FRONT + BACK faces carry a SPACED window GRID
  # (window, wall, window … on EVEN columns, at the aligned `win_levels` odd courses so a wall course sits
  # between floors — never a solid band, TILESET-AUTHORING §25), a 1×2 centred door on the ground floor, and a
  # gable roof (`roof`/`roof_top` name its material — red default, slate for stone). `w`/`h`/`wall_top` come
  # from each building's own footprint + height so the box keeps its authored size. Front face autotiled from
  # the material's center/edge/corner pieces; back + sides are the plain center piece.
  defp civic(w, h, wall_top, mat, win_levels, roof, roof_top) do
    door_col = div(w, 2)

    facade = fn dx, dy, level ->
      front = dy == h - 1
      front_or_back = dy == 0 or dy == h - 1

      cond do
        dx == door_col and dy == h - 1 and level in [0, 1] -> "door"
        front_or_back and window_col?(dx) and level in win_levels -> "window"
        front -> material_piece(mat, dx, level, w, wall_top)
        true -> "#{mat}_c"
      end
    end

    assemble(w, h, wall_top, door_col, facade, gable_roof(w, h, wall_top, roof, roof_top))
  end

  # STONE BUILDING — the material+piece SAMPLE (TILESET-AUTHORING §3). A 5×4 box (matches the store
  # footprint, so the generator can render its single store from this) whose wall field is the `wall_stone`
  # MATERIAL — a DISTINCT tile from brick ("variety of walls = other tiles, not just brick"), its grey in
  # `settings.colors` ("variety of colour = the tile's settings"). The FRONT face is autotiled from
  # center/edge/corner stone pieces (`wall_stone_c/_t/_b/_l/_r/_tl/_tr/_bl/_br`); a SPACED window grid sits
  # on the interior columns (so the edge columns stay clean stone edges), a 1×2 centred door, a gable roof
  # (ridge/gable pieces via the shared gable_roof). Back + side faces stay plain `wall_stone_c`.
  defp stone_building do
    w = 5
    h = 4
    wall_top = 3
    door_col = div(w, 2)
    win_cols = [1, 3]

    facade = fn dx, dy, level ->
      front = dy == h - 1

      cond do
        front and dx == door_col and level in [0, 1] -> "door"
        front and dx in win_cols and level in [1, 3] -> "window"
        front -> material_piece("wall_stone", dx, level, w, wall_top)
        true -> "wall_stone_c"
      end
    end

    assemble(w, h, wall_top, door_col, facade, gable_roof(w, h, wall_top))
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
    Map.merge(large_buildings(), %{
      # Residential MATERIAL variety (spec mapping): brick / wood / stone houses; the stone house takes a
      # slate gable, brick + wood keep the red gable.
      "house_3" => house(3, "wall_brick"),
      "house_4" => house(4, "wall_wood"),
      "house_5" => house(5, "wall_stone", "roof_slate", "roof_top_slate"),
      "store_5" => store(),
      "office_5" => office(),
      "stone_building" => stone_building(),
      # Big civic buildings — box-built like the houses so their windows are a §25 spaced grid (even columns,
      # aligned across floors), not the old solid band. WIDTH from the name; h/wall_top preserve each one's
      # authored footprint + height. big_house = brick + red gable; temple/cathedral/castle = stone + slate.
      "big_house_6" => house(6, "wall_brick"),
      "temple_8" => civic(8, 4, 5, "wall_stone", [1, 3, 5], "roof_slate", "roof_top_slate"),
      "cathedral_7" => civic(7, 5, 4, "wall_stone", [1, 3], "roof_slate", "roof_top_slate"),
      "castle_12" => civic(12, 6, 8, "wall_stone", [1, 3, 5, 7], "roof_slate", "roof_top_slate")
    })
  end

  # Only hospital stays HAND-AUTHORED now (big_house/temple/cathedral/castle became box-built in definitions/0,
  # so their windows are a §25 spaced grid). Its shape is untouched; its plaster walls + green roof swap in via
  # @type_tiles (wall→wall_plaster_c, roof→roof_hospital, roof_top→roof_top_hospital).
  defp large_buildings do
%{
      "hospital_6" => %{
        footprint_w: 6,
        footprint_h: 4,
        cells: [
          %{dx: 0, dy: 0, level: 0, label: "wall", walkable: false},
          %{dx: 0, dy: 0, level: 1, label: "wall", walkable: false},
          %{dx: 0, dy: 0, level: 2, label: "wall", walkable: false},
          %{dx: 0, dy: 0, level: 3, label: "window", walkable: false},
          %{dx: 0, dy: 0, level: 4, label: "roof", walkable: false},
          %{dx: 1, dy: 0, level: 0, label: "wall", walkable: false},
          %{dx: 1, dy: 0, level: 1, label: "wall", walkable: false},
          %{dx: 1, dy: 0, level: 2, label: "wall", walkable: false},
          %{dx: 1, dy: 0, level: 3, label: "window", walkable: false},
          %{dx: 1, dy: 0, level: 4, label: "roof", walkable: false},
          %{dx: 1, dy: 0, level: 5, label: "roof", walkable: false},
          %{dx: 2, dy: 0, level: 0, label: "wall", walkable: false},
          %{dx: 2, dy: 0, level: 1, label: "wall", walkable: false},
          %{dx: 2, dy: 0, level: 2, label: "wall", walkable: false},
          %{dx: 2, dy: 0, level: 3, label: "window", walkable: false},
          %{dx: 2, dy: 0, level: 4, label: "roof", walkable: false},
          %{dx: 2, dy: 0, level: 5, label: "roof_top", walkable: false},
          %{dx: 3, dy: 0, level: 0, label: "wall", walkable: false},
          %{dx: 3, dy: 0, level: 1, label: "wall", walkable: false},
          %{dx: 3, dy: 0, level: 2, label: "wall", walkable: false},
          %{dx: 3, dy: 0, level: 3, label: "window", walkable: false},
          %{dx: 3, dy: 0, level: 4, label: "roof", walkable: false},
          %{dx: 3, dy: 0, level: 5, label: "roof", walkable: false},
          %{dx: 4, dy: 0, level: 0, label: "wall", walkable: false},
          %{dx: 4, dy: 0, level: 1, label: "wall", walkable: false},
          %{dx: 4, dy: 0, level: 2, label: "wall", walkable: false},
          %{dx: 4, dy: 0, level: 3, label: "window", walkable: false},
          %{dx: 4, dy: 0, level: 4, label: "roof", walkable: false},
          %{dx: 4, dy: 0, level: 5, label: "roof", walkable: false},
          %{dx: 5, dy: 0, level: 0, label: "wall", walkable: false},
          %{dx: 5, dy: 0, level: 1, label: "wall", walkable: false},
          %{dx: 5, dy: 0, level: 2, label: "wall", walkable: false},
          %{dx: 5, dy: 0, level: 3, label: "window", walkable: false},
          %{dx: 5, dy: 0, level: 4, label: "roof", walkable: false},
          %{dx: 0, dy: 1, level: 0, label: "wall", walkable: false},
          %{dx: 0, dy: 1, level: 1, label: "wall", walkable: false},
          %{dx: 0, dy: 1, level: 2, label: "wall", walkable: false},
          %{dx: 0, dy: 1, level: 3, label: "window", walkable: false},
          %{dx: 0, dy: 1, level: 4, label: "roof", walkable: false},
          %{dx: 1, dy: 1, level: 4, label: "roof", walkable: true},
          %{dx: 1, dy: 1, level: 5, label: "roof", walkable: true},
          %{dx: 2, dy: 1, level: 4, label: "roof", walkable: true},
          %{dx: 2, dy: 1, level: 5, label: "roof", walkable: true},
          %{dx: 3, dy: 1, level: 4, label: "roof", walkable: true},
          %{dx: 3, dy: 1, level: 5, label: "roof", walkable: true},
          %{dx: 4, dy: 1, level: 4, label: "roof", walkable: true},
          %{dx: 4, dy: 1, level: 5, label: "roof", walkable: true},
          %{dx: 5, dy: 1, level: 0, label: "wall", walkable: false},
          %{dx: 5, dy: 1, level: 1, label: "wall", walkable: false},
          %{dx: 5, dy: 1, level: 2, label: "wall", walkable: false},
          %{dx: 5, dy: 1, level: 3, label: "window", walkable: false},
          %{dx: 5, dy: 1, level: 4, label: "roof", walkable: false},
          %{dx: 0, dy: 2, level: 0, label: "wall", walkable: false},
          %{dx: 0, dy: 2, level: 1, label: "wall", walkable: false},
          %{dx: 0, dy: 2, level: 2, label: "wall", walkable: false},
          %{dx: 0, dy: 2, level: 3, label: "window", walkable: false},
          %{dx: 0, dy: 2, level: 4, label: "roof", walkable: false},
          %{dx: 1, dy: 2, level: 4, label: "roof", walkable: true},
          %{dx: 1, dy: 2, level: 5, label: "roof", walkable: true},
          %{dx: 2, dy: 2, level: 4, label: "roof", walkable: true},
          %{dx: 2, dy: 2, level: 5, label: "roof", walkable: true},
          %{dx: 3, dy: 2, level: 4, label: "roof", walkable: true},
          %{dx: 3, dy: 2, level: 5, label: "roof", walkable: true},
          %{dx: 4, dy: 2, level: 4, label: "roof", walkable: true},
          %{dx: 4, dy: 2, level: 5, label: "roof", walkable: true},
          %{dx: 5, dy: 2, level: 0, label: "wall", walkable: false},
          %{dx: 5, dy: 2, level: 1, label: "wall", walkable: false},
          %{dx: 5, dy: 2, level: 2, label: "wall", walkable: false},
          %{dx: 5, dy: 2, level: 3, label: "window", walkable: false},
          %{dx: 5, dy: 2, level: 4, label: "roof", walkable: false},
          %{dx: 0, dy: 3, level: 0, label: "wall", walkable: false},
          %{dx: 0, dy: 3, level: 1, label: "wall", walkable: false},
          %{dx: 0, dy: 3, level: 2, label: "wall", walkable: false},
          %{dx: 0, dy: 3, level: 3, label: "window", walkable: false},
          %{dx: 0, dy: 3, level: 4, label: "roof", walkable: false},
          %{dx: 1, dy: 3, level: 0, label: "wall", walkable: false},
          %{dx: 1, dy: 3, level: 1, label: "wall", walkable: false},
          %{dx: 1, dy: 3, level: 2, label: "wall", walkable: false},
          %{dx: 1, dy: 3, level: 3, label: "window", walkable: false},
          %{dx: 1, dy: 3, level: 4, label: "roof", walkable: false},
          %{dx: 1, dy: 3, level: 5, label: "roof", walkable: false},
          %{dx: 2, dy: 3, level: 0, label: "wall", walkable: false},
          %{dx: 2, dy: 3, level: 1, label: "wall", walkable: false},
          %{dx: 2, dy: 3, level: 2, label: "wall", walkable: false},
          %{dx: 2, dy: 3, level: 3, label: "window", walkable: false},
          %{dx: 2, dy: 3, level: 4, label: "roof", walkable: false},
          %{dx: 2, dy: 3, level: 5, label: "roof", walkable: false},
          %{dx: 3, dy: 3, level: 0, label: "door", walkable: true},
          %{dx: 3, dy: 3, level: 1, label: "wall", walkable: true},
          %{dx: 3, dy: 3, level: 2, label: "wall", walkable: true},
          %{dx: 3, dy: 3, level: 3, label: "window", walkable: true},
          %{dx: 3, dy: 3, level: 4, label: "roof", walkable: true},
          %{dx: 3, dy: 3, level: 5, label: "roof", walkable: true},
          %{dx: 4, dy: 3, level: 0, label: "wall", walkable: false},
          %{dx: 4, dy: 3, level: 1, label: "wall", walkable: false},
          %{dx: 4, dy: 3, level: 2, label: "wall", walkable: false},
          %{dx: 4, dy: 3, level: 3, label: "window", walkable: false},
          %{dx: 4, dy: 3, level: 4, label: "roof", walkable: false},
          %{dx: 4, dy: 3, level: 5, label: "roof", walkable: false},
          %{dx: 5, dy: 3, level: 0, label: "wall", walkable: false},
          %{dx: 5, dy: 3, level: 1, label: "wall", walkable: false},
          %{dx: 5, dy: 3, level: 2, label: "wall", walkable: false},
          %{dx: 5, dy: 3, level: 3, label: "window", walkable: false},
          %{dx: 5, dy: 3, level: 4, label: "roof", walkable: false}
        ]
      }
    }
  end
end

