defmodule Nebulith.Catalog.ABiomeHasItsOwnRegionsTest do
  @moduledoc """
  A BARE SEED GIVES EVERY BIOME ITS OWN REGIONS.

  `docs/REGIONS.md` §1.1: the set belongs to the BIOME. A swamp's sections are not a wood's, and a volcano
  offering you a "Glade" is a map that has not been described yet.

  The sets were authored in data migrations that ran `UPDATE generators SET config = jsonb_set(config,
  '{subZones}', ...)` on top of what `GeneratorSource.seed/0` had just written. The seeder writes that whole
  `config` column from its own literal, so one fact had two owners: every re-seed put the generic wood's five
  regions back on all nine biomes, and ten migrations' worth of region work disappeared. More than once, with
  nothing in the code having changed either time.

  This is the gate. It seeds and nothing else, and it fails on a seeder that does not state the sets itself.
  """
  use Nebulith.DataCase

  alias Nebulith.Catalog
  alias Nebulith.Catalog.GeneratorSource

  # The generic wood's five. A biome serving these is a biome nobody has described.
  @generic ~w(edge deep glade thicket lakeside)

  setup do
    GeneratorSource.seed()

    wild =
      Catalog.list_generator_categories()
      |> Enum.flat_map(& &1.generators)
      |> Enum.filter(&String.starts_with?(&1.key, "forest_"))

    %{wild: wild}
  end

  defp regions(gen), do: Map.get(gen.config, "subZones", [])
  defp keys(gen), do: Enum.map(regions(gen), & &1["key"])

  describe "the set belongs to the biome" do
    test "every wild biome states its own regions, none of them the generic wood's", %{wild: wild} do
      assert length(wild) >= 9, "only #{length(wild)} wild biomes, so this run proves little"

      for gen <- wild do
        assert keys(gen) != [], "#{gen.key} serves no regions at all"

        refute keys(gen) == @generic,
               "#{gen.key} serves the generic wood's five (#{Enum.join(@generic, ", ")}), so its map is " <>
                 "a wood wearing this biome's colours"
      end
    end

    test "and no two biomes are the same place twice", %{wild: wild} do
      sets = Map.new(wild, &{&1.key, keys(&1)})
      distinct = sets |> Map.values() |> Enum.uniq() |> length()

      assert distinct == map_size(sets),
             "#{map_size(sets) - distinct} biomes share a region set with another: #{inspect(sets)}"
    end
  end

  describe "what a region promises, the map has" do
    test "a region named for water carries some", %{wild: wild} do
      # *"we have a section called 'lakeside' and there's no fucking lake lol"*. A region whose NAME is about
      # water and which serves no `pools` is the one place on the map guaranteed not to have any.
      watery = ~w(streamside varzea lavaside oasis bank margin mire bog sink open_water)

      for gen <- wild, region <- regions(gen), region["key"] in watery do
        assert is_number(region["pools"]) and region["pools"] > 0,
               "#{gen.key}/#{region["key"]} is named for water and serves pools=#{inspect(region["pools"])}"
      end
    end

    test "every biome has somewhere its water can be", %{wild: wild} do
      # Not every biome needs standing water (a mountain does not, and a beach has the sea instead), but a
      # biome that serves none anywhere should be saying so on purpose rather than by omission.
      dry = for gen <- wild, Enum.all?(regions(gen), &(&1["pools"] in [nil, 0])), do: gen.key

      assert dry -- ~w(forest_mountain forest_beach forest_ruins) == [],
             "these biomes have nowhere for standing water: #{inspect(dry)}"
    end
  end

  describe "how the set is laid out" do
    test "the arrangement is served with the set, so a re-seed cannot flatten it", %{wild: wild} do
      for gen <- wild do
        assert Map.get(gen.config, "regionLayout") in ~w(scatter rings bands),
               "#{gen.key} serves no arrangement, so its set falls back to a scatter " <>
                 "(a volcano is rings and a mountain is bands, REGIONS.md §2)"
      end

      # …and at least one of each of the ordered ones, or the arrangements are decoration.
      laid = Enum.map(wild, &Map.get(&1.config, "regionLayout"))
      assert "rings" in laid, "nothing is laid out as rings, and a volcano and a ruin both are"

      assert "bands" in laid,
             "nothing is laid out as bands, and a mountain, a beach and a swamp all are"
    end
  end

  describe "the picker offers what the map is made of" do
    test "a region option lists this biome's own regions", %{wild: wild} do
      for gen <- wild do
        picker = Enum.find(gen.options, &(&1["key"] == "region"))
        assert picker, "#{gen.key} offers no region picker"

        offered = picker["choices"] |> Enum.map(& &1["key"]) |> Enum.reject(&(&1 == "random"))

        assert offered == keys(gen),
               "#{gen.key} offers #{inspect(offered)} but is made of #{inspect(keys(gen))}, so the panel " <>
                 "names places this map does not have"
      end
    end
  end

  describe "a place people live in is made of places too" do
    test "every settlement states its own regions, and a picker to choose them" do
      # Measured against the captured `/api/generators` the frontend tests run on: a town served
      # `centre / lanes / green / market / outskirts` and a village `huts / commons / plots / edge`, and the
      # seeder served NEITHER, because both sets were authored in a migration that ran on top of it. So a
      # village came out as one uniform sprawl of huts with no commons and no garden plots, and neither had
      # a region picker at all, since the picker is built from the set.
      settled =
        Catalog.list_generator_categories()
        |> Enum.reject(&(&1.key == "wilderness"))
        |> Enum.flat_map(& &1.generators)

      assert length(settled) >= 28,
             "only #{length(settled)} settlements, so this run proves little"

      for gen <- settled do
        assert keys(gen) != [], "#{gen.key} is one uniform sprawl: it states no regions at all"

        picker = Enum.find(gen.options, &(&1["key"] == "region"))
        assert picker, "#{gen.key} states regions and offers no way to pick one"

        offered = picker["choices"] |> Enum.map(& &1["key"]) |> Enum.reject(&(&1 == "random"))

        assert offered == keys(gen),
               "#{gen.key} offers #{inspect(offered)} of #{inspect(keys(gen))}"
      end
    end

    test "a settlement region says how much of it is BUILT, or it is a tint" do
      # `built` is the share of a region's plots carrying a building: a park is 0, a terrace 1. Without it
      # the three neighbourhoods of a city were three names for one thing.
      settled =
        Catalog.list_generator_categories()
        |> Enum.reject(&(&1.key == "wilderness"))
        |> Enum.flat_map(& &1.generators)

      for gen <- settled do
        shares = for z <- regions(gen), do: z["built"]

        assert Enum.all?(shares, &is_number/1),
               "#{gen.key} has regions that do not say how built they are: #{inspect(shares)}"

        assert length(Enum.uniq(shares)) > 1,
               "#{gen.key} builds every region the same amount, so they are one place in #{length(shares)} colours"
      end
    end
  end

  describe "the seeder owns it" do
    test "seeding twice says the same thing, so nothing has to patch it afterwards", %{wild: wild} do
      before = Map.new(wild, &{&1.key, {keys(&1), Map.get(&1.config, "regionLayout")}})

      GeneratorSource.seed()

      again =
        Catalog.list_generator_categories()
        |> Enum.flat_map(& &1.generators)
        |> Enum.filter(&String.starts_with?(&1.key, "forest_"))
        |> Map.new(&{&1.key, {keys(&1), Map.get(&1.config, "regionLayout")}})

      assert again == before, "a second seed changed the regions"
    end
  end
end
