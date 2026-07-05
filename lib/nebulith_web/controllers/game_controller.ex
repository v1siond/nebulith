defmodule NebulithWeb.GameController do
  @moduledoc "CRUD for games (a game = a named, ordered flow of templates). Accepts + returns camelCase JSON the frontend expects."
  use NebulithWeb, :controller

  alias Nebulith.Games
  alias Nebulith.Games.Game

  action_fallback NebulithWeb.FallbackController

  def index(conn, _params), do: render(conn, :index, games: Games.list_games())

  def show(conn, %{"id" => id}), do: render(conn, :show, game: Games.get_game!(id))

  def create(conn, params) do
    with {:ok, %Game{} = game} <- Games.create_game(params) do
      conn
      |> put_status(:created)
      |> render(:show, game: game)
    end
  end

  def update(conn, %{"id" => id} = params) do
    game = Games.get_game!(id)

    with {:ok, %Game{} = game} <- Games.update_game(game, params) do
      render(conn, :show, game: game)
    end
  end

  def delete(conn, %{"id" => id}) do
    game = Games.get_game!(id)

    with {:ok, %Game{}} <- Games.delete_game(game) do
      json(conn, %{success: true, id: id})
    end
  end
end
