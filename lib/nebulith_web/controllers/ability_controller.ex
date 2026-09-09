defmodule NebulithWeb.AbilityController do
  use NebulithWeb, :controller
  alias Nebulith.Catalog

  @doc "The whole ability registry (§3.14b #2). Read-only."
  def index(conn, _params), do: render(conn, :index, abilities: Catalog.list_abilities())
end
