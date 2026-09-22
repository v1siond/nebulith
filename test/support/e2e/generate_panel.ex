defmodule Nebulith.E2E.GeneratePanel do
  @moduledoc """
  Building a world through the panel, the way a person builds one.

  ## Labels are read off the page, never written down here

  A preset button carries its description inside it, so a loose match on "Woodland city" resolves to
  the two divs nested in the button rather than the button. An action button wears an icon, so its
  label is not the words alone. And a category option is rendered as its name plus a count, so it says
  "City (11)" today and something else the moment a generator is added.

  All three are the page's business. A scenario names the thing a person would recognise, and this
  looks up whatever the page currently calls it. A test that writes the rendered label down is a test
  that fails the next time somebody adds a generator, which teaches everyone to ignore it.
  """

  import PhoenixTest

  # The 4-arity form, which takes a selector AND the text, lives on the Playwright driver rather than
  # on PhoenixTest itself. A preset button needs both: the words alone match the divs nested in it.
  import PhoenixTest.Playwright, only: [click_button: 4]
  import ExUnit.Assertions, only: [flunk: 1]

  alias Nebulith.E2E.{Browser, Canvas}

  @doc "Chooses the kind of place by its stable key, clicking the label the page is showing for it."
  def choose_category(session, key) do
    label =
      Browser.js(session, """
      (() => {
        const sel = document.querySelector('select[aria-label="Kind of place"]')
        if (!sel) return null
        const opt = [...sel.options].find(o => o.value === '#{key}')
        return opt ? opt.text : null
      })()
      """)

    label || flunk("the panel has no category called #{key}")
    select(session, "Kind of place", option: label)
  end

  @doc "Picks a preset by the words a person would read on it."
  def choose_preset(session, words), do: click_button(session, nil, words, exact: false)

  @doc """
  Picks one of the preset's options, such as which shape of river a city gets.

  Options are buttons in the preview panel, and picking one is what decides whether the built world
  carries the thing a scenario is about. The node version of this swallowed a miss with a catch that
  did nothing, so a run where the river button had been renamed built a dry map and then asserted
  about water on it. A step that is allowed to not happen is not a step.
  """
  def choose_option(session, words), do: click_button(session, nil, words, exact: false)

  @doc """
  Presses Build and waits for the world to CHANGE and then settle.

  Not for tiles to exist: an empty 40x40 map already carries 1,600 floor tiles, so "at least one tile"
  is true before the button is pressed and the wait returns instantly, handing the scenario the map it
  started with. A wait that is already satisfied is not a wait.

  So the count before the press is the baseline, and this waits for it to move and then stop moving.
  Generation streams tiles in, so a count that moved once is not a world that is finished.
  """
  def build(session) do
    before = length(Canvas.tiles(session))

    session
    |> click_button(nil, "Build this world", exact: false)
    |> Browser.wait_until(&(length(Canvas.tiles(&1)) != before), "the world to start building",
      timeout: 120_000
    )
    |> settle()
  end

  # Two reads a beat apart that agree. A generator that is still placing tiles disagrees with itself.
  defp settle(session, last \\ -1) do
    now = length(Canvas.tiles(session))
    if now == last, do: session, else: settle_again(session, now)
  end

  defp settle_again(session, now) do
    Process.sleep(1_000)
    settle(session, now)
  end

  @doc "The whole thing: a category, a preset, any options it needs, and a built world."
  def build_world(session, category, preset, options \\ []) do
    session
    |> choose_category(category)
    |> choose_preset(preset)
    |> then(fn s -> Enum.reduce(options, s, &choose_option(&2, &1)) end)
    |> build()
  end
end
