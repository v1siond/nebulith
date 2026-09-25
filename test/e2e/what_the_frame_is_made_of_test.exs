defmodule Nebulith.E2E.WhatTheFrameIsMadeOfTest do
  @moduledoc """
  WHAT A FRAME IS ACTUALLY MADE OF, printed, so a rendering change is sized from a number.

  `docs/RENDERING.md` opens with *"Measure before touching anything"* and its order of work starts at
  *"Measure. Objects actually drawn, split into cached blit versus live draw."* The performance scenario
  next door asserts a budget and fails when it is missed; this one asks the different question the
  framework's step 3 needs answered: how much of the draw is ground a substrate could absorb.

  It asserts almost nothing on purpose. A measurement that fails is a measurement nobody takes.
  """
  use Nebulith.E2ECase, async: false

  @moduletag :e2e
  @moduletag :perf
  @moduletag timeout: 900_000

  alias Nebulith.E2E.Account
  alias Nebulith.E2E.Browser
  alias Nebulith.E2E.Canvas
  alias Nebulith.E2E.Editor
  alias Nebulith.E2E.GeneratePanel
  alias Nebulith.E2E.World

  @worlds [
    {"a small wilderness", %{cols: 40, rows: 40}, "wilderness", "Woodland"},
    {"a wide city", %{cols: 100, rows: 60}, "city", "Woodland city"}
  ]

  setup %{conn: conn} do
    World.seed_catalog()

    # ONE SIGN IN, then both worlds. Signing up a second time in one session asks for a form the browser
    # is never shown: it is already somebody, so /signup sends it to the gallery and the email field it
    # waits for never appears.
    %{session: Account.sign_in(conn, Account.an_admin())}
  end

  test "how much of each frame is ground a substrate could take", %{session: session} do
    rows =
      for {what, size, category, preset} <- @worlds do
        map = World.scratch_map(size)

        session =
          session
          |> Editor.open(map.id)
          |> GeneratePanel.build_world(category, preset)

        tiles = Canvas.tile_count(session)

        assert tiles >= 500,
               "refusing to measure an empty scene: #{what} built #{tiles} tiles"

        phases =
          Browser.wait_value(session, "window.__isoPhases?.objects ? window.__isoPhases : null")

        {what, tiles, phases}
      end

    IO.puts("\n  WHAT THE FRAME IS MADE OF\n")

    for {what, tiles, p} <- rows do
      objects = p["objects"] || 0
      substrate = p["substrate"] || 0
      share = if objects > 0, do: round(substrate * 100 / objects), else: 0

      IO.puts("""
        #{what}: #{tiles} tiles on the map
          objects drawn        #{objects}
          …of which FLOORS     #{p["floors"]}
          …of that, BAKEABLE   #{substrate}  (#{share}% of the frame)
          absorbed by chunks   #{p["substrateChunks"]} chunk(s) blitted, #{p["substrateHeld"]} held
          left after a chunk   #{objects - substrate}
          setup #{fmt(p["setup"])}  cull #{fmt(p["cull"])}  sort #{fmt(p["sort"])}  draw #{fmt(p["draw"])}
      """)
    end

    assert rows != []

    # THE GROUND IS ACTUALLY COMING FROM CHUNKS. A substrate that silently built nothing would leave every
    # number above exactly as it was, which is the shape a performance change fails in.
    blitting =
      for {what, _tiles, p} <- rows, (p["substrateChunks"] || 0) > 0, do: what

    assert length(blitting) == length(rows),
           "only #{length(blitting)} of #{length(rows)} worlds drew any ground from a chunk, so the " <>
             "substrate is not running: #{inspect(for({w, _, p} <- rows, do: {w, p["substrateChunks"]}))}"
  end

  defp fmt(nil), do: "-"
  defp fmt(ms) when is_number(ms), do: "#{Float.round(ms / 1, 2)}ms"
  defp fmt(other), do: to_string(other)
end
