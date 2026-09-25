defmodule Nebulith.AGameStatesItsOwnLimitsTest do
  @moduledoc """
  A GAME'S SETTINGS EXIST, ARE READ, AND CAN BE CHANGED.

  `docs/SPEC.md` §3.1 declares `game_settings` and annotates the first column: `map_size_max`, *"100 for
  now. a NUMBER, not a constant"*. Law 12 is the other half: *"The frontend sets no limits. No minimum, no
  maximum, no step invented in React (D18)."*

  The two together say where a maximum may live. Not in the engine, which is why `MAP_SIZE_MAX` was
  deleted and `assets/game/lib/mapSize.ts` records all three times a cap crept back. In a column a person
  can raise.

  ## What was measured before

  Phase 1 created the table and nothing else happened to it: no Ecto schema, no context function, no
  serializer, and no row was ever written when a game was made. Five declared columns, zero readers. So
  the engine had no ceiling at all, which is not the same as reading the one the database states, and
  `Nebulith.EveryColumnHasAReaderTest` counted all five.
  """
  use Nebulith.DataCase, async: true

  alias Nebulith.Games
  alias Nebulith.World

  import Nebulith.AccountsFixtures

  setup do
    user = user_fixture()
    {:ok, game} = Games.create_game(user, %{"name" => "A game with rules"})
    %{user: user, game: game}
  end

  test "a game is born with its settings, carrying the numbers the table states", %{game: game} do
    settings = Games.settings(game)

    assert settings.map_size_max == 100,
           "the declared default is 100, and it is what a new game gets"

    assert settings.discovery_on == false
    assert settings.discovery_radius == 6
    assert settings.discovery_remembers == true
    assert settings.default_view == "iso"
  end

  test "the owner can raise the ceiling, which is what makes it a number and not a constant", %{
    user: user,
    game: game
  } do
    {:ok, raised} = Games.update_settings(user, game.id, %{"map_size_max" => 400})

    assert raised.map_size_max == 400

    assert Games.settings(game).map_size_max == 400,
           "the new number did not survive being read back"
  end

  test "somebody else's game refuses, and says the same as a game that is not there", %{
    game: game
  } do
    stranger = user_fixture()

    assert Games.update_settings(stranger, game.id, %{"map_size_max" => 400}) ==
             {:error, :not_found}

    assert Games.settings(game).map_size_max == 100, "a stranger changed a game's limits"
  end

  test "a view the engine does not draw is refused", %{user: user, game: game} do
    assert {:error, changeset} =
             Games.update_settings(user, game.id, %{"default_view" => "holodeck"})

    assert errors_on(changeset)[:default_view], "any string was accepted as a view"
  end

  test "a map in a game may not be saved past the game's number, and may be after it is raised",
       %{
         user: user,
         game: game
       } do
    map = a_map_in(game)

    assert {:error, %{payload: offences}} = World.save_map(map.id, grid_of(120, 104))

    assert Enum.any?(offences, &String.contains?(&1, "120")),
           "a map past the game's stated maximum saved anyway: #{inspect(offences)}"

    # …AND RAISING THE NUMBER IS THE WHOLE POINT. Nothing about the engine changed, only the game's data.
    {:ok, _} = Games.update_settings(user, game.id, %{"map_size_max" => 400})

    assert {:ok, _} = World.save_map(map.id, grid_of(120, 104)),
           "the ceiling was raised and the same map was still refused"
  end

  test "a map that belongs to no game has no ceiling, because nothing states one" do
    {:ok, map} = World.create_map(%{"name" => "Loose map"})

    assert {:ok, _} = World.save_map(map.id, grid_of(400, 240)),
           "a map with no game behind it was held to a limit nobody set"
  end

  defp a_map_in(game) do
    {:ok, level} = Nebulith.Levels.create_level(game.id, %{"name" => "1-1"})
    {:ok, map} = World.create_map(%{"name" => "In a game", "level_id" => level.id})
    map
  end

  defp grid_of(cols, rows) do
    %{"grid" => %{"cols" => cols, "rows" => rows, "cell_size" => 16}, "cells" => []}
  end
end
