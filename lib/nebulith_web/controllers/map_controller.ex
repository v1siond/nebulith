defmodule NebulithWeb.MapController do
  @moduledoc """
  MAPS, AS ROWS RATHER THAN AS A BLOB.

  A map goes out and comes back under the SAME keys, and those keys are the column names, spelled the
  way the columns are spelled. Nothing here renames anything in either direction: a second vocabulary
  whose only job is to be translated back is not a concept.

  `show` and `update` are exact inverses. That is what the round-trip gate asserts, and it is what could
  not be true while a map's contents were three JSON columns nobody could constrain.
  """
  use NebulithWeb, :controller

  alias Nebulith.World

  action_fallback NebulithWeb.FallbackController

  def index(conn, _params) do
    json(conn, %{data: Enum.map(World.list_maps(), &summary/1)})
  end

  def show(conn, %{"id" => id}) do
    case World.load_map(id) do
      {:ok, payload} -> json(conn, %{data: payload})
      :error -> not_found(conn)
    end
  end

  @doc """
  The map a `Template` became.

  The editor addresses a map by its template id for as long as both exist, so this is the door
  between them. It imports on first ask, which is what stops a map that predates phase 3 from
  answering 404 and losing somebody their work.
  """
  def for_template(conn, %{"template_id" => template_id}) do
    case World.map_for_template(template_id) do
      {:ok, map} -> show(conn, %{"id" => map.id})
      {:error, :no_such_template} -> not_found(conn)
      {:error, reason} -> unprocessable_reason(conn, reason)
    end
  end

  def create(conn, params) do
    case World.create_map(params) do
      {:ok, map} -> conn |> put_status(:created) |> json(%{data: summary(map)})
      {:error, changeset} -> unprocessable(conn, changeset)
    end
  end

  def update(conn, %{"id" => id} = params) do
    case World.save_map(id, params) do
      {:ok, payload} -> json(conn, %{data: payload})
      :error -> not_found(conn)
      {:error, %{payload: offences}} -> refused(conn, offences)
      {:error, changeset} -> unprocessable(conn, changeset)
    end
  end

  @doc """
  WHAT A PLACED TILE CAN CARRY, read off the schema.

  The editor builds its controls from this rather than from a list typed out beside them, which is the
  defect phase 3 names: a hand-written field list silently drops what it has not been told about, so a
  setting is authored, saved, and simply gone. A list that is served from the schema cannot fall behind.
  """
  def schema(conn, _params), do: json(conn, %{data: schema_payload()})

  @doc """
  What `/api/maps/schema` serves, as data.

  Lifted out of the action so a test can ask for the payload without going through HTTP, and get the
  same thing the browser gets. The end-to-end layer builds its stubbed responses from this, so a stub
  cannot describe a schema the app does not serve: there is no captured copy to fall behind.
  """
  def schema_payload do
    %{
      "fields" => Enum.map(World.CellTile.settable_fields(), &Atom.to_string/1),
      "defaults" => defaults(),
      "vocabularies" => World.CellTile.vocabularies(),
      "views" => World.CellTileView.views(),
      "cell_surfaces" => World.Cell.surfaces()
    }
  end

  # Every default, from the column, so the engine has no reason to hold one of its own.
  defp defaults do
    blank = %World.CellTile{}

    Elixir.Map.new(World.CellTile.settable_fields(), fn field ->
      {Atom.to_string(field), wire(Elixir.Map.get(blank, field))}
    end)
  end

  defp wire(%Decimal{} = value), do: Decimal.to_string(value, :normal)
  defp wire(value), do: value

  defp summary(map) do
    %{
      "id" => map.id,
      "name" => map.name,
      "description" => map.description,
      "level_id" => map.level_id,
      "tileset_id" => map.tileset_id,
      "zone_id" => map.zone_id,
      "lock_version" => map.lock_version
    }
  end

  defp not_found(conn) do
    conn |> put_status(:not_found) |> json(%{errors: %{detail: "Not Found"}})
  end

  # Naming the cell and the setting, because "violates check constraint" tells a caller nothing about
  # which of 2,568 tiles was wrong.
  defp refused(conn, offences) do
    conn |> put_status(:unprocessable_entity) |> json(%{errors: %{payload: offences}})
  end

  defp unprocessable_reason(conn, reason) do
    conn |> put_status(:unprocessable_entity) |> json(%{errors: %{detail: inspect(reason)}})
  end

  defp unprocessable(conn, changeset) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(NebulithWeb.ChangesetJSON.error(%{changeset: changeset}))
  end
end
