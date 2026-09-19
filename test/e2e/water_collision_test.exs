defmodule Nebulith.E2E.WaterCollisionTest do
  @moduledoc """
  A RELOADED MAP STOPS YOU WHERE THE BUILT ONE DID.

  *"when I generate a new world, collissions look ok, when I reload the world all collissions are gone"*, and
  *"I shouldn't be able to walk into ANY real water zone"*.

  This is the end-to-end layer `docs/TESTING.md` describes, in Elixir, driving a real browser: build a world
  through the UI, read what the grid says is solid, save it, load it back, read again. The two have to agree.

  IT RUNS AGAINST THE TEST DATABASE. `config/test.exs` starts the endpoint on 4002 against `nebulith_test`,
  and `PhoenixTest.Playwright.Case` holds an Ecto sandbox transaction for the duration, so nothing this test
  clicks can reach a real saved map. The earlier Node version of this drove the DEV server on 6328, which is
  how a run that clicked Save overwrote the only template in the dev database.

  The map is a canvas, so the assertion is not on the DOM: *"my expectation is that we just use the UI and
  validate that the data is correct, as simple as that"*. `window.__collisionAudit` reports each cell's
  ground and whether the grid blocks it, which is the thing the hero actually walks into.
  """
  use PhoenixTest.Playwright.Case, async: false

  @moduletag :e2e
  # Generating a world, saving it and loading it back is slower than a unit test by an order of magnitude.
  @moduletag timeout: 180_000

  @cols 40
  @rows 40

  # THE CATALOG, SEEDED INTO THE TEST DATABASE. The editor holds its canvas behind a tileset gate, so with no
  # tiles there is no map and nothing to assert. This is the half that was missing when the end-to-end layer
  # lived in Node: it had no test database to seed, so it drove the DEV server instead, and a run that clicked
  # Save overwrote the only saved map that was there.
  setup do
    Nebulith.Catalog.TileSource.seed()
    Nebulith.Catalog.GeneratorSource.seed()
    :ok
  end

  describe "collision survives a save" do
    test "a reloaded map stops you where the built one did", %{conn: conn} do
      session =
        conn
        |> visit("/templates")
        |> wait_for_editor()
        |> build_world()

      built = audit(session)

      assert built.blocked > 0,
             "the world did not build (nothing is solid at all), so this run proves nothing"

      assert built.water > 0,
             "the built map has no water, so it proves nothing about walking into water"

      assert built.water_blocked > 0,
             "no water cell is solid on the map as built, you can walk straight into the river"

      session = save_and_reload(session)
      back = audit(session)

      assert back.total > 0, "the map did not load back"

      assert back.water_blocked == built.water_blocked,
             "built with #{built.water_blocked} solid water cells, reloaded with #{back.water_blocked}"

      assert back.solid == built.solid,
             "the set of solid cells changed across the save: " <>
               "#{MapSet.size(MapSet.difference(built.solid, back.solid))} lost, " <>
               "#{MapSet.size(MapSet.difference(back.solid, built.solid))} gained"
    end
  end

  # ── driving the page ────────────────────────────────────────────────────────────────────────────────

  defp wait_for_editor(session) do
    # The tileset gate holds the canvas until the backend style is installed, and nothing is solid before it.
    assert_has(session, "canvas.nebcanvas", timeout: 30_000)

    # …AND THE GENERATOR CATALOG, which is fetched. Its arrival re-renders the panel, so interacting before it
    # lands detaches the very input being typed into: *"element was detached from the DOM, retrying"*. The seam
    # exists for this, and its own note says a generate with no catalog plants nothing by design.
    wait_until(session, &truthy?(&1, "window.__generatorsReady && window.__generatorsReady()"), "the generator catalog")
  end

  # THE VALUE, not the session. `PhoenixTest.Playwright.evaluate/2` returns the CONN so it can be piped, so
  # reading its result as the answer silently yields a struct: every check here was quietly false and every
  # audit quietly zero. `Frame.evaluate/2` is the one that hands back what the JavaScript returned.
  defp js(session, expression) do
    case PlaywrightEx.Frame.evaluate(session.frame_id, expression: expression, timeout: 10_000) do
      {:ok, value} -> value
      _ -> nil
    end
  end

  defp truthy?(session, expression), do: js(session, expression) == true

  defp build_world(session) do
    # The editor already opens at 40x40, which is the size this test wants, so it is left alone: typing into
    # those fields re-renders the panel and detaches the input mid-fill.
    session
    |> select("City", from: "Kind of place")
    |> click_button("Woodland city")
    |> click_button("Build this world")
    |> wait_until(fn s -> audit(s).total > 0 end, "the world to finish building")
  end

  defp save_and_reload(session) do
    session
    |> click_button("Save")
    |> wait_until(fn s -> saved_template_id(s) != nil end, "the save to land in the database")

    id = saved_template_id(session)

    session
    |> visit("/templates?id=#{id}")
    |> wait_for_editor()
    |> wait_until(fn s -> audit(s).total > 0 end, "the saved map to load back")
  end

  # The row the page wrote, read straight out of the test database.
  defp saved_template_id(_session) do
    case Nebulith.Repo.query!(~s{select id from "Template" order by "updatedAt" desc limit 1}) do
      %Postgrex.Result{rows: [[id]]} -> id
      _ -> nil
    end
  end

  # ── reading what is solid ───────────────────────────────────────────────────────────────────────────

  defp audit(session) do
    raw =
      read_audit(
        session,
        """
        (() => {
          const cells = window.__collisionAudit ? window.__collisionAudit() : []
          const water = cells.filter(c => /water|oasis|koi_pond/.test(c.ground || ''))
          return {
            total: cells.length,
            blocked: cells.filter(c => c.blocked).length,
            water: water.length,
            waterBlocked: water.filter(c => c.blocked).length,
            solid: cells.filter(c => c.blocked).map(c => c.col + ',' + c.row),
          }
        })()
        """
      )

    %{
      total: raw["total"],
      blocked: raw["blocked"],
      water: raw["water"],
      water_blocked: raw["waterBlocked"],
      solid: MapSet.new(raw["solid"] || [])
    }
  end

  defp read_audit(session, expression) do
    case js(session, expression) do
      %{} = map -> map
      _ -> %{"total" => 0, "blocked" => 0, "water" => 0, "waterBlocked" => 0, "solid" => []}
    end
  end

  # A generated world is not ready on a fixed timer, so this waits on the CONDITION rather than a sleep.
  defp wait_until(session, check, what, waited \\ 0)

  defp wait_until(_session, _check, what, waited) when waited >= 60_000 do
    flunk("waited #{waited}ms for #{what} and it never happened")
  end

  defp wait_until(session, check, what, waited) do
    if check.(session) do
      session
    else
      Process.sleep(500)
      wait_until(session, check, what, waited + 500)
    end
  end
end
