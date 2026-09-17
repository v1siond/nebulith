defmodule NebulithWeb.CombatController do
  @moduledoc """
  `GET /api/combat`, the rules the fight runs on.

  Creatures are NOT here: an enemy is a unit tile marked hostile, so its stat block rides on its tile and
  arrives with `/api/tilesets` like every other fact about a tile.
  """
  use NebulithWeb, :controller

  alias Nebulith.Catalog.CombatSource

  def index(conn, _params) do
    render(conn, :index, rules: CombatSource.rule_map())
  end
end
