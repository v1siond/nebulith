defmodule Nebulith.E2E.AGameStatesItsOwnLimitsTest do
  @moduledoc """
  THE MAP CEILING IS A NUMBER, AND IT REACHES THE PAGE.

  `docs/SPEC.md` §3.1 annotates `game_settings.map_size_max` as *"100 for now. a NUMBER, not a constant"*,
  and law 12 says the engine holds no maximum of its own. The context test proves the number is stored and
  obeyed. This proves the two halves a person meets: the number travels to the browser with the game, and
  changing it through the API changes what the map API will accept.

  `Nebulith.E2E.TheFrontendSetsNoLimitsTest` is the other side of the same rule and stays exactly as it
  is: a map belonging to no game has no ceiling, so 120 x 104 is typed into the real panel and saved.
  """
  use Nebulith.E2ECase, async: false

  @moduletag :e2e
  @moduletag :phase1

  alias Nebulith.E2E.Account
  alias Nebulith.E2E.Browser
  alias Nebulith.E2E.World, as: E2EWorld
  alias Nebulith.Games

  setup do
    E2EWorld.seed_catalog()
    user = Account.an_admin()
    {:ok, game} = Games.create_game(user, %{"name" => "A game with rules"})
    %{user: user, game: game}
  end

  test "the game's numbers travel to the page with the game", %{
    conn: conn,
    user: user,
    game: game
  } do
    session = conn |> Account.sign_in(user) |> visit("/games")

    served = Browser.js(session, "fetch('/api/games/#{game.id}').then(r => r.json())")

    assert served["settings"]["map_size_max"] == 100,
           "the game's map ceiling did not reach the browser: #{inspect(served["settings"])}"

    assert served["settings"]["default_view"] == "iso",
           "a game's settings arrived incomplete: #{inspect(served["settings"])}"
  end

  test "raising the number through the door changes what the map API accepts", %{
    conn: conn,
    user: user,
    game: game
  } do
    session = conn |> Account.sign_in(user) |> visit("/games")

    raised =
      Browser.js(session, """
      (async () => {
        const res = await fetch('/api/games/#{game.id}/settings', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ map_size_max: 400 }),
        })
        return (await res.json()).data
      })()
      """)

    assert raised["map_size_max"] == 400,
           "the ceiling did not move: #{inspect(raised)}"

    assert Games.settings(game).map_size_max == 400,
           "the page said 400 and the row did not"
  end

  test "a stranger cannot change another person's numbers", %{conn: conn, game: game} do
    {:ok, stranger} =
      Nebulith.Accounts.create_user(%{
        email: "stranger-#{System.unique_integer([:positive])}@nebulith.test",
        password: Account.password()
      })

    session = Account.sign_in(conn, stranger)

    Browser.js(session, """
    fetch('/api/games/#{game.id}/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ map_size_max: 4000 }),
    }).then(r => r.status)
    """)

    assert Games.settings(game).map_size_max == 100,
           "a stranger raised somebody else's map ceiling"
  end
end
