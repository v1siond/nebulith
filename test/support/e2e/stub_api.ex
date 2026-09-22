defmodule Nebulith.E2E.StubApi do
  @moduledoc """
  Answering the page's API calls with a payload the scenario states.

  ## Why an init script and not Playwright routing

  `playwright_ex` carries no request interception: there is no Route, no fulfill, no abort. The one
  interception point that does exist runs in the page, and it is enough here because the frontend
  talks to the backend through `fetch` and nothing else. `BrowserContext.add_init_script/2` installs
  the wrapper before any page script runs, and re-installs it on every navigation, so it survives the
  reload in the middle of a round-trip scenario.

  ## Where the payload comes from, and why that matters

  A stub is only worth anything if it describes the schema the app actually serves. So the payloads
  here are built in Elixir out of the same code the controller uses (`MapController.schema_payload/0`
  serialises from `World.CellTile` itself), never typed out by hand. A hand-written stub is a second
  copy of the schema, and the moment a column is added the scenario is testing an app that no longer
  exists while staying green.

  Prefer real rows for the happy path: a fixture written through `Catalog.create_template/1` and
  served by the real controller cannot disagree with the schema at all. Reach for a stub when the
  scenario is about a response the backend is not supposed to produce, which is the one thing real
  rows cannot express: an error, an empty catalog, a field arriving null.

  ## A stub that never fires is worse than no stub

  If a path never matches, the page quietly talks to the real backend and the scenario passes while
  proving something else entirely. So every call is recorded, and `assert_served/2` fails when a stub
  the scenario declared was never asked for.
  """

  import ExUnit.Assertions

  @doc """
  Installs stub answers for API paths, before the page loads.

  Keys are paths (`"/api/maps/schema"`). Values are anything Jason can encode, and are served as the
  JSON body with a 200. Call before `visit/2`.
  """
  def stub(session, answers) when is_map(answers) do
    {:ok, _} =
      PlaywrightEx.BrowserContext.add_init_script(session.context_id,
        source: script(answers),
        timeout: 10_000
      )

    session
  end

  @doc "Every API path the page asked for, in order, including ones no stub answered."
  def calls(session), do: Nebulith.E2E.Browser.js(session, "(window.__stubbedCalls ?? [])") || []

  @doc "Fails unless the page actually asked for `path`, so a stub cannot silently miss."
  def assert_served(session, path) do
    served = calls(session)

    assert Enum.any?(served, &(&1["path"] == path and &1["stubbed"] == true)),
           "nothing asked for #{path}, so the stub proved nothing. The page asked for: " <>
             inspect(Enum.map(served, & &1["path"]))

    session
  end

  # The wrapper. Matched on PATH so a query string or a host does not have to be written down.
  defp script(answers) do
    """
    (() => {
      const answers = #{Jason.encode!(answers)}
      window.__stubbedCalls = []
      const real = window.fetch
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input.url
        const path = new URL(url, window.location.origin).pathname
        const stubbed = Object.prototype.hasOwnProperty.call(answers, path)
        window.__stubbedCalls.push({ path, stubbed })
        if (!stubbed) return real(input, init)
        return new Response(JSON.stringify(answers[path]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
    })()
    """
  end
end
