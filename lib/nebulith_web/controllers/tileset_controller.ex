defmodule NebulithWeb.TilesetController do
  use NebulithWeb, :controller

  alias Nebulith.Catalog
  alias Nebulith.Catalog.Tileset

  action_fallback NebulithWeb.FallbackController

  def index(conn, _params) do
    tilesets =
      Enum.map(Catalog.list_tilesets(), fn ts ->
        %{tileset: ts, tiles: Catalog.list_tiles_for(ts.key)}
      end)

    render(conn, :index, tilesets: tilesets, compositions: Catalog.list_compositions())
  end

  def create(conn, %{"tileset" => tileset_params}) do
    with {:ok, %Tileset{} = tileset} <- Catalog.create_tileset(tileset_params) do
      conn
      |> put_status(:created)
      |> put_resp_header("location", ~p"/api/tilesets/#{tileset}")
      |> render(:show, tileset: tileset)
    end
  end

  def show(conn, %{"id" => id}) do
    tileset = Catalog.get_tileset!(id)
    render(conn, :show, tileset: tileset)
  end

  def update(conn, %{"id" => id, "tileset" => tileset_params}) do
    tileset = Catalog.get_tileset!(id)

    with {:ok, %Tileset{} = tileset} <- Catalog.update_tileset(tileset, tileset_params) do
      render(conn, :show, tileset: tileset)
    end
  end

  def delete(conn, %{"id" => id}) do
    tileset = Catalog.get_tileset!(id)

    with {:ok, %Tileset{}} <- Catalog.delete_tileset(tileset) do
      send_resp(conn, :no_content, "")
    end
  end
end
