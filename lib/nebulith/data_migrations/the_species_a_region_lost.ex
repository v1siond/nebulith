defmodule Nebulith.DataMigration.TheSpeciesARegionLost do
  @moduledoc """
  Give back the per-region SPECIES a region set lost when it was replaced, the same gap as its blooms.

  `EveryBiomeItsOwnRegions` wrote the beach, swamp, desert and ruins their own region sets and carried neither
  `flowers` nor `trees` across. `TheBloomsARegionLost` restored the first; this restores the second.

  The size of it: a BEACH stopped stating tropical species anywhere in it, so every region of it fell back to
  the template's own mix, and a SWAMP stopped stating cypress, which is the tree that stands in that water and
  the thing the swamp's own test is named after. Both contracts passed the whole time against a captured
  fixture that still held the regions the backend had stopped serving.

  The species are the ones each biome served before the replacement, recovered from that fixture and mapped
  onto the new names by what each place IS rather than by position:

      beach     shore takes the old lakeside's mangroves, palms takes the palm mix, inland the closed wood
      swamp     cypress runs through all five, heaviest where the water stands
      desert    the oasis takes the palms, the erg and the hardpan almost nothing
      ruins     the heart keeps stubs, the forest around it the full wood
  """
  require Logger

  alias Nebulith.Repo

  defp mix(list),
    do: Enum.map(list, fn {kind, weight} -> %{"kind" => kind, "weight" => weight} end)

  defp species do
    %{
      "forest_beach" => %{
        "shore" => mix([{"tree_mangrove", 60}, {"tree_palm", 25}, {"bush_round", 15}]),
        "dunes" => mix([{"bush_round", 55}, {"tree_palm", 25}, {"bush", 20}]),
        "palms" => mix([{"tree_coconut", 40}, {"tree_palm", 35}, {"tree_banana", 25}]),
        "backshore" =>
          mix([{"tree_banana", 30}, {"tree_coconut", 25}, {"tree_mangrove", 25}, {"bush", 20}]),
        "inland" =>
          mix([{"tree_coconut", 35}, {"tree_palm", 25}, {"tree_banana", 25}, {"bush_round", 15}])
      },
      "forest_swamp" => %{
        "margin" => mix([{"tree_cypress", 40}, {"tree_mangrove", 30}, {"bush_round", 30}]),
        "mire" =>
          mix([{"tree_cypress", 35}, {"tree_giant", 25}, {"bush", 25}, {"tree_round", 15}]),
        "bog" => mix([{"tree_cypress", 55}, {"tree_mangrove", 25}, {"bush_round", 20}]),
        "sink" => mix([{"tree_cypress", 60}, {"tree_mangrove", 25}, {"bush_round", 15}]),
        "open_water" => mix([{"tree_cypress", 70}, {"tree_mangrove", 20}, {"bush_round", 10}])
      },
      "forest_desert" => %{
        "erg" => mix([{"bush_round", 60}, {"tree_sapling", 40}]),
        "hardpan" => mix([{"bush_round", 50}, {"bush", 30}, {"tree_sapling", 20}]),
        "wadi" => mix([{"tree_palm", 40}, {"tree_banana", 30}, {"bush", 30}]),
        "oasis" => mix([{"tree_coconut", 40}, {"tree_palm", 35}, {"tree_banana", 25}])
      },
      "forest_ruins" => %{
        "heart" => mix([{"tree_stub", 60}, {"tree_sapling", 40}]),
        "courts" => mix([{"tree_stub", 40}, {"tree_round", 30}, {"bush_round", 30}]),
        "terraces" => mix([{"tree_round", 40}, {"bush", 35}, {"tree_sapling", 25}]),
        "overgrown" =>
          mix([{"tree_round", 30}, {"bush", 30}, {"tree_stub", 20}, {"tree_sapling", 20}]),
        "forest" => mix([{"tree_stub", 40}, {"tree_round", 30}, {"bush_round", 30}])
      }
    }
  end

  def run do
    rows = Enum.sum(for {key, set} <- species(), do: give(key, set))
    Logger.info("[data_migrate] #{rows} templates have their per-region species back")
    :ok
  end

  defp give(key, set) do
    %{rows: rows} = Repo.query!("SELECT config->'subZones' FROM generators WHERE key = $1", [key])

    case rows do
      [[zones]] when is_list(zones) ->
        write(
          key,
          Enum.map(zones, fn z -> Map.put(z, "trees", Map.get(set, z["key"], z["trees"])) end)
        )

      _ ->
        0
    end
  end

  defp write(key, regions) do
    %{num_rows: rows} =
      Repo.query!(
        "UPDATE generators SET config = jsonb_set(config, '{subZones}', $2::text::jsonb) WHERE key = $1",
        [key, Jason.encode!(regions)]
      )

    rows
  end
end
