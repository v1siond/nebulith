defmodule Nebulith.E2E.Phase04PointerTest do
  @moduledoc """
  CLICKING A UNIT SELECTS IT, WHATEVER THE SIDEBAR HAS ARMED.

      right now if I add a unit and I want to edit it, I have to click tiles, then click the unit I
      just added to see it's characteristics / that's stupidly annoying, if I click on a given unit I
      should select it, regardless of the sidebar option I'm in

  Every placement branch in the canvas mousedown acted on the CELL and returned before anything
  hit-tested a unit, so with the entity tool still in hand a click on the unit you had just placed
  painted the ground under it. Editing it meant leaving the tool, clicking, and arming again.

  The framework is `docs/EDITOR-INTERACTION-SPEC.md`: §2 is the rule, §3 is `Alt` as the override that
  still reaches the floor beneath a unit, §4 is why connector mode is deliberately not included.

  ## Driven the way a person drives it

  The rail, the verb button, and two clicks on the canvas. Nothing here arms a tool through a seam,
  because WHICH tool is armed when the second click lands is the entire subject of the scenario. The
  seams are read only, to say what the app then holds.
  """
  use Nebulith.E2ECase, async: false

  @moduletag :e2e
  @moduletag :phase4

  # The one control in the inspector that only a UNIT ever puts on screen. A cell selection renders no
  # such row, so its presence IS "the inspector morphed to the unit", read off the page rather than out
  # of a variable.
  #
  # Matched as rendered TEXT, not as a selector. `Browser.count/2` goes through `querySelectorAll`,
  # which is plain CSS: `:has-text()` is a Playwright pseudo-class, so a selector using it throws
  # inside the page and comes back as a count of ZERO, which reads exactly like a button that is not
  # there. It cost a run here already.
  @unit_only_control "Inventory & abilities"

  setup :a_signed_in_editor

  describe "with the character tool still armed" do
    test "a click on the unit you just placed selects it instead of painting under it", %{
      session: session
    } do
      cell = an_empty_cell(session)

      session =
        session
        |> open_characters_rail()
        |> click_button("Add a villager")
        |> Canvas.click_cell(cell["col"], cell["row"])

      # IT WAS ACTUALLY PLACED. Without this the scenario below could pass on a map where the tool
      # never armed and nothing was ever added, which is the shape of a check that proves nothing.
      Browser.wait_for_js(
        session,
        "(window.__entityInfo?.().count ?? 0) > 0",
        "the villager to be placed"
      )

      placed = Browser.js(session, "window.__entityInfo().count")

      # THE SECOND CLICK, ON THE SAME CELL, WITH THE TOOL STILL ARMED. This is the gesture he
      # described, and before the fix it dropped a second villager rather than selecting the first.
      session = Canvas.click_cell(session, cell["col"], cell["row"])

      Browser.wait_for_js(
        session,
        "window.__selectedEntityInfo?.().found === true",
        "the villager to be selected by clicking it"
      )

      assert Browser.true?(
               session,
               "document.body.innerText.includes(#{Jason.encode!(@unit_only_control)})"
             ),
             "the app selected the unit but the inspector never morphed to it, so there is still " <>
               "nothing on screen to edit"

      assert Browser.js(session, "window.__entityInfo().count") == placed,
             "clicking the unit added another one instead of selecting it, which is the armed tool " <>
               "still winning the click"
    end

    test "alt still reaches the cell under a unit", %{session: session} do
      cell = an_empty_cell(session)

      session =
        session
        |> open_characters_rail()
        |> click_button("Add a villager")
        |> Canvas.click_cell(cell["col"], cell["row"])

      Browser.wait_for_js(
        session,
        "(window.__entityInfo?.().count ?? 0) > 0",
        "the villager to be placed"
      )

      # ⌥Alt IS THE OVERRIDE (§3): the ARMED TOOL keeps the click, so the unit is not selected and the
      # tool acts on the cell. It refuses this particular cell, because a unit is already standing on
      # it, and says so. That refusal is the evidence: it is the placement tool answering, which is
      # exactly what alt is for, and it could not happen if the click had been taken for a selection.
      Canvas.alt_click_cell(session, cell["col"], cell["row"])

      Browser.wait_for_js(
        session,
        "document.body.innerText.includes('already occupied')",
        "the armed tool, not the selection, to answer an alt+click"
      )

      refute Browser.js(session, "window.__selectedEntityInfo?.().found") == true,
             "alt+click selected the unit, so there is no way left to act on the cell beneath one"

      # AND THE SAME CLICK WITHOUT ALT DOES THE OPPOSITE, which is what stops the check above from
      # passing merely because a click did nothing at all.
      session = Canvas.click_cell(session, cell["col"], cell["row"])

      Browser.wait_for_js(
        session,
        "window.__selectedEntityInfo?.().found === true",
        "the same click without alt to select the unit"
      )
    end
  end

  describe "with the remove tool armed" do
    # THE EXCEPTION (§4), and the one §2 is most likely to break. "Remove a character" exists to delete
    # the unit you click on, so if a click on a unit selected it instead, the tool would have no
    # gesture left and there would be no way to delete a unit at all. The first version of the guard
    # did exactly that.
    test "a click on a unit still deletes it rather than selecting it", %{session: session} do
      cell = an_empty_cell(session)

      session =
        session
        |> open_characters_rail()
        |> click_button("Add a villager")
        |> Canvas.click_cell(cell["col"], cell["row"])

      Browser.wait_for_js(
        session,
        "(window.__entityInfo?.().count ?? 0) > 0",
        "the villager to be placed"
      )

      before = Browser.js(session, "window.__entityInfo().count")

      session = click_button(session, "Remove a character")
      Canvas.click_cell(session, cell["col"], cell["row"])

      Browser.wait_until(
        session,
        &(Browser.js(&1, "window.__entityInfo().count") < before),
        "the remove tool to delete the villager it was clicked on"
      )
    end
  end

  # Any cell that is on screen. A scratch map carries its ground as `groundData` with an empty asset
  # list, so asking for a placed TILE finds nothing on it; the cell is what this scenario needs
  # anyway, since the villager goes onto bare ground.
  defp an_empty_cell(session) do
    Canvas.a_visible_cell(session) ||
      flunk("no cell is on screen, so there is nowhere to place a villager")
  end

  defp open_characters_rail(session) do
    Editor.open_rail(session, "Characters",
      holding: ~s|[role="group"][aria-label="What do you want to do"] button|
    )
  end
end
