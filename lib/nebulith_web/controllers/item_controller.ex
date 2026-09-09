defmodule NebulithWeb.ItemController do
  use NebulithWeb, :controller

  alias Nebulith.Catalog

  @doc """
  The whole ITEM CATALOG (§3.14b #1). Read-only: the frontend renders what the catalog serves and declares
  no stats of its own.
  """
  def index(conn, _params) do
    render(conn, :index, items: Catalog.list_items())
  end
end
