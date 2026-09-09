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
  (The ENTRANCE apron is gone — #49: once every tile became a height-1 block it stood UP in front of the
  doors and blocked the doorway it served. Doors open straight onto the ground.) It always
  matches the doors block for block — 2 doors → a 2-block entrance, 3 doors → a 3-block one — with
  each contiguous run collapsed to ONE z-width block (G7). The apron places the `path` FLOOR tile, so
  the doorstep carries the floor's own minimal height and lies FLAT like the road it joins — height is
  the TILE's data, never the composition's (MAP-MODEL §4/§5).

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

  # Sidebar CATEGORY for every composition this module authors — they are ALL buildings (a perimeter wall
  # box with a door), so they share the tile-mirroring `buildings` bucket (MAP-MODEL §8). This is authored
  # DATA per composition, not a frontend name/door guess.
  @category "buildings"

  @doc """
  Every baked building composition, keyed by type_length (hyphens in the type become underscores).

  Cells reference type-specific tiles (per `@type_tiles`) and store/hospital carry their apex-signage
  `title`, so the seeded compositions render each building's own colours + name. Every one carries the
  `buildings` `category` so the palette groups it exactly like a tile.
  """
  def all do
    for {name, comp} <- definitions(), into: %{} do
      {name, comp |> remap_cells(name) |> put_title(name) |> put_category()}
    end
  end

  # Tag the composition with its sidebar bucket. Everything this module builds IS a building, so the
  # category is constant here — the tree/bush/prop compositions live in TileSource with their own.
  defp put_category(comp), do: Map.put(comp, :category, @category)

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

  # ── BUILDINGS AT ANY SIZE ───────────────────────────────────────────────────
  #
  # Alexander, 2026-09-08: *"i think we should NOT have a fixed size, but a default one and allow user to
  # specify the size of the element they want to put — for example, why having 3 size house when we can have
  # 1 house button and allow user to make a house as big or as small as he wants??? … i want to be able to
  # generate a store of any size, a hospital of any size, etc."*
  #
  # The size used to live in a STRING: eleven compositions named `house_3` / `house_4` / `house_5`, with the
  # width recovered by parsing the name (`buildingCatalog.ts:41` says so outright). But the RECIPE was
  # already parametric — `house/4`, `store/0`, `office/0` and `civic/7` were the same function five times
  # over, differing only in a material, a roof kind, which courses carry windows, and at most one extra.
  #
  # So this is that table, and the five builders collapse into it. Per the spec: one ROW per type, so adding
  # "warehouse" is a row and never a branch.
  #
  # Two rules the eleven seeds already obey, derived from them rather than invented (the spec listed both as
  # open questions; the answers were in the code):
  #
  #   · **Wall height from width:** `max(3, min(width - 3, 8))`. Fits all eleven — houses at 3–6 wide are
  #     wall_top 3, cathedral (7) is 4, temple (8) is 5, castle (12) is 8. `wall_top_bonus` is the one
  #     override, for the office, which is authored deliberately taller than a house of the same width.
  #   · **Windows on the odd courses up to the wall top** — `1, 3, 5, …` — so a wall course always sits
  #     between floors. Fits all eleven: house [1,3], cathedral [1,3], temple/office [1,3,5],
  #     castle [1,3,5,7].
  #
  # `materials` is a LIST because Alexander asked for the material to be rolled, not fixed: *"pick random
  # material, but allow user to change the selected roof, walls, windows and doors."* A one-entry list is a
  # type whose material is part of its identity (a hospital is plaster).
  @building_types %{
    "house" => %{
      materials: ["wall_brick", "wall_wood", "wall_stone"],
      roof: :gable,
      default: {4, 4}
    },
    "big_house" => %{materials: ["wall_brick"], roof: :gable, default: {6, 4}},
    "hospital" => %{
      materials: ["wall_plaster"],
      roof: {:gable, "roof_hospital", "roof_top_hospital"},
      title: "Hospital",
      default: {6, 4}
    },
    "store" => %{
      materials: ["wall_brick"],
      roof: {:flat, title: true},
      # The ground floor is a storefront centred on the door — a display window either side under an awning
      # course. Already width-relative in the authored store (`abs(dx - door_col) <= 1`), so it needs no
      # rule of its own to work at another width.
      storefront: true,
      # A SHOP's windows are not a house's. Two differences, both read off the authored store rather than
      # chosen: they sit on the FRONT only (a shop shows its goods to the street, and its back is a wall),
      # and only on the TOP course — the courses below are the storefront and its awning.
      window_faces: :front,
      window_levels: :top_course,
      title: "Store",
      default: {5, 4}
    },
    "office" => %{
      materials: ["wall_stone"],
      roof: {:flat, []},
      # The office is authored taller than its width implies — it is the "apartment block" of the set.
      wall_top_bonus: 2,
      default: {5, 5}
    },
    "temple" => %{materials: ["wall_stone"], roof: {:gable, "roof_slate", "roof_top_slate"}, default: {8, 4}},
    "cathedral" => %{materials: ["wall_stone"], roof: {:gable, "roof_slate", "roof_top_slate"}, default: {7, 5}},
    "castle" => %{materials: ["wall_stone"], roof: {:gable, "roof_slate", "roof_top_slate"}, default: {12, 6}}
  }

  @doc "Every building type this module can compose, for the editor's palette."
  def building_types, do: Map.keys(@building_types) |> Enum.sort()

  @doc """
  The default footprint for a type — `{width, depth}`.

  Alexander, 2026-09-08: *"we should have default values … you can pick one of the old hardcoded values."*
  So each default IS that type's authored footprint, not a new number.
  """
  def default_footprint(type) do
    case Map.fetch(@building_types, type) do
      {:ok, %{default: wh}} -> wh
      :error -> nil
    end
  end

  @doc """
  The smallest building to OFFER — Alexander: *"the smalles house would be something like 4x3"*. Below this
  the facade has no interior column for a window and the door fills the front wall.

  It is advice for the caller, not a rule this module enforces. `compose_building/4` composes exactly the
  size it is asked for, because a composer that silently rewrites its input is the same defect as a map-size
  field that silently rewrites yours — and the authored `house_3` is a live example of a legitimate 3-wide
  building that a hard floor here would make impossible to reproduce.
  """
  def min_footprint, do: {4, 3}

  @doc """
  Compose a building of ANY size.

  `type` is a key of `@building_types`. `width` and `depth` are free, held at `min_footprint/0`. Returns the
  same `%{footprint: …, cells: […]}` shape as the authored compositions, because it is what authors them —
  `definitions/0` calls this eleven times, so the existing composition tests are the proof that this
  generalises the seeds rather than replacing them with something that merely looks similar.

  Options, all of which Alexander asked to be overridable (*"allow user to change the selected roof, walls,
  windows and doors"*):

    * `:material` — a wall material label, else one is ROLLED from the type's list
    * `:roof` / `:roof_top` — the roof body + apex tiles
    * `:wall_top` — the top wall course, else derived from the width
    * `:seed` — makes the material roll reproducible; omit for a genuinely random one
  """
  def compose_building(type, width, depth, opts \\ []) do
    spec = Map.get(@building_types, type)
    if spec == nil, do: raise(ArgumentError, "unknown building type #{inspect(type)}")

    # Composed at EXACTLY the requested size — see `min_footprint/0` for why the floor is not applied here.
    w = max(width, 1)
    h = max(depth, 1)
    wall_top = Keyword.get(opts, :wall_top) || wall_top_for(w, spec)
    mat = Keyword.get(opts, :material) || roll_material(spec, opts)
    win_levels = window_levels(spec, wall_top)
    doors = door_cols(w)

    facade = facade_fun(spec, w, h, wall_top, mat, win_levels, doors)
    roof_cells = roof_for(spec, w, h, wall_top, opts)

    assemble(w, h, wall_top, doors, facade, roof_cells)
  end

  # The observed height curve — see the note on @building_types. `wall_top_bonus` is a per-type override.
  defp wall_top_for(w, spec) do
    max(3, min(w - 3, 8)) + Map.get(spec, :wall_top_bonus, 0)
  end

  # Windows on the odd courses up to the wall top, so a wall course always sits between floors — unless the
  # type says otherwise (a shop glazes only its top course; the ones below are storefront).
  defp window_levels(%{window_levels: :top_course}, wall_top), do: [wall_top]
  defp window_levels(_spec, wall_top), do: Enum.filter(1..wall_top//2, &(rem(&1, 2) == 1))

  # A material is ROLLED, not fixed. Seeded when the caller wants the same building twice (a thumbnail, a
  # test); genuinely random otherwise, which is how the world generator already gets its wall variety.
  defp roll_material(%{materials: [only]}, _opts), do: only

  defp roll_material(%{materials: materials}, opts) do
    case Keyword.get(opts, :seed) do
      nil -> Enum.random(materials)
      seed -> Enum.at(materials, rem(abs(seed), length(materials)))
    end
  end

  # ONE facade, from the table's row. Every authored builder was this `cond` with different arms.
  defp facade_fun(spec, w, h, wall_top, mat, win_levels, doors) do
    storefront? = Map.get(spec, :storefront, false)
    front_only? = Map.get(spec, :window_faces) == :front
    door_col = div(w, 2)

    fn dx, dy, level ->
      front = dy == h - 1
      glazed_face = if front_only?, do: front, else: dy == 0 or dy == h - 1
      shop = storefront? and front and abs(dx - door_col) <= 1

      cond do
        front and dx in doors and level in [0, 1] -> "door"
        shop and level == 0 -> "display_window"
        shop and level == 1 -> "awning"
        glazed_face and window?(dx, w) and level in win_levels -> "window"
        front -> material_piece(mat, dx, level, w, wall_top)
        true -> "#{mat}_c"
      end
    end
  end

  defp roof_for(%{roof: :gable} = _spec, w, h, wall_top, opts) do
    gable_roof(w, h, wall_top, Keyword.get(opts, :roof, "roof"), Keyword.get(opts, :roof_top, "roof_top"))
  end

  defp roof_for(%{roof: {:gable, roof, roof_top}}, w, h, wall_top, opts) do
    gable_roof(w, h, wall_top, Keyword.get(opts, :roof, roof), Keyword.get(opts, :roof_top, roof_top))
  end

  defp roof_for(%{roof: {:flat, flat_opts}}, w, h, wall_top, _opts) do
    flat_roof(w, h, wall_top, flat_opts)
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

  # Group a column list into CONTIGUOUS runs: [2, 3] → [[2, 3]]; [1, 4] → [[1], [4]]; [1, 2, 5] → [[1, 2], [5]].

  # ONE entrance block per run, anchored at the run's leftmost column. A single column stays a plain cell; a
  # wider run carries its z-width so the apron is one block, not one per door.

  # Build the wall box: for every PERIMETER column, collapse levels 0..wall_top (labelled by `facade_fun`) into
  # the FEWEST cells (`wall_column`). The DOORWAY column is walkable end-to-end (you pass through the doorway);
  # every other facade column blocks. Roof cells come from `roof_cells`.
  #
  # A doorway is `dx in doors` AND the FRONT row — the row `facade_fun` actually puts a "door" on. Keying it on
  # the column alone left the BACK wall opposite every door walkable, so you could walk straight through the
  # back of the building (Alexander 2026-09-06: "we're most likely applying the properties wrong").
  defp assemble(w, h, wall_top, doors, facade_fun, roof_cells) do
    walls =
      for dy <- 0..(h - 1), dx <- 0..(w - 1), perimeter?(dx, dy, w, h) do
        wall_column(dx, dy, wall_top, dx in doors and dy == h - 1, facade_fun)
      end

    # NO separate entrance apron (Alexander #49): now that every tile is a height-1 block, the `path` apron in
    # front of the doors became a raised block that BLOCKS the doorway — and it's redundant since the road/ground
    # is already there as colour. The doors open straight onto the ground; road identity + walkability come from
    # the layout, not a doorstep tile.
    cells = List.flatten(walls) ++ roof_cells
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
  # east/west/north. A roof BLOCKS (Alexander 2026-09-06: "roof should have collissions"): it is not a floor and
  # nothing stands on it. It used to be authored walkable on the reasoning that the wall beneath already carried
  # the collision — which left "walkable" claiming you may stand on a roof.
  defp roof_span_cell(dx, level, label, depth, span) do
    settings = %{"depth" => depth, "depthDir" => "left-down"}
    settings = if span > 1, do: Map.put(settings, "scaleY", span), else: settings
    cell(dx, 0, level, label, false) |> Map.put(:settings, settings)
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
  defp flat_roof(w, h, wall_top, opts) do
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
      # AUTHORED THROUGH THE PARAMETRIC COMPOSER, not beside it. Each of these is the same call the editor
      # makes for an arbitrary size, with this building's own footprint and material pinned — so the eleven
      # seeds and every generated building come out of ONE recipe. That is also what makes the existing
      # tests in `building_compositions_test.exs` the proof: they assert the authored data cell-for-cell,
      # and they still pass, so the generalisation reproduces the seeds rather than merely resembling them.
      "house_3" => compose_building("house", 3, 4, material: "wall_brick"),
      "house_4" => compose_building("house", 4, 4, material: "wall_wood"),
      "house_5" =>
        compose_building("house", 5, 4,
          material: "wall_stone",
          roof: "roof_slate",
          roof_top: "roof_top_slate"
        ),
      "store_5" => compose_building("store", 5, 4),
      "office_5" => compose_building("office", 5, 5),
      # STONE BUILDING stays hand-authored: it is the material+piece SAMPLE from TILESET-AUTHORING §3, and
      # Alexander has already agreed it merges with `house_5` (*"yes merge"*) — so generalising it now would
      # be work on something scheduled for deletion.
      "stone_building" => stone_building(),
      # Hospital — box-built like the houses (6-wide, h=4, 2 floors + gable), so its windows are a symmetric
      # spaced grid instead of a solid band. Its identity rides in as builder args: plaster walls + a green
      # gable (roof_hospital / roof_top_hospital); the "Hospital" apex badge stays via @titles.
      "hospital_6" => compose_building("hospital", 6, 4),
      # Big civic buildings — box-built like the houses so their windows are a symmetric spaced grid.
      # WIDTH from the name; h/wall_top preserve each one's authored footprint + height. big_house = brick +
      # red gable; temple/cathedral/castle = stone + slate.
      "big_house_6" => compose_building("big_house", 6, 4),
      "temple_8" => compose_building("temple", 8, 4),
      "cathedral_7" => compose_building("cathedral", 7, 5),
      "castle_12" => compose_building("castle", 12, 6)
    }
  end
end
