defmodule NebulithWeb.UiController do
  @moduledoc """
  `GET /api/ui` — the action catalog and the UI profile in force.

  `?game=<id>` asks for that game's profile; a game with none gets the seeded default, which is the whole
  point of having one (Alexander: *"we'd always offer an easy default set"*).
  """
  use NebulithWeb, :controller

  alias Nebulith.Catalog.UiSource

  def index(conn, params) do
    profile = params |> Map.get("game") |> UiSource.profile_for() |> UiSource.load()
    render(conn, :index, actions: UiSource.list_actions(), profile: profile)
  end
end
