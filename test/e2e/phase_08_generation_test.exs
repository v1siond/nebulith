defmodule Nebulith.E2E.Phase08GenerationTest do
  @moduledoc """
  PHASE 8: the panel shows the approved UI, and each card shows its own map.

  It gates the three ways the panel regressed at once.

  1. THE CONTROL IS THE SAME CONTROL, always. The panel used to pick between a card picker and a
     `<select>` from the served data, so an option that arrived without `preview` silently became a
     dropdown, and so did every option whose dependency was off. A layout must not be able to change
     because of a row in a table.

  2. THE OPTIONS STILL CARRY THEIR HEADINGS. `group` and the generator's `optionGroups` put each
     option under a heading. They lived in a data migration that patched the seeder's output, and
     `GeneratorSource.seed/0` REPLACES the options array, so re-seeding erased them.

  3. A CARD DRAWS ITS OWN CHOICE. The thumbnail cache was keyed on a hand-written list of subject
     fields that did not include the generator options, so every card in a row collided on one key and
     showed the first card's picture. A row of identical pictures with different words under it is not
     a preview.

  The pictures are compared by hash rather than looked at. What is asserted is that a card's picture
  is its OWN, which is a fact about the data; whether it looks right stays with the user.
  """
  use Nebulith.E2ECase, async: false

  @moduletag :e2e
  @moduletag :phase8

  alias Nebulith.E2E.GeneratePanel

  @generator "forest_woodland"

  setup context do
    context = a_signed_in_editor(context)
    Elixir.Map.put(context, :generator, generator(@generator))
  end

  describe "the generate panel" do
    test "every choice is a card picker, under its heading, and each card draws its own map",
         %{session: session, generator: generator} do
      assert generator, "#{@generator} is not in the catalog, so this run proves nothing"

      defaults = Elixir.Map.new(generator.options, &{&1["key"], &1["default"]})

      session =
        session
        |> GeneratePanel.open_preset(generator.name)
        |> GeneratePanel.warm_thumbnails()

      panel = GeneratePanel.read(session)
      rows = Elixir.Map.new(panel["rows"] || [], &{&1["label"], &1})

      assert map_size(rows) > 0, "the panel rendered no controls at all"

      for option <- generator.options do
        label = option["label"]
        row = rows[label]

        assert row,
               "the panel has no control for #{label}, it rendered #{inspect(Elixir.Map.keys(rows))}"

        refute row["select"],
               "#{label} rendered a dropdown, the approved UI for a choice is the card picker"

        assert row["cards"] > 0, "#{label} rendered a picker with no cards in it"

        assert_pictures(option, row, label, blocked?(option, defaults))
      end

      headings = panel["headings"] || []

      for {_key, heading} <- generator.config["optionGroups"] || %{} do
        assert heading in headings,
               "no #{heading} heading in the panel, it showed #{inspect(headings)}"
      end

      # AND A BLOCKED OPTION COMES ALIVE when the thing it depends on is picked. Its cards were there
      # the whole time; switching a river on is what gives each of them a different map to show.
      assert_blocked_options_come_alive(session, generator, defaults)
    end
  end

  defp generator(key) do
    Nebulith.Catalog.list_generator_categories()
    |> Enum.flat_map(& &1.generators)
    |> Enum.find(&(&1.key == key))
  end

  # An option is blocked while the option it requires sits at its off value: "none" for a choice and
  # false for a toggle.
  defp blocked?(%{"requires" => requires}, defaults) when is_binary(requires),
    do: Elixir.Map.get(defaults, requires) in ["none", false, nil]

  defp blocked?(_option, _defaults), do: false

  defp assert_blocked_options_come_alive(session, generator, defaults) do
    blocked = Enum.filter(generator.options, &(&1["preview"] == true and blocked?(&1, defaults)))

    for option <- blocked do
      required = Enum.find(generator.options, &(&1["key"] == option["requires"]))

      assert required,
             "#{option["label"]} requires #{option["requires"]}, which this generator does not serve"

      live =
        session
        |> GeneratePanel.choose_option(real_choice(required)["label"])
        |> GeneratePanel.warm_thumbnails()
        |> GeneratePanel.read()

      row = Enum.find(live["rows"] || [], &(&1["label"] == option["label"]))

      assert row, "#{option["label"]} disappeared once #{required["label"]} was picked"
      assert_pictures(option, row, option["label"], false)
    end
  end

  # A choice that really is that thing: not "none", the off value, and not "random", whose label
  # repeats on every other picker in the panel and so cannot be clicked by name.
  defp real_choice(option),
    do: Enum.find(option["choices"], &(&1["key"] not in ["none", "random"]))

  defp assert_pictures(option, row, label, blocked)

  # A BLOCKED OPTION DRAWS NOTHING, and keeps every one of its cards. Its dependency being off pushes
  # it back to its own off value, so all five crossings of a map with no river describe the SAME map:
  # five identical pictures, five whole generations, nothing said. The card keeps the empty box, so
  # picking a river fills the pictures in place instead of resizing the row.
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

  # An option the catalog does not mark for preview draws none: a thumbnail is a whole map generation,
  # and three exits beside four is the same map twice.
  defp assert_pictures(_option, row, label, _blocked) do
    assert row["pictures"] == [],
           "#{label} is a count, and a picture of each count is the same map drawn #{row["cards"]} times"
  end
end
