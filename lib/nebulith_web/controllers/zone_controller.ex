defmodule NebulithWeb.ZoneController do
  @moduledoc "`GET /api/zones` — every season and what it looks like."
  use NebulithWeb, :controller

  alias Nebulith.Catalog.ZoneSource

  def index(conn, _params), do: render(conn, :index, zones: ZoneSource.list_zones())
end
