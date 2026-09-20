defmodule Nebulith.Catalog.ThePanelDrawsTheOptionsTest do
  @moduledoc """
  A BARE SEED PRODUCES THE APPROVED PANEL.

  The panel lost its region and bridge pictures, its headings and its card pickers, and went back to looking
  like a much older version of itself. The DATA under it is what regressed: `GeneratorSource.seed/0` REPLACES
  the whole options array, `preview` and `group` lived only in data migrations that run after it, so running
  the base seeder stripped them and every card fell back to a plain dropdown.

  A seeder whose output is not the approved state is a trap for whoever runs it next, so the fields moved into
  the seeder and this is the gate that keeps them there. It fails on a seeder that forgets either one.
  """
  use Nebulith.DataCase

  alias Nebulith.Catalog
  alias Nebulith.Catalog.GeneratorSource

  setup do
    GeneratorSource.seed()

    options =
      Catalog.list_generator_categories()
      |> Enum.flat_map(& &1.generators)
      |> Enum.flat_map(& &1.options)
      |> Map.new(&{&1["key"], &1})

    %{options: options}
  end

  describe "what the panel needs to draw a picture" do
    test "the options whose choices are different THINGS carry preview", %{options: options} do
      for key <- ~w(river bridge region) do
        assert options[key]["preview"] == true,
               "#{key} lost its preview, so the panel draws a dropdown where it drew a picture of each choice"
      end
    end

    test "the options that are COUNTS do not, because two counts look the same", %{
      options: options
    } do
      for key <- ~w(exits pathways) do
        refute Map.get(options[key], "preview"),
               "#{key} is a count: a thumbnail of 3 beside 4 teaches nothing and costs a map generation each"
      end
    end
  end

  describe "what the panel needs to group them" do
    test "every option says which heading it belongs under", %{options: options} do
      for {key, opt} <- options do
        assert opt["group"] in ~w(layout water crossings),
               "#{key} has no group, so it renders as a peer of the thing it is a setting OF"
      end
    end

    test "and the generator carries the label for every group its options name" do
      for category <- Catalog.list_generator_categories(),
          generator <- category.generators,
          generator.options != [] do
        labels = generator.config["optionGroups"] || %{}

        for opt <- generator.options do
          assert Map.has_key?(labels, opt["group"]),
                 "#{generator.key}: option #{opt["key"]} is in group #{opt["group"]}, which has no heading"
        end
      end
    end
  end

  describe "what the panel needs to fit the map" do
    test "the ways across a map are measured by the map", %{options: options} do
      assert options["pathways"]["countBy"] == "ways",
             "pathways no longer says what measures it, so the list goes back to a hand-written four " <>
               "however big the template is"
    end

    test "and the ways OUT are measured by the ways across", %{options: options} do
      # A pathway is a stretch that leaves the map at one or both of its ends (docs/PATHWAYS.md §1), so six
      # pathways is up to twelve exits. The panel builds the list from this.
      assert options["exits"]["countPer"] == %{"option" => "pathways", "each" => 2},
             "exits no longer follows the pathways, so picking six of them still offers four ways out"
    end

    test "a count authors only the choices that say something a number cannot", %{options: options} do
      # The rest are generated up to the ceiling, so an authored list is a source of LABELS, never the limit.
      # Four hand-written entries here is what capped every map at four.
      assert length(options["pathways"]["choices"]) == 1,
             "pathways authors a list of counts again, which is a second limit beside the measured one"

      assert Enum.map(options["exits"]["choices"], & &1["key"]) == ~w(random 1 2),
             "exits authors counts past the two whose wording says something a bare number cannot"
    end
  end

  describe "one owner" do
    test "a bare seed is the whole approved panel, with nothing patching it afterwards" do
      # The point of the whole fix: these four facts used to be UPDATEs in data migrations applied ON TOP of
      # what `seed/0` wrote, and `seed/0` replaces what it writes. Seeding twice in a row settles it: if
      # anything still patched the output, the second seed would undo it.
      GeneratorSource.seed()
      GeneratorSource.seed()

      river =
        Catalog.list_generator_categories()
        |> Enum.flat_map(& &1.generators)
        |> Enum.flat_map(& &1.options)
        |> Enum.find(&(&1["key"] == "river"))

      assert river["preview"] == true
      assert river["group"] == "water"
    end
  end
end
