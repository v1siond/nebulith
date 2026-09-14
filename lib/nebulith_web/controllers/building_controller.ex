defmodule NebulithWeb.BuildingController do
  @moduledoc """
  BUILDINGS AT ANY SIZE.

  `index` lists the types the composer can build, each with its DEFAULT footprint
  (— so each default IS
  that type's authored footprint) and the smallest size worth offering.

  `show` composes one at an arbitrary size and serves it in the SAME shape `/api/tilesets` serves a seeded
  composition, so the frontend stamps it through the path it already has and needs no second code path for
  "a generated building" — that distinction exists only here.
  """
  use NebulithWeb, :controller

  alias Nebulith.Catalog.BuildingCompositions, as: Buildings

  action_fallback NebulithWeb.FallbackController

  def index(conn, _params) do
    {min_w, min_d} = Buildings.min_footprint()

    types =
      for type <- Buildings.building_types() do
        {w, h} = Buildings.default_footprint(type)
        %{key: type, default: %{w: w, h: h}}
      end

    json(conn, %{data: %{types: types, min: %{w: min_w, h: min_d}}})
  end

  def show(conn, %{"type" => type} = params) do
    with {:ok, {w, h}} <- footprint(type, params) do
      opts =
        []
        |> put_opt(:material, params["material"])
        |> put_opt(:roof, params["roof"])
        |> put_opt(:roof_top, params["roofTop"])
        |> put_int(:wall_top, params["wallTop"])
        |> put_int(:seed, params["seed"])

      comp = Buildings.compose_building(type, w, h, opts)
      json(conn, %{data: composition_data(type, comp)})
    end
  end

  # The requested footprint, defaulting to the type's own. An unknown type is a 404 rather than a composed
  # guess — the editor must not receive a building for something the catalog cannot describe.
  defp footprint(type, params) do
    case Buildings.default_footprint(type) do
      nil -> {:error, :not_found}
      {dw, dh} -> {:ok, {int(params["width"], dw), int(params["depth"], dh)}}
    end
  end

  defp int(nil, fallback), do: fallback

  defp int(raw, fallback) do
    case Integer.parse(to_string(raw)) do
      {n, _} when n > 0 -> n
      _ -> fallback
    end
  end

  defp put_opt(opts, _key, nil), do: opts
  defp put_opt(opts, _key, ""), do: opts
  defp put_opt(opts, key, value), do: Keyword.put(opts, key, value)

  defp put_int(opts, _key, nil), do: opts

  defp put_int(opts, key, raw) do
    case Integer.parse(to_string(raw)) do
      {n, _} -> Keyword.put(opts, key, n)
      _ -> opts
    end
  end

  # The SAME shape `/api/tilesets` serves for a seeded composition — see `tileset_json.comp_data/1`. Cells
  # are sorted by grid position for the same reason they are there: a reproducible payload.
  defp composition_data(type, comp) do
    %{
      name: type,
      footprint: %{w: comp.footprint_w, h: comp.footprint_h},
      title: Map.get(comp, :title),
      category: "buildings",
      cells:
        comp.cells
        |> Enum.sort_by(&{&1.dx, &1.dy, &1.level, &1.label})
        |> Enum.map(fn cell ->
          %{dx: cell.dx, dy: cell.dy, level: cell.level, label: cell.label, walkable: cell.walkable}
          |> maybe_put(:settings, Map.get(cell, :settings))
        end)
    }
  end

  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, _key, empty) when empty == %{}, do: map
  defp maybe_put(map, key, value), do: Map.put(map, key, value)
end
