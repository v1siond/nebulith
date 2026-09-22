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
  Saves the open map and waits for the row to land, then gives back the saved id.

  Reads the id out of the database rather than out of the page: what a save is FOR is the row, so the
  row is the thing worth waiting on.
  """
  def save(session) do
    click_button(session, "Save")
    Browser.wait_until(session, fn _ -> last_saved_id() != nil end, "the save to reach the database")
    last_saved_id() || flunk("the save never reached the database")
  end

  @doc "Saves, then opens what was saved. The round trip, as a person performs it."
  def save_and_reopen(session), do: open(session, save(session))

  defp last_saved_id do
    case Nebulith.Repo.query!(~s{select id from "Template" order by "updatedAt" desc limit 1}) do
      %Postgrex.Result{rows: [[id]]} -> id
      _ -> nil
    end
  end
end
