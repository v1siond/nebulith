defmodule NebulithWeb.LevelControllerTest do
  @moduledoc """
  The levels API, nested under its game.

  The route is the fix as much as the screen is: `/api/games/:game_id/levels` cannot
  answer with a list of games.
  """
  use NebulithWeb.ConnCase
  # /api is closed, so these all have to be somebody first. See docs/AUTH.md §5.
  setup :log_in_api_user

  alias Nebulith.{Games, Levels}

  setup %{conn: conn} do
    {:ok, game} = Games.create_game(%{"name" => "Mario"})
    {:ok, conn: put_req_header(conn, "accept", "application/json"), game: game}
  end

  test "a game with no levels yet answers an empty list, not an error", %{conn: conn, game: game} do
    assert json_response(get(conn, ~p"/api/games/#{game.id}/levels"), 200) == %{"data" => []}
  end

  test "serves THIS GAME's levels, in play order, and nobody else's", %{conn: conn, game: game} do
    {:ok, other} = Games.create_game(%{"name" => "Sonic"})
    {:ok, _} = Levels.create_level(other.id, %{"name" => "Green Hill"})

    for name <- ["1-1", "1-2", "1-3"],
        do: {:ok, _} = Levels.create_level(game.id, %{"name" => name})

    data = json_response(get(conn, ~p"/api/games/#{game.id}/levels"), 200)["data"]

    assert Enum.map(data, & &1["name"]) == ["1-1", "1-2", "1-3"]
    refute "Green Hill" in Enum.map(data, & &1["name"])
  end

  test "creates a level carrying its maps, and answers 201", %{conn: conn, game: game} do
    body = %{"name" => "Jungle", "templateIds" => ["jungle", "cave-a", "cave-b"]}
    level = json_response(post(conn, ~p"/api/games/#{game.id}/levels", body), 201)

    assert level["name"] == "Jungle"
    assert level["gameId"] == game.id
    assert level["templateIds"] == ["jungle", "cave-a", "cave-b"]
  end

  test "updates a level's maps in place", %{conn: conn, game: game} do
    {:ok, level} =
      Levels.create_level(game.id, %{"name" => "Jungle", "templateIds" => ["a", "b"]})

    updated =
      json_response(put(conn, ~p"/api/levels/#{level.id}", %{"templateIds" => ["b"]}), 200)

    assert updated["templateIds"] == ["b"]
  end

  test "reorders a game's levels from the ordered list of ids", %{conn: conn, game: game} do
    for name <- ["1-1", "1-2", "1-3"],
        do: {:ok, _} = Levels.create_level(game.id, %{"name" => name})

    ids = Levels.list_levels(game.id) |> Enum.map(& &1.id)

    data =
      conn
      |> put(~p"/api/games/#{game.id}/levels/order", %{
        "levelIds" => [Enum.at(ids, 2), Enum.at(ids, 1), Enum.at(ids, 0)]
      })
      |> json_response(200)
      |> Map.fetch!("data")

    assert Enum.map(data, & &1["name"]) == ["1-3", "1-2", "1-1"]
  end

  test "deletes a level", %{conn: conn, game: game} do
    {:ok, level} = Levels.create_level(game.id, %{"name" => "1-1"})

    assert json_response(delete(conn, ~p"/api/levels/#{level.id}"), 200)["success"] == true
    assert Levels.list_levels(game.id) == []
  end

  test "a level that is not there is a 404, not a 500", %{conn: conn} do
    assert json_response(get(conn, ~p"/api/levels/#{Ecto.UUID.generate()}"), 404)
  end

  test "the response carries no database bookkeeping, just what the editor needs", %{
    conn: conn,
    game: game
  } do
    {:ok, level} = Levels.create_level(game.id, %{"name" => "1-1"})
    body = json_response(get(conn, ~p"/api/levels/#{level.id}"), 200)

    assert Map.keys(body) |> Enum.sort() ==
             ~w(createdAt description gameId id name position templateIds updatedAt)
  end
end
