defmodule Nebulith.E2E.TransparencyHasAControlTest do
  @moduledoc """
  THE RANGE TRANSPARENCY HAS A PLACE TO BE EDITED, and moving it changes what gets saved.

  His words: *"we have like a range transparency on the units/elements but I don't see any place to manage
  or edit it, and It'd like to make the tree more opaque"*.

  ## What was measured before

  `grep -n "opacity\\|minAlpha\\|fadeNear" components/editorInspector.tsx` answered with CSS classes and
  nothing else: `disabled:opacity-30`. Three columns (`cell_tiles.opacity`, `.fade_near`, `.min_alpha`)
  were saved by the codec and read by the renderer, and not one of them had a row in the panel. So the
  behaviour was visible on the map and unreachable from the editor, which is the report word for word.

  `Nebulith.AFadeIsANumberAPersonCanChangeTest` covers the other half, the four distance bands that were
  constants in the renderer. This one is the half a person performs: open the panel, move the control,
  save, and read back the row the browser wrote.
  """
  use Nebulith.E2ECase, async: false

  @moduletag :e2e
  @moduletag :phase3
  @moduletag timeout: 600_000

  alias Nebulith.E2E.GeneratePanel

  @size %{cols: 40, rows: 40}
  @opacity ~s|input[type=range][aria-label$="opacity"]|
  # APPEARANCE IS OPEN when its colour row is on screen. Reading the section's state off the control under
  # test would make a missing control and a shut section the same failure, and they are not the same thing:
  # one is the defect, the other is a click that did not land.
  @open ~s|input[type=color]|

  setup context do
    context
    |> Elixir.Map.put(:map, @size)
    |> a_signed_in_editor()
  end

  test "the game's fade travels to the page instead of being invented there", %{session: session} do
    bands =
      Browser.wait_value(session, "window.__nebulithFadeBands ?? null", timeout: 30_000)

    for band <- ~w(fade_radius fade_full_radius fade_alpha interior_alpha) do
      assert is_number(bands[band]),
             "`#{band}` did not reach the page, so the renderer is back to holding it: #{inspect(bands)}"
    end

    assert bands["fade_radius"] > bands["fade_full_radius"],
           "the band has no width to ease across: #{inspect(bands)}"
  end

  test "a tile's opacity can be moved in the panel and the move survives a save", %{
    session: session,
    map: map
  } do
    session =
      session
      |> GeneratePanel.choose_category("wilderness")
      |> GeneratePanel.choose_preset("Woodland")
      |> GeneratePanel.build()
      |> GeneratePanel.close_preview()

    Browser.wait_until(
      session,
      &(Canvas.tile_count(&1) > 0),
      "the woodland to put something on the map",
      timeout: 120_000
    )

    session = session |> select_a_tile() |> open_appearance()

    assert Browser.count(session, @opacity) > 0,
           "the Appearance section has no opacity control, so there is still nowhere to make a tree " <>
             "more opaque"

    # HALF WAY, typed the way the slider is dragged. A value the tile cannot already be sitting at, so a
    # panel that renders the control and writes nothing fails here rather than passing on a coincidence.
    before = drawn_opacities(session)

    Browser.js(session, """
    (() => {
      const slider = document.querySelector('#{@opacity}')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(slider, '0.5')
      slider.dispatchEvent(new Event('input', { bubbles: true }))
      slider.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })()
    """)

    Browser.wait_until(
      session,
      &(drawn_opacities(&1) != before),
      "the opacity the map holds to change",
      timeout: 20_000
    )

    moved = Enum.filter(drawn_opacities(session), &(&1 == 0.5))

    refute moved == [],
           "the control moved and no tile on the map took the value, so the writer is not wired"

    # …AND IT IS STILL THERE AFTER THE ROUND TRIP. A setting that shows in the panel and does not survive
    # a save is the same defect wearing a control.
    session = Nebulith.E2E.Editor.save_and_reopen(session, map.id)

    assert Enum.any?(drawn_opacities(session), &(&1 == 0.5)),
           "the opacity did not come back from the database, so the panel edits something the save drops"
  end

  test "the game's own fade bands have a control, and moving one changes the row", %{
    session: session,
    user: user
  } do
    # THE SETUP'S OWN PERSON, already signed in. Signing in a second time in one session asks for a form the
    # browser is never shown: it is already somebody, so /login sends it to the gallery and the email field
    # it waits for never appears.
    %{game: game} = World.a_game_map(user, %{cols: 30, rows: 30})

    session =
      session
      |> visit("/games/#{game.id}")
      |> Editor.ready()
      |> Browser.wait_for_js(
        "!!window.__nebulithFadeBands",
        "the game's fade to reach the page"
      )

    # SOMETHING TO SELECT. The game-wide group lives in Appearance beside the per-tile one, on purpose: the
    # two interact and a person meets them together, so the section only renders with a tile selected. A
    # scratch map carries its ground as `groundData` and an empty asset list, so there is nothing to click
    # until a world is built on it.
    session =
      session
      |> GeneratePanel.choose_category("wilderness")
      |> GeneratePanel.choose_preset("Woodland")
      |> GeneratePanel.build()
      |> GeneratePanel.close_preview()

    session = session |> select_a_tile() |> open_appearance()

    assert Browser.count(session, ~s|input[type=range][aria-label="Faded to"]|) > 0,
           "the game's fade has no control, so the four numbers are still unreachable. " <>
             "Appearance offers #{inspect(range_labels(session))}"

    Browser.js(session, """
    (() => {
      const slider = document.querySelector('input[type=range][aria-label="Faded to"]')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(slider, '0.8')
      slider.dispatchEvent(new Event('input', { bubbles: true }))
      slider.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })()
    """)

    Browser.wait_until(
      session,
      fn _ -> Decimal.to_float(Nebulith.Games.settings(game).fade_alpha) == 0.8 end,
      "the moved band to reach the game's row",
      timeout: 20_000,
      every: 500
    )

    # …AND THE FRAME IS ALREADY DRAWING BY IT, without a reload. A control that needs a refresh to take
    # effect is a control a person tries once.
    assert Browser.js(session, "window.__nebulithFadeBands?.fade_alpha") == 0.8,
           "the row moved and the renderer is still drawing by the old number"
  end

  # A TILE THAT IS ON SCREEN, and not the ground: the ground has no block to fade.
  defp select_a_tile(session) do
    tile =
      Canvas.a_visible_tile(session, &(&1["type"] != "floor")) ||
        flunk("nothing but ground is on screen, so there is no tile to open the panel for")

    session
    |> Canvas.click_cell(tile["col"], tile["row"])
    |> Browser.wait_for_js(
      "document.body.innerText.includes('APPEARANCE')",
      "the inspector to open for #{tile["label"] || tile["type"]}"
    )
  end

  # APPEARANCE STARTS CLOSED (`inspectorSections.ts`, defaultOpen: false) and the header is a TOGGLE, so
  # this opens by OUTCOME rather than by clicking once and hoping.
  defp open_appearance(session, attempts \\ 4)

  defp open_appearance(session, 0) do
    assert Browser.count(session, @open) > 0, "the Appearance section never opened"

    session
  end

  defp open_appearance(session, attempts) do
    case Browser.count(session, @open) > 0 do
      true ->
        session

      false ->
        # RENDERED text, not textContent: the header reads "APPEARANCE" on screen and "Appearance" in the
        # DOM, the capitals are a CSS text-transform.
        Browser.js(session, """
        (() => {
          const norm = s => (s || '').replace(/\\s+/g, ' ').trim()
          const hit = [...document.querySelectorAll('*')]
            .filter(e => norm(e.innerText).toUpperCase().includes('APPEARANCE'))
            .filter(e => ![...e.children].some(c => norm(c.innerText).toUpperCase().includes('APPEARANCE')))
            .pop()
          if (hit) (hit.closest('button') || hit.parentElement || hit).click()
          return true
        })()
        """)

        Process.sleep(300)
        open_appearance(session, attempts - 1)
    end
  end

  # WHAT THE PANEL IS ACTUALLY OFFERING, so a miss names the gap instead of only the absence.
  defp range_labels(session) do
    Browser.js(session, """
    [...document.querySelectorAll('input[type=range]')].map(i => i.getAttribute('aria-label'))
    """)
  end

  defp drawn_opacities(session) do
    for tile <- Canvas.tiles(session),
        is_number(tile["opacity"]),
        do: tile["opacity"] * 1.0
  end
end
