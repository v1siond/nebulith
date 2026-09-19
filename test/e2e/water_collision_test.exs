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
    Nebulith.Catalog.ZoneSource.seed()

    # …AND A MAP TO OPEN. The editor restores the last saved template and bounces to the gallery when there
    # is none (`loadMostRecentTemplate`: "nothing saved yet -> gallery"), so on an empty database /templates
    # never renders the editor at all. The old Node harness never hit this because it drove the DEV database,
    # which had a saved map in it, which is the same reason it could destroy one.
    %{id: id} = scratch_template()
    %{template_id: id}
  end

  defp scratch_template do
    id = Ecto.UUID.generate()
    now = NaiveDateTime.utc_now() |> NaiveDateTime.truncate(:second)
    ground = List.duplicate(List.duplicate("grass", @cols), @rows)
    height = List.duplicate(List.duplicate(0, @cols), @rows)

    Nebulith.Repo.query!(
      ~s{INSERT INTO "Template" (id, name, cols, rows, "cellSize", "isoScale", "groundData", "heightData", "assetsData", connectors, entities, quests, "createdAt", "updatedAt", "slabBlocks") } <>
        ~s{VALUES ($1, $2, $3, $4, 16, 2.5, $5::text::jsonb, $6::text::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, $7, $7, 1)},
      [id, "e2e water collision", @cols, @rows, Jason.encode!(ground), Jason.encode!(height), now]
    )

    %{id: id}
  end

  describe "collision survives a save" do
    test "a reloaded map stops you where the built one did", %{conn: conn, template_id: template_id} do
      session =
        conn
        |> visit("/templates?id=" <> template_id)
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
    session =
      wait_until(session, &truthy?(&1, "window.__generatorsReady && window.__generatorsReady()"), "the generator catalog")

    # …AND THE TILESET LOADER TO LIFT. The editor holds a full-screen overlay until the backend style is
    # installed, so that everything the canvas draws comes from the DB and no default tile can flash first.
    # It covers the panel too, so a click lands on the overlay rather than on the preset under it, which
    # Playwright reports as "intercepts pointer events" and retries until it gives up.

    wait_until(session, &truthy?(&1, "!document.querySelector('.fixed.inset-0.z-\\\\[60\\\\]')"), "the tileset loader to lift")
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

  defp button_label(session, needle) do
    js(session, """
    (() => {
      const b = [...document.querySelectorAll('button')]
        .find(b => (b.innerText || '').replace(/\\s+/g, ' ').includes('#{needle}'))
      return b ? b.innerText.replace(/\\s+/g, ' ').trim() : null
    })()
    """)
  end

  defp category_label(session, key) do
    js(session, """
    (() => {
      const sel = document.querySelector('select[aria-label="Kind of place"]')
      if (!sel) return null
      const opt = [...sel.options].find(o => o.value === '#{key}')
      return opt ? opt.text : null
    })()
    """)
  end

  defp build_world(session) do
    # The editor already opens at 40x40, which is the size this test wants, so it is left alone: typing into
    # those fields re-renders the panel and detaches the input mid-fill.
    # THE OPTION'S REAL LABEL, read from the page. It is rendered as `name (shapes)`, so it says "City (11)"
    # today and something else the moment a generator is added or removed. The KEY is the stable thing, so the
    # label is looked up from it rather than written down here.
    session = select(session, category_label(session, "city"), from: "Kind of place")

    # EXACT LABELS, READ FROM THE PAGE. A preset button carries its description inside it, so a loose match on
    # "Woodland city" resolves to the two divs nested in it rather than the button, and every action button
    # wears an icon ("⚡ Build this world"). Both are the page's business, not this test's, so the full label
    # is looked up by the words a person would recognise and then clicked exactly.
    session
    # A PRESET THAT ALWAYS HAS WATER. The river OPTIONS live in the preview panel, which is a separate piece
    # of UI to open and drive; a beach city carries its sea by definition, which is the water this test is
    # about. `built.water > 0` below is the guard that says out loud when a run proved nothing.
    |> click_button(nil, "Swamp city", exact: false)
    # A RIVER, or there is no water to walk into. The preset alone builds a dry map, which would pass every
    # assertion below having proved nothing (`built.water > 0` is the guard that says so out loud).
    |> click_button(nil, "Build this world", exact: false)
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
