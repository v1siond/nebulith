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

  @doc """
  The map a template became, importing it the first time it is asked for.

  The editor still addresses a map by its `Template` id while both exist, and a map that has never
  been imported has to answer the first request rather than 404 and lose somebody their work. See
  `Nebulith.World.Import` for what the import does and what it deliberately leaves behind.
  """
  def map_for_template(template_id) do
    case Repo.one(from m in Nebulith.World.Map, where: m.template_id == ^template_id, limit: 1) do
      nil -> Nebulith.World.Import.import_template(template_id)
      map -> {:ok, Repo.preload(map, :grid)}
    end
  end

  @doc """
  Deletes the map a template became, if it became one.

  A map outlives the template it came from otherwise, with all of its cells, because the bridge is a
  plain column and nothing cascades through it. Four of them were left behind by the gates before this
  existed, carrying 3,260 placed tiles between them.
  """
  def delete_map_for_template(template_id) do
    Repo.delete_all(from m in Nebulith.World.Map, where: m.template_id == ^template_id)
    :ok
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
    texture_labels = labels_by_tile_id(Enum.map(cells, & &1.texture_tile_id))

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
      |> Elixir.Map.put("texture_label", texture_labels[cell.texture_tile_id])
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
    labels = labels_by_tile_id(Enum.map(tiles, & &1.tile_id))

    Enum.map(tiles, fn tile ->
      tile
      |> take([:id | CellTile.settable_fields()])
      |> Elixir.Map.put("label", labels[tile.tile_id])
      |> Elixir.Map.put("views", view_payloads(views_by_tile[tile.id] || []))
    end)
  end

  # THE LABEL TRAVELS WITH THE TILE, both ways.
  #
  # A style is only a different picture for the same label, and a label owns everything but the
  # picture, so the engine resolves what to draw BY LABEL and has no use for a row id. Serving the id
  # alone would make the client hold a table of ids to labels, which is a second vocabulary whose only
  # job is to be translated back.
  defp labels_by_tile_id(ids) do
    ids
    |> Enum.reject(&is_nil/1)
    |> Enum.uniq()
    |> lookup_labels()
  end

  defp lookup_labels([]), do: %{}

  defp lookup_labels(ids) do
    from(t in "tiles", where: t.id in ^ids, select: {t.id, t.label})
    |> Repo.all()
    |> Elixir.Map.new()
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
    payload = resolve_labels(map, payload)

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

  # A CALLER SENDS LABELS, because that is what the engine speaks. Resolved here, once, against the
  # map's own art style, so nothing upstream has to know a row id and a map that changes style keeps
  # pointing at the right rows.
  #
  # A label the catalogue does not carry resolves to nothing rather than to something near it: a tile
  # drawn as a neighbour is worse than a tile that is visibly missing.
  defp resolve_labels(map, payload) do
    cells = Elixir.Map.get(payload, "cells", [])
    labels = stated_labels(cells)

    resolve_with(payload, cells, tile_ids_for(map, labels))
  end

  defp resolve_with(payload, _cells, ids) when map_size(ids) == 0, do: payload

  defp resolve_with(payload, cells, ids) do
    Elixir.Map.put(payload, "cells", Enum.map(cells, &resolve_cell(&1, ids)))
  end

  defp resolve_cell(cell, ids) do
    cell
    |> put_resolved("texture_label", "texture_tile_id", ids)
    |> Elixir.Map.put(
      "tiles",
      Enum.map(cell["tiles"] || [], &put_resolved(&1, "label", "tile_id", ids))
    )
  end

  # An explicit id wins, so a caller that already has one is never second-guessed.
  defp put_resolved(row, label_key, id_key, ids) do
    case {row[label_key], row[id_key]} do
      {nil, _} -> row
      {_label, id} when not is_nil(id) -> row
      {label, nil} -> Elixir.Map.put(row, id_key, ids[label])
    end
  end

  defp stated_labels(cells) do
    Enum.flat_map(cells, fn cell ->
      tile_labels = Enum.map(cell["tiles"] || [], & &1["label"])

      [cell["texture_label"] | tile_labels]
    end)
    |> Enum.reject(&is_nil/1)
    |> Enum.uniq()
  end

  defp tile_ids_for(_map, []), do: %{}

  defp tile_ids_for(map, labels) do
    # The map's own style first; anything it does not carry falls to whatever style does, because a
    # label owns the tile and the style owns only its picture.
    preferred = tile_ids_in(labels, map.tileset_id)
    everywhere = tile_ids_in(labels, nil)

    Elixir.Map.merge(everywhere, preferred)
  end

  defp tile_ids_in(labels, nil) do
    from(t in "tiles", where: t.label in ^labels, select: {t.label, t.id})
    |> Repo.all()
    |> Elixir.Map.new()
  end

  defp tile_ids_in(labels, tileset_id) do
    from(t in "tiles",
      where: t.label in ^labels and t.tileset_id == ^tileset_id,
      select: {t.label, t.id}
    )
    |> Repo.all()
    |> Elixir.Map.new()
  end

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

  # WHICH COLUMNS ARE DECIMALS, ASKED OF THE SCHEMA.
  #
  # This was a hand-written list of seventeen names, and law 10 says what happens next: `placed_at`
  # arrived as a decimal column, was not on the list, and its value went to Postgres as the string it
  # travels as. `insert_all` skips changesets, so nothing cast it and nothing complained until the whole
  # map failed to save.
  #
  # The schema already knows every column's type. Asking it is shorter than the list was and cannot fall
  # behind it. Derived at call time for the same reason `settable_fields/0` is: `__schema__/1` does not
  # exist until the module has finished compiling.
  defp decimal_field?(field), do: CellTile.__schema__(:type, field) == :decimal

  defp cast_field(field, value) do
    case decimal_field?(field) do
      true -> decimal(value, nil)
      false -> value
    end
  end

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
