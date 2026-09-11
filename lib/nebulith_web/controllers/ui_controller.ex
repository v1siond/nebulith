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

  @doc """
  `PUT /api/ui?game=<id>` — save the bars and/or the element placements.

  Writing to a game for the first time FORKS the default into a profile of its own, so one game's edit
  never reaches every other game that is still on the default.
  """
  def update(conn, params) do
    profile = params |> Map.get("game") |> UiSource.editable_profile()

    if bars = params["bars"], do: UiSource.put_bars(profile, bars)
    if elements = params["elements"], do: UiSource.put_elements(profile, elements)

    render(conn, :index, actions: UiSource.list_actions(), profile: UiSource.load(profile))
  end
end
