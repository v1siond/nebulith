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

    # WAIT FOR IT TO SETTLE FIRST. The generator catalog arrives by fetch and re-renders the panel, so
    # the select can be in the document and not yet interactive, and the driver's two second patience
    # runs out mid re-render. What comes back then is "waiting for element to be visible and enabled",
    # which reads like the control is missing rather than like it is being rebuilt.
    Browser.wait_until(
      session,
      &Browser.true?(&1, """
      (() => {
        const s = document.querySelector('select[aria-label="Kind of place"]')
        if (!s) return false
        const r = s.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && !s.disabled
      })()
      """),
      "the kind of place control to be ready"
    )

    # THE DRIVER'S OWN SELECT GIVES UP AFTER TWO SECONDS, and changing the category re-renders the
    # panel, so the element it resolved is detached before the action lands and it retries until the
    # patience runs out. Reported as "waiting for element to be visible and enabled", which reads like
    # the control is missing. Going through the binding directly is the same real select action with a
    # timeout that matches how long the panel actually takes.
    case PlaywrightEx.Frame.select_option(session.frame_id,
           selector: ~s|select[aria-label="Kind of place"]|,
           options: [%{label: label}],
           timeout: 20_000
         ) do
      {:ok, _} -> session
      other -> flunk("could not choose #{label} in the kind of place control: #{inspect(other)}")
    end
  end

  @doc "Picks a preset by the words a person would read on it."
  def choose_preset(session, words), do: press_panel_button(session, words)

  @doc """
  Picks one of the preset's options, such as which shape of river a city gets.

  Options are buttons in the preview panel, and picking one is what decides whether the built world
  carries the thing a scenario is about. The node version of this swallowed a miss with a catch that
  did nothing, so a run where the river button had been renamed built a dry map and then asserted
  about water on it. A step that is allowed to not happen is not a step.
  """
  def choose_option(session, words), do: press_panel_button(session, words)

  # THE PANEL REBUILDS ITSELF UNDER THE POINTER. Choosing anything re-renders the card list, so the
  # button the driver resolved is detached before the click lands, and its own two second patience runs
  # out. Reported as "could not find element" even though the log shows it resolved one, which reads
  # like the button is missing rather than like the panel is busy.
  defp press_panel_button(session, words) do
    case PlaywrightEx.Frame.click(session.frame_id,
           selector: ~s|button:has-text(#{Jason.encode!(words)})|,
           timeout: 20_000
         ) do
      {:ok, _} -> session
      other -> flunk("could not press the panel button reading #{words}: #{inspect(other)}")
    end
  end

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
    |> press_panel_button("Build this world")
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

  @doc "Opens a preset and waits for its options to render."
  def open_preset(session, name) do
    session
    |> click_button(nil, name, exact: false)
    |> Browser.wait_until(
      &(Browser.count(&1, ".ctl .swatches") > 0),
      "#{name}'s options to render"
    )
  end

  @doc """
  Walks every card through the middle of the screen so its thumbnail draws.

  The thumbnails are lazy, behind one shared IntersectionObserver, so a card that never reaches the
  viewport never draws and reads here as a card with no picture. This is what a person scrolling the
  panel does, only faster.
  """
  def warm_thumbnails(session) do
    cards = Browser.count(session, ".swatches .sw")

    Enum.each(0..(cards - 1)//1, fn index ->
      Browser.js(
        session,
        "document.querySelectorAll('.swatches .sw')[#{index}]?.scrollIntoView({block:'center'})"
      )

      Process.sleep(250)
    end)

    Browser.wait_until(session, &settled?/1, "every previewed card to draw", timeout: 120_000)
  end

  # Drawn, and STILL drawn a beat later. A card caught mid-render would otherwise read as one that
  # draws nothing at all.
  defp settled?(session) do
    drawn = Browser.count(session, ".swatches .sw img")
    Process.sleep(1_000)
    drawn > 0 and Browser.count(session, ".swatches .sw img") == drawn
  end

  @doc """
  What the panel is showing: each control's label, how many cards it has, whether it fell back to a
  dropdown, and a HASH of each card's picture.

  The pictures are data URLs of several kilobytes. They travel as hashes because the question is
  whether two cards drew the SAME map, never what is in the picture.
  """
  def read(session) do
    Browser.js(session, """
    (() => {
      const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(16) }
      const rows = [...document.querySelectorAll('.ctl')].map(ctl => {
        const cards = [...ctl.querySelectorAll('.swatches .sw')]
        return {
          label: (ctl.querySelector('.l')?.textContent || '').trim(),
          cards: cards.length,
          select: !!ctl.querySelector('select'),
          pictures: cards.map(c => c.querySelector('img')?.getAttribute('src') || '').filter(Boolean).map(hash),
        }
      })
      return { rows, headings: [...document.querySelectorAll('.sub')].map(h => (h.textContent || '').trim()) }
    })()
    """) || %{}
  end
end
