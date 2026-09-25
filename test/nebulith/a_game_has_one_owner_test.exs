defmodule Nebulith.AGameHasOneOwnerTest do
  @moduledoc """
  A GAME BELONGS TO SOMEBODY, and a stranger cannot change it.

  `docs/SPEC.md` phase 1 GATE, in full: *"two accounts exist, one owns a game, the other can open it and
  cannot edit it."* `docs/AUTH.md` §5b is the rule this asserts.

  ## What was measured before this existed

  `games.owner_id` and `games.visibility` were both real columns. Neither was declared on the `Game`
  schema, and the string `owner_id` appeared nowhere in `lib/nebulith_web` or `lib/nebulith/games`.
  `Games.list_games/0` returned every game to every caller, and `update_game/2` and `delete_game/1` took
  any id from any signed-in person.

  Authentication was enforced and authorisation was not, which is the shape that looks safest from
  outside: every request carries a valid session, and every request may do anything.

  ## Why the context and not the controller

  `docs/AUTH.md` §5b: the check lives where the data is fetched, so a caller cannot forget it by
  forgetting to write it. The browser half of this gate is
  `test/e2e/two_people_one_game_test.exs`.
  """
  use Nebulith.DataCase, async: true

  alias Nebulith.Games

  import Nebulith.AccountsFixtures

  setup do
    owner = user_fixture()
    stranger = user_fixture()

    {:ok, game} = Games.create_game(owner, %{"name" => "The owner's game"})

    %{owner: owner, stranger: stranger, game: game}
  end

  test "a new game belongs to the person who made it", %{owner: owner, game: game} do
    assert game.owner_id == owner.id,
           "a game was created with no owner, so it belongs to everyone"
  end

  test "the owner sees their own game", %{owner: owner, game: game} do
    assert game.id in Enum.map(Games.list_games(owner), & &1.id)
  end

  test "a stranger does not see a private game in the list", %{stranger: stranger, game: game} do
    refute game.id in Enum.map(Games.list_games(stranger), & &1.id),
           "someone else's private game is listed to a stranger"
  end

  test "a stranger cannot fetch a private game", %{stranger: stranger, game: game} do
    assert Games.get_game(stranger, game.id) == nil,
           "a private game came back to a stranger. Per AUTH.md §5b this answers as if it did not exist"
  end

  test "a stranger cannot rename it", %{stranger: stranger, game: game} do
    assert {:error, :not_found} = Games.update_game(stranger, game.id, %{"name" => "mine now"})

    assert Nebulith.Repo.get!(Nebulith.Games.Game, game.id).name == "The owner's game",
           "a stranger's rename went through"
  end

  test "a stranger cannot delete it", %{stranger: stranger, game: game} do
    assert {:error, :not_found} = Games.delete_game(stranger, game.id)

    assert Nebulith.Repo.get(Nebulith.Games.Game, game.id),
           "a stranger deleted someone else's game"
  end

  test "the owner can still rename and delete their own", %{owner: owner, game: game} do
    assert {:ok, renamed} = Games.update_game(owner, game.id, %{"name" => "Renamed"})
    assert renamed.name == "Renamed"
    assert {:ok, _} = Games.delete_game(owner, game.id)
  end
end
