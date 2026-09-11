defmodule Nebulith.GeneratorSourceTest do
  @moduledoc """
  The map-generator CATALOG is backend data (T-113). These tests exercise the seed the way the app
  does — seed, read back through the context, re-seed — and assert the ported NUMBERS, because the
  whole point of the move is that the frontend stops carrying them.
  """
  use Nebulith.DataCase

  alias Nebulith.Catalog
  alias Nebulith.Catalog.{Generator, GeneratorCategory}
  alias Nebulith.Catalog.GeneratorSource

  defp by_key(categories), do: Map.new(categories, &{&1.key, &1})

  defp rgb("#" <> hex) do
    [r, g, b] = for i <- [0, 2, 4], do: elem(Integer.parse(String.slice(hex, i, 2), 16), 0)
    {r, g, b}
  end

  # Rough perceived brightness of "#rrggbb" — enough to assert which of two colours is the darker one.
  defp luminance("#" <> hex) do
    {r, g, b} = {String.slice(hex, 0, 2), String.slice(hex, 2, 2), String.slice(hex, 4, 2)}
    [r, g, b] = Enum.map([r, g, b], &elem(Integer.parse(&1, 16), 0))
    0.2126 * r + 0.7152 * g + 0.0722 * b
  end

  defp generator(categories, cat_key, gen_key) do
    categories |> by_key() |> Map.fetch!(cat_key) |> Map.fetch!(:generators) |> Enum.find(&(&1.key == gen_key))
  end

  describe "seed/0" do
    test "creates every category and generator, and reports what it wrote" do
      assert {5, 17} = GeneratorSource.seed()

      categories = Catalog.list_generator_categories()
      assert Enum.map(categories, & &1.key) == ~w(forest town city cave temple)
      assert Enum.map(categories, & &1.name) == ["Forest", "Town", "City", "Cave", "Temple"]
      assert Enum.sum(Enum.map(categories, &length(&1.generators))) == 7
    end

    test "categories come back in MENU order, not insertion or alphabetical order" do
      GeneratorSource.seed()
      keys = Catalog.list_generator_categories() |> Enum.map(& &1.key)

      assert keys == ~w(forest town city cave temple)
      refute keys == Enum.sort(keys)
    end

    test "a forest lists the three KINDS of forest, and nothing that is only a variation of one" do
      GeneratorSource.seed()
      cats = Catalog.list_generator_categories() |> by_key()

      # Order matters and is asserted, because the category's FIRST preset is the one the panel opens on.
      # Alexander, 2026-09-09: *"the meadow is not a forest, it doesn't look like one"* — every preset here
      # used to be a clearing, so a category called Forest opened on something that was not one.
      assert Enum.map(cats["forest"].generators, & &1.layout) == ["woodland", "jungle", "meadow"]
      assert Enum.map(cats["town"].generators, & &1.key) == ["town_default"]
      assert [%Generator{layout: nil}] = cats["town"].generators
    end

    test "a river is an OPTION on a forest, never a row of its own" do
      GeneratorSource.seed()
      cats = Catalog.list_generator_categories() |> by_key()
      layouts = Enum.map(cats["forest"].generators, & &1.layout)

      # Alexander, 2026-09-10, on the list growing combinatorially: *"we should just have extra options for
      # each template"*. `forest_meadow_river` used to be its own row, which is exactly the growth he named:
      # one boolean doubled the category. The river survives as a toggle, so the count stays at three.
      refute "meadow_river" in layouts
      assert length(layouts) == 3

      for g <- cats["forest"].generators do
        assert Enum.map(g.options, & &1["key"]) == ~w(exits pathways river crossing bridge), "#{g.key} offers #{inspect(g.options)}"
        # Nothing runs by default: no river, and so no crossing either, whatever kind it would be.
        [river, crossing, kind] = Enum.filter(g.options, &(&1["key"] in ~w(river crossing bridge)))
        assert river["default"] == "none", "#{g.key} runs a river by default"
        assert crossing["default"] == false
        assert kind["requires"] == "river"
      end
    end

    test "a crossing DECLARES that it needs a river — the panel does not have to know" do
      GeneratorSource.seed()
      woodland = Catalog.list_generator_categories() |> generator("forest", "forest_woodland")

      [river, crossing, kind] = Enum.filter(woodland.options, &(&1["key"] in ~w(river crossing bridge)))

      # His next ticket was *"rivers need crossings connected to the paths"*. A crossing over dry ground is
      # nonsense, so the row says what it depends on and the editor greys the toggle out from the DATA.
      refute Map.has_key?(river, "requires")
      assert crossing["requires"] == "river"
      assert crossing["type"] == "toggle"
      assert river["type"] == "choice"
      # the kind of crossing needs a river just the same
      assert kind["requires"] == "river"
      assert kind["type"] == "choice"
    end

    test "the river offers each COURSE he named, and random as one of them" do
      GeneratorSource.seed()
      river =
        Catalog.list_generator_categories()
        |> generator("forest", "forest_woodland")
        |> Map.fetch!(:options)
        |> Enum.find(&(&1["key"] == "river"))

      # *"maybe it's traversable, maybe it's dividing the map in two half, maybe it's around the map"*, and
      # *"I want and think the randomness is good"* — random stays, as one choice among the courses.
      assert Enum.map(river["choices"], & &1["key"]) == ~w(none random through divides around)
      assert river["default"] in Enum.map(river["choices"], & &1["key"])
    end

    test "a settlement offers no options at all" do
      GeneratorSource.seed()
      cats = Catalog.list_generator_categories() |> by_key()

      # An empty list, not nil — the column is NOT NULL with a `[]` default, so the frontend can map over
      # it without a guard on every generator it draws.
      for key <- ~w(town city), g <- cats[key].generators do
        assert g.options == [], "#{g.key} carries #{inspect(g.options)}"
      end
    end

    test "every forest, cave and temple says how many EXITS and PATHWAYS it has" do
      GeneratorSource.seed()
      cats = Catalog.list_generator_categories() |> by_key()

      # Alexander, 2026-09-11: *"on temple, cave and forest templates we should have the option to define how
      # many pathways, we want to have"*, and the cave he drew out: *"1 exit and 3 pathways to simulate
      # entrance, then I continue doing the same until I reach a part where is just 1 exit no pathway, which is
      # the end of the cave"*. That is TWO numbers, not one. An exit leaves the map (a connector to the next
      # one), a pathway runs inside it, and a pathway that is not an exit has to end somewhere, which is where
      # a closed or gated section goes.
      for key <- ~w(forest cave temple), g <- cats[key].generators do
        [exits, pathways] = Enum.filter(g.options, &(&1["key"] in ~w(exits pathways)))

        assert exits["type"] == "choice", "#{g.key}"
        assert pathways["type"] == "choice", "#{g.key}"
        # Random by default, so a preset nobody has touched still rolls ways through the map.
        assert exits["default"] == "random", "#{g.key}"
        assert pathways["default"] == "random", "#{g.key}"
        assert Enum.map(exits["choices"], & &1["key"]) == ~w(random 1 2 3 4), "#{g.key}"
        assert Enum.map(pathways["choices"], & &1["key"]) == ~w(random 1 2 3 4), "#{g.key}"
        # Neither depends on anything: the ways are what the map is built around, they are never greyed out.
        refute Map.has_key?(exits, "requires"), "#{g.key}"
        refute Map.has_key?(pathways, "requires"), "#{g.key}"
      end
    end

    test "only the treed layouts state a canopy — a clearing has no tree density to state" do
      GeneratorSource.seed()
      cats = Catalog.list_generator_categories() |> by_key()

      canopies =
        for g <- cats["forest"].generators, into: %{} do
          {g.layout, g.config["nature"]["canopy"]}
        end

      # The woodland layout plants nothing without this and says so, rather than inventing a density —
      # which is also why the random layout pool skips it when a generator does not serve one.
      assert canopies["woodland"] > 0
      assert canopies["meadow"] == nil
    end

    test "a jungle and a woodland are painted from DIFFERENT colours" do
      GeneratorSource.seed()
      cats = Catalog.list_generator_categories() |> by_key()
      pal = for g <- cats["forest"].generators, into: %{}, do: {g.layout, g.config["palette"]}

      # Alexander, 2026-09-10: *"colors should be different"*, *"like there's a huge difference between
      # amazonas and a pines forest"*. Every colour in a forest used to come from the SEASON, so a spring
      # jungle and a spring woodland were painted from the same numbers and looked identical. The assertion
      # is that they SHARE NOTHING, not that either is a particular hex — tune the hexes freely, just never
      # back into agreement.
      assert MapSet.disjoint?(MapSet.new(Map.values(pal["woodland"])), MapSet.new(Map.values(pal["jungle"])))

      # And the one that carries the look: a jungle floor is in permanent shade under a closed canopy, so it
      # is DARKER than the canopy above it. A temperate wood is the other way round.
      assert luminance(pal["jungle"]["floor"]) < luminance(pal["jungle"]["canopy"])
      assert luminance(pal["woodland"]["floor"]) > luminance(pal["woodland"]["canopy"])
    end

    test "every kind of crossing the river offers is served with the tile it lays" do
      # Alexander, 2026-09-11: *"it can be a simple dirt path, it can be an actual bridge, which again, are
      # multiple variations"*.
      GeneratorSource.seed()
      cats = Catalog.list_generator_categories() |> by_key()

      for g <- cats["forest"].generators do
        kind = Enum.find(g.options, &(&1["key"] == "bridge"))
        assert kind, "#{g.key} offers no kind of crossing"
        assert kind["requires"] == "river"
        picks = Enum.map(kind["choices"], & &1["key"]) -- ["random"]
        assert length(picks) >= 3, "#{g.key} offers #{inspect(picks)}, not a dirt path and several bridges"

        for pick <- picks do
          crossing = g.config["crossings"][pick]
          assert is_binary(crossing["tile"]), "#{g.key} offers #{pick} but serves no tile for it"
        end
      end
    end

    test "water reads as WATER: blue that darkens with depth, and only swamp leans green" do
      # Alexander, 2026-09-11: *"I only want light blue for walkable water, different layers of darkblue for the
      # deeper waters and we can have some share of blue-green for swamp ... the green used makes it look like a
      # floor instead of water"*. Asserted as RELATIONSHIPS so the hexes stay free to tune.
      GeneratorSource.seed()
      cats = Catalog.list_generator_categories() |> by_key()

      for g <- cats["forest"].generators, pal = g.config["palette"], pal != nil do
        {r, gr, b} = rgb(pal["water"])
        assert b > r and b > gr, "#{g.key} water is not blue: #{pal["water"]}"
        assert luminance(pal["waterShallow"]) > luminance(pal["water"]), "#{g.key} shallow is not lighter"
        assert luminance(pal["water"]) > luminance(pal["waterDeep"]), "#{g.key} deep is not darker"
        {sr, sg, sb} = rgb(pal["swamp"])
        assert sg > sr and sb > sr, "#{g.key} swamp is not blue-green: #{pal["swamp"]}"
      end
    end

    test "a jungle is a woodland grown over — denser canopy AND far more undergrowth" do
      GeneratorSource.seed()
      cats = Catalog.list_generator_categories() |> by_key()
      nature = for g <- cats["forest"].generators, into: %{}, do: {g.layout, g.config["nature"]}

      # Ticket 48, his words: *"a jungle is not a woodland"*. What makes it one is these numbers, not a
      # separate generator — same clearings, same trails, choked floor. If the two ever read the same the
      # preset is decorative, so the test asserts the GAP rather than the values.
      assert nature["jungle"]["canopy"] > nature["woodland"]["canopy"]
      assert nature["jungle"]["groundCover"] > nature["woodland"]["groundCover"] * 2
      assert nature["jungle"]["flowers"] > nature["woodland"]["flowers"]
    end

    test "every generator runs in every season the editor offers" do
      GeneratorSource.seed()

      for category <- Catalog.list_generator_categories(), g <- category.generators do
        assert g.zones == ~w(spring summer autumn winter desert), "#{g.key} has #{inspect(g.zones)}"
      end
    end

    test "re-seeding is idempotent — no duplicates, and the rows keep their ids" do
      GeneratorSource.seed()
      before = Catalog.list_generator_categories()
      ids = Enum.map(before, & &1.id)

      assert {5, 17} = GeneratorSource.seed()

      again = Catalog.list_generator_categories()
      assert Enum.map(again, & &1.id) == ids
      assert Repo.aggregate(GeneratorCategory, :count) == 5
      assert Repo.aggregate(Generator, :count) == 17
    end

    test "re-seeding REFRESHES a row someone edited by hand" do
      GeneratorSource.seed()
      town = Repo.get_by!(Generator, key: "town_default")
      {:ok, _} = town |> Generator.changeset(%{name: "Hand-edited"}) |> Repo.update()

      GeneratorSource.seed()

      assert Repo.get_by!(Generator, key: "town_default").name == "Town"
      assert Repo.get_by!(Generator, key: "town_default").id == town.id
    end
  end

  describe "the ported numbers (the frontend must be able to stop carrying them)" do
    setup do
      GeneratorSource.seed()
      %{categories: Catalog.list_generator_categories()}
    end

    test "grid: a city is markedly bigger than a town, and both carry the cell geometry", %{categories: cats} do
      town = generator(cats, "town", "town_default").config["grid"]
      city = generator(cats, "city", "city_default").config["grid"]

      assert town == %{"cols" => %{"min" => 30, "max" => 45}, "rows" => %{"min" => 24, "max" => 35}, "cellSize" => 16, "isoScale" => 2.5}
      assert city["cols"] == %{"min" => 52, "max" => 71}
      assert city["rows"] == %{"min" => 42, "max" => 57}
      assert city["cols"]["min"] > town["cols"]["min"]
      assert city["cellSize"] == town["cellSize"]
    end

    test "settlement tuning matches villageLayout's constants exactly", %{categories: cats} do
      assert generator(cats, "town", "town_default").config["settlement"] == %{
               "plazaSize" => 5,
               "setback" => 1,
               "roadWidth" => 4,
               "lotGap" => [1, 2],
               "maxPerFrontage" => 6,
               "buildingCap" => 18,
               "houseRange" => [4, 6],
               "bigHouseRange" => [1, 3],
               "houseWidths" => [3, 3, 4, 4, 4, 5],
               "natureMultiplier" => 1.15
             }

      city = generator(cats, "city", "city_default").config["settlement"]
      assert city["buildingCap"] == 72
      assert city["lotGap"] == [1, 1]
      assert city["maxPerFrontage"] == 99
      assert city["natureMultiplier"] == 0.4
      # A city packs harder than a town on every axis that controls density.
      assert city["buildingCap"] > 18 and city["natureMultiplier"] < 1.15
    end

    test "units: settlements scatter townsfolk, dungeons scatter their own enemies", %{categories: cats} do
      assert generator(cats, "town", "town_default").config["units"] == %{"townsfolk" => 8, "enemies" => 0, "enemyTypes" => []}
      assert generator(cats, "city", "city_default").config["units"]["townsfolk"] == 14
      assert generator(cats, "forest", "forest_meadow").config["units"]["townsfolk"] == 5

      cave = generator(cats, "cave", "cave_default").config["units"]
      temple = generator(cats, "temple", "temple_default").config["units"]
      assert cave == %{"townsfolk" => 0, "enemies" => 10, "enemyTypes" => ~w(bat spider skeleton)}
      assert temple["enemyTypes"] == ~w(skeleton guardian wraith)
    end

    test "a dungeon carries NO settlement or building config — a missing key means it does not do that", %{categories: cats} do
      cave = generator(cats, "cave", "cave_default").config

      refute Map.has_key?(cave, "settlement")
      refute Map.has_key?(cave, "buildings")
      refute Map.has_key?(cave, "nature")
    end

    test "building materials and colours ride with the settlements that place buildings", %{categories: cats} do
      buildings = generator(cats, "town", "town_default").config["buildings"]

      assert buildings["materials"] == ["wall_brick", "wall_wood", "wall_stone"]
      assert buildings["storeRoof"] == "#235a96"
      assert buildings["hospitalRoof"] == "#2f7e50"
      assert length(buildings["roofColors"]) == 4 and length(buildings["wallColors"]) == 5
      assert generator(cats, "forest", "forest_meadow").config["buildings"] == nil
    end

    test "SIZES are absent on purpose — a building's footprint is composition data", %{categories: cats} do
      for category <- cats, g <- category.generators do
        refute Map.has_key?(g.config, "buildingSizes")
        refute get_in(g.config, ["settlement", "buildingDepth"])
      end
    end
  end

  describe "the catalog is a TREE — forest > type > subtype" do
    # Alexander, 2026-09-11: *"forest > type of forest > sub type of type of forest > etc / like maybe it's an
    # island jungle, maybe it's a mountain forest"*.
    setup do
      GeneratorSource.seed()
      %{forest: Catalog.list_generator_categories() |> by_key() |> Map.fetch!("forest")}
    end

    test "each forest type carries its subtypes, and only the top level sits in the category", %{forest: f} do
      assert Enum.map(f.generators, & &1.key) == ~w(forest_woodland forest_jungle forest_meadow)
      subs = Map.new(f.generators, &{&1.key, Enum.map(&1.children, fn c -> c.key end)})
      assert subs["forest_woodland"] == ~w(forest_woodland_beech forest_woodland_dense forest_woodland_mountain forest_woodland_glades)
      assert subs["forest_jungle"] == ~w(forest_jungle_dense forest_jungle_swamp forest_jungle_island forest_jungle_ruins)
      assert subs["forest_meadow"] == ~w(forest_meadow_pasture forest_meadow_open)
    end

    test "a subtype serves its parent's config merged UNDER its own", %{forest: f} do
      woodland = Enum.find(f.generators, &(&1.key == "forest_woodland"))
      mountain = Enum.find(woodland.children, &(&1.key == "forest_woodland_mountain"))

      # its own: the canopy it overrides, and the species
      assert mountain.config["nature"]["canopy"] == 0.28
      assert hd(mountain.config["trees"])["kind"] == "tree_conifer"
      # inherited: everything it did not state, down to the nested keys
      assert mountain.config["nature"]["groundCover"] == woodland.config["nature"]["groundCover"]
      assert mountain.config["grid"] == woodland.config["grid"]
      assert mountain.config["palette"] == woodland.config["palette"]
    end

    test "a list is REPLACED by the subtype, never appended to", %{forest: f} do
      woodland = Enum.find(f.generators, &(&1.key == "forest_woodland"))
      beech = Enum.find(woodland.children, &(&1.key == "forest_woodland_beech"))
      assert Enum.map(beech.config["trees"], & &1["kind"]) == ~w(tree_column tree_tall tree)
    end

    test "options inherit unless a subtype states its own — an island starts ringed by water", %{forest: f} do
      jungle = Enum.find(f.generators, &(&1.key == "forest_jungle"))
      island = Enum.find(jungle.children, &(&1.key == "forest_jungle_island"))
      swamp = Enum.find(jungle.children, &(&1.key == "forest_jungle_swamp"))

      assert Enum.find(island.options, &(&1["key"] == "river"))["default"] == "around"
      assert swamp.options == jungle.options
    end

    test "a swamp jungle is the same regions, mostly swamp", %{forest: f} do
      jungle = Enum.find(f.generators, &(&1.key == "forest_jungle"))
      swamp = Enum.find(jungle.children, &(&1.key == "forest_jungle_swamp"))
      weights = Map.new(swamp.config["subZones"], &{&1["key"], &1["weight"]})
      assert weights["swamp"] > weights["dense"] and weights["dense"] > weights["open"]
      refute Map.has_key?(weights, "ruins")
    end

    test "deleting a type takes its subtypes with it" do
      woodland = Repo.get_by!(Generator, key: "forest_woodland")
      Repo.delete!(woodland)
      refute Repo.get_by(Generator, key: "forest_woodland_beech")
    end
  end

  describe "changesets reject incomplete rows" do
    test "a category needs a key and a name" do
      refute GeneratorCategory.changeset(%GeneratorCategory{}, %{name: "Forest"}).valid?
      refute GeneratorCategory.changeset(%GeneratorCategory{}, %{key: "forest"}).valid?
      assert GeneratorCategory.changeset(%GeneratorCategory{}, %{key: "forest", name: "Forest"}).valid?
    end

    test "a generator needs a category — it cannot float loose" do
      refute Generator.changeset(%Generator{}, %{key: "x", name: "X"}).valid?

      {:ok, cat} = %GeneratorCategory{} |> GeneratorCategory.changeset(%{key: "forest", name: "Forest"}) |> Repo.insert()
      assert Generator.changeset(%Generator{}, %{key: "x", name: "X", category_id: cat.id}).valid?
    end

    test "two generators cannot share a key" do
      GeneratorSource.seed()
      cat = Repo.get_by!(GeneratorCategory, key: "forest")

      assert {:error, changeset} =
               %Generator{}
               |> Generator.changeset(%{key: "town_default", name: "Clash", category_id: cat.id})
               |> Repo.insert()

      assert "has already been taken" in errors_on(changeset).key
    end

    test "deleting a category takes its generators with it (no orphans)" do
      GeneratorSource.seed()
      cat = Repo.get_by!(GeneratorCategory, key: "forest")

      Repo.delete!(cat)

      assert Repo.aggregate(Generator, :count) == 4
      assert Catalog.list_generator_categories() |> Enum.map(& &1.key) == ~w(town city cave temple)
    end
  end
end
