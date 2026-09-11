defmodule NebulithWeb.LevelController do
  @moduledoc """
  CRUD for a game's LEVELS.

  Nested under the game on purpose: a level belongs to exactly one game and there is no reason to ask for one
  without knowing whose it is. That is also the fix for what Alexander hit — *"clcking in manage levels
  doesn't make sense, it shows games??? instead of the levels of my game"* — because a route that takes a game
  id cannot answer with a list of games.
  """
  use NebulithWeb, :controller

  alias Nebulith.Levels
  alias Nebulith.Games.Level

  action_fallback NebulithWeb.FallbackController

  def index(conn, %{"game_id" => game_id}),
    do: render(conn, :index, levels: Levels.list_levels(game_id))

  def show(conn, %{"id" => id}) do
    with {:ok, %Level{} = level} <- Levels.get_level(id) do
      render(conn, :show, level: level)
    end
  end

  def create(conn, %{"game_id" => game_id} = params) do
    with {:ok, %Level{} = level} <- Levels.create_level(game_id, Map.drop(params, ["game_id"])) do
      conn
      |> put_status(:created)
      |> render(:show, level: level)
    end
  end

  def update(conn, %{"id" => id} = params) do
    with {:ok, %Level{} = found} <- Levels.get_level(id),
         {:ok, %Level{} = level} <- Levels.update_level(found, Map.drop(params, ["id", "game_id"])) do
      render(conn, :show, level: level)
    end
  end

  def delete(conn, %{"id" => id}) do
    with {:ok, %Level{} = level} <- Levels.get_level(id),
         {:ok, %Level{}} <- Levels.delete_level(level) do
      json(conn, %{success: true, id: id})
    end
  end

  @doc "Reorder a game's levels — the whole ordered list of ids, first to last."
  def reorder(conn, %{"game_id" => game_id, "levelIds" => ids}) when is_list(ids),
    do: render(conn, :index, levels: Levels.reorder(game_id, ids))
end
