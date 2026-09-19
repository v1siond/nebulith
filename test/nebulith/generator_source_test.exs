defmodule Nebulith.GeneratorSourceTest do
  @moduledoc """
  The map-generator CATALOG is backend data (T-113). These tests exercise the seed the way the app
  does: seed, read back through the context, re-seed, and assert the ported NUMBERS, because the
  whole point of the move is that the frontend stops carrying them.

  The catalog is two tables crossed: a CATEGORY is the terrain kind (wilderness, village, town, city)
  and a TYPE is the environment (woodland, jungle, meadow, swamp, mountain, beach, ruins, desert,
  volcanic). So most of what is asserted here is asserted over the cross product rather than over a row,
  which is the point of generating it: a fact stated once has to hold in thirty-six places.
  """
  use Nebulith.DataCase

  alias Nebulith.Catalog
  alias Nebulith.Catalog.{Generator, GeneratorCategory}
  alias Nebulith.Catalog.GeneratorSource

  # The categories that are built from the environment list. Caves and temples are not.
  @outdoor ~w(wilderness village town city)

  # The regions every wild environment divides itself into, in the order they are served.
  @regions ~w(edge deep glade thicket lakeside)

  defp by_key(categories), do: Map.new(categories, &{&1.key, &1})

  defp rgb("#" <> hex) do
    [r, g, b] = for i <- [0, 2, 4], do: elem(Integer.parse(String.slice(hex, i, 2), 16), 0)
    {r, g, b}
  end

  # Rough perceived brightness of "#rrggbb", enough to assert which of two colours is the darker one.
  defp luminance("#" <> hex) do
    {r, g, b} = {String.slice(hex, 0, 2), String.slice(hex, 2, 2), String.slice(hex, 4, 2)}
    [r, g, b] = Enum.map([r, g, b], &elem(Integer.parse(&1, 16), 0))
    0.2126 * r + 0.7152 * g + 0.0722 * b
  end

  defp generator(categories, cat_key, gen_key) do
    categories |> by_key() |> Map.fetch!(cat_key) |> Map.fetch!(:generators) |> Enum.find(&(&1.key == gen_key))
  end

  # Every generator in the catalog, keyed by its own key.
  defp rows(categories), do: Map.new(Enum.flat_map(categories, & &1.generators), &{&1.key, &1})

  describe "seed/0" do
    test "creates every category and generator, and reports what it wrote" do
      # FOUR categories since the cave and the temple were removed: *"WE CAN REMOVE BOTH BECAUSE THEY SUCK
      # AND WE HAVE TO REDO THE DESIGN FROM SCRATCH LIKE WE DID WITH TOWNS AND FORESTS"*.
      assert {4, 38} = GeneratorSource.seed()

      categories = Catalog.list_generator_categories()
      assert Enum.map(categories, & &1.key) == ~w(wilderness village town city)
      assert Enum.map(categories, & &1.name) == ["Wilderness", "Village", "Town", "City"]
      # nine environments in each of the outdoor categories, plus two standalone city types
      assert Enum.sum(Enum.map(categories, &length(&1.generators))) == 38
    end

    test "categories come back in MENU order, not insertion or alphabetical order" do
      GeneratorSource.seed()
      keys = Catalog.list_generator_categories() |> Enum.map(& &1.key)

      assert keys == ~w(wilderness village town city)
      refute keys == Enum.sort(keys)
    end

    test "a village, a town and a city are their OWN categories, not sizes of one" do
      GeneratorSource.seed()
      cats = Catalog.list_generator_categories() |> by_key()

      # They are fundamentally different places and the difference is architecture. A village is timber and
      # no landmark, a town is brick under a pitched roof, a city is plaster under a flat deck with towers.
      # Size is the grid, so no row here is named for one.
      assert Map.has_key?(cats, "village") and Map.has_key?(cats, "town") and Map.has_key?(cats, "city")
      refute Map.has_key?(cats, "settlement")

      names = for c <- Map.values(cats), g <- c.generators, do: g.name

      for word <- ~w(Small Big Large Standard Modern) do
        refute Enum.any?(names, &String.contains?(&1, word)), "a row is still named by size or by nothing: #{word}"
      end
    end

    test "the SAME environment list runs in wilderness, village, town and city" do
      GeneratorSource.seed()
      cats = Catalog.list_generator_categories() |> by_key()

      # A swamp forest, a swamp village, a swamp town and a swamp city all exist, and they exist because one
      # table is crossed with another rather than because thirty-six rows were typed out.
      assert Enum.map(cats["wilderness"].generators, & &1.name) ==
               ["Woodland", "Jungle", "Meadow", "Swamp", "Mountain", "Beach", "Ruins", "Desert", "Volcanic"]

      for category <- @outdoor do
        present = for g <- cats[category].generators, do: g.name

        for env <- ~w(Woodland Jungle Meadow Swamp Mountain Beach Ruins Desert Volcanic) do
          assert Enum.any?(present, &String.starts_with?(&1, env)), "#{category} has no #{env}"
        end
      end

      # The standalone types are cities and nothing else: no wild volcano of futurism, no medieval village.
      standalone = for g <- cats["city"].generators, g.key in ~w(city_futuristic city_medieval), do: g.name
      assert standalone == ["Futuristic city", "Medieval city"]

      for category <- ~w(wilderness village town) do
        keys = Enum.map(cats[category].generators, & &1.key)
        refute Enum.any?(keys, &String.contains?(&1, "futuristic"))
        refute Enum.any?(keys, &String.contains?(&1, "medieval"))
      end
    end

    test "the rows that said nothing are GONE, and nothing is categorised by size" do
      GeneratorSource.seed()
      all = Catalog.list_generator_categories() |> rows()

      # Each of these was the standard template under another name (a beech stand, glades, an open meadow, a
      # wood pasture, a super dense jungle), a size indicator (a small town), or a word that said nothing
      # about the place (a modern city, which is the Futuristic city now).
      for gone <- ~w(forest_woodland_beech forest_woodland_glades forest_woodland_dense forest_meadow_open
                     forest_meadow_pasture forest_jungle_dense forest_jungle_swamp forest_jungle_island
                     forest_jungle_ruins forest_woodland_mountain town_small town_forest city_modern) do
        refute Map.has_key?(all, gone), "#{gone} is still in the catalog"
      end

      # And nothing is a subtype of anything any more: an environment is a type, and where in it you are is
      # a region of the same map.
      for {key, row} <- all, do: assert(row.children == [], "#{key} still carries subtypes")
    end

    test "a river is an OPTION on a wild map, never a row of its own" do
      GeneratorSource.seed()
      cats = Catalog.list_generator_categories() |> by_key()

      for g <- cats["wilderness"].generators do
        # Every wild environment offers the same region picker now, so every one of them offers the same
        # list: the ways, the region to lead with, and the river.
        assert Enum.map(g.options, & &1["key"]) == ~w(exits pathways region river bridge),
               "#{g.key} offers #{inspect(Enum.map(g.options, & &1["key"]))}"

        [river, kind] = Enum.filter(g.options, &(&1["key"] in ~w(river bridge)))
        assert kind["requires"] == "river"

        # A beach starts ringed by water; nothing else runs a river unless it is asked for.
        expected = if g.key == "forest_beach", do: "around", else: "none"
        assert river["default"] == expected, "#{g.key} starts with river #{river["default"]}"

        # NO DEPTH OPTION. There is no channel to cut: a body of water sits at the level of the ground it
        # covers (WATER.md §1, his correction of 2026-09-16), so nothing asks how deep to dig.
        refute Enum.any?(g.options, &(&1["key"] == "depth")), "#{g.key} still offers a channel depth"
      end
    end

    test "the KIND of crossing declares that it needs a river - the panel does not have to know" do
      GeneratorSource.seed()
      woodland = Catalog.list_generator_categories() |> generator("wilderness", "forest_woodland")

      [river, kind] = Enum.filter(woodland.options, &(&1["key"] in ~w(river bridge)))

      # A crossing over dry ground is nonsense, so the row says what it depends on and the editor greys it
      # out from the DATA.
      refute Map.has_key?(river, "requires")
      assert river["type"] == "choice"
      assert kind["requires"] == "river"
      assert kind["type"] == "choice"
    end

    test "the river offers each COURSE by name, and random as one of them" do
      GeneratorSource.seed()

      river =
        Catalog.list_generator_categories()
        |> generator("wilderness", "forest_woodland")
        |> Map.fetch!(:options)
        |> Enum.find(&(&1["key"] == "river"))

      assert Enum.map(river["choices"], & &1["key"]) == ~w(none random through divides around)
      assert river["default"] in Enum.map(river["choices"], & &1["key"])
    end

    test "a settlement says how many exits it has, and how many STREETS" do
      GeneratorSource.seed()
      cats = Catalog.list_generator_categories() |> by_key()

      # It used to offer nothing, which is why a town ignored the exits and pathways you set.
      for category <- ~w(village town city), g <- cats[category].generators do
        keys = Enum.map(g.options, & &1["key"])
        assert "exits" in keys, "#{g.key} offers no exits"
        assert "pathways" in keys, "#{g.key} offers no pathways"

        exits = Enum.find(g.options, &(&1["key"] == "exits"))
        assert length(exits["choices"]) == 5

        # STREETS GO HIGHER: a street grid carries as many streets as it has room for, so the list offers
        # more than a wild map's four and the engine holds it to what the map measures.
        streets = Enum.find(g.options, &(&1["key"] == "pathways"))
        assert length(streets["choices"]) > 5, "#{g.key} caps its streets at a wild map's four"
      end
    end

    test "every wild map says how many EXITS and PATHWAYS it has" do
      GeneratorSource.seed()
      cats = Catalog.list_generator_categories() |> by_key()

      # TWO numbers, not one. An exit leaves the map (a connector to the next one), a pathway runs inside
      # it, and a pathway that is not an exit has to end somewhere, which is where a gated section goes.
      # The cave and the temple used to be asked the same question here. Both were removed, so the wild maps
      # are what is left that carries these two options.
      for key <- ~w(wilderness), g <- cats[key].generators do
        [exits, pathways] = Enum.filter(g.options, &(&1["key"] in ~w(exits pathways)))

        assert exits["type"] == "choice", "#{g.key}"
        assert pathways["type"] == "choice", "#{g.key}"
        assert exits["default"] == "random", "#{g.key}"
        assert pathways["default"] == "random", "#{g.key}"
        assert Enum.map(exits["choices"], & &1["key"]) == ~w(random 1 2 3 4), "#{g.key}"
        assert Enum.map(pathways["choices"], & &1["key"]) == ~w(random 1 2 3 4), "#{g.key}"
        # Neither depends on anything: the ways are what the map is built around, never greyed out.
        refute Map.has_key?(exits, "requires"), "#{g.key}"
        refute Map.has_key?(pathways, "requires"), "#{g.key}"
      end
    end

    test "only the treed environments state a canopy, a clearing has no tree density to state" do
      GeneratorSource.seed()
      all = Catalog.list_generator_categories() |> rows()

      # A layout plants nothing without this and says so, rather than inventing a density.
      assert all["forest_woodland"].config["nature"]["canopy"] > 0
      assert all["forest_jungle"].config["nature"]["canopy"] > 0
      assert all["forest_meadow"].config["nature"]["canopy"] == nil
    end

    test "a jungle and a woodland are painted from DIFFERENT colours" do
      GeneratorSource.seed()
      all = Catalog.list_generator_categories() |> rows()
      pal = for key <- ~w(forest_woodland forest_jungle), into: %{}, do: {key, all[key].config["palette"]}

      # Every colour in a forest used to come from the SEASON, so a spring jungle and a spring woodland were
      # painted from the same numbers. The assertion is that they SHARE NOTHING, not that either is a
      # particular hex. Tune the hexes freely, just never back into agreement.
      assert MapSet.disjoint?(
               MapSet.new(Map.values(pal["forest_woodland"])),
               MapSet.new(Map.values(pal["forest_jungle"]))
             )

      # And the one that carries the look: a jungle floor is in permanent shade under a closed canopy, so it
      # is DARKER than the canopy above it. A temperate wood is the other way round.
      assert luminance(pal["forest_jungle"]["floor"]) < luminance(pal["forest_jungle"]["canopy"])
      assert luminance(pal["forest_woodland"]["floor"]) > luminance(pal["forest_woodland"]["canopy"])
    end

    test "every kind of crossing the river offers is served with the tile it lays" do
      GeneratorSource.seed()
      cats = Catalog.list_generator_categories() |> by_key()

      for g <- cats["wilderness"].generators do
        kind = Enum.find(g.options, &(&1["key"] == "bridge"))
        assert kind, "#{g.key} offers no kind of crossing"
        assert kind["requires"] == "river"
        # `random` and `none` are ANSWERS, not kinds: one defers the choice and the other declines it, so
        # neither names a crossing and neither has a tile to serve. Every kind that IS one does.
        picks = Enum.map(kind["choices"], & &1["key"]) -- ["random", "none"]
        assert length(picks) >= 3, "#{g.key} offers #{inspect(picks)}, not a dirt path and several bridges"

        for pick <- picks do
          crossing = g.config["crossings"][pick]
          assert is_binary(crossing["tile"]), "#{g.key} offers #{pick} but serves no tile for it"
        end

        # AND NO BRIDGE IS OFFERABLE. A river left uncrossed is a map, and it used to happen only by accident.
        assert "none" in Enum.map(kind["choices"], & &1["key"]), "#{g.key} cannot be asked for no bridge"
        refute g.config["crossings"]["none"], "#{g.key} serves a crossing for the refusal"

      end
    end

    test "water reads as WATER: blue that darkens with depth, and only swamp leans green" do
      # Asserted as RELATIONSHIPS so the hexes stay free to tune.
      GeneratorSource.seed()
      cats = Catalog.list_generator_categories() |> by_key()

      for g <- cats["wilderness"].generators, pal = g.config["palette"], pal != nil do
        {r, gr, b} = rgb(pal["water"])
        assert b > r and b > gr, "#{g.key} water is not blue: #{pal["water"]}"
        assert luminance(pal["waterShallow"]) > luminance(pal["water"]), "#{g.key} shallow is not lighter"
        assert luminance(pal["water"]) > luminance(pal["waterDeep"]), "#{g.key} deep is not darker"
        {sr, sg, sb} = rgb(pal["swamp"])
        assert sg > sr and sb > sr, "#{g.key} swamp is not blue-green: #{pal["swamp"]}"
      end
    end

    test "a jungle is a woodland grown over - its floor BLOCKS where a wood's floor is grass" do
      GeneratorSource.seed()
      all = Catalog.list_generator_categories() |> rows()

      # A wood's understory is `tall_grass`, which you walk through. A jungle's is `thicket`, which stops
      # you, and it plants far more of it. A jungle with FEWER trees than a wood is still a jungle; one
      # whose floor you can stroll across is not.
      jungle = all["forest_jungle"].config
      woodland = all["forest_woodland"].config

      assert jungle["formation"]["understoryTile"] == "thicket", "a jungle floor has to block"
      assert woodland["formation"]["understoryTile"] == "tall_grass", "a wood floor has to be walkable"
      assert jungle["formation"]["understory"] > woodland["formation"]["understory"] * 2
      # and it still grows more flowers, which is the one nature number that always did separate them
      assert jungle["nature"]["flowers"] > woodland["nature"]["flowers"]
    end

    test "a generator runs in seasons the editor offers, and narrows them when its climate implies one" do
      GeneratorSource.seed()

      # A row may narrow its own list; what must hold is that it names at least one season and never invents
      # one the editor cannot offer.
      offered = MapSet.new(~w(spring summer autumn winter desert))
      cats = Catalog.list_generator_categories()

      for category <- cats, g <- category.generators do
        assert g.zones != [], "#{g.key} runs in no season at all"

        assert MapSet.subset?(MapSet.new(g.zones), offered),
               "#{g.key} names a season the editor cannot offer: #{inspect(g.zones)}"
      end

      all = rows(cats)

      # A climate really does narrow the seasons, and it does it for EVERY category the environment runs in:
      # a swamp does not freeze over whether people live in it or not.
      for key <- ~w(forest_swamp village_swamp town_swamp city_swamp) do
        assert all[key].zones == ["spring", "summer"], "#{key} freezes over"
      end

      for key <- ~w(forest_desert village_desert town_desert city_desert) do
        assert all[key].zones == ["summer", "desert"], "#{key} runs in seasons a desert does not have"
      end

      # and a place with no implied climate still runs in all of them
      assert MapSet.new(all["forest_woodland"].zones) == offered
    end

    test "re-seeding is idempotent: no duplicates, and the rows keep their ids" do
      GeneratorSource.seed()
      before = Catalog.list_generator_categories()
      ids = Enum.map(before, & &1.id)

      assert {4, 38} = GeneratorSource.seed()

      again = Catalog.list_generator_categories()
      assert Enum.map(again, & &1.id) == ids
      assert Repo.aggregate(GeneratorCategory, :count) == 4
      assert Repo.aggregate(Generator, :count) == 38
    end

    test "re-seeding REFRESHES a row someone edited by hand" do
      GeneratorSource.seed()
      town = Repo.get_by!(Generator, key: "town")
      {:ok, _} = town |> Generator.changeset(%{name: "Hand-edited"}) |> Repo.update()

      GeneratorSource.seed()

      assert Repo.get_by!(Generator, key: "town").name == "Woodland town"
      assert Repo.get_by!(Generator, key: "town").id == town.id
    end
  end

  describe "the sub-zones, where in a place you are" do
    setup do
      GeneratorSource.seed()
      %{categories: Catalog.list_generator_categories()}
    end

    test "every wild environment divides into the SAME five regions", %{categories: cats} do
      for g <- by_key(cats)["wilderness"].generators do
        assert Enum.map(g.config["subZones"], & &1["key"]) == @regions, "#{g.key} has its own region set"

        # and the picker offers exactly them, plus random
        region = Enum.find(g.options, &(&1["key"] == "region"))
        assert Enum.map(region["choices"], & &1["key"]) == ["random" | @regions], "#{g.key}"
      end
    end

    test "each environment colours those regions with its OWN floors and species", %{categories: cats} do
      wild = by_key(cats)["wilderness"].generators

      # The shape of a region is shared and its LOOK is not: that is the difference between reusing a sub
      # zone and every forest being the same forest. No two environments paint the five floors alike.
      floors = for g <- wild, do: Enum.map(g.config["subZones"], & &1["floor"])
      assert length(Enum.uniq(floors)) == length(wild) - 2, "environments share a floor set"

      # and the species differ too: a beach grows palms in its deep wood where a mountain grows conifers
      species = fn key, region ->
        g = Enum.find(wild, &(&1.key == key))
        g.config["subZones"] |> Enum.find(&(&1["key"] == region)) |> Map.fetch!("trees") |> Enum.map(& &1["kind"])
      end

      assert "tree_conifer" in species.("forest_mountain", "deep")
      assert "tree_coconut" in species.("forest_beach", "edge")
      assert "tree_cypress" in species.("forest_swamp", "lakeside")
      refute "tree_conifer" in species.("forest_beach", "deep")
    end

    test "the deep wood is the thick part and the glade is the thin one, everywhere", %{categories: cats} do
      # A region's canopy is a MULTIPLIER of the row's, so this ordering has to hold in every environment or
      # the names are lying about what you walk into.
      for g <- by_key(cats)["wilderness"].generators do
        canopy = Map.new(g.config["subZones"], &{&1["key"], &1["canopy"]})

        assert canopy["deep"] > canopy["edge"], "#{g.key}: its deep wood is thinner than its margin"
        assert canopy["edge"] > canopy["glade"], "#{g.key}: its margin is thinner than its glade"

        # and the lakeside is the only region standing in water
        pools = Map.new(g.config["subZones"], &{&1["key"], &1["pools"]})
        assert pools["lakeside"] > 0, "#{g.key} has a lakeside with no water in it"
        assert Enum.count(pools, fn {_k, v} -> v != nil end) == 1, "#{g.key} floods more than its lakeside"
      end
    end

    test "a swamp and a ruin are TYPES now, not corners of a rainforest", %{categories: cats} do
      all = rows(cats)

      # They were regions of the jungle, which is why a swamp was something you found inside a rainforest
      # rather than somewhere you could generate, and why neither ever got a village or a city.
      refute Enum.any?(all["forest_jungle"].config["subZones"], &(&1["key"] in ~w(swamp ruins)))

      for key <- ~w(forest_swamp village_swamp town_swamp city_swamp forest_ruins village_ruins town_ruins city_ruins) do
        assert Map.has_key?(all, key), "#{key} does not exist"
      end

      # a ruin carries its fallen masonry on every region, because the ruin is the whole place now
      for z <- all["forest_ruins"].config["subZones"], do: assert(z["stone"] > 0)
      refute Enum.any?(all["forest_woodland"].config["subZones"], &Map.has_key?(&1, "stone"))
    end

    test "every city has upper, middle and lower class neighbourhoods", %{categories: cats} do
      for g <- by_key(cats)["city"].generators do
        assert Enum.map(g.config["subZones"], & &1["key"]) == ~w(upper middle lower), "#{g.key}"

        region = Enum.find(g.options, &(&1["key"] == "region"))

        assert Enum.map(region["choices"], & &1["label"]) ==
                 ["Random", "Upper class neighbourhood", "Middle class neighbourhood", "Lower class neighbourhood"],
               "#{g.key}"
      end
    end

    test "the class neighbourhoods differ by ARCHITECTURE, not by a tint", %{categories: cats} do
      zones = generator(cats, "city", "city").config["subZones"]
      looks = for z <- zones, b = z["buildings"], do: {z["key"], hd(b["materials"]), b["roof"]}

      # Money buys a different house, not the same house in another colour, so each neighbourhood owns its
      # wall material and its roof outright.
      pairs = for {_key, material, roof} <- looks, do: {material, roof}
      assert length(Enum.uniq(pairs)) == 3, "two neighbourhoods build the same thing: #{inspect(looks)}"

      for z <- zones do
        b = z["buildings"]
        assert b["materials"] != [], "#{z["key"]} states no material"
        assert length(b["roofColors"]) == 3 and length(b["wallColors"]) == 3, "#{z["key"]}"
      end
    end

    test "only a place with RELIEF states a level", %{categories: cats} do
      levelled =
        for category <- cats, g <- category.generators, z <- g.config["subZones"] || [], z["level"] not in [nil, 0], do: g.key

      # A mountain is built at different heights and the step between two regions is a cliff. Its volcanic
      # placeholder runs on the same numbers, so it climbs too. Nothing else does, and a settlement does
      # not: a city divides itself by money, not by altitude.
      assert Enum.uniq(levelled) |> Enum.sort() == ~w(forest_mountain forest_volcanic)

      levels = Map.new(generator(cats, "wilderness", "forest_mountain").config["subZones"], &{&1["key"], &1["level"]})

      # Three DISTINCT levels, or the regions are just three colours of flat ground. The ridge is the glade
      # up at the top where nothing grows; the vale is the deep wood at the bottom where everything does.
      assert length(Enum.uniq(Map.values(levels))) == 3
      assert levels["glade"] > levels["edge"] and levels["edge"] > levels["deep"]
    end
  end

  describe "the ported numbers (the frontend must be able to stop carrying them)" do
    setup do
      GeneratorSource.seed()
      %{categories: Catalog.list_generator_categories()}
    end

    test "grid: a city is markedly bigger than a town, and both carry the cell geometry", %{categories: cats} do
      town = generator(cats, "town", "town").config["grid"]
      city = generator(cats, "city", "city").config["grid"]

      assert town == %{"cols" => %{"min" => 30, "max" => 45}, "rows" => %{"min" => 24, "max" => 35}, "cellSize" => 16, "isoScale" => 2.5}
      assert city["cols"] == %{"min" => 52, "max" => 71}
      assert city["rows"] == %{"min" => 42, "max" => 57}
      assert city["cols"]["min"] > town["cols"]["min"]
      assert city["cellSize"] == town["cellSize"]
    end

    test "settlement tuning matches villageLayout's constants exactly", %{categories: cats} do
      assert generator(cats, "town", "town").config["settlement"] == %{
               "plazaSize" => 5,
               "setback" => 1,
               "roadWidth" => 4,
               "lotGap" => [1, 2],
               "maxPerFrontage" => 6,
               "buildingCap" => 18,
               "houseRange" => [4, 6],
               "houseWidths" => [3, 3, 4, 4, 4, 5, 6],
               "natureMultiplier" => 1.3,
               "mix" => [
                 %{"type" => "store", "count" => [1, 1]},
                 %{"type" => "hospital", "count" => [1, 1]},
                 %{"type" => "temple", "count" => [1, 1]},
                 %{"type" => "church", "count" => [1, 1]},
                 %{"type" => "stable", "count" => [1, 2]},
                 %{"type" => "barn", "count" => [1, 2]},
                 %{"type" => "smithy", "count" => [1, 1]},
                 %{"type" => "house", "count" => [1, 3]}
               ],
               "streets" => "path_stone"
             }

      city = generator(cats, "city", "city").config["settlement"]
      assert city["buildingCap"] == 72
      assert city["lotGap"] == [1, 1]
      assert city["maxPerFrontage"] == 99
      assert city["natureMultiplier"] == 0.5
      # A city packs harder than a town on every axis that controls density.
      assert city["buildingCap"] > 18 and city["natureMultiplier"] < 1.15
    end

    test "a village, a town and a city are built to different NUMBERS", %{categories: cats} do
      tuning = for k <- ~w(village town city), do: generator(cats, k, "#{k}_woodland") || generator(cats, k, k)
      [village, town, city] = Enum.map(tuning, & &1.config["settlement"])

      # Not sizes of one place: a village is fewer, looser, greener buildings on narrower lanes, a city is
      # the opposite on all four counts. The grid decides how big the map is, these decide what is on it.
      assert village["buildingCap"] < town["buildingCap"] and town["buildingCap"] < city["buildingCap"]
      assert village["natureMultiplier"] > town["natureMultiplier"]
      assert town["natureMultiplier"] > city["natureMultiplier"]
      assert village["roadWidth"] < town["roadWidth"]
      assert hd(village["houseRange"]) < hd(city["houseRange"])
    end

    test "every place is made of DIFFERENT buildings, not the same ones in another colour", %{categories: cats} do
      places =
        for {key, row} <- rows(cats), mix = get_in(row.config, ["settlement", "mix"]), mix != nil, into: %{} do
          {key, Enum.map(mix, & &1["type"])}
        end

      assert map_size(places) == 29, "expected nine environments in three kinds plus two standalone cities"

      # The civic pair every settlement has, whatever it is: `mix/2` prepends it.
      for {key, list} <- places do
        assert "store" in list and "hospital" in list, "#{key} lost its store or hospital"
      end

      # The grand TEMPLE landmark rides with a town and a city. A village is rural and has no landmark.
      assert "temple" in places["town"]
      assert "temple" in places["city"]
      refute "temple" in places["village_woodland"]

      # A village and a town build their OWN things and never a tower.
      for {key, list} <- places, String.starts_with?(key, "village_") or String.starts_with?(key, "town") do
        assert Enum.any?(list, &(&1 in ~w(stable barn smithy church manor))), "#{key} has none of its own buildings"
        refute "tower" in list, "#{key} is not a city and has a tower in it"
      end

      # And a city builds at least one of its own, with none of a town's farm buildings.
      for {key, list} <- places, String.starts_with?(key, "city") do
        assert Enum.any?(list, &(&1 in ~w(tower apartment office cathedral castle))), "#{key} has none of a city's own buildings"
        refute "stable" in list, "#{key} is a city with a stable in it"
        refute "barn" in list, "#{key} is a city with a barn in it"
      end

      # An ENVIRONMENT changes the list too, and it changes it the same way in every kind: there is no
      # pasture in a swamp and nothing to keep in one, and a seafront asks for more than one store.
      for kind <- ~w(village town city) do
        swamp = places[if(kind == "town", do: "town_swamp", else: "#{kind}_swamp")]
        refute "barn" in swamp, "a #{kind} in a swamp keeps a barn"
        refute "stable" in swamp, "a #{kind} in a swamp keeps a stable"
      end

      beach = generator(cats, "town", "town_beach").config["settlement"]["mix"]
      assert Enum.find(beach, &(&1["type"] == "store"))["count"] == [2, 3]

      # The two standalone types: the futuristic city is the tall one, the medieval city is a city with
      # nothing tall in it at all.
      assert "tower" in places["city_futuristic"] and "apartment" in places["city_futuristic"]
      refute "tower" in places["city_medieval"]
      refute "apartment" in places["city_medieval"]
      assert "cathedral" in places["city_medieval"]
    end

    test "a settlement paves with what the place is made of", %{categories: cats} do
      streets = for {key, row} <- rows(cats), s = get_in(row.config, ["settlement", "streets"]), into: %{}, do: {key, s}

      # Every street used to be painted `road` whatever the place was. The surface is derived from the row's
      # own pathway now, so a settlement's streets and its ways cannot disagree.
      assert streets["town"] == "path_stone"
      assert streets["city"] == "road"
      assert streets["village_woodland"] == "path_dirt"

      # and the environment changes it: a mountain cobbles, a beach has dirt tracks, a swamp boardwalks.
      assert streets["town_mountain"] == "cobblestone"
      assert streets["town_beach"] == "path_dirt"
      assert streets["town_swamp"] == "wooden_planks"
      assert streets["city_swamp"] == "wooden_planks"
      assert streets["city_medieval"] == "cobblestone"

      # Nothing may ask for a ground the tilesets do not carry, or the street paints as nothing at all.
      real = ~w(road road_center road_edge path_stone path_dirt cobblestone snow_path desert_road bridge
                wooden_planks courtyard_stone plaza marble gravel)

      for {key, ground} <- streets do
        assert ground in real, "#{key} paves with #{inspect(ground)}, which no tileset carries"
      end
    end

    test "a region's floor is the same kind of fact as a template's density", %{categories: cats} do
      # The deep wood has to be thicker underfoot than the glade in the same map, because the undergrowth
      # multiplier is what makes the two read as different ground rather than as two colours.
      for g <- by_key(cats)["wilderness"].generators do
        zones = Map.new(g.config["subZones"], &{&1["key"], &1})

        assert zones["thicket"]["undergrowth"] > zones["glade"]["undergrowth"], "#{g.key}"
        assert zones["deep"]["formation"]["understory"] > zones["glade"]["formation"]["understory"], "#{g.key}"
        # never 1: claiming only the four orthogonal neighbours leaves a checkerboard the floor repair has
        # to cut through the whole wood to fix
        for {key, z} <- zones, do: refute(z["formation"]["spacing"] == 1, "#{g.key}/#{key} spaces trees at 1")
      end
    end

    test "units: settlements scatter townsfolk, dungeons scatter their own enemies", %{categories: cats} do
      assert generator(cats, "town", "town").config["units"] == %{"townsfolk" => 8, "enemies" => 0, "enemyTypes" => []}
      assert generator(cats, "city", "city").config["units"]["townsfolk"] == 14
      assert generator(cats, "village", "village_woodland").config["units"]["townsfolk"] == 6
      assert generator(cats, "wilderness", "forest_meadow").config["units"]["townsfolk"] == 5
      # a standalone type may say how many people live in it
      assert generator(cats, "city", "city_futuristic").config["units"]["townsfolk"] == 16

      # The cave and the temple carried the "scatters its own enemies" half of this and were removed, so what
      # is left to assert is that a settlement's own enemy list is empty rather than absent.
      assert generator(cats, "city", "city").config["units"]["enemies"] == 0
    end

    # REPLACES "a dungeon carries NO settlement or building config". The rule is the one worth keeping, a
    # missing key means the generator does not do that thing, rather than a key full of zeroes. The dungeon
    # was the example and it is gone, so a WILD map is asked instead: it grows trees and holds units, and it
    # has no settlement and puts up no buildings.
    test "a key that is absent means the generator does not do that thing", %{categories: cats} do
      wild = generator(cats, "wilderness", "forest_meadow").config

      refute Map.has_key?(wild, "settlement")
      refute Map.has_key?(wild, "buildings")
      # …and the ones it DOES do are present, or the refutes above would pass on an empty map.
      assert Map.has_key?(wild, "nature")
      assert Map.has_key?(wild, "units")
    end

    test "building materials and colours ride with the settlements that place buildings", %{categories: cats} do
      buildings = generator(cats, "town", "town").config["buildings"]

      assert buildings["materials"] == ["wall_brick", "wall_wood"]
      assert buildings["storeRoof"] == "#235a96"
      assert buildings["hospitalRoof"] == "#2f7e50"
      assert length(buildings["roofColors"]) == 3 and length(buildings["wallColors"]) == 3
      assert generator(cats, "wilderness", "forest_meadow").config["buildings"] == nil
    end

    test "each KIND of settlement owns its own material and its own roof", %{categories: cats} do
      # A kind that shares its wall family AND its roof with another kind is the bug: three categories that
      # build the same house in three colours.
      looks =
        for {key, row} <- [{"village", "village_woodland"}, {"town", "town"}, {"city", "city"}] do
          b = generator(cats, key, row).config["buildings"]
          assert b["roof"] in ~w(roof roof_slate flat_roof), "#{row} lays #{inspect(b["roof"])}"
          assert b["materials"] != [], "#{row} states no materials"
          {row, hd(b["materials"]), b["roof"]}
        end

      pairs = Enum.map(looks, fn {_row, material, roof} -> {material, roof} end)
      assert length(Enum.uniq(pairs)) == 3, "two kinds are the same material on the same roof: #{inspect(looks)}"
      # a village builds in timber and a city does not build in timber at all
      assert {"village_woodland", "wall_wood", "roof"} in looks
      assert Enum.any?(looks, fn {_r, material, _roof} -> material == "wall_plaster" end)
    end

    test "an ENVIRONMENT repaints a settlement, in every kind it runs in", %{categories: cats} do
      all = rows(cats)

      # The same fact stated once: a mountain builds in stone under slate whether it is a village, a town or
      # a city, and a swamp builds in timber in all three.
      for key <- ~w(village_mountain town_mountain city_mountain) do
        assert all[key].config["buildings"]["roof"] == "roof_slate", "#{key}"
        assert all[key].config["buildings"]["materials"] == ["wall_stone"], "#{key}"
      end

      for key <- ~w(village_swamp town_swamp city_swamp) do
        assert all[key].config["buildings"]["materials"] == ["wall_wood"], "#{key}"
      end

      # and it repaints the nature with it: a beach is bare and a swamp is choked, whoever lives there
      assert all["city_beach"].config["nature"]["groundCover"] < all["city"].config["nature"]["groundCover"]
      assert all["town_swamp"].config["nature"]["groundCover"] > all["town"].config["nature"]["groundCover"]
      assert all["town_beach"].config["settlement"]["natureMultiplier"] < all["town"].config["settlement"]["natureMultiplier"]
    end

    test "SIZES are absent on purpose: a building's footprint is composition data", %{categories: cats} do
      for category <- cats, g <- category.generators do
        refute Map.has_key?(g.config, "buildingSizes")
        refute get_in(g.config, ["settlement", "buildingDepth"])
      end
    end
  end

  describe "changesets reject incomplete rows" do
    test "a category needs a key and a name" do
      refute GeneratorCategory.changeset(%GeneratorCategory{}, %{name: "Wilderness"}).valid?
      refute GeneratorCategory.changeset(%GeneratorCategory{}, %{key: "wilderness"}).valid?
      assert GeneratorCategory.changeset(%GeneratorCategory{}, %{key: "wilderness", name: "Wilderness"}).valid?
    end

    test "a generator needs a category, it cannot float loose" do
      refute Generator.changeset(%Generator{}, %{key: "x", name: "X"}).valid?

      {:ok, cat} = %GeneratorCategory{} |> GeneratorCategory.changeset(%{key: "wilderness", name: "Wilderness"}) |> Repo.insert()
      assert Generator.changeset(%Generator{}, %{key: "x", name: "X", category_id: cat.id}).valid?
    end

    test "two generators cannot share a key" do
      GeneratorSource.seed()
      cat = Repo.get_by!(GeneratorCategory, key: "wilderness")

      assert {:error, changeset} =
               %Generator{}
               |> Generator.changeset(%{key: "town", name: "Clash", category_id: cat.id})
               |> Repo.insert()

      assert "has already been taken" in errors_on(changeset).key
    end

    test "deleting a category takes its generators with it (no orphans)" do
      GeneratorSource.seed()
      cat = Repo.get_by!(GeneratorCategory, key: "wilderness")
      # Counted, not typed: the number of environments changes every time one is added.
      total = Repo.aggregate(Generator, :count)
      wild_rows = cat |> Repo.preload(:generators) |> Map.fetch!(:generators) |> length()

      Repo.delete!(cat)

      assert Repo.aggregate(Generator, :count) == total - wild_rows
      assert Catalog.list_generator_categories() |> Enum.map(& &1.key) == ~w(village town city)
    end
  end
end
