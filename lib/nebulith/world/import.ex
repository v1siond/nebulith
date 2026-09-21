defmodule Nebulith.World.Import do
  @moduledoc """
  TURNS A SAVED `Template` INTO ROWS.

  `Template.groundData`, `heightData` and `assetsData` are the three blobs phase 3 replaces. This reads
  one and writes the map, grid, cells and cell_tiles it describes, so the maps somebody already
  authored survive the move instead of being left behind in a column nothing reads.

  Idempotent by map name: a second run rewrites the same map rather than making another one.

  ## The translations, and why each is what it is

  **Zoom is folded into the axes, not dropped.** A saved `scale` multiplied all three draw axes, so
  discarding it would shrink every tile that used one. It is multiplied into `width`, `height` and
  `depth` instead, which is the same picture expressed in the primitive that survives (D20).

  **`depth` became `span_forward`.** The old field counted CELLS despite its name, which is the clash
  this phase ends. `depthBack`, `depthPerp` and `depthPerpBack` counted EXTRA cells beyond the anchor,
  so they arrive as counts: absent means 1 cell, which is the anchor and nothing more.

  **`scaleZ` became the four thickness reaches.** With no direction it was a uniform squash of the
  block inside its own cell, which is all four reaches at once. A `thickness` map names them directly.

  **`heightLevel` became `stack_level`,** and `stack_index` is a fresh ordinal per cell. They answered
  different questions under one name: which level a tile sits on, and which tile in the stack it is.

  **`actAsTile` is written explicitly, even where it was absent.** The old default was true for every
  cell and the column's default is false, so leaving it unsaid would change how a saved map stacks.
  The column states the new default; this states what the old map actually did.

  **`blocking` and `collision` are NOT imported.** A cell is blocked where a collision box says so, and
  `collision_boxes` is phase 4. Carrying the flag forward is exactly what was asked not to happen.

  **Animations, lights, cycles and badges are not imported.** They get real tables in phases 6 and
  later. They stay in the `Template` row until then rather than being flattened into columns that would
  have to be unflattened again.
  """
  import Ecto.Query

  alias Nebulith.Repo
  alias Nebulith.World
  alias Nebulith.World.Cell

  # 0 = +col, 1 = +row, 2 = -col, 3 = -row, in the engine's own quarter turns.
  @headings %{0 => "e", 1 => "s", 2 => "w", 3 => "n"}

  @doc "Imports every saved template. Returns how many maps were written."
  def import_all do
    templates = Repo.all(from t in "Template", select: %{id: t.id, name: t.name})

    Enum.map(templates, fn t -> import_template(t.id) end)
  end

  @doc "Imports one template by id, as `{:ok, map}` or `{:error, reason}`."
  def import_template(template_id) do
    case fetch_template(template_id) do
      nil -> {:error, :no_such_template}
      template -> write(template)
    end
  end

  defp fetch_template(id) do
    query =
      from t in "Template",
        where: t.id == ^id,
        select: %{
          id: t.id,
          name: t.name,
          description: t.description,
          cols: t.cols,
          rows: t.rows,
          cell_size: t.cellSize,
          iso_scale: t.isoScale,
          slab_blocks: t.slabBlocks,
          spawn_col: t.spawnCol,
          spawn_row: t.spawnRow,
          ground: t.groundData,
          heights: t.heightData,
          assets: t.assetsData
        }

    Repo.one(query)
  end

  defp write(template) do
    tiles = tiles_by_label()
    map = map_for(template)

    payload = %{
      "map" => %{
        "name" => template.name,
        "description" => template.description,
        "template_id" => template.id
      },
      "grid" => grid_attrs(template),
      "cells" => cells(template, tiles)
    }

    case World.save_map(map.id, payload) do
      {:ok, _loaded} -> {:ok, map}
      other -> other
    end
  end

  # One map per TEMPLATE, so running this twice rewrites rather than duplicates. By the template's id
  # rather than its name: two maps can share a name, and a rename must not orphan the map.
  defp map_for(template) do
    case Repo.one(from m in World.Map, where: m.template_id == ^template.id, limit: 1) do
      nil -> created_map(template)
      map -> Repo.preload(map, :grid)
    end
  end

  defp created_map(template) do
    {:ok, map} =
      World.create_map(%{
        "map" => %{
          "name" => template.name,
          "description" => template.description,
          "template_id" => template.id
        },
        "grid" => grid_attrs(template)
      })

    map
  end

  defp grid_attrs(template) do
    %{
      "cols" => template.cols,
      "rows" => template.rows,
      "cell_size" => template.cell_size,
      "iso_scale" => to_string(template.iso_scale || 2.5),
      "slab_blocks" => template.slab_blocks || 1,
      "spawn_col" => template.spawn_col,
      "spawn_row" => template.spawn_row
    }
  end

  # A LABEL'S ROW AND ITS OWN HEIGHT. The height matters as much as the id: the catalogue is thin and
  # the PLACEMENT is fat, so a placement that states no height of its own has to be given the tile's
  # here, at write time. The renderer reads the placement and only the placement.
  #
  # Measured on the real map before this existed: meadow, floor and path_stone are all authored FLAT
  # (height 0), and defaulting the placement to 1 turned 3,129 squares of ground into full cubes.
  defp tiles_by_label do
    from(t in "tiles", select: {t.label, {t.id, t.height}})
    |> Repo.all()
    |> Enum.reduce(%{}, fn {label, row}, acc -> Elixir.Map.put_new(acc, label, row) end)
  end

  # A cell row exists where the map says anything about that square: a texture, a height, or a tile
  # standing in it. A square nobody touched gets no row, which is what keeps a 40x40 map from writing
  # 1600 rows of nothing.
  defp cells(template, tiles) do
    ground = template.ground || []
    heights = template.heights || []
    by_cell = Enum.group_by(template.assets || [], fn a -> {a["col"], a["row"]} end)

    coordinates(template, ground, by_cell)
    |> Enum.map(fn {col, row} ->
      %{
        "col" => col,
        "row" => row,
        "ground_height" => at(heights, row, col) || 0,
        "texture_tile_id" => tile_id(tiles, at(ground, row, col)),
        "tiles" => tiles_of(by_cell[{col, row}] || [], tiles)
      }
    end)
  end

  defp coordinates(template, ground, by_cell) do
    from_ground =
      for row <- 0..(template.rows - 1)//1,
          col <- 0..(template.cols - 1)//1,
          at(ground, row, col),
          do: {col, row}

    (from_ground ++ Elixir.Map.keys(by_cell))
    |> Enum.uniq()
    |> Enum.sort_by(fn {col, row} -> {row, col} end)
  end

  defp at(grid, row, col) do
    grid |> Enum.at(row, []) |> Enum.at(col)
  end

  defp tiles_of(assets, tiles) do
    assets
    |> Enum.sort_by(&(&1["heightLevel"] || 0))
    |> Enum.map(&tile_of(&1, tiles))
  end

  defp tile_of(asset, tiles) do
    zoom = number(asset["scale"], 1.0)
    settings = asset["settings"] || %{}
    pose = asset["pose"] || %{}
    thickness = asset["thickness"] || %{}
    squash = number(asset["scaleZ"], 1.0)

    label = label_of(asset)

    %{
      "tile_id" => tile_id(tiles, label),
      "stack_level" => trunc(number(asset["heightLevel"], 0)),

      # Zoom folded in, so the picture survives the concept going away.
      "width" => text(number(asset["scaleX"], 1.0) * zoom),
      # THE ONE HEIGHT, stated on the placement. What the placement said, times its vertical stretch,
      # and where it said nothing the TILE's own height rather than a 1 nobody chose.
      "height" =>
        text(
          number(asset["height"], tile_height(tiles, label)) * number(asset["scaleY"], 1.0) * zoom
        ),
      "depth" => text(zoom),

      # A reach named directly wins; otherwise the old uniform squash applies to all four.
      "thickness_lu" => text(number(thickness["left-up"], squash)),
      "thickness_ru" => text(number(thickness["right-up"], squash)),
      "thickness_ld" => text(number(thickness["left-down"], squash)),
      "thickness_rd" => text(number(thickness["right-down"], squash)),

      # Counts of whole cells. The old fields counted EXTRA cells beyond the anchor.
      "span_forward" => trunc(number(asset["depth"], 1)),
      "span_back" => trunc(number(asset["depthBack"], 0)) + 1,
      "span_perp" => trunc(number(asset["depthPerp"], 0)) + 1,
      "span_perp_back" => trunc(number(asset["depthPerpBack"], 0)) + 1,
      "span_axis" => asset["depthDir"],
      "nudge_x" => text(number(pose["x"], 0.0)),
      "nudge_y" => text(number(pose["y"], 0.0)),
      "rotation" => text(number(pose["rotate"], 0.0)),
      "mirror" => pose["flip"] == true,
      "slide_amount" => text(number(asset["zOffset"], 0.0)),
      "slide_direction" => asset["zDir"],
      "draw_order" => trunc(number(asset["zIndex"], 0)),

      # The old default was true for every cell; the column's default is false.
      "act_as_tile" => Elixir.Map.get(settings, "actAsTile", true) == true,
      "display" => display_of(settings),
      "transparent" => settings["transparent"] == true,
      "shape" => asset["shape"] || "square",
      "color" => asset["color"],
      "opacity" => text(number(asset["opacity"], 1.0)),
      "brightness" => text(number(asset["brightness"], 1.0)),
      "bg_color" => asset["bgColor"],
      "side_color" => asset["sideColor"],
      "fade_near" => settings["fadeNear"] == true,
      "cutaway_near" => settings["cutawayRoof"] == true,
      "min_alpha" => optional_text(settings["minAlpha"]),
      "sign_text" => get_in(settings, ["badge", "text"]),
      "sign_color" => get_in(settings, ["badge", "color"]),
      "water_heading" => @headings[asset["flow"]]
    }
  end

  defp tile_id(tiles, label) do
    case tiles[label] do
      {id, _height} -> id
      _ -> nil
    end
  end

  defp tile_height(tiles, label) do
    case tiles[label] do
      {_id, height} when is_number(height) -> height
      _ -> 1.0
    end
  end

  # The label is what every by-label lookup needs. An explicit per-cell art pin wins over it, and the
  # asset's TYPE is the last resort because for a floor the type IS the label.
  defp label_of(asset) do
    asset["label"] || asset["tileOverride"] || asset["tileKey"] || asset["type"]
  end

  defp display_of(%{"display" => "single"}), do: "single"
  defp display_of(_settings), do: "all_faces"

  defp number(nil, fallback), do: fallback
  defp number(value, _fallback) when is_number(value), do: value
  defp number(_value, fallback), do: fallback

  defp text(value), do: value |> :erlang.float() |> Float.round(6) |> Float.to_string()

  defp optional_text(nil), do: nil
  defp optional_text(value) when is_number(value), do: text(value)
  defp optional_text(_value), do: nil

  @doc "How many cells and tiles a map ended up with, for a run to report something real."
  def counts(map_id) do
    grid = Repo.one(from g in World.Grid, where: g.map_id == ^map_id)

    cells = Repo.aggregate(from(c in Cell, where: c.grid_id == ^grid.id), :count)

    tiles =
      Repo.one(
        from t in "cell_tiles",
          join: c in Cell,
          on: c.id == t.cell_id,
          where: c.grid_id == ^grid.id,
          select: count(t.id)
      )

    %{cells: cells, tiles: tiles}
  end
end
