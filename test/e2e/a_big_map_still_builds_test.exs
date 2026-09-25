defmodule Nebulith.E2E.ABigMapStillBuildsTest do
  @moduledoc """
  THE BIGGEST MAP STILL BUILDS A WORLD.

  Measured on 2026-09-22: a 100x100 city came back with ZERO tiles. Not a slow build that the scenario
  gave up on, which is what it looks like from the outside: `GeneratePanel.build/1` waits for the tile
  count to CHANGE and that wait SUCCEEDED, so the generator started placing. It then settled, and by
  the time the count was read it was back to zero. Something between starting and finishing empties the
  grid, and it only does it at this size: 40x40 and 100x60 both build.

  So this is the size gated, and it says what the page said while it happened. A build that ends in an
  empty grid and a build that throws look identical from the tile count, and they are different bugs.
  """
  use Nebulith.E2ECase, async: false

  @moduletag :e2e
  @moduletag :phase8
  @moduletag timeout: 600_000

  alias Nebulith.E2E.GeneratePanel

  @size %{cols: 100, rows: 100}

  # THE WATCHER GOES ON BEFORE THE PAGE DOES. `add_init_script` runs on the NEXT navigation, so
  # installing it after the editor is open catches nothing, and an empty error list would then read as
  # "it failed silently" when it simply was not listening.
  setup context do
    context
    |> watch_for_errors()
    |> Elixir.Map.put(:map, @size)
    |> a_signed_in_editor()
  end

  test "a 100x100 city comes out with a world in it", %{session: session} do
    session = GeneratePanel.build_world(session, "city", "Jungle city")

    # COUNTED IN THE PAGE. Shipping 13,618 assets here to be counted is the read that intermittently came
    # back empty and reported this very build as a map with nothing on it.
    tiles = Canvas.tile_count(session)

    assert tiles >= 500,
           "a #{@size.cols}x#{@size.rows} city built #{tiles} tiles. " <> what_went_wrong(session)
  end

  # WHAT THE PAGE SAID. An empty grid is the symptom of several different failures and the console is
  # what tells them apart: a generator that threw, an allocation that failed, a fetch that 500ed.
  defp watch_for_errors(%{conn: conn} = context) do
    {:ok, _} =
      PlaywrightEx.BrowserContext.add_init_script(conn.context_id,
        source: """
        (() => {
          const w = window
          w.__errors = []
          w.addEventListener('error', e => w.__errors.push(String(e.message || e.error)))
          w.addEventListener('unhandledrejection', e => w.__errors.push('unhandled: ' + String(e.reason)))
          const err = console.error.bind(console)
          console.error = (...args) => { w.__errors.push(args.map(String).join(' ')); err(...args) }
        })()
        """,
        timeout: 10_000
      )

    context
  end

  defp what_went_wrong(session) do
    case Browser.js(session, "(window.__errors ?? []).slice(0, 6)") do
      [_ | _] = errors -> "The page reported: " <> Enum.join(errors, " | ")
      _ -> "The page reported no error at all, so it built nothing quietly."
    end
  end
end
