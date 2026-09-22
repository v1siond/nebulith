defmodule Nebulith.E2ECase do
  @moduledoc """
  A scenario: a real browser, driving the real UI, against the real app.

      defmodule Nebulith.E2E.PlacingATileTest do
        use Nebulith.E2ECase, async: false
        @moduletag :e2e

        setup :a_signed_in_editor

        test "a tile placed on an occupied cell stacks on top of it", %{session: session} do
          session
          |> Canvas.click_cell(12, 7)
          |> Canvas.click_cell(12, 7)

          assert length(Canvas.tiles_labelled(session, "crate")) == 2
        end
      end

  ## What this layer is for, and what it is not

  It drives the page a person drives, performs the actions a person performs, and then asserts on what
  the app actually holds and actually drew. It replaces a unit suite that supplied its own inputs, and
  which therefore tested the app as imagined rather than the one that runs: a large green suite sat
  beside a defect that was live on screen, because its stages were built without the options the real
  UI sends, so every assertion silently skipped.

  Pure functions still deserve plain `mix test` cases. This layer is for anything a person can see or
  do.

  ## It cannot touch real data

  `config/test.exs` starts the endpoint on 4002 against `nebulith_test`, and the Ecto sandbox holds a
  transaction for the length of each scenario. The browser joins that transaction because the sandbox
  metadata rides in on its user agent, so a scenario that clicks Save writes into a transaction that
  is rolled back. It could not always: when this ran against the dev server, a run that clicked Save
  overwrote a real saved map.

  ## Running it

      bin/e2e                                    every scenario
      bin/e2e test/e2e/phase_03_maps_test.exs    just that file

  `bin/e2e` starts the browser and works out the addresses. `mix test` on its own SKIPS this layer,
  because a machine with no browser has to be able to run the unit suite. That skip is also how a
  whole layer can rot unnoticed, so CI runs `bin/e2e` too.
  """

  defmacro __using__(opts) do
    quote do
      use PhoenixTest.Playwright.Case, unquote(opts)

      import PhoenixTest

      import Nebulith.E2E.Browser,
        only: [js: 2, true?: 2, wait_until: 3, wait_until: 4, wait_for_js: 3, wait_for_js: 4]

      import Nebulith.E2ECase

      alias Nebulith.E2E.{Account, Browser, Canvas, Editor, StubApi, World}

      # A scenario drives a real browser through a whole world. It is slower than a unit test by orders
      # of magnitude, and a timeout that assumes otherwise reports a slow machine as a defect.
      @moduletag timeout: 300_000
    end
  end

  @doc """
  An admin, signed in, with the catalog seeded and an empty map open in the editor.

  The setup almost every scenario wants, in one place, because every one of these steps is a way for a
  scenario to fail at something other than what it is testing.
  """
  def a_signed_in_editor(%{conn: conn} = context) do
    Nebulith.E2E.World.seed_catalog()
    map = Nebulith.E2E.World.scratch_map(Map.get(context, :map, %{}))
    user = Nebulith.E2E.Account.an_admin()

    session =
      conn
      |> Nebulith.E2E.Account.sign_in(user)
      |> Nebulith.E2E.Editor.open(map.id)

    %{session: session, user: user, map: map}
  end

  @doc "An admin, signed in, and nothing else. For scenarios that are not about the editor."
  def a_signed_in_admin(%{conn: conn}) do
    user = Nebulith.E2E.Account.an_admin()
    %{session: Nebulith.E2E.Account.sign_in(conn, user), user: user}
  end
end
