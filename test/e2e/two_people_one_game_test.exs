defmodule Nebulith.E2E.TwoPeopleOneGameTest do
  @moduledoc """
  TWO ACCOUNTS. ONE OWNS A GAME. THE OTHER CANNOT CHANGE IT.

  This is `docs/SPEC.md` phase 1's GATE, word for word: *"two accounts exist, one owns a game, the other
  can open it and cannot edit it."* `docs/AUTH.md` §5b is the rule.

  ## Why a browser and not only the context test

  `Nebulith.AGameHasOneOwnerTest` proves the CONTEXT refuses. This proves the refusal survives the whole
  way out: session, router pipeline, controller, serializer. A context that refuses correctly behind a
  controller that never calls it is the exact shape of the defect this was written for, and only a real
  request through the real stack can tell the two apart.

  The requests go through the page's own `fetch`, so they carry the session cookie the browser holds,
  which is how the engine talks to `/api` (`docs/AUTH.md` §5). Nothing here mints a token or builds a
  connection by hand: a scenario that assembles its own credential is testing an app nobody uses.

  ## What was measured before the fix

  `GameController.index/2` called `Games.list_games/0`, which returned every game to every signed-in
  person. `update` and `delete` fetched by id with no owner check at all. Two accounts existed and the
  second could rename and delete the first one's games.
  """
  use Nebulith.E2ECase, async: false

  @moduletag :e2e
  @moduletag :phase1
  @moduletag timeout: 600_000

  alias Nebulith.E2E.Account
  alias Nebulith.E2E.Browser
  alias Nebulith.Games
  alias Nebulith.Repo

  setup %{conn: conn} do
    owner =
      Account.an_admin(%{email: "owner-#{System.unique_integer([:positive])}@nebulith.test"})

    # NOT AN ADMIN. An admin may change everything (`docs/AUTH.md` §5b), so a scenario that made the
    # stranger an admin would pass while proving the opposite of what it claims.
    {:ok, stranger} =
      Nebulith.Accounts.create_user(%{
        email: "stranger-#{System.unique_integer([:positive])}@nebulith.test",
        password: Account.password()
      })

    {:ok, game} = Games.create_game(owner, %{"name" => "The owner's game"})

    # THE STRANGER GETS ONE TOO, so "the owner's game is not in the stranger's list" cannot pass because
    # the list was EMPTY or because the response shape was misread. The first version of this read
    # `data` from a view that answers `games`, so every list came back nil and the refutation was true
    # for the wrong reason. A refutation needs something present to be meaningful.
    {:ok, theirs} = Games.create_game(stranger, %{"name" => "The stranger's own game"})

    %{conn: conn, owner: owner, stranger: stranger, game: game, theirs: theirs}
  end

  test "a stranger can sign in, and cannot touch someone else's game", %{
    conn: conn,
    stranger: stranger,
    game: game,
    theirs: theirs
  } do
    session = Account.sign_in(conn, stranger)

    # THE LIST IS THEIRS, not everyone's.
    ids = game_ids(session)

    assert theirs.id in ids,
           "the stranger cannot see their OWN game, so this list proves nothing: #{inspect(ids)}"

    refute game.id in ids,
           "a stranger's game list contains someone else's private game: #{inspect(ids)}"

    # READING IT ANSWERS AS IF IT WERE NOT THERE. Per AUTH.md §5b, saying "exists, but not yours" is
    # itself a disclosure.
    assert api_status(session, "GET", "/api/games/#{game.id}") in [404, 403],
           "a stranger fetched a private game through the API"

    # AND A WRITE CHANGES NOTHING.
    api(session, "PUT", "/api/games/#{game.id}", %{"name" => "mine now"})
    api(session, "DELETE", "/api/games/#{game.id}")

    still = Repo.get(Nebulith.Games.Game, game.id)

    assert still, "a stranger deleted someone else's game"
    assert still.name == "The owner's game", "a stranger renamed someone else's game"
  end

  test "the owner can still see and rename their own", %{conn: conn, owner: owner, game: game} do
    session = Account.sign_in(conn, owner)

    assert game.id in game_ids(session), "the owner's own game is missing from their list"

    api(session, "PUT", "/api/games/#{game.id}", %{"name" => "Renamed by its owner"})

    assert Repo.get!(Nebulith.Games.Game, game.id).name == "Renamed by its owner",
           "the owner could not rename their own game"
  end

  # THE IDS THE LIST ACTUALLY ANSWERS. `GameJSON.index/1` answers `%{games: [...]}`, not `data`, and
  # reading the wrong key gives an empty list that makes every `refute` pass.
  defp game_ids(session) do
    for g <- api(session, "GET", "/api/games")["games"] || [], do: g["id"]
  end

  # THROUGH THE PAGE'S OWN `fetch`, so the session cookie rides along exactly as it does for the engine.
  defp api(session, method, path, body \\ nil) do
    Browser.js(session, """
    (async () => {
      const res = await fetch(#{Jason.encode!(path)}, {
        method: #{Jason.encode!(method)},
        headers: { 'content-type': 'application/json' },
        #{if body, do: "body: JSON.stringify(#{Jason.encode!(body)}),", else: ""}
      })
      try { return await res.json() } catch (_) { return {} }
    })()
    """) || %{}
  end

  defp api_status(session, method, path) do
    Browser.js(session, """
    (async () => {
      const res = await fetch(#{Jason.encode!(path)}, { method: #{Jason.encode!(method)} })
      return res.status
    })()
    """)
  end
end
