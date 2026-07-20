defmodule NebulithWeb.EntityController do
  use NebulithWeb, :controller

  alias Nebulith.Catalog.EntitySource

  @doc """
  Serves the entity → baked-tile resolution DATA (`GET /api/entities`).

  The frontend fetches this at load time and installs it as the sole source of
  entity resolution — it ships no bundled entity data of its own.
  """
  def index(conn, _params) do
    render(conn, :index, resolution: EntitySource.resolution())
  end
end
