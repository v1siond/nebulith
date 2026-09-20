defmodule Nebulith.E2E.TheGeneratePanelTest do
  @moduledoc """
  THE PANEL SHOWS THE APPROVED UI, AND EACH CARD SHOWS ITS OWN MAP.

  This is the end-to-end layer `docs/TESTING.md` describes, in Elixir, driving a real browser against the
  TEST database: open the editor, open a preset, and read what the panel actually rendered.

  It gates the three ways the panel regressed at once.

  1. THE CONTROL IS THE SAME CONTROL, always. The panel used to pick between a card picker and a `<select>`
     from the served data, so an option that arrived without `preview` silently became a dropdown, and so did
     every option whose dependency was off. A layout must not be able to change because of a row in a table.

  2. THE OPTIONS STILL CARRY THEIR HEADINGS. `group` and the generator's `optionGroups` put each option under
     a heading. They lived in a data migration that patched the seeder's output, and `GeneratorSource.seed/0`
     REPLACES the options array, so re-seeding erased them. `the_panel_draws_the_options_test.exs` gates the
     data; this gates what the page does with it.

  3. A CARD DRAWS ITS OWN CHOICE. The thumbnail cache was keyed on a hand-written list of subject fields that
     did not include the generator options, so every card in a row collided on one key and showed the first
     card's picture. A row of identical pictures with different words under it is not a preview.

  The pictures are compared by hash rather than looked at: what is asserted is that a card's picture is its
  OWN, which is a fact about the data, and the judgement of whether it looks right stays with the user.
  """
  use PhoenixTest.Playwright.Case, async: false

  @moduletag :e2e
  # Every previewed card is a whole map generation, and this walks all of them.
  @moduletag timeout: 300_000

  @cols 40
  @rows 40
  @generator "forest_woodland"

  setup do
    Nebulith.Catalog.TileSource.seed()
    Nebulith.Catalog.GeneratorSource.seed()
    Nebulith.Catalog.ZoneSource.seed()

    %{id: id} = scratch_template()
    %{template_id: id, generator: generator(@generator)}
  end

  defp generator(key) do
    Nebulith.Catalog.list_generator_categories()
    |> Enum.flat_map(& &1.generators)
    |> Enum.find(&(&1.key == key))
  end

  defp scratch_template do
    id = Ecto.UUID.generate()
    now = NaiveDateTime.utc_now() |> NaiveDateTime.truncate(:second)
    ground = List.duplicate(List.duplicate("grass", @cols), @rows)
    height = List.duplicate(List.duplicate(0, @cols), @rows)

    Nebulith.Repo.query!(
      ~s{INSERT INTO "Template" (id, name, cols, rows, "cellSize", "isoScale", "groundData", "heightData", "assetsData", connectors, entities, quests, "createdAt", "updatedAt", "slabBlocks") } <>
        ~s{VALUES ($1, $2, $3, $4, 16, 2.5, $5::text::jsonb, $6::text::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, $7, $7, 1)},
      [id, "e2e generate panel", @cols, @rows, Jason.encode!(ground), Jason.encode!(height), now]
    )

    %{id: id}
  end

  describe "the generate panel" do
    test "every choice is a card picker, under its heading, and each card draws its own map",
         %{conn: conn, template_id: template_id, generator: generator} do
      assert generator, "#{@generator} is not in the catalog, so this run proves nothing"

      defaults = Map.new(generator.options, &{&1["key"], &1["default"]})

      session =
        conn
        |> visit("/templates?id=" <> template_id)
        |> wait_for_editor()
        |> open_preset(generator.name)
        |> warm_thumbnails()

      panel = read_panel(session)
      rows = Map.new(panel["rows"] || [], &{&1["label"], &1})

      assert map_size(rows) > 0, "the panel rendered no controls at all"

      for option <- generator.options do
        label = option["label"]
        row = rows[label]

        assert row,
               "the panel has no control for #{label}, it rendered #{inspect(Map.keys(rows))}"

        # 1. THE SAME CONTROL, FILLED OR NOT.
        refute row["select"],
               "#{label} rendered a dropdown, the approved UI for a choice is the card picker"

        assert row["cards"] > 0, "#{label} rendered a picker with no cards in it"

        # 3. AND EACH CARD ITS OWN MAP, for the options the catalog says are worth seeing.
        assert_pictures(option, row, label, blocked?(option, defaults))
      end

      # 2. UNDER ITS OWN HEADING.
      headings = panel["headings"] || []

      for {_key, heading} <- generator.config["optionGroups"] || %{} do
        assert heading in headings,
               "no #{heading} heading in the panel, it showed #{inspect(headings)}"
      end

      # AND A BLOCKED OPTION COMES ALIVE when the thing it depends on is picked. Its cards were there the
      # whole time; switching a river on is what gives each of them a different map to show.
      assert_blocked_options_come_alive(session, generator, defaults)
    end
  end

  # An option is blocked while the option it requires sits at its off value, "none" for a choice and false
  # for a toggle (`optionOffValue`).
  defp blocked?(%{"requires" => requires}, defaults) when is_binary(requires) do
    Map.get(defaults, requires) in ["none", false, nil]
  end

  defp blocked?(_option, _defaults), do: false

  defp assert_blocked_options_come_alive(session, generator, defaults) do
    blocked = Enum.filter(generator.options, &(&1["preview"] == true and blocked?(&1, defaults)))

    for option <- blocked do
      required = Enum.find(generator.options, &(&1["key"] == option["requires"]))

      assert required,
             "#{option["label"]} requires #{option["requires"]}, which this generator does not serve"

      live =
        session
        |> click_button(nil, real_choice(required)["label"], exact: false)
        |> warm_thumbnails()
        |> read_panel()

      row = Enum.find(live["rows"] || [], &(&1["label"] == option["label"]))

      assert row, "#{option["label"]} disappeared once #{required["label"]} was picked"

      assert_pictures(option, row, option["label"], false)
    end
  end

  # A choice that really is that thing: not "none" (the off value), and not "random", whose label repeats on
  # every other picker in the panel and so cannot be clicked by name.
  defp real_choice(option) do
    Enum.find(option["choices"], &(&1["key"] not in ["none", "random"]))
  end

  defp assert_pictures(option, row, label, blocked)

  # A BLOCKED OPTION DRAWS NOTHING, and keeps every one of its cards. Its dependency being off pushes it back
  # to its own off value, so all five crossings of a map with no river describe the SAME map: five identical
  # pictures, five whole generations, nothing said. The card keeps the empty box, so picking a river fills
  # the pictures in place instead of resizing the row.
  defp assert_pictures(%{"preview" => true}, row, label, true) do
    assert row["pictures"] == [],
           "#{label} cannot be picked yet, so its #{row["cards"]} cards would all draw the same map"
  end

  # A previewed option draws a picture on every card, and no two of them are the same picture.
  defp assert_pictures(%{"preview" => true}, row, label, _blocked) do
    pictures = row["pictures"] || []

    assert length(pictures) == row["cards"],
           "#{label} drew #{length(pictures)} pictures for #{row["cards"]} cards"

    assert length(Enum.uniq(pictures)) == length(pictures),
           "#{label} drew the same picture on #{length(pictures) - length(Enum.uniq(pictures))} " <>
             "of its #{length(pictures)} cards, so a card is not showing its own choice"
  end

  # An option the catalog does not mark for preview draws none: a thumbnail is a whole map generation, and
  # three exits beside four is the same map twice.
  defp assert_pictures(_option, row, label, _blocked) do
    assert row["pictures"] == [],
           "#{label} is a count, and a picture of each count is the same map drawn #{row["cards"]} times"
  end

  # ── driving the page ────────────────────────────────────────────────────────────────────────────────

  defp wait_for_editor(session) do
    assert_has(session, "canvas.nebcanvas", timeout: 30_000)

    session =
      wait_until(
        session,
        &truthy?(&1, "window.__generatorsReady && window.__generatorsReady()"),
        "the generator catalog"
      )

    wait_until(
      session,
      &truthy?(&1, "!document.querySelector('.fixed.inset-0.z-\\\\[60\\\\]')"),
      "the tileset loader to lift"
    )
  end

  defp open_preset(session, name) do
    session
    |> click_button(nil, name, exact: false)
    |> wait_until(&(count(&1, ".ctl .swatches") > 0), "the preset's options to render")
  end

  # THE THUMBNAILS ARE LAZY, one shared IntersectionObserver, so a card that never reaches the viewport never
  # draws and would read here as a missing picture. Walking every card through the middle of the screen is
  # what a person scrolling the panel does, just faster.
  defp warm_thumbnails(session) do
    cards = count(session, ".swatches .sw")

    Enum.each(0..(cards - 1)//1, fn index ->
      js(
        session,
        "document.querySelectorAll('.swatches .sw')[#{index}]?.scrollIntoView({block:'center'})"
      )

      Process.sleep(250)
    end)

    wait_until(session, &thumbnails_settled?/1, "every previewed card to draw")
  end

  # Drawn, and STILL drawn a beat later: a card mid-render would otherwise read as one that draws nothing.
  defp thumbnails_settled?(session) do
    drawn = count(session, ".swatches .sw img")
    Process.sleep(1_000)
    drawn > 0 and count(session, ".swatches .sw img") == drawn
  end

  defp read_panel(session) do
    js(session, """
    (() => {
      // The pictures are data URLs of a few kilobytes each. They travel as hashes: what matters is whether
      // two cards drew the SAME one, not what is in them.
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
      return {
        rows,
        headings: [...document.querySelectorAll('.sub')].map(h => (h.textContent || '').trim()),
      }
    })()
    """) || %{}
  end

  # ── reading the page ────────────────────────────────────────────────────────────────────────────────

  # THE VALUE, not the session. `PhoenixTest.Playwright.evaluate/2` returns the CONN so it can be piped, so
  # reading its result as the answer silently yields a struct rather than what the JavaScript returned.
  defp js(session, expression) do
    case PlaywrightEx.Frame.evaluate(session.frame_id, expression: expression, timeout: 20_000) do
      {:ok, value} -> value
      _ -> nil
    end
  end

  defp truthy?(session, expression), do: js(session, expression) == true

  defp count(session, selector) do
    case js(session, "document.querySelectorAll('#{selector}').length") do
      n when is_integer(n) -> n
      _ -> 0
    end
  end

  defp wait_until(session, check, what, waited \\ 0)

  defp wait_until(_session, _check, what, waited) when waited >= 120_000 do
    flunk("waited #{waited}ms for #{what} and it never happened")
  end

  defp wait_until(session, check, what, waited) do
    if check.(session) do
      session
    else
      Process.sleep(500)
      wait_until(session, check, what, waited + 500)
    end
  end
end
