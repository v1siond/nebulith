defmodule NebulithWeb.CombatController do
  @moduledoc """
  `GET /api/combat` — the creature roster and the rules the fight runs on, in one answer.

  One endpoint rather than two because the frontend needs both at the same moment (a combat tick reads
  an archetype AND the coefficients), and because a second round trip buys nothing when the payload is
  this small.
  """
  use NebulithWeb, :controller

  alias Nebulith.Catalog.CombatSource

  def index(conn, _params) do
    render(conn, :index, archetypes: CombatSource.list_archetypes(), rules: CombatSource.rule_map())
  end
end
