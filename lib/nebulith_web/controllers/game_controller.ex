defmodule NebulithWeb.GameController do
  @moduledoc """
  CRUD for games (a game = a named, ordered flow of templates). Accepts + returns camelCase JSON the
  frontend expects.

  EVERY ACTION PASSES THE SIGNED-IN PERSON to the context, which is where the ownership rule lives
  (`docs/AUTH.md` §5b). This controller decides nothing about who may do what: it hands over who is
  asking, and a game that is not theirs comes back as if it were not there.
  """
  use NebulithWeb, :controller

  alias Nebulith.Games
  alias Nebulith.Games.Game

  action_fallback NebulithWeb.FallbackController

  def index(conn, _params),
    do: render(conn, :index, games: Games.list_games(actor(conn)))

  def show(conn, %{"id" => id}),
    do: render(conn, :show, game: Games.get_game!(actor(conn), id))

  def create(conn, params) do
    with {:ok, %Game{} = game} <- Games.create_game(actor(conn), params) do
      conn
      |> put_status(:created)
      |> render(:show, game: game)
    end
  end

  @doc """
  THE NUMBERS A GAME IS PLAYED BY, changed by the person who owns it.

  The map ceiling is the one that matters today: `docs/SPEC.md` §3.1 calls it *"a NUMBER, not a
  constant"*, so raising it is how a bigger map becomes possible. The engine holds no maximum of its own
  (law 12) and never will.
  """
  def update_settings(conn, %{"game_id" => id} = params) do
    with {:ok, settings} <- Games.update_settings(actor(conn), id, params) do
      json(conn, %{data: Elixir.Map.take(settings, Nebulith.Games.GameSettings.served_fields())})
    end
  end

  def update(conn, %{"id" => id} = params) do
    with {:ok, %Game{} = game} <- Games.update_game(actor(conn), id, params) do
      render(conn, :show, game: game)
    end
  end

  def delete(conn, %{"id" => id}) do
    with {:ok, %Game{}} <- Games.delete_game(actor(conn), id) do
      json(conn, %{success: true, id: id})
    end
  end

  # WHO IS ASKING. `/api` is closed (`docs/AUTH.md` §5), so `require_api_user` has already refused a
  # caller with no credential by the time any of this runs.
  defp actor(conn), do: conn.assigns.current_user
end
