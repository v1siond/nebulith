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

  defp generator(categories, cat_key, gen_key) do
    categories |> by_key() |> Map.fetch!(cat_key) |> Map.fetch!(:generators) |> Enum.find(&(&1.key == gen_key))
  end

  describe "seed/0" do
    test "creates every category and generator, and reports what it wrote" do
      assert {5, 7} = GeneratorSource.seed()

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
        assert Enum.map(g.options, & &1["key"]) == ~w(river crossing), "#{g.key} offers #{inspect(g.options)}"
        assert Enum.all?(g.options, &(&1["default"] == false)), "#{g.key} opts something in by default"
      end
    end

    test "a crossing DECLARES that it needs a river — the panel does not have to know" do
      GeneratorSource.seed()
      woodland = Catalog.list_generator_categories() |> generator("forest", "forest_woodland")

      [river, crossing] = woodland.options

      # His next ticket was *"rivers need crossings connected to the paths"*. A crossing over dry ground is
      # nonsense, so the row says what it depends on and the editor greys the toggle out from the DATA.
      refute Map.has_key?(river, "requires")
      assert crossing["requires"] == "river"
      assert crossing["type"] == "toggle" and river["type"] == "toggle"
    end

    test "a settlement or a dungeon offers no options at all" do
      GeneratorSource.seed()
      cats = Catalog.list_generator_categories() |> by_key()

      # An empty list, not nil — the column is NOT NULL with a `[]` default, so the frontend can map over
      # it without a guard on every generator it draws.
      for key <- ~w(town city cave temple), g <- cats[key].generators do
        assert g.options == [], "#{g.key} carries #{inspect(g.options)}"
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

      assert {5, 7} = GeneratorSource.seed()

      again = Catalog.list_generator_categories()
      assert Enum.map(again, & &1.id) == ids
      assert Repo.aggregate(GeneratorCategory, :count) == 5
      assert Repo.aggregate(Generator, :count) == 7
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
