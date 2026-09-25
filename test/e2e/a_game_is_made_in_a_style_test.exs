defmodule Nebulith.E2E.AGameIsMadeInAStyleTest do
  @moduledoc """
  MAKING A GAME, the way a person makes one: press the button, pick what it is drawn in, and be in it.

  `docs/SPEC.md` phase 1 REWIRE: *"Creating a game asks for its name and its art style."* Only half of
  that is asked, on his instruction, and the halves are different questions. The NAME is not asked:
  *"that's the worst UX ever … just assign a random name … and redirect user to the editor right away"*
  (recorded in `components/useConfirm.tsx`). The STYLE is, because it is what the whole game is drawn in.

  `Nebulith.AGameIsMadeInAStyleTest` proves the context keeps the choice. This proves a person can make
  it: that the screen offers the styles the backend serves, that pressing one creates the game in it, and
  that the row says so afterwards. A context that stores a field nothing can set is the exact shape of
  what was measured here before, so the click is the point.

  ## What was measured before

  The games screen called `createGame({ name })` and nothing else. `games.default_tileset_id` was a column
  a person could not reach from anywhere in the application.
  """
  use Nebulith.E2ECase, async: false

  @moduletag :e2e
  @moduletag :phase1

  alias Nebulith.Catalog
  alias Nebulith.E2E.Account
  alias Nebulith.E2E.Browser
  alias Nebulith.E2E.World
  alias Nebulith.Repo

  setup do
    World.seed_catalog()
    %{user: Account.an_admin()}
  end

  test "the styles offered are the ones the backend serves", %{conn: conn, user: user} do
    session = conn |> Account.sign_in(user) |> visit("/games")

    served = Catalog.list_tilesets()

    assert length(served) > 1,
           "only #{length(served)} art style is seeded, so a choice between them proves nothing"

    click_button(session, "Create Game")

    for style <- served do
      assert Browser.count(session, "[data-art-style='#{style.key}']") == 1,
             "the backend serves the #{style.key} style and the picker does not offer it"
    end
  end

  test "picking one creates the game in it, and the row says so", %{conn: conn, user: user} do
    session = conn |> Account.sign_in(user) |> visit("/games")

    emoji = Enum.find(Catalog.list_tilesets(), &(&1.key == "emoji"))
    assert emoji, "no emoji tileset is seeded, so this scenario proves nothing"

    session
    |> click_button("Create Game")
    |> click_button("Emoji")

    # …AND IT TAKES YOU STRAIGHT IN, which is the half of his instruction about not being asked twice.
    Browser.wait_until(
      session,
      &String.starts_with?(Browser.js(&1, "window.location.pathname") || "", "/games/"),
      "the editor to open on the new game",
      timeout: 30_000
    )

    game = Repo.one(Nebulith.Games.Game)

    assert game, "pressing the button created no game"

    assert game.default_tileset_id == emoji.id,
           "the game was created in emoji and its row says tileset #{inspect(game.default_tileset_id)}"
  end
end
