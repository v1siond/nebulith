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

  # The 4-arity form, which takes a selector AND the text, lives on the Playwright driver rather than
  # on PhoenixTest itself. A preset button needs both: the words alone match the divs nested in it.
  import ExUnit.Assertions, only: [flunk: 1]

  alias Nebulith.E2E.{Browser, Canvas}

  @doc "Chooses the kind of place by its stable key, clicking the label the page is showing for it."
  def choose_category(session, key), do: choose_in_select(session, "Kind of place", key)

  @doc """
  Chooses the season, which is what decides a world's palette.

  Named for what the page calls it. The data calls it a zone and the control says Season, and a
  scenario should say the word the person reading the screen would say.
  """
  def choose_season(session, zone), do: choose_in_select(session, "Season", zone)

  # ONE SELECT, DRIVEN PROPERLY, for both of the panel's dropdowns. They fail the same two ways and
  # they used to carry the same two workarounds in two copies.
  defp choose_in_select(session, aria_label, value) do
    selector = ~s|select[aria-label=#{Jason.encode!(aria_label)}]|

    # WAIT FOR IT TO SETTLE FIRST, BEFORE READING ITS OPTIONS. The generator catalog arrives by fetch and
    # re-renders the panel, so the select can be in the document and not yet interactive, and the
    # driver's two second patience runs out mid re-render. What comes back then is "waiting for element
    # to be visible and enabled", which reads like the control is missing rather than like it is being
    # rebuilt. Reading the options ahead of this wait asks a control that has not mounted what it
    # offers, and gets the same empty answer a genuinely missing control gives.
    Browser.wait_until(
      session,
      &Browser.true?(&1, """
      (() => {
        const s = document.querySelector(#{Jason.encode!(selector)})
        if (!s) return false
        const r = s.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && !s.disabled && s.options.length > 0
      })()
      """),
      "the #{aria_label} control to be ready"
    )

    label =
      Browser.js(session, """
      (() => {
        const sel = document.querySelector(#{Jason.encode!(selector)})
        if (!sel) return null
        const opt = [...sel.options].find(o => o.value === #{Jason.encode!(value)})
        return opt ? opt.text : null
      })()
      """)

    # SAY WHAT IT DOES OFFER. "offers nothing called spring" is true of a control that is missing and of
    # one that spells its options differently, and those are two different problems with two different
    # fixes.
    label ||
      flunk(
        "the #{aria_label} control offers nothing called #{value}, it offers " <>
          inspect(
            Browser.js(session, """
            (() => {
              const sel = document.querySelector(#{Jason.encode!(selector)})
              return sel ? [...sel.options].map(o => o.value) : null
            })()
            """)
          )
      )

    # THE DRIVER'S OWN SELECT GIVES UP AFTER TWO SECONDS, and choosing re-renders the panel, so the
    # element it resolved is detached before the action lands and it retries until the patience runs
    # out. Reported as "waiting for element to be visible and enabled", which reads like the control is
    # missing. Going through the binding directly is the same real select action with a timeout that
    # matches how long the panel actually takes.
    case PlaywrightEx.Frame.select_option(session.frame_id,
           selector: selector,
           options: [%{label: label}],
           timeout: 20_000
         ) do
      {:ok, _} -> session
      other -> flunk("could not choose #{label} in the #{aria_label} control: #{inspect(other)}")
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
  # NO PANEL BUTTON NAVIGATES, so the driver is told not to wait for one.
  #
  # Step 5 of the driver's click is "wait for any initiated navigations to complete", and on the button that
  # builds a 100x100 city the click itself lands and then that wait sits there while the page is busy
  # generating, until the 20 second budget runs out. The log says so in as many words: "click action done",
  # then "waiting for scheduled navigations to finish". Measured: the build itself reaches 13,618 tiles in
  # about six seconds, so nothing was slow except the waiting.
  #
  # These are in-page controls that run javascript where they stand. There is no navigation to wait for, and
  # `build/1` below does the real waiting afterwards, on the tile count, which is the thing that actually
  # says whether a world arrived.
  defp press_panel_button(session, words) do
    case PlaywrightEx.Frame.click(session.frame_id,
           selector: ~s|button:has-text(#{Jason.encode!(words)})|,
           noWaitAfter: true,
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
    before = Canvas.tile_count(session)

    session
    |> press_panel_button("Build this world")
    |> Browser.wait_until(&moved_from(&1, before), "the world to start building", timeout: 120_000)
    |> settle()
  end

  # A PAGE TOO BUSY TO ANSWER HAS NOT FINISHED, so the wait carries on rather than giving up on it.
  defp moved_from(session, before) do
    case Canvas.tile_count_or_busy(session) do
      :busy -> false
      now -> now != before
    end
  end

  # Two reads a beat apart that agree. A generator that is still placing tiles disagrees with itself.
  #
  # COUNTED IN THE PAGE, never by shipping the assets here to be counted: a 100x100 city holds 13,618 of
  # them, a read that big comes back empty now and then, and an empty read settles against the next empty
  # one and reports a finished build as a map with nothing on it.
  defp settle(session, last \\ -1) do
    case Canvas.tile_count_or_busy(session) do
      # Still generating, and busy is not settled: ask again rather than call an unanswered read a result.
      :busy -> settle_again(session, last)
      ^last -> session
      now -> settle_again(session, now)
    end
  end

  defp settle_again(session, now) do
    Process.sleep(1_000)
    settle(session, now)
  end

  @doc """
  Closes the preview a finished build puts on screen, so the map underneath can be clicked again.

  It is a real modal over the canvas, and Playwright reports it as the Close button intercepting pointer
  events, which reads like the canvas is missing rather than like something is in front of it. A scenario
  that only reads `window.__nebulithGrid` never notices; one that clicks a cell fails on its first click.
  """
  def close_preview(session) do
    Browser.js(session, """
    (() => {
      const dialog = document.querySelector('[role="dialog"][aria-label="Preview"]')
      const close = dialog?.querySelector('[aria-label="Close"]')
      if (close) close.click()
      return true
    })()
    """)

    Browser.wait_until(
      session,
      &(Browser.count(&1, ~s|[role="dialog"][aria-label="Preview"]|) == 0),
      "the preview to close",
      timeout: 15_000
    )
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
    |> press_panel_button(name)
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
