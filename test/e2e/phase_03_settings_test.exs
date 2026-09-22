defmodule Nebulith.E2E.Phase03SettingsTest do
  @moduledoc """
  PHASE 3: every setting is defaulted by the database, and the panel invents no limits.

  Two halves of the same law. The backend decides values and the frontend renders them, so a column
  has a DEFAULT, `/api/maps/schema` serves it, and the engine boots with it. And the frontend sets no
  limits: no minimum, no maximum, no step invented in React.
  """
  use Nebulith.E2ECase, async: false

  @moduletag :e2e
  @moduletag :phase3

  alias Nebulith.E2E.GeneratePanel

  setup :a_signed_in_editor

  describe "the defaults come from the column" do
    test "the engine boots with the served schema and agrees with it on every field",
         %{session: session} do
      session =
        Browser.wait_for_js(
          session,
          "!!window.__nebulithTileSchema",
          "the engine to load the schema"
        )

      loaded = Browser.js(session, "window.__nebulithTileSchema")

      assert is_map(loaded),
             "the engine never loaded /api/maps/schema, so its defaults are still its own literals"

      served =
        Browser.js(session, "fetch('/api/maps/schema').then(r => r.json()).then(b => b.data)")

      fields = served["fields"]

      assert is_list(fields) and fields != [], "the schema served no fields"

      missing = Enum.reject(fields, &Elixir.Map.has_key?(loaded["defaults"], &1))

      assert missing == [],
             "no default for #{Enum.join(missing, ", ")}, so a renderer still has to invent " <>
               "#{length(missing)} setting(s)"

      disagreed =
        Enum.filter(fields, &(loaded["defaults"][&1] != served["defaults"][&1]))

      assert disagreed == [],
             "the engine and the database disagree about #{Enum.join(disagreed, ", ")}"
    end

    test "the defaults the plan states by value are those values", %{session: session} do
      session =
        Browser.wait_for_js(
          session,
          "!!window.__nebulithTileSchema",
          "the engine to load the schema"
        )

      defaults = Browser.js(session, "window.__nebulithTileSchema")["defaults"]

      stated = %{
        "stack_at" => 1,
        "width" => "1.0",
        "height" => "1.0",
        "depth" => "1.0",
        "display" => "all_faces",
        "shape" => "square",
        "surface" => "plain"
      }

      for {field, value} <- stated do
        assert defaults[field] == value,
               "#{field}: the served default is #{inspect(defaults[field])}, the plan states #{inspect(value)}"
      end
    end

    test "the vocabulary comes from the column too, and the deleted words stay deleted",
         %{session: session} do
      session =
        Browser.wait_for_js(
          session,
          "!!window.__nebulithTileSchema",
          "the engine to load the schema"
        )

      schema = Browser.js(session, "window.__nebulithTileSchema")

      assert "cone" in (schema["vocabularies"]["shape"] || []),
             "shape has no cone, so a conifer still has to lie about its silhouette"

      assert schema["vocabularies"]["display"] == ["all_faces", "single"],
             "display's vocabulary is #{inspect(schema["vocabularies"]["display"])}"

      fields =
        Browser.js(
          session,
          "fetch('/api/maps/schema').then(r => r.json()).then(b => b.data.fields)"
        )

      for banned <- ~w(zoom walkable blocking blocked blocks_movement is_solid occupies) do
        refute banned in fields, "#{banned} is back in the schema"
      end
    end
  end

  describe "law 12: the frontend sets no limits" do
    test "a size accepts a value past its drag range, and a nudge moves one step",
         %{session: session} do
      session =
        session
        |> GeneratePanel.build_world("city", "Woodland city")
        |> select_a_tile()
        |> reveal_size_section()

      assert Browser.count(session, "input[type=range]") > 0,
             "the settings panel has no sliders, so this proves nothing"

      # Height as well as Width, because on a unit all three axes write the same size: by the second
      # axis the range has already grown, so comparing against the range would prove nothing.
      for {label, typed} <- [{"Width", 20}, {"Height", 14}] do
        range = ~s|input[type=range][aria-label="#{label}"]|

        assert Browser.count(session, range) > 0, "#{label} has no slider on screen"

        cap_before = number(session, "#{range}", "max")

        session
        |> fill_in(~s|input[aria-label="#{label} value"]|, "#{label} value",
          with: to_string(typed)
        )
        |> press(~s|input[aria-label="#{label} value"]|, "Enter")

        Browser.wait_until(
          session,
          fn s -> number(s, range, "value") == typed * 1.0 end,
          "#{label} to take #{typed}, past its drag range of #{cap_before}"
        )

        assert number(session, range, "max") >= typed,
               "#{label}'s slider did not grow to hold #{typed}: max=#{number(session, range, "max")}"

        # THE MOVE THAT USED TO DESTROY IT. A nudge moves the value by ONE STEP. It must not jump to
        # a cap.
        Browser.js(session, "document.querySelector('#{range}').focus()")
        press(session, range, "ArrowLeft")

        Browser.wait_until(
          session,
          fn s -> number(s, range, "value") != typed * 1.0 end,
          "the nudge on #{label} to land",
          timeout: 10_000
        )

        after_nudge = number(session, range, "value")

        assert abs(after_nudge - typed) <= typed * 0.05,
               "nudging #{label} snapped it to a cap: typed=#{typed} after=#{after_nudge}"
      end
    end
  end

  # A TILE THAT IS ON SCREEN. The camera shows a window onto the map, so most cells project outside the
  # canvas and clicking one of those is a click somewhere else entirely. And a floor is skipped: the
  # size controls this scenario drives belong to a tile standing in the cell, not to the ground.
  defp select_a_tile(session) do
    tile =
      Canvas.a_visible_tile(session, &(&1["type"] != "floor")) ||
        flunk(
          "nothing but ground is on screen, so there is no tile to open the size controls for"
        )

    session
    |> Canvas.click_cell(tile["col"], tile["row"])
    |> Browser.wait_for_js(
      "document.body.innerText.includes('SIZE & POSITION')",
      "the inspector to open for #{tile["label"] || tile["type"]}"
    )
  end

  # The panel's sections are TOGGLES, so a blind click closes one that was already open and the run
  # then fails for a reason that has nothing to do with the sliders. Open by OUTCOME: click, and if
  # the control is still not there, click again.
  defp reveal_size_section(session, attempts \\ 4)

  defp reveal_size_section(session, 0) do
    assert Browser.count(session, ~s|input[type=range][aria-label="Width"]|) > 0,
           "the Size and position section never opened"

    session
  end

  defp reveal_size_section(session, attempts) do
    case Browser.count(session, ~s|input[type=range][aria-label="Width"]|) > 0 do
      true -> session
      false -> click_section_then_retry(session, attempts)
    end
  end

  defp click_section_then_retry(session, attempts) do
    # RENDERED text, not textContent. The header reads "SIZE & POSITION" on screen and "Size & position"
    # in the DOM: the capitals come from a CSS text-transform. Matching the source text finds nothing and
    # reads exactly like a section that is not there.
    Browser.js(session, """
    (() => {
      const norm = s => (s || '').replace(/\\s+/g, ' ').trim()
      const hit = [...document.querySelectorAll('*')]
        .filter(e => norm(e.innerText).includes('SIZE & POSITION'))
        .filter(e => ![...e.children].some(c => norm(c.innerText).includes('SIZE & POSITION')))
        .pop()
      if (hit) (hit.closest('button') || hit.parentElement || hit).click()
      return true
    })()
    """)

    Process.sleep(800)
    reveal_size_section(session, attempts - 1)
  end

  defp number(session, selector, attribute) do
    case Browser.js(session, "Number(document.querySelector('#{selector}')?.#{attribute})") do
      n when is_number(n) -> n * 1.0
      _ -> 0.0
    end
  end
end
