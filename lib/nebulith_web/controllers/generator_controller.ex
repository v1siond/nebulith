defmodule NebulithWeb.GeneratorController do
  @moduledoc """
  The map-generator catalog, every category with its generators. Read-only: the editor fetches it
  once and drives its map-type menu and every generate from it, so no grid range, density or unit
  count is hardcoded in the frontend (T-113/T-120).
  """
  use NebulithWeb, :controller

  alias Nebulith.Catalog

  action_fallback NebulithWeb.FallbackController

  def index(conn, _params), do: render(conn, :index, categories: Catalog.list_generator_categories())
end
