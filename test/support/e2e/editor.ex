defmodule Nebulith.E2E.Editor do
  @moduledoc """
  Opening the editor and waiting until it is safe to touch.

  Three things have to land before a click means anything, and skipping any one of them produces a
  failure that reads like a defect in the thing under test.

  1. THE CANVAS. Everything the editor draws goes there; there is no DOM to wait on instead.
  2. THE GENERATOR CATALOG, which arrives by fetch. Its arrival re-renders the panel, so interacting
     before it lands detaches the very input being typed into.
  3. THE TILESET OVERLAY LIFTING. A full-screen overlay covers the page until the backend style is
     installed, so that nothing the canvas draws is a default tile that flashed first. It covers the
     panel too, so a click before it lifts lands on the overlay, which Playwright reports as the
     element intercepting pointer events rather than as a missing button.
  """

  import PhoenixTest
  import ExUnit.Assertions, only: [flunk: 1]

  alias Nebulith.E2E.Browser

  @canvas "canvas.nebcanvas"
  # The tileset loader's full-screen cover. Escaped for a CSS selector inside a JS string.
  @overlay ".fixed.inset-0.z-\\\\[60\\\\]"

  @doc "Opens a saved map in the editor and waits until it can be driven."
  def open(session, template_id), do: session |> visit("/templates?id=#{template_id}") |> ready()

  @doc "Waits for an editor that is already on screen."
  def ready(session) do
    session
    |> assert_has(@canvas, timeout: 30_000)
    |> Browser.wait_for_js(
      "!!(window.__generatorsReady && window.__generatorsReady())",
      "the generator catalog to arrive"
    )
    |> Browser.wait_for_js("!document.querySelector('#{@overlay}')", "the tileset loader to lift")
  end

  @doc """
  Saves the open map and waits for the row it belongs to to actually change.

  Waiting for "a saved template to exist" is not a wait at all: the scenario opened one, so the answer
  is yes before the button is pressed, and the next step reads a row that has not been written yet.
  What a save changes is `updatedAt` on THIS map, so that is what is waited on.
  """
  def save(session, map_id) do
    was = updated_at(map_id) || flunk("there is no map #{map_id} to save")

    click_button(session, "Save")

    Browser.wait_until(
      session,
      fn _ -> updated_at(map_id) != was end,
      "the save to reach the row for map #{map_id}",
      # SLOWER THAN A PAGE POLL, on purpose. The browser joins this test's sandbox transaction, so
      # every query here queues behind the request the page is making, and a save is exactly when the
      # page is busiest.
      every: 1_000
    )

    session
  end

  @doc """
  Saves, reopens, and waits for the tiles to come back.

  The round trip, as a person performs it. Waiting for the canvas is not enough: the canvas is there
  before the map is, so an assertion made on it is an assertion about an empty grid.
  """
  def save_and_reopen(session, map_id) do
    session
    |> save(map_id)
    |> open(map_id)
    |> Nebulith.E2E.Canvas.wait_for_tiles(1, timeout: 60_000)
  end

  defp updated_at(map_id) do
    case Nebulith.Repo.query!(~s{select "updatedAt" from "Template" where id = $1}, [map_id]) do
      %Postgrex.Result{rows: [[at]]} -> at
      _ -> nil
    end
  end
end
