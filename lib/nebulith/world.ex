defmodule Nebulith.World do
  @moduledoc """
  MAPS, GRIDS, CELLS AND THE TILES IN THEM.

  A map's contents used to be three JSON columns on `Template`. They are rows now, and the difference
  that matters is not tidiness: a column can carry a DEFAULT, and a blob cannot. Every one of the 116
  places where a renderer invented a value has a column here that states it instead.

  ## The wire spelling IS the column name

  Nothing in this module renames anything on the way out or on the way back. A payload key is a column
  name, exactly as spelled. There is no translation table in either direction, because a second
  vocabulary whose whole job is to be translated back is not a concept, it is a bug with a schedule.

  ## Saving replaces, it does not merge

  A save is the whole map. Cells and their tiles are deleted and rewritten inside one transaction, so a
  tile a person removed is actually gone rather than surviving as a row nobody sent. `maps.lock_version`
  is what stops two editors from silently overwriting each other.
  """

  import Ecto.Query, warn: false

  alias Ecto.Multi
  alias Nebulith.Repo
  alias Nebulith.World.{Cell, CellTile, CellTileView, Grid}

  # Postgres takes 65535 bind parameters per statement. A cell_tile has 55 columns, so anything over
  # ~1100 rows per chunk fails, and it fails only on a big map, which is the worst time to find out.
  @cell_chunk 800
  @tile_chunk 500

  ## READING

  @doc "Every map, newest first, without their contents."
  def list_maps do
    Repo.all(from m in Nebulith.World.Map, order_by: [desc: m.updated_at])
  end

  @doc "One map with its grid, or nil."
  def get_map(id) do
    Nebulith.World.Map
    |> Repo.get(id)
    |> Repo.preload(:grid)
  end

  @doc "One map with its grid, or `:error` rather than nil, for callers that want to pattern match."
  def fetch_map(id) do
    case get_map(id) do
      nil -> :error
      map -> {:ok, map}
    end
  end

  @doc """
  A whole map as data: the map, its grid, and every cell with the tiles standing in it.

  Cells come back in grid order and tiles in stack order, so two loads of one map are byte-identical
  and the round-trip gate compares something stable.
  """
  def load_map(id) do
    case get_map(id) do
      nil -> :error
      map -> {:ok, payload(map)}
    end
  end

  defp payload(map) do
    grid = map.grid

    %{
      "map" =>
        take(map, [:id, :name, :description, :level_id, :tileset_id, :zone_id, :lock_version]),
      "grid" => grid_payload(grid),
      "cells" => cells_payload(grid)
    }
  end

  defp grid_payload(nil), do: nil

  defp grid_payload(grid) do
    take(grid, [
      :id,
      :cols,
      :rows,
      :cell_size,
      :iso_scale,
      :slab_blocks,
      :generator_id,
      :seed,
      :spawn_col,
      :spawn_row
    ])
  end

  defp cells_payload(nil), do: []

  defp cells_payload(grid) do
    cells =
      Repo.all(from c in Cell, where: c.grid_id == ^grid.id, order_by: [asc: c.row, asc: c.col])

    tiles_by_cell = tiles_by_cell(Enum.map(cells, & &1.id))
    views_by_tile = views_by_tile(tiles_by_cell)

    Enum.map(cells, fn cell ->
      cell
      |> take([
        :id,
        :col,
        :row,
        :ground_height,
        :surface,
        :submerge,
        :texture_tile_id,
        :region_id
      ])
      |> Elixir.Map.put("tiles", tile_payloads(tiles_by_cell[cell.id] || [], views_by_tile))
    end)
  end

  defp tiles_by_cell([]), do: %{}

  defp tiles_by_cell(cell_ids) do
    CellTile
    |> where([t], t.cell_id in ^cell_ids)
    |> order_by([t], asc: t.stack_index, asc: t.inserted_at)
    |> Repo.all()
    |> Enum.group_by(& &1.cell_id)
  end

  defp views_by_tile(tiles_by_cell) do
    ids = tiles_by_cell |> Elixir.Map.values() |> List.flatten() |> Enum.map(& &1.id)

    views_for(ids)
  end

  defp views_for([]), do: %{}

  defp views_for(ids) do
    CellTileView
    |> where([v], v.cell_tile_id in ^ids)
    |> order_by([v], asc: v.view)
    |> Repo.all()
    |> Enum.group_by(& &1.cell_tile_id)
  end

  defp tile_payloads(tiles, views_by_tile) do
    Enum.map(tiles, fn tile ->
      tile
      |> take([:id | CellTile.settable_fields()])
      |> Elixir.Map.put("views", view_payloads(views_by_tile[tile.id] || []))
    end)
  end

  defp view_payloads(views) do
    Enum.map(views, &take(&1, [:view, :width, :height, :depth, :nudge_x, :nudge_y, :anchor_lift]))
  end

  # The key is the column name, spelled the way the column is spelled. Decimals go out as strings so a
  # value survives the trip without a float rounding it, which is what makes an exact round-trip possible.
  defp take(struct, fields) do
    Elixir.Map.new(fields, fn field ->
      {Atom.to_string(field), wire(Elixir.Map.get(struct, field))}
    end)
  end

  defp wire(%Decimal{} = value), do: Decimal.to_string(value, :normal)
  defp wire(value), do: value

  ## WRITING

  @doc """
  Creates a map and its grid together. A map with no grid has no shape, so it is never a valid state.
  """
  def create_map(attrs) do
    map_attrs = Elixir.Map.get(attrs, "map", attrs)
    grid_attrs = Elixir.Map.get(attrs, "grid", %{})

    Multi.new()
    |> Multi.insert(:map, Nebulith.World.Map.changeset(%Nebulith.World.Map{}, map_attrs))
    |> Multi.insert(:grid, fn %{map: map} ->
      Grid.changeset(%Grid{}, Elixir.Map.put(grid_attrs, "map_id", map.id))
    end)
    |> Repo.transaction()
    |> created()
  end

  defp created({:ok, %{map: map, grid: grid}}), do: {:ok, %{map | grid: grid}}
  defp created({:error, _step, changeset, _changes}), do: {:error, changeset}

  @doc """
  Writes a whole map: its grid numbers, its cells, and the tiles standing in them.

  Replaces rather than merges, in one transaction. A caller sends the map it has; what it does not send
  is gone, which is what removing a tile means.
  """
  def save_map(id, payload) do
    case get_map(id) do
      nil -> :error
      map -> validated(map, payload, offences(payload))
    end
  end

  defp validated(map, payload, []), do: write(map, payload)
  defp validated(_map, _payload, offences), do: {:error, %{payload: offences}}

  # WRITING A WHOLE MAP GOES THROUGH insert_all, which is the only way 2,568 tiles land in under a
  # second, and insert_all skips changesets. So the vocabulary is checked HERE, before anything is
  # written. Without it a bad value reaches the check constraint and comes back as a raw database
  # error, which tells a caller nothing about which cell or which setting was wrong.
  defp offences(payload) do
    cells = Elixir.Map.get(payload, "cells", [])

    Enum.flat_map(cells, fn cell ->
      cell_offences(cell) ++ Enum.flat_map(cell["tiles"] || [], &tile_offences(cell, &1))
    end)
  end

  defp cell_offences(cell) do
    case Elixir.Map.get(cell, "surface") do
      nil -> []
      surface -> known(surface, Cell.surfaces(), "cell #{at(cell)} surface")
    end
  end

  defp tile_offences(cell, tile) do
    Enum.flat_map(CellTile.vocabularies(), fn {field, allowed} ->
      key = Atom.to_string(field)

      case Elixir.Map.get(tile, key) do
        nil -> []
        value -> known(value, allowed, "cell #{at(cell)} tile #{key}")
      end
    end)
  end

  defp known(value, allowed, where) do
    case value in allowed do
      true -> []
      false -> ["#{where}: #{inspect(value)} is not one of #{Enum.join(allowed, ", ")}"]
    end
  end

  defp at(cell), do: "#{cell["col"]},#{cell["row"]}"

  defp write(map, payload) do
    Multi.new()
    |> Multi.update(:map, Nebulith.World.Map.changeset(map, Elixir.Map.get(payload, "map", %{})))
    |> Multi.update(:grid, Grid.changeset(map.grid, Elixir.Map.get(payload, "grid", %{})))
    |> Multi.delete_all(:clear, from(c in Cell, where: c.grid_id == ^map.grid.id))
    |> Multi.run(:cells, fn repo, %{grid: grid} ->
      {:ok, insert_cells(repo, grid, Elixir.Map.get(payload, "cells", []))}
    end)
    |> Multi.run(:tiles, fn repo, %{cells: rows} ->
      {:ok, insert_tiles(repo, rows, Elixir.Map.get(payload, "cells", []))}
    end)
    |> Repo.transaction()
    |> saved(map.id)
  end

  defp saved({:ok, _changes}, id), do: load_map(id)
  defp saved({:error, _step, reason, _changes}, _id), do: {:error, reason}

  # Cells first, in bulk, keeping the id we minted so the tiles can point at it without a second read.
  defp insert_cells(repo, grid, cells) do
    now = DateTime.utc_now() |> DateTime.truncate(:second)

    rows =
      Enum.map(cells, fn cell ->
        %{
          id: Ecto.UUID.generate(),
          grid_id: grid.id,
          col: integer(cell["col"], 0),
          row: integer(cell["row"], 0),
          ground_height: integer(cell["ground_height"], 0),
          surface: string(cell["surface"], "flat"),
          submerge: decimal(cell["submerge"], "0.0"),
          texture_tile_id: cell["texture_tile_id"],
          region_id: cell["region_id"],
          inserted_at: now,
          updated_at: now
        }
      end)

    rows
    |> Enum.chunk_every(@cell_chunk)
    |> Enum.each(&repo.insert_all(Cell, &1))

    rows
  end

  defp insert_tiles(repo, cell_rows, cells) do
    now = DateTime.utc_now() |> DateTime.truncate(:second)
    defaults = tile_defaults()

    rows =
      cell_rows
      |> Enum.zip(cells)
      |> Enum.flat_map(fn {row, cell} ->
        tile_rows(row.id, cell["tiles"] || [], defaults, now)
      end)

    rows
    |> Enum.chunk_every(@tile_chunk)
    |> Enum.each(&repo.insert_all(CellTile, &1))

    rows
  end

  defp tile_rows(cell_id, tiles, defaults, now) do
    tiles
    |> Enum.with_index()
    |> Enum.map(fn {tile, index} ->
      defaults
      |> Elixir.Map.merge(stated(tile))
      |> Elixir.Map.merge(%{
        id: Ecto.UUID.generate(),
        cell_id: cell_id,
        stack_index: integer(tile["stack_index"], index),
        inserted_at: now,
        updated_at: now
      })
    end)
  end

  # EVERY column starts at the schema's default, so a caller who says nothing gets what the database
  # says rather than what some renderer would have guessed. This map is built from the struct, so a new
  # column arrives here the moment it is added to the schema.
  defp tile_defaults do
    blank = %CellTile{}

    Elixir.Map.new(CellTile.settable_fields(), fn field ->
      {field, Elixir.Map.get(blank, field)}
    end)
  end

  # Only what the caller actually STATED, so an absent key keeps the default rather than nulling it.
  defp stated(tile) do
    CellTile.settable_fields()
    |> Enum.reject(&(&1 in [:cell_id, :stack_index]))
    |> Enum.filter(&Elixir.Map.has_key?(tile, Atom.to_string(&1)))
    |> Elixir.Map.new(fn field -> {field, cast_field(field, tile[Atom.to_string(field)])} end)
  end

  @decimal_fields ~w(width height depth thickness_lu thickness_ru thickness_ld thickness_rd
                     nudge_x nudge_y rotation art_scale muzzle slide_amount opacity brightness
                     min_alpha)a

  defp cast_field(field, value) when field in @decimal_fields, do: decimal(value, nil)
  defp cast_field(_field, value), do: value

  defp integer(nil, fallback), do: fallback
  defp integer(value, _fallback) when is_integer(value), do: value
  defp integer(value, fallback) when is_binary(value), do: parse_integer(value, fallback)
  defp integer(_value, fallback), do: fallback

  defp parse_integer(value, fallback) do
    case Integer.parse(value) do
      {parsed, _rest} -> parsed
      :error -> fallback
    end
  end

  defp string(nil, fallback), do: fallback
  defp string(value, _fallback) when is_binary(value), do: value
  defp string(_value, fallback), do: fallback

  defp decimal(nil, nil), do: nil
  defp decimal(nil, fallback), do: Decimal.new(fallback)
  defp decimal(%Decimal{} = value, _fallback), do: value
  defp decimal(value, _fallback) when is_integer(value), do: Decimal.new(value)
  defp decimal(value, _fallback) when is_float(value), do: Decimal.from_float(value)
  defp decimal(value, fallback) when is_binary(value), do: parse_decimal(value, fallback)

  defp parse_decimal(value, fallback) do
    case Decimal.parse(value) do
      {parsed, _rest} -> parsed
      :error -> decimal(nil, fallback)
    end
  end
end
