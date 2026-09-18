defmodule Nebulith.DataMigration.ARegionGrowsItsOwnTrees do
  @moduledoc """
  Three regions that were growing somebody else's trees.

  Measured while making every region a place of its own, which shifted how much of each map each region
  claims and so exposed two species collisions that the old weighting had been hiding:

  * a woodland's `edge` and its `glade` served the SAME list, `tree_gnarled` 60 leading both, so picking one
    or the other changed nothing about what grew. A glade is the young growth that comes up where the light
    reaches the floor, not a second stand of the same old veterans.
  * the jungle and the meadow both came out dominated by `tree_round`, because the jungle's `deep` spread its
    weight evenly over four species and the meadow's `pasture` leant on the same one. A deep jungle IS its
    giants and an orchard IS its cherries, so each leads with the tree it is named for.
  """
  require Logger

  alias Nebulith.Repo

  defp mix(list), do: Enum.map(list, fn {kind, weight} -> %{"kind" => kind, "weight" => weight} end)

  defp sets do
    %{
      "forest_woodland" => %{
        # young growth under the gap, not the veterans that ring the wood
        "glade" => mix([{"tree_sapling", 45}, {"bush_round", 30}, {"tree_cherry", 25}])
      },
      "forest_jungle" => %{
        # the emergent giants ARE the deep jungle
        "deep" => mix([{"tree_giant", 45}, {"tree_big", 25}, {"bush", 15}, {"tree_round", 15}])
      },
      "forest_meadow" => %{
        # an orchard is a cherry orchard, and a pasture's few trees are broad ones to stand under
        "orchard" => mix([{"tree_cherry", 60}, {"tree_round", 25}, {"tree_big", 15}]),
        "pasture" => mix([{"tree_big", 45}, {"bush_round", 35}, {"tree_round", 20}])
      }
    }
  end

  def run do
    rows = Enum.sum(for {key, set} <- sets(), do: give(key, set))
    Logger.info("[data_migrate] #{rows} templates: three regions grow their own trees now")
    :ok
  end

  defp give(key, set) do
    %{rows: rows} = Repo.query!("SELECT config->'subZones' FROM generators WHERE key = $1", [key])

    case rows do
      [[zones]] when is_list(zones) ->
        write(key, Enum.map(zones, fn z -> Map.put(z, "trees", Map.get(set, z["key"], z["trees"])) end))

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
