defmodule Nebulith.DataMigration.TheBloomsARegionLost do
  @moduledoc """
  Give back the per-region blooms a region set lost when it was replaced.

  `EveryBiomeItsOwnRegions` gave the beach, the swamp, the desert and the ruins their OWN region sets, which
  was right, and it wrote the new regions without the `flowers` the old ones carried. Nothing failed, because
  the test that guards this reads a captured fixture and the fixture still held the OLD regions: the beach's
  were still `edge` / `deep` / `glade` / `thicket` / `lakeside`, the woodland's set, months after the backend
  stopped serving them.

  So a contract that says *"the shore region states its own blooms, so none falls back to the season"* has
  been broken in the backend the whole time and passed anyway, against regions that no longer exist. Topping
  the fixture up from live is what exposed it.

  The blooms are the ones each biome served before its regions were replaced, recovered from that fixture,
  and they go on EVERY region of the set: a region that states none takes the season's, which is what these
  templates were built to avoid.
  """
  require Logger

  alias Nebulith.Repo

  defp blooms do
    %{
      "forest_beach" => [
        %{"char" => "✿", "color" => "#e2739b"},
        %{"char" => "❋", "color" => "#6aa9c4"},
        %{"char" => "✾", "color" => "#e0c877"}
      ],
      "forest_swamp" => [
        %{"char" => "✾", "color" => "#7b5fa8"},
        %{"char" => "❋", "color" => "#4f8f7a"},
        %{"char" => "✿", "color" => "#b89a3c"}
      ],
      "forest_desert" => [
        %{"char" => "✿", "color" => "#e2739b"},
        %{"char" => "❋", "color" => "#6aa9c4"},
        %{"char" => "✾", "color" => "#e0c877"}
      ],
      "forest_ruins" => [
        %{"char" => "✿", "color" => "#c2513f"},
        %{"char" => "✾", "color" => "#8d5fa8"},
        %{"char" => "❋", "color" => "#c9b063"}
      ]
    }
  end

  def run do
    rows = Enum.sum(for {key, set} <- blooms(), do: give(key, set))
    Logger.info("[data_migrate] #{rows} templates have their per-region blooms back")
    :ok
  end

  defp give(key, set) do
    %{rows: rows} = Repo.query!("SELECT config->'subZones' FROM generators WHERE key = $1", [key])

    case rows do
      [[zones]] when is_list(zones) ->
        write(key, Enum.map(zones, &Map.put_new(&1, "flowers", set)))

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
